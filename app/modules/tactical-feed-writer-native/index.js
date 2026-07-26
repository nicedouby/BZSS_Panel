// -*- coding: utf-8 -*-
//
// Temporary correctness-first tactical replay writer.
// It stores complete tactical-state snapshots as JSONL without player dictionaries,
// field masks, delta compression, or identity remapping.

import { createHash } from "node:crypto";
import { mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const FORMAT = "native-jsonl-v1";
const VERSION = 1;

const DEFAULTS = Object.freeze({
  enabled: true,
  rootDir: "data/replay-spool",
  serverId: "",
  playerSampleMs: 333,
  segmentDurationMs: 30_000,
  endGraceMs: 5_000,
  metadataFlushMs: 5_000,
});

export function createTacticalFeedWriterModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.logger;
  const settings = readSettings(config);
  const state = createState(settings);
  let started = false;
  let stopped = false;
  let unsubscribe = null;
  let timer = null;
  let writeChain = Promise.resolve();

  function enqueue(work) {
    const operation = writeChain.then(work, work);
    writeChain = operation.catch((error) => {
      state.lastError = error?.message ?? String(error);
      moduleLogger?.warn?.("Native tactical replay writer operation failed.", {
        operation: "tacticalFeedWriterNative",
        data: { message: state.lastError },
      });
    });
    return operation;
  }

  function enqueueBackground(work) {
    void enqueue(work).catch(() => {});
  }

  function acceptSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;
    state.latestSnapshot = snapshot;
    state.latestReceivedAt = Date.now();
    enqueueBackground(() => reconcile(Date.now()));
  }

  async function reconcile(now) {
    const snapshot = state.latestSnapshot;
    if (!snapshot || !state.recordingEnabled) return;

    const context = resolveRoundContext(snapshot, modules, core, settings);
    const ended = isMatchEnded(snapshot);

    if (!state.session) {
      if (!isMatchActive(snapshot)) return;
      if (context.anchor && context.anchor === state.lastEndedAnchor) return;
      await beginSession(snapshot, context, now);
    } else if (
      context.anchor
      && state.session.anchor
      && context.anchor !== state.session.anchor
      && isMatchActive(snapshot)
    ) {
      await endSession("round-replaced", now);
      await beginSession(snapshot, context, now);
    }

    if (!state.session) return;

    updateSessionRoster(snapshot);

    if (ended) {
      if (hasPlayers(snapshot)) {
        await writeSnapshot(snapshot, now, { force: true });
      }
      if (!state.pendingEndAt) state.pendingEndAt = now + settings.endGraceMs;
      if (now >= state.pendingEndAt) await endSession("match-ended", now);
      return;
    }

    state.pendingEndAt = 0;
    if (now - state.lastFrameAt >= settings.playerSampleMs) {
      await writeSnapshot(snapshot, now);
    }
    if (now - state.lastMetadataFlushAt >= settings.metadataFlushMs) {
      await flushSessionMetadata("recording", now);
    }
  }

  async function beginSession(snapshot, context, now) {
    const sessionId = makeSessionId(context.serverId, context.layer, now);
    const root = path.resolve(settings.rootDir);
    const directory = path.join(root, `${sessionId}.open`);
    await mkdir(path.join(directory, "segments"), { recursive: true });

    state.session = {
      sessionId,
      serverId: context.serverId,
      directory,
      startedAt: now,
      anchor: context.anchor,
      map: context.map,
      layer: context.layer,
      mode: context.mode,
      uniquePlayers: new Map(),
      peakPlayerCount: 0,
      currentPlayerCount: 0,
      frameCount: 0,
      lastNonEmptySnapshot: null,
    };
    state.segmentIndex = 0;
    state.sequence = 0;
    state.pendingEndAt = 0;
    state.lastFrameAt = 0;
    state.lastMetadataFlushAt = 0;

    await writeFile(path.join(directory, "writer.lock"), `${process.pid}\n`, "utf8");
    await openSegment(now);
    updateSessionRoster(snapshot);
    await writeSnapshot(snapshot, now, { force: true });
    await flushSessionMetadata("recording", now);

    core.eventBus?.emitModuleEvent?.("module.tacticalFeedWriter", "sessionStarted", {
      sessionId,
      serverId: context.serverId,
      anchor: context.anchor,
      format: FORMAT,
      time: new Date(now).toISOString(),
    });
  }

  async function writeSnapshot(snapshot, now, { force = false, terminal = false } = {}) {
    if (!state.session || !state.segmentHandle) return;
    if (!force && now - state.lastFrameAt < settings.playerSampleMs) return;

    await rotateSegmentIfNeeded(now);
    const elapsedMs = Math.max(0, now - state.session.startedAt);
    const line = JSON.stringify({
      version: VERSION,
      format: FORMAT,
      type: "snapshot",
      sequence: state.sequence++,
      elapsedMs,
      recordedAt: new Date(now).toISOString(),
      terminal,
      snapshot,
    });
    await state.segmentHandle.write(`${line}\n`);

    state.lastFrameAt = now;
    state.recordCount += 1;
    state.session.frameCount += 1;
    if (hasPlayers(snapshot)) state.session.lastNonEmptySnapshot = snapshot;
  }

  function updateSessionRoster(snapshot) {
    if (!state.session) return;

    const nativePlayers = Array.isArray(snapshot?.players) ? snapshot.players : [];
    for (const player of nativePlayers) rememberPlayer(state.session.uniquePlayers, player);

    const presencePlayers = modules.matchPlayerPresence?.getPlayers?.(state.session.serverId) ?? [];
    for (const player of Array.isArray(presencePlayers) ? presencePlayers : []) {
      rememberPresencePlayer(state.session.uniquePlayers, player);
    }

    const rconPlayers = modules.playerState?.getOnlinePlayers?.(state.session.serverId) ?? [];
    for (const player of Array.isArray(rconPlayers) ? rconPlayers : []) {
      rememberPresencePlayer(state.session.uniquePlayers, player);
    }

    const declaredPlayerCount = finiteInteger(snapshot?.server?.playerCount);
    state.session.currentPlayerCount = Math.max(nativePlayers.length, declaredPlayerCount ?? 0);
    state.session.peakPlayerCount = Math.max(
      state.session.peakPlayerCount,
      state.session.currentPlayerCount,
      Array.isArray(rconPlayers) ? rconPlayers.length : 0,
      Array.isArray(presencePlayers) ? presencePlayers.filter((player) => player?.matchOnline === true || player?.online === true).length : 0,
    );
  }

  async function flushSessionMetadata(status, now, reason = "") {
    if (!state.session) return;
    const ended = status === "closed";
    const metadata = {
      version: VERSION,
      format: FORMAT,
      payloadEncoding: "jsonl",
      compression: "none",
      dictionary: false,
      sessionId: state.session.sessionId,
      serverId: state.session.serverId,
      roundAnchor: state.session.anchor,
      startedAt: new Date(state.session.startedAt).toISOString(),
      ...(ended ? { endedAt: new Date(now).toISOString(), durationMs: Math.max(0, now - state.session.startedAt) } : {}),
      status,
      reason,
      map: state.session.map,
      layer: state.session.layer,
      mode: state.session.mode,
      playerCount: state.session.uniquePlayers.size,
      peakPlayerCount: state.session.peakPlayerCount,
      currentPlayerCount: state.session.currentPlayerCount,
      frameCount: state.session.frameCount,
      segmentDurationMs: settings.segmentDurationMs,
      updatedAt: new Date(now).toISOString(),
    };
    await writeJsonAtomic(path.join(state.session.directory, "session.json"), metadata);
    state.lastMetadataFlushAt = now;
  }

  async function endSession(reason, now = Date.now()) {
    if (!state.session) return;

    if (state.session.lastNonEmptySnapshot && now > state.lastFrameAt) {
      await writeSnapshot(state.session.lastNonEmptySnapshot, now, { force: true, terminal: true });
    }
    await closeSegment();
    await flushSessionMetadata("closed", now, reason);
    await unlink(path.join(state.session.directory, "writer.lock")).catch(() => {});

    const session = state.session;
    const closedDirectory = path.join(path.dirname(session.directory), session.sessionId);
    let finalDirectory = session.directory;
    let directoryRenamed = session.directory === closedDirectory;
    let finalizationMessage = "";

    if (!directoryRenamed) {
      try {
        await rename(session.directory, closedDirectory);
        finalDirectory = closedDirectory;
        directoryRenamed = true;
      } catch (error) {
        finalizationMessage = error?.message ?? String(error);
        moduleLogger?.warn?.("Native tactical replay session was closed but directory rename was deferred.", {
          operation: "tacticalFeedWriterNative.finalizeSession",
          data: { sessionId: session.sessionId, message: finalizationMessage },
        });
      }
    }

    state.lastFinalization = {
      sessionId: session.sessionId,
      completedAt: new Date(now).toISOString(),
      directory: finalDirectory,
      directoryRenamed,
      message: finalizationMessage,
      playerCount: session.uniquePlayers.size,
      peakPlayerCount: session.peakPlayerCount,
      frameCount: session.frameCount,
    };
    state.lastEndedAnchor = session.anchor || state.lastEndedAnchor;

    core.eventBus?.emitModuleEvent?.("module.tacticalFeedWriter", "sessionEnded", {
      sessionId: session.sessionId,
      serverId: session.serverId,
      reason,
      format: FORMAT,
      playerCount: session.uniquePlayers.size,
      peakPlayerCount: session.peakPlayerCount,
      time: new Date(now).toISOString(),
      directory: finalDirectory,
      directoryRenamed,
    });

    resetSessionState(state);
  }

  async function openSegment(now) {
    if (!state.session) return;
    const id = String(state.segmentIndex).padStart(6, "0");
    const filePath = path.join(state.session.directory, "segments", `${id}.open.native.jsonl`);
    state.segment = {
      id: state.segmentIndex,
      startedAt: now,
      filePath,
      closedPath: filePath.replace(/\.open\.native\.jsonl$/, ".native.jsonl"),
    };
    state.segmentHandle = await open(filePath, "a");
  }

  async function closeSegment() {
    if (!state.segment) return;
    await state.segmentHandle?.close?.();
    state.segmentHandle = null;
    await rename(state.segment.filePath, state.segment.closedPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    state.segment = null;
  }

  async function rotateSegmentIfNeeded(now) {
    if (!state.segment || now - state.segment.startedAt < settings.segmentDurationMs) return;
    await closeSegment();
    state.segmentIndex += 1;
    await openSegment(now);
  }

  return {
    manifest: {
      id: "module.tacticalFeedWriter",
      name: "Tactical Feed Writer",
      kind: "module",
      version: "2.0.0-native",
      description: "Writes complete native tactical-state JSONL replay frames.",
      defaultEnabled: true,
    },
    apiName: "tacticalFeedWriter",
    api: {
      getDiagnostics: () => ({
        recordingEnabled: state.recordingEnabled,
        recording: Boolean(state.session),
        activeSession: state.session?.sessionId ?? null,
        activeRoundAnchor: state.session?.anchor ?? null,
        format: FORMAT,
        compression: "none",
        dictionary: false,
        recordCount: state.recordCount,
        frameCount: state.session?.frameCount ?? 0,
        playerCount: state.session?.uniquePlayers?.size ?? 0,
        peakPlayerCount: state.session?.peakPlayerCount ?? 0,
        lastError: state.lastError,
        latestReceivedAt: state.latestReceivedAt,
        replayRootDir: path.resolve(settings.rootDir),
        lastFinalization: state.lastFinalization,
      }),
      getActiveSession: () => state.session ? {
        sessionId: state.session.sessionId,
        serverId: state.session.serverId,
        startedAt: state.session.startedAt,
        map: state.session.map,
        layer: state.session.layer,
        mode: state.session.mode,
        anchor: state.session.anchor,
        playerCount: state.session.uniquePlayers.size,
        peakPlayerCount: state.session.peakPlayerCount,
        frameCount: state.session.frameCount,
      } : null,
      setRecordingEnabled: (enabled) => enqueue(async () => {
        const nextEnabled = enabled === true;
        if (state.recordingEnabled === nextEnabled) return state.recordingEnabled;
        state.recordingEnabled = nextEnabled;
        if (!nextEnabled) await endSession("manual-disabled", Date.now());
        else await reconcile(Date.now());
        core.eventBus?.emitModuleEvent?.("module.tacticalFeedWriter", "recordingChanged", {
          enabled: state.recordingEnabled,
          time: new Date().toISOString(),
        });
        return state.recordingEnabled;
      }),
      forceStart: () => enqueue(async () => {
        state.recordingEnabled = true;
        if (state.lastEndedAnchor) state.lastEndedAnchor = "";
        await reconcile(Date.now());
      }),
      forceEnd: (reason = "manual") => enqueue(() => endSession(reason, Date.now())),
    },
    async start() {
      if (started) return;
      started = true;
      stopped = false;
      unsubscribe = modules.tacticalState?.subscribe?.(acceptSnapshot) ?? null;
      const initial = await modules.tacticalState?.getSnapshot?.();
      if (initial) acceptSnapshot(initial);
      timer = setInterval(() => {
        if (!stopped) enqueueBackground(() => reconcile(Date.now()));
      }, Math.min(settings.playerSampleMs, 500));
      timer.unref?.();
    },
    async stop() {
      if (!started) return;
      stopped = true;
      started = false;
      clearInterval(timer);
      timer = null;
      unsubscribe?.();
      unsubscribe = null;
      await enqueue(() => endSession("process-stopped", Date.now()));
    },
  };
}

