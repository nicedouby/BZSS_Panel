// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const PLUGIN_ID = "lianbanKick";
const MATCH_REASON = "被联办";
const DEFAULT_DIRECTORY = "./联办";
const DEFAULT_CACHE_MS = 5_000;
const DEFAULT_RETRY_COOLDOWN_MS = 30_000;
const PAGE_ROUTE = "/plugins/lianban-kick";
const MAX_RECENT_EVENTS = 30;
const CANONICAL_DIRECTORY = "./config/lianban-kick";
const LEGACY_DIRECTORIES = ["./联办", "./鑱斿姙"];

function normalizeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeComparableName(value) {
  return normalizeText(value).replace(/\s+/g, " ").toLowerCase();
}

function normalizeComparableId(value) {
  return normalizeText(value).toLowerCase();
}

function makePlayerKey(player = {}) {
  return normalizeComparableId(player?.steamID)
    || normalizeComparableId(player?.eosID)
    || normalizeComparableId(player?.controllerID)
    || normalizeComparableName(player?.name);
}

function readRuntimeConfig(config) {
  const raw = config?.get?.(`plugins.${PLUGIN_ID}`, {}) ?? {};
  return {
    enabled: raw.enabled !== false,
    directory: normalizeText(raw.directory, CANONICAL_DIRECTORY),
    cacheMs: Math.max(0, Number(raw.cacheMs ?? DEFAULT_CACHE_MS) || DEFAULT_CACHE_MS),
    retryCooldownMs: Math.max(1_000, Number(raw.retryCooldownMs ?? DEFAULT_RETRY_COOLDOWN_MS) || DEFAULT_RETRY_COOLDOWN_MS),
  };
}

function createEmptyRuleSet() {
  return {
    names: new Set(),
    steamIDs: new Set(),
    eosIDs: new Set(),
    files: [],
    entries: 0,
  };
}

function classifyEntry(line) {
  const trimmed = normalizeText(line);
  if (!trimmed || trimmed.startsWith("#")) return null;

  const steamWithSuffix = trimmed.match(/^(\d{10,})(?::\d+)?$/);
  if (steamWithSuffix) {
    const steamID = normalizeText(steamWithSuffix[1]);
    return {
      type: "steam",
      rawValue: trimmed,
      normalizedValue: normalizeComparableId(steamID),
    };
  }

  const prefixed = trimmed.match(/^(steam|eos|name)\s*:\s*(.+)$/i);
  if (prefixed) {
    const type = String(prefixed[1] ?? "").toLowerCase();
    const rawValue = normalizeText(prefixed[2]);
    if (!rawValue) return null;
    return {
      type,
      rawValue,
      normalizedValue: type === "name" ? normalizeComparableName(rawValue) : normalizeComparableId(rawValue),
    };
  }

  if (/^\d{10,}$/.test(trimmed)) {
    return {
      type: "steam",
      rawValue: trimmed,
      normalizedValue: normalizeComparableId(trimmed),
    };
  }

  if (/^[0-9a-f]{32}$/i.test(trimmed) || /^EOS[:_-]/i.test(trimmed)) {
    return {
      type: "eos",
      rawValue: trimmed,
      normalizedValue: normalizeComparableId(trimmed),
    };
  }

  return {
    type: "name",
    rawValue: trimmed,
    normalizedValue: normalizeComparableName(trimmed),
  };
}

function addEntry(ruleSet, parsed, sourceFile) {
  if (!parsed?.normalizedValue) return;
  if (parsed.type === "steam") ruleSet.steamIDs.add(parsed.normalizedValue);
  else if (parsed.type === "eos") ruleSet.eosIDs.add(parsed.normalizedValue);
  else ruleSet.names.add(parsed.normalizedValue);
  ruleSet.entries += 1;
  if (sourceFile && !ruleSet.files.includes(sourceFile)) {
    ruleSet.files.push(sourceFile);
  }
}

function matchPlayer(ruleSet, player = {}) {
  const steamID = normalizeComparableId(player?.steamID);
  if (steamID && ruleSet.steamIDs.has(steamID)) {
    return { matched: true, matchType: "steamID", matchValue: steamID };
  }

  const eosID = normalizeComparableId(player?.eosID);
  if (eosID && ruleSet.eosIDs.has(eosID)) {
    return { matched: true, matchType: "eosID", matchValue: eosID };
  }

  const name = normalizeComparableName(player?.name);
  if (name && ruleSet.names.has(name)) {
    return { matched: true, matchType: "name", matchValue: name };
  }

  return { matched: false, matchType: "", matchValue: "" };
}

