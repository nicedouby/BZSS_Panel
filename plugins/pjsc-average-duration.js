// -*- coding: utf-8 -*-

const PLUGIN_ID = "plugin.pjscAverageDuration";
const DEFAULT_TRIGGER_KEYWORD = "pjsc";
const DEFAULT_HISTORY_LIMIT = 50;
const PAGE_ROUTE = "/debug/pjsc-average-duration";
const TRIGGERS = new Set(["pjsc", "avg", "平均时长"]);

export function createPlugin({ core, modules, config, logger, playerRepository } = {}) {
  const pluginLogger =
    logger ??
    core?.createLogger?.({
      moduleId: PLUGIN_ID,
      source: PLUGIN_ID,
      channel: "module",
    }) ?? core?.logger ?? console;

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
  const handledEventIds = new Set();
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

  function getOnlinePlayers() {
    const overview = modules?.matchState?.getOverview?.() ?? null;

    if (Array.isArray(overview?.players)) return overview.players;
    if (Array.isArray(overview?.matchState?.players?.list)) return overview.matchState.players.list;
    return [];
  }

  function getMatchSnapshot() {
    return core?.runtimeState?.getMatch?.()
      ?? modules?.matchState?.getOverview?.()?.matchState
      ?? modules?.matchState?.getState?.()
      ?? null;
  }

  function getTeamMeta() {
    const match = getMatchSnapshot();
    const teams = Array.isArray(match?.teams) ? match.teams : [];
    const squads = Array.isArray(match?.squads?.list)
      ? match.squads.list
      : Array.isArray(match?.squads)
        ? match.squads
        : [];
    const teamByID = new Map();

    for (const squad of squads) {
      const teamID = Number(squad?.teamID ?? 0);
      const teamName = normalizeTeamName(squad?.teamName);
      if (!teamID || !teamName) continue;
      teamByID.set(teamID, {
        teamID,
        teamName,
      });
    }

    for (const team of teams) {
      const teamID = Number(team?.teamID ?? 0);
      const teamName = normalizeTeamName(team?.teamName);
      if (!teamID || !teamName) continue;
      if (teamByID.has(teamID)) continue;
      teamByID.set(teamID, {
        teamID,
        teamName,
      });
    }

    for (const teamID of [1, 2]) {
      if (!teamByID.has(teamID)) {
        teamByID.set(teamID, { teamID, teamName: `Team ${teamID}` });
      }
    }

    return teamByID;
  }

  async function loadPlayerRowsByIdentities(onlinePlayers = []) {
    const steamIDs = [];
    const eosIDs = [];

    for (const player of Array.isArray(onlinePlayers) ? onlinePlayers : []) {
      const steamID = normalizeSteamID(player?.steamID ?? player?.steamId ?? player?.steam64 ?? player?.steam_id);
      const eosID = normalizeText(player?.eosID ?? player?.eosId ?? player?.eos_id);
      if (steamID) steamIDs.push(steamID);
      if (eosID) eosIDs.push(eosID);
    }

    const repo = playerRepository ?? modules?.playerDatabase ?? null;
    if (typeof repo?.listPlayersByIdentities === "function") {
      return repo.listPlayersByIdentities({ steamIDs, eosIDs });
    }
    if (typeof repo?.listPlayersBySteamIDs === "function") {
      return repo.listPlayersBySteamIDs(steamIDs);
    }
    return [];
  }

  function buildAveragePlaytimeReport(onlinePlayers, dbRows) {
    const rowBySteamId = new Map();
    const rowByEosId = new Map();

    for (const row of Array.isArray(dbRows) ? dbRows : []) {
      const steam = normalizeSteamID(row?.steam_id ?? row?.steamID ?? row?.steamId);
      const eos = normalizeText(row?.eos_id ?? row?.eosID ?? row?.eosId);
      if (steam && !rowBySteamId.has(steam)) rowBySteamId.set(steam, row);
      if (eos && !rowByEosId.has(eos)) rowByEosId.set(eos, row);
    }

    const items = [];
    for (const player of Array.isArray(onlinePlayers) ? onlinePlayers : []) {
      const steamId = normalizeSteamID(player?.steamID ?? player?.steamId ?? player?.steam64 ?? player?.steam_id);
      const eosId = normalizeText(player?.eosID ?? player?.eosId ?? player?.eos_id);
      const teamID = Number(player?.teamID ?? player?.teamId ?? player?.team_id ?? 0) || 0;
      const isLeader = Boolean(player?.isLeader ?? player?.isSquadLeader ?? player?.leader);
      const name = normalizeText(player?.name ?? player?.playerName ?? player?.current_name) || "Unknown";
      const row = steamId ? rowBySteamId.get(steamId) : eosId ? rowByEosId.get(eosId) : null;
      const seconds = Number(row?.game_seconds ?? row?.gameSeconds ?? 0);
      const normalizedSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;

      items.push({
        name,
        steamId,
        eosId,
        teamID,
        isLeader,
        gameSeconds: normalizedSeconds,
        hasPublicPlaytime: normalizedSeconds > 0,
      });
    }

    const overall = summarizePlaytime(items);
    const teamMeta = getTeamMeta();
    const teams = [1, 2].map((teamID) => {
      const teamItems = items.filter((item) => Number(item.teamID) === Number(teamID));
      const teamSummary = summarizePlaytime(teamItems);
      const leaderItems = teamItems.filter((item) => item.isLeader);
      const leaderSummary = summarizePlaytime(leaderItems);
      const meta = teamMeta.get(teamID) ?? { teamID, teamName: `Team ${teamID}` };

      return {
        teamID,
        teamName: meta.teamName,
        playerCount: teamItems.length,
        publicCount: teamSummary.publicCount,
        privateCount: teamSummary.privateCount,
        leaderCount: leaderItems.length,
        averageSeconds: teamSummary.averageSeconds,
        averageHours: teamSummary.averageHours,
        leaderAverageSeconds: leaderSummary.averageSeconds,
        leaderAverageHours: leaderSummary.averageHours,
        items: teamItems,
      };
    });

    return {
      totalOnline: items.length,
      publicCount: overall.publicCount,
      privateCount: overall.privateCount,
      averageSeconds: overall.averageSeconds,
      averageHours: overall.averageHours,
      teams,
      items,
    };
  }

  function buildAveragePlaytimeMessage(report) {
    const totalOnline = Number(report?.totalOnline ?? 0);
    const publicCount = Number(report?.publicCount ?? 0);
    const privateCount = Number(report?.privateCount ?? 0);
    const team1 = report?.teams?.find((team) => Number(team.teamID) === 1) ?? null;
    const team2 = report?.teams?.find((team) => Number(team.teamID) === 2) ?? null;

    const lines = [];
    if (publicCount <= 0) {
      lines.push(`当前在线 ${totalOnline} 人，公开时长 0 人，未公开 ${privateCount} 人，无法计算平均时长`);
    } else {
      lines.push(`当前在线 ${totalOnline} 人，公开时长 ${publicCount} 人，未公开 ${privateCount} 人，平均时长 ${formatHours(report?.averageHours)} 小时`);
    }
    lines.push(formatTeamSummaryLine(team1));
    lines.push(formatTeamSummaryLine(team2));
    return lines.join("\n");
  }

  async function buildSummary() {
    const onlinePlayers = getOnlinePlayers();
    const playerRows = await loadPlayerRowsByIdentities(onlinePlayers);
    const report = buildAveragePlaytimeReport(onlinePlayers, playerRows);
    const message = buildAveragePlaytimeMessage(report);

    return {
      generatedAt: new Date().toISOString(),
      ...report,
      message,
      lines: message.split("\n"),
    };
  }

  async function broadcastCurrentMatch(reason = "pjsc_trigger") {
    if (!state.enabled) {
      const result = { success: false, skipped: true, skipReason: "plugin_disabled" };
      recordHistory({ kind: "broadcast", success: false, skipped: true, reason, result });
      return result;
    }

    const summary = await buildSummary();
    const broadcaster = modules?.adminWarn?.sendAdminBroadcast ?? modules?.adminWarn?.broadcastMessage;
    if (typeof broadcaster !== "function") {
      const result = { success: false, skipped: true, skipReason: "broadcast_module_unavailable" };
      state.lastSummary = summary;
      state.lastBroadcastResult = result;
      state.lastError = "adminWarn broadcast API unavailable";
      recordHistory({ kind: "broadcast", success: false, skipped: true, reason, summary, result });
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
      lineResults.push({ line, result: lineResult });
    }

    const result = {
      success: lineResults.length > 0 && lineResults.every((item) => Boolean(item.result?.success)),
      skipped: lineResults.length > 0 && lineResults.every((item) => Boolean(item.result?.skipped)),
      results: lineResults,
    };

    state.lastSummary = { ...summary, message: lines.join("\n") };
    state.lastBroadcastResult = result;
    state.lastBroadcastAt = new Date().toISOString();
    state.broadcastCount += result.success ? 1 : 0;
    const failedLine = lineResults.find((item) => !item.result?.success)?.result ?? null;
    state.lastError = result.success
      ? ""
      : String(failedLine?.errorMessage ?? failedLine?.skipReason ?? "broadcast_failed");

    recordHistory({ kind: "broadcast", success: Boolean(result.success), skipped: Boolean(result.skipped), reason, summary, result });
    return result;
  }

  function shouldTriggerText(value) {
    return TRIGGERS.has(normalizeCommand(value));
  }

  function isHandled(event) {
    const key = String(event?.id ?? event?.seq ?? event?.timestamp ?? "").trim();
    if (!key) return false;
    if (handledEventIds.has(key)) return true;
    handledEventIds.add(key);
    if (handledEventIds.size > 200) handledEventIds.clear();
    return false;
  }

  function handleChatMessage(event) {
    return enqueue(async () => {
      if (isHandled(event)) return { matched: false, deduped: true };
      const message = String(event?.message ?? "").trim();
      if (!message || !shouldTriggerText(message)) return { matched: false };

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
      return { matched: true, result };
    });
  }

  function handleChatCommand(event) {
    return enqueue(async () => {
      if (isHandled(event)) return { matched: false, deduped: true };
      const cmd = normalizeCommand(event?.cmd ?? deriveCommandFromMessage(event?.message));
      if (!shouldTriggerText(cmd)) return { matched: false };

      state.triggerCount += 1;
      state.lastTriggerAt = new Date().toISOString();
      state.lastMessage = String(event?.message ?? event?.cmd ?? "").trim();
      state.lastError = "";

      recordHistory({
        kind: "trigger",
        matched: true,
        message: state.lastMessage,
        playerName: String(event?.playerName ?? event?.name ?? "").trim(),
        steamID: normalizeSteamID(event?.steamID ?? event?.steamId ?? event?.steamid),
        squadID: event?.squadID ?? event?.squadId ?? null,
        teamID: event?.teamID ?? event?.teamId ?? null,
      });

      const result = await broadcastCurrentMatch("pjsc_chat_trigger");
      return { matched: true, result };
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
      const message = String(payload?.message ?? "pjsc");
      if (message.trim().startsWith("!")) {
        return handleChatCommand({
          ...payload,
          cmd: payload?.cmd ?? deriveCommandFromMessage(message),
          message,
        });
      }

      return handleChatMessage({
        ...payload,
        message,
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
      description: "监听聊天中的 pjsc / avg / 平均时长 触发词，按在线玩家的数据库游戏时长计算全服与各队平均时长并广播结果。",
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
        description: "监听 pjsc 聊天触发并广播当前在线玩家的平均时长、team1/team2 平均时长与队长平均时长。",
        required: false,
        enabled: true,
        order: 128,
        icon: "⏱️",
      });

      if (typeof modules?.chatManager?.on === "function") {
        unsubscribers.push(modules.chatManager.on("message", handleChatMessage));
        unsubscribers.push(modules.chatManager.on("command", handleChatCommand));
      } else if (typeof core?.eventBus?.onModuleEvent === "function") {
        unsubscribers.push(core.eventBus.onModuleEvent("module.chatManager", "CHAT_RECEIVED", handleChatMessage));
        unsubscribers.push(core.eventBus.onModuleEvent("module.chatManager", "CHAT_COMMAND", handleChatCommand));
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

function normalizeCommand(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^!+/, "");
}

function deriveCommandFromMessage(value) {
  const text = String(value ?? "").trim();
  if (!text.startsWith("!")) return "";
  return normalizeCommand(text);
}

function normalizeSteamID(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeTeamName(value) {
  const text = normalizeText(value);
  if (!text) return "";
  if (/^team\s*\d+$/i.test(text)) return "";
  if (/^team\d+$/i.test(text)) return "";
  if (/^t\d+$/i.test(text)) return "";
  return text;
}

function summarizePlaytime(items = []) {
  const publicItems = items.filter((item) => item?.hasPublicPlaytime);
  const totalSeconds = publicItems.reduce((sum, item) => sum + Number(item?.gameSeconds ?? 0), 0);
  const averageSeconds = publicItems.length > 0 ? totalSeconds / publicItems.length : null;
  return {
    publicCount: publicItems.length,
    privateCount: items.length - publicItems.length,
    averageSeconds,
    averageHours: averageSeconds == null ? null : averageSeconds / 3600,
  };
}

function formatTeamSummaryLine(teamSummary) {
  if (!teamSummary) {
    return `Team? 未知 平均时长 0.0 小时，队长平均时长 0.0 小时`;
  }

  const teamLabel = `Team${Number(teamSummary.teamID) || "?"}`;
  const teamName = normalizeText(teamSummary.teamName) || `Team ${teamSummary.teamID ?? "?"}`;
  const teamAverage = teamSummary.publicCount > 0 ? formatHours(teamSummary.averageHours) : "0.0";
  const leaderAverage = teamSummary.leaderCount > 0 && Number.isFinite(Number(teamSummary.leaderAverageHours))
    ? formatHours(teamSummary.leaderAverageHours)
    : "0.0";

  return `${teamLabel} ${teamName} 平均时长 ${teamAverage} 小时，队长平均时长 ${leaderAverage} 小时`;
}

function formatHours(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) return "0.0";
  return hours.toFixed(1);
}
