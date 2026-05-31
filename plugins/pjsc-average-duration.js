// -*- coding: utf-8 -*-

const PLUGIN_ID = "plugin.pjscAverageDuration";
const DEFAULT_TRIGGER_KEYWORD = "pjsc";
const DEFAULT_HISTORY_LIMIT = 50;
const PAGE_ROUTE = "/debug/pjsc-average-duration";

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

  const runtimeConfig = readConfig(config);
  const state = {
    enabled: runtimeConfig.enabled,
    triggerKeyword: runtimeConfig.triggerKeyword,
    historyLimit: runtimeConfig.historyLimit,
    triggerCount: 0,
    broadcastCount: 0,
    lastTriggerAt: null,
    lastBroadcastAt: null,
    lastMessage: "",
    lastSummary: null,
    lastBroadcastResult: null,
    lastError: "",
    history: [],
  };

  const unsubscribers = [];
  let serial = Promise.resolve();

  function enqueue(task) {
    const next = Promise.resolve().then(task);
    serial = next.catch(() => {});
    return next;
  }

  function recordHistory(entry) {
    state.history.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at: new Date().toISOString(),
      ...entry,
    });

    if (state.history.length > state.historyLimit) {
      state.history.splice(0, state.history.length - state.historyLimit);
    }
  }

  function getCurrentMatch() {
    return core?.runtimeState?.getMatch?.()
      ?? modules?.matchState?.getOverview?.()?.matchState
      ?? modules?.matchState?.getState?.()
      ?? null;
  }

  function getPlayersFromTeam(match, teamID) {
    const players = Array.isArray(match?.players?.active)
      ? match.players.active
      : Array.isArray(match?.players)
        ? match.players
        : [];

    return players
      .filter((player) => Number(player?.teamID) === Number(teamID))
      .map((player) => ({
        ...player,
        steamID: normalizeSteamID(player?.steamID ?? player?.steamId ?? player?.steam64 ?? player?.SteamID),
      }))
      .filter((player) => Boolean(player.steamID));
  }

  async function resolvePlaytimes(players) {
    const unique = [];
    const seen = new Set();

    for (const player of players) {
      const steamID = normalizeSteamID(player?.steamID);
      if (!steamID || seen.has(steamID)) continue;
      seen.add(steamID);
      unique.push({ ...player, steamID });
    }

    const playtimeBySteamID = new Map();

    if (typeof modules?.playtime?.enrichPlayers === "function") {
      try {
        const enriched = await modules.playtime.enrichPlayers(unique);
        for (const player of Array.isArray(enriched) ? enriched : []) {
          const steamID = normalizeSteamID(player?.steamID);
          if (!steamID) continue;
          playtimeBySteamID.set(steamID, extractPlaytimeHours(player));
        }
        return playtimeBySteamID;
      } catch (error) {
        pluginLogger?.warn?.(`[PJSC] enrichPlayers failed: ${error?.message || error}`);
      }
    }

    if (typeof modules?.playtime?.getBySteamID === "function") {
      for (const player of unique) {
        try {
          const row = await modules.playtime.getBySteamID(player.steamID);
          playtimeBySteamID.set(player.steamID, extractPlaytimeHours(row));
        } catch (error) {
          pluginLogger?.warn?.(`[PJSC] getBySteamID failed for ${player.steamID}: ${error?.message || error}`);
        }
      }
    }

    return playtimeBySteamID;
  }

  async function buildSummary() {
    const match = getCurrentMatch();
    const teamSummaries = [];
    const allPlayers = [];

    for (const teamID of [1, 2]) {
      const players = getPlayersFromTeam(match, teamID);
      allPlayers.push(...players);
    }

    const playtimeBySteamID = await resolvePlaytimes(allPlayers);

    for (const teamID of [1, 2]) {
      const players = getPlayersFromTeam(match, teamID);
      const enrichedPlayers = players.map((player) => ({
        ...player,
        playtimeHours: playtimeBySteamID.get(player.steamID) ?? null,
      }));
      const publicHours = enrichedPlayers
        .map((player) => player.playtimeHours)
        .filter((value) => isPublicPlaytimeHours(value));
      const leaderHours = enrichedPlayers
        .filter((player) => Boolean(player.isLeader))
        .map((player) => player.playtimeHours)
        .filter((value) => isPublicPlaytimeHours(value));

      teamSummaries.push({
        teamID,
        playerCount: enrichedPlayers.length,
        leaderCount: enrichedPlayers.filter((player) => Boolean(player.isLeader)).length,
        averageHours: averageHours(publicHours),
        leaderAverageHours: averageHours(leaderHours),
        players: enrichedPlayers,
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      teams: teamSummaries,
      lines: formatBroadcastLines(teamSummaries),
    };
  }

  async function broadcastCurrentMatch(reason = "pjsc_trigger") {
    if (!state.enabled) {
      const result = {
        success: false,
        skipped: true,
        skipReason: "plugin_disabled",
      };
      recordHistory({
        kind: "broadcast",
        success: false,
        skipped: true,
        reason,
        result,
      });
      return result;
    }

    const summary = await buildSummary();
    const broadcaster = modules?.adminWarn?.sendAdminBroadcast
      ?? modules?.adminWarn?.broadcastMessage;

    if (typeof broadcaster !== "function") {
      const result = {
        success: false,
        skipped: true,
        skipReason: "broadcast_module_unavailable",
      };
      state.lastSummary = summary;
      state.lastBroadcastResult = result;
      state.lastError = "adminWarn broadcast API unavailable";
      recordHistory({
        kind: "broadcast",
        success: false,
        skipped: true,
        reason,
        summary,
        result,
      });
      return result;
    }

    const lines = Array.isArray(summary.lines) ? summary.lines : [];
    const lineResults = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = String(lines[index] ?? "").trim();
      if (!line) continue;
      const lineResult = await broadcaster({
        message: line,
        reason: `${reason}_line_${index + 1}`,
        sourceModule: PLUGIN_ID,
        relatedEventId: reason,
      });
      lineResults.push({
        line,
        result: lineResult,
      });
    }

    const result = {
      success: lineResults.length > 0 && lineResults.every((item) => Boolean(item.result?.success)),
      skipped: lineResults.length > 0 && lineResults.every((item) => Boolean(item.result?.skipped)),
      results: lineResults,
    };

    state.lastSummary = {
      ...summary,
      message: lines.join("\n"),
    };
    state.lastBroadcastResult = result;
    state.lastBroadcastAt = new Date().toISOString();
    state.broadcastCount += result.success ? 1 : 0;
    const failedLine = lineResults.find((item) => !item.result?.success)?.result ?? null;
    state.lastError = result.success
      ? ""
      : String(failedLine?.errorMessage ?? failedLine?.skipReason ?? "broadcast_failed");

    recordHistory({
      kind: "broadcast",
      success: Boolean(result.success),
      skipped: Boolean(result.skipped),
      reason,
      summary,
      result,
    });

    return result;
  }

  function handleChatMessage(event) {
    return enqueue(async () => {
      const message = String(event?.message ?? "").trim();
      const keyword = state.triggerKeyword || DEFAULT_TRIGGER_KEYWORD;
      if (!message || !containsTrigger(message, keyword)) {
        return { matched: false };
      }

      state.triggerCount += 1;
      state.lastTriggerAt = new Date().toISOString();
      state.lastMessage = message;
      state.lastError = "";

      recordHistory({
        kind: "trigger",
        matched: true,
        message,
        playerName: String(event?.playerName ?? event?.name ?? "").trim(),
        steamID: normalizeSteamID(event?.steamID ?? event?.steamId ?? event?.steamid),
        squadID: event?.squadID ?? event?.squadId ?? null,
        teamID: event?.teamID ?? event?.teamId ?? null,
      });

      const result = await broadcastCurrentMatch("pjsc_chat_trigger");
      return {
        matched: true,
        result,
      };
    });
  }

  function getState() {
    return {
      enabled: state.enabled,
      triggerKeyword: state.triggerKeyword,
      triggerCount: state.triggerCount,
      broadcastCount: state.broadcastCount,
      lastTriggerAt: state.lastTriggerAt,
      lastBroadcastAt: state.lastBroadcastAt,
      lastMessage: state.lastMessage,
      lastSummary: state.lastSummary,
      lastBroadcastResult: state.lastBroadcastResult,
      lastError: state.lastError,
      history: [...state.history].reverse(),
    };
  }

  const api = {
    getState,

    getHistory(limit = state.historyLimit) {
      const count = Math.max(1, Number(limit) || state.historyLimit);
      return [...state.history].slice(-count).reverse();
    },

    async simulateChatMessage(payload = {}) {
      return handleChatMessage({
        ...payload,
        message: String(payload?.message ?? state.triggerKeyword ?? DEFAULT_TRIGGER_KEYWORD),
      });
    },

    async broadcastNow(reason = "manual_trigger") {
      return enqueue(() => broadcastCurrentMatch(reason));
    },

    clearHistory() {
      state.history = [];
      state.lastError = "";
      return getState();
    },
  };

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "PJSC 平均时长广播",
      kind: "plugin",
      version: "1.0.0",
      description: "监听聊天中的 pjsc 触发词，按当前对局队伍与小队长统计平均时长，并通过广播输出结果。",
    },
    apiName: "pjscAverageDuration",
    api,

    async start() {
      state.enabled = runtimeConfig.enabled;
      state.triggerKeyword = runtimeConfig.triggerKeyword;
      state.historyLimit = runtimeConfig.historyLimit;

      core?.webRegistry?.registerPage?.({
        id: "web.pjscAverageDuration.debug",
        title: "PJSC 平均时长",
        group: "调试",
        route: PAGE_ROUTE,
        pageModule: "/pages/pjsc-average-duration.js",
        source: PLUGIN_ID,
        description: "监听 pjsc 聊天触发并广播 team1/team2 平均时长与小队长平均时长。",
        required: false,
        enabled: true,
        order: 128,
        icon: "⏱️",
      });

      if (typeof modules?.chatManager?.on === "function") {
        unsubscribers.push(modules.chatManager.on("message", handleChatMessage));
      } else if (typeof core?.eventBus?.onModuleEvent === "function") {
        unsubscribers.push(core.eventBus.onModuleEvent("module.chatManager", "CHAT_RECEIVED", handleChatMessage));
      }

      pluginLogger?.info?.("[PJSC] plugin started");
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe();
        } catch {}
      }
      pluginLogger?.info?.("[PJSC] plugin stopped");
    },
  };
}

