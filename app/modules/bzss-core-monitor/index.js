// -*- coding: utf-8 -*-

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MARKER = "{BZSS-Marked}";
const START_NEEDLE = Buffer.from("PlayerBaseInfo{", "utf16le");
const PRI_START_NEEDLE = Buffer.from("PRI{{", "utf16le");
const MARKER_NEEDLE = Buffer.from(MARKER, "utf16le");
const PRI_FRAME_TIMEOUT_MS = 500;
const COMPACT_RUNTIME_POSITION_SCALE = 100;
const RAW_CAPTURE_RELATIVE_PATH = path.join("data", "bzss-core-monitor", "received-lines.jsonl");
const BZSS_CORE_PLAYER_CHUNK_EVENT_NAME = "On_BzssCorePlayerChunk";
const BZSS_CORE_BROADCAST_INTERVAL_MS = 200;
const SCOREBOARD_FIELDS = [
  ["dataLives", "Data lives"],
  ["numKills", "Num kills"],
  ["vehicleKills", "Num vehicle kills"],
  ["numDeaths", "Num death"],
  ["numWoundeds", "Num woundeds"],
  ["numWounds", "Num wounds"],
  ["numTeamKills", "Num TK"],
  ["healPoints", "Heal point"],
  ["revivedPoints", "Revived points"],
  ["teamworkScore", "Team work score"],
  ["objectiveScore", "Objective score"],
  ["combatScore", "Combat score"],
];
const SCOREBOARD_FIELD_ALIASES = {
  dataLives: ["Lives", "DataLives"],
  numKills: ["NumKills"],
  vehicleKills: ["VehicleKills", "NumVehicleKills"],
  numDeaths: ["NumDeaths"],
  numWoundeds: ["Woundeds"],
  numWounds: ["Wounds"],
  numTeamKills: ["TKs", "NumTK"],
  healPoints: ["HealPoints"],
  revivedPoints: ["Revived"],
  teamworkScore: ["TeamWork"],
  objectiveScore: ["Objective"],
  combatScore: ["Combat"],
};

