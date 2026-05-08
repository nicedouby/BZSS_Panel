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
export function createMatchStateModule({ core, modules, config }) {
  const moduleConfig = config.get("modules.matchState", {});
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const polling = {
    serverInfoIntervalMs: Number(moduleConfig.polling?.serverInfoIntervalMs ?? 5000),
    playersIntervalMs: Number(moduleConfig.polling?.playersIntervalMs ?? 10000),
    squadsIntervalMs: Number(moduleConfig.polling?.squadsIntervalMs ?? 10000),
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
    rconStatus: {},
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
      if (type === "serverInfo" || type === "all") await refreshServerInfo();
      if (type === "players" || type === "all") await refreshPlayers();
      if (type === "squads" || type === "all") await refreshSquads();
      if (type === "currentMap" || type === "all") await refreshCurrentMap();
      if (type === "nextMap" || type === "all") await refreshNextMap();
      return getSnapshot();
    },
  };

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.("module.matchState") !== false
      && core.pluginSubscriptions?.isSubscribed?.("module.matchState") !== false;
  }

  async function refreshServerInfo() {
    return guarded("serverInfo", async () => {
      const result = await executeRcon("ShowServerInfo");
      if (!result.success) {
        updateStatuses();
        emitRconStatusUpdated();
        return null;
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
      emitServerStatusUpdated();
      emitUpdated("serverStatus");
      return state.serverStatus;
    });
  }

  async function refreshPlayers() {
    return guarded("players", async () => {
      const result = await executeRcon("ListPlayers");
      if (!result.success) {
        updateStatuses();
        emitRconStatusUpdated();
        return [];
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
      core.eventBus.emitCoreEvent("RCON_LIST_PLAYERS_UPDATED", event);
      emitPlayersUpdated();
      emitUpdated("players");
      return players;
    });
  }

  async function refreshSquads() {
    return guarded("squads", async () => {
      const result = await executeRcon("ListSquads");
      if (!result.success) {
        updateStatuses();
        emitRconStatusUpdated();
        return [];
      }

      const squads = parseListSquads(result.rconResponse);
      state.squads = {
        list: squads,
        count: squads.length,
        lastUpdatedAt: new Date().toISOString(),
      };
      updateWebStatus();

      const event = makeEvent("RCON_LIST_SQUADS_UPDATED", { squads });
      core.eventBus.emitCoreEvent("RCON_LIST_SQUADS_UPDATED", event);
      emitSquadsUpdated();
      emitUpdated("squads");
      return squads;
    });
  }

  async function refreshCurrentMap() {
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
    });
  }

  async function refreshNextMap() {
    return guarded("nextMap", async () => {
      if (state.serverStatus.nextLayerSource === "serverInfo") return null;

      const result = await executeRcon("ShowNextMap");
      if (!result.success) {
        updateStatuses();
        emitRconStatusUpdated();
        return null;
      }

      const nextMap = parseNextMap(result.rconResponse);
      if (nextMap.layer) {
        state.serverStatus.nextLayer = nextMap.layer;
        state.serverStatus.nextLayerSource = "showNextMap";
        state.serverStatus.lastUpdatedAt = new Date().toISOString();
        syncMatchFromServerStatus();
        updateWebStatus();
        emitServerStatusUpdated();
        emitUpdated("nextMap");
      }
      return nextMap;
    });
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

  async function guarded(key, fn) {
    if (!isSubscribed()) return null;
    if (running[key]) return null;
    running[key] = true;
    try {
      updateStatuses();
      return await fn();
    } catch (error) {
      core.logger.warn(`module.matchState ${key} polling failed: ${error.message}`);
      updateStatuses();
      emitRconStatusUpdated();
      return null;
    } finally {
      running[key] = false;
    }
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
      fn().catch((error) => core.logger.warn(`module.matchState timer failed: ${error.message}`));
    }, intervalMs));
  }

  return {
    manifest: { id: "module.matchState", name: "Match State Module", kind: "module", version: "0.2.0" },
    apiName: "matchState",
    api,

    async start() {
      core.webRegistry.registerPage({
        id: "web.squadManage",
        title: "建队管理",
        group: "管理",
        route: "/squad-manage",
        pageModule: "/pages/squad-manage.js",
        source: "module.squadManage",
        required: false,
        enabled: true,
        order: 100,
        icon: "🧩",
      });

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

      core.logger.module(
        `module.matchState polling started. serverInfo=${polling.serverInfoIntervalMs}ms players=${polling.playersIntervalMs}ms squads=${polling.squadsIntervalMs}ms`
      );
    },

    async stop() {
      for (const timer of timers.splice(0)) clearInterval(timer);
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
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

  return {
    map: pickString(fields, ["MapName_s"]),
    layer: pickString(fields, ["Layer_s"]),
    mode: pickString(fields, ["GameMode_s"]),
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
  assignIfPresent(next, "mode", parsed.mode);
  assignIfPresent(next, "maxPlayers", parsed.maxPlayers);
  assignIfPresent(next, "queueCount", parsed.queueCount);
  assignIfPresent(next, "playtime", parsed.playtime);
  assignIfPresent(next, "tps", parsed.tps);

  if (hasValue(parsed.tpsStatus) && parsed.tpsStatus !== "unknown") {
    next.tpsStatus = parsed.tpsStatus;
  }

  if (hasValue(parsed.nextLayer)) {
    next.nextLayer = parsed.nextLayer;
    next.nextLayerSource = "serverInfo";
  } else if (next.nextLayerSource === "serverInfo") {
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
