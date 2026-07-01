// -*- coding: utf-8 -*-

const PLUGIN_ID = "plugin.periodic-teamwork-warning";
const PLUGIN_CONFIG_KEY = "periodic-teamwork-warning";

const DEFAULT_MIN_INTERVAL_MINUTES = 10;
const DEFAULT_MAX_INTERVAL_MINUTES = 15;
const DEFAULT_MESSAGE = "听从队长指挥是战术小队的核心，团队合作才能带来最终的共赢。";

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

  const state = {
    dispatchCount: 0,
    failedCount: 0,
    lastDispatchAt: "",
    lastError: "",
    nextDispatchAt: "",
    nextDelayMs: 0,
  };

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false
      && core?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false;
  }

  function isActive() {
    return Boolean(runtimeConfig.enabled) && isSubscribed();
  }

  function clearSchedule() {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    state.nextDispatchAt = "";
    state.nextDelayMs = 0;
  }

  function getBroadcaster() {
    return modules?.adminWarn?.sendAdminBroadcast ?? modules?.adminWarn?.broadcastMessage ?? null;
  }

  function scheduleNext(reason = "interval") {
    clearSchedule();
    if (!isActive()) return;

    const delayMs = randomBetween(
      runtimeConfig.minIntervalMinutes * 60_000,
      runtimeConfig.maxIntervalMinutes * 60_000,
    );

    state.nextDelayMs = delayMs;
    state.nextDispatchAt = new Date(Date.now() + delayMs).toISOString();

    timer = setTimeout(() => {
      timer = null;
      void dispatchOnce(reason);
    }, delayMs);
  }

  async function dispatchOnce(reason = "interval") {
    if (!isActive()) {
      clearSchedule();
      return;
    }

    const broadcaster = getBroadcaster();
    if (typeof broadcaster !== "function") {
      state.failedCount += 1;
      state.lastError = "adminWarn broadcast API unavailable";
      pluginLogger?.warn?.("[PeriodicTeamworkWarning] adminWarn broadcast API unavailable.");
      scheduleNext("retry");
      return;
    }

    try {
      const result = await broadcaster({
        message: runtimeConfig.message,
        sourceModule: PLUGIN_ID,
        reason: `periodic_teamwork_warning_${reason}`,
        relatedEventId: `periodic_teamwork_warning_${Date.now()}`,
        system: true,
      });

      if (result?.success) {
        state.dispatchCount += 1;
        state.lastDispatchAt = new Date().toISOString();
        state.lastError = "";
      } else {
        state.failedCount += 1;
        state.lastError = String(result?.errorMessage ?? result?.skipReason ?? "broadcast_failed");
        pluginLogger?.warn?.(`[PeriodicTeamworkWarning] broadcast failed: ${state.lastError}`);
      }
    } catch (error) {
      state.failedCount += 1;
      state.lastError = error instanceof Error ? error.message : String(error ?? "broadcast_failed");
      pluginLogger?.warn?.(`[PeriodicTeamworkWarning] broadcast exception: ${state.lastError}`);
    }

    scheduleNext("interval");
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "Periodic Teamwork Warning",
      kind: "plugin",
      version: "1.0.0",
      description: "Broadcast teamwork reminder to all players at random intervals.",
    },

    apiName: "periodicTeamworkWarning",

    api: {
      getState() {
        return {
          ...state,
          config: {
            ...runtimeConfig,
          },
          enabled: runtimeConfig.enabled,
          subscribed: isSubscribed(),
          active: isActive(),
          timerActive: Boolean(timer),
        };
      },

      async runNow() {
        await dispatchOnce("manual");
        return this.getState();
      },

      reloadConfig() {
        runtimeConfig = readRuntimeConfig(config);
        scheduleNext("reload");
        return this.getState();
      },
    },

    async start() {
      runtimeConfig = readRuntimeConfig(config);
      if (!isActive()) {
        pluginLogger?.info?.("[PeriodicTeamworkWarning] plugin disabled or unsubscribed.");
        return;
      }
      scheduleNext("startup");
      pluginLogger?.info?.(
        `[PeriodicTeamworkWarning] started. interval=${runtimeConfig.minIntervalMinutes}-${runtimeConfig.maxIntervalMinutes} minutes.`,
      );
    },

    async stop() {
      clearSchedule();
      pluginLogger?.info?.("[PeriodicTeamworkWarning] stopped.");
    },
  };
}

function readRuntimeConfig(config) {
  const pluginConfig =
    config?.get?.(`plugins.${PLUGIN_CONFIG_KEY}`, null)
    ?? config?.get?.(`plugins.${PLUGIN_ID}`, null)
    ?? config?.get?.(`plugins.plugin.${PLUGIN_CONFIG_KEY}`, null)
    ?? {};

  const message = String(pluginConfig.message ?? DEFAULT_MESSAGE).trim() || DEFAULT_MESSAGE;
  let minIntervalMinutes = toFiniteNumber(pluginConfig.minIntervalMinutes, DEFAULT_MIN_INTERVAL_MINUTES);
  let maxIntervalMinutes = toFiniteNumber(pluginConfig.maxIntervalMinutes, DEFAULT_MAX_INTERVAL_MINUTES);

  minIntervalMinutes = clamp(minIntervalMinutes, 1, 24 * 60);
  maxIntervalMinutes = clamp(maxIntervalMinutes, 1, 24 * 60);

  if (maxIntervalMinutes < minIntervalMinutes) {
    const temp = maxIntervalMinutes;
    maxIntervalMinutes = minIntervalMinutes;
    minIntervalMinutes = temp;
  }

  return {
    enabled: pluginConfig.enabled !== false,
    minIntervalMinutes,
    maxIntervalMinutes,
    message,
  };
}

function randomBetween(min, max) {
  const lower = Math.floor(Math.min(min, max));
  const upper = Math.floor(Math.max(min, max));
  if (upper <= lower) return lower;
  return Math.floor(Math.random() * (upper - lower + 1)) + lower;
}

function toFiniteNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}