function createState(settings) {
  return {
    recordingEnabled: settings.enabled !== false,
    latestSnapshot: null,
    latestReceivedAt: 0,
    session: null,
    segment: null,
    segmentHandle: null,
    segmentIndex: 0,
    sequence: 0,
    pendingEndAt: 0,
    lastFrameAt: 0,
    lastMetadataFlushAt: 0,
    lastEndedAnchor: "",
    recordCount: 0,
    lastError: "",
    lastFinalization: null,
  };
}

function resetSessionState(state) {
  state.session = null;
  state.segment = null;
  state.segmentHandle = null;
  state.segmentIndex = 0;
  state.sequence = 0;
  state.pendingEndAt = 0;
  state.lastFrameAt = 0;
  state.lastMetadataFlushAt = 0;
}

function readSettings(config) {
  const value = config?.get?.("modules.tacticalFeedWriter", {}) ?? {};
  return {
    ...DEFAULTS,
    ...value,
    rootDir: value.rootDir ?? DEFAULTS.rootDir,
    playerSampleMs: positiveInteger(value.playerSampleMs, DEFAULTS.playerSampleMs),
    segmentDurationMs: positiveInteger(value.segmentDurationMs, DEFAULTS.segmentDurationMs),
    endGraceMs: positiveInteger(value.endGraceMs, DEFAULTS.endGraceMs),
    metadataFlushMs: positiveInteger(value.metadataFlushMs, DEFAULTS.metadataFlushMs),
  };
}