function readConfig(config) {
  const cfg = config?.get?.("plugins.pjscAverageDuration", {}) ?? {};
  return {
    enabled: cfg.enabled !== false,
    triggerKeyword: normalizeKeyword(cfg.triggerKeyword ?? DEFAULT_TRIGGER_KEYWORD),
    historyLimit: Math.max(1, Number(cfg.historyLimit ?? DEFAULT_HISTORY_LIMIT) || DEFAULT_HISTORY_LIMIT),
  };
}

function normalizeKeyword(value) {
  const text = String(value ?? DEFAULT_TRIGGER_KEYWORD).trim().toLowerCase();
  return text || DEFAULT_TRIGGER_KEYWORD;
}

function normalizeSteamID(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

function containsTrigger(message, keyword) {
  const text = String(message ?? "").toLowerCase();
  const token = normalizeKeyword(keyword);
  return token ? text.includes(token) : false;
}

function extractPlaytimeHours(player) {
  const rawHours =
    player?.playtimeHours
    ?? player?.gameHours
    ?? player?.game_hours
    ?? (Number.isFinite(Number(player?.game_seconds)) ? Number(player?.game_seconds) / 3600 : null)
    ?? (Number.isFinite(Number(player?.gameSeconds)) ? Number(player?.gameSeconds) / 3600 : null)
    ?? player?.steamPlaytime?.gameHours
    ?? player?.steamPlaytime?.playtimeHours
    ?? null;
  const hours = Number(rawHours);
  return Number.isFinite(hours) ? hours : null;
}

function isPublicPlaytimeHours(value) {
  const hours = Number(value);
  return Number.isFinite(hours) && hours > 0;
}

function averageHours(values = []) {
  const list = values.map((value) => Number(value)).filter(Number.isFinite);
  if (!list.length) return null;
  const sum = list.reduce((total, value) => total + value, 0);
  return sum / list.length;
}

function formatHours(value) {
  if (!Number.isFinite(Number(value))) return "暂无数据";
  const hours = Number(value);
  return `${hours < 1 ? hours.toFixed(2) : hours.toFixed(1)}h`;
}

function formatBroadcastLines(teamSummaries = []) {
  return [
    `[PJSC] team1 平均时长 ${formatHours(teamSummaries[0]?.averageHours)} 小队长平均时长 ${formatHours(teamSummaries[0]?.leaderAverageHours)}`,
    `[PJSC] team2 平均时长 ${formatHours(teamSummaries[1]?.averageHours)} 小队长平均时长 ${formatHours(teamSummaries[1]?.leaderAverageHours)}`,
  ];
}
