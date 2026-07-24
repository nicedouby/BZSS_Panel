// -*- coding: utf-8 -*-
//
// Read-only player for the TacticalFeedWriter .rps spool.
// It rebuilds only the requested point in time and never keeps replay history
// in the web process.

import fs from "node:fs/promises";
import path from "node:path";

const MAGIC = 0x50525a42;
const VERSION = 1;
const HEADER_BYTES = 24;
const MAX_READ_CACHE_SESSIONS = 3;
const MAX_READ_CACHE_SEGMENTS = 8;
const RECORD = Object.freeze({
  SESSION_BEGIN: 0x01,
  DICTIONARY_UPDATE: 0x02,
  MATCH_DELTA: 0x03,
  PLAYER_DELTA: 0x11,
  PLAYER_REMOVE: 0x12,
  PLAYER_STATS_DELTA: 0x13,
  PLAYER_NETWORK_DELTA: 0x14,
  ZONE_DELTA: 0x20,
  MAIN_ZONE_DELTA: 0x21,
  FOB_CREATE: 0x30,
  FOB_DELTA: 0x31,
  FOB_REMOVE: 0x32,
  VEHICLE_DELTA: 0x40,
  VEHICLE_REMOVE: 0x41,
  SESSION_END: 0x7f,
});
const FIELD = Object.freeze({
  POSITION: 1 << 0,
  YAW: 1 << 1,
  HEALTH: 1 << 2,
  PRESENCE: 1 << 3,
  TEAM: 1 << 4,
  SQUAD: 1 << 5,
  FIRETEAM: 1 << 6,
  ROLE: 1 << 7,
  VEHICLE: 1 << 8,
  LEADER: 1 << 9,
});
const STAT_NAMES = [
  "kills",
  "wounds",
  "deaths",
  "teamKills",
  "vehicleKills",
  "revives",
  "healPoints",
  "combatScore",
  "objectiveScore",
  "teamworkScore",
];

export function createTacticalReplayPlayerModule({ config, logger }) {
  const settings = readSettings(config);
  const state = {
    started: false,
    lastError: "",
    lastReadAt: "",
    reads: 0,
    invalidRecords: 0,
    readCache: new Map(),
  };

  return {
    manifest: {
      id: "module.tacticalReplayPlayer",
      name: "Tactical Replay Player",
      kind: "module",
      version: "1.0.0",
      description: "Reads TacticalFeedWriter .rps sessions on demand.",
      defaultEnabled: true,
    },
    apiName: "tacticalReplayPlayer",
    api: {
      getStatus() {
        return {
          enabled: state.started,
          rootDir: settings.rootDir,
          reads: state.reads,
          invalidRecords: state.invalidRecords,
          lastReadAt: state.lastReadAt || null,
          lastError: state.lastError || null,
        };
      },
      listSessions: (options) => listSessions(settings, options),
      getSession: (sessionId) => getSession(settings, sessionId),
      readState: async (sessionId, options) => {
        state.reads += 1;
        state.lastReadAt = new Date().toISOString();
        try {
          return await readState(settings, sessionId, options, state.readCache);
        } catch (error) {
          state.lastError = error?.message ?? String(error);
          logger?.warn?.("Tactical replay read failed.", {
            operation: "tacticalReplayPlayer.readState",
            data: { sessionId, message: state.lastError },
          });
          throw error;
        }
      },
    },
    async start() {
      state.started = true;
    },
    async stop() {
      state.started = false;
      state.readCache.clear();
    },
  };
}

async function listSessions(settings, { limit = 100 } = {}) {
  await fs.mkdir(settings.rootDir, { recursive: true });
  const entries = await fs.readdir(settings.rootDir, { withFileTypes: true });
  const sessions = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeSessionId(entry.name)) continue;
    try {
      const session = await getSession(settings, entry.name);
      if (session) sessions.push(session);
    } catch (error) {
      // One interrupted or manually damaged archive must not hide all of the
      // healthy recordings from the replay page.
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
  const maximum = clampInteger(limit, 1, 1000, 100);
  return sessions.slice(0, maximum);
}