function resolveRoundContext(snapshot, modules, core, settings) {
  const serverId = safeText(
    settings.serverId
    || snapshot?.server?.serverId
    || core.webStatus?.serverId
    || core.webStatus?.getSnapshot?.()?.serverId
    || "server",
  );
  const matchState = modules.matchState?.getState?.(serverId)
    ?? modules.matchState?.getSnapshot?.(serverId)
    ?? modules.matchState?.getState?.()
    ?? null;
  const round = matchState?.round?.current ?? null;
  const map = safeText(snapshot?.server?.map || snapshot?.match?.map || matchState?.serverStatus?.map || round?.mapName);
  const layer = safeText(snapshot?.server?.layer || snapshot?.match?.layer || matchState?.serverStatus?.layer || round?.layerName || "unknown");
  const mode = safeText(snapshot?.server?.mode || snapshot?.match?.mode || matchState?.serverStatus?.mode);
  const strongAnchor = safeText(
    round?.dedupeKey
    || round?.roundId
    || round?.matchId
    || [round?.logLineTime, round?.worldPath, round?.serverPlayAt].filter(Boolean).join("|"),
  );
  const snapshotAnchor = safeText(
    snapshot?.match?.roundId
    || snapshot?.match?.matchId
    || snapshot?.match?.startedAt
    || snapshot?.match?.startTime,
  );
  return {
    serverId,
    map,
    layer,
    mode,
    anchor: strongAnchor || snapshotAnchor || `${serverId}|${layer}|${map}`,
  };
}

