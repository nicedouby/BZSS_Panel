// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const MODULE_ID = "module.playerSessionRecords";
const PAGE_ROUTE = "/player-session-records";
const DEFAULT_MAX_RECORDS = 5000;
const JOIN_DEDUP_WINDOW_MS = 30 * 1000;
const JOIN_EVENT_NAMES = ["PLAYER_POST_LOGIN", "On_PlayerConnected"];
const LEAVE_EVENT_NAMES = ["PLAYER_DISCONNECTED", "On_PlayerDisconnected", "PLAYER_LEFT", "On_PlayerLeft"];

export function createPlayerSessionRecordsModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({ moduleId: MODULE_ID, source: MODULE_ID, channel: "module" }) ?? core.logger;
  const moduleConfig = config?.get?.("modules.playerSessionRecords", {}) ?? {};
  const enabled = moduleConfig.enabled !== false;
  const maxRecords = Math.max(100, Number(moduleConfig.maxRecords ?? DEFAULT_MAX_RECORDS) || DEFAULT_MAX_RECORDS);
  const historyFilePath = path.resolve(process.cwd(), String(moduleConfig.filePath ?? "./data/player-session-records/history.jsonl"));
  const records = [];
  const presenceByKey = new Map();
  const recentJoinByAnchor = new Map();
  const unsubscribers = [];
  let persistQueue = Promise.resolve();

  const stats = { joinCount: 0, leaveCount: 0, lastJoinAt: "", lastLeaveAt: "" };
  const now = () => new Date().toISOString();
  const eventTime = (event, fallback = now()) => String(event?.time ?? fallback).trim() || fallback;
  const parseTime = (value) => Date.parse(String(value ?? "")) || Date.now();
  const text = (value) => String(value ?? "").trim();

  function resolveName(event = {}) {
    const payload = event.payload ?? {};
    const map = event.paramMap ?? {};
    return text(payload.name ?? payload.playerName ?? payload.PlayerName ?? map.PlayerName ?? map.playerName);
  }

  function resolveIp(event = {}) {
    const payload = event.payload ?? {};
    const map = event.paramMap ?? {};
    return text(payload.ip ?? payload.remoteAddr ?? payload.PlayerIP ?? map.PlayerIP ?? map.IP ?? map.ip ?? map.remoteAddr);
  }

  function resolveIdentity(event = {}) {
    const payload = event.payload ?? {};
    const map = event.paramMap ?? {};
    return {
      steam64Id: text(payload.steam64Id ?? payload.steam64ID ?? payload.steamID ?? payload.PlayerSteam64ID ?? map.PlayerSteam64ID ?? map.Steam64ID ?? map.PlayerSteamID ?? map.SteamID),
      eosId: text(payload.eosId ?? payload.eosID ?? payload.PlayerEOSID ?? map.PlayerEOSID ?? map.EOSID),
      controllerId: text(payload.playerControllerId ?? payload.controllerId ?? payload.controllerID ?? payload.PlayerControllerID ?? map.PlayerControllerID ?? map.ControllerID),
    };
  }

  function resolvePlayer(serverId, identity, fallbackName) {
    const state = modules?.playerState;
    const database = modules?.playerDatabase;
    const player = state?.getPlayerBySteamID?.(serverId, identity.steam64Id)
      ?? state?.getPlayerByEOSID?.(serverId, identity.eosId)
      ?? state?.getPlayerByControllerID?.(serverId, identity.controllerId)
      ?? state?.getPlayerByName?.(serverId, fallbackName);
    const cached = !player ? database?.getCachedPlayer?.({ steamID: identity.steam64Id, eosID: identity.eosId, name: fallbackName }) : null;
    return {
      playerName: text(player?.name ?? cached?.current_name ?? fallbackName),
      steam64Id: text(player?.steamID ?? player?.steam64ID ?? cached?.steam_id ?? identity.steam64Id),
      eosId: text(player?.eosID ?? cached?.eos_id ?? identity.eosId),
    };
  }

  // A Steam ID is the only stable cross-name key. EOS, IP and name are fallbacks
  // for the early log lines where Steam has not yet been resolved.
  function presenceKey(serverId, record = {}) {
    const id = text(record.steam64Id) || text(record.eosId) || text(record.ip).toLowerCase() || text(record.playerName).toLowerCase();
    return id ? `${text(serverId)}::${id}` : "";
  }

  function joinAnchor(event, identity = resolveIdentity(event)) {
    const serverId = text(event.serverId);
    const id = identity.steam64Id || identity.eosId || resolveIp(event);
    return serverId && id ? `${serverId}::${id}` : "";
  }

  function isJoin(event) {
    const name = text(event.eventName);
    if (!JOIN_EVENT_NAMES.includes(name) || !resolveIp(event)) return false;
    if (name !== "On_PlayerConnected") return true;
    return /\bLog(?:Net|Squad):\s*PostLogin:\s*NewPlayer:/i.test(String(event.rawLog ?? event.rawEvent?.Raw ?? ""));
  }

  function isLeave(event) {
    const name = text(event.eventName);
    if (!LEAVE_EVENT_NAMES.includes(name) || !resolveName(event)) return false;
    return name === "PLAYER_DISCONNECTED" || name === "On_PlayerDisconnected" || Boolean(resolveIp(event));
  }

  function createRecord(kind, event, resolved, identity) {
    const recordedAt = now();
    return {
      id: `presence_${Date.now()}_${Math.random().toString(16).slice(2, 9)}`,
      schema: "player-presence.v2",
      kind,
      at: recordedAt,
      time: eventTime(event, recordedAt),
      eventName: text(event.eventName),
      eventId: text(event.eventId),
      serverId: text(event.serverId),
      matchId: text(event.matchId ?? event.payload?.matchId),
      playerName: resolved.playerName,
      steam64Id: resolved.steam64Id,
      eosId: resolved.eosId,
      ip: resolveIp(event),
      source: text(event.source) || "event-bus",
      confidence: kind === "join" ? "authoritative" : "authoritative",
      hasPayload: Boolean(event.payload),
      hasParams: Array.isArray(event.params) && event.params.length > 0,
      hasParamMap: Boolean(event.paramMap),
    };
  }

  function rebuildState() {
    presenceByKey.clear();
    stats.joinCount = 0; stats.leaveCount = 0; stats.lastJoinAt = ""; stats.lastLeaveAt = "";
    for (const item of records) {
      if (item.kind === "join") {
        stats.joinCount += 1; stats.lastJoinAt = item.at || stats.lastJoinAt;
        const key = presenceKey(item.serverId, item);
        if (key) presenceByKey.set(key, {
          ...item, joinedAt: item.time || item.at, lastSeenAt: item.time || item.at, status: "online",
        });
      } else if (item.kind === "leave") {
        stats.leaveCount += 1; stats.lastLeaveAt = item.at || stats.lastLeaveAt;
        const key = presenceKey(item.serverId, item);
        if (key) presenceByKey.delete(key);
      }
    }
  }

  function enqueue(task) {
    persistQueue = persistQueue.then(task).catch((error) => moduleLogger?.warn?.("[PlayerSessionRecords] persistence failed", {
      operation: "playerSessionRecords.persistenceFailed", data: { message: String(error?.message ?? error) },
    }));
    return persistQueue;
  }

  async function append(record) {
    await fs.mkdir(path.dirname(historyFilePath), { recursive: true });
    await fs.appendFile(historyFilePath, `${JSON.stringify(record)}\n`, "utf8");
  }

  async function rewrite() {
    await fs.mkdir(path.dirname(historyFilePath), { recursive: true });
    await fs.writeFile(historyFilePath, records.map((item) => JSON.stringify(item)).join("\n") + (records.length ? "\n" : ""), "utf8");
  }

  async function load() {
    try {
      const source = await fs.readFile(historyFilePath, "utf8");
      for (const line of source.split(/\r?\n/).filter(Boolean).slice(-maxRecords)) {
        try {
          const item = JSON.parse(line);
          if (item && (item.kind === "join" || item.kind === "leave")) records.push({ ...item, schema: item.schema ?? "player-presence.v1" });
        } catch {}
      }
      rebuildState();
    } catch (error) {
      if (error?.code !== "ENOENT") moduleLogger?.warn?.("[PlayerSessionRecords] load file failed", {
        operation: "playerSessionRecords.loadFileFailed", data: { filePath: historyFilePath, message: String(error?.message ?? error) },
      });
    }
  }

  async function syncPlayerDatabase(record) {
    const database = modules?.playerDatabase;
    if (!database?.upsertFromPresence) return;
    const player = await database.upsertFromPresence({
      name: record.playerName || null, steamID: record.steam64Id || null, eosID: record.eosId || null, ip: record.ip || null,
    });
    if (!player?.id) return;
    const at = parseTime(record.time || record.at);
    if (record.kind === "join") await database.addSessionHistory?.(player.id, { joinedAt: at, source: record.eventName || "join" });
    else await database.closeOpenSessionHistory?.(player.id, { leftAt: at, source: record.eventName || "leave" });
  }

  function add(kind, event) {
    const identity = resolveIdentity(event);
    const resolved = resolvePlayer(text(event.serverId), identity, resolveName(event));
    const anchor = kind === "join" ? joinAnchor(event, identity) : "";
    const timestamp = parseTime(eventTime(event));

    // Legacy and raw-log post-login events describe one arrival. Upgrade the
    // existing row in memory and rewrite once, instead of appending a duplicate.
    const previous = anchor ? recentJoinByAnchor.get(anchor) : null;
    if (kind === "join" && previous && timestamp - previous.timestamp <= JOIN_DEDUP_WINDOW_MS) {
      const item = records.find((row) => row.id === previous.id);
      if (item) {
        const currentWins = text(event.eventName) === "PLAYER_POST_LOGIN" || item.eventName !== "PLAYER_POST_LOGIN";
        Object.assign(item, createRecord("join", event, resolved, identity), { id: item.id, at: item.at, eventName: currentWins ? text(event.eventName) : item.eventName });
        recentJoinByAnchor.set(anchor, { id: item.id, timestamp });
        rebuildState();
        void enqueue(rewrite);
        return;
      }
    }

    const record = createRecord(kind, event, resolved, identity);
    records.push(record);
    if (records.length > maxRecords) records.splice(0, records.length - maxRecords);
    if (kind === "join" && anchor) recentJoinByAnchor.set(anchor, { id: record.id, timestamp });
    rebuildState();
    void enqueue(() => append(record));
    void syncPlayerDatabase(record);

    if (kind === "leave" && record.playerName) moduleLogger?.info?.(`/xm ${record.playerName}离开了游戏`, {
      operation: "playerSessionRecords.leaveXm", data: { serverId: record.serverId, playerName: record.playerName, eventName: record.eventName },
    });
  }

  function query(filter = {}) {
    const queryText = text(filter.q ?? filter.playerName).toLowerCase();
    const kind = text(filter.kind).toLowerCase();
    const serverId = text(filter.serverId).toLowerCase();
    const matchId = text(filter.matchId).toLowerCase();
    const limit = Math.max(1, Math.min(2000, Number(filter.limit ?? 200) || 200));
    return records.slice().reverse().filter((item) => {
      if (kind && kind !== "all" && item.kind !== kind) return false;
      if (serverId && text(item.serverId).toLowerCase() !== serverId) return false;
      if (matchId && text(item.matchId).toLowerCase() !== matchId) return false;
      if (!queryText) return true;
      return [item.playerName, item.steam64Id, item.eosId, item.ip, item.eventName].some((value) => text(value).toLowerCase().includes(queryText));
    }).slice(0, limit);
  }

  function getState(options = {}) {
    const filter = typeof options === "number" ? { limit: options } : options;
    const online = Array.from(presenceByKey.values()).sort((a, b) => parseTime(b.joinedAt) - parseTime(a.joinedAt)).map((item) => ({
      ...item, durationMs: Math.max(0, Date.now() - parseTime(item.joinedAt)),
    }));
    return {
      enabled, maxRecords, totalCount: records.length, joinCount: stats.joinCount, leaveCount: stats.leaveCount,
      lastJoinAt: stats.lastJoinAt, lastLeaveAt: stats.lastLeaveAt, onlineCount: online.length,
      records: query(filter), online,
    };
  }

  function clearRecords() {
    records.splice(0); presenceByKey.clear(); recentJoinByAnchor.clear();
    stats.joinCount = 0; stats.leaveCount = 0; stats.lastJoinAt = ""; stats.lastLeaveAt = "";
    void enqueue(rewrite);
    return getState();
  }

  return {
    manifest: { id: MODULE_ID, name: "进出服记录", kind: "module", version: "2.0.0", description: "以真实日志为准的玩家进出服历史与当前在线态。" },
    apiName: "playerSessionRecords",
    api: { getState, getRecords: query, clearRecords },
    async start() {
      core.webRegistry?.registerPage?.({ id: "web.playerSessionRecords", title: "进出服记录", group: "管理", route: PAGE_ROUTE, pageModule: "/pages/player-session-records.js", source: MODULE_ID, description: "查询玩家进出服历史与当前在线状态。", required: false, enabled: true, order: 113, icon: "↔" });
      if (!enabled) return;
      await load();
      if (typeof core?.eventBus?.onCoreEvent !== "function") return;
      for (const eventName of JOIN_EVENT_NAMES) unsubscribers.push(core.eventBus.onCoreEvent(eventName, (event) => { if (isJoin(event)) add("join", event); }));
      for (const eventName of LEAVE_EVENT_NAMES) unsubscribers.push(core.eventBus.onCoreEvent(eventName, (event) => { if (isLeave(event)) add("leave", event); }));
      moduleLogger?.info?.(`[PlayerSessionRecords] started. records=${records.length}`);
    },
    async stop() {
      await persistQueue;
      for (const unsubscribe of unsubscribers.splice(0)) { try { unsubscribe(); } catch {} }
    },
  };
}
