// -*- coding: utf-8 -*-

import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";

const SCHEMA_VERSION = 1;
const DEFAULT_PLAYER_INTERVAL_MS = 333;
const DEFAULT_ASSET_INTERVAL_MS = 5_000;
const DEFAULT_FLUSH_INTERVAL_MS = 1_000;
const DEFAULT_META_INTERVAL_MS = 5_000;
const DEFAULT_MAX_BUFFER_BYTES = 512 * 1024;
const DEFAULT_RETENTION_DAYS = 14;
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;

export function createTacticalReplayModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.tacticalReplay",
    source: "module.tacticalReplay",
    channel: "module",
  }) ?? core.logger;

  const dataDirectory = path.resolve(
    process.cwd(),
    String(readConfig(config, "modules.tacticalReplay.dataDirectory", "./data/tactical-replays")),
  );
  const playerIntervalMs = clampInteger(
    readConfig(config, "modules.tacticalReplay.playerIntervalMs", DEFAULT_PLAYER_INTERVAL_MS),
    50,
    60_000,
    DEFAULT_PLAYER_INTERVAL_MS,
  );
  const assetIntervalMs = clampInteger(
    readConfig(config, "modules.tacticalReplay.assetIntervalMs", DEFAULT_ASSET_INTERVAL_MS),
    250,
    300_000,
    DEFAULT_ASSET_INTERVAL_MS,
  );
  const flushIntervalMs = clampInteger(
    readConfig(config, "modules.tacticalReplay.flushIntervalMs", DEFAULT_FLUSH_INTERVAL_MS),
    100,
    60_000,
    DEFAULT_FLUSH_INTERVAL_MS,
  );
  const metaIntervalMs = clampInteger(
    readConfig(config, "modules.tacticalReplay.metaIntervalMs", DEFAULT_META_INTERVAL_MS),
    500,
    300_000,
    DEFAULT_META_INTERVAL_MS,
  );
  const maxBufferedBytes = clampInteger(
    readConfig(config, "modules.tacticalReplay.maxBufferedBytes", DEFAULT_MAX_BUFFER_BYTES),
    16 * 1024,
    32 * 1024 * 1024,
    DEFAULT_MAX_BUFFER_BYTES,
  );
  const retentionDays = clampInteger(
    readConfig(config, "modules.tacticalReplay.retentionDays", DEFAULT_RETENTION_DAYS),
    1,
    3650,
    DEFAULT_RETENTION_DAYS,
  );

  const state = {
    started: false,
    lastError: "",
    lastSnapshotAt: "",
    recordedPlayerFrames: 0,
    recordedAssetFrames: 0,
    writtenBytes: 0,
    droppedFrames: 0,
  };

  let latestSnapshot = null;
  let activeSession = null;
  let unsubscribeSnapshot = null;
  let playerTimer = null;
  let assetTimer = null;
  let flushTimer = null;
  let metaTimer = null;
  let stopped = true;
  let pendingLifecycleSnapshot = null;
  let lifecycleScheduled = false;
  let lifecycleChain = Promise.resolve();
  let writeChain = Promise.resolve();
  let metaWriteChain = Promise.resolve();
  let bufferedLines = [];
  let bufferedBytes = 0;

  function enqueueLifecycle(task) {
    lifecycleChain = lifecycleChain.then(task, task).catch((error) => {
      state.lastError = error?.message ?? String(error);
      moduleLogger.warn?.("Tactical replay lifecycle operation failed.", {
        operation: "tacticalReplay.lifecycle",
        data: { message: state.lastError },
      });
    });
    return lifecycleChain;
  }

  function scheduleLifecycle(snapshot) {
    pendingLifecycleSnapshot = snapshot;
    if (lifecycleScheduled || stopped) return;
    lifecycleScheduled = true;
    queueMicrotask(() => {
      lifecycleScheduled = false;
      const nextSnapshot = pendingLifecycleSnapshot;
      pendingLifecycleSnapshot = null;
      if (!nextSnapshot || stopped) return;
      void enqueueLifecycle(() => reconcileSession(nextSnapshot));
    });
  }

  function onSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;
    latestSnapshot = snapshot;
    state.lastSnapshotAt = firstText(snapshot?.meta?.generatedAt, new Date().toISOString());
    scheduleLifecycle(snapshot);
  }

  async function reconcileSession(snapshot) {
    const identity = resolveRoundIdentity(snapshot);
    if (!identity || !isRecordableSnapshot(snapshot)) return;

    if (activeSession && (
      activeSession.roundKey !== identity.key
      || isRoundClosed(snapshot)
    )) {
      await closeActiveSession(
        activeSession.roundKey !== identity.key ? "round-changed" : "round-ended",
        snapshot,
      );
    }

    if (!activeSession && !isRoundClosed(snapshot)) {
      await openSession(snapshot, identity);
    }
  }

  async function openSession(snapshot, identity) {
    await fs.mkdir(dataDirectory, { recursive: true });
    const now = new Date();
    const sessionId = buildSessionId(now, identity.layer || identity.map || "round");
    const directory = path.join(dataDirectory, sessionId);
    await fs.mkdir(directory, { recursive: true });

    const session = {
      id: sessionId,
      schemaVersion: SCHEMA_VERSION,
      status: "active",
      roundKey: identity.key,
      serverId: identity.serverId,
      serverName: firstText(snapshot?.server?.name),
      map: identity.map,
      layer: identity.layer,
      mode: identity.mode,
      roundStartedAt: identity.roundStartedAt,
      startedAt: now.toISOString(),
      startedMs: now.getTime(),
      endedAt: "",
      endReason: "",
      durationMs: 0,
      lastFrameAt: "",
      lastFrameMs: 0,
      nextSequence: 1,
      frameCounts: { players: 0, assets: 0 },
      fileBytes: 0,
      playerIntervalMs,
      assetIntervalMs,
      framesPath: path.join(directory, "frames.jsonl"),
      metaPath: path.join(directory, "meta.json"),
      directory,
    };

    activeSession = session;
    await persistSessionMeta(session);
    captureAssetFrame(session, snapshot, { force: true });
    capturePlayerFrame(session, snapshot, { force: true });
    await flushBufferedFrames();

    moduleLogger.info?.(`Tactical replay recording started: ${session.id}`, {
      label: "REPLAY",
      operation: "tacticalReplay.startSession",
      data: {
        sessionId: session.id,
        map: session.map,
        layer: session.layer,
        playerIntervalMs,
        assetIntervalMs,
      },
    });
  }

  async function closeActiveSession(reason = "module-stop", finalSnapshot = latestSnapshot) {
    const session = activeSession;
    if (!session) return;

    if (finalSnapshot && resolveRoundIdentity(finalSnapshot)?.key === session.roundKey) {
      captureAssetFrame(session, finalSnapshot, { force: true });
      capturePlayerFrame(session, finalSnapshot, { force: true });
    }

    activeSession = null;
    await flushBufferedFrames();
    await writeChain;

    const endedAt = new Date();
    session.status = "closed";
    session.endedAt = endedAt.toISOString();
    session.endReason = reason;
    session.durationMs = Math.max(session.lastFrameMs, endedAt.getTime() - session.startedMs);
    await persistSessionMeta(session);
    await metaWriteChain;

    moduleLogger.info?.(`Tactical replay recording closed: ${session.id}`, {
      label: "REPLAY",
      operation: "tacticalReplay.closeSession",
      data: {
        sessionId: session.id,
        reason,
        durationMs: session.durationMs,
        frameCounts: session.frameCounts,
        fileBytes: session.fileBytes,
      },
    });
  }

  function samplePlayers() {
    const session = activeSession;
    const snapshot = latestSnapshot;
    if (!session || !snapshot || stopped) return;
    const identity = resolveRoundIdentity(snapshot);
    if (!identity || identity.key !== session.roundKey || isRoundClosed(snapshot)) return;
    capturePlayerFrame(session, snapshot);
  }

  function sampleAssets() {
    const session = activeSession;
    const snapshot = latestSnapshot;
    if (!session || !snapshot || stopped) return;
    const identity = resolveRoundIdentity(snapshot);
    if (!identity || identity.key !== session.roundKey) return;
    captureAssetFrame(session, snapshot);
  }

  function capturePlayerFrame(session, snapshot, { force = false } = {}) {
    if (!session || !snapshot) return;
    const nowMs = Date.now();
    const elapsedMs = Math.max(0, nowMs - session.startedMs);
    if (!force && session.lastPlayerFrameMs != null && elapsedMs - session.lastPlayerFrameMs < playerIntervalMs * 0.75) return;

    const frame = {
      schemaVersion: SCHEMA_VERSION,
      type: "players",
      seq: session.nextSequence++,
      t: elapsedMs,
      at: new Date(nowMs).toISOString(),
      revision: numberOrNull(snapshot?.meta?.revision),
      players: (Array.isArray(snapshot?.players) ? snapshot.players : []).map(toReplayPlayer),
    };
    session.lastPlayerFrameMs = elapsedMs;
    session.frameCounts.players += 1;
    state.recordedPlayerFrames += 1;
    appendFrame(session, frame);
  }

  function captureAssetFrame(session, snapshot, { force = false } = {}) {
    if (!session || !snapshot) return;
    const nowMs = Date.now();
    const elapsedMs = Math.max(0, nowMs - session.startedMs);
    if (!force && session.lastAssetFrameMs != null && elapsedMs - session.lastAssetFrameMs < assetIntervalMs * 0.75) return;

    const frame = {
      schemaVersion: SCHEMA_VERSION,
      type: "assets",
      seq: session.nextSequence++,
      t: elapsedMs,
      at: new Date(nowMs).toISOString(),
      revision: numberOrNull(snapshot?.meta?.revision),
      server: {
        serverId: firstText(snapshot?.server?.serverId, snapshot?.meta?.serverId),
        name: firstText(snapshot?.server?.name),
        map: firstText(snapshot?.server?.map, snapshot?.match?.map),
        layer: firstText(snapshot?.server?.layer, snapshot?.match?.layer),
        mode: firstText(snapshot?.server?.mode, snapshot?.match?.mode),
        playerCount: numberOrNull(snapshot?.server?.playerCount),
        tickets: cloneJson(snapshot?.server?.tickets ?? null),
      },
      match: pickReplayMatch(snapshot?.match),
      teams: cloneArray(snapshot?.teams),
      assets: {
        captureZones: cloneArray(snapshot?.assets?.captureZones),
        fobs: cloneArray(snapshot?.assets?.fobs),
        mainZones: cloneArray(snapshot?.assets?.mainZones),
      },
    };
    session.lastAssetFrameMs = elapsedMs;
    session.frameCounts.assets += 1;
    state.recordedAssetFrames += 1;
    appendFrame(session, frame);
  }

  function appendFrame(session, frame) {
    try {
      const line = `${JSON.stringify(frame)}\n`;
      const byteLength = Buffer.byteLength(line);
      bufferedLines.push({ sessionId: session.id, framesPath: session.framesPath, line });
      bufferedBytes += byteLength;
      session.fileBytes += byteLength;
      session.lastFrameAt = frame.at;
      session.lastFrameMs = frame.t;
      session.durationMs = Math.max(session.durationMs, frame.t);
      state.writtenBytes += byteLength;
      if (bufferedBytes >= maxBufferedBytes) void flushBufferedFrames();
    } catch (error) {
      state.droppedFrames += 1;
      state.lastError = error?.message ?? String(error);
    }
  }

  function flushBufferedFrames() {
    if (bufferedLines.length === 0) return writeChain;
    const batch = bufferedLines;
    bufferedLines = [];
    bufferedBytes = 0;

    const groups = new Map();
    for (const entry of batch) {
      const current = groups.get(entry.framesPath) ?? [];
      current.push(entry.line);
      groups.set(entry.framesPath, current);
    }

    writeChain = writeChain.then(async () => {
      for (const [framesPath, lines] of groups.entries()) {
        await fs.appendFile(framesPath, lines.join(""), "utf8");
      }
    }).catch((error) => {
      state.lastError = error?.message ?? String(error);
      state.droppedFrames += batch.length;
      moduleLogger.warn?.("Failed to flush tactical replay frames.", {
        operation: "tacticalReplay.flush",
        data: { message: state.lastError, frameCount: batch.length },
      });
    });

    return writeChain;
  }

  function persistSessionMeta(session) {
    const metadata = serializeSession(session);
    metaWriteChain = metaWriteChain.then(async () => {
      await fs.mkdir(session.directory, { recursive: true });
      const temporaryPath = `${session.metaPath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
      await fs.writeFile(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
      await fs.rename(temporaryPath, session.metaPath);
    }).catch((error) => {
      state.lastError = error?.message ?? String(error);
      moduleLogger.warn?.("Failed to persist tactical replay metadata.", {
        operation: "tacticalReplay.persistMeta",
        data: { sessionId: session.id, message: state.lastError },
      });
    });
    return metaWriteChain;
  }

  async function listSessions({ limit = 100 } = {}) {
    await fs.mkdir(dataDirectory, { recursive: true });
    const entries = await fs.readdir(dataDirectory, { withFileTypes: true });
    const sessions = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !SESSION_ID_PATTERN.test(entry.name)) continue;
      try {
        const metadata = await readSessionMetadata(entry.name);
        if (metadata) sessions.push(metadata);
      } catch {
        // Ignore partially written or externally removed replay directories.
      }
    }

    if (activeSession) {
      const activeMetadata = serializeSession(activeSession);
      const index = sessions.findIndex((item) => item.id === activeMetadata.id);
      if (index >= 0) sessions[index] = activeMetadata;
      else sessions.push(activeMetadata);
    }

    sessions.sort((left, right) => String(right.startedAt ?? "").localeCompare(String(left.startedAt ?? "")));
    return sessions.slice(0, clampInteger(limit, 1, 1000, 100));
  }

  async function getSession(sessionId) {
    const safeId = validateSessionId(sessionId);
    if (activeSession?.id === safeId) return serializeSession(activeSession);
    return readSessionMetadata(safeId);
  }

  async function readFrames(sessionId, options = {}) {
    const safeId = validateSessionId(sessionId);
    if (activeSession?.id === safeId) {
      await flushBufferedFrames();
      await writeChain;
    }

    const metadata = await getSession(safeId);
    if (!metadata) {
      const error = new Error("Replay session was not found.");
      error.code = "ReplaySessionNotFound";
      error.statusCode = 404;
      throw error;
    }

    const framesPath = path.join(dataDirectory, safeId, "frames.jsonl");
    const fromMs = clampNumber(options.fromMs, 0, Number.MAX_SAFE_INTEGER, 0);
    const toMs = clampNumber(options.toMs, fromMs, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    const limit = clampInteger(options.limit, 1, 100_000, 20_000);
    const includeContext = options.includeContext !== false;
    const typeSet = normalizeFrameTypes(options.types);
    const frames = [];
    const contextByType = new Map();
    let hasMore = false;

    try {
      const input = createReadStream(framesPath, { encoding: "utf8" });
      const lines = readline.createInterface({ input, crlfDelay: Infinity });
      let contextInserted = false;

      for await (const line of lines) {
        if (!line.trim()) continue;
        let frame;
        try {
          frame = JSON.parse(line);
        } catch {
          continue;
        }
        const frameType = String(frame?.type ?? "");
        if (!typeSet.has(frameType)) continue;
        const frameTime = Number(frame?.t);
        if (!Number.isFinite(frameTime)) continue;

        if (frameTime < fromMs) {
          if (includeContext) contextByType.set(frameType, frame);
          continue;
        }
        if (frameTime > toMs) break;

        if (!contextInserted) {
          contextInserted = true;
          const contextFrames = [...contextByType.values()].sort((left, right) => Number(left.t) - Number(right.t));
          for (const contextFrame of contextFrames) {
            if (frames.length >= limit) break;
            frames.push(contextFrame);
          }
        }

        if (frames.length >= limit) {
          hasMore = true;
          break;
        }
        frames.push(frame);
      }

      if (!contextInserted && includeContext) {
        for (const contextFrame of [...contextByType.values()].sort((left, right) => Number(left.t) - Number(right.t))) {
          if (frames.length >= limit) break;
          frames.push(contextFrame);
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    const lastFrame = frames.at(-1) ?? null;
    return {
      session: metadata,
      fromMs,
      toMs: Number.isFinite(toMs) ? toMs : null,
      frames,
      hasMore,
      nextFromMs: hasMore && lastFrame ? Number(lastFrame.t) + 1 : null,
    };
  }

  function getStatus() {
    return {
      enabled: state.started && !stopped,
      dataDirectory,
      playerIntervalMs,
      assetIntervalMs,
      flushIntervalMs,
      retentionDays,
      bufferedFrames: bufferedLines.length,
      bufferedBytes,
      activeSession: activeSession ? serializeSession(activeSession) : null,
      diagnostics: { ...state },
    };
  }

  async function readSessionMetadata(sessionId) {
    const safeId = validateSessionId(sessionId);
    const metaPath = path.join(dataDirectory, safeId, "meta.json");
    try {
      return JSON.parse(await fs.readFile(metaPath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async function cleanupExpiredSessions() {
    const threshold = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let entries = [];
    try {
      entries = await fs.readdir(dataDirectory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || !SESSION_ID_PATTERN.test(entry.name)) continue;
      try {
        const metadata = await readSessionMetadata(entry.name);
        const endedMs = Date.parse(metadata?.endedAt || metadata?.startedAt || "");
        if (Number.isFinite(endedMs) && endedMs < threshold && metadata?.status !== "active") {
          await fs.rm(path.join(dataDirectory, entry.name), { recursive: true, force: true });
        }
      } catch {
        // Retention cleanup must not prevent the recorder from starting.
      }
    }
  }

  return {
    manifest: {
      id: "module.tacticalReplay",
      name: "Tactical Replay Recorder",
      kind: "module",
      version: "0.1.0",
      description: "Record high-frequency player frames and low-frequency tactical asset keyframes for map replay.",
    },
    apiName: "tacticalReplay",
    api: {
      listSessions,
      getSession,
      readFrames,
      getStatus,
    },
    async start() {
      if (state.started) return;
      state.started = true;
      stopped = false;
      await fs.mkdir(dataDirectory, { recursive: true });
      await cleanupExpiredSessions();

      const tacticalState = modules.tacticalState;
      if (!tacticalState?.subscribe) {
        state.lastError = "tacticalState module is unavailable.";
        moduleLogger.warn?.(state.lastError, { operation: "tacticalReplay.start" });
        return;
      }

      unsubscribeSnapshot = tacticalState.subscribe(onSnapshot);
      try {
        const initialSnapshot = await tacticalState.getSnapshot?.();
        if (initialSnapshot) onSnapshot(initialSnapshot);
      } catch (error) {
        state.lastError = error?.message ?? String(error);
      }

      playerTimer = setInterval(samplePlayers, playerIntervalMs);
      assetTimer = setInterval(sampleAssets, assetIntervalMs);
      flushTimer = setInterval(() => void flushBufferedFrames(), flushIntervalMs);
      metaTimer = setInterval(() => {
        if (activeSession) void persistSessionMeta(activeSession);
      }, metaIntervalMs);
      playerTimer.unref?.();
      assetTimer.unref?.();
      flushTimer.unref?.();
      metaTimer.unref?.();
    },
    async stop() {
      if (!state.started) return;
      stopped = true;
      state.started = false;
      unsubscribeSnapshot?.();
      unsubscribeSnapshot = null;
      for (const timer of [playerTimer, assetTimer, flushTimer, metaTimer]) {
        if (timer) clearInterval(timer);
      }
      playerTimer = null;
      assetTimer = null;
      flushTimer = null;
      metaTimer = null;
      pendingLifecycleSnapshot = null;
      await lifecycleChain;
      await closeActiveSession("module-stop");
      await flushBufferedFrames();
      await writeChain;
      await metaWriteChain;
    },
  };
}

function serializeSession(session) {
  return {
    schemaVersion: session.schemaVersion,
    id: session.id,
    status: session.status,
    serverId: session.serverId,
    serverName: session.serverName,
    map: session.map,
    layer: session.layer,
    mode: session.mode,
    roundStartedAt: session.roundStartedAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    endReason: session.endReason,
    durationMs: Math.max(0, Number(session.durationMs ?? session.lastFrameMs ?? 0)),
    lastFrameAt: session.lastFrameAt,
    frameCounts: { ...session.frameCounts },
    fileBytes: session.fileBytes,
    playerIntervalMs: session.playerIntervalMs,
    assetIntervalMs: session.assetIntervalMs,
    dataModel: {
      playerFrames: "Full player truth frame sampled at playerIntervalMs.",
      assetFrames: "Capture Zone, FOB and Main Zone keyframe sampled at assetIntervalMs.",
      reconstruction: "Merge each player frame with the latest asset frame at or before the same timestamp.",
    },
  };
}

function resolveRoundIdentity(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const serverId = firstText(snapshot?.server?.serverId, snapshot?.meta?.serverId, "default");
  const map = firstText(snapshot?.server?.map, snapshot?.match?.map, snapshot?.match?.mapName);
  const layer = firstText(snapshot?.server?.layer, snapshot?.match?.layer, snapshot?.match?.layerName);
  const mode = firstText(snapshot?.server?.mode, snapshot?.match?.mode, snapshot?.match?.gameMode);
  if (!map && !layer) return null;
  const roundToken = firstText(
    snapshot?.match?.roundId,
    snapshot?.match?.matchId,
    snapshot?.match?.id,
    snapshot?.match?.startedAt,
    snapshot?.match?.startTime,
  );
  const roundStartedAt = firstText(snapshot?.match?.startedAt, snapshot?.match?.startTime);
  return {
    serverId,
    map,
    layer,
    mode,
    roundStartedAt,
    key: `${serverId}|${roundToken || `${map}|${layer}`}`,
  };
}

function isRecordableSnapshot(snapshot) {
  const players = Array.isArray(snapshot?.players) ? snapshot.players.length : 0;
  const assets = snapshot?.assets ?? {};
  const assetCount = [assets.captureZones, assets.fobs, assets.mainZones]
    .reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);
  return players > 0 || assetCount > 0 || Boolean(resolveRoundIdentity(snapshot));
}

function isRoundClosed(snapshot) {
  const phase = firstText(
    snapshot?.match?.phase,
    snapshot?.match?.state,
    snapshot?.server?.phase,
    snapshot?.server?.matchPhase,
  ).toLowerCase();
  return /waitingpostmatch|postmatch|intermission|roundended|matchended|complete|finished/.test(phase);
}

function toReplayPlayer(player) {
  const identity = player?.identity ?? {};
  const match = player?.match ?? {};
  const telemetry = player?.telemetry ?? {};
  const vehicle = player?.vehicle ?? {};
  const network = player?.network ?? {};
  const combat = player?.combat ?? {};
  const position = cloneJson(telemetry.position ?? player?.position ?? null);
  const rotation = cloneJson(telemetry.rotation ?? player?.soldierInfo?.rotation ?? null);
  const playerId = numberOrNull(identity.playerID, identity.playerId);
  const steamId = firstText(identity.steamID);
  const eosId = firstText(identity.eosID);
  const playerGuid = steamId || eosId;

  return {
    key: firstText(identity.key, playerId == null ? "" : `player:${playerId}`, playerGuid, identity.name),
    playerId,
    playerIndex: playerId,
    playerName: firstText(identity.name, "Unknown"),
    playerGuid,
    steamId: steamId || null,
    eosId: eosId || null,
    teamId: numberOrNull(match.teamId),
    squadId: numberOrNull(match.squadId),
    squadName: firstText(match.squadName),
    teamName: firstText(match.teamName),
    isLeader: Boolean(match.isLeader),
    role: firstText(match.role),
    health: numberOrNull(telemetry.health),
    ping: numberOrNull(network.gamePing, network.icmpPing),
    ftIndex: numberOrNull(telemetry.fireTeamIndex),
    ftPosition: numberOrNull(telemetry.fireTeamPosition),
    position,
    yaw: numberOrNull(telemetry.yaw),
    presenceHint: firstText(telemetry.presenceHint, player?.presence?.state),
    presence: {
      online: player?.presence?.online !== false,
      state: firstText(player?.presence?.state, "online"),
    },
    hasTelemetry: telemetry.hasTelemetry !== false,
    hasPosition: Boolean(telemetry.hasPosition || position),
    soldierInfo: {
      health: numberOrNull(telemetry.health),
      soldierClass: firstText(telemetry.soldierClass),
      weaponClass: firstText(telemetry.weaponClass),
      position,
      rotation,
    },
    vehicleInfo: {
      vehicleType: firstText(vehicle.vehicleType),
      health: numberOrNull(vehicle.health),
      maxHealth: numberOrNull(vehicle.maxHealth),
      position,
      rotation,
    },
    playerScoreboard: {
      ping: numberOrNull(network.gamePing),
      stats: {
        numKills: numberOrNull(combat.kills),
        numDeaths: numberOrNull(combat.deaths),
        numWounds: numberOrNull(combat.wounds),
        numWoundeds: numberOrNull(combat.woundeds),
        numTeamKills: numberOrNull(combat.teamKills),
        revivedPoints: numberOrNull(combat.revives),
        healPoints: numberOrNull(combat.healPoints),
        objectiveScore: numberOrNull(combat.objectiveScore),
        teamworkScore: numberOrNull(combat.teamworkScore),
        combatScore: numberOrNull(combat.combatScore),
      },
    },
    observedAt: firstText(player?.freshness?.bzssCoreUpdatedAt, player?.freshness?.generatedAt),
  };
}

function pickReplayMatch(match) {
  if (!match || typeof match !== "object") return {};
  return {
    roundId: match.roundId ?? match.matchId ?? match.id ?? null,
    phase: firstText(match.phase, match.state),
    map: firstText(match.map, match.mapName),
    layer: firstText(match.layer, match.layerName),
    mode: firstText(match.mode, match.gameMode),
    startedAt: firstText(match.startedAt, match.startTime),
    elapsedSeconds: numberOrNull(match.elapsedSeconds, match.elapsed),
  };
}

function buildSessionId(date, layer) {
  const timestamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const slug = String(layer ?? "round")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "round";
  return `${timestamp}_${slug}_${crypto.randomBytes(3).toString("hex")}`;
}

function validateSessionId(value) {
  const sessionId = String(value ?? "").trim();
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    const error = new Error("Invalid replay session id.");
    error.code = "InvalidReplaySessionId";
    error.statusCode = 400;
    throw error;
  }
  return sessionId;
}

function normalizeFrameTypes(value) {
  const source = Array.isArray(value)
    ? value
    : String(value ?? "players,assets").split(",");
  const allowed = new Set(["players", "assets"]);
  const normalized = new Set(source.map((item) => String(item).trim()).filter((item) => allowed.has(item)));
  return normalized.size > 0 ? normalized : allowed;
}

function readConfig(config, key, fallback) {
  try {
    const value = config?.get?.(key, fallback);
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function clampInteger(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function cloneJson(value) {
  if (value == null || typeof value !== "object") return value ?? null;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // Fall through to JSON clone.
    }
  }
  return JSON.parse(JSON.stringify(value));
}

function cloneArray(value) {
  return Array.isArray(value) ? value.map((item) => cloneJson(item)) : [];
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function numberOrNull(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}