export function createBzssCoreMonitorModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.bzssCoreMonitor",
    source: "module.bzssCoreMonitor",
    channel: "module",
  }) ?? core.logger;
  const rawCaptureEnabled = Boolean(config?.get?.("modules.bzssCoreMonitor.rawCapture.enabled", false));
  const rawCaptureMaxBufferedBytes = Number(config?.get?.("modules.bzssCoreMonitor.rawCapture.maxBufferedBytes", 4_194_304) ?? 4_194_304);
  const maxActiveExplosions = Number(config?.get?.("modules.bzssCoreMonitor.maxActiveExplosions", 128) ?? 128);

  const state = createInitialState();
  let started = false;
  const unsubscribers = [];
  let explosionCleanupTimer = null;
  let rawCaptureStream = null;
  let droppedRawCaptureLines = 0;
  let lastRawCaptureWarningAt = 0;
  const rawCapturePath = path.resolve(process.cwd(), RAW_CAPTURE_RELATIVE_PATH);
  let broadcastTimer = null;
  let broadcastPending = false;

  function resetRawCaptureFile() {
    if (!rawCaptureEnabled) return;
    try {
      fs.mkdirSync(path.dirname(rawCapturePath), { recursive: true });
      fs.rmSync(rawCapturePath, { force: true });
    } catch (error) {
      moduleLogger.warn?.("Failed to reset BZSS-Core raw capture file.", {
        operation: "bzssCoreMonitor.rawCapture.resetFailed",
        data: {
          filePath: rawCapturePath,
          error: error?.message ?? String(error),
        },
      });
    }
  }

  function openRawCaptureStream() {
    if (!rawCaptureEnabled || rawCaptureStream) return;
    resetRawCaptureFile();
    rawCaptureStream = fs.createWriteStream(rawCapturePath, { flags: "a", encoding: "utf8" });
    rawCaptureStream.on("error", (error) => {
      moduleLogger.warn?.("BZSS-Core raw capture stream failed.", {
        operation: "bzssCoreMonitor.rawCapture.streamFailed",
        data: { filePath: rawCapturePath, error: error?.message ?? String(error) },
      });
    });
  }

  function appendRawCapture(line) {
    if (!rawCaptureEnabled || !rawCaptureStream) return;
    if (rawCaptureStream.writableLength > rawCaptureMaxBufferedBytes) {
      droppedRawCaptureLines += 1;
      const now = Date.now();
      if (now - lastRawCaptureWarningAt >= 60_000) {
        lastRawCaptureWarningAt = now;
        moduleLogger.warn?.("BZSS-Core raw capture buffer full; dropping debug lines.", {
          operation: "bzssCoreMonitor.rawCapture.backpressure",
          data: { droppedRawCaptureLines, writableLength: rawCaptureStream.writableLength },
        });
      }
      return;
    }
    rawCaptureStream.write(`${JSON.stringify({
      observedAt: new Date().toISOString(),
      rawLine: String(line ?? ""),
    })}\n`);
  }

  const listeners = new Set();
  function subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function publish(mutator) {
    const previousStatus = state.status;
    mutator(state);
    pruneExpiredPlayers(state, { core, modules });
    state.revision += 1;
    state.updatedAt = new Date().toISOString();
    if (state.status !== previousStatus) {
      moduleLogger.info(`BZSS-Core monitor status -> ${state.status}`, {
        operation: "bzssCoreMonitor.status",
        data: {
          status: state.status,
          runtimePlayerCount: state.runtimePlayersByKey.size,
          scoreboardPlayerCount: state.scoreboardPlayersByKey.size,
          lastError: state.lastError,
        },
      });
    }

    for (const listener of listeners) {
      try {
        listener(state);
      } catch (err) {
        // ignore
      }
    }
    broadcastPending = true;
    if (broadcastTimer) return;
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      flushBroadcast();
    }, BZSS_CORE_BROADCAST_INTERVAL_MS);
    if (typeof broadcastTimer.unref === "function") broadcastTimer.unref();
  }

  function flushBroadcast() {
    if (!broadcastPending) return;
    broadcastPending = false;
    core.eventBus?.emitModuleEvent?.("module.bzssCoreMonitor", "stateBroadcast", getState());
  }

  function clearPublishedPlayers(nextStatus, nextError = "") {
    publish((draft) => {
      draft.status = nextStatus;
      draft.runtimePlayersByKey.clear();
      draft.scoreboardPlayersByKey.clear();
      draft.playersByKey.clear();
      draft.playerIdentityIndex.clear();
      draft.markerSeen = false;
      draft.captureZones = [];
      draft.fobs = [];
      draft.mainZones = [];
      draft.explosions = [];
      draft.rawLineHash = "";
      draft.rawFields = [];
      draft.lastError = nextError;
      draft.diagnostics = [];
      draft.priFramesById.clear();
      draft.lastCompletePriFrameId = null;
      draft.lastCompletePriFrameAt = "";
      draft.priFrame = createEmptyPriFrameState();
    });
  }

  function ingestLogLine(input = {}) {
    const line = extractRawLogLine(input);
    if (!line) return { ok: false, ignored: true, reason: "empty" };
    const segments = splitConcatenatedRawLogSegments(line);
    const parsedSegments = segments
      .map((segment) => ({ segment, parsed: parseBzssCoreLogLine(segment) }))
      .filter(({ parsed }) => Boolean(parsed));
    if (parsedSegments.length === 0) return { ok: true, ignored: true, reason: "not_bzss_core" };
    appendRawCapture(line);

    try {
      publish((draft) => {
        draft.status = "ready";
        draft.markerSeen = true;
        draft.rawLineHash = hashText(line);
        draft.lastError = "";

        for (const { segment, parsed } of parsedSegments) {
          if (parsed.rawFields && parsed.rawFields.length > 0) {
            draft.rawFields = parsed.rawFields;
          }

          if (parsed.type === "playerRuntime") {
            if (parsed.runtimePlayers.length > 0) {
              if (parsed.priFrame?.frameId != null) {
                ingestPriFrameChunk(draft, parsed, { publish });
              } else {
                mergeRuntimePlayers(draft, parsed.runtimePlayers, { sourceType: "runtime" });
                draft.priFrame = {
                  frameId: null,
                  complete: null,
                  legacy: true,
                  chunks: null,
                  receivedChunks: [],
                  missingChunks: [],
                  playerCount: parsed.runtimePlayers.length,
                  expectedPlayerCount: null,
                  updatedAt: parsed.priFrame?.updatedAt ?? new Date().toISOString(),
                };
              }
            } else {
              appendDiagnostic(draft, {
                type: "playerRuntime",
                reason: "empty_payload",
                rawLineHash: hashText(segment),
                observedAt: new Date().toISOString(),
              });
            }
            continue;
          }

          if (parsed.type === "playerScoreboard") {
            if (parsed.scoreboardPlayers.length > 0) {
              mergeScoreboardPlayers(draft, parsed.scoreboardPlayers, { sourceType: "scoreboard" });
            } else {
              appendDiagnostic(draft, {
                type: "playerScoreboard",
                reason: "empty_payload",
                rawLineHash: hashText(segment),
                observedAt: new Date().toISOString(),
              });
            }
            continue;
          }

          if (parsed.type === "playerFullBlocks") {
            if (parsed.players.length > 0) {
              mergePlayerFullBlocks(draft, parsed.players);
            } else {
              appendDiagnostic(draft, {
                type: "playerFullBlocks",
                reason: "empty_payload",
                rawLineHash: hashText(segment),
                observedAt: new Date().toISOString(),
              });
            }
            continue;
          }

          if (parsed.type === "scene") {
            draft.captureZones = mergeCaptureZones(draft.captureZones, parsed.captureZones);
            draft.fobs = mergeFobs(draft.fobs, parsed.fobs);
            draft.mainZones = mergeMainZones(draft.mainZones, parsed.mainZones);
            continue;
          }

          if (parsed.type === "captureZones") {
            if (parsed.captureZones.length > 0) {
              draft.captureZones = mergeCaptureZones(draft.captureZones, parsed.captureZones);
            }
            continue;
          }

          if (parsed.type === "fobs") {
            if (parsed.fobs.length > 0) {
              draft.fobs = mergeFobs(draft.fobs, parsed.fobs);
            }
            continue;
          }

          if (parsed.type === "mainZones") {
            if (parsed.mainZones.length > 0) {
              draft.mainZones = mergeMainZones(draft.mainZones, parsed.mainZones);
            }
            continue;
          }

          if (parsed.type === "explosiveDamage") {
            if (!draft.explosions) {
              draft.explosions = [];
            }
            draft.explosions.push({
              ...parsed.explosion,
              expiresAt: Date.now() + 3000,
            });
            if (draft.explosions.length > maxActiveExplosions) {
              draft.explosions.splice(0, draft.explosions.length - maxActiveExplosions);
            }
          }
        }
      });
      return { ok: true, ignored: false, type: parsedSegments[parsedSegments.length - 1]?.parsed?.type };
    } catch (error) {
      publish((draft) => {
        draft.status = "error";
        draft.lastError = error?.message ?? "Failed to parse BZSS-Core log line.";
        draft.rawLineHash = hashText(line);
      });
      return { ok: false, ignored: false, error: error?.message ?? "Failed to parse BZSS-Core log line." };
    }
  }

  function ingestPlayerChunk(chunk, line) {
    try {
      publish((draft) => {
        draft.status = "ready";
        draft.markerSeen = true;
        draft.rawLineHash = hashText(line);
        draft.lastError = "";
        draft.rawFields = ["BZSSCORE", "PS", String(chunk.version ?? "v1")];

        const observedAt = new Date().toISOString();
        for (const player of Array.isArray(chunk.players) ? chunk.players : []) {
          upsertBzssCorePlayerChunkRecord(draft, player, observedAt);
        }
        draft.updatedAt = observedAt;
      });
      appendRawCapture(line);
      scheduleBroadcast();
      return { ok: true, ignored: false, type: "playerChunk" };
    } catch (error) {
      return { ok: false, ignored: false, error: error?.message ?? "Failed to ingest BZSS-Core player chunk." };
    }
  }

  function scheduleBroadcast() {
    broadcastPending = true;
    if (broadcastTimer) return;
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      flushBroadcast();
    }, BZSS_CORE_BROADCAST_INTERVAL_MS);
    if (typeof broadcastTimer.unref === "function") broadcastTimer.unref();
  }

  function parseBzssCorePlayerChunkLine(line) {
    const text = String(line ?? "").trim();
    if (!text.startsWith("BZSSCORE|PS|v1|")) return null;
    const parts = text.split("|");
    if (parts.length < 6) return null;
    const [, , version, seq, tick, ...rest] = parts;
    const payload = rest.join("|");
    if (version !== "v1") return null;
    if (!payload.startsWith("Count=")) return null;
    const [countPart, playersPart = ""] = payload.split("|Players=");
    const count = String(countPart).slice("Count=".length);
    const result = { version, seq, tick, count, players: [] };
    if (!playersPart) return result;
    try {
      const parsed = JSON.parse(playersPart);
      if (Array.isArray(parsed)) {
        result.players = parsed;
      }
    } catch {
      return null;
    }
    return result;
  }

  function parseBzssCoreChunkPosition(rawPlayer) {
    const candidates = [];
    if (rawPlayer && typeof rawPlayer === "object" && !Array.isArray(rawPlayer)) {
      candidates.push(
        rawPlayer.position,
        rawPlayer.pos,
        rawPlayer.location,
        rawPlayer.telemetry?.position,
      );
      if ([rawPlayer.x, rawPlayer.y, rawPlayer.z].every((value) => toNumberOrNull(value) != null)) {
        candidates.push({ x: rawPlayer.x, y: rawPlayer.y, z: rawPlayer.z });
      }
    }
    if (Array.isArray(rawPlayer)) {
      for (const value of rawPlayer) {
        if (value && typeof value === "object") {
          candidates.push(value.position, value.pos, value.location, value);
        }
      }
      // Newer BZSS-Core builds append x/y/z[/yaw] to the compact row.
      if (rawPlayer.length >= 13) {
        const offset = rawPlayer.length - 4;
        const x = toNumberOrNull(rawPlayer[offset]);
        const y = toNumberOrNull(rawPlayer[offset + 1]);
        const z = toNumberOrNull(rawPlayer[offset + 2]);
        if (x != null && y != null && z != null) {
          candidates.push({ x, y, z, yaw: toNumberOrNull(rawPlayer[offset + 3]) });
        }
      }
    }
    for (const candidate of candidates) {
      if (Array.isArray(candidate) && candidate.length >= 3) {
        const x = toNumberOrNull(candidate[0]);
        const y = toNumberOrNull(candidate[1]);
        const z = toNumberOrNull(candidate[2]);
        if (x != null && y != null && z != null) {
          return {
            position: { x, y, z },
            yaw: toNumberOrNull(candidate[3]),
          };
        }
      }
      if (!candidate || typeof candidate !== "object") continue;
      const x = toNumberOrNull(candidate.x ?? candidate.X);
      const y = toNumberOrNull(candidate.y ?? candidate.Y);
      const z = toNumberOrNull(candidate.z ?? candidate.Z);
      if (x == null || y == null || z == null) continue;
      return {
        position: { x, y, z },
        yaw: toNumberOrNull(candidate.yaw ?? candidate.Yaw ?? candidate.rotation?.z),
      };
    }
    return { position: null, yaw: null };
  }

  function upsertBzssCorePlayerChunkRecord(draft, rawPlayer, observedAt) {
    if ((!Array.isArray(rawPlayer) && (!rawPlayer || typeof rawPlayer !== "object")) || rawPlayer.length === 0) return;
    const getField = (index, ...keys) => (Array.isArray(rawPlayer)
      ? rawPlayer[index]
      : keys.map((key) => rawPlayer[key]).find((value) => value != null));
    const playerId = toNumberOrNull(getField(0, "playerId", "playerID", "id", "index"));
    if (playerId == null) return;
    const key = `id:${playerId}`;
    const existing = draft.playersByKey.get(key) ?? createPlaceholderPlayerRecord({ playerId }, observedAt);
    const chunkTelemetry = parseBzssCoreChunkPosition(rawPlayer);
    const chunkName = getField(8, "playerName", "name", "displayName");
    existing.playerId = playerId;
    existing.playerIndex = playerId;
    existing.lastSeenAt = observedAt;
    existing.stale = false;
    existing.sourceTypes = mergeUniqueStrings(existing.sourceTypes, ["bzssCorePlayerChunk"]);
    existing.rawText = JSON.stringify(rawPlayer);
    existing.ping = toNumberOrNull(getField(6, "ping")) ?? existing.ping ?? null;
    existing.ftIndex = toNumberOrNull(getField(8, "ftIndex", "fireTeamIndex")) ?? existing.ftIndex ?? null;
    existing.ftPosition = toNumberOrNull(getField(9, "ftPosition", "fireTeamPosition")) ?? existing.ftPosition ?? null;
    existing.teamId = toNumberOrNull(getField(3, "teamId", "teamID", "team")) ?? existing.teamId ?? null;
    existing.squadId = toNumberOrNull(getField(4, "squadId", "squadID", "squad")) ?? existing.squadId ?? null;
    existing.position = chunkTelemetry.position ?? existing.position ?? null;
    existing.yaw = chunkTelemetry.yaw ?? existing.yaw ?? null;
    existing.presenceHint = "chunk";
    if (chunkName != null && String(chunkName).trim()) {
      existing.playerName = String(chunkName);
    }
    existing.playerScoreboard = existing.playerScoreboard ?? createEmptyScoreboardInfo();
    existing.identityKeys = [key];
    draft.playersByKey.set(key, existing);
    draft.runtimePlayersByKey.set(key, existing);
  }

  function getSnapshotEvent() {
    return {
      state: getState(),
      runtimePlayers: getRuntimePlayers(),
      scoreboardPlayers: getScoreboardPlayers(),
      captureZones: state.captureZones.map(clonePlainObject),
      fobs: state.fobs.map(clonePlainObject),
      mainZones: state.mainZones.map(clonePlainObject),
      explosions: (state.explosions ?? []).map(clonePlainObject),
    };
  }

  function handleRawLogLine(event) {
    ingestLogLine(event);
  }

  function handleBzssCorePlayerChunk(event) {
    return ingestPlayerChunk({
      version: "v1",
      seq: event?.rawEvent?.Seq ?? event?.seq ?? "",
      tick: event?.rawEvent?.Tick ?? "",
      count: event?.rawEvent?.Count ?? "",
      players: event?.rawEvent?.Players ?? [],
    }, "");
  }

  function getState() {
    pruneExpiredPlayers(state, { core, modules });
    const players = getPlayers();
    const coverage = buildBzssCoverageState(state, { core, modules });
    return {
      status: state.status,
      revision: state.revision,
      updatedAt: state.updatedAt,
      markerSeen: state.markerSeen,
      runtimePlayerCount: state.runtimePlayersByKey.size,
      scoreboardPlayerCount: state.scoreboardPlayersByKey.size,
      rconOnlinePlayerCount: coverage.rconOnlinePlayerCount,
      runtimeCoverage: coverage.runtimeCoverage,
      scoreboardCoverage: coverage.scoreboardCoverage,
      playerCount: players.length,
      mainZoneCount: state.mainZones.length,
      rawLineHash: state.rawLineHash,
      rawFields: [...state.rawFields],
      lastError: state.lastError,
      priFrame: clonePriFrameState(state.priFrame),
      diagnostics: state.diagnostics.map(clonePlainObject),
    };
  }

  function getRawSnapshot() {
    pruneExpiredPlayers(state, { core, modules });
    const coverage = buildBzssCoverageState(state, { core, modules });
    return {
      status: state.status,
      revision: state.revision,
      updatedAt: state.updatedAt,
      markerSeen: state.markerSeen,
      runtimePlayerCount: state.runtimePlayersByKey.size,
      scoreboardPlayerCount: state.scoreboardPlayersByKey.size,
      rconOnlinePlayerCount: coverage.rconOnlinePlayerCount,
      runtimeCoverage: coverage.runtimeCoverage,
      scoreboardCoverage: coverage.scoreboardCoverage,
      playerCount: state.playersByKey.size,
      captureZones: state.captureZones.map(clonePlainObject),
      fobs: state.fobs.map(clonePlainObject),
      mainZones: state.mainZones.map(clonePlainObject),
      runtimePlayers: [...state.runtimePlayersByKey.values()].map(clonePlainObject),
      scoreboardPlayers: [...state.scoreboardPlayersByKey.values()].map(clonePlainObject),
      explosions: (state.explosions ?? []).map(clonePlainObject),
      rawLineHash: state.rawLineHash,
      rawFields: [...state.rawFields],
      lastError: state.lastError,
      priFrame: clonePriFrameState(state.priFrame),
      diagnostics: state.diagnostics.map(clonePlainObject),
    };
  }

  function getRuntimePlayers() {
    pruneExpiredPlayers(state, { core, modules });
    return [...state.runtimePlayersByKey.values()].map(clonePlainObject);
  }

  function getScoreboardPlayers() {
    pruneExpiredPlayers(state, { core, modules });
    return [...state.scoreboardPlayersByKey.values()].map(clonePlainObject);
  }

  /**
   * 鑾峰彇鍚堝苟涓旇鑼冨寲鍚庣殑鍦ㄧ嚎鐜╁鍒楄〃銆?
   * 娣卞害铻嶅悎浜嗚繍琛屾椂鐘舵€?(runtimePlayers) 涓庤鍒嗘澘鎸囨爣 (scoreboardPlayers)锛?
   * 纭繚鎻愪緵涓€鑷寸殑 JSDoc/TypeScript 濂戠害缁撴瀯锛屼緵鎴樻湳鍦板浘鍙婃垬鏈洖鏀捐繘琛屾棤宸埆璁块棶銆?
   *
   * @returns {Array<Object>} 瑙勮寖鍖栫殑鐜╁鏁扮粍
   */
  function _legacyGetPlayers() {
    const byIndex = new Map();

    // 1. 鍐欏叆杩愯鏃剁帺瀹舵暟鎹?
    for (const player of state.runtimePlayers) {
      if (player.playerIndex == null && player.playerId == null) continue;
      const key = player.playerIndex ?? player.playerId;

      const position = player.position ? { ...player.position } : null;
      const soldierInfo = player.soldierInfo ? clonePlainObject(player.soldierInfo) : {
        raw: "",
        fields: [],
        values: {},
        soldierClass: "",
        health: 100, // 榛樿濉厖 100 鐢熷懡鍊?
        weaponClass: "",
        ammoValues: [],
        position: position ? { ...position } : null,
        rotation: { x: 0, y: 0, z: player.yaw ?? 0 },
      };

      byIndex.set(key, {
        playerId: player.playerId,
        playerIndex: player.playerIndex,
        playerName: player.playerName ?? "",
        playerGuid: player.playerGuid ?? "",
        teamId: player.teamId ?? null,
        squadId: player.squadId ?? null,
        isAdmin: player.isAdmin ?? null,
        isCommander: player.isCommander ?? null,
        position,
        yaw: player.yaw,
        combatInfo: player.combatInfo ?? "",
        observedAt: player.observedAt,
        stale: player.stale ?? false,
        soldierInfo,
        vehicleInfo: player.vehicleInfo ? clonePlainObject(player.vehicleInfo) : null,
        playerScoreboard: player.playerScoreboard ? clonePlainObject(player.playerScoreboard) : {
          raw: "",
          values: [],
          numericValues: [],
          stats: {
            dataLives: null,
            numKills: 0,
            vehicleKills: 0,
            numDeaths: 0,
            numWoundeds: 0,
            numWounds: 0,
            numTeamKills: 0,
            healPoints: 0,
            revivedPoints: 0,
            teamworkScore: 0,
            objectiveScore: 0,
            combatScore: 0,
          },
        },
        rawText: player.rawText ?? "",
      });
    }

    // 2. 鍚堝苟/鏇存柊璁板垎鏉挎暟鎹?
    for (const player of state.scoreboardPlayers) {
      if (player.playerIndex == null && player.playerId == null) continue;
      const key = player.playerIndex ?? player.playerId;

      const existing = byIndex.get(key);
      const scoreboardInfo = player.playerScoreboard ? clonePlainObject(player.playerScoreboard) : {
        raw: player.raw ?? "",
        values: player.rawFields ?? [],
        numericValues: [],
        stats: {
          dataLives: player.lives,
          numKills: player.kills,
          vehicleKills: player.vehicleKills,
          numDeaths: player.deaths,
          numWoundeds: player.woundeds,
          numWounds: player.wounds,
          numTeamKills: player.teamKills,
          healPoints: player.healPoints,
          revivedPoints: player.revivedPoints,
          teamworkScore: player.teamworkScore,
          objectiveScore: player.objectiveScore,
          combatScore: player.combatScore,
        },
      };

      if (existing) {
        existing.teamId = player.teamId ?? existing.teamId;
        existing.squadId = player.squadId ?? existing.squadId;
        existing.isAdmin = player.isAdmin ?? existing.isAdmin;
        existing.isCommander = player.isCommander ?? existing.isCommander;
        existing.playerScoreboard = scoreboardInfo;
      } else {
        byIndex.set(key, {
          playerId: player.playerId,
          playerIndex: player.playerIndex,
          playerName: player.playerName ?? "",
          playerGuid: player.playerGuid ?? "",
          teamId: player.teamId,
          squadId: player.squadId,
          isAdmin: player.isAdmin,
          isCommander: player.isCommander,
          position: null,
          yaw: null,
          combatInfo: "",
          observedAt: new Date().toISOString(),
          stale: true,
          soldierInfo: {
            raw: "",
            fields: [],
            values: {},
            soldierClass: "",
            health: null,
            weaponClass: "",
            ammoValues: [],
            position: null,
            rotation: null,
          },
          vehicleInfo: null,
          playerScoreboard: scoreboardInfo,
          ping: scoreboardInfo.ping ?? null,
          rawText: player.raw ?? "",
        });
      }
    }

    return [...byIndex.values()];
  }

  function getPlayers() {
    pruneExpiredPlayers(state, { core, modules });
    const templatePlayers = getRconTemplatePlayers(core, modules);
    if (templatePlayers.length > 0) {
      return buildPlayersFromRconTemplate(templatePlayers);
    }

    return getPlayersFromBzssOnly();
  }

  function getPlayersFromBzssOnly() {
    const mergedByKey = new Map();

    for (const player of state.scoreboardPlayersByKey.values()) {
      const key = getCanonicalPlayerKey(player);
      if (!key) continue;
      mergedByKey.set(key, clonePlayerView(player));
    }

    for (const player of state.runtimePlayersByKey.values()) {
      const key = getCanonicalPlayerKey(player);
      if (!key) continue;
      const runtimeView = clonePlayerView(player);
      const existing = mergedByKey.get(key);
      if (existing) {
        mergedByKey.set(key, mergePlayerViews(existing, runtimeView));
      } else {
        mergedByKey.set(key, runtimeView);
      }
    }

    for (const player of state.playersByKey.values()) {
      const key = getCanonicalPlayerKey(player);
      if (!key || mergedByKey.has(key)) continue;
      mergedByKey.set(key, clonePlayerView(player));
    }

    return [...mergedByKey.values()];
  }

  function buildPlayersFromRconTemplate(templatePlayers) {
    const mergedByKey = new Map();
    const index = new Map();

    const addIndexKeys = (player, canonicalKey) => {
      const info = getPlayerIdentityInfo(player);
      for (const key of info.candidateKeys) {
        index.set(key, canonicalKey);
      }
    };

    for (const template of templatePlayers) {
      const view = clonePlayerView(template);
      const key = getCanonicalPlayerKey(view);
      if (!key) continue;
      mergedByKey.set(key, view);
      addIndexKeys(view, key);
    }

    const overlaySources = [
      ...state.scoreboardPlayersByKey.values(),
      ...state.runtimePlayersByKey.values(),
      ...state.playersByKey.values(),
    ];

    for (const overlay of overlaySources) {
      const overlayView = clonePlayerView(overlay);
      const overlayInfo = getPlayerIdentityInfo(overlayView);

      let targetKey = "";
      for (const candidateKey of overlayInfo.candidateKeys) {
        if (index.has(candidateKey)) {
          targetKey = index.get(candidateKey);
          break;
        }
      }

      if (!targetKey) {
        targetKey = getCanonicalPlayerKey(overlayView);
      }
      if (!targetKey) continue;

      const existing = mergedByKey.get(targetKey);
      if (existing) {
        const merged = mergePlayerViews(existing, overlayView);
        mergedByKey.set(targetKey, merged);
        addIndexKeys(merged, targetKey);
      } else {
        mergedByKey.set(targetKey, overlayView);
        addIndexKeys(overlayView, targetKey);
      }
    }

    return [...mergedByKey.values()];
  }

  function getTelemetryPlayers() {
    return getPlayers();
  }

  async function start() {
    if (started) return;
    started = true;
    openRawCaptureStream();
    if (!explosionCleanupTimer) {
      explosionCleanupTimer = setInterval(() => {
        const now = Date.now();
        if (!state.explosions.some((item) => Number(item?.expiresAt ?? Infinity) <= now)) return;
        publish((draft) => {
          draft.explosions = draft.explosions.filter((item) => Number(item?.expiresAt ?? Infinity) > now);
        });
      }, 250);
      explosionCleanupTimer.unref?.();
    }
    if (core.eventBus?.onCoreEvent) {
      unsubscribers.push(core.eventBus.onCoreEvent("On_RawLogLine", handleRawLogLine));
      unsubscribers.push(core.eventBus.onCoreEvent(BZSS_CORE_PLAYER_CHUNK_EVENT_NAME, handleBzssCorePlayerChunk));
      unsubscribers.push(core.eventBus.onCoreEvent("round.world_bring_up", () => {
        publish((draft) => {
          resetPlayerCaches(draft, { keepStatus: "ready" });
        });
      }));
    }
  }

  async function stop() {
    started = false;
    for (const unsubscribe of unsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch {
        // ignore
      }
    }
    if (explosionCleanupTimer) clearInterval(explosionCleanupTimer);
    explosionCleanupTimer = null;
    if (broadcastTimer) clearTimeout(broadcastTimer);
    broadcastTimer = null;
    if (rawCaptureStream) {
      const stream = rawCaptureStream;
      rawCaptureStream = null;
      await new Promise((resolve) => {
        stream.once("finish", resolve);
        stream.once("error", resolve);
        stream.end();
      });
    }
    for (const assembly of state.priFramesById.values()) {
      clearPriFrameTimeout(assembly);
    }
    state.priFramesById.clear();
  }

  return {
    manifest: {
      id: "module.bzssCoreMonitor",
      name: "BZSS-Core Monitor",
      kind: "module",
      version: "0.1.0",
      description: "Monitor BZSS-Core log lines and expose parsed player snapshots.",
    },
    apiName: "bzssCoreMonitor",
    api: {
      getState,
      getRuntimePlayers,
      getScoreboardPlayers,
      getPlayers,
      getTelemetryPlayers,
      getRawSnapshot,
      subscribe,
      ingestLogLine,
      ingestPlayerChunk,
      getRawCapturePath: () => rawCapturePath,
    },
    start,
    stop,
  };
}

