// -*- coding: utf-8 -*-
//
// Tactical replay reader for correctness-first native JSONL archives.
// Legacy .rps sessions are delegated to the existing incremental reader.

import fs from "node:fs/promises";
import path from "node:path";

import { createTacticalReplayPlayerModule as createLegacyReplayPlayerModule } from "../tactical-replay-player/index.js";

const FORMAT = "native-jsonl-v1";
const SEGMENT_PATTERN = /^(\d{6})\.(?:open\.)?native\.jsonl$/;

export function createTacticalReplayPlayerModule(context) {
  const { config, logger } = context;
  const legacy = createLegacyReplayPlayerModule(context);
  const settings = readSettings(config);
  const state = {
    started: false,
    reads: 0,
    nativeReads: 0,
    lastReadAt: "",
    lastError: "",
  };

  const api = {
    getStatus() {
      const legacyStatus = legacy.api?.getStatus?.() ?? {};
      return {
        ...legacyStatus,
        enabled: state.started,
        rootDir: settings.rootDir,
        nativeFormat: FORMAT,
        reads: Number(legacyStatus.reads ?? 0) + state.nativeReads,
        nativeReads: state.nativeReads,
        lastReadAt: state.lastReadAt || legacyStatus.lastReadAt || null,
        lastError: state.lastError || legacyStatus.lastError || null,
      };
    },

    listSessions: (options) => listSessions(settings, legacy.api, options),

    getSession: (sessionId) => getSession(settings, legacy.api, sessionId),

    async readState(sessionId, options = {}) {
      state.reads += 1;
      state.lastReadAt = new Date().toISOString();
      try {
        const session = await getSession(settings, legacy.api, sessionId);
        if (!session) return null;
        if (session.format !== FORMAT) {
          return await legacy.api?.readState?.(sessionId, options) ?? null;
        }
        state.nativeReads += 1;
        return await readNativeState(settings, session, options);
      } catch (error) {
        state.lastError = error?.message ?? String(error);
        logger?.warn?.("Native tactical replay read failed.", {
          operation: "tacticalReplayPlayerNative.readState",
          data: { sessionId, message: state.lastError },
        });
        throw error;
      }
    },
  };

  return {
    manifest: {
      id: "module.tacticalReplayPlayer",
      name: "Tactical Replay Player",
      kind: "module",
      version: "2.0.0-native",
      description: "Reads native JSONL tactical replays and legacy .rps sessions.",
      defaultEnabled: true,
    },
    apiName: "tacticalReplayPlayer",
    api,
    async start() {
      if (state.started) return;
      state.started = true;
      await legacy.start?.();
    },
    async stop() {
      if (!state.started) return;
      state.started = false;
      await legacy.stop?.();
    },
  };
}

async function listSessions(settings, legacyApi, { limit = 100 } = {}) {
  await fs.mkdir(settings.rootDir, { recursive: true });
  const entries = await fs.readdir(settings.rootDir, { withFileTypes: true });
  const sessions = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeSessionId(entry.name)) continue;
    try {
      const metadata = await readSessionMetadata(path.join(settings.rootDir, entry.name));
      if (metadata?.format === FORMAT) {
        sessions.push(await buildNativeSession(settings.rootDir, entry.name, metadata));
        continue;
      }
      const legacySession = await legacyApi?.getSession?.(entry.name);
      if (legacySession) sessions.push(legacySession);
    } catch (error) {
      sessions.push({
        id: entry.name.replace(/\.open$/i, ""),
        sessionId: entry.name.replace(/\.open$/i, ""),
        status: "unreadable",
        isPlayable: false,
        archiveError: error?.message ?? String(error),
      });
    }
  }

  sessions.sort((left, right) => String(right.startedAt ?? "").localeCompare(String(left.startedAt ?? "")));
  return sessions.slice(0, clampInteger(limit, 1, 1000, 100));
}