async function getSession(settings, sessionId) {
  const safeId = validateSessionId(sessionId);
  const directory = await resolveSessionDirectory(settings.rootDir, safeId);
  if (!directory) return null;
  let metadata;
  try {
    metadata = JSON.parse(await fs.readFile(path.join(directory, "session.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }

  const recovered = await recoverSessionHeader(directory);
  const enriched = {
    ...recovered,
    ...metadata,
    // Closed sessions written by the first recorder version accidentally
    // omitted these fields.  Prefer explicit metadata but repair it from the
    // immutable SESSION_BEGIN record when necessary.
    map: text(metadata.map || recovered.map),
    layer: text(metadata.layer || recovered.layer),
    mode: text(metadata.mode || recovered.mode),
    serverId: text(metadata.serverId || recovered.serverId),
    startedAt: metadata.startedAt || recovered.startedAt || "",
  };
  const startedMs = Date.parse(enriched.startedAt ?? "");
  const endedMs = Date.parse(enriched.endedAt ?? "");
  const durationMs = Number.isFinite(Number(enriched.durationMs))
    ? Math.max(0, Number(enriched.durationMs))
    : Number.isFinite(startedMs)
      ? Math.max(0, (Number.isFinite(endedMs) ? endedMs : Date.now()) - startedMs)
      : 0;

  return {
    ...enriched,
    id: enriched.sessionId ?? safeId.replace(/\.open$/i, ""),
    sessionId: enriched.sessionId ?? safeId.replace(/\.open$/i, ""),
    status: enriched.status ?? (enriched.endedAt ? "closed" : "recording"),
    durationMs,
    isPlayable: await hasReplayRecords(directory),
    rootDir: undefined,
  };
}

async function recoverSessionHeader(directory) {
  const segmentDirectory = path.join(directory, "segments");
  const names = (await fs.readdir(segmentDirectory, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isFile() && /^(\d{6})\.(?:open\.)?rps$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (!names.length) return {};

  const bytes = await fs.readFile(path.join(segmentDirectory, names[0]));
  if (bytes.length < HEADER_BYTES || bytes.readUInt32LE(0) !== MAGIC || bytes.readUInt8(4) !== VERSION) return {};
  const payloadLength = bytes.readUInt32LE(16);
  const recordEnd = HEADER_BYTES + payloadLength;
  if (bytes.readUInt8(5) !== RECORD.SESSION_BEGIN || recordEnd > bytes.length) return {};
  const payload = bytes.subarray(HEADER_BYTES, recordEnd);
  if (crc32(payload) !== bytes.readUInt32LE(20)) return {};
  const header = decodeMessagePack(payload);
  return header && typeof header === "object" ? header : {};
}

async function hasReplayRecords(directory) {
  const entries = await fs.readdir(path.join(directory, "segments"), { withFileTypes: true }).catch(() => []);
  const names = entries
    .filter((entry) => entry.isFile() && /^(\d{6})\.(?:open\.)?rps$/.test(entry.name))
    .map((entry) => entry.name);
  for (const name of names) {
    const info = await fs.stat(path.join(directory, "segments", name)).catch(() => null);
    if (info?.size > HEADER_BYTES) return true;
  }
  return false;
}

async function readState(settings, sessionId, { atMs = 0 } = {}, cacheRegistry = null) {
  const session = await getSession(settings, sessionId);
  if (!session) return null;

  const safeId = validateSessionId(sessionId);
  const directory = await resolveSessionDirectory(settings.rootDir, safeId);
  if (!directory) return null;
  const targetMs = Math.max(0, Number.isFinite(Number(atMs)) ? Number(atMs) : 0);
  const segmentInfo = await getReplaySegmentInfo(directory, session.status === "recording");

  // A preview normally advances forward through one session. Keep a bounded
  // cursor for that path instead of scanning every segment from byte zero for
  // every slider tick. Closed archives are immutable; open archives are reset
  // when a segment size changes.
  if (!cacheRegistry) {
    const entry = createReplayReadCursor(directory, segmentInfo, session);
    return readStateFromCursor(entry, session, targetMs);
  }

  let entry = cacheRegistry.get(safeId);
  if (!entry || entry.directory !== directory || entry.signature !== segmentInfo.signature) {
    entry = createReplayReadCursor(directory, segmentInfo, session);
    cacheRegistry.set(safeId, entry);
  }
  // Keep the cache bounded when an operator browses many old sessions.
  cacheRegistry.delete(safeId);
  cacheRegistry.set(safeId, entry);
  while (cacheRegistry.size > MAX_READ_CACHE_SESSIONS) {
    cacheRegistry.delete(cacheRegistry.keys().next().value);
  }

  // Serialize reads for one session. The browser coalesces requests, but this
  // also keeps direct callers from mutating the same replay cursor in parallel.
  const operation = (entry.pending ?? Promise.resolve()).then(() => readStateFromCursor(entry, session, targetMs));
  entry.pending = operation.catch(() => {});
  return operation;
}

async function getReplaySegmentInfo(directory, includeSizes) {
  const entries = await fs.readdir(path.join(directory, "segments"), { withFileTypes: true }).catch(() => []);
  const names = entries
    // Keep this expression as a regex literal. The previous double escaping
    // matched a backslash followed by "d", rather than 000000.rps or
    // 000000.open.rps, leaving every reconstructed replay map empty.
    .filter((entry) => entry.isFile() && /^(\d{6})\.((open\.)?rps)$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const sizes = includeSizes
    ? await Promise.all(names.map(async (name) => `${name}:${(await fs.stat(path.join(directory, "segments", name)).catch(() => ({ size: 0 }))).size}`))
    : names;
  return { names, signature: sizes.join("|") };
}

function createReplayReadCursor(directory, segmentInfo, session) {
  return {
    directory,
    segmentNames: segmentInfo.names,
    signature: segmentInfo.signature,
    sessionId: session.id,
    replay: createReplayState(session),
    segmentIndex: 0,
    offset: 0,
    lastAppliedMs: 0,
    initialized: false,
    pending: null,
    buffers: new Map(),
  };
}

async function readStateFromCursor(entry, session, targetMs) {
  if (targetMs < entry.lastAppliedMs || (targetMs === 0 && entry.initialized && entry.lastAppliedMs > 0)) {
    entry.replay = createReplayState(session);
    entry.segmentIndex = 0;
    entry.offset = 0;
    entry.lastAppliedMs = 0;
    entry.initialized = false;
    entry.buffers.clear();
  }

  await advanceReplayCursor(entry, targetMs);
  return {
    session,
    atMs: targetMs,
    resolvedAtMs: entry.lastAppliedMs,
    state: serializeReplayState(entry.replay, session, targetMs),
    diagnostics: {
      segments: entry.segmentNames.length,
      invalidRecords: entry.replay.invalidRecords,
      lastSequence: entry.replay.lastSequence,
      cached: entry.initialized,
    },
  };
}

async function advanceReplayCursor(entry, targetMs) {
  while (entry.segmentIndex < entry.segmentNames.length) {
    const segmentName = entry.segmentNames[entry.segmentIndex];
    const bytes = await readReplaySegment(entry, segmentName);
    let offset = entry.offset;
    while (offset + HEADER_BYTES <= bytes.length) {
      const magic = bytes.readUInt32LE(offset);
      const version = bytes.readUInt8(offset + 4);
      const elapsedMs = bytes.readUInt32LE(offset + 12);
      const payloadLength = bytes.readUInt32LE(offset + 16);
      const recordEnd = offset + HEADER_BYTES + payloadLength;

      if (magic !== MAGIC || version !== VERSION || payloadLength > bytes.length || recordEnd > bytes.length) {
        stateInvalidRecord(entry.replay);
        offset = bytes.length;
        break;
      }
      if (elapsedMs > targetMs) {
        entry.offset = offset;
        entry.initialized = true;
        return;
      }

      const payload = bytes.subarray(offset + HEADER_BYTES, recordEnd);
      if (crc32(payload) !== bytes.readUInt32LE(offset + 20)) {
        stateInvalidRecord(entry.replay);
        offset = recordEnd;
        continue;
      }

      try {
        applyRecord(entry.replay, bytes.readUInt8(offset + 5), decodeMessagePack(payload));
        entry.lastAppliedMs = elapsedMs;
      } catch {
        stateInvalidRecord(entry.replay);
      }
      offset = recordEnd;
      entry.offset = offset;
      entry.initialized = true;
    }
    entry.segmentIndex += 1;
    entry.offset = 0;
  }
  entry.initialized = true;
}

async function readReplaySegment(entry, segmentName) {
  const cached = entry.buffers.get(segmentName);
  if (cached) return cached;
  const bytes = await fs.readFile(path.join(entry.directory, "segments", segmentName));
  entry.buffers.set(segmentName, bytes);
  while (entry.buffers.size > MAX_READ_CACHE_SEGMENTS) entry.buffers.delete(entry.buffers.keys().next().value);
  return bytes;
}

function createReplayState(session) {
  return {
    server: {},
    match: {},
    teams: [],
    dictionary: new Map(),
    players: new Map(),
    stats: new Map(),
    pings: new Map(),
    zones: new Map(),
    mainZones: new Map(),
    fobs: new Map(),
    vehicles: new Map(),
    invalidRecords: 0,
    lastSequence: 0,
    session,
  };
}

function applyRecord(replay, type, payload) {
  if (payload && typeof payload === "object" && Number.isFinite(Number(payload.seq))) {
    replay.lastSequence = Number(payload.seq);
  }

  switch (type) {
    case RECORD.SESSION_BEGIN:
      replay.server = {
        ...replay.server,
        map: text(payload?.map),
        layer: text(payload?.layer),
        mode: text(payload?.mode),
        serverId: text(payload?.serverId),
      };
      return;
    case RECORD.MATCH_DELTA:
      replay.server = { ...replay.server, ...(payload?.server ?? {}) };
      replay.teams = Array.isArray(payload?.teams) ? payload.teams : replay.teams;
      return;
    case RECORD.DICTIONARY_UPDATE:
      for (const item of payload?.players ?? []) {
        if (Array.isArray(item) && item.length >= 2) replay.dictionary.set(String(item[0]), item[1] ?? {});
      }
      return;
    case RECORD.PLAYER_DELTA:
      for (const change of payload?.changes ?? []) applyPlayerChange(replay, change);
      return;
    case RECORD.PLAYER_REMOVE:
      for (const id of payload?.ids ?? []) {
        const key = String(id);
        replay.players.delete(key);
        replay.stats.delete(key);
        replay.pings.delete(key);
      }
      return;
    case RECORD.PLAYER_STATS_DELTA:
      for (const item of payload?.changes ?? []) {
        if (Array.isArray(item) && item.length >= 2) replay.stats.set(String(item[0]), item[1]);
      }
      return;
    case RECORD.PLAYER_NETWORK_DELTA:
      for (const item of payload?.players ?? []) {
        if (Array.isArray(item) && item.length >= 2) replay.pings.set(String(item[0]), item[1]);
      }
      return;
    case RECORD.ZONE_DELTA:
      applyAssetUpsert(replay.zones, payload?.upsert);
      return;
    case RECORD.MAIN_ZONE_DELTA:
      applyAssetUpsert(replay.mainZones, payload?.upsert);
      return;
    case RECORD.FOB_CREATE:
    case RECORD.FOB_DELTA:
      applyAssetUpsert(replay.fobs, payload?.fobs);
      return;
    case RECORD.VEHICLE_DELTA:
      applyAssetUpsert(replay.vehicles, payload?.upsert);
      return;
    case RECORD.FOB_REMOVE:
    case RECORD.VEHICLE_REMOVE:
      for (const id of payload?.ids ?? []) {
        const target = type === RECORD.FOB_REMOVE ? replay.fobs : replay.vehicles;
        target.delete(String(id));
      }
      return;
    default:
      return;
  }
}

function applyPlayerChange(replay, change) {
  if (!Array.isArray(change) || change.length < 2) return;
  const key = String(change[0]);
  let player = replay.players.get(key);
  if (!player) {
    player = {
      position: null,
      yaw: null,
      health: null,
      presence: "",
      team: null,
      squad: null,
      fireTeam: null,
      role: "",
      vehicle: "",
      leader: false,
    };
    replay.players.set(key, player);
  }

  const mask = Number(change[1]) || 0;
  let index = 2;
  if (mask & FIELD.POSITION) player.position = change[index++];
  if (mask & FIELD.YAW) player.yaw = change[index++];
  if (mask & FIELD.HEALTH) player.health = change[index++];
  if (mask & FIELD.PRESENCE) player.presence = text(change[index++]);
  if (mask & FIELD.TEAM) player.team = numberOrNull(change[index++]);
  if (mask & FIELD.SQUAD) player.squad = numberOrNull(change[index++]);
  if (mask & FIELD.FIRETEAM) player.fireTeam = numberOrNull(change[index++]);
  if (mask & FIELD.ROLE) player.role = text(change[index++]);
  if (mask & FIELD.VEHICLE) player.vehicle = text(change[index++]);
  if (mask & FIELD.LEADER) player.leader = Boolean(change[index++]);
}

function applyAssetUpsert(target, values) {
  for (const item of Array.isArray(values) ? values : []) {
    if (!Array.isArray(item) || item.length < 2) continue;
    target.set(String(item[0]), item[1] ?? {});
  }
}

function serializeReplayState(replay, session, atMs) {
  const players = [...replay.players.entries()]
    .map(([id, value]) => {
      const identity = resolveReplayIdentity(id, replay.dictionary.get(id));
      const stats = replay.stats.get(id);
      const position = vectorObject(value.position);
      const player = {
        identity: {
          key: text(identity.key || id),
          name: text(identity.name || identity.key || id),
          steamID: text(identity.steamID),
          eosID: text(identity.eosID),
          playerID: numberOrNull(identity.initialPlayerId),
        },
        match: {
          teamId: numberOrNull(value.team),
          squadId: numberOrNull(value.squad),
          fireTeamIndex: numberOrNull(value.fireTeam),
          isLeader: Boolean(value.leader),
          role: text(value.role),
        },
        telemetry: {
          position,
          yaw: numberOrNull(value.yaw),
          health: numberOrNull(value.health),
          fireTeamIndex: numberOrNull(value.fireTeam),
          hasPosition: Boolean(position),
          hasTelemetry: true,
        },
        presence: { state: text(value.presence) },
        vehicle: { vehicleType: text(value.vehicle) },
        network: { gamePing: numberOrNull(replay.pings.get(id)) },
        combat: statsToObject(stats),
      };
      return player;
    })
    .sort((left, right) => left.identity.name.localeCompare(right.identity.name));

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      revision: 0,
      replay: true,
      replayAtMs: atMs,
    },
    server: replay.server,
    match: replay.match,
    teams: replay.teams,
    players,
    assets: {
      captureZones: mapAssets(replay.zones),
      mainZones: mapAssets(replay.mainZones),
      fobs: mapAssets(replay.fobs),
      vehicles: mapAssets(replay.vehicles),
    },
    session: {
      id: session.id,
      status: session.status,
      map: session.map ?? replay.server.map ?? "",
      layer: session.layer ?? replay.server.layer ?? "",
      mode: session.mode ?? replay.server.mode ?? "",
    },
  };
}

function mapAssets(map) {
  return [...map.entries()].map(([id, value]) => ({
    ...(value && typeof value === "object" ? value : {}),
    id,
  }));
}

function resolveReplayIdentity(id, value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...source,
    key: text(source.key || id),
    name: resolveReplayPlayerName(id, source),
  };
}

function resolveReplayPlayerName(id, identity) {
  const source = identity && typeof identity === "object" ? identity : {};
  const candidates = [
    source.name,
    source.displayName,
    source.playerName,
    source.steamName,
    source.steamID,
    source.eosID,
    source.playerID,
  ];
  const name = candidates.map(text).find((candidate) => candidate && !isGenericReplayName(candidate));
  return name || "Player " + text(id || "unknown");
}

function isGenericReplayName(value) {
  return /^(unknown(?:\s+player)?|player\s+unknown|undefined|null|n\/a)$/i.test(text(value));
}

function statsToObject(values) {
  if (!Array.isArray(values)) return {};
  return Object.fromEntries(STAT_NAMES.map((name, index) => [name, numberOrNull(values[index])]));
}

function vectorObject(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  return {
    x: numberOrNull(value[0]),
    y: numberOrNull(value[1]),
    z: numberOrNull(value[2] ?? 0),
  };
}

function stateInvalidRecord(replay) {
  replay.invalidRecords += 1;
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

function clampInteger(value, minimum, maximum, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(maximum, Math.max(minimum, Math.floor(n))) : fallback;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value) {
  return String(value ?? "").trim();
}

function decodeMessagePack(buffer) {
  const cursor = { offset: 0 };
  const value = readMessagePackValue(buffer, cursor);
  if (cursor.offset !== buffer.length) throw new Error("Trailing MessagePack bytes.");
  return value;
}

function readMessagePackValue(buffer, cursor) {
  if (cursor.offset >= buffer.length) throw new Error("Unexpected end of MessagePack payload.");
  const head = buffer[cursor.offset++];

  if (head <= 0x7f) return head;
  if (head >= 0xe0) return head - 0x100;
  if ((head & 0xe0) === 0xa0) return readString(buffer, cursor, head & 0x1f);
  if ((head & 0xf0) === 0x90) return readArray(buffer, cursor, head & 0x0f);
  if ((head & 0xf0) === 0x80) return readMap(buffer, cursor, head & 0x0f);

  if (head === 0xc0) return null;
  if (head === 0xc2) return false;
  if (head === 0xc3) return true;
  if (head === 0xcb) {
    ensureRemaining(buffer, cursor, 8);
    const value = buffer.readDoubleBE(cursor.offset);
    cursor.offset += 8;
    return value;
  }
  if (head === 0xda) {
    ensureRemaining(buffer, cursor, 2);
    const length = buffer.readUInt16BE(cursor.offset);
    cursor.offset += 2;
    return readString(buffer, cursor, length);
  }
  if (head === 0xdc) {
    ensureRemaining(buffer, cursor, 2);
    const length = buffer.readUInt16BE(cursor.offset);
    cursor.offset += 2;
    return readArray(buffer, cursor, length);
  }
  if (head === 0xde) {
    ensureRemaining(buffer, cursor, 2);
    const length = buffer.readUInt16BE(cursor.offset);
    cursor.offset += 2;
    return readMap(buffer, cursor, length);
  }

  throw new Error("Unsupported MessagePack type: 0x" + head.toString(16));
}

function readString(buffer, cursor, length) {
  ensureRemaining(buffer, cursor, length);
  const value = buffer.subarray(cursor.offset, cursor.offset + length).toString("utf8");
  cursor.offset += length;
  return value;
}

function readArray(buffer, cursor, length) {
  const result = [];
  for (let index = 0; index < length; index += 1) result.push(readMessagePackValue(buffer, cursor));
  return result;
}

function readMap(buffer, cursor, length) {
  const result = {};
  for (let index = 0; index < length; index += 1) {
    const key = readMessagePackValue(buffer, cursor);
    result[String(key)] = readMessagePackValue(buffer, cursor);
  }
  return result;
}

function ensureRemaining(buffer, cursor, count) {
  if (cursor.offset + count > buffer.length) throw new Error("Unexpected end of MessagePack payload.");
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export const TacticalReplayPlayerFormat = Object.freeze({
  MAGIC,
  VERSION,
  HEADER_BYTES,
  crc32,
  decodeMessagePack,
  resolvePlayerName: resolveReplayPlayerName,
});