function createInitialState() {
  return {
    status: "idle",
    revision: 0,
    updatedAt: "",
    markerSeen: false,
    runtimePlayersByKey: new Map(),
    scoreboardPlayersByKey: new Map(),
    playersByKey: new Map(),
    playerIdentityIndex: new Map(),
    captureZones: [],
    fobs: [],
    mainZones: [],
    explosions: [],
    rawLineHash: "",
    rawFields: [],
    lastError: "",
    priFramesById: new Map(),
    lastCompletePriFrameId: null,
    lastCompletePriFrameAt: "",
    priFrame: createEmptyPriFrameState(),
    diagnostics: [],
  };
}

function createEmptyPriFrameState() {
  return {
    frameId: null,
    complete: null,
    legacy: false,
    chunks: null,
    receivedChunks: [],
    missingChunks: [],
    playerCount: 0,
    expectedPlayerCount: null,
    updatedAt: "",
  };
}

function mergeRuntimePlayers(draft, runtimePlayers, options = {}) {
  const observedAt = options.observedAt ?? new Date().toISOString();
  for (const player of runtimePlayers ?? []) {
    const record = upsertMergedPlayer(draft, {
      ...player,
      sourceType: options.sourceType ?? "runtime",
      observedAt,
    });
    if (!record) continue;
    const key = getCanonicalPlayerKey(record);
    if (!key) continue;
    syncSourceCacheEntry(draft.runtimePlayersByKey, record, key);
  }
}

function mergeScoreboardPlayers(draft, scoreboardPlayers, options = {}) {
  const observedAt = options.observedAt ?? new Date().toISOString();
  for (const player of scoreboardPlayers ?? []) {
    const record = upsertMergedPlayer(draft, {
      ...player,
      sourceType: options.sourceType ?? "scoreboard",
      observedAt,
    });
    if (!record) continue;
    const key = getCanonicalPlayerKey(record);
    if (!key) continue;
    syncSourceCacheEntry(draft.scoreboardPlayersByKey, record, key);
  }
}

function mergePlayerFullBlocks(draft, players, options = {}) {
  const observedAt = options.observedAt ?? new Date().toISOString();
  for (const player of players ?? []) {
    const runtimePatch = {
      playerId: player.playerId,
      playerIndex: player.playerIndex,
      playerName: player.playerName,
      playerGuid: player.playerGuid,
      playerIdText: player.playerIdText,
      position: player.soldierInfo?.position ?? player.position ?? null,
      yaw: player.yaw ?? player.soldierInfo?.rotation?.z ?? null,
      combatInfo: player.claimedInfo || player.soldierInfo?.weaponClass || "",
      presenceHint: player.presenceHint ?? "",
      soldierInfo: player.soldierInfo,
      vehicleInfo: player.vehicleInfo,
      rawText: player.rawText ?? "",
      sourceType: "fullBlocks",
      observedAt,
    };
    const scoreboardPatch = {
      playerId: player.playerId,
      playerIndex: player.playerIndex,
      playerName: player.playerName,
      playerGuid: player.playerGuid,
      teamId: player.teamId,
      squadId: player.squadId,
      isAdmin: player.isAdmin,
      isCommander: player.isCommander,
      fireTeamIndex: player.ftIndex,
      fireTeamPosition: player.ftPosition,
      presenceHint: player.presenceHint ?? "",
      playerScoreboard: player.playerScoreboard,
      rawText: player.rawText ?? "",
      sourceType: "fullBlocks",
      observedAt,
    };
    const record = upsertMergedPlayer(draft, {
      ...runtimePatch,
      ...scoreboardPatch,
    });
    if (!record) continue;
    const key = getCanonicalPlayerKey(record);
    if (key) {
      syncSourceCacheEntry(draft.runtimePlayersByKey, record, key);
      syncSourceCacheEntry(draft.scoreboardPlayersByKey, record, key);
    }
  }
}

function upsertMergedPlayer(draft, patch) {
  const observedAt = String(patch?.observedAt ?? new Date().toISOString());
  const lookupKeyInfo = getPlayerIdentityInfo(patch);
  if (!lookupKeyInfo.key) return null;

  const existingKey = resolvePlayerCanonicalKey(draft, lookupKeyInfo.candidateKeys);
  let record = existingKey ? draft.playersByKey.get(existingKey) ?? null : null;
  if (!record) {
    record = createPlayerRecord(patch, observedAt);
  }

  const previousIdentityKeys = Array.isArray(record.identityKeys) ? [...record.identityKeys] : [];
  const previousCanonicalKey = getCanonicalPlayerKey(record) ?? null;

  applyPlayerPatch(record, patch, observedAt);

  const nextKeyInfo = getPlayerIdentityInfo(record);
  const nextCanonicalKey = nextKeyInfo.key;
  if (!nextCanonicalKey) return null;

  record.identityKeys = nextKeyInfo.candidateKeys;
  record.sourceTypes = mergeUniqueStrings(record.sourceTypes, [patch.sourceType ?? "unknown"]);

  if (previousCanonicalKey && previousCanonicalKey !== nextCanonicalKey) {
    draft.playersByKey.delete(previousCanonicalKey);
  }
  draft.playersByKey.set(nextCanonicalKey, record);
  syncPlayerIdentityIndex(draft, record, previousIdentityKeys, previousCanonicalKey);
  return record;
}

function applyPlayerPatch(record, patch, observedAt) {
  if (record.firstSeenAt == null || record.firstSeenAt === "") {
    record.firstSeenAt = observedAt;
  }
  const isNoPawn = patch.presenceHint === "noPawn";
  record.lastSeenAt = observedAt;
  record.stale = false;
  record.playerId = firstDefinedNumber(patch.playerId, patch.playerIndex, record.playerId);
  record.playerIndex = firstDefinedNumber(patch.playerIndex, patch.playerId, record.playerIndex);
  record.playerName = firstText(patch.playerName, record.playerName, "");
  record.playerGuid = firstText(patch.playerGuid ?? patch.steamID ?? patch.eosID, record.playerGuid, "");
  record.steamID = firstText(patch.steamID, record.steamID, "");
  record.eosID = firstText(patch.eosID, record.eosID, "");
  record.teamId = firstDefinedNumber(patch.teamId, record.teamId, null);
  record.squadId = firstDefinedNumber(patch.squadId, record.squadId, null);
  record.isAdmin = firstDefinedBoolean(patch.isAdmin, record.isAdmin);
  record.isCommander = firstDefinedBoolean(patch.isCommander, record.isCommander);
  record.position = isNoPawn ? null : cloneVector(patch.position ?? record.position);
  record.yaw = isNoPawn ? null : firstDefinedNumber(patch.yaw, record.yaw, null);
  record.combatInfo = firstText(patch.combatInfo, record.combatInfo, "");
  if (Object.prototype.hasOwnProperty.call(patch, "presenceHint")) {
    record.presenceHint = String(patch.presenceHint ?? "").trim();
  } else {
    record.presenceHint = firstText(record.presenceHint, "");
  }
  record.runtimeObservedAt = patch.position != null || patch.yaw != null || patch.combatInfo != null || patch.sourceType === "runtime" || patch.sourceType === "fullBlocks"
    ? observedAt
    : record.runtimeObservedAt ?? "";
  record.scoreboardObservedAt = patch.playerScoreboard || patch.teamId != null || patch.squadId != null || patch.isAdmin != null || patch.isCommander != null || patch.sourceType === "scoreboard" || patch.sourceType === "fullBlocks"
    ? observedAt
    : record.scoreboardObservedAt ?? "";
  record.soldierInfo = patch.soldierInfo ? clonePlainObject(patch.soldierInfo) : (record.soldierInfo ? clonePlainObject(record.soldierInfo) : createEmptySoldierInfo());
  if (isNoPawn) {
    record.soldierInfo.position = null;
    record.soldierInfo.rotation = null;
  }
  record.vehicleInfo = isNoPawn
    ? null
    : (patch.vehicleInfo ? clonePlainObject(patch.vehicleInfo) : (record.vehicleInfo ? clonePlainObject(record.vehicleInfo) : null));
  record.playerScoreboard = patch.playerScoreboard ? clonePlainObject(patch.playerScoreboard) : (record.playerScoreboard ? clonePlainObject(record.playerScoreboard) : createEmptyScoreboardInfo());
  record.ftIndex = firstDefinedNumber(patch.fireTeamIndex ?? patch.ftIndex, record.ftIndex, null);
  record.ftPosition = firstDefinedNumber(patch.fireTeamPosition ?? patch.ftPosition, record.ftPosition, null);
  record.ping = firstDefinedNumber(patch.ping, record.ping, null);
  record.rawText = firstText(patch.rawText, record.rawText, "");
  record.playerBaseInfo = patch.playerBaseInfo ? clonePlainObject(patch.playerBaseInfo) : record.playerBaseInfo ?? null;
  record.sourceTypes = mergeUniqueStrings(record.sourceTypes, [patch.sourceType ?? "unknown"]);
}

function createPlayerRecord(patch, observedAt) {
  return {
    playerId: firstDefinedNumber(patch.playerId, patch.playerIndex, null),
    playerIndex: firstDefinedNumber(patch.playerIndex, patch.playerId, null),
    playerName: firstText(patch.playerName, ""),
    playerGuid: firstText(patch.playerGuid ?? patch.steamID ?? patch.eosID, ""),
    steamID: firstText(patch.steamID, ""),
    eosID: firstText(patch.eosID, ""),
    teamId: firstDefinedNumber(patch.teamId, null),
    squadId: firstDefinedNumber(patch.squadId, null),
    isAdmin: firstDefinedBoolean(patch.isAdmin, null),
    isCommander: firstDefinedBoolean(patch.isCommander, null),
    position: cloneVector(patch.position),
    yaw: firstDefinedNumber(patch.yaw, null),
    combatInfo: firstText(patch.combatInfo, ""),
    presenceHint: firstText(patch.presenceHint, ""),
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
    runtimeObservedAt: patch.sourceType === "runtime" || patch.sourceType === "fullBlocks" ? observedAt : "",
    scoreboardObservedAt: patch.sourceType === "scoreboard" || patch.sourceType === "fullBlocks" ? observedAt : "",
    stale: false,
    sourceTypes: [patch.sourceType ?? "unknown"],
    soldierInfo: patch.soldierInfo ? clonePlainObject(patch.soldierInfo) : createEmptySoldierInfo(),
    vehicleInfo: patch.vehicleInfo ? clonePlainObject(patch.vehicleInfo) : null,
    playerScoreboard: patch.playerScoreboard ? clonePlainObject(patch.playerScoreboard) : createEmptyScoreboardInfo(),
    ftIndex: firstDefinedNumber(patch.fireTeamIndex ?? patch.ftIndex, null),
    ftPosition: firstDefinedNumber(patch.fireTeamPosition ?? patch.ftPosition, null),
    ping: firstDefinedNumber(patch.ping, null),
    rawText: firstText(patch.rawText, ""),
    playerBaseInfo: patch.playerBaseInfo ? clonePlainObject(patch.playerBaseInfo) : null,
    identityKeys: getPlayerIdentityInfo(patch).candidateKeys,
  };
}

function createPlaceholderPlayerRecord(patch, observedAt) {
  return createPlayerRecord(patch, observedAt);
}

function syncSourceCacheEntry(map, record, key) {
  for (const [existingKey, existingRecord] of [...map.entries()]) {
    if (existingRecord !== record) continue;
    if (existingKey === key) continue;
    map.delete(existingKey);
  }
  map.set(key, record);
}

function syncPlayerIdentityIndex(draft, record, previousIdentityKeys = [], previousCanonicalKey = "") {
  const previous = new Set(previousIdentityKeys.map(String));
  const next = new Set((record.identityKeys ?? []).map(String));
  for (const key of previous) {
    if (next.has(key)) continue;
    const current = draft.playerIdentityIndex.get(key);
    if (current === previousCanonicalKey || current === getCanonicalPlayerKey(record)) {
      draft.playerIdentityIndex.delete(key);
    }
  }
  for (const key of next) {
    draft.playerIdentityIndex.set(key, getCanonicalPlayerKey(record));
  }
}

function resolvePlayerCanonicalKey(state, candidateKeys = []) {
  for (const key of candidateKeys) {
    const canonical = state.playerIdentityIndex.get(key);
    if (canonical && state.playersByKey.has(canonical)) return canonical;
  }
  return null;
}

function getCanonicalPlayerKey(player) {
  const info = getPlayerIdentityInfo(player);
  return info.key;
}

