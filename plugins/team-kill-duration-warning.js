// -*- coding: utf-8 -*-

const PLUGIN_ID = "plugin.team-kill-duration-warning";
const SUBSCRIPTIONS = [
  ["module.combatManager", "KILL_MANAGER_EVENT"],
  ["module.killManage", "teamKillResolved"],
];

export function createPlugin(context = {}) {
  const {
    core = null,
    modules = {},
    logger = null,
    playerRepository = null,
    steamGameDurationService = null,
  } = context;

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
  const handledEventKeys = new Map();
  const history = [];
  let serial = Promise.resolve();

  const state = {
    enabled: true,
    subscribed: true,
    teamKillCount: 0,
    warningSuccessCount: 0,
    warningFailCount: 0,
    lastTeamKillAt: "",
    lastWarnAt: "",
    lastError: "",
    recent: [],
  };

  function enqueue(task) {
    const next = Promise.resolve().then(task);
    serial = next.catch(() => {});
    return next;
  }

  function isPluginSubscribed() {
    const isSubscribed = core?.pluginSubscriptions?.isSubscribed;
    if (typeof isSubscribed !== "function") return true;
    return isSubscribed(PLUGIN_ID);
  }

  function isActive() {
    return Boolean(state.enabled) && isPluginSubscribed();
  }

  function pushHistory(entry) {
    const record = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at: new Date().toISOString(),
      ...entry,
    };
    history.push(record);
    state.recent.push(record);
    if (history.length > 100) history.splice(0, history.length - 100);
    if (state.recent.length > 50) state.recent.splice(0, state.recent.length - 50);
  }

  function pruneHandledKeys(now = Date.now()) {
    for (const [key, timestamp] of handledEventKeys.entries()) {
      if (now - timestamp > 10 * 60_000) {
        handledEventKeys.delete(key);
      }
    }
    while (handledEventKeys.size > 500) {
      const firstKey = handledEventKeys.keys().next().value;
      if (!firstKey) break;
      handledEventKeys.delete(firstKey);
    }
  }

  function buildEventKey(event = {}, record = {}) {
    const direct = String(event?.eventId ?? record?.combatEventId ?? record?.sourceEventId ?? "").trim();
    if (direct) return direct;

    const source = String(event?.source ?? record?.sourceModule ?? "").trim();
    const time = String(record?.time ?? event?.time ?? "").trim();
    const attacker = String(record?.attackerName ?? record?.attacker?.name ?? "").trim();
    const victim = String(record?.victimName ?? record?.victim?.name ?? "").trim();
    return [source, time, attacker, victim].filter(Boolean).join("|");
  }

  function normalizeText(value, fallback = "") {
    const text = String(value ?? "").trim();
    return text || fallback;
  }

  function normalizeSteamID(value) {
    const text = String(value ?? "").trim();
    return text || "";
  }

  function formatDuration(seconds) {
    const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    if (!totalSeconds) return "未知";

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (hours <= 0) return `${Math.max(1, minutes)}分钟`;
    if (minutes <= 0) return `${hours}小时`;
    return `${hours}小时${minutes}分钟`;
  }

  function extractSide(record = {}, side = "attacker") {
    const source = record?.[side] && typeof record[side] === "object" ? record[side] : {};
    const prefix = side === "attacker" ? "attacker" : "victim";
    const name = normalizeText(
      record?.[`${prefix}Name`],
      source.name || source.displayName || source.playerName || source.nickname || "",
    );
    const steamID = normalizeSteamID(
      record?.[`${prefix}Steam64ID`]
        ?? record?.[`${prefix}SteamId`]
        ?? record?.[`${prefix}SteamID`]
        ?? source.steam64ID
        ?? source.steamID
        ?? source.steamId
        ?? source.steam_id
        ?? "",
    );
    const eosID = normalizeText(
      record?.[`${prefix}EOSID`]
        ?? record?.[`${prefix}EosID`]
        ?? source.eosID
        ?? source.eosId
        ?? source.eos_id
        ?? "",
    );

    return { name, steamID, eosID };
  }

  function resolveRecord(event = {}) {
    return event?.record ?? event?.payload?.record ?? event?.data?.record ?? event?.rejection?.record ?? null;
  }

  function isTeamKill(event = {}, record = {}) {
    if (record?.isTeamKill || record?.friendlyFireType === "team_kill" || record?.tk || record?.teamKillReason) {
      return true;
    }
    if (event?.eventName === "teamKillResolved") return true;
    if (event?.eventName === "KILL_MANAGER_EVENT") {
      return Boolean(record?.isFriendlyFire || record?.relation?.isFriendlyFire || record?.eventFlags?.some?.((flag) => String(flag?.key ?? "").toLowerCase() === "friendly_fire"));
    }
    return false;
  }

  function getServerId(event = {}, record = {}) {
    return normalizeText(record?.serverId ?? event?.serverId ?? core?.webStatus?.serverId ?? "");
  }

  function findLivePlayer(serverId, identity = {}) {
    const name = normalizeText(identity.name);
    const steamID = normalizeSteamID(identity.steamID);

    if (steamID && typeof modules?.playerState?.getPlayerBySteamID === "function") {
      const hit = modules.playerState.getPlayerBySteamID(serverId, steamID);
      if (hit) return hit;
    }

    if (name && typeof modules?.playerState?.getPlayerByName === "function") {
      const hit = modules.playerState.getPlayerByName(serverId, name);
      if (hit) return hit;
    }

    return null;
  }

  async function resolveAttackerDurationSeconds(serverId, attacker = {}) {
    const steamID = normalizeSteamID(attacker.steamID);
    const attackerName = normalizeText(attacker.name);
    const repo = playerRepository ?? modules?.playerDatabase ?? null;

    const cachedSeconds = await readCachedDuration(repo, { steamID, name: attackerName });
    if (cachedSeconds != null) return cachedSeconds;

    if (steamID && typeof steamGameDurationService?.fetchGameDurationSeconds === "function") {
      return await steamGameDurationService.fetchGameDurationSeconds(steamID);
    }

    if (steamID && typeof steamGameDurationService?.lookupSteamDuration === "function") {
      const lookup = await steamGameDurationService.lookupSteamDuration(steamID, {
        lastSeenName: attackerName || null,
      });
      if (lookup && typeof lookup === "object") {
        return Number(lookup.gameSeconds ?? lookup.game_seconds ?? lookup.seconds ?? 0) || 0;
      }
      return Number(lookup ?? 0) || 0;
    }

    if (cachedSeconds != null) return cachedSeconds;
    return 0;
  }

  async function readCachedDuration(repo, identity = {}) {
    if (!repo) return null;

    if (identity.steamID && typeof repo.getCachedPlayer === "function") {
      const player = await repo.getCachedPlayer({ steamID: identity.steamID });
      const seconds = Number(player?.game_seconds ?? player?.gameSeconds ?? 0);
      if (Number.isFinite(seconds) && seconds > 0) return Math.floor(seconds);
    }

    if (identity.steamID && typeof repo.listPlayersBySteamIDs === "function") {
      const players = await repo.listPlayersBySteamIDs([identity.steamID]);
      const player = Array.isArray(players) ? players[0] : null;
      const seconds = Number(player?.game_seconds ?? player?.gameSeconds ?? 0);
      if (Number.isFinite(seconds) && seconds > 0) return Math.floor(seconds);
    }

    if (identity.name && typeof repo.getCachedPlayer === "function") {
      const player = await repo.getCachedPlayer({ name: identity.name });
      const seconds = Number(player?.game_seconds ?? player?.gameSeconds ?? 0);
      if (Number.isFinite(seconds) && seconds > 0) return Math.floor(seconds);
    }

    return null;
  }

  function resolvePlayerIdentity(serverId, sideIdentity = {}) {
    const livePlayer = findLivePlayer(serverId, sideIdentity);
    if (livePlayer) {
      return {
        name: normalizeText(livePlayer.name, sideIdentity.name),
        steamID: normalizeSteamID(livePlayer.steamID ?? livePlayer.steam64ID ?? sideIdentity.steamID),
      };
    }

    return {
      name: normalizeText(sideIdentity.name),
      steamID: normalizeSteamID(sideIdentity.steamID),
    };
  }

  function makeWarningMessage(attackerName, durationText) {
    return `[BZSS]攻击你的友军 ${attackerName} 游戏时长为${durationText}`;
  }

  async function sendWarning({ serverId, victim, attacker, eventId }) {
    const adminWarn = modules?.adminWarn;
    const sender = adminWarn?.sendAdminWarn ?? adminWarn?.warnPlayer;
    if (typeof sender !== "function") {
      throw new Error("adminWarn API unavailable");
    }

    const victimIdentity = resolvePlayerIdentity(serverId, victim);
    if (!victimIdentity.name) {
      throw new Error("victim name unavailable");
    }

    const attackerDurationSeconds = await resolveAttackerDurationSeconds(serverId, attacker);
    const message = makeWarningMessage(attacker.name || "未知玩家", formatDuration(attackerDurationSeconds));

    return sender.call(adminWarn, {
      targetName: victimIdentity.name,
      targetSteamId: victimIdentity.steamID || undefined,
      message,
      reason: "team_kill_duration_warning",
      sourceModule: PLUGIN_ID,
      relatedEventId: eventId,
      system: true,
    });
  }

  async function handleCombatEvent(event = {}) {
    const record = resolveRecord(event);
    if (!record || !isTeamKill(event, record)) return null;

    const key = buildEventKey(event, record);
    const now = Date.now();
    pruneHandledKeys(now);
    if (handledEventKeys.has(key)) return null;
    handledEventKeys.set(key, now);

    state.teamKillCount += 1;
    state.lastTeamKillAt = new Date().toISOString();

    const serverId = getServerId(event, record);
    const attacker = resolvePlayerIdentity(serverId, extractSide(record, "attacker"));
    const victim = resolvePlayerIdentity(serverId, extractSide(record, "victim"));
    const eventId = normalizeText(event?.eventId ?? record?.combatEventId ?? record?.sourceEventId ?? key);

    if (!isActive()) {
      pushHistory({
        kind: "teamKill",
        success: false,
        skipped: true,
        reason: !state.enabled ? "plugin_disabled" : "plugin_unsubscribed",
        serverId,
        attacker,
        victim,
        eventId,
      });
      return null;
    }

    return enqueue(async () => {
      try {
        const result = await sendWarning({ serverId, victim, attacker, eventId });
        state.warningSuccessCount += 1;
        state.lastWarnAt = new Date().toISOString();
        state.lastError = "";
        pushHistory({
          kind: "teamKill",
          success: true,
          skipped: false,
          serverId,
          attacker,
          victim,
          eventId,
          message: result?.message ?? makeWarningMessage(attacker.name || "未知玩家", "未知"),
          commandText: result?.commandText ?? "",
          relatedEventId: result?.relatedEventId ?? eventId,
        });
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        state.warningFailCount += 1;
        state.lastError = errorMessage;
        pushHistory({
          kind: "teamKill",
          success: false,
          skipped: false,
          serverId,
          attacker,
          victim,
          eventId,
          errorMessage,
        });
        pluginLogger?.warn?.(`[TeamKillDurationWarning] warn failed: ${errorMessage}`);
        return {
          success: false,
          skipped: false,
          errorMessage,
        };
      }
    });
  }

  function getState() {
    return {
      enabled: state.enabled,
      subscribed: isPluginSubscribed(),
      teamKillCount: state.teamKillCount,
      warningSuccessCount: state.warningSuccessCount,
      warningFailCount: state.warningFailCount,
      lastTeamKillAt: state.lastTeamKillAt,
      lastWarnAt: state.lastWarnAt,
      lastError: state.lastError,
      recent: [...state.recent].reverse(),
      history: [...history].reverse(),
    };
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "Team Kill Duration Warning",
      kind: "plugin",
      version: "1.0.0",
      category: "Combat",
      description: "订阅战斗管理的团队击杀事件，向受害者发送攻击者游戏时长警告。",
    },

    apiName: "teamKillDurationWarning",
    api: {
      getState,
    },

    async start() {
      if (!core?.eventBus?.onModuleEvent) {
        pluginLogger?.warn?.("[TeamKillDurationWarning] eventBus.onModuleEvent unavailable.");
        return;
      }

      for (const [moduleId, eventName] of SUBSCRIPTIONS) {
        unsubscribers.push(
          core.eventBus.onModuleEvent(moduleId, eventName, (event) => {
            void handleCombatEvent(event);
          }),
        );
      }

      pluginLogger?.info?.("[TeamKillDurationWarning] plugin started.", {
        operation: "start",
      });
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe?.();
        } catch {}
      }
      handledEventKeys.clear();
      pluginLogger?.info?.("[TeamKillDurationWarning] plugin stopped.", {
        operation: "stop",
      });
    },
  };
}

export default createPlugin;