async function getSession(settings, legacyApi, sessionId) {
  const safeId = validateSessionId(sessionId);
  const directory = await resolveSessionDirectory(settings.rootDir, safeId);
  if (!directory) return null;

  const metadata = await readSessionMetadata(directory);
  if (metadata?.format === FORMAT) {
    return buildNativeSession(settings.rootDir, path.basename(directory), metadata);
  }
  return await legacyApi?.getSession?.(sessionId) ?? null;
}

async function buildNativeSession(rootDir, directoryName, metadata) {
  const directory = path.join(rootDir, directoryName);
  const segmentNames = await listNativeSegments(directory);
  const startedMs = Date.parse(metadata?.startedAt ?? "");
  const endedMs = Date.parse(metadata?.endedAt ?? "");
  const durationMs = Number.isFinite(Number(metadata?.durationMs))
    ? Math.max(0, Number(metadata.durationMs))
    : Number.isFinite(startedMs)
      ? Math.max(0, (Number.isFinite(endedMs) ? endedMs : Date.now()) - startedMs)
      : 0;
  const sessionId = String(metadata?.sessionId ?? directoryName.replace(/\.open$/i, ""));

  return {
    ...metadata,
    id: sessionId,
    sessionId,
    status: metadata?.status ?? (metadata?.endedAt ? "closed" : "recording"),
    format: FORMAT,
    compression: "none",
    dictionary: false,
    durationMs,
    playerCount: nonNegativeInteger(metadata?.playerCount),
    peakPlayerCount: nonNegativeInteger(metadata?.peakPlayerCount),
    currentPlayerCount: nonNegativeInteger(metadata?.currentPlayerCount),
    frameCount: nonNegativeInteger(metadata?.frameCount),
    isPlayable: segmentNames.length > 0,
    rootDir: undefined,
  };
}

async function readNativeState(settings, session, { atMs = 0 } = {}) {
  const directory = await resolveSessionDirectory(settings.rootDir, validateSessionId(session.id));
  if (!directory) return null;

  const segmentNames = await listNativeSegments(directory);
  const targetMs = Math.max(0, Number.isFinite(Number(atMs)) ? Number(atMs) : 0);
  const frame = await findNativeFrame(directory, segmentNames, targetMs, session.segmentDurationMs);
  if (!frame) {
    return {
      session,
      atMs: targetMs,
      resolvedAtMs: 0,
      state: emptyReplaySnapshot(session, targetMs),
      diagnostics: {
        format: FORMAT,
        native: true,
        compression: "none",
        dictionary: false,
        segments: segmentNames.length,
        frameFound: false,
      },
    };
  }

  return {
    session,
    atMs: targetMs,
    resolvedAtMs: frame.elapsedMs,
    state: decorateReplaySnapshot(frame.snapshot, session, targetMs),
    diagnostics: {
      format: FORMAT,
      native: true,
      compression: "none",
      dictionary: false,
      segments: segmentNames.length,
      frameFound: true,
      sequence: frame.sequence ?? null,
      terminal: frame.terminal === true,
    },
  };
}

async function findNativeFrame(directory, segmentNames, targetMs, segmentDurationMs) {
  if (!segmentNames.length) return null;
  const duration = positiveInteger(segmentDurationMs, 30_000);
  const targetIndex = Math.max(0, Math.floor(targetMs / duration));
  const candidates = segmentNames
    .map((name) => ({ name, index: Number(SEGMENT_PATTERN.exec(name)?.[1] ?? -1) }))
    .filter((item) => item.index >= 0 && item.index <= targetIndex)
    .sort((left, right) => right.index - left.index);

  if (!candidates.length) {
    candidates.push({ name: segmentNames[0], index: 0 });
  }

  for (const candidate of candidates) {
    const frames = await readNativeSegment(path.join(directory, "segments", candidate.name));
    let latest = null;
    for (const frame of frames) {
      if (!frame || frame.type !== "snapshot" || !frame.snapshot) continue;
      const elapsedMs = nonNegativeNumber(frame.elapsedMs);
      if (elapsedMs <= targetMs && (!latest || elapsedMs >= latest.elapsedMs)) {
        latest = { ...frame, elapsedMs };
      }
    }
    if (latest) return latest;
  }

  const firstFrames = await readNativeSegment(path.join(directory, "segments", segmentNames[0]));
  const first = firstFrames.find((frame) => frame?.type === "snapshot" && frame?.snapshot);
  return first ? { ...first, elapsedMs: nonNegativeNumber(first.elapsedMs) } : null;
}