function getPlayerIdentityInfo(player) {
  const candidateKeys = [];
  const seen = new Set();
  const push = (value) => {
    if (!value) return;
    const key = String(value);
    if (seen.has(key)) return;
    seen.add(key);
    candidateKeys.push(key);
  };

  const guidValues = [player?.playerGuid, player?.steamID, player?.eosID].map(normalizeIdentityValue).filter(Boolean);
  for (const guid of guidValues) push(`guid:${guid}`);

  const controllerValues = [
    player?.controllerID,
    player?.controllerId,
    player?.playerControllerID,
    player?.playerControllerId,
  ].map(normalizeIdentityValue).filter(Boolean);
  for (const controllerID of controllerValues) push(`controller:${controllerID}`);

  const idValues = [player?.playerIndex, player?.playerId].map(normalizeIdentityValue).filter(Boolean);
  for (const id of idValues) {
    push(`controller:${id}`);
    push(`id:${id}`);
  }

  const name = normalizePlayerName(
    player?.playerName
    ?? player?.name
    ?? player?.currentName
    ?? player?.displayName
  );
  if (name) push(`name:${name}`);

  return {
    key: candidateKeys[0] ?? "",
    candidateKeys,
  };
}

function pruneExpiredPlayers(state, { core, modules } = {}) {
  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const onlinePlayerKeys = getOnlinePlayerIdentityKeySet(core, modules);
  const onlineListAvailable = onlinePlayerKeys instanceof Set;
  const staleThresholdMs = 15000;
  const onlineDeleteThresholdMs = 5 * 60 * 1000;
  const hardDeleteThresholdMs = 10 * 60 * 1000;

  for (const [key, record] of [...state.playersByKey.entries()]) {
    const runtimeObservedMs = parseDateMs(record.runtimeObservedAt || record.lastSeenAt || record.firstSeenAt);
    const lastSeenMs = parseDateMs(record.lastSeenAt || record.firstSeenAt);
    const stale = runtimeObservedMs != null ? nowMs - runtimeObservedMs > staleThresholdMs : nowMs - lastSeenMs > staleThresholdMs;
    record.stale = stale;

    if (onlineListAvailable && isPlayerOnline(record, onlinePlayerKeys)) {
      continue;
    }

    const shouldDeleteByAge = onlineListAvailable
      ? nowMs - lastSeenMs > onlineDeleteThresholdMs
      : nowMs - lastSeenMs > hardDeleteThresholdMs;
    if (!shouldDeleteByAge) continue;

    state.playersByKey.delete(key);
    if (state.runtimePlayersByKey.get(key) === record) state.runtimePlayersByKey.delete(key);
    if (state.scoreboardPlayersByKey.get(key) === record) state.scoreboardPlayersByKey.delete(key);
    for (const identityKey of record.identityKeys ?? []) {
      if (state.playerIdentityIndex.get(identityKey) === key) {
        state.playerIdentityIndex.delete(identityKey);
      }
    }
  }
  return state;
}

function resetPlayerCaches(draft, { keepStatus = "ready" } = {}) {
  draft.status = keepStatus;
  draft.markerSeen = false;
  draft.runtimePlayersByKey.clear();
  draft.scoreboardPlayersByKey.clear();
  draft.playersByKey.clear();
  draft.playerIdentityIndex.clear();
  draft.captureZones = [];
  draft.fobs = [];
  draft.mainZones = [];
  draft.explosions = [];
  draft.rawLineHash = "";
  draft.rawFields = [];
  draft.lastError = "";
  prunePriFrameAssemblies(draft);
  draft.lastCompletePriFrameId = null;
  draft.lastCompletePriFrameAt = "";
  draft.priFrame = createEmptyPriFrameState();
  draft.diagnostics = [];
}

function getOnlinePlayerIdentityKeySet(core, modules) {
  const serverId = String(core?.webStatus?.serverId ?? "").trim();
  if (!serverId) return null;
  const getOnlinePlayers = modules?.playerState?.getOnlinePlayers;
  if (typeof getOnlinePlayers !== "function") return null;
  let players = null;
  try {
    players = getOnlinePlayers(serverId);
  } catch {
    return null;
  }
  if (!Array.isArray(players)) return null;
  const keys = new Set();
  for (const player of players) {
    const info = getPlayerIdentityInfo(player);
    for (const key of info.candidateKeys) {
      keys.add(key);
    }
  }
  return keys;
}

function getRconTemplatePlayers(core, modules) {
  const serverId = String(core?.webStatus?.serverId ?? "").trim();
  if (!serverId) return [];
  const getOnlinePlayers = modules?.playerState?.getOnlinePlayers;
  if (typeof getOnlinePlayers !== "function") return [];

  try {
    const players = getOnlinePlayers(serverId);
    if (!Array.isArray(players)) return [];
    return players.map(createTemplatePlayerFromRcon).filter(Boolean);
  } catch {
    return [];
  }
}

function buildBzssCoverageState(state, { core, modules } = {}) {
  const onlinePlayers = getRconTemplatePlayers(core, modules);
  const expectedCount = onlinePlayers.length > 0 ? onlinePlayers.length : null;
  return {
    rconOnlinePlayerCount: expectedCount,
    runtimeCoverage: buildCoverageEntry(expectedCount, state.runtimePlayersByKey.size),
    scoreboardCoverage: buildCoverageEntry(expectedCount, state.scoreboardPlayersByKey.size),
  };
}

function buildCoverageEntry(expectedCount, actualCount) {
  const actual = Number.isFinite(actualCount) ? Number(actualCount) : 0;
  if (!Number.isFinite(expectedCount) || expectedCount == null) {
    return {
      expectedCount: null,
      actualCount: actual,
      missingCount: null,
      complete: null,
    };
  }
  const expected = Number(expectedCount);
  return {
    expectedCount: expected,
    actualCount: actual,
    missingCount: Math.max(0, expected - actual),
    complete: actual >= expected,
  };
}

function ingestPriFrameChunk(draft, parsed, { publish }) {
  const priFrame = parsed?.priFrame;
  if (!priFrame || priFrame.frameId == null || priFrame.chunkIndex == null || priFrame.chunkCount == null) {
    mergeRuntimePlayers(draft, parsed?.runtimePlayers ?? [], { sourceType: "runtime" });
    return;
  }

  const frameId = String(priFrame.frameId);
  let assembly = draft.priFramesById.get(frameId);
  if (!assembly || assembly.expectedChunkCount !== priFrame.chunkCount) {
    assembly = createPriFrameAssembly(priFrame);
    draft.priFramesById.set(frameId, assembly);
  }

  assembly.updatedAt = priFrame.observedAt ?? new Date().toISOString();
  assembly.totalPlayers = priFrame.totalPlayers ?? assembly.totalPlayers ?? null;
  assembly.expectedChunkCount = priFrame.chunkCount;
  assembly.chunks.set(priFrame.chunkIndex, parsed.runtimePlayers.map(clonePlainObject));
  schedulePriFrameTimeout(assembly, publish);

  const receivedChunks = [...assembly.chunks.keys()].sort((a, b) => a - b);
  const missingChunks = [];
  for (let index = 1; index <= assembly.expectedChunkCount; index += 1) {
    if (!assembly.chunks.has(index)) missingChunks.push(index);
  }

  if (missingChunks.length === 0) {
    clearPriFrameTimeout(assembly);
    const mergedPlayers = [];
    for (let index = 1; index <= assembly.expectedChunkCount; index += 1) {
      mergedPlayers.push(...(assembly.chunks.get(index) ?? []));
    }
    mergeRuntimePlayers(draft, mergedPlayers, { sourceType: "runtime", observedAt: assembly.updatedAt });
    draft.lastCompletePriFrameId = frameId;
    draft.lastCompletePriFrameAt = assembly.updatedAt;
    draft.priFrame = {
      frameId,
      complete: true,
      legacy: false,
      chunks: assembly.expectedChunkCount,
      receivedChunks,
      missingChunks: [],
      playerCount: mergedPlayers.length,
      expectedPlayerCount: assembly.totalPlayers,
      updatedAt: assembly.updatedAt,
    };
    prunePriFrameAssemblies(draft, frameId);
    return;
  }

  draft.priFrame = {
    frameId,
    complete: false,
    legacy: false,
    chunks: assembly.expectedChunkCount,
    receivedChunks,
    missingChunks,
    playerCount: sumPriFramePlayers(assembly),
    expectedPlayerCount: assembly.totalPlayers,
    updatedAt: assembly.updatedAt,
  };
}

function createPriFrameAssembly(priFrame) {
  return {
    frameId: String(priFrame.frameId),
    expectedChunkCount: priFrame.chunkCount,
    totalPlayers: priFrame.totalPlayers ?? null,
    chunks: new Map(),
    receivedAt: priFrame.observedAt ?? new Date().toISOString(),
    updatedAt: priFrame.observedAt ?? new Date().toISOString(),
    timeoutId: null,
  };
}

function schedulePriFrameTimeout(assembly, publish) {
  clearPriFrameTimeout(assembly);
  const timeoutId = setTimeout(() => {
    assembly.timeoutId = null;
    publish((draft) => {
      const currentAssembly = draft.priFramesById.get(assembly.frameId);
      if (!currentAssembly) return;
      const missingChunks = [];
      for (let index = 1; index <= currentAssembly.expectedChunkCount; index += 1) {
        if (!currentAssembly.chunks.has(index)) missingChunks.push(index);
      }
      if (missingChunks.length === 0) return;
      const mergedPlayers = [];
      for (const chunkIndex of [...currentAssembly.chunks.keys()].sort((a, b) => a - b)) {
        mergedPlayers.push(...(currentAssembly.chunks.get(chunkIndex) ?? []));
      }
      if (mergedPlayers.length > 0) {
        mergeRuntimePlayers(draft, mergedPlayers, { sourceType: "runtime", observedAt: currentAssembly.updatedAt });
      }
      draft.priFrame = {
        frameId: currentAssembly.frameId,
        complete: false,
        legacy: false,
        chunks: currentAssembly.expectedChunkCount,
        receivedChunks: [...currentAssembly.chunks.keys()].sort((a, b) => a - b),
        missingChunks,
        playerCount: mergedPlayers.length,
        expectedPlayerCount: currentAssembly.totalPlayers,
        updatedAt: currentAssembly.updatedAt,
      };
      appendDiagnostic(draft, {
        type: "priFrame",
        reason: "timeout_partial",
        frameId: currentAssembly.frameId,
        receivedChunks: [...currentAssembly.chunks.keys()].sort((a, b) => a - b),
        missingChunks,
        playerCount: mergedPlayers.length,
      });
    });
  }, PRI_FRAME_TIMEOUT_MS);
  assembly.timeoutId = timeoutId;
}

function clearPriFrameTimeout(assembly) {
  if (!assembly?.timeoutId) return;
  clearTimeout(assembly.timeoutId);
  assembly.timeoutId = null;
}

function prunePriFrameAssemblies(draft, keepFrameId = "") {
  for (const [frameId, assembly] of [...draft.priFramesById.entries()]) {
    if (frameId === keepFrameId) continue;
    clearPriFrameTimeout(assembly);
    draft.priFramesById.delete(frameId);
  }
}

function sumPriFramePlayers(assembly) {
  let total = 0;
  for (const players of assembly?.chunks?.values?.() ?? []) {
    total += Array.isArray(players) ? players.length : 0;
  }
  return total;
}

function createTemplatePlayerFromRcon(player) {
  if (!player) return null;

  const playerId = toFiniteNumber(player.playerID ?? player.playerId ?? player.controllerID);
  const squadId = toFiniteNumber(player.squadID ?? player.squadId);
  const name = firstText(player.name, player.playerName, player.currentName, player.displayName);
  const steamID = firstText(player.steamID, player.steam64ID);
  const eosID = firstText(player.eosID);
  const controllerID = firstText(player.controllerID, player.playerID, player.playerId);
  const nowIso = new Date().toISOString();

  return {
    playerId,
    playerIndex: playerId,
    controllerID,
    playerName: name,
    playerGuid: firstText(eosID, steamID),
    steamID,
    eosID,
    teamId: toFiniteNumber(player.teamID ?? player.teamId),
    squadId,
    isAdmin: null,
    isCommander: Boolean(player.isLeader && isCommandSquadId(squadId)),
    position: null,
    yaw: null,
    combatInfo: "",
    presenceHint: "rconOnly",
    firstSeenAt: firstText(player.firstSeenAt),
    lastSeenAt: firstText(player.lastSeenTime, player.lastSeenAt, nowIso),
    runtimeObservedAt: "",
    scoreboardObservedAt: "",
    stale: true,
    sourceTypes: ["rconTemplate"],
    soldierInfo: createEmptySoldierInfo(),
    vehicleInfo: null,
    playerScoreboard: createEmptyScoreboardInfo(),
    ftIndex: null,
    ftPosition: null,
    ping: null,
    rawText: player.raw ?? "",
    playerBaseInfo: null,
    identityKeys: [],
    role: firstText(player.role),
    rcon: {
      playerID: player.playerID ?? player.playerId ?? null,
      name,
      steamID,
      eosID,
      controllerID,
      teamID: player.teamID ?? player.teamId ?? null,
      squadID: player.squadID ?? player.squadId ?? null,
      isLeader: Boolean(player.isLeader),
      role: firstText(player.role),
      online: player.online !== false,
    },
  };
}

function isPlayerOnline(record, onlinePlayerKeys) {
  const info = getPlayerIdentityInfo(record);
  return info.candidateKeys.some((key) => onlinePlayerKeys.has(key));
}

function appendDiagnostic(draft, diagnostic) {
  const entry = {
    ...diagnostic,
    observedAt: diagnostic.observedAt ?? new Date().toISOString(),
  };
  draft.diagnostics.push(entry);
  if (draft.diagnostics.length > 50) {
    draft.diagnostics.splice(0, draft.diagnostics.length - 50);
  }
}

function clonePriFrameState(priFrame) {
  return {
    frameId: priFrame?.frameId ?? null,
    complete: priFrame?.complete ?? null,
    legacy: Boolean(priFrame?.legacy),
    chunks: priFrame?.chunks ?? null,
    receivedChunks: Array.isArray(priFrame?.receivedChunks) ? [...priFrame.receivedChunks] : [],
    missingChunks: Array.isArray(priFrame?.missingChunks) ? [...priFrame.missingChunks] : [],
    playerCount: priFrame?.playerCount ?? 0,
    expectedPlayerCount: priFrame?.expectedPlayerCount ?? null,
    updatedAt: priFrame?.updatedAt ?? "",
  };
}

