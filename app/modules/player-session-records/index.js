// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const MODULE_ID = "module.playerSessionRecords";
const PAGE_ROUTE = "/player-session-records";
const DEFAULT_MAX_RECORDS = 2000;
const JOIN_DEDUP_WINDOW_MS = 30 * 1000;

const JOIN_EVENT_NAMES = ["PLAYER_POST_LOGIN", "On_PlayerConnected"];
const LEAVE_EVENT_NAMES = ["PLAYER_DISCONNECTED", "On_PlayerDisconnected", "PLAYER_LEFT", "On_PlayerLeft"];

export function createPlayerSessionRecordsModule({ core, modules, config, logger }) {
  const moduleLogger =
    logger ??
    core.createLogger?.({
      moduleId: MODULE_ID,
      source: MODULE_ID,
      channel: "module",
    }) ??
    core.logger;

  const moduleConfig = config?.get?.("modules.playerSessionRecords", {}) ?? {};
  const enabled = moduleConfig.enabled !== false;
  const maxRecords = Math.max(100, Number(moduleConfig.maxRecords ?? DEFAULT_MAX_RECORDS) || DEFAULT_MAX_RECORDS);
  const historyFilePath = path.resolve(
    process.cwd(),
    String(moduleConfig.filePath ?? "./data/player-session-records/history.jsonl"),
  );

  const unsubscribers = [];
  const records = [];
  const onlinePlayerKeys = new Set();
  const recentJoinIndexes = new Map();

  const stats = {
    joinCount: 0,
    leaveCount: 0,
    lastJoinAt: "",
    lastLeaveAt: "",
  };
  let persistQueue = Promise.resolve();

  function buildRecordId() {
    return `session_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  }

  function resolvePlayerName(event = {}) {
    const payload = event?.payload ?? {};
    const fromPayload = String(payload?.name ?? payload?.playerName ?? payload?.PlayerName ?? "").trim();
    if (fromPayload) return fromPayload;

    const fromParamMap = String(event?.paramMap?.PlayerName ?? event?.paramMap?.playerName ?? "").trim();
    if (fromParamMap) return fromParamMap;

    const params = Array.isArray(event?.params) ? event.params : [];
    for (const param of params) {
      if (String(param?.name ?? "") !== "PlayerName") continue;
      const value = String(param?.value ?? "").trim();
      if (value) return value;
    }

    return "";
  }

  function resolvePlayerIp(event = {}) {
    const payload = event?.payload ?? {};
    const fromPayload = String(payload?.ip ?? payload?.remoteAddr ?? payload?.PlayerIP ?? "").trim();
    if (fromPayload) return fromPayload;

    const fromParamMap = String(event?.paramMap?.PlayerIP ?? event?.paramMap?.ip ?? event?.paramMap?.remoteAddr ?? "").trim();
    if (fromParamMap) return fromParamMap;

    const params = Array.isArray(event?.params) ? event.params : [];
    for (const param of params) {
      if (!["PlayerIP", "IP", "remoteAddr"].includes(String(param?.name ?? ""))) continue;
      const value = String(param?.value ?? "").trim();
      if (value) return value;
    }

    return "";
  }

  function buildOnlineKey(serverId, playerName) {
    return `${String(serverId ?? "").trim()}::${String(playerName ?? "").trim().toLowerCase()}`;
  }

  function buildJoinAnchorKey(event = {}) {
    const serverId = String(event?.serverId ?? "").trim();
    const ip = resolvePlayerIp(event);
    if (!serverId || !ip) return "";
    return `${serverId}::${ip}`;
  }

  function resolvePlayerIdentity(event = {}) {
    const payload = event?.payload ?? {};
    const paramMap = event?.paramMap ?? {};

    const steam64Id = String(
      payload?.steam64Id
      ?? payload?.steam64ID
      ?? payload?.steamID
      ?? payload?.PlayerSteam64ID
      ?? paramMap?.PlayerSteam64ID
      ?? paramMap?.Steam64ID
      ?? paramMap?.PlayerSteamID
      ?? paramMap?.SteamID
      ?? "",
    ).trim();

    const eosId = String(
      payload?.eosId
      ?? payload?.eosID
      ?? payload?.PlayerEOSID
      ?? paramMap?.PlayerEOSID
      ?? paramMap?.EOSID
      ?? "",
    ).trim();

    const controllerId = String(
      payload?.playerControllerId
      ?? payload?.controllerId
      ?? payload?.controllerID
      ?? payload?.PlayerControllerID
      ?? paramMap?.PlayerControllerID
      ?? paramMap?.ControllerID
      ?? "",
    ).trim();

    return { steam64Id, eosId, controllerId };
  }

  function resolveCanonicalPlayer(serverId, identity = {}, fallbackName = "") {
    const playerState = modules?.playerState;
    const playerDatabase = modules?.playerDatabase;
    if (!playerState) {
      const cachedPlayer = playerDatabase?.getCachedPlayer?.({
        steamID: identity?.steam64Id,
        eosID: identity?.eosId,
        name: fallbackName,
      }) ?? null;
      return {
        name: String(cachedPlayer?.current_name ?? fallbackName ?? "").trim(),
        steam64Id: String(cachedPlayer?.steam_id ?? identity?.steam64Id ?? "").trim(),
        eosId: String(cachedPlayer?.eos_id ?? identity?.eosId ?? "").trim(),
      };
    }

    const player =
      playerState.getPlayerBySteamID?.(serverId, identity?.steam64Id)
      ?? playerState.getPlayerByEOSID?.(serverId, identity?.eosId)
      ?? playerState.getPlayerByControllerID?.(serverId, identity?.controllerId)
      ?? playerState.getPlayerByName?.(serverId, fallbackName);

    const cachedPlayer = (!player && playerDatabase?.getCachedPlayer)
      ? playerDatabase.getCachedPlayer({
        steamID: identity?.steam64Id,
        eosID: identity?.eosId,
        name: fallbackName,
      })
      : null;

    return {
      name: String(player?.name ?? cachedPlayer?.current_name ?? fallbackName ?? "").trim(),
      steam64Id: String(player?.steamID ?? player?.steam64ID ?? cachedPlayer?.steam_id ?? identity?.steam64Id ?? "").trim(),
      eosId: String(player?.eosID ?? cachedPlayer?.eos_id ?? identity?.eosId ?? "").trim(),
    };
  }

  function isAnchoredJoinEvent(event = {}) {
    const eventName = String(event?.eventName ?? "").trim();
    if (!JOIN_EVENT_NAMES.includes(eventName)) return false;

    const ip = resolvePlayerIp(event);
    if (!ip) return false;

    // Prefer the raw-log-derived post-login anchor. The legacy Python event is
    // kept only as a fallback for environments that do not emit PLAYER_POST_LOGIN.
    if (eventName === "On_PlayerConnected") {
      const rawLog = String(event?.rawLog ?? event?.rawEvent?.Raw ?? "");
      if (!/\bLog(?:Net|Squad):\s*PostLogin:\s*NewPlayer:/i.test(rawLog)) {
        return false;
      }
    }

    return true;
  }

  function isAnchoredLeaveEvent(event = {}) {
    const eventName = String(event?.eventName ?? "").trim();
    if (!LEAVE_EVENT_NAMES.includes(eventName)) return false;

    const playerName = resolvePlayerName(event);
    if (!playerName) return false;

    if (eventName === "PLAYER_DISCONNECTED" || eventName === "On_PlayerDisconnected") {
      return true;
    }

    return Boolean(resolvePlayerIp(event));
  }

  function pushRecord(kind, event = {}) {
    const fallbackPlayerName = resolvePlayerName(event);
    const ip = resolvePlayerIp(event);
    const serverId = String(event?.serverId ?? "").trim();
    const at = new Date().toISOString();
    const eventName = String(event?.eventName ?? "").trim();
    const anchorKey = kind === "join" ? buildJoinAnchorKey(event) : "";
    const identity = resolvePlayerIdentity(event);
    const resolvedPlayer = resolveCanonicalPlayer(serverId, identity, fallbackPlayerName);
    const playerName = resolvedPlayer.name;
    const steam64Id = resolvedPlayer.steam64Id;
    const eosId = resolvedPlayer.eosId;

    if (kind === "join" && anchorKey) {
      const previous = recentJoinIndexes.get(anchorKey);
      const previousRecord = Number.isInteger(previous?.index) ? records[previous.index] : null;
      const eventTimeMs = Date.parse(String(event?.time ?? at)) || Date.now();
      const withinWindow =
        previousRecord &&
        Number.isFinite(previous?.atMs) &&
        Math.abs(eventTimeMs - previous.atMs) <= JOIN_DEDUP_WINDOW_MS;

      if (
        withinWindow &&
        previousRecord &&
        previousRecord.kind === "join"
      ) {
        const preferCurrent = eventName === "PLAYER_POST_LOGIN" || previousRecord.eventName !== "PLAYER_POST_LOGIN";
        previousRecord.at = at;
        previousRecord.eventName = preferCurrent ? eventName : previousRecord.eventName;
        previousRecord.eventId = preferCurrent ? String(event?.eventId ?? "").trim() : previousRecord.eventId;
        previousRecord.time = preferCurrent ? String(event?.time ?? "").trim() : previousRecord.time;
        previousRecord.playerName = playerName || previousRecord.playerName;
        previousRecord.ip = ip || previousRecord.ip;
        previousRecord.eosId = eosId || previousRecord.eosId;
        previousRecord.steam64Id = steam64Id || previousRecord.steam64Id;
        previousRecord.hasPayload = previousRecord.hasPayload || Boolean(event?.payload);
        previousRecord.hasParams = previousRecord.hasParams || (Array.isArray(event?.params) && event.params.length > 0);
        previousRecord.hasParamMap = previousRecord.hasParamMap || Boolean(event?.paramMap);
        stats.lastJoinAt = at;
        recentJoinIndexes.set(anchorKey, { index: previous.index, atMs: eventTimeMs });
        void syncRecordEffects(previousRecord, kind, event);
        return;
      }
    }

    const record = {
      id: buildRecordId(),
      kind,
      at,
      eventName,
      eventId: String(event?.eventId ?? "").trim(),
      time: String(event?.time ?? "").trim(),
      serverId,
      playerName,
      ip,
      eosId,
      steam64Id,
      hasPayload: Boolean(event?.payload),
      hasParams: Array.isArray(event?.params) && event.params.length > 0,
      hasParamMap: Boolean(event?.paramMap),
    };

    records.push(record);
    if (records.length > maxRecords) {
      records.splice(0, records.length - maxRecords);
    }

    const onlineKey = buildOnlineKey(serverId, playerName);
    if (kind === "join") {
      stats.joinCount += 1;
      stats.lastJoinAt = at;
      if (playerName) onlinePlayerKeys.add(onlineKey);
      if (anchorKey) {
        const eventTimeMs = Date.parse(String(event?.time ?? at)) || Date.now();
        recentJoinIndexes.set(anchorKey, { index: records.length - 1, atMs: eventTimeMs });
      }
    } else {
      stats.leaveCount += 1;
      stats.lastLeaveAt = at;
      if (playerName) onlinePlayerKeys.delete(onlineKey);

      if (playerName) {
        moduleLogger?.info?.(`/xm ${playerName}离开了游戏`, {
          operation: "playerSessionRecords.leaveXm",
          data: {
            serverId,
            playerName,
            eventName: String(event?.eventName ?? "").trim(),
            eventId: String(event?.eventId ?? "").trim(),
          },
        });
      }
    }

    void syncRecordEffects(record, kind, event);
  }

  function enqueuePersist(task) {
    persistQueue = persistQueue.then(task).catch((error) => {
      moduleLogger?.warn?.("[PlayerSessionRecords] persistence failed", {
        operation: "playerSessionRecords.persistenceFailed",
        data: { message: String(error?.message ?? error) },
      });
    });
    return persistQueue;
  }

  async function appendRecordToFile(record) {
    await fs.mkdir(path.dirname(historyFilePath), { recursive: true });
    await fs.appendFile(historyFilePath, `${JSON.stringify(record)}\n`, "utf8");
  }

  async function loadRecordsFromFile() {
    try {
      const text = await fs.readFile(historyFilePath, "utf8");
      const lines = text.split(/\r?\n/).filter(Boolean);
      for (const line of lines.slice(-maxRecords)) {
        try {
          const record = JSON.parse(line);
          if (!record || typeof record !== "object") continue;
          records.push(record);
          if (record.kind === "join") {
            stats.joinCount += 1;
            stats.lastJoinAt = String(record.at ?? stats.lastJoinAt ?? "");
          } else if (record.kind === "leave") {
            stats.leaveCount += 1;
            stats.lastLeaveAt = String(record.at ?? stats.lastLeaveAt ?? "");
          }
        } catch {}
      }
    } catch (error) {
      if (String(error?.code ?? "") !== "ENOENT") {
        moduleLogger?.warn?.("[PlayerSessionRecords] load file failed", {
          operation: "playerSessionRecords.loadFileFailed",
          data: { filePath: historyFilePath, message: String(error?.message ?? error) },
        });
      }
    }
  }

  async function rewriteHistoryFile() {
    await fs.mkdir(path.dirname(historyFilePath), { recursive: true });
    const content = records.map((item) => JSON.stringify(item)).join("\n");
    await fs.writeFile(historyFilePath, content ? `${content}\n` : "", "utf8");
  }

  async function syncRecordEffects(record, kind, event = {}) {
    const playerDatabase = modules?.playerDatabase;
    if (!record) return;

    await enqueuePersist(async () => {
      await appendRecordToFile(record);
    });

    if (!playerDatabase?.upsertFromPresence) return;

    const identity = {
      name: record.playerName || null,
      steamID: record.steam64Id || null,
      eosID: record.eosId || null,
      ip: record.ip || null,
    };
    const player = await playerDatabase.upsertFromPresence(identity);
    if (!player?.id) return;

    const timeMs = Date.parse(String(record.time ?? record.at ?? "")) || Date.now();
    if (kind === "join") {
      await playerDatabase.addSessionHistory?.(player.id, {
        joinedAt: timeMs,
        source: record.eventName || "join",
      });
      return;
    }

    await playerDatabase.closeOpenSessionHistory?.(player.id, {
      leftAt: timeMs,
      source: record.eventName || "leave",
    });
  }

  function queryRecords(filter = {}) {
    const limit = Math.max(1, Number(filter?.limit ?? 200) || 200);
    const kind = String(filter?.kind ?? "").trim().toLowerCase();
    const serverId = String(filter?.serverId ?? "").trim().toLowerCase();
    const playerName = String(filter?.playerName ?? "").trim().toLowerCase();

    return records
      .slice()
      .reverse()
      .filter((item) => {
        if (kind && kind !== "all" && item.kind !== kind) return false;
        if (serverId && String(item.serverId ?? "").trim().toLowerCase() !== serverId) return false;
        if (playerName && !String(item.playerName ?? "").trim().toLowerCase().includes(playerName)) return false;
        return true;
      })
      .slice(0, limit);
  }

  function getState(limit = 200) {
    const rows = queryRecords({ limit });
    return {
      enabled,
      maxRecords,
      joinCount: stats.joinCount,
      leaveCount: stats.leaveCount,
      totalCount: records.length,
      onlineCount: onlinePlayerKeys.size,
      lastJoinAt: stats.lastJoinAt,
      lastLeaveAt: stats.lastLeaveAt,
      records: rows,
    };
  }

  function clearRecords() {
    records.splice(0, records.length);
    onlinePlayerKeys.clear();
    recentJoinIndexes.clear();
    stats.joinCount = 0;
    stats.leaveCount = 0;
    stats.lastJoinAt = "";
    stats.lastLeaveAt = "";
    void enqueuePersist(async () => {
      await rewriteHistoryFile();
    });
    return getState();
  }

  const api = {
    getState,
    getRecords: queryRecords,
    clearRecords,
  };

  return {
    manifest: {
      id: MODULE_ID,
      name: "进退服记录",
      kind: "module",
      version: "1.0.0",
      description: "追踪玩家加入与离开服务器事件，提供进退服记录查询页面。",
    },
    apiName: "playerSessionRecords",
    api,

    async start() {
      core.webRegistry?.registerPage?.({
        id: "web.playerSessionRecords",
        title: "进退服记录",
        group: "管理",
        route: PAGE_ROUTE,
        pageModule: "/pages/player-session-records.js",
        source: MODULE_ID,
        description: "追踪玩家进退服记录，并展示最近事件时间线。",
        required: false,
        enabled: true,
        order: 113,
        icon: "↔",
      });

      if (!enabled) {
        moduleLogger?.info?.("[PlayerSessionRecords] module disabled by config.");
        return;
      }

      if (typeof core?.eventBus?.onCoreEvent !== "function") {
        moduleLogger?.warn?.("[PlayerSessionRecords] eventBus.onCoreEvent unavailable.");
        return;
      }

      await loadRecordsFromFile();

      for (const eventName of JOIN_EVENT_NAMES) {
        unsubscribers.push(core.eventBus.onCoreEvent(eventName, (event) => {
          if (!isAnchoredJoinEvent(event)) return;
          if (eventName === "On_PlayerConnected" && buildJoinAnchorKey(event)) {
            const recent = recentJoinIndexes.get(buildJoinAnchorKey(event));
            if (recent && Number.isFinite(recent.atMs)) {
              const eventTimeMs = Date.parse(String(event?.time ?? new Date().toISOString())) || Date.now();
              if (Math.abs(eventTimeMs - recent.atMs) <= JOIN_DEDUP_WINDOW_MS) return;
            }
          }
          pushRecord("join", event);
        }));
      }

      for (const eventName of LEAVE_EVENT_NAMES) {
        unsubscribers.push(core.eventBus.onCoreEvent(eventName, (event) => {
          if (!isAnchoredLeaveEvent(event)) return;
          pushRecord("leave", event);
        }));
      }

      moduleLogger?.info?.(`[PlayerSessionRecords] started. maxRecords=${maxRecords}`);
    },

    async stop() {
      await persistQueue;
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe();
        } catch {}
      }
      moduleLogger?.info?.("[PlayerSessionRecords] stopped.");
    },
  };
}
