// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const SCHEMA_VERSION = 2;
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;

export function createTacticalReplayStore(options = {}) {
  const dataDirectory = path.resolve(String(options.dataDirectory ?? "./data/tactical-replays"));
  const chunkDurationMs = clampInteger(options.chunkDurationMs, 2_000, 60_000, 10_000);
  const flushIntervalMs = clampInteger(options.flushIntervalMs, 100, 10_000, 500);
  const maxBufferedBytes = clampInteger(options.maxBufferedBytes, 16 * 1024, 32 * 1024 * 1024, 512 * 1024);
  const retentionDays = clampInteger(options.retentionDays, 1, 3650, 14);
  const playerIntervalMs = clampInteger(options.playerIntervalMs, 50, 60_000, 333);
  const assetIntervalMs = clampInteger(options.assetIntervalMs, 250, 300_000, 5_000);
  const logger = options.logger ?? console;

  const state = {
    started: false,
    lastError: "",
    recordedPlayerFrames: 0,
    recordedAssetFrames: 0,
    writtenBytes: 0,
    hiddenLegacySessions: 0,
  };

  let activeSession = null;
  let stopped = true;
  let flushTimer = null;
  let bufferedEntries = [];
  let bufferedBytes = 0;
  let writeChain = Promise.resolve();
  let metaChain = Promise.resolve();
  const closedRoundKeys = new Set();

  async function start() {
    if (state.started) return;
    state.started = true;
    stopped = false;
    await fs.mkdir(dataDirectory, { recursive: true });
    await cleanupExpiredSessions();
    flushTimer = setInterval(() => void flush(), flushIntervalMs);
    flushTimer.unref?.();
  }

  async function stop(reason = "service-stop") {
    if (!state.started) return;
    stopped = true;
    state.started = false;
    if (flushTimer) clearInterval(flushTimer);
    flushTimer = null;
    await closeActiveSession(reason);
    await flush();
    await writeChain;
    await metaChain;
  }

  async function ingestPlayerSample(payload = {}) {
    if (stopped) return;
    const session = await reconcileSession(payload.round, payload.snapshot);
    if (!session) return;
    appendFrame(session, {
      schemaVersion: SCHEMA_VERSION,
      type: "players",
      seq: session.nextSequence++,
      t: elapsedFor(session),
      at: new Date().toISOString(),
      revision: numberOrNull(payload.snapshot?.meta?.revision),
      scene: {
        meta: cloneJson(payload.snapshot?.meta ?? {}),
        server: cloneJson(payload.snapshot?.server ?? {}),
        match: cloneJson(payload.snapshot?.match ?? {}),
        teams: cloneArray(payload.snapshot?.teams),
        diagnostics: cloneJson(payload.snapshot?.diagnostics ?? {}),
      },
      players: cloneArray(payload.snapshot?.players),
    });
    state.recordedPlayerFrames += 1;
  }

  async function ingestAssetSample(payload = {}) {
    if (stopped) return;
    const session = await reconcileSession(payload.round, payload.snapshot);
    if (!session) return;
    appendFrame(session, {
      schemaVersion: SCHEMA_VERSION,
      type: "assets",
      seq: session.nextSequence++,
      t: elapsedFor(session),
      at: new Date().toISOString(),
      revision: numberOrNull(payload.snapshot?.meta?.revision),
      scene: {
        meta: cloneJson(payload.snapshot?.meta ?? {}),
        server: cloneJson(payload.snapshot?.server ?? {}),
        match: cloneJson(payload.snapshot?.match ?? {}),
        teams: cloneArray(payload.snapshot?.teams),
      },
      assets: {
        captureZones: cloneArray(payload.snapshot?.assets?.captureZones),
        fobs: cloneArray(payload.snapshot?.assets?.fobs),
        mainZones: cloneArray(payload.snapshot?.assets?.mainZones),
      },
    });
    state.recordedAssetFrames += 1;
  }

  async function reconcileSession(round = {}, snapshot = {}) {
    const descriptor = normalizeRoundDescriptor(round, snapshot);
    if (!descriptor.key || (!descriptor.map && !descriptor.layer)) return null;

    if (activeSession && activeSession.roundKey !== descriptor.key) {
      await closeActiveSession("round-changed");
    }

    if (descriptor.closed) {
      closedRoundKeys.add(descriptor.key);
      if (activeSession?.roundKey === descriptor.key) {
        await closeActiveSession("round-ended");
      }
      return null;
    }

    if (closedRoundKeys.has(descriptor.key)) return null;
    if (!activeSession) await openSession(descriptor, snapshot);
    return activeSession?.roundKey === descriptor.key ? activeSession : null;
  }

  async function openSession(descriptor, snapshot) {
    const now = new Date();
    const sessionId = buildSessionId(now, descriptor.layer || descriptor.map || "round");
    const directory = path.join(dataDirectory, sessionId);
    const chunksDirectory = path.join(directory, "chunks");
    await fs.mkdir(chunksDirectory, { recursive: true });

    activeSession = {
      schemaVersion: SCHEMA_VERSION,
      id: sessionId,
      status: "active",
      roundKey: descriptor.key,
      roundToken: descriptor.token,
      serverId: descriptor.serverId,
      serverName: firstText(snapshot?.server?.name),
      map: descriptor.map,
      layer: descriptor.layer,
      mode: descriptor.mode,
      roundStartedAt: descriptor.startedAt,
      startedAt: now.toISOString(),
      startedMs: now.getTime(),
      endedAt: "",
      endReason: "",
      durationMs: 0,
      lastFrameAt: "",
      nextSequence: 1,
      frameCounts: { players: 0, assets: 0 },
      fileBytes: 0,
      playerIntervalMs,
      assetIntervalMs,
      chunkDurationMs,
      directory,
      chunksDirectory,
      metaPath: path.join(directory, "meta.json"),
      timelinePath: path.join(directory, "timeline.json"),
      chunks: new Map(),
    };

    await persistMetadata(activeSession);
    logger.info?.(`Tactical replay v2 session started: ${sessionId}`);
  }

  async function closeActiveSession(reason = "service-stop") {
    const session = activeSession;
    if (!session) return;
    activeSession = null;
    await flush();
    await writeChain;
    session.status = "closed";
    session.endedAt = new Date().toISOString();
    session.endReason = reason;
    session.durationMs = Math.max(session.durationMs, Date.now() - session.startedMs);
    await persistMetadata(session);
    await metaChain;
    logger.info?.(`Tactical replay v2 session closed: ${session.id} (${reason})`);
  }

  function appendFrame(session, frame) {
    const chunkStartMs = Math.floor(frame.t / chunkDurationMs) * chunkDurationMs;
    const chunk = ensureChunk(session, chunkStartMs);
    const line = `${JSON.stringify(frame)}\n`;
    const bytes = Buffer.byteLength(line);
    bufferedEntries.push({ filePath: path.join(session.chunksDirectory, chunk.file), line });
    bufferedBytes += bytes;
    chunk.toMs = Math.max(chunk.toMs, frame.t);
    chunk.bytes += bytes;
    if (frame.type === "players") {
      chunk.playerFrames += 1;
      session.frameCounts.players += 1;
    } else {
      chunk.assetFrames += 1;
      session.frameCounts.assets += 1;
    }
    session.durationMs = Math.max(session.durationMs, frame.t);
    session.lastFrameAt = frame.at;
    session.fileBytes += bytes;
    state.writtenBytes += bytes;
    if (bufferedBytes >= maxBufferedBytes) void flush();
  }

  function ensureChunk(session, chunkStartMs) {
    let chunk = session.chunks.get(chunkStartMs);
    if (chunk) return chunk;
    chunk = {
      fromMs: chunkStartMs,
      toMs: chunkStartMs,
      file: `${String(chunkStartMs).padStart(12, "0")}.jsonl`,
      playerFrames: 0,
      assetFrames: 0,
      bytes: 0,
    };
    session.chunks.set(chunkStartMs, chunk);
    return chunk;
  }

  function flush() {
    if (bufferedEntries.length === 0) return writeChain;
    const batch = bufferedEntries;
    bufferedEntries = [];
    bufferedBytes = 0;
    const grouped = new Map();
    for (const entry of batch) {
      const lines = grouped.get(entry.filePath) ?? [];
      lines.push(entry.line);
      grouped.set(entry.filePath, lines);
    }

    writeChain = writeChain.then(async () => {
      for (const [filePath, lines] of grouped) {
        await fs.appendFile(filePath, lines.join(""), "utf8");
      }
      if (activeSession) await persistMetadata(activeSession);
    }).catch((error) => {
      state.lastError = error?.message ?? String(error);
      logger.warn?.(`Tactical replay flush failed: ${state.lastError}`);
    });
    return writeChain;
  }

  function persistMetadata(session) {
    const meta = serializeSession(session);
    const timeline = serializeTimeline(session);
    metaChain = metaChain.then(async () => {
      await atomicWriteJson(session.metaPath, meta);
      await atomicWriteJson(session.timelinePath, timeline);
    }).catch((error) => {
      state.lastError = error?.message ?? String(error);
      logger.warn?.(`Tactical replay metadata write failed: ${state.lastError}`);
    });
    return metaChain;
  }

  async function listSessions({ limit = 100, includeLegacy = false } = {}) {
    await fs.mkdir(dataDirectory, { recursive: true });
    const entries = await fs.readdir(dataDirectory, { withFileTypes: true });
    const sessions = [];
    let hiddenLegacySessions = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || !SESSION_ID_PATTERN.test(entry.name)) continue;
      try {
        const metadata = await readSessionMetadata(entry.name);
        if (!metadata) continue;
        if (Number(metadata.schemaVersion ?? 1) < SCHEMA_VERSION && !includeLegacy) {
          hiddenLegacySessions += 1;
          continue;
        }
        sessions.push(metadata);
      } catch {
        // Ignore partially written sessions.
      }
    }
    if (activeSession) {
      const current = serializeSession(activeSession);
      const index = sessions.findIndex((session) => session.id === current.id);
      if (index >= 0) sessions[index] = current;
      else sessions.push(current);
    }
    sessions.sort((left, right) => String(right.startedAt ?? "").localeCompare(String(left.startedAt ?? "")));
    state.hiddenLegacySessions = hiddenLegacySessions;
    return {
      sessions: sessions.slice(0, clampInteger(limit, 1, 1000, 100)),
      hiddenLegacySessions,
    };
  }

  async function getSession(sessionId) {
    const safeId = validateSessionId(sessionId);
    if (activeSession?.id === safeId) return serializeSession(activeSession);
    return readSessionMetadata(safeId);
  }

  async function readWindow(sessionId, options = {}) {
    const safeId = validateSessionId(sessionId);
    if (activeSession?.id === safeId) {
      await flush();
      await writeChain;
      await metaChain;
    }
    const session = await getSession(safeId);
    if (!session) throw createHttpError(404, "ReplaySessionNotFound", "Replay session was not found.");
    if (Number(session.schemaVersion ?? 1) < SCHEMA_VERSION) {
      throw createHttpError(410, "LegacyReplayUnsupported", "Legacy replay fragments are hidden. Record a new schema v2 replay.");
    }

    const fromMs = clampNumber(options.fromMs, 0, Number.MAX_SAFE_INTEGER, 0);
    const durationMs = clampNumber(options.durationMs, 500, 15_000, 6_000);
    const toMs = Math.min(Number(session.durationMs ?? Number.MAX_SAFE_INTEGER), fromMs + durationMs);
    const includeContext = options.includeContext !== false;
    const contextMs = includeContext ? clampNumber(options.contextMs, 0, chunkDurationMs, 1_000) : 0;
    const limit = clampInteger(options.limit, 1, 10_000, 3_000);
    const timeline = await readTimeline(safeId);
    const chunks = Array.isArray(timeline?.chunks) ? timeline.chunks : [];
    const scanFromMs = Math.max(0, fromMs - contextMs);
    const selected = chunks.filter((chunk) => Number(chunk.toMs) >= scanFromMs && Number(chunk.fromMs) <= toMs);
    if (includeContext) {
      const previous = [...chunks].reverse().find((chunk) => Number(chunk.toMs) < scanFromMs);
      if (previous && !selected.some((chunk) => chunk.file === previous.file)) selected.unshift(previous);
    }

    const frames = [];
    const contextByType = new Map();
    let hasMore = false;
    for (const chunk of selected) {
      const filePath = path.join(dataDirectory, safeId, "chunks", String(chunk.file));
      let text = "";
      try {
        text = await fs.readFile(filePath, "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      for (const line of text.split(/\r?\n/u)) {
        if (!line.trim()) continue;
        let frame;
        try { frame = JSON.parse(line); } catch { continue; }
        const t = Number(frame?.t);
        if (!Number.isFinite(t)) continue;
        if (t < fromMs) {
          if (includeContext) contextByType.set(String(frame.type), frame);
          continue;
        }
        if (t > toMs) continue;
        if (frames.length >= limit) {
          hasMore = true;
          break;
        }
        frames.push(frame);
      }
      if (hasMore) break;
    }

    const contextFrames = includeContext
      ? [...contextByType.values()].sort((left, right) => Number(left.t) - Number(right.t))
      : [];
    const combined = [...contextFrames, ...frames]
      .sort((left, right) => Number(left.t) - Number(right.t) || Number(left.seq) - Number(right.seq))
      .slice(0, limit);

    return {
      session,
      fromMs,
      toMs,
      durationMs,
      frames: combined,
      hasMore,
      nextFromMs: hasMore ? Number(combined.at(-1)?.t ?? toMs) + 1 : toMs,
      storage: {
        schemaVersion: SCHEMA_VERSION,
        chunkDurationMs,
        scannedChunks: selected.length,
      },
    };
  }

  function getStatus() {
    return {
      enabled: state.started && !stopped,
      schemaVersion: SCHEMA_VERSION,
      dataDirectory,
      playerIntervalMs,
      assetIntervalMs,
      chunkDurationMs,
      flushIntervalMs,
      retentionDays,
      bufferedFrames: bufferedEntries.length,
      bufferedBytes,
      activeSession: activeSession ? serializeSession(activeSession) : null,
      diagnostics: { ...state },
    };
  }

  async function readSessionMetadata(sessionId) {
    try {
      return JSON.parse(await fs.readFile(path.join(dataDirectory, sessionId, "meta.json"), "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async function readTimeline(sessionId) {
    try {
      return JSON.parse(await fs.readFile(path.join(dataDirectory, sessionId, "timeline.json"), "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return { schemaVersion: 1, chunks: [] };
      throw error;
    }
  }

  async function cleanupExpiredSessions() {
    const threshold = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let entries = [];
    try { entries = await fs.readdir(dataDirectory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || !SESSION_ID_PATTERN.test(entry.name)) continue;
      try {
        const metadata = await readSessionMetadata(entry.name);
        const endedMs = Date.parse(metadata?.endedAt || metadata?.startedAt || "");
        if (metadata?.status !== "active" && Number.isFinite(endedMs) && endedMs < threshold) {
          await fs.rm(path.join(dataDirectory, entry.name), { recursive: true, force: true });
        }
      } catch {
        // Cleanup must not block startup.
      }
    }
  }

  return {
    start,
    stop,
    ingestPlayerSample,
    ingestAssetSample,
    listSessions,
    getSession,
    readWindow,
    getStatus,
  };
}

function serializeSession(session) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: session.id,
    status: session.status,
    roundKey: session.roundKey,
    roundToken: session.roundToken,
    serverId: session.serverId,
    serverName: session.serverName,
    map: session.map,
    layer: session.layer,
    mode: session.mode,
    roundStartedAt: session.roundStartedAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    endReason: session.endReason,
    durationMs: Math.max(0, Number(session.durationMs ?? 0)),
    lastFrameAt: session.lastFrameAt,
    frameCounts: { ...session.frameCounts },
    fileBytes: session.fileBytes,
    playerIntervalMs: session.playerIntervalMs,
    assetIntervalMs: session.assetIntervalMs,
    storage: {
      format: "jsonl-chunks",
      timelineFile: "timeline.json",
      chunksDirectory: "chunks",
      chunkDurationMs: session.chunkDurationMs,
      chunkCount: session.chunks.size,
    },
  };
}

function serializeTimeline(session) {
  return {
    schemaVersion: SCHEMA_VERSION,
    sessionId: session.id,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationMs: Math.max(0, Number(session.durationMs ?? 0)),
    playerIntervalMs: session.playerIntervalMs,
    assetIntervalMs: session.assetIntervalMs,
    chunkDurationMs: session.chunkDurationMs,
    chunks: [...session.chunks.values()].sort((left, right) => left.fromMs - right.fromMs),
  };
}

function normalizeRoundDescriptor(round = {}, snapshot = {}) {
  const serverId = firstText(round.serverId, snapshot?.server?.serverId, snapshot?.meta?.serverId, "default");
  const map = firstText(round.map, snapshot?.server?.map, snapshot?.match?.map, snapshot?.match?.mapName);
  const layer = firstText(round.layer, snapshot?.server?.layer, snapshot?.match?.layer, snapshot?.match?.layerName);
  const mode = firstText(round.mode, snapshot?.server?.mode, snapshot?.match?.mode, snapshot?.match?.gameMode);
  const token = firstText(round.token, round.roundToken, round.key, `${map}|${layer}`);
  return {
    serverId,
    map,
    layer,
    mode,
    token,
    key: firstText(round.key, `${serverId}|${token}`),
    startedAt: firstText(round.startedAt, snapshot?.match?.startedAt, snapshot?.match?.startTime),
    closed: Boolean(round.closed),
  };
}

function elapsedFor(session) {
  return Math.max(0, Date.now() - session.startedMs);
}

function buildSessionId(date, layer) {
  const timestamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const slug = String(layer ?? "round").normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "round";
  return `${timestamp}_${slug}_${crypto.randomBytes(3).toString("hex")}`;
}

function validateSessionId(value) {
  const sessionId = String(value ?? "").trim();
  if (!SESSION_ID_PATTERN.test(sessionId)) throw createHttpError(400, "InvalidReplaySessionId", "Invalid replay session id.");
  return sessionId;
}

async function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

function createHttpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function cloneArray(value) {
  return Array.isArray(value) ? value.map((item) => cloneJson(item)) : [];
}

function cloneJson(value) {
  if (value == null || typeof value !== "object") return value ?? null;
  try { return structuredClone(value); } catch {}
  return JSON.parse(JSON.stringify(value));
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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
