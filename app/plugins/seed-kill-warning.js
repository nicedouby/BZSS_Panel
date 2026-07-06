// -*- coding: utf-8 -*-

const PLUGIN_ID = "seed-kill-warning";
const DEFAULT_TITLE = "火力侦察自动战绩查询";
const DEFAULT_INTERVAL_MINUTES = 3;
const DEFAULT_MESSAGE_TEMPLATE = "【${title}】你的击杀数为 ${kills}，感激参与暖服";

function normalizeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizePositiveMinutes(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return number;
}

function readRuntimeConfig(config) {
  const cfg = config?.get?.(`plugins.${PLUGIN_ID}`, {}) ?? {};
  return {
    enabled: cfg.enabled !== false,
    title: normalizeText(cfg.title, DEFAULT_TITLE),
    intervalMinutes: normalizePositiveMinutes(cfg.intervalMinutes, DEFAULT_INTERVAL_MINUTES),
    messageTemplate: normalizeText(cfg.messageTemplate, DEFAULT_MESSAGE_TEMPLATE),
  };
}

function deriveModeFromLayer(layer) {
  const text = normalizeText(layer);
  if (!text) return "";

  const tokens = text.split(/[_\s-]+/).filter(Boolean);
  if (!tokens.length) return "";

  const lastToken = tokens[tokens.length - 1];
  if (/^seed$/i.test(lastToken)) return "seed";

  if (/^(?:v?\d+|pve|pvp)$/i.test(lastToken) && tokens.length > 1) {
    const previous = normalizeText(tokens[tokens.length - 2]);
    if (!previous) return "";
    if (/^seed$/i.test(previous)) return "seed";
    if (/^(?:pve|pvp)$/i.test(previous)) return previous.toLowerCase();
    return /^[a-z]+$/i.test(previous) ? previous.toLowerCase() : "";
  }

  if (/^(?:seed|pve|pvp)$/i.test(lastToken)) return lastToken.toLowerCase();
  return /^[a-z]+$/i.test(lastToken) ? lastToken.toLowerCase() : "";
}

function getIdentityKey(player = {}) {
  const identity = player?.identity ?? {};
  const steamID = normalizeText(
    player?.steamID
    ?? player?.steamId
    ?? player?.steam64ID
    ?? identity.steamID,
  );
  if (steamID) return `steam:${steamID}`;

  const eosID = normalizeText(player?.eosID ?? player?.eosId ?? identity.eosID);
  if (eosID) return `eos:${eosID}`;

  const controllerID = normalizeText(player?.controllerID ?? identity.controllerID);
  if (controllerID) return `controller:${controllerID}`;

  const playerID = normalizeText(player?.playerID ?? player?.playerId ?? identity.playerID);
  if (playerID) return `player:${playerID}`;

  const name = normalizeText(player?.name ?? player?.playerName ?? identity.name);
  if (name) return `name:${name.toLowerCase()}`;

  return "";
}

function getPlayerName(player = {}) {
  return normalizeText(player?.name ?? player?.playerName ?? player?.identity?.name, "未知玩家");
}

function getPlayerSteamID(player = {}) {
  return normalizeText(player?.steamID ?? player?.steamId ?? player?.steam64ID ?? player?.identity?.steamID);
}

function getPlayerEOSID(player = {}) {
  return normalizeText(player?.eosID ?? player?.eosId ?? player?.identity?.eosID);
}

function getPlayerKills(player = {}) {
  const candidates = [
    player?.combat?.kills,
    player?.combat?.numKills,
    player?.kills,
    player?.stats?.kills,
    player?.playerScoreboard?.stats?.numKills,
    player?.playerScoreboard?.kills,
    player?.raw?.combat?.kills,
  ];

  for (const candidate of candidates) {
    const number = Number(candidate);
    if (Number.isFinite(number) && number >= 0) return Math.floor(number);
  }

  return 0;
}

function replaceTokens(template, values) {
  return String(template ?? DEFAULT_MESSAGE_TEMPLATE)
    .replace(/\$\{title\}/g, String(values.title))
    .replace(/\$\{kills\}/g, String(values.kills))
    .replace(/\$\{name\}/g, String(values.name))
    .replace(/\$\{playerName\}/g, String(values.name));
}

function pickModeCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") return "";

  const directValues = [
    candidate.gameMode,
    candidate.mode,
    candidate.currentMode,
    candidate.serverMode,
  ];

  for (const value of directValues) {
    const direct = normalizeText(value);
    if (direct && /^seed$/i.test(direct)) return "seed";
    if (direct && /^(?:pve|pvp)$/i.test(direct)) return direct.toLowerCase();
    if (direct && /^[a-z]+$/i.test(direct)) return direct.toLowerCase();
  }

  const layerValues = [
    candidate.layer,
    candidate.currentLayer,
    candidate.layerName,
    candidate.server?.layer,
    candidate.server?.currentLayer,
    candidate.serverStatus?.layer,
    candidate.serverStatus?.currentLayer,
    candidate.webStatus?.layer,
    candidate.webStatus?.currentLayer,
    candidate.webStatus?.gameMode,
    candidate.webStatus?.mode,
  ];

  for (const value of layerValues) {
    const derived = deriveModeFromLayer(value);
    if (derived) return derived;
  }

  return "";
}

function toPlayerArray(value) {
  return Array.isArray(value) ? value : [];
}

export function createPlugin({ core, modules, config, logger } = {}) {
  const pluginLogger =
    logger ??
    core?.createLogger?.({
      moduleId: PLUGIN_ID,
      source: PLUGIN_ID,
      channel: "plugin",
    }) ??
    core?.logger ??
    console;

  let runtimeConfig = readRuntimeConfig(config);
  let timer = null;
  let runningCycle = false;

  const state = {
    enabled: runtimeConfig.enabled,
    subscribed: true,
    title: runtimeConfig.title,
    dispatchCount: 0,
    warnSuccessCount: 0,
    warnFailedCount: 0,
    skippedCount: 0,
    lastRunAt: "",
    lastDispatchAt: "",
    lastMode: "",
    lastError: "",
    lastPlayerCount: 0,
    nextRunAt: "",
    nextDelayMs: 0,
  };

  function isPluginSubscribed() {
    const isSubscribed = core?.pluginSubscriptions?.isSubscribed;
    if (typeof isSubscribed !== "function") return true;
    return isSubscribed(PLUGIN_ID);
  }

  function isActive() {
    return Boolean(state.enabled) && isPluginSubscribed();
  }

  function clearSchedule() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    state.nextRunAt = "";
    state.nextDelayMs = 0;
  }

  function getServerId() {
    return normalizeText(core?.webStatus?.serverId ?? core?.webStatus?.getSnapshot?.()?.serverId);
  }

  function getWarnApi() {
    return modules?.adminWarn?.sendAdminWarn ?? modules?.adminWarn?.warnPlayer ?? null;
  }

  function getCurrentMode() {
    const serverId = getServerId();
    const candidates = [
      core?.webStatus?.getSnapshot?.(),
      core?.webStatus?.state,
      modules?.matchState?.getState?.(serverId),
      modules?.matchState?.getOverview?.()?.matchState,
    ];

    for (const candidate of candidates) {
      const mode = pickModeCandidate(candidate);
      if (mode) return mode;
    }

    return "";
  }

  async function getOnlinePlayers() {
    const serverId = getServerId();
    if (typeof modules?.tacticalState?.getPlayers === "function") {
      const tacticalPlayers = await modules.tacticalState.getPlayers();
      if (Array.isArray(tacticalPlayers) && tacticalPlayers.length > 0) {
        return tacticalPlayers;
      }
    }

    return toPlayerArray(modules?.playerState?.getPlayerList?.(serverId));
  }

  function buildMessage(player) {
    return replaceTokens(runtimeConfig.messageTemplate, {
      title: state.title,
      name: getPlayerName(player),
      kills: getPlayerKills(player),
    });
  }

  async function warnPlayer(warnApi, player) {
    const targetName = getPlayerName(player);
    if (!targetName) {
      return { success: false, skipped: true, skipReason: "missing_target" };
    }

    const message = buildMessage(player);
    return warnApi({
      title: state.title,
      targetName,
      targetSteamId: getPlayerSteamID(player) || undefined,
      targetEosId: getPlayerEOSID(player) || undefined,
      message,
      reason: "seed_kill_warning",
      sourceModule: PLUGIN_ID,
      system: true,
    });
  }

  function finishSchedule() {
    clearSchedule();
    if (!isActive()) return;

    const delayMs = Math.max(1, Math.floor(runtimeConfig.intervalMinutes * 60_000));
    state.nextDelayMs = delayMs;
    state.nextRunAt = new Date(Date.now() + delayMs).toISOString();

    timer = setTimeout(() => {
      timer = null;
      void runCycle("interval", { reschedule: true });
    }, delayMs);
  }

  async function runCycle(reason = "interval", { reschedule = true } = {}) {
    if (runningCycle) {
      return { success: false, skipped: true, skipReason: "cycle_running" };
    }

    runningCycle = true;
    state.lastRunAt = new Date().toISOString();
    state.subscribed = isPluginSubscribed();
    state.enabled = runtimeConfig.enabled;
    state.title = runtimeConfig.title;

    try {
      if (!isActive()) {
        clearSchedule();
        const skipReason = !state.enabled ? "plugin_disabled" : "plugin_unsubscribed";
        state.lastError = skipReason;
        return { success: false, skipped: true, skipReason };
      }

      const mode = getCurrentMode();
      state.lastMode = mode;

      if (mode !== "seed") {
        state.skippedCount += 1;
        state.lastError = "not_seed_mode";
        return { success: false, skipped: true, skipReason: "not_seed_mode", mode };
      }

      const warnApi = getWarnApi();
      if (typeof warnApi !== "function") {
        state.lastError = "admin_warn_api_unavailable";
        pluginLogger?.warn?.("[SeedKillWarning] adminWarn API unavailable.");
        return { success: false, skipped: true, skipReason: "admin_warn_api_unavailable", mode };
      }

      const players = await getOnlinePlayers();
      state.lastPlayerCount = players.length;
      if (!players.length) {
        state.skippedCount += 1;
        state.lastError = "no_online_players";
        return { success: false, skipped: true, skipReason: "no_online_players", mode };
      }

      const deduped = new Map();
      for (const player of players) {
        const key = getIdentityKey(player);
        if (!key) continue;
        if (deduped.has(key)) continue;
        deduped.set(key, player);
      }

      let successCount = 0;
      let failedCount = 0;

      for (const player of deduped.values()) {
        try {
          const result = await warnPlayer(warnApi, player);
          if (result?.success) {
            successCount += 1;
            continue;
          }
          failedCount += 1;
        } catch (error) {
          failedCount += 1;
          state.lastError = error instanceof Error ? error.message : String(error ?? "warn_failed");
        }
      }

      if (successCount > 0) {
        state.dispatchCount += 1;
        state.warnSuccessCount += successCount;
        state.lastDispatchAt = new Date().toISOString();
      }

      if (failedCount > 0) {
        state.warnFailedCount += failedCount;
        state.lastError = `warn_failed_${failedCount}`;
      } else {
        state.lastError = "";
      }

      return {
        success: successCount > 0 && failedCount === 0,
        skipped: false,
        mode,
        successCount,
        failedCount,
        playerCount: deduped.size,
      };
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error ?? "seed_kill_warning_failed");
      pluginLogger?.error?.(`[SeedKillWarning] cycle failed: ${state.lastError}`);
      return { success: false, skipped: true, skipReason: "cycle_failed", error: state.lastError };
    } finally {
      runningCycle = false;
      if (reschedule) {
        finishSchedule();
      }
    }
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "Seed 击杀提醒",
      kind: "plugin",
      version: "1.0.1",
      description: "在 seed 模式下每 3 分钟向在线玩家发送带标题的击杀数提醒。",
      configSchema: [
        {
          key: `plugins.${PLUGIN_ID}.enabled`,
          type: "boolean",
          default: true,
          description: "是否启用 seed 击杀提醒插件",
        },
        {
          key: `plugins.${PLUGIN_ID}.title`,
          type: "string",
          default: DEFAULT_TITLE,
          description: "警告标题",
        },
        {
          key: `plugins.${PLUGIN_ID}.intervalMinutes`,
          type: "number",
          default: 3,
          description: "提醒间隔，单位分钟",
        },
        {
          key: `plugins.${PLUGIN_ID}.messageTemplate`,
          type: "string",
          default: DEFAULT_MESSAGE_TEMPLATE,
          description: "提醒模板，支持 ${title}、${kills} 和 ${name}",
        },
      ],
    },

    apiName: "seedKillWarning",
    api: {
      getState() {
        return {
          ...state,
          config: { ...runtimeConfig },
          subscribed: isPluginSubscribed(),
          active: isActive(),
          timerActive: Boolean(timer),
        };
      },

      async runNow() {
        return runCycle("manual", { reschedule: false });
      },

      reloadConfig() {
        runtimeConfig = readRuntimeConfig(config);
        state.title = runtimeConfig.title;
        state.enabled = runtimeConfig.enabled;
        if (!isActive()) {
          clearSchedule();
          return this.getState();
        }
        finishSchedule();
        return this.getState();
      },
    },

    async start() {
      runtimeConfig = readRuntimeConfig(config);
      state.enabled = runtimeConfig.enabled;
      state.title = runtimeConfig.title;
      state.subscribed = isPluginSubscribed();

      if (!state.enabled) {
        pluginLogger?.info?.("[SeedKillWarning] plugin disabled by config.");
        return;
      }

      finishSchedule();
      pluginLogger?.info?.(`[SeedKillWarning] started. interval=${runtimeConfig.intervalMinutes} minutes.`);
    },

    async stop() {
      clearSchedule();
      pluginLogger?.info?.("[SeedKillWarning] stopped.");
    },
  };
}

export default { createPlugin };
