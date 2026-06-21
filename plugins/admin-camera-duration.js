// -*- coding: utf-8 -*-

const PLUGIN_ID = "plugin.adminCameraDuration";
const DEFAULT_HISTORY_LIMIT = 100;
const DEFAULT_BROADCAST_PREFIX = "[BZSS]";
const SUBSCRIPTIONS = [
  "POSSESSED_ADMIN_CAM",
  "UNPOSSESSED_ADMIN_CAM",
];

function normalizeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeId(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

function toMillis(value) {
  const text = normalizeText(value);
  if (!text) return Date.now();

  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return parsed;

  return Date.now();
}

function formatDurationMs(durationMs) {
  const totalMs = Math.max(0, Math.floor(Number(durationMs) || 0));
  const totalSeconds = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}秒`);
  return parts.join("");
}

function buildPlayerKey(player = {}) {
  const steamID = normalizeText(player?.steamID);
  if (steamID) return `steam:${steamID}`;

  const eosID = normalizeText(player?.eosID);
  if (eosID) return `eos:${eosID}`;

  const name = normalizeText(player?.name);
  if (name) return `name:${name.toLowerCase()}`;

  return "";
}

function resolveAdminCamPayload(event = {}) {
  const payload = event?.payload ?? event?.data?.payload ?? event?.player ?? {};
  return payload && typeof payload === "object" ? payload : {};
}

function parseRuntimeConfig(config) {
  const raw = config?.get?.(`plugins.${PLUGIN_ID}`, {}) ?? {};
  return {
    enabled: raw.enabled !== false,
    historyLimit: Math.max(1, Number(raw.historyLimit ?? DEFAULT_HISTORY_LIMIT) || DEFAULT_HISTORY_LIMIT),
    broadcastPrefix: normalizeText(raw.broadcastPrefix ?? DEFAULT_BROADCAST_PREFIX, DEFAULT_BROADCAST_PREFIX),
    warnOnEnter: raw.warnOnEnter !== false,
    broadcastOnEnd: raw.broadcastOnEnd !== false,
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

  const runtimeConfig = parseRuntimeConfig(config);
  const activeSessions = new Map();
  const playerStats = new Map();
  const history = [];
  const unsubscribers = [];

  const state = {
    enabled: runtimeConfig.enabled,
    historyLimit: runtimeConfig.historyLimit,
    broadcastPrefix: runtimeConfig.broadcastPrefix,
    warnOnEnter: runtimeConfig.warnOnEnter,
    broadcastOnEnd: runtimeConfig.broadcastOnEnd,
    trackedCount: 0,
    totalStartCount: 0,
    totalEndCount: 0,
    totalIgnoredEndCount: 0,
    totalOverlapCount: 0,
    lastStartAt: "",
    lastEndAt: "",
    lastDurationMs: null,
    lastDurationText: "",
    lastPlayerName: "",
    lastPlayerSteamID: "",
    lastPlayerEosID: "",
    lastServerId: "",
    lastError: "",
    recent: [],
  };

  function isSubscribed() {
    const isPluginSubscribed = core?.pluginSubscriptions?.isSubscribed;
    if (typeof isPluginSubscribed !== "function") return true;
    return isPluginSubscribed(PLUGIN_ID);
  }

  function isActive() {
    return Boolean(state.enabled) && isSubscribed();
  }

  function pushHistory(entry) {
    const record = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at: new Date().toISOString(),
      ...entry,
    };
    history.push(record);
    state.recent.unshift(record);
    if (history.length > state.historyLimit) history.splice(0, history.length - state.historyLimit);
    if (state.recent.length > state.historyLimit) state.recent.length = state.historyLimit;
  }

  function getWarner() {
    return modules?.adminWarn?.sendAdminWarn ?? modules?.adminWarn?.warnPlayer ?? null;
  }

  function buildEventKey(event = {}) {
    const serverId = normalizeText(event?.serverId ?? core?.webStatus?.serverId ?? "");
    const player = resolveAdminCamPayload(event);
    const key = buildPlayerKey(player);
    return [serverId, key].filter(Boolean).join("|");
  }

  function getPlayerStatKey(session = {}) {
    return [normalizeText(session.serverId), normalizeText(session.key)].filter(Boolean).join("|");
  }

  function ensurePlayerStat(session = {}) {
    const key = getPlayerStatKey(session);
    if (!key) return null;

    if (!playerStats.has(key)) {
      playerStats.set(key, {
        key,
        serverId: normalizeText(session.serverId),
        name: normalizeText(session.name, "Unknown"),
        steamID: normalizeText(session.steamID),
        eosID: normalizeText(session.eosID),
        teamID: normalizeId(session.teamID),
        startCount: 0,
        endCount: 0,
        ignoredEndCount: 0,
        totalDurationMs: 0,
        lastStartAt: "",
        lastEndAt: "",
        lastDurationMs: null,
        lastDurationText: "",
        lastEventId: "",
      });
    }

    return playerStats.get(key);
  }

  function updatePlayerStatOnStart(session = {}) {
    const stat = ensurePlayerStat(session);
    if (!stat) return null;

    stat.serverId = normalizeText(session.serverId, stat.serverId);
    stat.name = normalizeText(session.name, stat.name);
    stat.steamID = normalizeText(session.steamID, stat.steamID);
    stat.eosID = normalizeText(session.eosID, stat.eosID);
    stat.teamID = normalizeId(session.teamID, stat.teamID);
    stat.startCount += 1;
    stat.lastStartAt = session.startedAtISO;
    stat.lastEventId = session.startEventId;
    return stat;
  }

  function updatePlayerStatOnEnd(session = {}, durationMs = 0, durationText = "", eventId = "") {
    const stat = ensurePlayerStat(session);
    if (!stat) return null;

    stat.serverId = normalizeText(session.serverId, stat.serverId);
    stat.name = normalizeText(session.name, stat.name);
    stat.steamID = normalizeText(session.steamID, stat.steamID);
    stat.eosID = normalizeText(session.eosID, stat.eosID);
    stat.teamID = normalizeId(session.teamID, stat.teamID);
    stat.endCount += 1;
    stat.totalDurationMs += Math.max(0, Math.floor(Number(durationMs) || 0));
    stat.lastEndAt = session.endedAtISO ?? new Date().toISOString();
    stat.lastDurationMs = Math.max(0, Math.floor(Number(durationMs) || 0));
    stat.lastDurationText = durationText;
    stat.lastEventId = eventId || stat.lastEventId;
    return stat;
  }

  function updatePlayerStatOnIgnoredEnd(session = {}, eventId = "") {
    const stat = ensurePlayerStat(session);
    if (!stat) return null;

    stat.ignoredEndCount += 1;
    stat.lastEventId = eventId || stat.lastEventId;
    return stat;
  }

  function createIdentity(event = {}) {
    const payload = resolveAdminCamPayload(event);
    return {
      name: normalizeText(payload?.name ?? event?.name ?? event?.playerName, "Unknown"),
      steamID: normalizeText(payload?.steamID ?? payload?.steamId ?? event?.steamID ?? event?.steamId),
      eosID: normalizeText(payload?.eosID ?? payload?.eosId ?? event?.eosID ?? event?.eosId),
      teamID: normalizeId(payload?.teamID ?? payload?.teamId ?? event?.teamID ?? event?.teamId),
    };
  }

  async function sendWarning(session, message, eventId, reason) {
    const warner = getWarner();
    if (typeof warner !== "function") {
      return { success: false, skipped: true, skipReason: "warn_api_unavailable" };
    }

    return await warner.call(modules.adminWarn, {
      targetName: session.name,
      targetSteamId: session.steamID || undefined,
      targetEosId: session.eosID || undefined,
      message,
      reason,
      sourceModule: PLUGIN_ID,
      relatedEventId: eventId,
      system: true,
    });
  }

  function registerSession(event = {}) {
    const serverId = normalizeText(event?.serverId ?? core?.webStatus?.serverId ?? "");
    const identity = createIdentity(event);
    const key = buildEventKey(event);
    if (!serverId || !key || !identity.name) return null;

    const startedAt = toMillis(event?.time ?? event?.payload?.time ?? event?.payload?.timestamp);
    const session = {
      key,
      serverId,
      ...identity,
      startedAt,
      startedAtISO: new Date(startedAt).toISOString(),
      startEventId: normalizeText(event?.eventId) || `${PLUGIN_ID}:${key}:${startedAt}`,
      startEventName: normalizeText(event?.eventName, "POSSESSED_ADMIN_CAM"),
    };

    const existing = activeSessions.get(key);
    if (existing) {
      state.totalOverlapCount += 1;
      existing.startedAt = startedAt;
      existing.startedAtISO = new Date(startedAt).toISOString();
      existing.startEventId = session.startEventId;
      existing.startEventName = session.startEventName;
      existing.name = session.name;
      existing.steamID = session.steamID;
      existing.eosID = session.eosID;
      existing.teamID = session.teamID;
      updatePlayerStatOnStart(existing);
      return existing;
    }

    activeSessions.set(key, session);
    state.trackedCount = activeSessions.size;
    updatePlayerStatOnStart(session);
    return session;
  }

  function closeSession(event = {}) {
    const key = buildEventKey(event);
    if (!key) return null;

    const session = activeSessions.get(key);
    if (!session) return null;

    const endedAt = toMillis(event?.time ?? event?.payload?.time ?? event?.payload?.timestamp);
    const durationMs = Math.max(0, endedAt - Number(session.startedAt ?? endedAt));
    const durationText = formatDurationMs(durationMs);
    const playerName = normalizeText(session.name, "Unknown");

    activeSessions.delete(key);
    state.trackedCount = activeSessions.size;
    state.totalEndCount += 1;
    state.lastEndAt = new Date(endedAt).toISOString();
    state.lastDurationMs = durationMs;
    state.lastDurationText = durationText;
    state.lastPlayerName = playerName;
    state.lastPlayerSteamID = normalizeText(session.steamID);
    state.lastPlayerEosID = normalizeText(session.eosID);
    state.lastServerId = normalizeText(session.serverId);
    updatePlayerStatOnEnd(session, durationMs, durationText, normalizeText(event?.eventId) || `${PLUGIN_ID}:${key}:${endedAt}:end`);

    return {
      ...session,
      endedAt,
      endedAtISO: new Date(endedAt).toISOString(),
      durationMs,
      durationText,
      endEventId: normalizeText(event?.eventId) || `${PLUGIN_ID}:${key}:${endedAt}:end`,
      endEventName: normalizeText(event?.eventName, "UNPOSSESSED_ADMIN_CAM"),
    };
  }

  async function handlePossess(event = {}) {
    if (!isActive()) return;

    const session = registerSession(event);
    if (!session) return;

    state.totalStartCount += 1;
    state.lastStartAt = new Date(session.startedAt).toISOString();
    state.lastPlayerName = session.name;
    state.lastPlayerSteamID = session.steamID;
    state.lastPlayerEosID = session.eosID;
    state.lastServerId = session.serverId;
    state.lastError = "";

    pushHistory({
      kind: "start",
      serverId: session.serverId,
      player: {
        name: session.name,
        steamID: session.steamID,
        eosID: session.eosID,
        teamID: session.teamID,
      },
      eventId: session.startEventId,
      eventName: session.startEventName,
      startedAt: session.startedAtISO,
      message: `${state.broadcastPrefix}你已经进入管理员视角`,
    });

    if (!state.warnOnEnter) return;

    try {
      const message = `${state.broadcastPrefix}你已经进入管理员视角`;
      const result = await sendWarning(session, message, session.startEventId, "admin_camera_enter");
      if (result?.success === false) {
        state.lastError = String(result?.errorMessage ?? result?.message ?? "broadcast failed");
        pushHistory({
          kind: "start-broadcast",
          success: false,
          skipped: Boolean(result?.skipped),
          skipReason: result?.skipReason ?? "",
          serverId: session.serverId,
          player: { name: session.name, steamID: session.steamID, eosID: session.eosID },
          eventId: session.startEventId,
          errorMessage: state.lastError,
        });
        return;
      }

      pushHistory({
        kind: "start-broadcast",
        success: true,
        serverId: session.serverId,
        player: { name: session.name, steamID: session.steamID, eosID: session.eosID },
        eventId: session.startEventId,
        message,
      });
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      pushHistory({
        kind: "start-broadcast",
        success: false,
        serverId: session.serverId,
        player: { name: session.name, steamID: session.steamID, eosID: session.eosID },
        eventId: session.startEventId,
        errorMessage: state.lastError,
      });
      pluginLogger?.warn?.(`[AdminCameraDuration] enter broadcast failed: ${state.lastError}`);
    }
  }

  async function handleUnpossess(event = {}) {
    if (!isActive()) return;

    const session = closeSession(event);
    if (!session) {
      state.totalIgnoredEndCount += 1;
      const ignoredSession = {
        serverId: normalizeText(event?.serverId ?? core?.webStatus?.serverId ?? ""),
        key: buildEventKey(event),
        name: normalizeText(resolveAdminCamPayload(event)?.name ?? event?.name ?? event?.playerName, "Unknown"),
        steamID: normalizeText(resolveAdminCamPayload(event)?.steamID ?? resolveAdminCamPayload(event)?.steamId ?? event?.steamID ?? event?.steamId),
        eosID: normalizeText(resolveAdminCamPayload(event)?.eosID ?? resolveAdminCamPayload(event)?.eosId ?? event?.eosID ?? event?.eosId),
        teamID: normalizeId(resolveAdminCamPayload(event)?.teamID ?? resolveAdminCamPayload(event)?.teamId ?? event?.teamID ?? event?.teamId),
      };
      updatePlayerStatOnIgnoredEnd(ignoredSession, normalizeText(event?.eventId) || "");
      pushHistory({
        kind: "end-ignored",
        success: false,
        skipped: true,
        reason: "session_not_found",
        serverId: normalizeText(event?.serverId ?? core?.webStatus?.serverId ?? ""),
        eventId: normalizeText(event?.eventId) || "",
      });
      return;
    }

    const message = `${state.broadcastPrefix}本次飞天 ${session.durationText}`;
    pushHistory({
      kind: "end",
      success: true,
      serverId: session.serverId,
      player: {
        name: session.name,
        steamID: session.steamID,
        eosID: session.eosID,
        teamID: session.teamID,
      },
      eventId: session.endEventId,
      durationMs: session.durationMs,
      durationText: session.durationText,
      startedAt: session.startedAtISO,
      endedAt: session.endedAtISO,
      message,
    });

    if (!state.broadcastOnEnd) return;

    try {
      const result = await sendWarning(session, message, session.endEventId, "admin_camera_exit");
      if (result?.success === false) {
        state.lastError = String(result?.errorMessage ?? result?.message ?? "broadcast failed");
        pushHistory({
          kind: "end-broadcast",
          success: false,
          skipped: Boolean(result?.skipped),
          skipReason: result?.skipReason ?? "",
          serverId: session.serverId,
          player: { name: session.name, steamID: session.steamID, eosID: session.eosID },
          eventId: session.endEventId,
          durationText: session.durationText,
          errorMessage: state.lastError,
        });
        return;
      }

      state.lastError = "";
      pushHistory({
        kind: "end-broadcast",
        success: true,
        serverId: session.serverId,
        player: { name: session.name, steamID: session.steamID, eosID: session.eosID },
        eventId: session.endEventId,
        durationText: session.durationText,
        message,
      });
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      pushHistory({
        kind: "end-broadcast",
        success: false,
        serverId: session.serverId,
        player: { name: session.name, steamID: session.steamID, eosID: session.eosID },
        eventId: session.endEventId,
        durationText: session.durationText,
        errorMessage: state.lastError,
      });
      pluginLogger?.warn?.(`[AdminCameraDuration] exit broadcast failed: ${state.lastError}`);
    }
  }

  function getState() {
    const players = Array.from(playerStats.values())
      .map((stat) => ({ ...stat }))
      .sort((a, b) => {
        const byDuration = Number(b.totalDurationMs ?? 0) - Number(a.totalDurationMs ?? 0);
        if (byDuration !== 0) return byDuration;
        return String(a.name ?? "").localeCompare(String(b.name ?? ""));
      });

    return {
      enabled: state.enabled,
      subscribed: isSubscribed(),
      trackedCount: activeSessions.size,
      totalStartCount: state.totalStartCount,
      totalEndCount: state.totalEndCount,
      totalIgnoredEndCount: state.totalIgnoredEndCount,
      totalOverlapCount: state.totalOverlapCount,
      lastStartAt: state.lastStartAt,
      lastEndAt: state.lastEndAt,
      lastDurationMs: state.lastDurationMs,
      lastDurationText: state.lastDurationText,
      lastPlayerName: state.lastPlayerName,
      lastPlayerSteamID: state.lastPlayerSteamID,
      lastPlayerEosID: state.lastPlayerEosID,
      lastServerId: state.lastServerId,
      lastError: state.lastError,
      players,
      activeSessions: Array.from(activeSessions.values()).map((session) => ({
        serverId: session.serverId,
        name: session.name,
        steamID: session.steamID,
        eosID: session.eosID,
        teamID: session.teamID,
        startedAt: session.startedAtISO,
        startEventId: session.startEventId,
      })),
      recent: [...state.recent],
    };
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "管理员飞天时长统计",
      kind: "plugin",
      version: "1.0.0",
      category: "Debug",
      description: "监听管理员视角进出事件，进入时广播提示，退出时统计本次飞天时长并保留最近记录。",
    },
    apiName: "adminCameraDuration",
    api: {
      getState,
    },
    async start() {
      if (!state.enabled) {
        pluginLogger?.info?.("[AdminCameraDuration] plugin disabled by config.");
        return;
      }

      if (typeof core?.eventBus?.onCoreEvent !== "function") {
        pluginLogger?.warn?.("[AdminCameraDuration] eventBus.onCoreEvent unavailable.");
        return;
      }

      for (const eventName of SUBSCRIPTIONS) {
        unsubscribers.push(
          core.eventBus.onCoreEvent(eventName, (event) => {
            if (eventName === "POSSESSED_ADMIN_CAM") {
              void handlePossess(event);
              return;
            }
            void handleUnpossess(event);
          }),
        );
      }

      pluginLogger?.info?.("[AdminCameraDuration] subscriptions ready.");
    },
    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe?.();
        } catch {}
      }
      activeSessions.clear();
      playerStats.clear();
      pluginLogger?.info?.("[AdminCameraDuration] stopped.");
    },
  };
}

export default createPlugin;
