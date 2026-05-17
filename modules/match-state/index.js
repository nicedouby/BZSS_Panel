// -*- coding: utf-8 -*-

import {
  parseCurrentMap,
  parseListPlayers,
  parseListSquads,
  parseNextMap,
} from "../../core/squad-rcon.js";

/**
 * Module: MatchState
 *
 * Active RCON polling aggregator for the current match state.
 * This module does not infer state from RCON push events.
 */
export function createMatchStateModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.matchState",
    source: "module.matchState",
    channel: "module",
  }) ?? core.logger;
  const moduleConfig = config.get("modules.matchState", {});
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const polling = {
    serverInfoIntervalMs: Number(moduleConfig.polling?.serverInfoIntervalMs ?? 5000),
    playersIntervalMs: Number(moduleConfig.polling?.playersIntervalMs ?? 3000),
    squadsIntervalMs: Number(moduleConfig.polling?.squadsIntervalMs ?? 5000),
    currentMapIntervalMs: Number(moduleConfig.polling?.currentMapIntervalMs ?? 15000),
    nextMapIntervalMs: Number(moduleConfig.polling?.nextMapIntervalMs ?? 30000),
  };

  const timers = [];
  const unsubscribers = [];
  const running = {
    serverInfo: false,
    players: false,
    squads: false,
    currentMap: false,
    nextMap: false,
  };

  const state = {
    serverId: core.webStatus.serverId,
    updatedAt: "",
    serverStatus: {
      map: "",
      layer: "",
      mode: "",
      nextLayer: "",
      nextLayerSource: "",
      playerCount: null,
      playerCountSource: "",
      maxPlayers: null,
      queueCount: null,
      playtime: null,
      tps: null,
      tpsStatus: "unknown",
      raw: "",
      fields: {},
      lastUpdatedAt: "",
    },
    match: {
      map: "",
      layer: "",
      mode: "",
      nextLayer: "",
      playtime: null,
      lastUpdatedAt: "",
    },
    players: makePlayersSnapshot([]),
    squads: {
      list: [],
      count: 0,
      lastUpdatedAt: "",
    },
    rconStatus: {
      lastError: "",
    },
    logAccess: {
      granted: false,
      pythonLogParser: "unknown",
      udpReceiver: "unknown",
      status: "unknown",
      lastUpdatedAt: "",
    },
  };

  function getSnapshot() {
    return {
      ...state,
      serverStatus: { ...state.serverStatus, fields: { ...state.serverStatus.fields } },
      match: { ...state.match },
      players: {
        list: [...state.players.list],
        bySteam64ID: { ...state.players.bySteam64ID },
        byEOSID: { ...state.players.byEOSID },
        byControllerID: { ...state.players.byControllerID },
        byName: { ...state.players.byName },
        count: state.players.count,
        lastUpdatedAt: state.players.lastUpdatedAt,
      },
      squads: {
        list: [...state.squads.list],
        count: state.squads.count,
        lastUpdatedAt: state.squads.lastUpdatedAt,
      },
      rconStatus: { ...state.rconStatus },
      logAccess: { ...state.logAccess },
    };
  }

  const api = {
    getState: getSnapshot,

    getOverview() {
      const snapshot = getSnapshot();
      return {
        status: core.webStatus.getSnapshot(),
        matchState: snapshot,
        serverStatus: snapshot.serverStatus,
        match: snapshot.match,
        players: snapshot.players.list,
        squads: snapshot.squads.list,
        rconStatus: snapshot.rconStatus,
        logAccess: snapshot.logAccess,
      };
    },

    async refresh(type = "all") {
      const report = {
        ok: true,
        errors: [],
      };

      if (type === "serverInfo" || type === "all") await refreshServerInfo(report);
      if (type === "players" || type === "all") await refreshPlayers(report);
      if (type === "squads" || type === "all") await refreshSquads(report);
      if (type === "currentMap" || type === "all") await refreshCurrentMap(report);
      if (type === "nextMap" || type === "all") await refreshNextMap(report);
      return {
        ok: report.ok,
        type,
        matchState: getSnapshot(),
        overview: api.getOverview(),
        errors: report.errors,
      };
    },
  };

  // MatchState 的实时能力来自轮询与状态广播。
  // 订阅关闭时不销毁模块，只是停止新的轮询更新与对应事件发射。
  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.("module.matchState") !== false
      && core.pluginSubscriptions?.isSubscribed?.("module.matchState") !== false;
  }

  async function refreshServerInfo(report = null) {
    return guarded("serverInfo", async () => {
      const result = await executeRcon("ShowServerInfo");
      if (!result.success) {
        noteRefreshFailure(report, "serverInfo", result.message || "ShowServerInfo failed.");
        updateStatuses();
        emitRconStatusUpdated();
        return state.serverStatus;
      }

      const parsed = parseShowServerInfo(result.rconResponse);
      const next = mergeServerStatus(state.serverStatus, parsed, result.rconResponse);

      if (!next.map || !next.layer) {
        const currentMap = await fetchCurrentMap();
        next.map = next.map || currentMap.level || "";
        next.layer = next.layer || currentMap.layer || "";
      }

      state.serverStatus = next;
      syncMatchFromServerStatus();
      updateWebStatus();
      logWithFallback(moduleLogger, "debug", () => "Server info refreshed.", {
        operation: "refreshServerInfo",
        data: {
          map: next.map,
          layer: next.layer,
          playerCount: next.playerCount,
          tps: next.tps,
        },
      });
      emitServerStatusUpdated();
      emitUpdated("serverStatus");
      return state.serverStatus;
    }, () => state.serverStatus, report);
  }

  async function refreshPlayers(report = null) {
    return guarded("players", async () => {
      const result = await executeRcon("ListPlayers");
      if (!result.success) {
        noteRefreshFailure(report, "players", result.message || "ListPlayers failed.");
        updateStatuses();
        emitRconStatusUpdated();
        return state.players.list;
      }

      const players = parseListPlayers(result.rconResponse);
      state.players = makePlayersSnapshot(players);
      if (!state.serverStatus.playerCountSource || state.serverStatus.playerCountSource !== "serverInfo") {
        state.serverStatus.playerCount = players.length;
        state.serverStatus.playerCountSource = "listPlayers";
      }
      syncMatchFromServerStatus();
      updateWebStatus();

      const event = makeEvent("RCON_LIST_PLAYERS_UPDATED", { players });
      logWithFallback(moduleLogger, "debug", () => `Players refreshed (${players.length})`, {
        operation: "refreshPlayers",
        data: {
          players: players.length,
        },
      });
      core.eventBus.emitCoreEvent("RCON_LIST_PLAYERS_UPDATED", event);
      emitPlayersUpdated();
      emitUpdated("players");
      return players;
    }, () => state.players.list, report);
  }

  async function refreshSquads(report = null) {
    return guarded("squads", async () => {
      const result = await executeRcon("ListSquads");
      if (!result.success) {
        noteRefreshFailure(report, "squads", result.message || "ListSquads failed.");
        updateStatuses();
        emitRconStatusUpdated();
        return state.squads.list;
      }

      const squads = parseListSquads(result.rconResponse);
      state.squads = {
        list: squads,
        count: squads.length,
        lastUpdatedAt: new Date().toISOString(),
      };
      updateWebStatus();
      logWithFallback(moduleLogger, "debug", () => `Squads refreshed (${squads.length})`, {
        operation: "refreshSquads",
        data: {
          squads: squads.length,
        },
      });

      const event = makeEvent("RCON_LIST_SQUADS_UPDATED", { squads });
      core.eventBus.emitCoreEvent("RCON_LIST_SQUADS_UPDATED", event);
      emitSquadsUpdated();
      emitUpdated("squads");
      return squads;
    }, () => state.squads.list, report);
  }

  async function refreshCurrentMap(report = null) {
    return guarded("currentMap", async () => {
      const currentMap = await fetchCurrentMap();
      if (currentMap.level || currentMap.layer) {
        state.serverStatus.map = currentMap.level || state.serverStatus.map || "";
        state.serverStatus.layer = currentMap.layer || state.serverStatus.layer || "";
        state.serverStatus.lastUpdatedAt = new Date().toISOString();
        syncMatchFromServerStatus();
        updateWebStatus();
        emitServerStatusUpdated();
        emitUpdated("currentMap");
      }
      return currentMap;
    }, () => ({
      level: state.serverStatus.map || null,
      layer: state.serverStatus.layer || null,
    }), report);
  }

  async function refreshNextMap(report = null) {
    return guarded("nextMap", async () => {
      if (state.serverStatus.nextLayerSource === "serverInfo") return null;

      const result = await executeRcon("ShowNextMap");
      if (!result.success) {
        noteRefreshFailure(report, "nextMap", result.message || "ShowNextMap failed.");
        updateStatuses();
        emitRconStatusUpdated();
        return {
          level: null,
          layer: state.serverStatus.nextLayer || null,
        };
      }

      const nextMap = parseNextMap(result.rconResponse);
      if (nextMap.layer && !isSameLayer(nextMap.layer, state.serverStatus.layer || state.match.layer || state.serverStatus.map)) {
        state.serverStatus.nextLayer = nextMap.layer;
        state.serverStatus.nextLayerSource = "showNextMap";
        state.serverStatus.lastUpdatedAt = new Date().toISOString();
        syncMatchFromServerStatus();
        updateWebStatus();
        emitServerStatusUpdated();
        emitUpdated("nextMap");
      }
      return nextMap;
    }, () => ({
      level: null,
      layer: state.serverStatus.nextLayer || null,
    }), report);
  }

  async function fetchCurrentMap() {
    const result = await executeRcon("ShowCurrentMap");
    if (!result.success) return { level: null, layer: null };
    return parseCurrentMap(result.rconResponse);
  }

  async function executeRcon(command) {
    return core.rconManager.dispatchCommand({
      command,
      requestedBy: "module.matchState",
      reason: "match-state-poll",
    });
  }

  async function guarded(key, fn, fallback = null, report = null) {
    if (!isSubscribed()) {
      noteRefreshFailure(report, key, "Match state module is not subscribed.");
      return typeof fallback === "function" ? fallback() : fallback;
    }
    if (running[key]) return typeof fallback === "function" ? fallback() : fallback;
    running[key] = true;
    try {
      updateStatuses();
      return await fn();
    } catch (error) {
      noteRefreshFailure(report, key, error?.message ?? String(error));
      logWithFallback(moduleLogger, "warn", `${key} polling failed: ${error.message}`, {
        operation: "guarded",
      });
      updateStatuses();
      emitRconStatusUpdated();
      return typeof fallback === "function" ? fallback() : fallback;
    } finally {
      running[key] = false;
    }
  }

  function noteRefreshFailure(report, section, message) {
    if (!report) return;
    report.ok = false;
    report.errors.push({
      section,
      message: String(message ?? "Refresh failed."),
    });
  }

  function syncMatchFromServerStatus() {
    state.match = {
      map: state.serverStatus.map || "",
      layer: state.serverStatus.layer || "",
      mode: state.serverStatus.mode || "",
      nextLayer: state.serverStatus.nextLayer || "",
      playtime: state.serverStatus.playtime,
      lastUpdatedAt: state.serverStatus.lastUpdatedAt,
    };
  }

  function updateStatuses() {
    const webSnapshot = core.webStatus.getSnapshot();
    const rconStatus = core.rconManager.getStatus();
    const logAccessGranted = webSnapshot.pythonLogParser === "running" || webSnapshot.udpReceiver === "listening";

    state.rconStatus = {
      ...rconStatus,
      status: rconStatus.connected ? "connected" : (rconStatus.enabled ? "disconnected" : "disabled"),
      lastUpdatedAt: new Date().toISOString(),
    };

    state.logAccess = {
      granted: logAccessGranted,
      pythonLogParser: webSnapshot.pythonLogParser ?? "unknown",
      udpReceiver: webSnapshot.udpReceiver ?? "unknown",
      status: logAccessGranted ? "granted" : "missing",
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  function updateWebStatus() {
    updateStatuses();

    core.webStatus.patch({
      map: state.serverStatus.map || "",
      layer: state.serverStatus.layer || "",
      mode: state.serverStatus.mode || "",
      nextLayer: state.serverStatus.nextLayer || "",
      playerCount: Number(state.serverStatus.playerCount ?? state.players.count ?? 0),
      maxPlayers: state.serverStatus.maxPlayers,
      queueCount: state.serverStatus.queueCount ?? 0,
      tps: state.serverStatus.tps,
      tpsStatus: state.serverStatus.tpsStatus,
      playtime: state.serverStatus.playtime,
      rconStatus: state.rconStatus.status,
      logAccessGranted: state.logAccess.granted,
      squadCount: state.squads.count,
      currentLayer: state.serverStatus.layer || "",
      matchState: formatMatchStateLabel(state.match),
    });
  }

  function emitUpdated(changed) {
    state.updatedAt = new Date().toISOString();
    updateStatuses();

    const event = makeEvent("module.matchState.updated", {
      changed,
      matchState: getSnapshot(),
      serverStatus: { ...state.serverStatus },
      match: { ...state.match },
      players: state.players.list,
      squads: state.squads.list,
      rconStatus: { ...state.rconStatus },
      logAccess: { ...state.logAccess },
    });

    core.eventBus.emitModuleEvent("module.matchState", "updated", event);
    core.eventBus.emitCoreEvent("RCON_MATCH_STATE_UPDATED", {
      ...event,
      eventName: "RCON_MATCH_STATE_UPDATED",
      layer: "core",
      source: "module.matchState",
    });
  }

  function emitServerStatusUpdated() {
    core.eventBus.emitModuleEvent("module.matchState", "serverStatusUpdated", makeEvent("module.matchState.serverStatusUpdated", {
      serverStatus: { ...state.serverStatus },
      match: { ...state.match },
    }));
  }

  function emitPlayersUpdated() {
    core.eventBus.emitModuleEvent("module.matchState", "playersUpdated", makeEvent("module.matchState.playersUpdated", {
      players: state.players.list,
      indexes: {
        bySteam64ID: { ...state.players.bySteam64ID },
        byEOSID: { ...state.players.byEOSID },
        byControllerID: { ...state.players.byControllerID },
        byName: { ...state.players.byName },
      },
    }));
  }

  function emitSquadsUpdated() {
    core.eventBus.emitModuleEvent("module.matchState", "squadsUpdated", makeEvent("module.matchState.squadsUpdated", {
      squads: state.squads.list,
    }));
  }

  function emitRconStatusUpdated() {
    core.eventBus.emitModuleEvent("module.matchState", "rconStatusUpdated", makeEvent("module.matchState.rconStatusUpdated", {
      rconStatus: { ...state.rconStatus },
    }));
  }

  function makeEvent(eventName, patch = {}) {
    return {
      eventId: `${eventName}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
      eventName,
      layer: eventName.startsWith("module.") ? "module" : "core",
      source: "module.matchState",
      serverId: state.serverId,
      time: new Date().toISOString(),
      params: [],
      ...patch,
    };
  }

  function startTimer(fn, intervalMs) {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;
    timers.push(setInterval(() => {
      fn().catch((error) => logWithFallback(moduleLogger, "warn", `timer failed: ${error.message}`, {
        operation: "timer",
      }));
    }, intervalMs));
  }

  return {
    manifest: { id: "module.matchState", name: "Match State Module", kind: "module", version: "0.2.0", description: "对局全局状态聚合模块。订阅地图切换、回合开始/结束、票数变化、队伍得分等核心事件，维护当前对局的地图、图层、下一张图、队伍人数与得分等完整快照。对局状态前端页面直接读取本模块的 getOverview() 接口进行展示。" },
    apiName: "matchState",
    api,

    async start() {
      core.webRegistry.registerPage({
        id: "web.killManage",
        title: "战斗事件管理",
        group: "管理",
        route: "/kill-manage",
        pageModule: "/pages/kill-manage.js",
        source: "module.combatState",
        required: false,
        enabled: true,
        order: 110,
        icon: "🎯",
      });

      if (!enabled) return;

      unsubscribers.push(core.eventBus.onCoreEvent("RCON_CONNECTED", () => {
        if (!isSubscribed()) return;
        updateStatuses();
        emitRconStatusUpdated();
      }));
      unsubscribers.push(core.eventBus.onCoreEvent("RCON_DISCONNECTED", () => {
        if (!isSubscribed()) return;
        updateStatuses();
        emitRconStatusUpdated();
      }));
      unsubscribers.push(core.eventBus.onCoreEvent("RCON_ERROR", () => {
        if (!isSubscribed()) return;
        updateStatuses();
        emitRconStatusUpdated();
      }));

      updateWebStatus();
      refreshServerInfo();
      refreshPlayers();
      refreshSquads();
      refreshCurrentMap();
      refreshNextMap();

      startTimer(refreshServerInfo, polling.serverInfoIntervalMs);
      startTimer(refreshPlayers, polling.playersIntervalMs);
      startTimer(refreshSquads, polling.squadsIntervalMs);
      startTimer(refreshCurrentMap, polling.currentMapIntervalMs);
      startTimer(refreshNextMap, polling.nextMapIntervalMs);

      logWithFallback(
        moduleLogger,
        "info",
        `MatchState polling started. serverInfo=${polling.serverInfoIntervalMs}ms players=${polling.playersIntervalMs}ms squads=${polling.squadsIntervalMs}ms`,
        {
          label: "MODULE",
          operation: "start",
          data: {
            serverInfoIntervalMs: polling.serverInfoIntervalMs,
            playersIntervalMs: polling.playersIntervalMs,
            squadsIntervalMs: polling.squadsIntervalMs,
            currentMapIntervalMs: polling.currentMapIntervalMs,
            nextMapIntervalMs: polling.nextMapIntervalMs,
          },
        },
      );
    },

    async stop() {
      for (const timer of timers.splice(0)) clearInterval(timer);
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      logWithFallback(moduleLogger, "info", "MatchState stopped.", {
        label: "MODULE",
        operation: "stop",
      });
    },
  };
}

function makePlayersSnapshot(players) {
  const snapshot = {
    list: players,
    bySteam64ID: {},
    byEOSID: {},
    byControllerID: {},
    byName: {},
    count: players.length,
    lastUpdatedAt: new Date().toISOString(),
  };

  for (const player of players) {
    if (player.steamID) snapshot.bySteam64ID[player.steamID] = player;
    if (player.eosID) snapshot.byEOSID[player.eosID] = player;
    if (player.controllerID) snapshot.byControllerID[player.controllerID] = player;
    if (player.name) snapshot.byName[player.name] = player;
  }

  return snapshot;
}

function parseShowServerInfo(raw) {
  const fields = extractServerInfoFields(raw);
  const tps = pickNumber(fields, ["TPS", "ServerTPS", "TickRate", "ServerTickRate"]);
  const derivedPlayers = derivePlayerCounts(raw);
  const layer = pickString(fields, ["Layer_s"]);

  return {
    map: pickString(fields, ["MapName_s"]),
    layer,
    mode: deriveModeFromLayer(layer) || pickString(fields, ["GameMode_s"]),
    nextLayer: pickString(fields, ["NextLayer_s"]),
    playerCount: pickNumber(fields, ["PlayerCount_I", "PlayerCount", "Players"]) ?? derivedPlayers.playerCount,
    maxPlayers: pickNumber(fields, ["MaxPlayers", "MaxPlayers_I", "MaxPlayerCount_I", "MaxPlayerCount"]) ?? derivedPlayers.maxPlayers,
    queueCount: pickNumber(fields, ["Queue_I", "Queue", "PlayerQueue_I", "PlayerQueue", "PublicQueue_I", "PublicQueue", "NumPlayersQueued"]),
    playtime: pickNumber(fields, ["PLAYTIME_I", "PlayTime_I", "Playtime_I", "PlayTime", "Playtime", "ElapsedTime_I", "RoundTime_I", "GameTime_I"]),
    tps,
    tpsStatus: resolveTpsStatus(tps),
    fields,
  };
}

function mergeServerStatus(current, parsed, raw) {
  const next = {
    ...current,
    raw,
    fields: parsed.fields ?? {},
    lastUpdatedAt: new Date().toISOString(),
  };

  assignIfPresent(next, "map", parsed.map);
  assignIfPresent(next, "layer", parsed.layer);
  assignIfPresent(next, "maxPlayers", parsed.maxPlayers);
  assignIfPresent(next, "queueCount", parsed.queueCount);
  assignIfPresent(next, "playtime", parsed.playtime);
  assignIfPresent(next, "tps", parsed.tps);

  const derivedMode = deriveModeFromLayer(next.layer || parsed.layer);
  if (derivedMode) {
    next.mode = derivedMode;
  } else {
    assignIfPresent(next, "mode", parsed.mode);
  }

  if (hasValue(parsed.tpsStatus) && parsed.tpsStatus !== "unknown") {
    next.tpsStatus = parsed.tpsStatus;
  }

  const normalizedNextLayer = normalizeLayerLabel(parsed.nextLayer);
  const normalizedCurrentLayer = normalizeLayerLabel(next.layer || parsed.layer || current.layer);
  const isSameAsCurrentLayer = normalizedNextLayer
    && normalizedCurrentLayer
    && normalizedNextLayer === normalizedCurrentLayer;

  if (hasValue(parsed.nextLayer) && !isSameAsCurrentLayer) {
    next.nextLayer = parsed.nextLayer;
    next.nextLayerSource = "serverInfo";
  } else if (hasValue(parsed.nextLayer) && isSameAsCurrentLayer) {
    next.nextLayer = "";
    next.nextLayerSource = "cached";
  }

  if (hasValue(parsed.playerCount)) {
    next.playerCount = parsed.playerCount;
    next.playerCountSource = "serverInfo";
  }

  return next;
}

function extractServerInfoFields(raw) {
  const fields = {};
  const knownKeys = [
    "MapName_s",
    "Layer_s",
    "GameMode_s",
    "NextLayer_s",
    "PlayerCount_I",
    "PlayerCount",
    "Players",
    "MaxPlayers",
    "MaxPlayers_I",
    "MaxPlayerCount_I",
    "MaxPlayerCount",
    "Queue_I",
    "Queue",
    "PlayerQueue_I",
    "PlayerQueue",
    "PublicQueue_I",
    "PublicQueue",
    "NumPlayersQueued",
    "PLAYTIME_I",
    "PlayTime_I",
    "Playtime_I",
    "PlayTime",
    "Playtime",
    "ElapsedTime_I",
    "RoundTime_I",
    "GameTime_I",
    "TPS",
    "ServerTPS",
    "TickRate",
    "ServerTickRate",
  ];

  const text = String(raw ?? "");
  const jsonFields = parseServerInfoJson(text);
  if (jsonFields) {
    Object.assign(fields, jsonFields);
  }

  for (const key of knownKeys) {
    const match = text.match(new RegExp(`\\b${escapeRegExp(key)}\\b\\s*[:=]\\s*([^\\r\\n,]+)`, "i"));
    if (match) fields[key] = cleanFieldValue(match[1]);
  }

  for (const line of text.split("\n")) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*[:=]\s*(.*?)\s*$/);
    if (!match) continue;
    fields[match[1]] = cleanFieldValue(match[2]);
  }

  return fields;
}

function parseServerInfoJson(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const fields = {};
    for (const [key, value] of Object.entries(parsed)) {
      fields[key] = cleanFieldValue(value);
    }
    return fields;
  } catch {
    return null;
  }
}

function pickString(fields, keys) {
  for (const key of keys) {
    const value = fields[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function pickNumber(fields, keys) {
  for (const key of keys) {
    if (!(key in fields) || fields[key] == null || String(fields[key]).trim() === "") continue;
    const value = firstNumber(fields[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function derivePlayerCounts(raw) {
  const text = String(raw ?? "");
  const slash = text.match(/\b(?:Players?|PlayerCount)\b[^0-9]*(\d+)\s*\/\s*(\d+)/i);
  if (slash) {
    return {
      playerCount: Number(slash[1]),
      maxPlayers: Number(slash[2]),
    };
  }

  const of = text.match(/\b(?:Players?|PlayerCount)\b[^0-9]*(\d+)\s*(?:of|out\s+of)\s*(\d+)/i);
  if (of) {
    return {
      playerCount: Number(of[1]),
      maxPlayers: Number(of[2]),
    };
  }

  return { playerCount: null, maxPlayers: null };
}

function assignIfPresent(target, key, value) {
  if (hasValue(value)) target[key] = value;
}

function hasValue(value) {
  if (value == null) return false;
  if (typeof value === "number") return Number.isFinite(value);
  return String(value).trim() !== "";
}

function normalizeLayerLabel(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isSameLayer(left, right) {
  const leftLabel = normalizeLayerLabel(left);
  const rightLabel = normalizeLayerLabel(right);
  return Boolean(leftLabel && rightLabel && leftLabel === rightLabel);
}

function firstNumber(value) {
  const match = String(value ?? "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function resolveTpsStatus(tps) {
  if (tps == null) return "unknown";
  if (tps < 20) return "critical";
  if (tps < 28) return "warning";
  return "good";
}

function deriveModeFromLayer(layer) {
  const text = String(layer ?? "").trim();
  if (!text) return "";

  const tokens = text.split(/[_\s-]+/).filter(Boolean);
  if (!tokens.length) return "";

  const lastToken = tokens[tokens.length - 1];
  if (/^seed$/i.test(lastToken)) return "seed";

  if (/^(?:v?\d+|pve|pvp)$/i.test(lastToken) && tokens.length > 1) {
    const previous = String(tokens[tokens.length - 2] ?? "").trim();
    if (!previous) return "";
    if (/^seed$/i.test(previous)) return "seed";
    if (/^(?:pve|pvp)$/i.test(previous)) return previous;
    return /^[a-z]+$/i.test(previous) ? previous : "";
  }

  const mode = String(lastToken).trim();
  if (/^seed$/i.test(mode)) return "seed";
  if (/^(?:pve|pvp)$/i.test(mode)) return mode;
  return /^[a-z]+$/i.test(mode) ? mode : "";
}

function cleanFieldValue(value) {
  return String(value ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatMatchStateLabel(match) {
  const parts = [match.map, match.layer, match.mode].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "Unknown";
}

function logWithFallback(logger, method, message, context) {
  const fn = logger?.[method];
  if (typeof fn === "function") {
    fn.call(logger, message, context);
    return;
  }

  const rendered = typeof message === "function" ? message() : message;
  if (method === "warn") {
    logger?.warn?.(rendered);
    return;
  }

  logger?.module?.(rendered);
}
