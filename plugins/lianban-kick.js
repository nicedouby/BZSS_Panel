// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const PLUGIN_ID = "plugin.lianbanKick";
const PAGE_ROUTE = "/plugins/lianban-kick";
const DEFAULT_BAN_DIR = "Ban";
const DEFAULT_HISTORY_LIMIT = 200;
const DEFAULT_SCAN_EXTENSIONS = [".cfg", ".txt", ".json", ".ini", ".log"];
const JOIN_EVENT_NAMES = ["On_PlayerJoined", "PLAYER_JOINED", "On_PlayerConnected", "PLAYER_CONNECTED", "PLAYER_POST_LOGIN"];
const RAW_LOG_JOIN_EVENT_NAME = "On_RawLogLine";

export function createPlugin({ core, modules, config, logger } = {}) {
  const pluginLogger =
    logger
    ?? core?.createLogger?.({
      moduleId: PLUGIN_ID,
      source: PLUGIN_ID,
      channel: "module",
    })
    ?? core?.logger
    ?? console;

  const runtimeConfig = readRuntimeConfig(config);
  const unsubscribers = [];
  const handledEventIds = new Set();
  const loadedFiles = [];
  const indexes = {
    steam: new Map(),
    eos: new Map(),
  };

  const state = {
    enabled: runtimeConfig.enabled,
    banDir: runtimeConfig.banDir,
    historyLimit: runtimeConfig.historyLimit,
    totalRecords: 0,
    totalFiles: 0,
    lastScanAt: "",
    lastJoinAt: "",
    lastMatchAt: "",
    scanError: "",
    joinEventCount: 0,
    matchedCount: 0,
    recentJoins: [],
    recentMatches: [],
    loadedFiles,
    config: runtimeConfig,
  };

  function isSubscribed() {
    const api = core?.pluginSubscriptions?.isSubscribed;
    if (typeof api !== "function") return true;
    return api(PLUGIN_ID);
  }

  function isActive() {
    return Boolean(state.enabled) && isSubscribed();
  }

  function getState() {
    return {
      enabled: state.enabled,
      subscribed: isSubscribed(),
      banDir: state.banDir,
      historyLimit: state.historyLimit,
      totalRecords: state.totalRecords,
      totalFiles: state.totalFiles,
      lastScanAt: state.lastScanAt,
      lastJoinAt: state.lastJoinAt,
      lastMatchAt: state.lastMatchAt,
      scanError: state.scanError,
      joinEventCount: state.joinEventCount,
      matchedCount: state.matchedCount,
      recentJoins: [...state.recentJoins].reverse(),
      recentMatches: [...state.recentMatches].reverse(),
      loadedFiles: cloneJsonSafe(state.loadedFiles),
      config: cloneJsonSafe(state.config),
    };
  }

  function getConfig() {
    return cloneJsonSafe(state.config);
  }

  function getLoadedFiles() {
    return cloneJsonSafe(state.loadedFiles);
  }

  async function reloadBanFiles() {
    indexes.steam.clear();
    indexes.eos.clear();
    loadedFiles.splice(0, loadedFiles.length);

    const resolvedDir = path.isAbsolute(state.banDir) ? state.banDir : path.resolve(process.cwd(), state.banDir);
    let entries = [];
    try {
      entries = await fs.readdir(resolvedDir, { withFileTypes: true });
    } catch (error) {
      state.scanError = `无法读取联办目录: ${error.message}`;
      state.totalFiles = 0;
      state.totalRecords = 0;
      state.lastScanAt = new Date().toISOString();
      pluginLogger?.warn?.(`[LianbanKick] ${state.scanError}`);
      return getState();
    }

    const files = entries
      .filter((item) => item?.isFile?.())
      .map((item) => item.name)
      .filter((name) => DEFAULT_SCAN_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext)) || !path.extname(name));

    let totalRecords = 0;
    const nextFiles = [];

    for (const fileName of files) {
      const filePath = path.join(resolvedDir, fileName);
      const fileInfo = { fileName, filePath, recordCount: 0, records: [], error: "" };
      try {
        const content = await fs.readFile(filePath, "utf8");
        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          const parsed = parseBanLine(lines[index], { fileName, filePath, lineNumber: index + 1 });
          if (!parsed) continue;
          fileInfo.records.push(parsed);
          fileInfo.recordCount += 1;
          totalRecords += 1;
          if (parsed.steamID) pushIndexedRecord(indexes.steam, parsed.steamID, parsed);
          if (parsed.eosID) pushIndexedRecord(indexes.eos, parsed.eosID, parsed);
        }
      } catch (error) {
        fileInfo.error = error.message;
      }
      nextFiles.push(fileInfo);
    }

    loadedFiles.splice(0, loadedFiles.length, ...nextFiles);
    state.totalFiles = nextFiles.length;
    state.totalRecords = totalRecords;
    state.lastScanAt = new Date().toISOString();
    state.scanError = "";
    return getState();
  }

  async function handleJoinEvent(event = {}) {
    const eventKey = String(event?.eventId ?? event?.id ?? event?.seq ?? event?.time ?? "").trim();
    if (eventKey && handledEventIds.has(eventKey)) return null;
    if (eventKey) {
      handledEventIds.add(eventKey);
      if (handledEventIds.size > 500) handledEventIds.clear();
    }

    const joinEvent = buildJoinEventFromRawLog(event) ?? event;
    const context = await resolvePlayerContext(joinEvent, { modules, core });
    state.joinEventCount += 1;
    state.lastJoinAt = new Date().toISOString();

    const match = findMatch(context);
    const joinRecord = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at: new Date().toISOString(),
      eventName: String(joinEvent?.eventName ?? "").trim(),
      eventId: String(joinEvent?.eventId ?? "").trim(),
      serverId: String(joinEvent?.serverId ?? "").trim(),
      playerName: context.playerName,
      steamID: context.steamID,
      eosID: context.eosID,
      source: context.source,
      matched: Boolean(match),
    };
    state.recentJoins.push(joinRecord);
    if (state.recentJoins.length > state.historyLimit) state.recentJoins.splice(0, state.recentJoins.length - state.historyLimit);

    if (!match) return null;

    state.matchedCount += 1;
    state.lastMatchAt = new Date().toISOString();
    const matchRecord = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at: new Date().toISOString(),
      playerName: context.playerName,
      steamID: context.steamID,
      eosID: context.eosID,
      source: context.source,
      matchKey: match.matchKey,
      matchedValue: match.matchedValue,
      fileName: match.fileName,
      filePath: match.filePath,
      lineNumber: match.lineNumber,
      lineText: match.lineText,
    };
    state.recentMatches.push(matchRecord);
    if (state.recentMatches.length > state.historyLimit) state.recentMatches.splice(0, state.recentMatches.length - state.historyLimit);
    pluginLogger?.info?.(`[LianbanKick] matched player ${context.playerName || context.steamID || context.eosID || "unknown"} in ${match.fileName}:${match.lineNumber}`);
    return matchRecord;
  }

  function findMatch(context = {}) {
    const steamID = normalizeSteamID(context.steamID);
    const eosID = normalizeEOSID(context.eosID);
    if (steamID && indexes.steam.has(steamID)) {
      return buildMatchResult("steamID", steamID, indexes.steam.get(steamID));
    }
    if (eosID && indexes.eos.has(eosID)) {
      return buildMatchResult("eosID", eosID, indexes.eos.get(eosID));
    }
    return null;
  }

  function buildMatchResult(matchKey, matchedValue, records) {
    const record = records?.[0] ?? null;
    if (!record) return null;
    return {
      matchKey,
      matchedValue,
      fileName: record.fileName,
      filePath: record.filePath,
      lineNumber: record.lineNumber,
      lineText: record.lineText,
    };
  }

  async function simulateJoin(payload = {}) {
    return handleJoinEvent(buildSimulatedJoinEvent(payload));
  }

  async function updateConfig(nextConfig = {}) {
    const current = config?.get?.("plugins.lianbanKick", {}) ?? {};
    const next = normalizeRuntimeConfig({ ...current, ...nextConfig });
    state.enabled = next.enabled;
    state.banDir = next.banDir;
    state.historyLimit = next.historyLimit;
    state.config = next;
    config?.set?.("plugins.lianbanKick", next);
    await config?.save?.();
    await reloadBanFiles();
    return getState();
  }

  const api = {
    getState,
    getConfig,
    getLoadedFiles,
    reloadBanFiles,
    simulateJoin,
    updateConfig,
    findMatchByIdentity(identity = {}) {
      return findMatch({
        steamID: identity?.steamID ?? identity?.steamId ?? identity?.steam64ID ?? identity?.steam64 ?? "",
        eosID: identity?.eosID ?? identity?.eosId ?? "",
      });
    },
    clearHistory() {
      state.recentJoins = [];
      state.recentMatches = [];
      state.joinEventCount = 0;
      state.matchedCount = 0;
      state.lastJoinAt = "";
      state.lastMatchAt = "";
      state.scanError = "";
      return getState();
    },
  };

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "联办文模块",
      kind: "plugin",
      version: "1.0.0",
      description: "读取 Ban 目录联办名单，玩家加入后按 SteamID / EOSID 命中并在状态页展示。",
    },
    apiName: "lianbanKick",
    api,

    async start() {
      state.config = runtimeConfig;
      core?.webRegistry?.registerPage?.({
        id: "web.lianbanKick",
        title: "联办文模块",
        group: "插件",
        route: PAGE_ROUTE,
        pageModule: "/pages/lianban-kick.js",
        source: PLUGIN_ID,
        description: "读取 Ban 目录联办名单，玩家加入后按 SteamID / EOSID 命中并展示最近记录。",
        required: false,
        enabled: true,
        order: 145,
        icon: "BAN",
      });

      await reloadBanFiles();

      if (!isActive()) {
        pluginLogger?.info?.("[LianbanKick] plugin disabled by config or subscription.");
        return;
      }

      if (typeof core?.eventBus?.onCoreEvent !== "function") {
        pluginLogger?.warn?.("[LianbanKick] eventBus.onCoreEvent unavailable.");
        return;
      }

      for (const eventName of JOIN_EVENT_NAMES) {
        unsubscribers.push(core.eventBus.onCoreEvent(eventName, (event) => {
          void handleJoinEvent(event);
        }));
      }

      if (!core?.rawLogDerivedEvents) {
        unsubscribers.push(core.eventBus.onCoreEvent(RAW_LOG_JOIN_EVENT_NAME, (event) => {
          const joinEvent = buildJoinEventFromRawLog(event);
          if (!joinEvent) return;
          void handleJoinEvent(joinEvent);
        }));
      }
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try { unsubscribe(); } catch {}
      }
    },
  };
}

