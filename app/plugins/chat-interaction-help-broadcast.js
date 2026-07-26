// -*- coding: utf-8 -*-

const PLUGIN_ID = "plugin.chat-interaction-help-broadcast";
const CONFIG_KEY = "chat-interaction-help-broadcast";

const DEFAULT_MIN_INTERVAL_SECONDS = 300;
const DEFAULT_MAX_INTERVAL_SECONDS = 600;
const DEFAULT_HISTORY_LIMIT = 30;

export const DEFAULT_MESSAGES = Object.freeze([
  "本服目前启用的聊天互动功能有：",
  "ZSBD -- 战术报点：输入“ZSBD 进攻D点”，即可向当前阵营所有玩家发送“进攻D点”窗口警告。",
  "小队时长、阵营时长、平均时长 -- 可查询玩家的时长信息。",
  "tb -- 跳边：玩家可在指定时间区间内，在不破坏平衡的情况下完成跳边。",
  "sqtb -- 申请跳边：需要另一方玩家输入“认领+5位ID”进行认领；额度充足且不破坏平衡时才能完成跳边。",
]);

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

  let runtimeConfig = readRuntimeConfig(config);
  let timer = null;
  let running = false;
  const unsubscribers = [];

  const state = {
    cycleCount: 0,
    lineBroadcastCount: 0,
    failedLineCount: 0,
    lastCycleStartedAt: "",
    lastCycleCompletedAt: "",
    lastReason: "",
    lastError: "",
    nextBroadcastAt: "",
    nextDelaySeconds: 0,
    history: [],
  };

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false
      && core?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false;
  }

  function isActive() {
    return Boolean(runtimeConfig.enabled) && isSubscribed();
  }

  function clearSchedule() {
    if (timer) clearTimeout(timer);
    timer = null;
    state.nextBroadcastAt = "";
    state.nextDelaySeconds = 0;
  }

  function scheduleNext(reason = "interval") {
    clearSchedule();
    if (!isActive()) return;

    const delaySeconds = randomBetweenSeconds(
      runtimeConfig.minIntervalSeconds,
      runtimeConfig.maxIntervalSeconds,
    );

    state.nextDelaySeconds = delaySeconds;
    state.nextBroadcastAt = new Date(Date.now() + delaySeconds * 1000).toISOString();

    timer = setTimeout(() => {
      timer = null;
      void dispatchCycle(reason);
    }, delaySeconds * 1000);
    timer.unref?.();
  }

  function getBroadcaster() {
    return modules?.adminWarn?.sendAdminBroadcast
      ?? modules?.adminWarn?.broadcastMessage
      ?? null;
  }

  function pushHistory(entry = {}) {
    state.history.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at: new Date().toISOString(),
      ...entry,
    });

    if (state.history.length > runtimeConfig.historyLimit) {
      state.history.splice(0, state.history.length - runtimeConfig.historyLimit);
    }
  }

  async function dispatchCycle(reason = "interval") {
    if (running) {
      return { ok: false, skipped: true, reason: "cycle_running" };
    }

    clearSchedule();
    if (!isActive()) {
      return { ok: false, skipped: true, reason: "plugin_disabled_or_unsubscribed" };
    }

    const broadcaster = getBroadcaster();
    if (typeof broadcaster !== "function") {
      state.lastError = "adminWarn broadcast API unavailable";
      state.failedLineCount += runtimeConfig.messages.length;
      pushHistory({
        kind: "cycle",
        ok: false,
        reason,
        error: state.lastError,
        attemptedLineCount: runtimeConfig.messages.length,
      });
      pluginLogger?.warn?.("[ChatInteractionHelpBroadcast] adminWarn broadcast API unavailable.");
      scheduleNext("retry");
      return { ok: false, error: "BroadcastApiUnavailable", message: state.lastError };
    }

    running = true;
    const cycleId = `chat-interaction-help-${Date.now()}`;
    const startedAt = new Date().toISOString();
    const results = [];
    state.lastCycleStartedAt = startedAt;
    state.lastReason = reason;
    state.lastError = "";

    try {
      for (let index = 0; index < runtimeConfig.messages.length; index += 1) {
        const message = runtimeConfig.messages[index];
        try {
          const result = await broadcaster.call(modules.adminWarn, {
            message,
            reason: `chat_interaction_help_${reason}_line_${index + 1}`,
            sourceModule: PLUGIN_ID,
            relatedEventId: cycleId,
            system: true,
          });

          const success = Boolean(result?.success ?? result?.ok ?? false)
            && result?.skipped !== true;

          if (success) {
            state.lineBroadcastCount += 1;
          } else {
            state.failedLineCount += 1;
          }

          results.push({
            line: index + 1,
            message,
            success,
            result,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error ?? "broadcast_failed");
          state.failedLineCount += 1;
          state.lastError = errorMessage;
          results.push({
            line: index + 1,
            message,
            success: false,
            error: errorMessage,
          });
          pluginLogger?.warn?.(
            `[ChatInteractionHelpBroadcast] line ${index + 1} failed: ${errorMessage}`,
          );
        }
      }

      state.cycleCount += 1;
      state.lastCycleCompletedAt = new Date().toISOString();
      const failedCount = results.filter((item) => !item.success).length;
      if (!state.lastError && failedCount > 0) {
        state.lastError = `broadcast_failed_${failedCount}`;
      }

      pushHistory({
        kind: "cycle",
        ok: failedCount === 0,
        cycleId,
        reason,
        startedAt,
        completedAt: state.lastCycleCompletedAt,
        lineCount: results.length,
        failedCount,
        results,
      });

      return {
        ok: failedCount === 0,
        cycleId,
        lineCount: results.length,
        failedCount,
        results,
      };
    } finally {
      running = false;
      scheduleNext("interval");
    }
  }

  function getState() {
    return {
      ...state,
      history: [...state.history].reverse(),
      config: {
        ...runtimeConfig,
        messages: [...runtimeConfig.messages],
      },
      enabled: runtimeConfig.enabled,
      subscribed: isSubscribed(),
      active: isActive(),
      running,
      timerActive: Boolean(timer),
    };
  }

  function handleSubscriptionUpdate(event = {}) {
    const payload = event?.payload ?? event;
    const updatedId = normalizeText(payload?.id);
    if (!payload?.reset && updatedId && updatedId !== PLUGIN_ID) return;

    if (isActive()) scheduleNext("subscription_updated");
    else clearSchedule();
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "聊天互动功能定时广播",
      kind: "plugin",
      version: "1.0.0",
      category: "Information",
      description: "每隔随机 300 至 600 秒，逐行广播服务器当前启用的聊天互动功能说明。",
      configSchema: [
        {
          key: `plugins.${CONFIG_KEY}.enabled`,
          type: "boolean",
          default: true,
          description: "是否启用聊天互动功能定时广播",
        },
        {
          key: `plugins.${CONFIG_KEY}.minIntervalSeconds`,
          type: "number",
          default: DEFAULT_MIN_INTERVAL_SECONDS,
          description: "最短随机间隔秒数",
        },
        {
          key: `plugins.${CONFIG_KEY}.maxIntervalSeconds`,
          type: "number",
          default: DEFAULT_MAX_INTERVAL_SECONDS,
          description: "最长随机间隔秒数",
        },
      ],
    },

    apiName: "chatInteractionHelpBroadcast",

    api: {
      getState,

      async runNow() {
        return dispatchCycle("manual");
      },

      reloadConfig() {
        runtimeConfig = readRuntimeConfig(config);
        scheduleNext("reload");
        return getState();
      },
    },

    async start() {
      runtimeConfig = readRuntimeConfig(config);

      if (typeof core?.eventBus?.onCoreEvent === "function") {
        unsubscribers.push(
          core.eventBus.onCoreEvent("PLUGIN_SUBSCRIPTIONS_UPDATED", handleSubscriptionUpdate),
        );
      }

      if (isActive()) {
        scheduleNext("startup");
        pluginLogger?.info?.(
          `[ChatInteractionHelpBroadcast] started. interval=${runtimeConfig.minIntervalSeconds}-${runtimeConfig.maxIntervalSeconds}s lines=${runtimeConfig.messages.length}`,
        );
      } else {
        pluginLogger?.info?.("[ChatInteractionHelpBroadcast] plugin disabled or unsubscribed.");
      }
    },

    async stop() {
      clearSchedule();
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe?.();
        } catch {}
      }
      pluginLogger?.info?.("[ChatInteractionHelpBroadcast] stopped.");
    },
  };
}

