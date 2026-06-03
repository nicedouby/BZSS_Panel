// -*- coding: utf-8 -*-

const PLUGIN_ID = "commander-authorized-playtime-warning";

function normalizeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeId(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

function formatHoursShort(gameSeconds) {
  const seconds = Math.max(0, Math.floor(Number(gameSeconds) || 0));
  if (!seconds) return "未知h";
  const hours = seconds / 3600;
  const rounded = Number(hours.toFixed(1));
  return `${rounded}h`;
}

function readRuntimeConfig(config) {
  const cfg = config?.get?.(`plugins.${PLUGIN_ID}`, {}) ?? {};
  return {
    enabled: Boolean(cfg.enabled ?? true),
    liveLookupWhenMissing: Boolean(cfg.liveLookupWhenMissing ?? false),
  };
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

  const state = {
    enabled: true,
    liveLookupWhenMissing: false,
    handled: 0,
    warned: 0,
    warnFailed: 0,
    lastError: "",
    lastHandledAt: "",
    lastCommanderName: "",
    lastCommanderSteamID: "",
    lastCommanderPlaytimeSeconds: null,
  };

  const unsubscribers = [];

  function isPluginSubscribed() {
    const isSubscribed = core?.pluginSubscriptions?.isSubscribed;
    if (typeof isSubscribed !== "function") return true;
    return isSubscribed(PLUGIN_ID);
  }

  function isActive() {
    return Boolean(state.enabled) && isPluginSubscribed();
  }

  function getWarnApi() {
    return modules?.adminWarn?.warnPlayer ?? modules?.adminWarn?.sendAdminWarn ?? null;
  }

  async function resolveGameSeconds(player = {}) {
    const steamID = normalizeText(player?.steamID);
    if (!steamID) return null;

    const playtime = modules?.playtime;
    if (!playtime) return null;

    try {
      const cached = await playtime.getBySteamID?.(steamID);
      const cachedSeconds = cached?.game_seconds;
      if (cachedSeconds != null) return Number(cachedSeconds) || 0;

      if (!state.liveLookupWhenMissing) return null;

      const status = playtime.getStatus?.();
      if (status && status.configured === false) return null;

      const lookup = await playtime.lookupSteamID?.(steamID, { lastSeenName: player?.name || null });
      if (lookup?.gameSeconds != null) return Number(lookup.gameSeconds) || 0;
      return null;
    } catch (error) {
      pluginLogger?.debug?.(`[CommanderAuthorizedPlaytimeWarning] playtime lookup failed: ${error?.message ?? error}`);
      return null;
    }
  }

  function listSquadLeaders(serverId, teamID) {
    const playerState = modules?.playerState;
    if (!playerState?.getPlayerList) return [];

    const all = playerState.getPlayerList(serverId) ?? [];
    const team = normalizeId(teamID);
    if (!team) return all.filter((p) => Boolean(p?.isLeader));
    return all.filter((p) => Boolean(p?.isLeader) && normalizeId(p?.teamID) === team);
  }

  async function warnSquadLeader(warnApi, recipient, message, event) {
    const targetName = normalizeText(recipient?.name);
    if (!targetName) return { success: false, skipped: true, skipReason: "missing_target" };

    return warnApi({
      targetName,
      targetSteamId: normalizeText(recipient?.steamID) || undefined,
      targetEosId: normalizeText(recipient?.eosID) || undefined,
      message,
      reason: "commander_authorized_playtime",
      sourceModule: PLUGIN_ID,
      relatedEventId: normalizeText(event?.eventId) || undefined,
      system: true,
    });
  }

  async function handleCommanderAuthorized(event = {}) {
    if (!isActive()) return;

    const serverId = normalizeText(event?.serverId);
    if (!serverId) return;

    const warnApi = getWarnApi();
    if (typeof warnApi !== "function") return;

    const commander = event?.player ?? {};
    const commanderName = normalizeText(commander?.name, "未知玩家");
    const commanderSteamID = normalizeText(commander?.steamID);
    const commanderEosID = normalizeText(commander?.eosID);
    const commanderTeamID = normalizeId(event?.current?.teamID ?? commander?.teamID);

    const seconds = await resolveGameSeconds({
      name: commanderName,
      steamID: commanderSteamID,
      eosID: commanderEosID,
    });

    const durationText = formatHoursShort(seconds);
    const message = `${commanderName} 任命为指挥官 游戏时长 ${durationText}`;

    const recipients = listSquadLeaders(serverId, commanderTeamID);
    if (!recipients.length) return;

    const commanderNameKey = commanderName.toLowerCase();
    const commanderSteamKey = commanderSteamID;
    const commanderEosKey = commanderEosID;

    const seen = new Set();

    state.handled += 1;
    state.lastHandledAt = new Date().toISOString();
    state.lastError = "";
    state.lastCommanderName = commanderName;
    state.lastCommanderSteamID = commanderSteamID;
    state.lastCommanderPlaytimeSeconds = seconds;

    for (const recipient of recipients) {
      try {
        const name = normalizeText(recipient?.name);
        const steam = normalizeText(recipient?.steamID);
        const eos = normalizeText(recipient?.eosID);

        // Avoid warning the commander themselves (best-effort identity match)
        if (
          (steam && commanderSteamKey && steam === commanderSteamKey) ||
          (eos && commanderEosKey && eos === commanderEosKey) ||
          (name && commanderNameKey && name.toLowerCase() === commanderNameKey)
        ) {
          continue;
        }

        const dedupKey = steam || eos || name;
        if (!dedupKey) continue;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        const result = await warnSquadLeader(warnApi, recipient, message, event);
        if (result?.success) state.warned += 1;
        else state.warnFailed += 1;
      } catch (error) {
        state.warnFailed += 1;
        state.lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "指挥官任命-游戏时长提醒",
      kind: "plugin",
      version: "1.0.0",
      description: "当检测到指挥官被任命/授权时，向全体队长发送指挥官游戏时长提醒。",
      configSchema: [
        {
          key: `plugins.${PLUGIN_ID}.enabled`,
          type: "boolean",
          default: true,
          description: "是否启用插件",
        },
        {
          key: `plugins.${PLUGIN_ID}.liveLookupWhenMissing`,
          type: "boolean",
          default: false,
          description: "当本地没有缓存时是否尝试实时查询 Steam 时长（可能更慢）",
        },
      ],
    },

    apiName: "commanderAuthorizedPlaytimeWarning",
    api: {
      getState() {
        return {
          ...state,
          subscribed: isPluginSubscribed(),
        };
      },
    },

    async start() {
      const runtimeConfig = readRuntimeConfig(config);
      state.enabled = runtimeConfig.enabled;
      state.liveLookupWhenMissing = runtimeConfig.liveLookupWhenMissing;

      if (!state.enabled) {
        pluginLogger?.info?.("[CommanderAuthorizedPlaytimeWarning] plugin disabled by config.");
        return;
      }

      if (typeof core?.eventBus?.onModuleEvent !== "function") {
        pluginLogger?.warn?.("[CommanderAuthorizedPlaytimeWarning] eventBus.onModuleEvent unavailable.");
        return;
      }

      unsubscribers.push(
        core.eventBus.onModuleEvent(
          "module.playerState",
          "commanderAuthorized",
          handleCommanderAuthorized,
        ),
      );

      pluginLogger?.info?.("[CommanderAuthorizedPlaytimeWarning] subscriptions ready.");
    },

    async stop() {
      for (const un of unsubscribers.splice(0)) un();
      pluginLogger?.info?.("[CommanderAuthorizedPlaytimeWarning] stopped.");
    },
  };
}