function clonePlayerView(player) {
  const cloned = clonePlainObject(player) ?? {};
  const position = cloned.position ? { ...cloned.position } : null;
  const soldierInfo = cloned.soldierInfo ? clonePlainObject(cloned.soldierInfo) : createEmptySoldierInfo();
  const isNoPawn = cloned.presenceHint === "noPawn";
  if (isNoPawn) {
    soldierInfo.position = null;
    soldierInfo.rotation = null;
  } else {
    if (position && !soldierInfo.position) {
      soldierInfo.position = { ...position };
    }
    if (!soldierInfo.rotation) {
      soldierInfo.rotation = { x: 0, y: 0, z: cloned.yaw ?? 0 };
    }
  }
  const playerScoreboard = cloned.playerScoreboard ? clonePlainObject(cloned.playerScoreboard) : createEmptyScoreboardInfo();
  const hasRuntime = Boolean(cloned.runtimeObservedAt);
  const hasScoreboard = Boolean(cloned.scoreboardObservedAt);
  const presenceState = isNoPawn ? "noPawn" : (hasRuntime ? "active" : (hasScoreboard ? "scoreboardOnly" : (cloned.presenceHint === "rconOnly" ? "rconOnly" : "notSpawned")));
  const stale = isNoPawn ? false : (hasRuntime ? Boolean(cloned.stale) : true);
  return {
    playerId: cloned.playerId ?? null,
    playerIndex: cloned.playerIndex ?? null,
    controllerID: cloned.controllerID ?? "",
    playerName: cloned.playerName ?? "",
    playerGuid: cloned.playerGuid ?? "",
    steamID: cloned.steamID ?? "",
    eosID: cloned.eosID ?? "",
    teamId: cloned.teamId ?? null,
    squadId: cloned.squadId ?? null,
    isAdmin: cloned.isAdmin ?? null,
    isCommander: cloned.isCommander ?? null,
    position,
    yaw: cloned.yaw ?? null,
    combatInfo: cloned.combatInfo ?? "",
    presenceHint: cloned.presenceHint ?? "",
    observedAt: cloned.lastSeenAt ?? cloned.observedAt ?? "",
    firstSeenAt: cloned.firstSeenAt ?? "",
    lastSeenAt: cloned.lastSeenAt ?? "",
    runtimeObservedAt: cloned.runtimeObservedAt ?? "",
    scoreboardObservedAt: cloned.scoreboardObservedAt ?? "",
    stale,
    sourceTypes: Array.isArray(cloned.sourceTypes) ? [...cloned.sourceTypes] : [],
    soldierInfo,
    vehicleInfo: cloned.vehicleInfo ? clonePlainObject(cloned.vehicleInfo) : null,
    playerScoreboard,
    ftIndex: cloned.ftIndex ?? null,
    ftPosition: cloned.ftPosition ?? null,
    ping: cloned.ping ?? playerScoreboard?.ping ?? null,
    rawText: cloned.rawText ?? "",
    playerBaseInfo: cloned.playerBaseInfo ? clonePlainObject(cloned.playerBaseInfo) : null,
    identityKeys: Array.isArray(cloned.identityKeys) ? [...cloned.identityKeys] : [],
    role: cloned.role ?? "",
    rcon: cloned.rcon ? clonePlainObject(cloned.rcon) : null,
    telemetry: {
      position: isNoPawn ? null : (position ? { ...position } : null),
      yaw: isNoPawn ? null : (cloned.yaw ?? null),
      combatInfo: cloned.combatInfo ?? "",
      vehicleInfo: isNoPawn ? null : (cloned.vehicleInfo ? clonePlainObject(cloned.vehicleInfo) : null),
    },
    presence: {
      state: presenceState,
      runtimeObservedAt: cloned.runtimeObservedAt ?? "",
      scoreboardObservedAt: cloned.scoreboardObservedAt ?? "",
    },
  };
}

function mergePlayerViews(base, runtimeView) {
  const merged = clonePlainObject(base) ?? {};
  const runtimeTelemetry = runtimeView?.telemetry ?? {};
  const baseTelemetry = merged.telemetry ?? {};
  const runtimePresence = runtimeView?.presence ?? {};
  const basePresence = merged.presence ?? {};
  const runtimeIsNoPawn = runtimeView?.presenceHint === "noPawn" || runtimePresence.state === "noPawn";
  merged.playerId = firstDefinedNumber(merged.playerId, runtimeView?.playerId);
  merged.playerIndex = firstDefinedNumber(merged.playerIndex, runtimeView?.playerIndex);
  merged.playerName = firstText(merged.playerName, runtimeView?.playerName);
  merged.playerGuid = firstText(merged.playerGuid, runtimeView?.playerGuid);
  merged.steamID = firstText(merged.steamID, runtimeView?.steamID);
  merged.eosID = firstText(merged.eosID, runtimeView?.eosID);
  merged.controllerID = firstText(merged.controllerID, runtimeView?.controllerID);
  merged.role = firstText(merged.role, runtimeView?.role);
  merged.teamId = firstDefinedNumber(runtimeView?.teamId, merged.teamId);
  merged.squadId = firstDefinedNumber(runtimeView?.squadId, merged.squadId);
  merged.isAdmin = firstDefinedBoolean(runtimeView?.isAdmin, merged.isAdmin);
  merged.isCommander = firstDefinedBoolean(runtimeView?.isCommander, merged.isCommander);
  merged.telemetry = {
    position: runtimeIsNoPawn ? null : (runtimeTelemetry.position ?? baseTelemetry.position ?? null),
    yaw: runtimeIsNoPawn ? null : (runtimeTelemetry.yaw ?? baseTelemetry.yaw ?? null),
    combatInfo: firstText(runtimeTelemetry.combatInfo, baseTelemetry.combatInfo, ""),
    vehicleInfo: runtimeIsNoPawn ? null : (runtimeTelemetry.vehicleInfo ?? baseTelemetry.vehicleInfo ?? null),
  };
  merged.position = runtimeIsNoPawn ? null : (merged.telemetry.position ? { ...merged.telemetry.position } : merged.position ?? null);
  merged.yaw = runtimeIsNoPawn ? null : (merged.telemetry.yaw ?? merged.yaw ?? null);
  merged.combatInfo = merged.telemetry.combatInfo ?? merged.combatInfo ?? "";
  if (runtimeView?.vehicleInfo) {
    merged.vehicleInfo = runtimeIsNoPawn ? null : clonePlainObject(runtimeView.vehicleInfo);
  }
  merged.soldierInfo = runtimeView?.soldierInfo ? clonePlainObject(runtimeView.soldierInfo) : merged.soldierInfo ?? createEmptySoldierInfo();
  merged.playerScoreboard = runtimeView?.playerScoreboard ? clonePlainObject(runtimeView.playerScoreboard) : (merged.playerScoreboard ?? createEmptyScoreboardInfo());
  if (runtimeIsNoPawn) {
    merged.soldierInfo.position = null;
    merged.soldierInfo.rotation = null;
  }
  merged.ftIndex = runtimeView?.ftIndex ?? merged.ftIndex ?? null;
  merged.ftPosition = runtimeView?.ftPosition ?? merged.ftPosition ?? null;
  merged.ping = runtimeView?.ping ?? merged.ping ?? merged.playerScoreboard?.ping ?? null;
  merged.sourceTypes = mergeUniqueStrings(merged.sourceTypes, runtimeView?.sourceTypes);
  merged.identityKeys = mergeUniqueStrings(merged.identityKeys, runtimeView?.identityKeys);
  merged.rcon = merged.rcon ? clonePlainObject(merged.rcon) : (runtimeView?.rcon ? clonePlainObject(runtimeView.rcon) : null);
  merged.playerBaseInfo = runtimeView?.playerBaseInfo ? clonePlainObject(runtimeView.playerBaseInfo) : (merged.playerBaseInfo ?? null);
  merged.rawText = firstText(runtimeView?.rawText, merged.rawText, "");
  merged.runtimeObservedAt = runtimeView?.runtimeObservedAt ?? merged.runtimeObservedAt ?? "";
  merged.scoreboardObservedAt = runtimeView?.scoreboardObservedAt ?? merged.scoreboardObservedAt ?? "";
  merged.firstSeenAt = merged.firstSeenAt ?? runtimeView?.firstSeenAt ?? "";
  merged.lastSeenAt = runtimeView?.lastSeenAt ?? merged.lastSeenAt ?? "";
  merged.stale = runtimeIsNoPawn ? false : (runtimePresence.state === "active"
    ? Boolean(runtimeView?.stale ?? false)
    : true);
  merged.presence = {
    state: runtimeIsNoPawn ? "noPawn" : (runtimePresence.state === "active" ? "active" : (runtimePresence.state === "scoreboardOnly" ? "scoreboardOnly" : (basePresence.state ?? "scoreboardOnly"))),
    runtimeObservedAt: runtimeView?.runtimeObservedAt ?? merged.presence?.runtimeObservedAt ?? "",
    scoreboardObservedAt: runtimeView?.scoreboardObservedAt ?? merged.presence?.scoreboardObservedAt ?? basePresence.scoreboardObservedAt ?? "",
  };
  return merged;
}

function createEmptyScoreboardInfo() {
  return {
    raw: "",
    values: [],
    numericValues: [],
    stats: {
      dataLives: null,
      numKills: 0,
      vehicleKills: 0,
      numDeaths: 0,
      numWoundeds: 0,
      numWounds: 0,
      numTeamKills: 0,
      healPoints: 0,
      revivedPoints: 0,
      teamworkScore: 0,
      objectiveScore: 0,
      combatScore: 0,
    },
  };
}

function mergeUniqueStrings(current = [], values = []) {
  const out = [];
  const seen = new Set();
  for (const value of [...current, ...values]) {
    const text = String(value ?? "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function firstText(...values) {
  for (const value of values) {
    const text = normalizeIdentityValue(value);
    if (text) return text;
  }
  return "";
}

function firstDefinedNumber(...values) {
  for (const value of values) {
    const number = toFiniteNumber(value);
    if (number != null) return number;
  }
  return null;
}

function firstDefinedBoolean(...values) {
  for (const value of values) {
    if (value === true || value === false) return value;
    const number = toBooleanNumber(value);
    if (number != null) return number;
  }
  return null;
}

function isCommandSquadId(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "10" || text === "cmd" || text === "command";
}

function cloneVector(value) {
  if (!value) return null;
  return {
    x: toFiniteNumber(value.x),
    y: toFiniteNumber(value.y),
    z: toFiniteNumber(value.z),
  };
}

function normalizeIdentityValue(value) {
  if (value == null) return "";
  return String(value).trim();
}

function normalizePlayerName(value) {
  const text = normalizeIdentityValue(value);
  if (!text) return "";
  return text.replace(/\s+/g, " ").toLowerCase();
}

function detectRuntimePresenceHint({ combatInfo = "", x = null, y = null, z = null } = {}) {
  const hintText = normalizeIdentityValue(combatInfo).toLowerCase();
  if (hintText.includes("nopawn") && (x == null || y == null || z == null)) {
    return "noPawn";
  }
  return "";
}

function parseDateMs(value) {
  const ms = Date.parse(String(value ?? ""));
  return Number.isFinite(ms) ? ms : null;
}

export function extractBzssCoreTrackedText(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
  const startIndex = findFirstBufferIndex(data, [START_NEEDLE, PRI_START_NEEDLE]);
  if (startIndex < 0) {
    const fallbackText = extractRelevantUtf16Runs(data);
    if (fallbackText.text) return fallbackText;
    return {
      text: "",
      markerSeen: false,
      error: "PlayerBaseInfo or PRI block was not found.",
    };
  }

  const contextStart = findBzssCoreContextStart(data, startIndex);
  const markerIndex = data.lastIndexOf(MARKER_NEEDLE);
  const endIndex = markerIndex >= 0 ? markerIndex + MARKER_NEEDLE.length : data.length;
  const text = data.subarray(contextStart, endIndex).toString("utf16le").replace(/\u0000+$/g, "");
  if (!text.includes("SoldierInfo{") || !text.includes("PlayerScoreboard{")) {
    const fallbackText = extractRelevantUtf16Runs(data);
    if (fallbackText.text) return fallbackText;
  }
  return {
    text,
    markerSeen: markerIndex >= 0 && text.includes(MARKER),
    error: "",
  };
}

export function parseBzssCorePlayerBlocks(text) {
  const source = String(text ?? "");
  const players = [];
  const pattern = /PlayerBaseInfo\{([^}]*)\}/g;
  let match = null;
  while ((match = pattern.exec(source)) !== null) {
    const baseRaw = String(match[1] ?? "");
    const segmentStart = pattern.lastIndex;
    const nextBaseIndex = source.indexOf("PlayerBaseInfo{", segmentStart);
    const segmentEnd = nextBaseIndex >= 0 ? nextBaseIndex : source.length;
    const segment = source.slice(segmentStart, segmentEnd);
    const contextStart = findPlayerContextStart(source, match.index);
    const context = source.slice(contextStart, match.index);
    const soldierBlock = findNamedBlock(segment, "SoldierInfo");
    const scoreboardBlock = findNamedBlock(segment, "PlayerScoreboard");
    if (!scoreboardBlock) continue;
    const soldierRaw = soldierBlock?.content ?? "";
    const scoreboardRaw = scoreboardBlock.content;
    const baseFields = splitTopLevelCsv(baseRaw);
    const baseMap = parseKeyValueFields(baseFields);
    const seatsBlock = findNamedBlock(segment, "SeatsPlayers");
    const vehicleInfo = parseVehicleInfo(segment);
    const scoreboardInfo = parseScoreboardInfo(scoreboardRaw);
    const soldierInfo = soldierRaw ? parseSoldierInfo(soldierRaw) : { summary: createEmptySoldierInfo() };
    if (!soldierInfo.summary.position && vehicleInfo.position) {
      soldierInfo.summary.position = vehicleInfo.position;
      soldierInfo.summary.rotation = vehicleInfo.rotation;
    }
    const teamAndSquadInfo = parseTeamAndSquadInfo(context, segment, baseMap, baseFields);
    players.push({
      playerId: toFiniteNumber(baseMap.PlayerID ?? baseFields[0]),
      playerIndex: toFiniteNumber(baseMap.PlayerID ?? baseFields[0]),
      playerName: baseMap.PlayerName ?? baseFields[2] ?? "",
      playerGuid: baseMap.PlayerOnlineID ?? baseFields[1] ?? "",
      teamId: teamAndSquadInfo.teamId,
      squadId: teamAndSquadInfo.squadId,
      isAdmin: toBooleanNumber(baseMap.IsAdmin),
      isCommander: toBooleanNumber(baseMap.IsCommander),
      ftIndex: toFiniteNumber(baseMap.FTIndex),
      ftPosition: toFiniteNumber(baseMap.FTPosition),
      claimedInfo: segment.includes("{NoExistingClaimedInfo}") ? "NoExistingClaimedInfo" : "",
      seatsPlayers: seatsBlock ? splitTopLevelCsv(seatsBlock.content).filter(Boolean) : [],
      vehicleInfo,
      playerBaseInfo: {
        raw: baseRaw,
        fields: baseFields,
        values: baseMap,
      },
      soldierInfo: soldierInfo.summary,
      playerScoreboard: {
        ...scoreboardInfo,
      },
      rawText: source.slice(match.index, segmentEnd),
    });
  }
  return players;
}

export function parseBzssCoreLogLine(line) {
  const text = String(line ?? "");
  if (text.includes("PRIFrame{")) return parsePriFrameRuntimeLine(text);
  if (text.includes("PRI{{")) return parsePriRuntimePlayerLine(text);
  if (/\{?\s*ID\s*:\s*-?\d+\s*,\s*Pos\s*:/i.test(text)) return parseBzssCorePieRuntimeLine(text);
  if (isCompactBzssRuntimeLine(text)) return parseCompactBzssRuntimeLine(text);
  if (text.includes("PlayerBaseInfo{") && text.includes("SoldierInfo{") && text.includes("PlayerScoreboard{")) {
    const players = parseBzssCorePlayerBlocks(text);
    return {
      type: "playerFullBlocks",
      players,
      rawFields: [],
    };
  }
  if (text.includes("PlayerBaseInfo{")) return parseRuntimePlayerLine(text);
  if (text.includes("PlayerScoreboard{")) return parseScoreboardPlayerLine(text);
  if (text.includes("CaptureZones{")) {
    return {
      type: "captureZones",
      captureZones: parseCaptureZones(text),
      rawFields: [],
    };
  }
  if (text.includes("FOBs{")) {
    return {
      type: "fobs",
      fobs: parseFobs(text),
      rawFields: [],
    };
  }
  if (text.includes("MainZones{")) {
    return {
      type: "mainZones",
      mainZones: parseMainZones(text),
      rawFields: [],
    };
  }
  if (text.includes("CPZ:") && text.includes(",FOBI:") && text.includes(",MainZone:")) return parseSceneInfoLine(text);
  if (text.includes("ApplyExplosiveDamage():")) {
    return parseExplosiveDamageLine(text);
  }
  return null;
}

function parsePriRuntimeRows(rows, observedAt, rawPrefix = "PRI{{") {
  const runtimePlayers = [];
  for (const row of rows) {
    const raw = String(row ?? "").trim().replace(/^\{+/, "").replace(/}+$/g, "");
    const fields = splitTopLevelCsv(raw);
    const playerId = toFiniteNumber(fields[0]);
    if (playerId == null) continue;
    const x = toFiniteNumber(fields[1]);
    const y = toFiniteNumber(fields[2]);
    const z = toFiniteNumber(fields[3]);
    const combatInfo = fields.slice(5).join(",");

    runtimePlayers.push({
      playerId,
      playerIndex: playerId,
      position: x == null || y == null || z == null ? null : {
        x: x * 100,
        y: y * 100,
        z: z * 100,
      },
      yaw: toFiniteNumber(fields[4]),
      combatInfo,
      presenceHint: detectRuntimePresenceHint({ combatInfo, x, y, z }),
      observedAt,
      stale: false,
      rawText: rawPrefix === "PRI{{" ? `PRI{{${raw}}}` : `PRIFrame{{${raw}}}`,
    });
  }
  return runtimePlayers;
}

function parseBzssCorePieRuntimeLine(text) {
  const source = String(text ?? "");
  const observedAt = new Date().toISOString();
  const rowPattern = /\{\s*ID\s*:\s*(-?\d+)\s*,\s*Pos\s*:\s*([^,}]+(?:\s*,\s*[^,}]+){0,3})(?:\s*,\s*(CI\s*\{[^}]*\}|\{[^}]*\}))?\s*\}/gi;
  const runtimePlayers = [];
  for (const match of source.matchAll(rowPattern)) {
    const playerId = Number(match[1]);
    const posTokens = String(match[2] ?? "").split(",").map((value) => value.trim());
    const invalidPawn = /^InvalidPawn$/i.test(posTokens[0] ?? "");
    const x = toFiniteNumber(posTokens[0]);
    const y = toFiniteNumber(posTokens[1]);
    const z = toFiniteNumber(posTokens[2]);
    const yaw = toFiniteNumber(posTokens[3]);
    const position = !invalidPawn && x != null && y != null && z != null
      ? { x: x * COMPACT_RUNTIME_POSITION_SCALE, y: y * COMPACT_RUNTIME_POSITION_SCALE, z: z * COMPACT_RUNTIME_POSITION_SCALE }
      : null;
    const combatInfo = String(match[3] ?? "").trim();
    const soldierInfo = /^CI\s*\{/i.test(combatInfo)
      ? parseCompactRuntimeSoldierInfo(combatInfo)
      : createEmptySoldierInfo();
    runtimePlayers.push({
      playerId,
      playerIndex: playerId,
      position,
      yaw: invalidPawn ? null : yaw,
      combatInfo,
      presenceHint: invalidPawn ? "noPawn" : "",
      observedAt,
      stale: false,
      soldierInfo,
      rawText: match[0],
    });
  }
  return { type: "playerRuntime", runtimePlayers, rawFields: [] };
}