function readRuntimeConfig(config) {
  const pluginConfig =
    config?.get?.(`plugins.${CONFIG_KEY}`, null)
    ?? config?.get?.(`plugins.${PLUGIN_ID}`, null)
    ?? config?.get?.(`plugins.plugin.${CONFIG_KEY}`, null)
    ?? {};

  let minIntervalSeconds = toInteger(
    pluginConfig.minIntervalSeconds,
    DEFAULT_MIN_INTERVAL_SECONDS,
  );
  let maxIntervalSeconds = toInteger(
    pluginConfig.maxIntervalSeconds,
    DEFAULT_MAX_INTERVAL_SECONDS,
  );

  minIntervalSeconds = clamp(minIntervalSeconds, 1, 24 * 60 * 60);
  maxIntervalSeconds = clamp(maxIntervalSeconds, 1, 24 * 60 * 60);

  if (maxIntervalSeconds < minIntervalSeconds) {
    [minIntervalSeconds, maxIntervalSeconds] = [maxIntervalSeconds, minIntervalSeconds];
  }

  return {
    enabled: pluginConfig.enabled !== false,
    minIntervalSeconds,
    maxIntervalSeconds,
    historyLimit: clamp(
      toInteger(pluginConfig.historyLimit, DEFAULT_HISTORY_LIMIT),
      1,
      500,
    ),
    messages: normalizeMessages(pluginConfig.messages),
  };
}

function normalizeMessages(value) {
  const source = Array.isArray(value) ? value : DEFAULT_MESSAGES;
  const messages = source
    .map((entry) => normalizeBroadcastLine(entry))
    .filter(Boolean);
  return messages.length ? messages : [...DEFAULT_MESSAGES];
}

function normalizeBroadcastLine(value) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function randomBetweenSeconds(min, max, random = Math.random) {
  const lower = Math.floor(Math.min(Number(min) || 0, Number(max) || 0));
  const upper = Math.floor(Math.max(Number(min) || 0, Number(max) || 0));
  if (upper <= lower) return lower;
  const value = Math.min(0.999999999, Math.max(0, Number(random()) || 0));
  return Math.floor(value * (upper - lower + 1)) + lower;
}

function toInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

export default { createPlugin };