function isMatchActive(snapshot) {
  const hasWorld = Boolean(safeText(snapshot?.server?.map) || safeText(snapshot?.server?.layer));
  return hasWorld && !isMatchEnded(snapshot);
}

function isMatchEnded(snapshot) {
  const text = [
    snapshot?.match?.state,
    snapshot?.match?.phase,
    snapshot?.server?.state,
    snapshot?.server?.phase,
  ].map(safeText).join(" ");
  return /waitingpostmatch|postmatch|matchended|roundended|ended|结算/i.test(text);
}

function hasPlayers(snapshot) {
  return Array.isArray(snapshot?.players) && snapshot.players.length > 0;
}

function rememberPlayer(target, player) {
  const identity = player?.identity ?? {};
  const key = safeText(
    identity.key
    || (identity.steamID ? `steam:${identity.steamID}` : "")
    || (identity.eosID ? `eos:${identity.eosID}` : "")
    || (identity.playerID != null ? `player:${identity.playerID}` : "")
    || identity.name,
  );
  if (!key) return;
  target.set(key, {
    key,
    name: safeText(identity.name),
    steamID: safeText(identity.steamID),
    eosID: safeText(identity.eosID),
  });
}

function rememberPresencePlayer(target, player) {
  const key = safeText(
    player?.playerKey
    || (player?.steamID ? `steam:${player.steamID}` : "")
    || (player?.eosID ? `eos:${player.eosID}` : "")
    || (player?.controllerID ? `controller:${player.controllerID}` : "")
    || player?.name
    || player?.lastName,
  );
  if (!key) return;
  target.set(key, {
    key,
    name: safeText(player?.name || player?.lastName),
    steamID: safeText(player?.steamID),
    eosID: safeText(player?.eosID),
  });
}

function makeSessionId(serverId, layer, now) {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
  const suffix = createHash("sha1")
    .update(`${serverId}:${layer}:${now}:${process.pid}`)
    .digest("hex")
    .slice(0, 4)
    .toUpperCase();
  return `${slug(serverId)}_${stamp}_${slug(layer)}_${suffix}`;
}

function slug(value) {
  return safeText(value).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "unknown";
}

function safeText(value) {
  return String(value ?? "").trim();
}

function finiteInteger(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : null;
}

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

async function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export const TacticalReplayNativeFormat = Object.freeze({
  version: VERSION,
  format: FORMAT,
  compression: "none",
  dictionary: false,
});