async function readNativeSegment(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  const frames = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object") frames.push(parsed);
    } catch {
      // A partially written final line in an open segment is ignored. Earlier
      // complete frames remain readable and the archive stays available.
    }
  }
  return frames;
}

function decorateReplaySnapshot(value, session, atMs) {
  const snapshot = clonePlainObject(value) ?? {};
  snapshot.meta = {
    ...(snapshot.meta && typeof snapshot.meta === "object" ? snapshot.meta : {}),
    generatedAt: new Date().toISOString(),
    replay: true,
    replayAtMs: atMs,
    replayFormat: FORMAT,
  };
  snapshot.server = snapshot.server && typeof snapshot.server === "object" ? snapshot.server : {};
  snapshot.match = snapshot.match && typeof snapshot.match === "object" ? snapshot.match : {};
  snapshot.teams = Array.isArray(snapshot.teams) ? snapshot.teams : [];
  snapshot.players = Array.isArray(snapshot.players) ? snapshot.players : [];
  snapshot.assets = snapshot.assets && typeof snapshot.assets === "object" ? snapshot.assets : {};
  snapshot.session = {
    id: session.id,
    status: session.status,
    map: session.map ?? snapshot.server.map ?? "",
    layer: session.layer ?? snapshot.server.layer ?? "",
    mode: session.mode ?? snapshot.server.mode ?? "",
    playerCount: session.playerCount ?? 0,
    peakPlayerCount: session.peakPlayerCount ?? 0,
  };
  return snapshot;
}

function emptyReplaySnapshot(session, atMs) {
  return {
    meta: {
      generatedAt: new Date().toISOString(),
      replay: true,
      replayAtMs: atMs,
      replayFormat: FORMAT,
    },
    server: {
      serverId: session.serverId ?? "",
      map: session.map ?? "",
      layer: session.layer ?? "",
      mode: session.mode ?? "",
    },
    match: {},
    teams: [],
    players: [],
    assets: {
      captureZones: [],
      mainZones: [],
      fobs: [],
      vehicles: [],
    },
    session: {
      id: session.id,
      status: session.status,
      map: session.map ?? "",
      layer: session.layer ?? "",
      mode: session.mode ?? "",
      playerCount: session.playerCount ?? 0,
      peakPlayerCount: session.peakPlayerCount ?? 0,
    },
  };
}

async function readSessionMetadata(directory) {
  try {
    return JSON.parse(await fs.readFile(path.join(directory, "session.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function listNativeSegments(directory) {
  const entries = await fs.readdir(path.join(directory, "segments"), { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && SEGMENT_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function readSettings(config) {
  const feed = config?.get?.("modules.tacticalFeedWriter", {}) ?? {};
  return {
    rootDir: path.resolve(String(feed.rootDir ?? "data/replay-spool")),
  };
}

function validateSessionId(value) {
  const id = String(value ?? "");
  if (!isSafeSessionId(id)) {
    const error = new Error("Invalid replay session id.");
    error.code = "InvalidReplaySessionId";
    error.statusCode = 400;
    throw error;
  }
  return id;
}

function isSafeSessionId(value) {
  return /^[A-Za-z0-9._-]{1,160}$/.test(String(value ?? ""));
}

async function resolveSessionDirectory(rootDir, sessionId) {
  const candidates = [
    path.join(rootDir, sessionId),
    path.join(rootDir, `${sessionId}.open`),
  ];
  for (const candidate of candidates) {
    try {
      const info = await fs.stat(candidate);
      if (info.isDirectory()) return candidate;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return null;
}

function clonePlainObject(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function clampInteger(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(numeric)));
}

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function nonNegativeInteger(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function nonNegativeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

export const TacticalReplayNativeFormat = Object.freeze({
  format: FORMAT,
  compression: "none",
  dictionary: false,
});
