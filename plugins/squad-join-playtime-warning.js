// -*- coding: utf-8 -*-

const PLUGIN_ID = "squad-join-playtime-warning";

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
      pluginLogger?.debug?.(`[SquadJoinPlaytimeWarning] playtime lookup failed: ${error?.message ?? error}`);
      return null;
    }
  }

  function listSquadMembers(serverId, teamID, squadID) {
    const playerState = modules?.playerState;
    if (!playerState?.getPlayerList) return [];

    const all = playerState.getPlayerList(serverId) ?? [];
    const team = normalizeId(teamID);
    const squad = normalizeId(squadID);

    return all.filter((p) => normalizeId(p?.teamID) === team && normalizeId(p?.squadID) === squad);
  }

  async function handlePlayerJoinedSquad(event = {}) {
    if (!isActive()) return;

    const serverId = normalizeText(event?.serverId);
    const joined = event?.player ?? {};
    const currentTeamID = normalizeId(event?.current?.teamID);
    const currentSquadID = normalizeId(event?.current?.squadID);

    if (!serverId || !currentTeamID || !currentSquadID) return;

    const warnApi = getWarnApi();
    if (typeof warnApi !== "function") return;

    const joinedName = normalizeText(joined?.name, "未知玩家");
    const joinedSteamID = normalizeText(joined?.steamID);
    const joinedEosID = normalizeText(joined?.eosID);

    const seconds = await resolveGameSeconds({
      name: joinedName,
      steamID: joinedSteamID,
      eosID: joinedEosID,
    });

    const durationText = formatHoursShort(seconds);
    const message = `${joinedName} 加入小队 游戏时长 ${durationText}`;

    const recipients = listSquadMembers(serverId, currentTeamID, currentSquadID);
    if (!recipients.length) return;

    state.handled += 1;
    state.lastHandledAt = new Date().toISOString();
    state.lastError = "";

    for (const recipient of recipients) {
      try {
        const targetName = normalizeText(recipient?.name);
        if (!targetName) continue;

        const result = await warnApi({
          targetName,
          targetSteamId: normalizeText(recipient?.steamID) || undefined,
          targetEosId: normalizeText(recipient?.eosID) || undefined,
          message,
          reason: "squad_join_playtime",
          sourceModule: PLUGIN_ID,
          relatedEventId: normalizeText(event?.eventId) || undefined,
          system: true,
        });

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
      name: "小队加入-游戏时长提醒",
      kind: "plugin",
      version: "1.0.0",
      description: "玩家加入小队时，向该小队全体成员发送玩家游戏时长提醒。",
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

    apiName: "squadJoinPlaytimeWarning",
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
        pluginLogger?.info?.("[SquadJoinPlaytimeWarning] plugin disabled by config.");
        return;
      }

      if (typeof core?.eventBus?.onModuleEvent !== "function") {
        pluginLogger?.warn?.("[SquadJoinPlaytimeWarning] eventBus.onModuleEvent unavailable.");
        return;
      }

      unsubscribers.push(core.eventBus.onModuleEvent(
        "module.playerState",
        "playerJoinedSquad",
        handlePlayerJoinedSquad,
      ));

      pluginLogger?.info?.("[SquadJoinPlaytimeWarning] subscriptions ready.");
    },

    async stop() {
      for (const un of unsubscribers.splice(0)) un();
      pluginLogger?.info?.("[SquadJoinPlaytimeWarning] stopped.");
    },
  };
}