function isCompactBzssRuntimeLine(text) {
  const source = String(text ?? "");
  if (!/\{?\s*ID\s*:\s*-?\d+/i.test(source) || !/Pos\s*:/i.test(source)) {
    return false;
  }
  const rows = splitCompactRuntimeRows(source);
  return rows.some((row) => parseCompactRuntimeRow(row) != null);
}

function splitCompactRuntimeRows(text) {
  const source = String(text ?? "");
  const first = source.search(/\{?\s*ID\s*:/i);
  if (first < 0) return [];

  const payload = source.slice(first)
    .replace(/\\n/g, "/n/")
    .replace(/\r?\n/g, "/n/");

  return payload
    .split("/n/")
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => row.startsWith("{") ? row : `{${row}`)
    .map((row) => row.endsWith("}") ? row : `${row}}`);
}

function parseCompactRuntimeSoldierInfo(rawText) {
  const source = String(rawText ?? "");
  const block = findNamedBlock(source, "CI");
  if (!block) {
    return createEmptySoldierInfo();
  }

  const fields = splitTopLevelCsv(block.content);
  return {
    raw: `CI{${block.content}}`,
    fields,
    values: {},
    soldierClass: fields[0] ?? "",
    health: toFiniteNumber(fields[1]),
    weaponClass: fields[2] && fields[2] !== "NoWeapon" ? fields[2] : "",
    ammoValues: fields.slice(3).map(toFiniteNumber).filter((value) => value != null),
    position: null,
    rotation: null,
  };
}

function parseCompactRuntimeAnonymousInfo(rawText) {
  const source = String(rawText ?? "").trim();
  if (!source.startsWith("{") || !source.endsWith("}")) return null;

  const content = source.slice(1, -1);
  const fields = splitTopLevelCsv(content);
  const stateCode = toFiniteNumber(fields[0]);
  const healthText = String(fields[1] ?? "").trim();
  let health = null;
  let maxHealth = null;
  if (healthText) {
    const [nextHealth, nextMaxHealth] = healthText.split("/").map(toFiniteNumber);
    health = nextHealth;
    maxHealth = nextMaxHealth;
  }

  return {
    raw: source,
    fields,
    stateCode,
    healthText,
    health,
    maxHealth,
    vehicleType: String(fields[2] ?? "").trim(),
    seatIndex: toFiniteNumber(fields[3]),
  };
}

function parseCompactRuntimeRow(row) {
  const normalized = String(row ?? "").trim();
  if (!normalized) return null;

  const raw = normalized.startsWith("{") ? normalized.slice(1) : normalized;
  const rowText = raw.endsWith("}") ? raw.slice(0, -1) : raw;
  const fields = splitTopLevelCsv(rowText);
  const playerIdField = fields.find((field) => /^ID\s*:/i.test(field));
  const playerId = toFiniteNumber(playerIdField?.split(":")?.slice(1).join(":"));
  if (playerId == null) return null;

  const posFieldIndex = fields.findIndex((field) => /^Pos\s*:/i.test(field));
  if (posFieldIndex < 0) return null;

  const posTokens = [];
  const tailTokens = [];
  const firstPosToken = String(fields[posFieldIndex] ?? "").replace(/^Pos\s*:/i, "").trim();
  if (firstPosToken) posTokens.push(firstPosToken);

  for (const token of fields.slice(posFieldIndex + 1)) {
    const text = String(token ?? "").trim();
    if (!text) continue;
    if (/^CI\s*\{/i.test(text) || text.startsWith("{")) {
      tailTokens.push(text);
      continue;
    }
    if (tailTokens.length > 0) {
      tailTokens.push(text);
      continue;
    }
    posTokens.push(text);
  }

  const posValue = posTokens.join(",");
  const invalidPawn = posTokens[0]?.toLowerCase() === "invalidpawn";
  const combatInfoToken = tailTokens.find((token) => /^CI\s*\{/i.test(token)) ?? "";
  const anonymousInfoToken = tailTokens.find((token) => token.startsWith("{")) ?? "";
  const combatInfo = combatInfoToken || anonymousInfoToken || "";
  const anonymousInfo = combatInfoToken ? null : parseCompactRuntimeAnonymousInfo(anonymousInfoToken);
  const soldierInfo = combatInfoToken
    ? parseCompactRuntimeSoldierInfo(combatInfoToken)
    : createEmptySoldierInfo();

  let position = null;
  let yaw = null;
  if (!invalidPawn) {
    const x = toFiniteNumber(posTokens[0]);
    const y = toFiniteNumber(posTokens[1]);
    const z = toFiniteNumber(posTokens[2]);
    const nextYaw = toFiniteNumber(posTokens[3]);
    if (x != null && y != null && z != null) {
      position = {
        x: x * COMPACT_RUNTIME_POSITION_SCALE,
        y: y * COMPACT_RUNTIME_POSITION_SCALE,
        z: z * COMPACT_RUNTIME_POSITION_SCALE,
      };
      yaw = nextYaw;
    }
  }

  return {
    playerId,
    playerIndex: playerId,
    position,
    yaw,
    combatInfo,
    presenceHint: invalidPawn ? "noPawn" : "",
    soldierInfo,
    compactStateInfo: anonymousInfo,
    rawText: normalized,
  };
}

function parseCompactRuntimeRows(rows, observedAt) {
  const runtimePlayers = [];
  for (const row of rows) {
    const parsedRow = parseCompactRuntimeRow(row);
    if (!parsedRow) continue;

    runtimePlayers.push({
      ...parsedRow,
      observedAt,
      stale: false,
    });
  }
  return runtimePlayers;
}

function parseCompactBzssRuntimeLine(text) {
  const source = String(text ?? "");
  const observedAt = new Date().toISOString();
  const rows = splitCompactRuntimeRows(source);
  const runtimePlayers = parseCompactRuntimeRows(rows, observedAt);
  return {
    type: "playerRuntime",
    runtimePlayers,
    rawFields: [],
  };
}

function parsePriFrameHeader(headerText) {
  const frameId = firstText(matchPriFrameValue(headerText, "Frame"));
  const round = firstText(matchPriFrameValue(headerText, "Round"));
  const chunkText = firstText(matchPriFrameValue(headerText, "Chunk"));
  const chunksText = firstText(matchPriFrameValue(headerText, "Chunks"));
  const count = toFiniteNumber(matchPriFrameValue(headerText, "Count"));
  const total = toFiniteNumber(matchPriFrameValue(headerText, "Total"));

  let chunkIndex = null;
  let chunkCount = null;
  const inlineChunkMatch = chunkText.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (inlineChunkMatch) {
    chunkIndex = Number(inlineChunkMatch[1]);
    chunkCount = Number(inlineChunkMatch[2]);
  } else {
    chunkIndex = toFiniteNumber(chunkText);
    chunkCount = toFiniteNumber(chunksText);
  }

  if (!frameId || chunkIndex == null || chunkCount == null) return null;
  return {
    frameId,
    round,
    chunkIndex,
    chunkCount,
    count,
    totalPlayers: total,
  };
}

function matchPriFrameValue(headerText, key) {
  const match = String(headerText ?? "").match(new RegExp(`${key}=([^,}]+)`));
  return match ? match[1].trim() : "";
}

function buildPriFrameMeta(meta, observedAt, parsedCount = null) {
  return {
    frameId: meta.frameId,
    round: meta.round,
    chunkIndex: meta.chunkIndex,
    chunkCount: meta.chunkCount,
    count: meta.count ?? parsedCount,
    totalPlayers: meta.totalPlayers,
    observedAt,
    legacy: false,
  };
}

function parsePriFrameRuntimeLine(text) {
  const source = String(text ?? "");
  const observedAt = new Date().toISOString();
  const start = source.indexOf("PRIFrame{");
  if (start < 0) {
    return {
      type: "playerRuntime",
      runtimePlayers: [],
      rawFields: [],
    };
  }

  const headerStart = start + "PRIFrame{".length;
  const headerEnd = source.indexOf("}", headerStart);
  if (headerEnd < 0) {
    return {
      type: "playerRuntime",
      runtimePlayers: [],
      rawFields: [],
    };
  }

  const headerText = source.slice(headerStart, headerEnd);
  const meta = parsePriFrameHeader(headerText);
  const payloadStart = source.indexOf("{{", headerEnd);
  if (payloadStart < 0) {
    return {
      type: "playerRuntime",
      runtimePlayers: [],
      rawFields: [],
      priFrame: meta ? buildPriFrameMeta(meta, observedAt) : null,
    };
  }

  const rows = extractBraceItems(`{${source.slice(payloadStart + 2)}`);
  const runtimePlayers = parsePriRuntimeRows(rows, observedAt, "PRIFrame{{");
  return {
    type: "playerRuntime",
    runtimePlayers,
    rawFields: [],
    priFrame: meta ? buildPriFrameMeta(meta, observedAt, runtimePlayers.length) : null,
  };
}

function parseExplosiveDamageLine(text) {
  const locMatch = text.match(/ExplosionLocation=V\(X=([-0-9.]+),\s*Y=([-0-9.]+),\s*Z=([-0-9.]+)\)/);
  const causerMatch = text.match(/DamageCauser=([^ ]+)/);
  const instigatorMatch = text.match(/DamageInstigator=([^ ]+)/);
  if (!locMatch) return null;

  return {
    type: "explosiveDamage",
    explosion: {
      id: "exp-" + Math.random().toString(36).slice(2, 11),
      x: parseFloat(locMatch[1]),
      y: parseFloat(locMatch[2]),
      z: parseFloat(locMatch[3]),
      damageCauser: causerMatch ? causerMatch[1] : "",
      damageInstigator: instigatorMatch ? instigatorMatch[1] : "",
      at: new Date().toISOString(),
    },
    rawFields: [],
  };
}

function parseRuntimePlayerLine(text) {
  const block = extractLineBlock(text, "PlayerBaseInfo");
  const raw = block?.content ?? "";
  if (!raw.trim()) {
    return {
      type: "playerRuntime",
      runtimePlayers: [],
      rawFields: [],
    };
  }

  const items = extractBraceItems(raw);
  const rows = items.length > 0 ? items : [raw];
  const observedAt = new Date().toISOString();
  const runtimePlayers = rows
    .map((row) => {
      const fields = splitTopLevelCsv(row);
      const x = toFiniteNumber(fields[1]);
      const y = toFiniteNumber(fields[2]);
      const z = toFiniteNumber(fields[3]);
      const combatInfo = fields.slice(5).join(",");
      return {
        playerId: toFiniteNumber(fields[0]),
        playerIndex: toFiniteNumber(fields[0]),
        position: x == null || y == null || z == null ? null : {
          x: x * 100,
          y: y * 100,
          z: z * 100,
        },
        yaw: toFiniteNumber(fields[4]),
        combatInfo,
        presenceHint: detectRuntimePresenceHint({ combatInfo, x, y, z }),
        observedAt,
        stale: false,
      };
    })
    .filter((player) => player.playerId != null);

  return {
    type: "playerRuntime",
    runtimePlayers,
    rawFields: [],
  };
}

function parsePriRuntimePlayerLine(text) {
  const source = String(text ?? "");
  const observedAt = new Date().toISOString();
  const start = source.indexOf("PRI{{");
  if (start < 0) {
    return {
      type: "playerRuntime",
      runtimePlayers: [],
      rawFields: [],
    };
  }

  const rows = extractBraceItems(`{${source.slice(start + 5)}`);
  const runtimePlayers = parsePriRuntimeRows(rows, observedAt, "PRI{{");

  return {
    type: "playerRuntime",
    runtimePlayers,
    rawFields: [],
    priFrame: {
      frameId: null,
      chunkIndex: null,
      chunkCount: null,
      totalPlayers: null,
      observedAt,
      legacy: true,
    },
  };
}

function parseScoreboardPlayerLine(text) {
  const raw = extractCompactLineTail(text, "PlayerScoreboard");
  if (!raw.trim()) {
    return {
      type: "playerScoreboard",
      scoreboardPlayers: [],
      rawFields: [],
    };
  }

  const rowTexts = extractScoreboardRows(raw);
  const scoreboardPlayers = rowTexts
    .map((row) => parseLogScoreboardRow(row))
    .filter(Boolean);

  return {
    type: "playerScoreboard",
    scoreboardPlayers,
    rawFields: scoreboardPlayers.flatMap((player) => player.rawFields ?? []),
  };
}

function parseLogScoreboardRow(row) {
  const raw = String(row ?? "").trim().replace(/}+$/g, "");
  if (!raw) return null;
  const originalFields = splitTopLevelCsv(raw);
  const rawFields = repairScoreboardFields(originalFields);
  const numericValues = rawFields.map(toFiniteNumber);
  const scoreboardInfo = buildScoreboardInfoFromCompactRow(raw, rawFields, numericValues);
  const hasGluedBooleanField = originalFields.length === 18;
  const statIndex = COMPACT_SCOREBOARD_STAT_INDEX;
  const player = {
    playerId: numericValues[0] ?? null,
    playerIndex: numericValues[0] ?? null,
    teamId: numericValues[1] ?? null,
    squadId: numericValues[2] ?? null,
    lives: statIndex.dataLives != null ? (numericValues[statIndex.dataLives] ?? null) : null,
    kills: numericValues[statIndex.numKills] ?? null,
    vehicleKills: numericValues[statIndex.vehicleKills] ?? null,
    deaths: numericValues[statIndex.numDeaths] ?? null,
    woundeds: numericValues[statIndex.numWoundeds] ?? null,
    wounds: numericValues[statIndex.numWounds] ?? null,
    teamKills: numericValues[statIndex.numTeamKills] ?? null,
    healPoints: numericValues[statIndex.healPoints] ?? null,
    revivedPoints: numericValues[statIndex.revivedPoints] ?? null,
    teamworkScore: numericValues[statIndex.teamworkScore] ?? null,
    objectiveScore: numericValues[statIndex.objectiveScore] ?? null,
    combatScore: numericValues[statIndex.combatScore] ?? null,
    isAdmin: toScoreboardBoolean(numericValues[14]),
    // Compact rows with a glued 00/01/02 tail are not stable enough to trust for commander detection.
    isCommander: hasGluedBooleanField ? null : toScoreboardBoolean(numericValues[15]),
    fireTeamIndex: numericValues[16] ?? null,
    fireTeamPosition: numericValues[17] ?? null,
    ping: numericValues[18] ?? null,
    raw,
    rawFields,
    playerScoreboard: scoreboardInfo,
  };
  return player;
}

function extractScoreboardRows(raw) {
  const source = String(raw ?? "").trim();
  if (!source) return [];
  if (!source.startsWith("{") && source.includes("}{")) {
    return source.replace(/}+$/g, "").split("}{");
  }
  const rows = extractBraceItems(source);
  if (rows.length > 0) return rows;
  const repairedFields = repairScoreboardFields(splitTopLevelCsv(source.replace(/}+$/g, "")));
  if (repairedFields.length > 19 && repairedFields.length % 19 === 0) {
    const chunkedRows = [];
    for (let index = 0; index < repairedFields.length; index += 19) {
      chunkedRows.push(repairedFields.slice(index, index + 19).join(","));
    }
    return chunkedRows;
  }
  return [source];
}

