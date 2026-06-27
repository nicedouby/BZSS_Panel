// -*- coding: utf-8 -*-

const PLUGIN_ID = "plugin.kxrDoubleSwitch";
const TRIGGER_TEXT = "kxr";
const DEFAULT_HISTORY_LIMIT = 50;

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
  const handledEventIds = new Set();
  let serial = Promise.resolve();
  const state = {
    enabled: runtimeConfig.enabled,
    historyLimit: runtimeConfig.historyLimit,
    triggerCount: 0,
    successCount: 0,
    lastTriggerAt: "",
    lastError: "",
    history: [],
  };

  function enqueue(task) {
    const next = serial.then(() => task(), () => task());
    serial = next.catch(() => {});
    return next;
  }

  function normalizeText(value) {
    return String(value ?? "").trim();
  }

  function normalizeSteamId(value) {
    return normalizeText(value);
  }

  function normalizeMessage(value) {
    return normalizeText(value).toLowerCase();
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

  function isHandled(event = {}) {
    const key = normalizeText(event?.id ?? event?.seq ?? event?.timestamp ?? event?.time);
    if (!key) return false;
    if (handledEventIds.has(key)) return true;
    handledEventIds.add(key);
    if (handledEventIds.size > 200) handledEventIds.clear();
    return false;
  }

  async function executeDoubleSwitch(event = {}) {
    const teamBalance = modules?.teamBalance;
    if (typeof teamBalance?.forceTeamChange !== "function") {
      const result = {
        ok: false,
        error: "TeamBalanceUnavailable",
        message: "teamBalance.forceTeamChange is unavailable.",
      };
      state.lastError = result.message;
      recordHistory({
        kind: "switch",
        ok: false,
        error: result.error,
        message: result.message,
        playerName: normalizeText(event?.playerName ?? event?.name),
        steamId: normalizeSteamId(event?.steamId ?? event?.steamID ?? event?.steamid),
      });
      return result;
    }

    const steamId = normalizeSteamId(event?.steamId ?? event?.steamID ?? event?.steamid);
    const playerName = normalizeText(event?.playerName ?? event?.name);
    if (!steamId) {
      const result = {
        ok: false,
        error: "MissingSteamId",
        message: "Chat event is missing steamId.",
      };
      state.lastError = result.message;
      recordHistory({
        kind: "switch",
        ok: false,
        error: result.error,
        message: result.message,
        playerName,
        steamId,
      });
      return result;
    }

    const operator = {
      id: PLUGIN_ID,
      name: "KXR Double Switch",
      username: "KXR Double Switch",
      role: "system",
      isSuperAdmin: true,
      permissions: ["*"],
    };

    const first = await teamBalance.forceTeamChange({
      steamId,
      playerName,
      source: `${PLUGIN_ID}.chat`,
      reason: "kxr_double_switch_1",
      operator,
      system: true,
    });

    if (!first?.ok) {
      const result = {
        ok: false,
        error: normalizeText(first?.error) || "FirstSwitchFailed",
        message: normalizeText(first?.message) || "First team switch failed.",
        first,
        second: null,
      };
      state.lastError = result.message;
      recordHistory({
        kind: "switch",
        ok: false,
        error: result.error,
        message: result.message,
        playerName,
        steamId,
        first,
      });
      return result;
    }

    const second = await teamBalance.forceTeamChange({
      steamId,
      playerName,
      source: `${PLUGIN_ID}.chat`,
      reason: "kxr_double_switch_2",
      operator,
      system: true,
    });

    const result = {
      ok: Boolean(second?.ok),
      error: second?.ok ? "" : (normalizeText(second?.error) || "SecondSwitchFailed"),
      message: second?.ok
        ? "Double team switch requested."
        : (normalizeText(second?.message) || "Second team switch failed."),
      first,
      second,
    };

    if (result.ok) {
      state.successCount += 1;
      state.lastError = "";
    } else {
      state.lastError = result.message;
    }

    recordHistory({
      kind: "switch",
      ok: result.ok,
      error: result.error,
      message: result.message,
      playerName,
      steamId,
      first,
      second,
    });

    return result;
  }

  function handleChatMessage(event = {}) {
    return enqueue(async () => {
      if (!state.enabled) {
        return { matched: false, skipped: true, reason: "plugin_disabled" };
      }
      if (isHandled(event)) {
        return { matched: false, deduped: true };
      }

      const message = normalizeText(event?.message);
      if (normalizeMessage(message) !== TRIGGER_TEXT) {
        return { matched: false };
      }

      state.triggerCount += 1;
      state.lastTriggerAt = new Date().toISOString();
      state.lastError = "";

      recordHistory({
        kind: "trigger",
        matched: true,
        message,
        playerName: normalizeText(event?.playerName ?? event?.name),
        steamId: normalizeSteamId(event?.steamId ?? event?.steamID ?? event?.steamid),
      });

      const result = await executeDoubleSwitch(event);
      return {
        matched: true,
        trigger: TRIGGER_TEXT,
        result,
      };
    });
  }

  function getState() {
    return {
      enabled: state.enabled,
      triggerText: TRIGGER_TEXT,
      triggerCount: state.triggerCount,
      successCount: state.successCount,
      lastTriggerAt: state.lastTriggerAt,
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

    async simulateChatMessage(payload = {}) {
      return handleChatMessage({
        ...payload,
        message: String(payload?.message ?? ""),
      });
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
      name: "KXR Double Switch",
      kind: "plugin",
      version: "1.0.0",
      description: "When a player sends 'kxr' in public chat, execute two team switches for that player through TeamBalance.",
      category: "Moderation",
    },
    apiName: "kxrDoubleSwitch",
    api,

    async start() {
      state.enabled = runtimeConfig.enabled;
      state.historyLimit = runtimeConfig.historyLimit;

      if (typeof modules?.chatManager?.on === "function") {
        unsubscribers.push(modules.chatManager.on("message", handleChatMessage));
      } else if (typeof core?.eventBus?.onModuleEvent === "function") {
        unsubscribers.push(core.eventBus.onModuleEvent("module.chatManager", "CHAT_RECEIVED", handleChatMessage));
      }

      pluginLogger?.info?.("[KXR] plugin started");
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe();
        } catch {}
      }

      pluginLogger?.info?.("[KXR] plugin stopped");
    },
  };
}

function readConfig(config) {
  const pluginConfig = config?.get?.("plugins.kxrDoubleSwitch", {}) ?? {};
  return {
    enabled: pluginConfig.enabled !== false,
    historyLimit: Math.max(1, Number(pluginConfig.historyLimit ?? DEFAULT_HISTORY_LIMIT) || DEFAULT_HISTORY_LIMIT),
  };
}
