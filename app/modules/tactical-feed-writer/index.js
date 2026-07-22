// -*- coding: utf-8 -*-
//
// Tactical replay spool writer.  This module deliberately owns no replay
// history in memory: it converts the existing tactical-state snapshot stream
// into small append-only segments that a separate process can consume later.

import { createHash } from "node:crypto";
import { mkdir, open, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const MAGIC = 0x50525a42; // "BZRP" in a little-endian uint32.
const VERSION = 1;
const HEADER_BYTES = 24;
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
  WRITER_HEARTBEAT: 0x71,
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

const DEFAULTS = Object.freeze({
  rootDir: "data/replay-spool",
  serverId: "",
  playerSampleMs: 333,
  sceneSampleMs: 5000,
  statsSampleMs: 2000,
  networkSampleMs: 10000,
  heartbeatMs: 10000,
  positionThresholdCm: 50,
  yawThresholdDegrees: 2,
  segmentDurationMs: 30000,
});

export function createTacticalFeedWriterModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.logger;
  const settings = readSettings(config);
  const state = createState();
  let started = false;
  let stopped = false;
  let unsubscribe = null;
  let timer = null;
  let writeChain = Promise.resolve();

  function enqueue(work) {
    writeChain = writeChain.then(work, work).catch((error) => {
      moduleLogger?.warn?.("Tactical feed writer operation failed.", {
        operation: "tacticalFeedWriter",
        data: { message: error?.message ?? String(error) },
      });
      state.lastError = error?.message ?? String(error);
    });
    return writeChain;
  }

  function acceptSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;
    state.latestSnapshot = snapshot;
    state.latestReceivedAt = Date.now();
    void enqueue(() => reconcile(Date.now()));
  }

  async function reconcile(now) {
    const snapshot = state.latestSnapshot;
    if (!snapshot) return;
    if (!state.session && isMatchActive(snapshot)) await beginSession(snapshot, now);
    if (!state.session) return;
    if (isMatchEnded(snapshot)) {
      await endSession("match-ended", now);
      return;
    }

    await rotateSegmentIfNeeded(now);
    if (now - state.lastPlayerSampleAt >= settings.playerSampleMs) {
      await writePlayerDelta(snapshot, now);
      state.lastPlayerSampleAt = now;
    }
    if (now - state.lastStatsSampleAt >= settings.statsSampleMs) {
      await writeStatsDelta(snapshot, now);
      state.lastStatsSampleAt = now;
    }
    if (now - state.lastNetworkSampleAt >= settings.networkSampleMs) {
      await writeNetworkDelta(snapshot, now);
      state.lastNetworkSampleAt = now;
    }
    if (now - state.lastSceneSampleAt >= settings.sceneSampleMs) {
      await writeSceneDelta(snapshot, now);
      state.lastSceneSampleAt = now;
    }
    if (now - state.lastHeartbeatAt >= settings.heartbeatMs) {
      await writeHeartbeat(now);
      state.lastHeartbeatAt = now;
    }
  }

  async function beginSession(snapshot, now) {
    const serverId = safeText(settings.serverId || snapshot?.server?.serverId || core.webStatus?.serverId || "server");
    const layer = safeText(snapshot?.server?.layer || snapshot?.match?.layer || "unknown");
    const sessionId = makeSessionId(serverId, layer, now);
    const root = path.resolve(settings.rootDir);
    const directory = path.join(root, `${sessionId}.open`);
    await mkdir(path.join(directory, "segments"), { recursive: true });
    state.session = { sessionId, serverId, directory, startedAt: now, layer };
    await writeJsonAtomic(path.join(directory, "session.json"), {
      version: VERSION,
      sessionId,
      serverId,
      startedAt: new Date(now).toISOString(),
      status: "recording",
      map: safeText(snapshot?.server?.map),
      layer,
      mode: safeText(snapshot?.server?.mode),
      payloadEncoding: "messagepack",
    });
    await writeFile(path.join(directory, "writer.lock"), `${process.pid}\n`, "utf8");
    await openSegment(now);
    await append(RECORD.SESSION_BEGIN, now, {
      sessionId,
      serverId,
      startedAt: new Date(now).toISOString(),
      map: safeText(snapshot?.server?.map),
      layer,
      mode: safeText(snapshot?.server?.mode),
    });
    await append(RECORD.MATCH_DELTA, now, compactMatch(snapshot));
    core.eventBus?.emitModuleEvent?.("module.tacticalFeedWriter", "sessionStarted", { sessionId, serverId, time: new Date(now).toISOString() });
  }

  async function endSession(reason, now = Date.now()) {
    if (!state.session) return;
    await append(RECORD.SESSION_END, now, { reason, endedAt: new Date(now).toISOString() });
    await closeSegment();
    const { directory, sessionId, serverId, startedAt } = state.session;
    await writeJsonAtomic(path.join(directory, "session.json"), {
      version: VERSION, sessionId, serverId,
      startedAt: new Date(startedAt).toISOString(), endedAt: new Date(now).toISOString(),
      status: "closed", reason, payloadEncoding: "messagepack",
    });
    core.eventBus?.emitModuleEvent?.("module.tacticalFeedWriter", "sessionEnded", { sessionId, serverId, reason, time: new Date(now).toISOString() });
    resetSessionState();
  }

  async function openSegment(now) {
    const id = String(state.segmentIndex).padStart(6, "0");
    const fileName = `${id}.open.rps`;
    const filePath = path.join(state.session.directory, "segments", fileName);
    state.segment = { id: state.segmentIndex, startedAt: now, filePath, closedPath: filePath.replace(/\.open\.rps$/, ".rps") };
    state.segmentHandle = await open(filePath, "a");
  }

  async function closeSegment() {
    if (!state.segment) return;
    await state.segmentHandle?.close?.();
    state.segmentHandle = null;
    await rename(state.segment.filePath, state.segment.closedPath);
    state.segment = null;
  }

  async function rotateSegmentIfNeeded(now) {
    if (!state.segment || now - state.segment.startedAt < settings.segmentDurationMs) return;
    await closeSegment();
    state.segmentIndex += 1;
    await openSegment(now);
  }

  async function append(type, now, payload) {
    if (!state.segmentHandle || !state.session) return;
    const body = encodeMessagePack(payload);
    const header = Buffer.allocUnsafe(HEADER_BYTES);
    header.writeUInt32LE(MAGIC, 0);
    header.writeUInt8(VERSION, 4);
    header.writeUInt8(type, 5);
    header.writeUInt16LE(0, 6);
    header.writeUInt32LE(state.sequence++, 8);
    header.writeUInt32LE(Math.max(0, Math.min(0xffffffff, now - state.session.startedAt)), 12);
    header.writeUInt32LE(body.length, 16);
    header.writeUInt32LE(crc32(body), 20);
    await state.segmentHandle.write(Buffer.concat([header, body]));
    state.recordCount += 1;
  }

  async function writePlayerDelta(snapshot, now) {
    const currentKeys = new Set();
    const changes = [];
    for (const player of snapshot.players ?? []) {
      const pid = ensurePlayerDictionary(player, now);
      if (pid == null) continue;
      currentKeys.add(pid);
      const next = normalizePlayer(player);
      const previous = state.players.get(pid);
      const delta = diffPlayer(previous, next, settings);
      if (delta.mask) changes.push([pid, delta.mask, ...delta.values]);
      state.players.set(pid, next);
    }
    const removed = [];
    for (const pid of state.players.keys()) {
      if (!currentKeys.has(pid)) { state.players.delete(pid); removed.push(pid); }
    }
    if (state.pendingDictionaryUpdates.length) {
      await append(RECORD.DICTIONARY_UPDATE, now, { players: state.pendingDictionaryUpdates.splice(0) });
    }
    if (changes.length) await append(RECORD.PLAYER_DELTA, now, { changes });
    if (removed.length) await append(RECORD.PLAYER_REMOVE, now, { ids: removed });
  }

  async function writeStatsDelta(snapshot, now) {
    const changes = [];
    for (const player of snapshot.players ?? []) {
      const pid = state.playerIds.get(playerKey(player));
      if (pid == null) continue;
      const next = normalizeStats(player?.combat);
      if (!sameValue(state.stats.get(pid), next)) { state.stats.set(pid, next); changes.push([pid, next]); }
    }
    if (changes.length) await append(RECORD.PLAYER_STATS_DELTA, now, { changes });
  }

  async function writeNetworkDelta(snapshot, now) {
    const changes = [];
    for (const player of snapshot.players ?? []) {
      const pid = state.playerIds.get(playerKey(player));
      if (pid == null) continue;
      const ping = integerOrNull(player?.network?.gamePing);
      const before = state.pings.get(pid);
      if (before == null || ping == null || Math.abs(before - ping) >= 5 || now - (state.lastPingAt.get(pid) ?? 0) >= 60000) {
        state.pings.set(pid, ping); state.lastPingAt.set(pid, now); changes.push([pid, ping]);
      }
    }
    if (changes.length) await append(RECORD.PLAYER_NETWORK_DELTA, now, { players: changes });
  }

  async function writeSceneDelta(snapshot, now) {
    await writeAssetCollection(RECORD.ZONE_DELTA, snapshot?.assets?.captureZones, state.zones, now, "zone");
    await writeAssetCollection(RECORD.MAIN_ZONE_DELTA, snapshot?.assets?.mainZones, state.mainZones, now, "mainZone");
    await writeAssetCollection(RECORD.VEHICLE_DELTA, snapshot?.assets?.vehicles, state.vehicles, now, "vehicle", RECORD.VEHICLE_REMOVE);
    await writeFobs(snapshot?.assets?.fobs, now);
  }

  async function writeAssetCollection(type, values, cache, now, prefix, removeType = null) {
    const next = new Map();
    const upsert = [];
    for (const value of Array.isArray(values) ? values : []) {
      const id = assetKey(prefix, value);
      next.set(id, normalizeAsset(value));
      if (!sameValue(cache.get(id), next.get(id))) upsert.push([id, next.get(id)]);
    }
    const removed = [...cache.keys()].filter((id) => !next.has(id));
    cache.clear(); for (const [id, value] of next) cache.set(id, value);
    if (upsert.length) await append(type, now, { upsert });
    if (removeType && removed.length) await append(removeType, now, { ids: removed });
  }

  async function writeFobs(values, now) {
    const next = new Map();
    for (const value of Array.isArray(values) ? values : []) next.set(assetKey("fob", value), normalizeAsset(value));
    const created = []; const changed = [];
    for (const [id, value] of next) {
      if (!state.fobs.has(id)) created.push([id, value]);
      else if (!sameValue(state.fobs.get(id), value)) changed.push([id, value]);
    }
    const removed = [...state.fobs.keys()].filter((id) => !next.has(id));
    state.fobs = next;
    if (created.length) await append(RECORD.FOB_CREATE, now, { fobs: created });
    if (changed.length) await append(RECORD.FOB_DELTA, now, { fobs: changed });
    if (removed.length) await append(RECORD.FOB_REMOVE, now, { ids: removed });
  }

  function ensurePlayerDictionary(player, now) {
    const key = playerKey(player); if (!key) return null;
    let pid = state.playerIds.get(key);
    if (pid != null) return pid;
    pid = state.nextPlayerId++;
    state.playerIds.set(key, pid);
    state.pendingDictionaryUpdates.push([pid, {
      key, name: safeText(player?.identity?.name), steamID: safeText(player?.identity?.steamID),
      eosID: safeText(player?.identity?.eosID), initialPlayerId: integerOrNull(player?.identity?.playerID),
    }]);
    return pid;
  }

  async function writeHeartbeat(now) {
    if (!state.session) return;
    await append(RECORD.WRITER_HEARTBEAT, now, { lastSequence: state.sequence - 1, segment: state.segment?.id ?? 0 });
    await writeJsonAtomic(path.join(state.session.directory, "heartbeat.json"), {
      sessionId: state.session.sessionId, updatedAt: new Date(now).toISOString(),
      lastSequence: state.sequence - 1, currentSegment: state.segment?.id ?? 0,
    });
  }

  function resetSessionState() {
    state.session = null; state.segment = null; state.segmentHandle = null; state.sequence = 0; state.segmentIndex = 0;
    state.players.clear(); state.stats.clear(); state.pings.clear(); state.lastPingAt.clear(); state.pendingDictionaryUpdates.length = 0; state.fobs.clear(); state.zones.clear(); state.mainZones.clear(); state.vehicles.clear();
  }

  return {
    manifest: { id: "module.tacticalFeedWriter", name: "Tactical Feed Writer", kind: "module", version: "1.0.0", description: "Writes incremental tactical-state replay spool segments.", defaultEnabled: true },
    apiName: "tacticalFeedWriter",
    api: {
      getDiagnostics: () => ({ activeSession: state.session?.sessionId ?? null, recordCount: state.recordCount, lastError: state.lastError, latestReceivedAt: state.latestReceivedAt }),
      getActiveSession: () => state.session ? { ...state.session } : null,
      forceStart: () => enqueue(() => beginSession(state.latestSnapshot, Date.now())),
      forceEnd: (reason = "manual") => enqueue(() => endSession(reason, Date.now())),
    },
    async start() {
      if (started) return; started = true; stopped = false;
      unsubscribe = modules.tacticalState?.subscribe?.(acceptSnapshot) ?? null;
      const initial = await modules.tacticalState?.getSnapshot?.(); if (initial) acceptSnapshot(initial);
      timer = setInterval(() => { if (!stopped) void enqueue(() => reconcile(Date.now())); }, Math.min(settings.playerSampleMs, 500));
      timer.unref?.();
    },
    async stop() {
      if (!started) return; stopped = true; started = false; clearInterval(timer); timer = null; unsubscribe?.(); unsubscribe = null;
      await enqueue(() => endSession("process-stopped", Date.now()));
    },
  };
}