function repairScoreboardFields(rawFields) {
  const out = [];
  for (const field of rawFields) {
    const text = String(field ?? "").trim();
    const glued = text.match(/^(-?\d+)(-\d+)$/);
    if (glued) {
      out.push(glued[1], glued[2]);
      continue;
    }
    out.push(text);
  }
  if (
    out.length === 18
    && /^[01]-?\d+$/.test(String(out[15] ?? ""))
    && /^-?\d+$/.test(String(out[16] ?? ""))
    && /^-?\d+$/.test(String(out[17] ?? ""))
  ) {
    const text = String(out[15]);
    const cmdr = text[0];
    const ftIdx = text.slice(1);
    out.splice(15, 1, cmdr, ftIdx);
  }
  return out;
}

const COMPACT_SCOREBOARD_STAT_INDEX = {
  dataLives: null,
  numKills: 3,
  vehicleKills: 4,
  numDeaths: 5,
  numWoundeds: 6,
  numWounds: 7,
  numTeamKills: 8,
  healPoints: 9,
  revivedPoints: 10,
  teamworkScore: 11,
  objectiveScore: 12,
  combatScore: 13,
};

function buildScoreboardInfoFromCompactRow(raw, values, numericValues) {
  const stats = {};
  const labeledValues = SCOREBOARD_FIELDS.map(([key, label]) => {
    const value = numericValues[COMPACT_SCOREBOARD_STAT_INDEX[key]] ?? null;
    stats[key] = value;
    return { key, label, value };
  });

  return {
    raw,
    values,
    numericValues,
    ping: numericValues[18] ?? null,
    stats,
    labeledValues,
    extraValues: numericValues.slice(15),
  };
}

function parseSceneInfoLine(text) {
  return {
    type: "scene",
    captureZones: parseCompactCaptureZones(text),
    fobs: parseCompactFobs(text),
    mainZones: parseMainZones(text),
    rawFields: [],
  };
}

export function parseCaptureZones(text) {
  const source = String(text ?? "");
  const block = findNamedBlock(source, "CaptureZones");
  if (!block) return [];
  const zones = [];
  const zonePattern = /CaptureZone\{([^}]*)\}/g;
  let match = null;
  while ((match = zonePattern.exec(block.content)) !== null) {
    const raw = String(match[1] ?? "");
    const name = raw.split(",")[0]?.trim() ?? "";
    const positionMatch = raw.match(/Position:X=([-0-9.]+)\s+Y=([-0-9.]+)\s+Z=([-0-9.]+)/);
    zones.push({
      name,
      position: positionMatch ? {
        x: toFiniteNumber(positionMatch[1]) * 100,
        y: toFiniteNumber(positionMatch[2]) * 100,
        z: toFiniteNumber(positionMatch[3]) * 100,
      } : null,
      raw,
    });
  }
  return zones.filter((zone) => zone.name);
}

export function parseFobs(text) {
  const source = String(text ?? "");
  const block = findNamedBlock(source, "FOBs");
  if (!block) return [];
  const fobs = [];
  const fobPattern = /FobInfo\{([^}]*)\}/g;
  let match = null;
  while ((match = fobPattern.exec(block.content)) !== null) {
    const raw = String(match[1] ?? "");
    const fields = splitTopLevelCsv(raw);
    const map = parseKeyValueFields(fields);
    const posVal = map.Position;
    let position = null;
    if (posVal) {
      const positionMatch = posVal.match(/X=([-0-9.]+)\s+Y=([-0-9.]+)\s+Z=([-0-9.]+)/);
      if (positionMatch) {
        position = {
          x: toFiniteNumber(positionMatch[1]) * 100,
          y: toFiniteNumber(positionMatch[2]) * 100,
          z: toFiniteNumber(positionMatch[3]) * 100,
        };
      }
    }
    fobs.push({
      teamId: toFiniteNumber(map.TeamID),
      health: toFiniteNumber(map.Health),
      isBleeding: map.IsBleeding === "true",
      ammo: toFiniteNumber(map.Ammo),
      construction: toFiniteNumber(map.Construction),
      name: map.Name ?? "",
      position,
      raw,
    });
  }
  return fobs;
}

function parseCompactCaptureZones(text) {
  const section = extractDelimitedSceneSection(text, "CPZ:", ",FOBI:");
  if (!section) return [];
  return extractBraceItems(section).map((raw) => {
    const fields = splitTopLevelCsv(raw);
    const position = parseCompactSceneVector(fields.slice(1).join(","));
    return {
      name: fields[0] ?? "",
      position,
      isLocked: parseBooleanText(fields[2]),
      capturePercent: toFiniteNumber(fields[3]),
      captureDirection: toFiniteNumber(fields[4]),
      raw,
    };
  }).filter((zone) => zone.name);
}

function parseCompactSceneVector(text) {
  const vector = parseVectorBlock(text);
  if (!vector) return null;
  // CPZ/FOBI/MainZone scene coordinates are already in world units.
  // Only compact player runtime rows use the /100 compression.
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  };
}

function parseCompactFobs(text) {
  const section = extractDelimitedSceneSection(text, "FOBI:", ",MainZone:");
  if (!section) return [];
  return extractBraceItems(section).map((raw, index) => {
    const fields = splitTopLevelCsv(raw);
    const teamId = toFiniteNumber(fields[1]);
    return {
      fobId: fields[0] ? fields[0] : `team:${teamId ?? "unknown"}:index:${index}`,
      name: fields[0] ?? "",
      teamId,
      size: fields[2] ?? "",
      health: toFiniteNumber(fields[3]),
      ammo: toFiniteNumber(fields[4]),
      constructionPoints: toFiniteNumber(fields[5]),
      construction: toFiniteNumber(fields[5]),
      instigator: fields[6] ?? "",
      isBleeding: false,
      position: null,
      raw,
    };
  });
}

function mergeCaptureZones(previousZones, nextZones) {
  const previousByName = new Map(
    (Array.isArray(previousZones) ? previousZones : [])
      .map((zone) => [String(zone?.name ?? "").trim(), clonePlainObject(zone)])
      .filter(([name]) => Boolean(name)),
  );

  return (Array.isArray(nextZones) ? nextZones : []).map((zone) => {
    const cloned = clonePlainObject(zone);
    const name = String(cloned?.name ?? "").trim();
    const previous = previousByName.get(name) ?? null;
    if (previous && (cloned.position == null || cloned.position?.x == null || cloned.position?.y == null)) {
      cloned.position = clonePlainObject(previous.position ?? null);
    }
    return cloned;
  });
}

function mergeMainZones(previousZones, nextZones) {
  const previousByTeam = new Map(
    (Array.isArray(previousZones) ? previousZones : [])
      .map((zone) => [String(zone?.teamId ?? ""), clonePlainObject(zone)])
      .filter(([teamKey]) => Boolean(teamKey)),
  );

  return (Array.isArray(nextZones) ? nextZones : []).map((zone) => {
    const cloned = clonePlainObject(zone);
    const teamKey = String(cloned?.teamId ?? "");
    const previous = previousByTeam.get(teamKey) ?? null;
    if (previous && (cloned.position == null || cloned.position?.x == null || cloned.position?.y == null)) {
      cloned.position = clonePlainObject(previous.position ?? null);
    }
    return cloned;
  });
}

function mergeFobs(previousFobs, nextFobs) {
  const previousByKey = new Map(
    (Array.isArray(previousFobs) ? previousFobs : [])
      .map((fob, index) => [buildFobMergeKey(fob, index), clonePlainObject(fob)])
      .filter(([key]) => Boolean(key)),
  );

  return (Array.isArray(nextFobs) ? nextFobs : []).map((fob, index) => {
    const cloned = clonePlainObject(fob);
    const key = buildFobMergeKey(cloned, index);
    const previous = previousByKey.get(key) ?? null;
    if (previous && (cloned.position == null || cloned.position?.x == null || cloned.position?.y == null)) {
      cloned.position = clonePlainObject(previous.position ?? null);
    }
    return cloned;
  });
}

function buildFobMergeKey(fob, index = 0) {
  const fobId = String(fob?.fobId ?? "").trim();
  if (fobId) return `id:${fobId}`;
  const name = String(fob?.name ?? "").trim();
  const teamId = String(fob?.teamId ?? "");
  if (name || teamId) return `team:${teamId}:name:${name}`;
  return `index:${index}`;
}

function parseMainZones(text) {
  const section = extractDelimitedSceneSection(text, "MainZone:", "");
  if (!section) return [];
  return extractBraceItems(section).map((raw) => {
    const commaIndex = raw.indexOf(",");
    const teamText = commaIndex >= 0 ? raw.slice(0, commaIndex) : raw;
    const vectorText = commaIndex >= 0 ? raw.slice(commaIndex + 1) : "";
    return {
      teamId: toFiniteNumber(teamText),
      position: parseVectorBlock(vectorText),
      raw,
    };
  }).filter((zone) => zone.teamId != null || zone.position);
}

function extractDelimitedSceneSection(text, startToken, endToken) {
  const source = String(text ?? "");
  const start = source.indexOf(startToken);
  if (start < 0) return "";
  const contentStart = start + startToken.length;
  const end = endToken ? source.indexOf(endToken, contentStart) : -1;
  return source.slice(contentStart, end >= 0 ? end : source.length).trim();
}

