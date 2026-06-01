// -*- coding: utf-8 -*-

const PLUGIN_ID = "welcome-join-warning";
const PAGE_ROUTE = "/debug/welcome-join-warning";
const DEFAULT_DELAY_MS = 15_000;
const DEFAULT_MESSAGE = "欢迎来到 步战鼠鼠";
const DEFAULT_HISTORY_LIMIT = 100;
const JOIN_EVENT_NAMES = ["On_PlayerJoined", "PLAYER_JOINED", "On_PlayerConnected", "PLAYER_CONNECTED"];
const RAW_LOG_JOIN_EVENT_NAME = "On_RawLogLine";

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

  const runtimeConfig = readRuntimeConfig(config);
  const unsubscribers = [];
  const pendingTimers = new Map();
  let serial = Promise.resolve();

  const state = {
    enabled: runtimeConfig.enabled,
    delayMs: runtimeConfig.delayMs,
    message: runtimeConfig.message,
    historyLimit: runtimeConfig.historyLimit,
    joinEventCount: 0,
    scheduledCount: 0,
    warnSuccessCount: 0,
    warnFailedCount: 0,
    lastJoinAt: "",
    lastWarnAt: "",
    lastError: "",
    history: [],
    recentEvents: [],
    recentEventLimit: 50,
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

  function resolveWarnApi() {
    return modules?.adminWarn?.warnPlayer ?? modules?.adminWarn?.sendAdminWarn ?? null;
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

  function recordRecentEvent(event = {}) {
    const playerName = resolvePlayerName(event);
    state.recentEvents.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at: new Date().toISOString(),
      eventName: String(event?.eventName ?? "").trim(),
      eventId: String(event?.eventId ?? "").trim(),
      serverId: String(event?.serverId ?? "").trim(),
      playerName,
      hasPayload: Boolean(event?.payload),
      hasParams: Array.isArray(event?.params) && event.params.length > 0,
      hasParamMap: Boolean(event?.paramMap),
    });

    if (state.recentEvents.length > state.recentEventLimit) {
      state.recentEvents.splice(0, state.recentEvents.length - state.recentEventLimit);
    }
  }

  function resolvePlayerName(event = {}) {
    const payload = event?.payload ?? {};
    const fromPayload = String(payload?.name ?? payload?.playerName ?? "").trim();
    if (fromPayload) return fromPayload;

    const fromParamMap = String(event?.paramMap?.PlayerName ?? "").trim();
    if (fromParamMap) return fromParamMap;

    const params = Array.isArray(event?.params) ? event.params : [];
    for (const param of params) {
      if (param?.name !== "PlayerName") continue;
      const value = String(param?.value ?? "").trim();
      if (value) return value;
    }

    const fromRawLog = parseJoinSucceededNameFromRawLog(event);
    if (fromRawLog) return fromRawLog;

    return "";
  }

  function parseJoinSucceededNameFromRawLog(event = {}) {
    const raw = String(event?.rawLog ?? event?.rawEvent?.Raw ?? "").trim();
    if (!raw) return "";

    const match = raw.match(/\bLogNet:\s*Join succeeded:\s*(.+?)\s*(?:\|\s*\[raw_log_line\]\s*)?$/i);
    if (!match) return "";

    const candidate = String(match[1] ?? "").replace(/\s*\|\s*.*$/, "").trim();
    return candidate;
  }

  function buildJoinEventFromRawLog(event = {}) {
    if (String(event?.eventName ?? "").trim() !== RAW_LOG_JOIN_EVENT_NAME) {
      return null;
    }

    const playerName = parseJoinSucceededNameFromRawLog(event);
    if (!playerName) return null;

    return {
      eventId: String(event?.eventId ?? `raw-join:${Date.now()}`),
      eventName: RAW_LOG_JOIN_EVENT_NAME,
      serverId: String(event?.serverId ?? "").trim(),
      time: String(event?.time ?? new Date().toISOString()),
      rawLog: String(event?.rawLog ?? event?.rawEvent?.Raw ?? ""),
      payload: {
        name: playerName,
        playerName,
      },
      paramMap: {
        ...(event?.paramMap ?? {}),
        PlayerName: playerName,
      },
      params: Array.isArray(event?.params) ? event.params : [],
      sourceRawEventName: String(event?.eventName ?? ""),
    };
  }

  function buildTimerKey(event = {}, playerName = "") {
    const eventId = String(event?.eventId ?? "").trim();
    if (eventId) return eventId;

    const serverId = String(event?.serverId ?? "").trim();
    const time = String(event?.time ?? Date.now());
    return `${serverId}:${playerName}:${time}`;
  }

  function clearAllPendingTimers() {
    for (const timer of pendingTimers.values()) {
      clearTimeout(timer);
    }
    pendingTimers.clear();
  }

  function getState() {
    return {
      enabled: state.enabled,
      subscribed: isPluginSubscribed(),
      delayMs: state.delayMs,
      message: state.message,
      pendingCount: pendingTimers.size,
      joinEventCount: state.joinEventCount,
      scheduledCount: state.scheduledCount,
      warnSuccessCount: state.warnSuccessCount,
      warnFailedCount: state.warnFailedCount,
      lastJoinAt: state.lastJoinAt,
      lastWarnAt: state.lastWarnAt,
      lastError: state.lastError,
      history: [...state.history].reverse(),
      recentEvents: [...state.recentEvents].reverse(),
    };
  }

  async function handleJoinEvent(event = {}) {
    recordRecentEvent(event);

    const playerName = resolvePlayerName(event);
    const eventSummary = {
      eventId: String(event?.eventId ?? "").trim(),
      eventName: String(event?.eventName ?? "").trim(),
      serverId: String(event?.serverId ?? "").trim(),
      playerName,
      time: String(event?.time ?? "").trim(),
    };

    state.joinEventCount += 1;
    state.lastJoinAt = new Date().toISOString();

    if (!isActive()) {
      recordHistory({
        kind: "join",
        success: false,
        skipped: true,
        reason: !state.enabled ? "plugin_disabled" : "plugin_unsubscribed",
        event: eventSummary,
      });
      return;
    }

    if (!playerName) {
      state.lastError = "player_name_missing";
      recordHistory({
        kind: "join",
        success: false,
        skipped: true,
        reason: "player_name_missing",
        event: eventSummary,
      });
      pluginLogger?.warn?.("[WelcomeJoinWarning] player name missing on join event, welcome warn skipped.");
      return;
    }

    const warnApi = resolveWarnApi();
    if (typeof warnApi !== "function") {
      state.lastError = "admin_warn_api_unavailable";
      recordHistory({
        kind: "join",
        success: false,
        skipped: true,
        reason: "admin_warn_api_unavailable",
        event: eventSummary,
      });
      pluginLogger?.warn?.("[WelcomeJoinWarning] adminWarn API unavailable, welcome warn skipped.");
      return;
    }

    const key = buildTimerKey(event, playerName);
    if (pendingTimers.has(key)) {
      recordHistory({
        kind: "join",
        success: false,
        skipped: true,
        reason: "duplicate_event",
        event: eventSummary,
      });
      return;
    }

    state.scheduledCount += 1;
    state.lastError = "";
    recordHistory({
      kind: "join",
      success: true,
      skipped: false,
      reason: "scheduled",
      event: eventSummary,
      delayMs: state.delayMs,
      message: state.message,
    });

    const timer = setTimeout(async () => {
      pendingTimers.delete(key);

      if (!isActive()) {
        recordHistory({
          kind: "warn",
          success: false,
          skipped: true,
          reason: !state.enabled ? "plugin_disabled" : "plugin_unsubscribed",
          event: eventSummary,
          delayMs: state.delayMs,
        });
        return;
      }

      try {
        const result = await warnApi({
          sourceModule: PLUGIN_ID,
          reason: "player_join_welcome",
          relatedEventId: event?.eventId,
          targetName: playerName,
          message: state.message,
          system: true,
        });

        state.lastWarnAt = new Date().toISOString();

        if (!result?.success) {
          state.warnFailedCount += 1;
          state.lastError = String(result?.errorMessage ?? result?.skipReason ?? "unknown");
          recordHistory({
            kind: "warn",
            success: false,
            skipped: Boolean(result?.skipped),
            reason: "warn_failed",
            event: eventSummary,
            delayMs: state.delayMs,
            message: state.message,
            result,
          });
          pluginLogger?.warn?.(
            `[WelcomeJoinWarning] failed for ${playerName}: ${String(result?.errorMessage ?? result?.skipReason ?? "unknown")}`,
          );
          return;
        }

        state.warnSuccessCount += 1;
        state.lastError = "";
        recordHistory({
          kind: "warn",
          success: true,
          skipped: false,
          reason: "warn_sent",
          event: eventSummary,
          delayMs: state.delayMs,
          message: state.message,
          result,
        });
      } catch (error) {
        state.warnFailedCount += 1;
        state.lastWarnAt = new Date().toISOString();
        state.lastError = error instanceof Error ? error.message : String(error);
        recordHistory({
          kind: "warn",
          success: false,
          skipped: false,
          reason: "warn_exception",
          event: eventSummary,
          delayMs: state.delayMs,
          message: state.message,
          errorMessage: state.lastError,
        });
        pluginLogger?.warn?.(
          `[WelcomeJoinWarning] failed for ${playerName}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }, state.delayMs);

    pendingTimers.set(key, timer);
  }

  const api = {
    getState,

    getHistory(limit = state.historyLimit) {
      const count = Math.max(1, Number(limit) || state.historyLimit);
      return [...state.history].slice(-count).reverse();
    },

    getRecentEvents(limit = state.recentEventLimit) {
      const count = Math.max(1, Number(limit) || state.recentEventLimit);
      return [...state.recentEvents].slice(-count).reverse();
    },

    async simulateJoin(payload = {}) {
      const playerName = String(payload?.playerName ?? payload?.name ?? "DebugPlayer").trim() || "DebugPlayer";
      return enqueue(() => handleJoinEvent({
        eventId: String(payload?.eventId ?? `manual:${Date.now()}`),
        eventName: "On_PlayerJoined",
        serverId: String(payload?.serverId ?? core?.webStatus?.serverId ?? ""),
        time: new Date().toISOString(),
        payload: {
          name: playerName,
          playerName,
        },
        paramMap: {
          PlayerName: playerName,
        },
      }));
    },

    clearHistory() {
      state.history = [];
      state.lastError = "";
      return getState();
    },

    clearRecentEvents() {
      state.recentEvents = [];
      return getState();
    },
  };

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "玩家入服欢迎警告",
      kind: "plugin",
      version: "1.0.0",
      description: "玩家加入服务器后延迟发送欢迎警告消息。",
    },
    apiName: "welcomeJoinWarning",
    api,

    async start() {
      const freshConfig = readRuntimeConfig(config);
      state.enabled = freshConfig.enabled;
      state.delayMs = freshConfig.delayMs;
      state.message = freshConfig.message;
      state.historyLimit = freshConfig.historyLimit;

      core?.webRegistry?.registerPage?.({
        id: "web.welcomeJoinWarning.debug",
        title: "入服欢迎警告",
        group: "调试",
        route: PAGE_ROUTE,
        pageModule: "/pages/welcome-join-warning-debug.js",
        source: PLUGIN_ID,
        description: "跟踪玩家加入事件、15 秒延迟任务与警告发送结果。",
        required: false,
        enabled: true,
        order: 130,
        icon: "👋",
      });

      if (!state.enabled) {
        pluginLogger?.info?.("[WelcomeJoinWarning] plugin disabled by config.");
        return;
      }

      if (typeof core?.eventBus?.onCoreEvent !== "function") {
        pluginLogger?.warn?.("[WelcomeJoinWarning] eventBus.onCoreEvent unavailable.");
        return;
      }

      for (const eventName of JOIN_EVENT_NAMES) {
        unsubscribers.push(core.eventBus.onCoreEvent(eventName, (event) => {
          void enqueue(() => handleJoinEvent(event));
        }));
      }

      unsubscribers.push(core.eventBus.onCoreEvent(RAW_LOG_JOIN_EVENT_NAME, (event) => {
        const joinEvent = buildJoinEventFromRawLog(event);
        if (!joinEvent) return;
        void enqueue(() => handleJoinEvent(joinEvent));
      }));

      pluginLogger?.info?.(
        `[WelcomeJoinWarning] started. delayMs=${state.delayMs} message=${JSON.stringify(state.message)}`,
      );
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe();
        } catch {}
      }
      clearAllPendingTimers();
      pluginLogger?.info?.("[WelcomeJoinWarning] stopped.");
    },
  };
}

function readRuntimeConfig(config) {
  const cfg =
    config?.get?.("plugins.welcome-join-warning", null)
    ?? config?.get?.("plugins.welcomeJoinWarning", null)
    ?? {};

  const delayMs = Math.max(0, Number(cfg?.delayMs ?? DEFAULT_DELAY_MS) || DEFAULT_DELAY_MS);
  const message = String(cfg?.message ?? DEFAULT_MESSAGE).trim() || DEFAULT_MESSAGE;
  const historyLimit = Math.max(20, Number(cfg?.historyLimit ?? DEFAULT_HISTORY_LIMIT) || DEFAULT_HISTORY_LIMIT);

  return {
    enabled: cfg?.enabled !== false,
    delayMs,
    message,
    historyLimit,
  };
}

export default { createPlugin };