function createState() { return { latestSnapshot: null, latestReceivedAt: 0, session: null, segment: null, segmentHandle: null, sequence: 0, segmentIndex: 0, nextPlayerId: 1, playerIds: new Map(), pendingDictionaryUpdates: [], players: new Map(), stats: new Map(), pings: new Map(), lastPingAt: new Map(), fobs: new Map(), zones: new Map(), mainZones: new Map(), vehicles: new Map(), lastPlayerSampleAt: 0, lastStatsSampleAt: 0, lastNetworkSampleAt: 0, lastSceneSampleAt: 0, lastHeartbeatAt: 0, recordCount: 0, lastError: "" }; }
function readSettings(config) { const value = config?.get?.("modules.tacticalFeedWriter", {}) ?? {}; return { ...DEFAULTS, ...value, rootDir: value.rootDir ?? DEFAULTS.rootDir }; }
function isMatchActive(snapshot) { return Boolean(safeText(snapshot?.server?.map) || safeText(snapshot?.server?.layer)) && !isMatchEnded(snapshot); }
function isMatchEnded(snapshot) { const text = [snapshot?.match?.state, snapshot?.match?.phase, snapshot?.server?.state, snapshot?.server?.phase].map(safeText).join(" "); return /waitingpostmatch|postmatch|matchended|ended/i.test(text); }
function makeSessionId(serverId, layer, now) { const stamp = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, ""); const suffix = createHash("sha1").update(`${serverId}:${layer}:${now}:${process.pid}`).digest("hex").slice(0, 4).toUpperCase(); return `${slug(serverId)}_${stamp}_${slug(layer)}_${suffix}`; }
function slug(value) { return safeText(value).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "unknown"; }
function playerKey(player) { return safeText(player?.identity?.key || player?.identity?.steamID || player?.identity?.eosID || player?.identity?.playerID || player?.identity?.name); }
function assetKey(prefix, value) { return `${prefix}:${safeText(value?.id || value?.fobId || value?.zoneId || value?.name || value?.vehicleId || JSON.stringify(value?.position ?? value?.location ?? ""))}`; }
function normalizePlayer(player) { const t = player?.telemetry ?? {}; const m = player?.match ?? {}; return { position: normalizePosition(t.position), yaw: normalizeYaw(t.yaw ?? t.rotation?.z), health: integerOrNull(t.health), presence: safeText(player?.presence?.state), team: integerOrNull(m.teamId), squad: integerOrNull(m.squadId), fireTeam: integerOrNull(t.fireTeamIndex), role: safeText(m.role || t.soldierClass), vehicle: safeText(player?.vehicle?.vehicleType), leader: Boolean(m.isLeader) }; }
function normalizeStats(value = {}) { return ["kills", "wounds", "deaths", "teamKills", "vehicleKills", "revives", "healPoints", "combatScore", "objectiveScore", "teamworkScore"].map((key) => integerOrNull(value?.[key])); }
function normalizePosition(value) { if (!value || typeof value !== "object") return null; const x = integerOrNull(value.x); const y = integerOrNull(value.y); const z = integerOrNull(value.z); return x == null || y == null || z == null ? null : [x, y, z]; }
function normalizeYaw(value) { const n = Number(value); return Number.isFinite(n) ? Math.round(((n % 360) + 360) % 360) : null; }
function normalizeAsset(value) { return canonicalize(value); }
function diffPlayer(before, next, settings) { if (!before) return { mask: FIELD.POSITION | FIELD.YAW | FIELD.HEALTH | FIELD.PRESENCE | FIELD.TEAM | FIELD.SQUAD | FIELD.FIRETEAM | FIELD.ROLE | FIELD.VEHICLE | FIELD.LEADER, values: playerValues(next, FIELD.POSITION | FIELD.YAW | FIELD.HEALTH | FIELD.PRESENCE | FIELD.TEAM | FIELD.SQUAD | FIELD.FIRETEAM | FIELD.ROLE | FIELD.VEHICLE | FIELD.LEADER) }; let mask = 0; if (distanceExceeded(before.position, next.position, settings.positionThresholdCm)) mask |= FIELD.POSITION; if (angleDelta(before.yaw, next.yaw) >= settings.yawThresholdDegrees) mask |= FIELD.YAW; if (before.health !== next.health) mask |= FIELD.HEALTH; if (before.presence !== next.presence) mask |= FIELD.PRESENCE; if (before.team !== next.team) mask |= FIELD.TEAM; if (before.squad !== next.squad) mask |= FIELD.SQUAD; if (before.fireTeam !== next.fireTeam) mask |= FIELD.FIRETEAM; if (before.role !== next.role) mask |= FIELD.ROLE; if (before.vehicle !== next.vehicle) mask |= FIELD.VEHICLE; if (before.leader !== next.leader) mask |= FIELD.LEADER; return { mask, values: playerValues(next, mask) }; }
function playerValues(value, mask) { const out = []; if (mask & FIELD.POSITION) out.push(value.position); if (mask & FIELD.YAW) out.push(value.yaw); if (mask & FIELD.HEALTH) out.push(value.health); if (mask & FIELD.PRESENCE) out.push(value.presence); if (mask & FIELD.TEAM) out.push(value.team); if (mask & FIELD.SQUAD) out.push(value.squad); if (mask & FIELD.FIRETEAM) out.push(value.fireTeam); if (mask & FIELD.ROLE) out.push(value.role); if (mask & FIELD.VEHICLE) out.push(value.vehicle); if (mask & FIELD.LEADER) out.push(value.leader); return out; }
function distanceExceeded(a, b, threshold) { if (!a || !b) return !sameValue(a, b); const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2]; return dx * dx + dy * dy + dz * dz >= threshold * threshold; }
function angleDelta(a, b) { if (a == null || b == null) return a === b ? 0 : Infinity; return Math.abs(((a - b + 540) % 360) - 180); }
function compactMatch(snapshot) { return { server: { map: safeText(snapshot?.server?.map), layer: safeText(snapshot?.server?.layer), mode: safeText(snapshot?.server?.mode), tickets: snapshot?.server?.tickets ?? null }, teams: snapshot?.teams ?? [] }; }
function safeText(value) { return String(value ?? "").trim(); }
function integerOrNull(value) { const n = Number(value); return Number.isFinite(n) ? Math.round(n) : null; }
function sameValue(a, b) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }
function canonicalize(value) { if (Array.isArray(value)) return value.map(canonicalize); if (!value || typeof value !== "object") return value; const output = {}; for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key]); return output; }
async function writeJsonAtomic(filePath, value) { const temp = `${filePath}.tmp`; await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8"); await rename(temp, filePath); }

function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function encodeMessagePack(value) { if (value === null || value === undefined) return Buffer.from([0xc0]); if (value === false) return Buffer.from([0xc2]); if (value === true) return Buffer.from([0xc3]); if (typeof value === "number") return encodeNumber(value); if (typeof value === "string") return encodeString(value); if (Array.isArray(value)) return encodeArray(value); if (typeof value === "object") return encodeMap(value); throw new TypeError(`Unsupported MessagePack value: ${typeof value}`); }
function encodeNumber(value) { if (Number.isInteger(value) && value >= 0 && value < 128) return Buffer.from([value]); if (Number.isInteger(value) && value >= -32 && value < 0) return Buffer.from([value & 0xff]); const b = Buffer.allocUnsafe(9); b.writeUInt8(0xcb, 0); b.writeDoubleBE(value, 1); return b; }
function encodeString(value) { const body = Buffer.from(value, "utf8"); if (body.length < 32) return Buffer.concat([Buffer.from([0xa0 | body.length]), body]); const head = Buffer.allocUnsafe(3); head.writeUInt8(0xda, 0); head.writeUInt16BE(body.length, 1); return Buffer.concat([head, body]); }
function encodeArray(value) { const items = value.map(encodeMessagePack); if (items.length < 16) return Buffer.concat([Buffer.from([0x90 | items.length]), ...items]); const head = Buffer.allocUnsafe(3); head.writeUInt8(0xdc, 0); head.writeUInt16BE(items.length, 1); return Buffer.concat([head, ...items]); }
function encodeMap(value) { const entries = Object.entries(value).filter(([, item]) => item !== undefined); const body = entries.flatMap(([key, item]) => [encodeString(key), encodeMessagePack(item)]); if (entries.length < 16) return Buffer.concat([Buffer.from([0x80 | entries.length]), ...body]); const head = Buffer.allocUnsafe(3); head.writeUInt8(0xde, 0); head.writeUInt16BE(entries.length, 1); return Buffer.concat([head, ...body]); }

export const TacticalReplayRecord = RECORD;
export const TacticalReplayField = FIELD;
export const TacticalReplayFormat = { MAGIC, VERSION, HEADER_BYTES, crc32, encodeMessagePack };
