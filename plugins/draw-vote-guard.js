// -*- coding: utf-8 -*-

const PLUGIN_ID = "plugin.drawVoteGuard";
const PAGE_ROUTE = "/debug/draw-vote-guard";
const DEFAULT_DELAY_SECONDS = 25;
const DEFAULT_BROADCAST_MESSAGE = "投票阶段禁止带节奏。";
const DEFAULT_HISTORY_LIMIT = 100;

export function createPlugin({ core, modules, config, logger } = {}) {
  const pluginLogger =
    logger
    ?? core?.createLogger?.({
      moduleId: PLUGIN_ID,
      source: PLUGIN_ID,
      channel: "module",
    })
    ?? core?.logger
    ?? console;

  const runtimeConfig = readConfig(config);
  const unsubscribers = [];
  const timers = new Map();
  let serial = Promise.resolve();

  const state = {
    enabled: runtimeConfig.enabled,
    delaySeconds: runtimeConfig.delaySeconds,
    broadcastMessage: runtimeConfig.broadcastMessage,
    historyLimit: runtimeConfig.historyLimit,
    pendingCount: 0,
    triggerCount: 0,
    broadcastCount: 0,
    lastTriggerAt: "",
    lastBroadcastAt: "",
    lastError: "",
    history: [],
  };

  function enqueue(task) {
    const next = Promise.resolve().then(task);
    serial = next.catch(() => {});
    return next;
  }

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false
      && core?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false;
  }

  function isActive() {
    return Boolean(state.enabled) && isSubscribed();
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

  function updatePendingCount() {
    state.pendingCount = timers.size;
  }

  function getEventSummary(event = {}) {
    return {
      eventId: String(event?.eventId ?? "").trim(),
      eventName: String(event?.eventName ?? "").trim(),
      winner: extractWinnerText(event),
      mapName: extractMapName(event),
      logTime: String(event?.logTime ?? "").trim(),
      rawLog: String(event?.rawLog ?? "").trim(),
    };
  }

  function buildEventKey(event = {}) {
    const eventId = String(event?.eventId ?? "").trim();
    if (eventId) return eventId;

    const serverId = String(event?.serverId ?? "").trim();
    const logTime = String(event?.logTime ?? "").trim();
    const rawLog = String(event?.rawLog ?? "").trim();
    const mapName = extractMapName(event);
    const winner = extractWinnerText(event);

    return [serverId, logTime, mapName, winner, rawLog].join("|");
  }

  function scheduleDrawBroadcast(event, options = {}) {
    const reason = String(options.reason ?? "draw_match_winner").trim() || "draw_match_winner";
    const applyDelay = options.applyDelay !== false;
    const summary = getEventSummary(event);

    if (!isDrawMatchWinnerEvent(event)) {
      recordHistory({
        kind: "ignored",
        success: false,
        skipped: true,
        reason: "not_draw",
        event: summary,
      });
      return {
        queued: false,
        skipped: true,
        reason: "not_draw",
      };
    }

    if (!isActive()) {
      recordHistory({
        kind: "trigger",
        success: false,
        skipped: true,
        reason: !state.enabled ? "plugin_disabled" : "plugin_unsubscribed",
        event: summary,
      });
      return {
        queued: false,
        skipped: true,
        reason: !state.enabled ? "plugin_disabled" : "plugin_unsubscribed",
      };
    }

    const eventKey = String(options.eventKey ?? buildEventKey(event)).trim();
    if (!eventKey) {
      recordHistory({
        kind: "trigger",
        success: false,
        skipped: true,
        reason: "missing_event_key",
        event: summary,
      });
      return {
        queued: false,
        skipped: true,
        reason: "missing_event_key",
      };
    }

    if (timers.has(eventKey)) {
      recordHistory({
        kind: "trigger",
        success: false,
        skipped: true,
        reason: "duplicate_event",
        event: summary,
      });
      return {
        queued: false,
        skipped: true,
        reason: "duplicate_event",
      };
    }

    state.triggerCount += 1;
    state.lastTriggerAt = new Date().toISOString();
    state.lastError = "";

    const delayMs = applyDelay ? Math.max(0, Math.floor(state.delaySeconds * 1000)) : 0;
    recordHistory({
      kind: "trigger",
      success: true,
      skipped: false,
      reason,
      delayMs,
      event: summary,
      message: state.broadcastMessage,
    });

    const timer = setTimeout(() => {
      timers.delete(eventKey);
      updatePendingCount();
      void enqueue(async () => {
        await dispatchBroadcast({
          reason,
          eventSummary: summary,
          eventKey,
          delayMs,
        });
      });
    }, delayMs);

    timers.set(eventKey, timer);
    updatePendingCount();

    return {
      queued: true,
      skipped: false,
      reason,
      delayMs,
      pendingCount: state.pendingCount,
      eventKey,
    };
  }

  async function dispatchBroadcast({ reason, eventSummary, eventKey, delayMs }) {
    const broadcaster = modules?.adminWarn?.sendAdminBroadcast ?? modules?.adminWarn?.broadcastMessage;
    if (typeof broadcaster !== "function") {
      state.lastError = "adminWarn broadcast API unavailable";
      recordHistory({
        kind: "broadcast",
        success: false,
        skipped: true,
        reason: "broadcast_module_unavailable",
        event: eventSummary,
        eventKey,
        delayMs,
        message: state.broadcastMessage,
      });
      return {
        success: false,
        skipped: true,
        skipReason: "broadcast_module_unavailable",
      };
    }

    try {
      const result = await broadcaster({
        message: state.broadcastMessage,
        sourceModule: PLUGIN_ID,
        reason,
        relatedEventId: eventSummary?.eventId || eventKey,
      });

      const success = Boolean(result?.success);
      state.lastBroadcastAt = new Date().toISOString();
      state.broadcastCount += success ? 1 : 0;
      state.lastError = success ? "" : String(result?.errorMessage ?? result?.skipReason ?? "broadcast_failed");

      recordHistory({
        kind: "broadcast",
        success,
        skipped: Boolean(result?.skipped),
        reason,
        event: eventSummary,
        eventKey,
        delayMs,
        message: state.broadcastMessage,
        result,
      });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "broadcast_failed");
      state.lastError = message;
      recordHistory({
        kind: "broadcast",
        success: false,
        skipped: false,
        reason,
        event: eventSummary,
        eventKey,
        delayMs,
        message: state.broadcastMessage,
        errorMessage: message,
      });
      pluginLogger?.warn?.(`[DrawVoteGuard] broadcast failed: ${message}`);
      return {
        success: false,
        skipped: false,
        errorMessage: message,
      };
    }
  }

  function handleRoundMatchWinner(event) {
    return enqueue(() => scheduleDrawBroadcast(event, {
      reason: "draw_match_winner",
      applyDelay: true,
    }));
  }

  function getState() {
    return {
      enabled: state.enabled,
      subscribed: isSubscribed(),
      delaySeconds: state.delaySeconds,
      broadcastMessage: state.broadcastMessage,
      pendingCount: state.pendingCount,
      triggerCount: state.triggerCount,
      broadcastCount: state.broadcastCount,
      lastTriggerAt: state.lastTriggerAt,
      lastBroadcastAt: state.lastBroadcastAt,
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

    async simulateTrigger(payload = {}) {
      const event = {
        eventId: String(payload?.eventId ?? `manual:${Date.now()}`),
        eventName: "round.match_winner",
        winner: String(payload?.winner ?? "draw"),
        mapName: String(payload?.mapName ?? "UnknownMap"),
        rawLog: String(
          payload?.rawLog
            ?? "[manual] LogSquadTrace: [DedicatedServer]DetermineMatchWinner(): The game was a draw",
        ),
        logTime: new Date().toISOString(),
      };

      return enqueue(() => scheduleDrawBroadcast(event, {
        reason: "manual_debug",
        applyDelay: payload?.applyDelay === true,
        eventKey: `manual:${Date.now()}:${Math.random().toString(16).slice(2)}`,
      }));
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
      name: "平局投票阶段提示",
      kind: "plugin",
      version: "1.0.0",
      description: "监听 round.match_winner 平局事件，延迟 25 秒后自动全服广播投票阶段提示。",
      category: "Moderation",
      configSchema: [
        {
          key: "enabled",
          label: "是否启用",
          type: "boolean",
          defaultValue: true,
        },
        {
          key: "delaySeconds",
          label: "广播延迟秒数",
          type: "number",
          defaultValue: DEFAULT_DELAY_SECONDS,
        },
        {
          key: "broadcastMessage",
          label: "广播内容",
          type: "string",
          defaultValue: DEFAULT_BROADCAST_MESSAGE,
        },
      ],
    },
    apiName: "drawVoteGuard",
    api,

    async start() {
      const freshConfig = readConfig(config);
      state.enabled = freshConfig.enabled;
      state.delaySeconds = freshConfig.delaySeconds;
      state.broadcastMessage = freshConfig.broadcastMessage;
      state.historyLimit = freshConfig.historyLimit;

      core?.webRegistry?.registerPage?.({
        id: "web.drawVoteGuard.debug",
        title: "平局投票阶段提示",
        group: "调试",
        route: PAGE_ROUTE,
        pageModule: "/pages/draw-vote-guard-debug.js",
        source: PLUGIN_ID,
        description: "跟踪 round.match_winner 平局触发、延迟广播和发送结果。",
        required: false,
        enabled: true,
        order: 129,
        icon: "🗳️",
      });

      if (typeof core?.eventBus?.onCoreEvent === "function") {
        unsubscribers.push(core.eventBus.onCoreEvent("round.match_winner", handleRoundMatchWinner));
      }

      pluginLogger?.info?.("[DrawVoteGuard] plugin started");
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe();
        } catch {}
      }

      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      updatePendingCount();

      pluginLogger?.info?.("[DrawVoteGuard] plugin stopped");
    },
  };
}