export function createPlugin({ core, modules, config, logger } = {}) {
  const pluginLogger =
    logger ??
    core?.createLogger?.({
      moduleId: PLUGIN_ID,
      source: PLUGIN_ID,
      channel: "module",
    }) ??
    core?.logger ??
    console;

  const unsubscribers = [];
  let serial = Promise.resolve();

  const state = {
    enabled: true,
    subscribed: true,
    directory: CANONICAL_DIRECTORY,
    cacheMs: DEFAULT_CACHE_MS,
    retryCooldownMs: DEFAULT_RETRY_COOLDOWN_MS,
    lastLoadedAt: "",
    lastScanAt: "",
    lastKickAt: "",
    lastError: "",
    files: [],
    entries: 0,
    playersScanned: 0,
    kickAttempts: 0,
    kickSuccess: 0,
    kickFailed: 0,
    lastMatch: null,
    recentEvents: [],
  };

  const runtime = {
    rules: createEmptyRuleSet(),
    rulesLoadedAt: 0,
    actedPlayers: new Set(),
    failureCooldowns: new Map(),
  };

  function enqueue(task) {
    const next = serial.then(task, task);
    serial = next.catch(() => {});
    return next;
  }

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.(`plugin.${PLUGIN_ID}`) !== false
      && core?.pluginSubscriptions?.isSubscribed?.(`plugin.${PLUGIN_ID}`) !== false;
  }

  function isActive() {
    return Boolean(state.enabled) && isSubscribed();
  }

  function pushRecentEvent(kind, detail = {}) {
    state.recentEvents.unshift({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      kind: normalizeText(kind, "info"),
      at: new Date().toISOString(),
      ...detail,
    });

    if (state.recentEvents.length > MAX_RECENT_EVENTS) {
      state.recentEvents.length = MAX_RECENT_EVENTS;
    }
  }

  async function loadRules(force = false) {
    const now = Date.now();
    if (!force && now - runtime.rulesLoadedAt < state.cacheMs) {
      return runtime.rules;
    }

    const absoluteDir = path.resolve(process.cwd(), state.directory);
    const nextRules = createEmptyRuleSet();

    try {
      const dirEntries = await fs.readdir(absoluteDir, { withFileTypes: true });
      const files = dirEntries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right, "zh-CN"));

      for (const file of files) {
        const filePath = path.join(absoluteDir, file);
        const content = await fs.readFile(filePath, "utf8");
        const lines = content.split(/\r?\n/u);
        for (const line of lines) {
          const parsed = classifyEntry(line);
          if (!parsed) continue;
          addEntry(nextRules, parsed, file);
        }
      }

      runtime.rules = nextRules;
      runtime.rulesLoadedAt = now;
      state.lastLoadedAt = new Date(now).toISOString();
      state.files = [...nextRules.files];
      state.entries = nextRules.entries;
      state.lastError = "";
      pushRecentEvent("rules_loaded", {
        files: [...nextRules.files],
        entries: nextRules.entries,
      });
      return nextRules;
    } catch (error) {
      if (error?.code === "ENOENT") {
        runtime.rules = createEmptyRuleSet();
        runtime.rulesLoadedAt = now;
        state.lastLoadedAt = new Date(now).toISOString();
        state.files = [];
        state.entries = 0;
        state.lastError = "";
        pushRecentEvent("rules_missing", {
          files: [],
          entries: 0,
        });
        return runtime.rules;
      }

      state.lastError = error instanceof Error ? error.message : String(error);
      pushRecentEvent("rules_error", {
        error: state.lastError,
      });
      pluginLogger?.warn?.(`[LianbanKick] failed to read ${absoluteDir}: ${state.lastError}`);
      return runtime.rules;
    }
  }

  function releaseOfflinePlayers(players = []) {
    const onlineKeys = new Set(players.map((player) => makePlayerKey(player)).filter(Boolean));

    for (const key of [...runtime.actedPlayers]) {
      if (!onlineKeys.has(key)) runtime.actedPlayers.delete(key);
    }

    const now = Date.now();
    for (const [key, expireAt] of runtime.failureCooldowns.entries()) {
      if (expireAt <= now || !onlineKeys.has(key)) {
        runtime.failureCooldowns.delete(key);
      }
    }
  }

  async function kickMatchedPlayer(serverId, player, match) {
    const squadManagement = modules?.squadManagement;
    if (typeof squadManagement?.requestKick !== "function"
      && typeof squadManagement?.kick !== "function"
      && typeof squadManagement?.executeAction !== "function") {
      state.lastError = "squadManagement kick API unavailable";
      pushRecentEvent("kick_unavailable", {
        error: state.lastError,
      });
      pluginLogger?.warn?.("[LianbanKick] squadManagement kick API unavailable.");
      return;
    }

    const request = {
      serverId,
      steamId: normalizeText(player?.steamID),
      eosId: normalizeText(player?.eosID),
      name: normalizeText(player?.name),
      reason: MATCH_REASON,
      source: `plugin.${PLUGIN_ID}`,
      system: true,
    };

    state.kickAttempts += 1;
    state.lastMatch = {
      playerName: request.name,
      steamID: request.steamId,
      eosID: request.eosId,
      matchType: match.matchType,
      matchValue: match.matchValue,
      at: new Date().toISOString(),
    };
    pushRecentEvent("match", {
      serverId,
      playerName: request.name,
      steamID: request.steamId,
      eosID: request.eosId,
      matchType: match.matchType,
      matchValue: match.matchValue,
    });

    const result = typeof squadManagement.requestKick === "function"
      ? await squadManagement.requestKick(request)
      : typeof squadManagement.kick === "function"
        ? await squadManagement.kick(request)
        : await squadManagement.executeAction({ ...request, type: "kick_player" });

    if (result?.ok) {
      const key = makePlayerKey(player);
      if (key) runtime.actedPlayers.add(key);
      state.kickSuccess += 1;
      state.lastKickAt = new Date().toISOString();
      state.lastError = "";
      pushRecentEvent("kick_success", {
        serverId,
        playerName: request.name,
        steamID: request.steamId,
        eosID: request.eosId,
        matchType: match.matchType,
      });
      pluginLogger?.info?.(`[LianbanKick] kicked ${request.name || request.steamId || request.eosId} by ${match.matchType} match.`);
      return;
    }

    const failureKey = makePlayerKey(player);
    if (failureKey) {
      runtime.failureCooldowns.set(failureKey, Date.now() + state.retryCooldownMs);
    }
    state.kickFailed += 1;
    state.lastError = String(result?.error ?? result?.message ?? "kick failed");
    pushRecentEvent("kick_failed", {
      serverId,
      playerName: request.name,
      steamID: request.steamId,
      eosID: request.eosId,
      matchType: match.matchType,
      error: state.lastError,
    });
    pluginLogger?.warn?.(`[LianbanKick] failed to kick ${request.name || request.steamId || request.eosId}: ${state.lastError}`);
  }

  async function processPlayersSnapshot(event = {}) {
    if (!isActive()) return;

    const serverId = normalizeText(event?.serverId, core?.webStatus?.serverId ?? "");
    if (!serverId) return;

    const players = Array.isArray(event?.players)
      ? event.players
      : modules?.playerState?.getPlayerList?.(serverId) ?? [];

    state.lastScanAt = new Date().toISOString();
    state.playersScanned = players.length;
    pushRecentEvent("scan", {
      serverId,
      playersScanned: players.length,
    });

    releaseOfflinePlayers(players);
    const rules = await loadRules(false);
    if (!rules.entries) return;

    for (const player of players) {
      const playerKey = makePlayerKey(player);
      if (!playerKey) continue;
      if (runtime.actedPlayers.has(playerKey)) continue;

      const cooldownUntil = Number(runtime.failureCooldowns.get(playerKey) || 0) || 0;
      if (cooldownUntil > Date.now()) continue;

      const match = matchPlayer(rules, player);
      if (!match.matched) continue;

      await kickMatchedPlayer(serverId, player, match);
    }
  }

  const api = {
    getState() {
      state.subscribed = isSubscribed();
      return {
        ...state,
        files: [...state.files],
        actedPlayers: [...runtime.actedPlayers],
        recentEvents: state.recentEvents.map((event) => ({ ...event })),
      };
    },

    async reloadRules() {
      await loadRules(true);
      return api.getState();
    },

    async rescan(serverId = core?.webStatus?.serverId ?? "") {
      await loadRules(true);
      await processPlayersSnapshot({
        serverId,
        players: modules?.playerState?.getPlayerList?.(serverId) ?? [],
      });
      return api.getState();
    },
  };

  return {
    manifest: {
      id: `plugin.${PLUGIN_ID}`,
      name: "联办踢出",
      kind: "plugin",
      version: "1.0.0",
      description: "读取仓库根目录联办文件夹中的名单文件，匹配在线玩家并自动踢出。",
      configSchema: [
        {
          key: `plugins.${PLUGIN_ID}.enabled`,
          type: "boolean",
          default: true,
          description: "是否启用联办踢出插件",
        },
        {
          key: `plugins.${PLUGIN_ID}.directory`,
          type: "string",
          default: CANONICAL_DIRECTORY,
          description: "联办名单目录",
        },
        {
          key: `plugins.${PLUGIN_ID}.cacheMs`,
          type: "number",
          default: DEFAULT_CACHE_MS,
          description: "名单缓存毫秒数",
        },
        {
          key: `plugins.${PLUGIN_ID}.retryCooldownMs`,
          type: "number",
          default: DEFAULT_RETRY_COOLDOWN_MS,
          description: "踢出失败后的重试冷却毫秒数",
        },
      ],
    },
    apiName: "lianbanKick",
    api,

    async start() {
      await migrateLegacyDirectoryIfNeeded(config);
      const runtimeConfig = readRuntimeConfig(config);
      state.enabled = runtimeConfig.enabled;
      state.directory = runtimeConfig.directory;
      state.cacheMs = runtimeConfig.cacheMs;
      state.retryCooldownMs = runtimeConfig.retryCooldownMs;
      state.subscribed = isSubscribed();

      await loadRules(true);

      if (!state.enabled) {
        pluginLogger?.info?.("[LianbanKick] plugin disabled by config.");
        return;
      }

      core?.webRegistry?.registerPage?.({
        id: "web.lianbanKick",
        title: "联办踢出",
        group: "插件",
        route: PAGE_ROUTE,
        pageModule: "/pages/lianban-kick.js",
        source: `plugin.${PLUGIN_ID}`,
        description: "查看联办踢出插件当前状态、命中情况和最近动作。",
        required: false,
        enabled: true,
        order: 138,
        icon: "LB",
      });

      if (typeof core?.eventBus?.onModuleEvent !== "function") {
        state.lastError = "eventBus.onModuleEvent unavailable";
        pushRecentEvent("plugin_error", {
          error: state.lastError,
        });
        pluginLogger?.warn?.("[LianbanKick] eventBus.onModuleEvent unavailable.");
        return;
      }

      unsubscribers.push(core.eventBus.onModuleEvent(
        "module.playerState",
        "playersSnapshotUpdated",
        (event) => enqueue(() => processPlayersSnapshot(event)),
      ));

      await enqueue(() => processPlayersSnapshot({
        serverId: core?.webStatus?.serverId ?? "",
        players: modules?.playerState?.getPlayerList?.(core?.webStatus?.serverId ?? "") ?? [],
      }));

      pushRecentEvent("plugin_started", {
        serverId: core?.webStatus?.serverId ?? "",
      });
      pluginLogger?.info?.("[LianbanKick] plugin started.");
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      runtime.actedPlayers.clear();
      runtime.failureCooldowns.clear();
      pushRecentEvent("plugin_stopped");
      pluginLogger?.info?.("[LianbanKick] plugin stopped.");
    },
  };
}

export default { createPlugin };

async function migrateLegacyDirectoryIfNeeded(config) {
  const raw = config?.get?.("plugins.lianbanKick", {}) ?? {};
  const configuredDirectory = normalizeText(raw.directory);
  if (configuredDirectory) return;

  const targetDir = path.resolve(process.cwd(), CANONICAL_DIRECTORY);
  if (await pathExists(targetDir)) return;

  for (const legacyDir of LEGACY_DIRECTORIES) {
    const resolvedLegacyDir = path.resolve(process.cwd(), legacyDir);
    if (!await pathExists(resolvedLegacyDir)) continue;
    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    try {
      await fs.rename(resolvedLegacyDir, targetDir);
    } catch {
      await fs.cp(resolvedLegacyDir, targetDir, { recursive: true });
      await fs.rm(resolvedLegacyDir, { recursive: true, force: true }).catch(() => {});
    }
    return;
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