function readRuntimeConfig(config) {
  const raw = config?.get?.("plugins.lianbanKick", null) ?? config?.get?.("plugins.lianban-kick", null) ?? {};
  return normalizeRuntimeConfig(raw);
}

function normalizeRuntimeConfig(raw = {}) {
  return {
    enabled: raw?.enabled !== false,
    banDir: String(raw?.banDir ?? DEFAULT_BAN_DIR).trim() || DEFAULT_BAN_DIR,
    historyLimit: Math.max(20, Number(raw?.historyLimit ?? DEFAULT_HISTORY_LIMIT) || DEFAULT_HISTORY_LIMIT),
  };
}

function parseBanLine(line, { fileName, filePath, lineNumber } = {}) {
  const raw = String(line ?? "").trim();
  if (!raw || raw.startsWith("#") || raw.startsWith(";")) return null;

  const commentSplit = raw.split(/\/\//, 2);
  const prefix = String(commentSplit[0] ?? "").trim();
  const lineText = raw;
  const steamMatch = prefix.match(/\b(\d{17})\b/);
  const eosMatch = prefix.match(/\b([0-9a-fA-F]{32})\b/);

  const steamID = steamMatch ? steamMatch[1] : "";
  const eosID = eosMatch ? eosMatch[1].toLowerCase() : "";
  if (!steamID && !eosID) return null;

  return {
    fileName,
    filePath,
    lineNumber,
    lineText,
    steamID,
    eosID,
    comment: String(commentSplit[1] ?? "").trim(),
  };
}

function pushIndexedRecord(index, key, record) {
  const normalized = String(key ?? "").trim();
  if (!normalized) return;
  const list = index.get(normalized) ?? [];
  list.push(record);
  index.set(normalized, list);
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeSteamID(value) {
  return normalizeText(value);
}

function normalizeEOSID(value) {
  return normalizeText(value).toLowerCase();
}

async function resolvePlayerContext(event = {}, { modules: ctxModules, core: ctxCore } = {}) {
  const playerName = firstText(
    event?.payload?.name,
    event?.payload?.playerName,
    event?.name,
    event?.playerName,
    event?.paramMap?.PlayerName,
  );

  const steamID = firstText(
    event?.payload?.steamID,
    event?.payload?.SteamID,
    event?.payload?.steamId,
    event?.payload?.steam64ID,
    event?.steamID,
    event?.steamId,
    event?.steam64ID,
    event?.paramMap?.SteamID,
    event?.paramMap?.Steam64ID,
  );

  const eosID = firstText(
    event?.payload?.eosID,
    event?.payload?.EOSID,
    event?.payload?.eosId,
    event?.eosID,
    event?.eosId,
    event?.paramMap?.EOSID,
  );

  let resolvedSteamID = steamID;
  let resolvedEosID = eosID;

  const playerState = ctxModules?.playerState;
  const serverId = firstText(event?.serverId, ctxCore?.webStatus?.serverId);
  const lookup = typeof playerState?.findPlayer === "function"
    ? playerState.findPlayer(serverId, { name: playerName, steamId: steamID, eosId: eosID })
    : null;
  const player =
    lookup
    ?? (playerName && typeof playerState?.getPlayerByName === "function" ? playerState.getPlayerByName(serverId, playerName) : null)
    ?? (steamID && typeof playerState?.getPlayerBySteamID === "function" ? playerState.getPlayerBySteamID(serverId, steamID) : null)
    ?? (eosID && typeof playerState?.getPlayerByEOSID === "function" ? playerState.getPlayerByEOSID(serverId, eosID) : null)
    ?? null;

  if (player) {
    resolvedSteamID = resolvedSteamID || normalizeSteamID(player.steamID ?? player.steamId ?? player.steam64ID ?? player.steam64);
    resolvedEosID = resolvedEosID || normalizeEOSID(player.eosID ?? player.eosId);
  }

  return {
    playerName,
    steamID: resolvedSteamID,
    eosID: resolvedEosID,
    serverId,
    source: player ? "playerState+event" : "event",
  };
}

function buildSimulatedJoinEvent(payload = {}) {
  const playerName = String(payload?.playerName ?? payload?.name ?? "DebugPlayer").trim() || "DebugPlayer";
  return {
    eventId: String(payload?.eventId ?? `manual:${Date.now()}`),
    eventName: "On_PlayerJoined",
    serverId: String(payload?.serverId ?? "").trim(),
    time: new Date().toISOString(),
    payload: {
      name: playerName,
      playerName,
      steamID: payload?.steamID ?? payload?.steamId ?? payload?.steam64ID ?? "",
      eosID: payload?.eosID ?? payload?.eosId ?? "",
    },
    paramMap: {
      PlayerName: playerName,
      SteamID: payload?.steamID ?? payload?.steamId ?? payload?.steam64ID ?? "",
      EOSID: payload?.eosID ?? payload?.eosId ?? "",
    },
  };
}

function buildJoinEventFromRawLog(event = {}) {
  if (String(event?.eventName ?? "").trim() !== RAW_LOG_JOIN_EVENT_NAME) return null;
  const raw = String(event?.rawLog ?? event?.rawEvent?.Raw ?? "");
  const match = raw.match(/Join succeeded:\s*(.+?)\s*(?:\||$)/i);
  const playerName = match ? String(match[1] ?? "").trim() : "";
  if (!playerName) return null;
  return {
    ...event,
    eventName: RAW_LOG_JOIN_EVENT_NAME,
    payload: {
      ...(event?.payload ?? {}),
      name: playerName,
      playerName,
    },
    paramMap: {
      ...(event?.paramMap ?? {}),
      PlayerName: playerName,
    },
  };
}

function findMatch(context = {}) {
  const steamID = normalizeSteamID(context.steamID);
  const eosID = normalizeEOSID(context.eosID);
  if (steamID && indexes.steam.has(steamID)) {
    return buildMatchResult("steamID", steamID, indexes.steam.get(steamID));
  }
  if (eosID && indexes.eos.has(eosID)) {
    return buildMatchResult("eosID", eosID, indexes.eos.get(eosID));
  }
  return null;
}

function buildMatchResult(matchKey, matchedValue, records) {
  const record = records?.[0] ?? null;
  if (!record) return null;
  return {
    matchKey,
    matchedValue,
    fileName: record.fileName,
    filePath: record.filePath,
    lineNumber: record.lineNumber,
    lineText: record.lineText,
  };
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function cloneJsonSafe(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

export default { createPlugin };
