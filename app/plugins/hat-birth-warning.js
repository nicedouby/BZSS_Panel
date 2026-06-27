// -*- coding: utf-8 -*-

const PLUGIN_ID = "hat-birth-warning";

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
    hatRoleToken: normalizeText(cfg.hatRoleToken ?? "HAT", "HAT"),
  };
}

function resolvePlayerKey(player = {}) {
  const steamID = normalizeText(player?.steamID);
  if (steamID) return `steam:${steamID}`;
  const eosID = normalizeText(player?.eosID);
  if (eosID) return `eos:${eosID}`;
  const name = normalizeText(player?.name);
  if (name) return `name:${name.toLowerCase()}`;
  return "";
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
    hatRoleToken: "HAT",

    handled: 0,
    triggered: 0,
    cleared: 0,
    warned: 0,
    warnFailed: 0,

    lastHandledAt: "",
    lastTriggeredAt: "",
    lastClearedAt: "",
    lastError: "",

    lastPlayerName: "",
    lastPlayerSteamID: "",
    lastPlayerEosID: "",
    lastRole: "",
    lastTeamID: "",
    lastPlaytimeSeconds: null,
  };

  const markedByServer = new Map();
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
      pluginLogger?.debug?.(`[HatBirthWarning] playtime lookup failed: ${error?.message ?? error}`);
      return null;
    }
  }

  function listSquadLeaders(serverId, teamID) {
    const playerState = modules?.playerState;
    if (!playerState?.getPlayerList) return [];

    const all = playerState.getPlayerList(serverId) ?? [];
    const team = normalizeId(teamID);
    if (!team) return [];
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
      reason: "hat_birth_warning",
      sourceModule: PLUGIN_ID,
      relatedEventId: normalizeText(event?.eventId) || undefined,
      system: true,
    });
  }

  function isHatRole(role) {
    const token = normalizeText(state.hatRoleToken, "HAT");
    if (!token) return false;
    const roleText = String(role ?? "").trim();
    if (!roleText) return false;
    return roleText.toUpperCase().includes(token.toUpperCase());
  }

  function ensureMarkedSet(serverId) {
    const key = normalizeText(serverId);
    if (!key) return null;
    if (!markedByServer.has(key)) markedByServer.set(key, new Set());
    return markedByServer.get(key);
  }

  function buildHatBirthEventId(serverId, playerKey) {
    const t = Date.now();
    return `${PLUGIN_ID}:${serverId}:${playerKey}:${t}`;
  }

  function emitHatBirth({ serverId, player, role, teamID, gameSeconds, originEvent }) {
    core?.eventBus?.emitModuleEvent?.(PLUGIN_ID, "hatBirth", {
      ...(originEvent ?? {}),
      layer: "plugin",
      source: PLUGIN_ID,
      eventName: "plugin.hatBirth",
      eventId: normalizeText(originEvent?.eventId) || buildHatBirthEventId(serverId, resolvePlayerKey(player)),
      serverId: normalizeText(serverId),
      time: new Date().toISOString(),
      player: {
        name: normalizeText(player?.name),
        steamID: normalizeText(player?.steamID),
        eosID: normalizeText(player?.eosID),
        teamID: normalizeId(teamID),
        role: normalizeText(role),
      },
      gameSeconds: gameSeconds ?? null,
      title: "重筒诞生",
    });
  }

  async function handlePlayerUpdated(event = {}) {
    if (!isActive()) return;

    const serverId = normalizeText(event?.serverId);
    if (!serverId) return;

    const player = event?.player ?? {};
    const playerKey = resolvePlayerKey(player);
    if (!playerKey) return;

    const role = normalizeText(player?.role);
    const teamID = normalizeId(player?.teamID);

    state.handled += 1;
    state.lastHandledAt = new Date().toISOString();
    state.lastError = "";
    state.lastPlayerName = normalizeText(player?.name);
    state.lastPlayerSteamID = normalizeText(player?.steamID);
    state.lastPlayerEosID = normalizeText(player?.eosID);
    state.lastRole = role;
    state.lastTeamID = teamID;

    const markedSet = ensureMarkedSet(serverId);
    if (!markedSet) return;

    const isHat = isHatRole(role);
    const wasMarked = markedSet.has(playerKey);

    if (!isHat && wasMarked) {
      markedSet.delete(playerKey);
      state.cleared += 1;
      state.lastClearedAt = new Date().toISOString();
      return;
    }

    if (!isHat || wasMarked) return;

    // Rising edge: non-marked -> HAT
    markedSet.add(playerKey);
    state.triggered += 1;
    state.lastTriggeredAt = new Date().toISOString();

    const seconds = await resolveGameSeconds({
      name: player?.name,
      steamID: player?.steamID,
      eosID: player?.eosID,
    });

    state.lastPlaytimeSeconds = seconds;

    emitHatBirth({
      serverId,
      player,
      role,
      teamID,
      gameSeconds: seconds,
      originEvent: event,
    });

    const warnApi = getWarnApi();
    if (typeof warnApi !== "function") return;

    if (!teamID) return;

    const durationText = formatHoursShort(seconds);
    const playerName = normalizeText(player?.name, "未知玩家");
    const message = `${playerName} 被委任为重型反坦克射手 游戏时长 ${durationText}`;

    const recipients = listSquadLeaders(serverId, teamID);
    if (!recipients.length) return;

    const seen = new Set();

    for (const recipient of recipients) {
      try {
        const dedupKey = normalizeText(recipient?.steamID) || normalizeText(recipient?.eosID) || normalizeText(recipient?.name);
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
      name: "重型反坦克诞生提醒",
      kind: "plugin",
      version: "1.0.0",
      description: "当玩家复活选择 HAT 角色时触发一次‘重筒诞生’，并向同阵营所有队长发送该玩家游戏时长提醒。",
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
        {
          key: `plugins.${PLUGIN_ID}.hatRoleToken`,
          type: "string",
          default: "HAT",
          description: "HAT 判定 token：当 role 包含该字符串（不区分大小写）时视为 HAT",
        },
      ],
    },

    apiName: "hatBirthWarning",
    api: {
      getState() {
        return {
          ...state,
          subscribed: isPluginSubscribed(),
          markedByServer: Array.from(markedByServer.entries()).reduce((acc, [serverId, set]) => {
            acc[serverId] = set.size;
            return acc;
          }, {}),
        };
      },
    },

    async start() {
      const runtimeConfig = readRuntimeConfig(config);
      state.enabled = runtimeConfig.enabled;
      state.liveLookupWhenMissing = runtimeConfig.liveLookupWhenMissing;
      state.hatRoleToken = runtimeConfig.hatRoleToken;

      if (!state.enabled) {
        pluginLogger?.info?.("[HatBirthWarning] plugin disabled by config.");
        return;
      }

      if (typeof core?.eventBus?.onModuleEvent !== "function") {
        pluginLogger?.warn?.("[HatBirthWarning] eventBus.onModuleEvent unavailable.");
        return;
      }

      unsubscribers.push(core.eventBus.onModuleEvent("module.playerState", "playerUpdated", handlePlayerUpdated));
      pluginLogger?.info?.("[HatBirthWarning] subscriptions ready.");
    },

    async stop() {
      for (const un of unsubscribers.splice(0)) un();
      markedByServer.clear();
      pluginLogger?.info?.("[HatBirthWarning] stopped.");
    },
  };
}
