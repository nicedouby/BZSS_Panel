// -*- coding: utf-8 -*-

const MODULE_ID = "module.playerSessionRecords";
const PAGE_ROUTE = "/player-session-records";
const DEFAULT_MAX_RECORDS = 2000;

const JOIN_EVENT_NAMES = ["On_PlayerJoined", "PLAYER_JOINED", "On_PlayerConnected", "PLAYER_CONNECTED"];
const LEAVE_EVENT_NAMES = ["On_PlayerLeft", "PLAYER_LEFT", "On_PlayerDisconnected", "PLAYER_DISCONNECTED"];

export function createPlayerSessionRecordsModule({ core, config, logger }) {
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

  const unsubscribers = [];
  const records = [];
  const onlinePlayerKeys = new Set();

  const stats = {
    joinCount: 0,
    leaveCount: 0,
    lastJoinAt: "",
    lastLeaveAt: "",
  };

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

  function buildOnlineKey(serverId, playerName) {
    return `${String(serverId ?? "").trim()}::${String(playerName ?? "").trim().toLowerCase()}`;
  }

  function pushRecord(kind, event = {}) {
    const playerName = resolvePlayerName(event);
    const serverId = String(event?.serverId ?? "").trim();
    const at = new Date().toISOString();

    const record = {
      id: buildRecordId(),
      kind,
      at,
      eventName: String(event?.eventName ?? "").trim(),
      eventId: String(event?.eventId ?? "").trim(),
      time: String(event?.time ?? "").trim(),
      serverId,
      playerName,
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
    } else {
      stats.leaveCount += 1;
      stats.lastLeaveAt = at;
      if (playerName) onlinePlayerKeys.delete(onlineKey);
    }
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
    stats.joinCount = 0;
    stats.leaveCount = 0;
    stats.lastJoinAt = "";
    stats.lastLeaveAt = "";
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

      for (const eventName of JOIN_EVENT_NAMES) {
        unsubscribers.push(core.eventBus.onCoreEvent(eventName, (event) => {
          pushRecord("join", event);
        }));
      }

      for (const eventName of LEAVE_EVENT_NAMES) {
        unsubscribers.push(core.eventBus.onCoreEvent(eventName, (event) => {
          pushRecord("leave", event);
        }));
      }

      moduleLogger?.info?.(`[PlayerSessionRecords] started. maxRecords=${maxRecords}`);
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe();
        } catch {}
      }
      moduleLogger?.info?.("[PlayerSessionRecords] stopped.");
    },
  };
}