function readConfig(config) {
  const pluginConfig = config?.get?.("plugins.drawVoteGuard", {}) ?? {};

  return {
    enabled: pluginConfig.enabled !== false,
    delaySeconds: clampNumber(pluginConfig.delaySeconds, DEFAULT_DELAY_SECONDS, 0, 3600),
    broadcastMessage: sanitizeMessage(pluginConfig.broadcastMessage ?? DEFAULT_BROADCAST_MESSAGE),
    historyLimit: clampNumber(pluginConfig.historyLimit, DEFAULT_HISTORY_LIMIT, 20, 500),
  };
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function sanitizeMessage(value) {
  const text = String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/"/g, "'")
    .trim();
  if (!text) return DEFAULT_BROADCAST_MESSAGE;
  return text.slice(0, 180);
}

function extractWinnerText(event = {}) {
  return String(
    event?.winner
      ?? event?.normalized?.roundMatchWinner?.winner
      ?? event?.paramMap?.winner
      ?? "",
  ).trim();
}

function extractMapName(event = {}) {
  return String(
    event?.mapName
      ?? event?.normalized?.roundMatchWinner?.mapName
      ?? event?.paramMap?.mapName
      ?? "",
  ).trim();
}

function isDrawMatchWinnerEvent(event = {}) {
  const eventName = String(event?.eventName ?? "").trim();
  if (eventName !== "round.match_winner") return false;

  const winner = extractWinnerText(event).toLowerCase();
  if (winner.includes("draw") || winner.includes("平局")) return true;

  const rawLog = String(event?.rawLog ?? "").toLowerCase();
  if (rawLog.includes("determinematchwinner") && rawLog.includes("the game was a draw")) return true;

  return false;
}

export default { createPlugin };