function extractLineBlock(text, name) {
  const source = String(text ?? "");
  const startToken = `${name}{`;
  const start = source.indexOf(startToken);
  if (start < 0) return null;
  const contentStart = start + startToken.length;
  let depth = 1;
  for (let index = contentStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          start,
          end: index + 1,
          content: source.slice(contentStart, index),
        };
      }
    }
  }
  return {
    start,
    end: source.length,
    content: source.slice(contentStart).replace(/}+$/g, ""),
  };
}

function extractCompactLineTail(text, name) {
  const source = String(text ?? "");
  const startToken = `${name}{`;
  const start = source.indexOf(startToken);
  if (start < 0) return "";
  return source.slice(start + startToken.length).trim();
}

function extractBraceItems(text) {
  const items = [];
  const source = String(text ?? "");
  let depth = 0;
  let itemStart = -1;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      if (depth === 0) itemStart = index + 1;
      depth += 1;
      continue;
    }
    if (char === "}") {
      if (depth > 0) depth -= 1;
      if (depth === 0 && itemStart >= 0) {
        items.push(source.slice(itemStart, index));
        itemStart = -1;
      }
    }
  }
  return items;
}

function extractRawLogLine(input) {
  if (typeof input === "string") return input;
  return String(
    input?.rawLog
    ?? input?.rawEvent?.Raw
    ?? input?.payload?.rawLog
    ?? input?.payload?.raw
    ?? input?.payload?.line
    ?? input?.sourceRaw
    ?? input?.raw
    ?? input?.message
    ?? "",
  ).trim();
}

function splitConcatenatedRawLogSegments(text) {
  const source = String(text ?? "").trim();
  if (!source) return [];
  const headerPattern = /\[\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}:\d+\]\[\d+\]/g;
  const matches = [...source.matchAll(headerPattern)];
  if (matches.length <= 1) return [source];

  const segments = [];
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index ?? 0;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? source.length) : source.length;
    const segment = source.slice(start, end).trim();
    if (segment) segments.push(segment);
  }
  return segments.length > 0 ? segments : [source];
}

function hashText(text) {
  return createHash("sha1").update(String(text ?? "")).digest("hex");
}

function parseBooleanText(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  return null;
}

function toScoreboardBoolean(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number === 1;
}

function createEmptySoldierInfo() {
  return {
    raw: "",
    fields: [],
    values: {},
    soldierClass: "",
    health: null,
    weaponClass: "",
    ammoValues: [],
    position: null,
    rotation: null,
  };
}

function parseSoldierInfo(rawText) {
  const source = String(rawText ?? "");
  const positionBlock = findNamedBlock(source, "Position");
  const rotationBlock = findNamedBlock(source, "Rotation");
  const weaponBlock = findNamedBlock(source, "WeaponInfo");
  const vectors = [
    parseVectorBlock(positionBlock?.content ?? ""),
    parseVectorBlock(rotationBlock?.content ?? ""),
  ].filter(Boolean);
  const withoutNestedBlocks = source
    .replace(/WeaponInfo\{[\s\S]*?\}(?=Position\{|Rotation\{|$)/g, "")
    .replace(/Position\{[\s\S]*?\}(?=Rotation\{|$)/g, "")
    .replace(/Rotation\{[\s\S]*?\}/g, "");
  const withoutLegacyVectors = withoutNestedBlocks.replace(/\{X=[-0-9.]+\s+Y=[-0-9.]+\s+Z=[-0-9.]+\}/g, "");
  const legacyVectorMatches = [...source.matchAll(/\{X=([-0-9.]+)\s+Y=([-0-9.]+)\s+Z=([-0-9.]+)\}/g)];
  for (const match of legacyVectorMatches) {
    vectors.push({
      x: toFiniteNumber(match[1]),
      y: toFiniteNumber(match[2]),
      z: toFiniteNumber(match[3]),
    });
  }
  const fields = splitTopLevelCsv(withoutLegacyVectors);
  const fieldMap = parseKeyValueFields(fields);
  const weaponFields = weaponBlock ? splitTopLevelCsv(weaponBlock.content) : [];
  const weaponClass = weaponFields[0] && weaponFields[0] !== "NoWeapon"
    ? weaponFields[0]
    : "";
  const weaponFieldIndex = fields.findIndex((value, index) => index > 0 && /^BP_/i.test(value));
  const ammoValues = weaponFields.length > 1
    ? weaponFields.slice(1).map(toFiniteNumber).filter((value) => value != null)
    : weaponFieldIndex >= 0
      ? fields.slice(weaponFieldIndex + 1).map(toFiniteNumber).filter((value) => value != null)
      : [];

  return {
    summary: {
      raw: rawText,
      fields,
      values: fieldMap,
      soldierClass: fieldMap.PawnClass ?? fields[0] ?? "",
      health: toFiniteNumber(fieldMap.Health ?? fields[1]),
      weaponClass: weaponClass || (weaponFieldIndex >= 0 ? fields[weaponFieldIndex] ?? "" : ""),
      ammoValues,
      position: scalePosition(vectors[0]) ?? null,
      rotation: vectors[1] ?? null,
    },
  };
}

function findNamedBlock(text, name) {
  const source = String(text ?? "");
  const startToken = `${name}{`;
  const start = source.indexOf(startToken);
  if (start < 0) return null;
  const contentStart = start + startToken.length;
  let depth = 1;
  for (let index = contentStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return {
        start,
        end: index + 1,
        content: source.slice(contentStart, index),
      };
    }
  }
  return null;
}

function parseKeyValueFields(fields) {
  const result = {};
  for (const field of fields) {
    const text = String(field ?? "").trim();
    const separator = text.indexOf(":");
    if (separator <= 0) continue;
    const key = text.slice(0, separator).trim();
    const value = text.slice(separator + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}


function scalePosition(pos) {
  if (!pos) return null;
  return {
    x: pos.x * 100,
    y: pos.y * 100,
    z: pos.z * 100,
  };
}

function parseVectorBlock(text) {
  const match = String(text ?? "").match(/X=([-0-9.]+)\s+Y=([-0-9.]+)\s+Z=([-0-9.]+)/);
  if (!match) return null;
  return {
    x: toFiniteNumber(match[1]),
    y: toFiniteNumber(match[2]),
    z: toFiniteNumber(match[3]),
  };
}

function parseVehicleInfo(text) {
  const match = String(text ?? "").match(/\{VehicleType:([^{},]+?)(?:,\s*|\s*)Health:([0-9./]+)(?:[^{}]*?)\}/);
  if (!match) {
    return {
      raw: "",
      vehicleType: "",
      healthText: "",
      health: null,
      maxHealth: null,
      position: null,
      rotation: null,
    };
  }
  const healthText = String(match[2] ?? "").trim();
  const [health, maxHealth] = healthText.split("/").map(toFiniteNumber);

  let position = null;
  const posMatch = match[0].match(/Position:X=([-0-9.]+)\s+Y=([-0-9.]+)\s+Z=([-0-9.]+)/);
  if (posMatch) {
    position = {
      x: toFiniteNumber(posMatch[1]) * 100,
      y: toFiniteNumber(posMatch[2]) * 100,
      z: toFiniteNumber(posMatch[3]) * 100,
    };
  }

  let rotation = null;
  const rotMatch = match[0].match(/Rotation:P=([-0-9.]+)\s+Y=([-0-9.]+)\s+R=([-0-9.]+)/);
  if (rotMatch) {
    rotation = {
      x: toFiniteNumber(rotMatch[1]),
      y: toFiniteNumber(rotMatch[3]),
      z: toFiniteNumber(rotMatch[2]),
    };
  }

  return {
    raw: match[0],
    vehicleType: String(match[1] ?? "").trim(),
    healthText,
    health: health ?? null,
    maxHealth: maxHealth ?? null,
    position,
    rotation,
  };
}

function parseTeamId(segment, baseMap, baseFields, context = "") {
  const source = `${String(context ?? "")}${String(segment ?? "")}`;
  const matches = [...source.matchAll(/TeamID:(-?\d+)/ig)];
  if (matches.length > 0) {
    return toFiniteNumber(matches[matches.length - 1][1]);
  }
  return toFiniteNumber(baseMap.TeamID ?? baseMap.TeamId ?? baseFields[3]);
}

function parseTeamAndSquadInfo(context, segment, baseMap, baseFields) {
  const sourceContext = String(context ?? "");
  const sourceSegment = String(segment ?? "");
  const squadContextMatch = sourceContext.match(/SquadBaseInfo\{([^}]*)\}/i);
  const squadSegmentMatch = sourceSegment.match(/SquadBaseInfo\{([^}]*)\}/i);
  const squadRaw = squadSegmentMatch?.[1] ?? squadContextMatch?.[1] ?? "";
  const squadMap = parseKeyValueFields(splitTopLevelCsv(squadRaw));
  const teamId = parseTeamId(segment, baseMap, baseFields, context);
  const squadId = toFiniteNumber(
    squadMap.ID
    ?? squadMap.SquadID
    ?? squadMap.SquadId
    ?? baseMap.SquadID
    ?? baseMap.SquadId
    ?? baseFields[4],
  );
  return { teamId, squadId };
}

function findPlayerContextStart(source, playerBaseIndex) {
  const searchStart = Math.max(0, playerBaseIndex - 4096);
  let contextStart = searchStart;
  for (const needle of ["TeamID{", "TeamID:", "SquadInfo{", "SquadBaseInfo{"]) {
    const found = source.lastIndexOf(needle, playerBaseIndex);
    if (found >= searchStart && found >= 0) {
      contextStart = Math.min(contextStart, found);
    }
  }
  return contextStart;
}

function findBzssCoreContextStart(data, startIndex) {
  const searchWindow = Math.max(0, startIndex - 8192);
  let contextStart = startIndex;
  for (const needle of ["TeamID{", "TeamID:", "SquadInfo{", "SquadBaseInfo{"]) {
    const found = data.lastIndexOf(Buffer.from(needle, "utf16le"), startIndex);
    if (found >= searchWindow && found >= 0) {
      contextStart = Math.min(contextStart, found);
    }
  }
  return contextStart;
}

function findFirstBufferIndex(data, needles) {
  let bestIndex = -1;
  for (const needle of needles) {
    const index = data.indexOf(needle);
    if (index < 0) continue;
    if (bestIndex < 0 || index < bestIndex) {
      bestIndex = index;
    }
  }
  return bestIndex;
}

function parseScoreboardInfo(rawText) {
  const raw = String(rawText ?? "");
  const normalized = normalizeScoreboardText(raw);
  const values = splitTopLevelCsv(normalized);
  const valuesByKey = parseKeyValueFields(values);
  const numericValues = values.map((value) => {
    const text = String(value ?? "").trim();
    const separator = text.indexOf(":");
    const normalizedValue = separator > 0 ? text.slice(separator + 1).trim() : text;
    return toFiniteNumber(normalizedValue);
  });
  const scoreStats = parseScoreboardStats(valuesByKey, numericValues);
  return {
    raw,
    values,
    numericValues,
    stats: scoreStats.stats,
    labeledValues: scoreStats.labeledValues,
    extraValues: scoreStats.extraValues,
    valuesByKey,
  };
}

function parseScoreboardStats(valuesByKey, values) {
  const hasExplicitTailKeys = [
    "numTeamKills",
    "healPoints",
    "revivedPoints",
    "teamworkScore",
    "objectiveScore",
    "combatScore",
  ].some((key) => {
    const aliases = SCOREBOARD_FIELD_ALIASES[key] ?? [];
    return aliases.some((alias) => valuesByKey?.[alias] != null);
  });
  const isMissingTeamKillLayout = !hasExplicitTailKeys && values.length === SCOREBOARD_FIELDS.length - 1;
  const fallbackIndexByKey = isMissingTeamKillLayout
    ? {
        dataLives: 0,
        numKills: 1,
        vehicleKills: null,
        numDeaths: 2,
        numWoundeds: 3,
        numWounds: 4,
        numTeamKills: null,
        healPoints: 5,
        revivedPoints: 6,
        teamworkScore: 7,
        objectiveScore: 8,
        combatScore: 9,
      }
    : null;
  const stats = {};
  const labeledValues = SCOREBOARD_FIELDS.map(([key, label], index) => {
    const aliases = SCOREBOARD_FIELD_ALIASES[key] ?? [];
    const fallbackIndex = fallbackIndexByKey ? fallbackIndexByKey[key] : index;
    const value = pickFirstFiniteNumber([
      ...(aliases.map((alias) => valuesByKey?.[alias])),
      fallbackIndex != null ? values[fallbackIndex] : null,
    ]);
    stats[key] = value;
    return {
      key,
      label,
      value,
    };
  });
  return {
    stats,
    labeledValues,
    extraValues: values.slice(SCOREBOARD_FIELDS.length),
  };
}

function normalizeScoreboardText(text) {
  return String(text ?? "").replace(/(\d)([A-Z][A-Za-z0-9_]*:)/g, "$1,$2");
}

function pickFirstFiniteNumber(values) {
  for (const value of values) {
    const number = toFiniteNumber(value);
    if (number != null) return number;
  }
  return null;
}

function splitTopLevelCsv(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of String(text ?? "")) {
    if (char === "{") depth += 1;
    if (char === "}") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current || text === "") parts.push(current.trim());
  return parts;
}

function extractRelevantUtf16Runs(data) {
  const runs = extractUtf16LeTextRuns(data).filter((run) => (
    run.includes("PlayerBaseInfo{")
    || run.includes("PRI{{")
    || run.includes("SoldierInfo{")
    || run.includes("PlayerScoreboard{")
    || run.includes(MARKER)
  ));
  return {
    text: runs.join(""),
    markerSeen: runs.some((run) => run.includes(MARKER)),
    error: runs.length > 0 ? "" : "Relevant UTF-16 text runs were not found.",
  };
}

function extractUtf16LeTextRuns(data) {
  const runs = [];
  let start = -1;

  for (let offset = 0; offset + 1 < data.length; offset += 2) {
    const codeUnit = data.readUInt16LE(offset);
    const printable = isLikelyPrintableUtf16CodeUnit(codeUnit);
    if (printable) {
      if (start < 0) start = offset;
      continue;
    }

    if (start >= 0) {
      if (offset - start >= 16) {
        runs.push(data.subarray(start, offset).toString("utf16le"));
      }
      start = -1;
    }
  }

  if (start >= 0 && data.length - start >= 16) {
    const safeEnd = data.length - (data.length - start) % 2;
    runs.push(data.subarray(start, safeEnd).toString("utf16le"));
  }

  return runs;
}

function isLikelyPrintableUtf16CodeUnit(value) {
  if (value === 0 || value === 0xffff) return false;
  if (value === 0x0009 || value === 0x000a || value === 0x000d) return true;
  return value >= 0x0020 && value <= 0xfffd;
}

function toFiniteNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBooleanNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (parsed === 1) return true;
  if (parsed === 0) return false;
  return null;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function normalizeNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function clonePlainObject(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function toNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}




