// -*- coding: utf-8 -*-

const PLUGIN_ID = "welcome-join-warning";
const PAGE_ROUTE = "/debug/welcome-join-warning";

const DEFAULT_INITIAL_DELAY_MS = 15_000;
const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_HISTORY_LIMIT = 100;
const DEFAULT_MAX_WARNINGS_PER_JOIN = 5;
const DEFAULT_MESSAGE = "欢迎来到 BZSS 服务器，请遵守服务器规则，祝你游戏愉快。";
const DEFAULT_NEWBIE_MESSAGE = "BZSS 是一个注重萌新体验的游戏社区。\n欢迎加入社区群，萌新可以在群内提问，也可以找人带入门，群号就在服务器名称中。";
const JOIN_EVENT_NAMES = ["On_PlayerJoined", "PLAYER_JOINED", "On_PlayerConnected", "PLAYER_CONNECTED", "PLAYER_POST_LOGIN"];
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
  const pendingEvents = new Map();
  const cooldowns = new Map();
  let serial = Promise.resolve();
  let taskSerial = 0;

  const state = {
    config: runtimeConfig,
    joinEventCount: 0,
    scheduledCount: 0,
    warnSuccessCount: 0,
    warnFailedCount: 0,
    matchedRuleCount: 0,
    suppressedCount: 0,
    lastJoinAt: "",
    lastWarnAt: "",
    lastError: "",
    history: [],
    recentEvents: [],
    recentEventLimit: 50,
  };

  function enqueue(task) {
    const next = serial.then(task, task);
    serial = next.catch(() => {});
    return next;
  }

  function isPluginSubscribed() {
    const isSubscribed = core?.pluginSubscriptions?.isSubscribed;
    if (typeof isSubscribed !== "function") return true;
    return isSubscribed(PLUGIN_ID);
  }

  function isActive() {
    return Boolean(state.config.enabled) && isPluginSubscribed();
  }

  function resolveWarnApi() {
    return modules?.adminWarn?.warnPlayer ?? modules?.adminWarn?.sendAdminWarn ?? null;
  }

  function recordHistory(entry) {
    state.history.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at: new Date().toISOString(),
      ...cloneJsonSafe(entry),
    });

    if (state.history.length > state.config.historyLimit) {
      state.history.splice(0, state.history.length - state.config.historyLimit);
    }
  }

  function recordRecentEvent(event = {}, context = null) {
    const playerName = context?.playerName ?? resolvePlayerName(event);
    state.recentEvents.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at: new Date().toISOString(),
      eventName: String(event?.eventName ?? "").trim(),
      eventId: String(event?.eventId ?? "").trim(),
      serverId: String(event?.serverId ?? "").trim(),
      playerName,
      steamID: context?.steamID ?? resolvePlayerSteamID(event),
      eosID: context?.eosID ?? getEventValue(event, ["eosID", "EOSID", "eosId"]),
      ip: context?.ip ?? getEventValue(event, ["ip", "IP", "PlayerIP"]),
      hasPayload: Boolean(event?.payload),
      hasParams: Array.isArray(event?.params) && event.params.length > 0,
      hasParamMap: Boolean(event?.paramMap),
    });

    if (state.recentEvents.length > state.recentEventLimit) {
      state.recentEvents.splice(0, state.recentEvents.length - state.recentEventLimit);
    }
  }

  function getState() {
    return {
      enabled: state.config.enabled,
      subscribed: isPluginSubscribed(),
      historyLimit: state.config.historyLimit,
      maxWarningsPerJoin: state.config.maxWarningsPerJoin,
      defaultIntervalMs: state.config.defaultIntervalMs,
      config: cloneJsonSafe(state.config),
      rules: cloneJsonSafe(state.config.rules),
      pendingCount: pendingTimers.size,
      pendingTasks: getPendingTasks(),
      joinEventCount: state.joinEventCount,
      scheduledCount: state.scheduledCount,
      warnSuccessCount: state.warnSuccessCount,
      warnFailedCount: state.warnFailedCount,
      matchedRuleCount: state.matchedRuleCount,
      suppressedCount: state.suppressedCount,
      lastJoinAt: state.lastJoinAt,
      lastWarnAt: state.lastWarnAt,
      lastError: state.lastError,
      history: [...state.history].reverse(),
      recentEvents: [...state.recentEvents].reverse(),
    };
  }

  function getPendingTasks() {
    return [...pendingTimers.values()]
      .map((entry) => ({
        id: entry.id,
        eventKey: entry.eventKey,
        playerName: entry.playerName,
        ruleId: entry.ruleId,
        ruleName: entry.ruleName,
        stepIndex: entry.stepIndex,
        delayMs: entry.delayMs,
        scheduledAt: entry.scheduledAt,
        dueAt: entry.dueAt,
      }))
      .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
  }

  async function handleJoinEvent(event = {}) {
    const rules = state.config.rules;
    const needsPlaytime = rulesNeedPlaytime(rules);
    const context = await resolvePlayerContext(event, { resolvePlaytime: needsPlaytime });
    recordRecentEvent(event, context);

    const eventSummary = buildEventSummary(event, context);
    state.joinEventCount += 1;
    state.lastJoinAt = new Date().toISOString();

    if (!isActive()) {
      recordHistory({
        kind: "join",
        success: false,
        skipped: true,
        reason: !state.config.enabled ? "plugin_disabled" : "plugin_unsubscribed",
        event: eventSummary,
      });
      return { event: eventSummary, scheduled: [], matchedRules: [], suppressed: [] };
    }

    if (!context.playerName) {
      state.lastError = "player_name_missing";
      recordHistory({
        kind: "join",
        success: false,
        skipped: true,
        reason: "player_name_missing",
        event: eventSummary,
      });
      pluginLogger?.warn?.("[WelcomeJoinWarning] player name missing on join event, warning skipped.");
      return { event: eventSummary, scheduled: [], matchedRules: [], suppressed: [{ reason: "player_name_missing" }] };
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
      pluginLogger?.warn?.("[WelcomeJoinWarning] adminWarn API unavailable, warning skipped.");
      return { event: eventSummary, scheduled: [], matchedRules: [], suppressed: [{ reason: "admin_warn_api_unavailable" }] };
    }

    const eventKey = buildTimerKey(event, context.playerName);
    if (pendingEvents.has(eventKey)) {
      recordHistory({
        kind: "join",
        success: false,
        skipped: true,
        reason: "duplicate_event",
        event: eventSummary,
      });
      return { event: eventSummary, scheduled: [], matchedRules: [], suppressed: [{ reason: "duplicate_event" }] };
    }

    const plan = await buildWarningPlan(event, context, { ignoreCooldown: false });
    state.matchedRuleCount += plan.matchedRules.length;
    state.suppressedCount += plan.suppressed.length;

    if (!plan.scheduled.length) {
      recordHistory({
        kind: "join",
        success: false,
        skipped: true,
        reason: plan.matchedRules.length ? "all_warnings_suppressed" : "no_rule_matched",
        event: eventSummary,
        matchedRules: plan.matchedRules,
        suppressed: plan.suppressed,
      });
      return plan;
    }

    state.scheduledCount += plan.scheduled.length;
    state.lastError = "";
    applyCooldowns(plan, context);
    recordHistory({
      kind: "join",
      success: true,
      skipped: false,
      reason: "scheduled",
      event: eventSummary,
      matchedRules: plan.matchedRules,
      suppressed: plan.suppressed,
      scheduledWarnings: plan.scheduled.length,
    });

    pendingEvents.set(eventKey, plan.scheduled.length);
    for (const item of plan.scheduled) {
      scheduleWarning({ event, eventSummary, context, eventKey, item, warnApi });
    }

    return plan;
  }

  function scheduleWarning({ event, eventSummary, context, eventKey, item, warnApi }) {
    const id = `joinWarn:${++taskSerial}:${Date.now()}`;
    const scheduledAtMs = Date.now();
    const timer = setTimeout(async () => {
      pendingTimers.delete(id);
      decrementPendingEvent(eventKey);

      if (!isActive()) {
        recordHistory({
          kind: "warn",
          success: false,
          skipped: true,
          reason: !state.config.enabled ? "plugin_disabled" : "plugin_unsubscribed",
          event: eventSummary,
          ruleId: item.ruleId,
          ruleName: item.ruleName,
          stepIndex: item.stepIndex,
          delayMs: item.delayMs,
          message: item.message,
        });
        return;
      }

      try {
        const result = await warnApi({
          sourceModule: PLUGIN_ID,
          reason: `player_join_rule:${item.ruleId}`,
          relatedEventId: event?.eventId,
          targetName: context.playerName,
          targetSteamId: context.steamID || undefined,
          targetEosId: context.eosID || undefined,
          message: item.message,
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
            ruleId: item.ruleId,
            ruleName: item.ruleName,
            stepIndex: item.stepIndex,
            delayMs: item.delayMs,
            message: item.message,
            result,
          });
          pluginLogger?.warn?.(`[WelcomeJoinWarning] failed for ${context.playerName}: ${state.lastError}`);
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
          ruleId: item.ruleId,
          ruleName: item.ruleName,
          stepIndex: item.stepIndex,
          delayMs: item.delayMs,
          message: item.message,
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
          ruleId: item.ruleId,
          ruleName: item.ruleName,
          stepIndex: item.stepIndex,
          delayMs: item.delayMs,
          message: item.message,
          errorMessage: state.lastError,
        });
        pluginLogger?.warn?.(`[WelcomeJoinWarning] failed for ${context.playerName}: ${state.lastError}`);
      }
    }, item.delayMs);

    pendingTimers.set(id, {
      id,
      timer,
      eventKey,
      playerName: context.playerName,
      ruleId: item.ruleId,
      ruleName: item.ruleName,
      stepIndex: item.stepIndex,
      delayMs: item.delayMs,
      scheduledAt: new Date(scheduledAtMs).toISOString(),
      dueAt: new Date(scheduledAtMs + item.delayMs).toISOString(),
    });
  }

  function decrementPendingEvent(eventKey) {
    const remaining = Number(pendingEvents.get(eventKey) ?? 0) - 1;
    if (remaining > 0) {
      pendingEvents.set(eventKey, remaining);
    } else {
      pendingEvents.delete(eventKey);
    }
  }

  async function buildWarningPlan(event = {}, context = null, options = {}) {
    const resolvedContext = context ?? await resolvePlayerContext(event, {
      resolvePlaytime: rulesNeedPlaytime(state.config.rules),
    });
    const eventSummary = buildEventSummary(event, resolvedContext);
    const matchedRules = [];
    const scheduled = [];
    const suppressed = [];
    const playerKey = buildPlayerKey(resolvedContext);
    let nextDelayMs = null;

    const sortedRules = state.config.rules
      .filter((rule) => rule.enabled !== false)
      .slice()
      .sort((a, b) => Number(a.priority ?? 0) - Number(b.priority ?? 0) || String(a.name).localeCompare(String(b.name), "zh-CN"));

    for (const rule of sortedRules) {
      const match = evaluateRule(rule, resolvedContext);
      if (!match.matched) continue;

      matchedRules.push({
        id: rule.id,
        name: rule.name,
        priority: rule.priority,
        conditionResults: match.conditionResults,
      });

      const cooldown = getCooldown(rule, playerKey);
      if (!options.ignoreCooldown && cooldown.active) {
        suppressed.push({
          ruleId: rule.id,
          ruleName: rule.name,
          reason: "cooldown",
          until: cooldown.until,
        });
        continue;
      }

      const steps = rule.steps.filter((step) => step.enabled !== false && step.message);
      if (!steps.length) {
        suppressed.push({
          ruleId: rule.id,
          ruleName: rule.name,
          reason: "no_enabled_steps",
        });
        continue;
      }

      if (nextDelayMs == null) {
        nextDelayMs = Math.max(0, Number(rule.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS) || 0);
      }

      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        if (scheduled.length >= state.config.maxWarningsPerJoin) {
          suppressed.push({
            ruleId: rule.id,
            ruleName: rule.name,
            stepIndex: index + 1,
            reason: "max_warnings_per_join",
            limit: state.config.maxWarningsPerJoin,
          });
          continue;
        }

        scheduled.push({
          ruleId: rule.id,
          ruleName: rule.name,
          stepId: step.id,
          stepIndex: index + 1,
          message: step.message,
          delayMs: nextDelayMs,
        });

        const intervalMs = Math.max(0, Number(step.intervalOverrideMs ?? rule.intervalMs ?? state.config.defaultIntervalMs) || 0);
        nextDelayMs += intervalMs;
      }
    }

    return {
      event: eventSummary,
      player: cloneJsonSafe(resolvedContext),
      matchedRules,
      scheduled,
      suppressed,
    };
  }

  function evaluateRule(rule, context) {
    const conditions = rule.conditions.length ? rule.conditions : [{ type: "always" }];
    const conditionResults = conditions.map((condition) => evaluateCondition(condition, context));
    const mode = rule.mode === "any" ? "any" : "all";
    const matched = mode === "any"
      ? conditionResults.some((item) => item.matched)
      : conditionResults.every((item) => item.matched);
    return { matched, conditionResults };
  }

  function evaluateCondition(condition, context) {
    const type = normalizeConditionType(condition?.type);
    let matched = false;
    let detail = "";

    try {
      switch (type) {
        case "always":
          matched = true;
          break;
        case "playtimeHours": {
          if (!context.playtimeKnown) {
            matched = false;
            detail = "playtime_unknown";
            break;
          }
          const hours = Number(context.gameHours);
          const min = numberOrNull(condition.minHours);
          const max = numberOrNull(condition.maxHours);
          matched = Number.isFinite(hours)
            && (min == null || hours >= min)
            && (max == null || hours <= max);
          detail = `${hours}`;
          break;
        }
        case "playtimeUnknown":
          matched = !context.playtimeKnown;
          break;
        case "nameContains":
          matched = includesText(context.playerName, condition.value);
          break;
        case "nameRegex":
          matched = testRegex(context.playerName, condition.pattern ?? condition.value);
          break;
        case "steamIdIn":
          matched = valueInList(context.steamID, condition.values ?? condition.value);
          break;
        case "eosIdIn":
          matched = valueInList(context.eosID, condition.values ?? condition.value);
          break;
        case "ipContains":
          matched = includesText(context.ip, condition.value);
          break;
        case "ipRegex":
          matched = testRegex(context.ip, condition.pattern ?? condition.value);
          break;
        case "teamIdIn":
          matched = valueInList(context.teamID, condition.values ?? condition.value);
          break;
        case "squadIdIn":
          matched = valueInList(context.squadID, condition.values ?? condition.value);
          break;
        case "factionIn":
          matched = valueInList(context.faction, condition.values ?? condition.value);
          break;
        case "fieldExists": {
          const field = String(condition.field ?? "").trim();
          matched = Boolean(field && String(context[field] ?? "").trim());
          break;
        }
        case "fieldEquals": {
          const field = String(condition.field ?? "").trim();
          matched = Boolean(field) && String(context[field] ?? "").trim().toLowerCase() === String(condition.value ?? "").trim().toLowerCase();
          break;
        }
        default:
          detail = "unsupported_condition";
          matched = false;
      }
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
      matched = false;
    }

    return {
      type,
      label: condition.label || condition.type || type,
      matched,
      detail,
    };
  }

  async function resolvePlayerContext(event = {}, options = {}) {
    const playerName = resolvePlayerName(event);
    const serverId = String(event?.serverId ?? core?.webStatus?.serverId ?? "").trim();
    const playerStateHit = playerName && modules?.playerState?.getPlayerByName
      ? modules.playerState.getPlayerByName(serverId, playerName)
      : null;

    const steamID = firstText(
      getEventValue(event, ["steamID", "SteamID", "steamId", "SteamId", "steam64", "steam64ID"]),
      playerStateHit?.steamID,
      playerStateHit?.steam64ID,
    );
    const eosID = firstText(
      getEventValue(event, ["eosID", "EOSID", "eosId", "EosID"]),
      playerStateHit?.eosID,
    );
    const context = {
      serverId,
      playerName,
      steamID,
      eosID,
      ip: firstText(getEventValue(event, ["ip", "IP", "PlayerIP", "playerIP"]), playerStateHit?.ip),
      teamID: firstText(getEventValue(event, ["teamID", "TeamID", "teamId"]), playerStateHit?.teamID),
      squadID: firstText(getEventValue(event, ["squadID", "SquadID", "squadId"]), playerStateHit?.squadID),
      faction: firstText(getEventValue(event, ["faction", "Faction", "factionName"]), playerStateHit?.faction),
      gameHours: numberOrNull(getEventValue(event, ["gameHours", "playtimeHours"])),
      playtimeKnown: false,
    };

    if (context.gameHours != null) {
      context.playtimeKnown = true;
      return context;
    }

    if (options.resolvePlaytime && steamID && modules?.playtime) {
      const resolved = await resolvePlaytimeHours(steamID, playerName);
      if (resolved.known) {
        context.gameHours = resolved.hours;
        context.playtimeKnown = true;
      }
    }

    return context;
  }

  async function resolvePlaytimeHours(steamID, playerName) {
    try {
      const cached = await modules.playtime.getBySteamID?.(steamID);
      const cachedSeconds = numberOrNull(cached?.gameSecondsOverride)
        ?? numberOrNull(cached?.game_seconds_override)
        ?? numberOrNull(cached?.gameSeconds)
        ?? numberOrNull(cached?.game_seconds);
      if (cachedSeconds != null) {
        return { known: true, hours: cachedSeconds / 3600, source: "cache" };
      }

      const lookup = await modules.playtime.lookupSteamID?.(steamID, { lastSeenName: playerName });
      const lookupSeconds = numberOrNull(lookup?.gameSeconds) ?? numberOrNull(lookup?.game_seconds);
      if (lookupSeconds != null) {
        return { known: true, hours: lookupSeconds / 3600, source: "lookup" };
      }
    } catch (error) {
      pluginLogger?.warn?.(`[WelcomeJoinWarning] playtime lookup failed for ${playerName || steamID}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { known: false, hours: null, source: "unknown" };
  }

  function applyCooldowns(plan, context) {
    const playerKey = buildPlayerKey(context);
    const scheduledRuleIds = new Set(plan.scheduled.map((item) => item.ruleId));
    for (const rule of state.config.rules) {
      if (!scheduledRuleIds.has(rule.id)) continue;
      const cooldownMs = Math.max(0, Number(rule.cooldownMs ?? 0) || 0);
      if (cooldownMs <= 0) continue;
      cooldowns.set(`${rule.id}:${playerKey}`, Date.now() + cooldownMs);
    }
    pruneCooldowns();
  }

  function getCooldown(rule, playerKey) {
    pruneCooldowns();
    const untilMs = Number(cooldowns.get(`${rule.id}:${playerKey}`) ?? 0);
    if (!untilMs || untilMs <= Date.now()) return { active: false, until: "" };
    return { active: true, until: new Date(untilMs).toISOString() };
  }

  function pruneCooldowns() {
    const now = Date.now();
    for (const [key, untilMs] of cooldowns.entries()) {
      if (Number(untilMs) <= now) cooldowns.delete(key);
    }
  }

  function clearAllPendingTimers() {
    for (const entry of pendingTimers.values()) {
      clearTimeout(entry.timer);
    }
    pendingTimers.clear();
    pendingEvents.clear();
  }

  const api = {
    getState,

    getHistory(limit = state.config.historyLimit) {
      const count = Math.max(1, Number(limit) || state.config.historyLimit);
      return [...state.history].slice(-count).reverse();
    },

    getRecentEvents(limit = state.recentEventLimit) {
      const count = Math.max(1, Number(limit) || state.recentEventLimit);
      return [...state.recentEvents].slice(-count).reverse();
    },

    async simulateJoin(payload = {}) {
      const event = buildSimulatedJoinEvent(payload);
      return enqueue(() => handleJoinEvent(event));
    },

    async updateConfig(nextConfig = {}) {
      const currentRaw = config?.get?.("plugins.welcome-join-warning", null)
        ?? config?.get?.("plugins.welcomeJoinWarning", null)
        ?? {};
      const previousConfig = cloneJsonSafe(currentRaw);
      const normalized = normalizeRuntimeConfig(nextConfig, { legacy: false });
      const configKey = "plugins.welcome-join-warning";

      config?.set?.(configKey, normalized);

      try {
        await config?.save?.();
        state.config = normalized;

        if (state.history.length > state.config.historyLimit) {
          state.history.splice(0, state.history.length - state.config.historyLimit);
        }
      } catch (error) {
        if (config?.set) {
          config.set(configKey, previousConfig);
        }
        throw error;
      }

      return getState();
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
      name: "玩家进服警告",
      kind: "plugin",
      version: "2.0.0",
      description: "玩家加入服务器后按规则组自动发送多段 AdminWarn，支持时长分流、名单匹配、冷却和模拟验证。",
    },
    apiName: "welcomeJoinWarning",
    api,

    async start() {
      state.config = readRuntimeConfig(config);

      core?.webRegistry?.registerPage?.({
        id: "web.welcomeJoinWarning.debug",
        title: "进服警告",
        group: "通知广播",
        route: PAGE_ROUTE,
        pageModule: "/pages/welcome-join-warning-debug.js",
        source: PLUGIN_ID,
        description: "配置玩家进服后的多组自动警告、条件命中和发送历史。",
        required: false,
        enabled: true,
        order: 130,
        icon: "WARN",
      });

      if (!state.config.enabled) {
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

      if (!core?.rawLogDerivedEvents) {
        unsubscribers.push(core.eventBus.onCoreEvent(RAW_LOG_JOIN_EVENT_NAME, (event) => {
          const joinEvent = buildJoinEventFromRawLog(event);
          if (!joinEvent) return;
          void enqueue(() => handleJoinEvent(joinEvent));
        }));
      }

      pluginLogger?.info?.(
        `[WelcomeJoinWarning] started. rules=${state.config.rules.length} maxWarningsPerJoin=${state.config.maxWarningsPerJoin}`,
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

  return normalizeRuntimeConfig(cfg, { legacy: !Array.isArray(cfg?.rules) });
}

function normalizeRuntimeConfig(raw = {}, { legacy = false } = {}) {
  const enabled = raw?.enabled !== false;
  const historyLimit = Math.max(20, Number(raw?.historyLimit ?? DEFAULT_HISTORY_LIMIT) || DEFAULT_HISTORY_LIMIT);
  const maxWarningsPerJoin = Math.max(1, Math.min(20, Number(raw?.maxWarningsPerJoin ?? DEFAULT_MAX_WARNINGS_PER_JOIN) || DEFAULT_MAX_WARNINGS_PER_JOIN));
  const defaultIntervalMs = Math.max(0, Number(raw?.defaultIntervalMs ?? (legacy ? 0 : DEFAULT_INTERVAL_MS)) || 0);
  const legacyDelayMs = Math.max(0, Number(raw?.delayMs ?? DEFAULT_INITIAL_DELAY_MS) || DEFAULT_INITIAL_DELAY_MS);
  const legacyMessage = String(raw?.message ?? DEFAULT_MESSAGE).trim() || DEFAULT_MESSAGE;

  const rawRules = Array.isArray(raw?.rules) && raw.rules.length
    ? raw.rules
    : buildDefaultRules({ delayMs: legacyDelayMs, message: legacyMessage, intervalMs: defaultIntervalMs });

  const rules = rawRules
    .map((rule, index) => normalizeRule(rule, index, { defaultDelayMs: legacyDelayMs, defaultIntervalMs }))
    .filter(Boolean);

  return {
    enabled,
    historyLimit,
    maxWarningsPerJoin,
    defaultIntervalMs,
    rules: rules.length ? rules : buildDefaultRules({ delayMs: legacyDelayMs, message: legacyMessage, intervalMs: defaultIntervalMs }),
  };
}

function buildDefaultRules({ delayMs, message, intervalMs }) {
  return [
    {
      id: "default-welcome",
      name: "默认欢迎",
      enabled: true,
      priority: 10,
      cooldownMs: 0,
      mode: "all",
      initialDelayMs: delayMs,
      intervalMs,
      conditions: [{ type: "always" }],
      steps: [{ id: "welcome", message }],
    },
    {
      id: "newbie-playtime",
      name: "萌新提示",
      enabled: true,
      priority: 20,
      cooldownMs: 0,
      mode: "all",
      initialDelayMs: delayMs,
      intervalMs,
      conditions: [{ type: "playtimeHours", minHours: 0, maxHours: 200 }],
      steps: [{ id: "newbie", message: DEFAULT_NEWBIE_MESSAGE }],
    },
  ];
}

function normalizeRule(rule, index, defaults = {}) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return null;
  const id = sanitizeId(rule.id, `rule-${index + 1}`);
  const name = String(rule.name ?? `规则组 ${index + 1}`).trim() || `规则组 ${index + 1}`;
  const conditions = Array.isArray(rule.conditions) ? rule.conditions.map(normalizeCondition).filter(Boolean) : [];
  const steps = Array.isArray(rule.steps) ? rule.steps.map(normalizeStep).filter(Boolean) : [];

  return {
    id,
    name,
    enabled: rule.enabled !== false,
    priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : (index + 1) * 10,
    cooldownMs: Math.max(0, Number(rule.cooldownMs ?? 0) || 0),
    mode: rule.mode === "any" ? "any" : "all",
    initialDelayMs: Math.max(0, Number(rule.initialDelayMs ?? rule.delayMs ?? defaults.defaultDelayMs ?? DEFAULT_INITIAL_DELAY_MS) || 0),
    intervalMs: Math.max(0, Number(rule.intervalMs ?? defaults.defaultIntervalMs ?? DEFAULT_INTERVAL_MS) || 0),
    conditions: conditions.length ? conditions : [{ type: "always" }],
    steps: steps.length ? steps : [{ id: "step-1", enabled: true, message: DEFAULT_MESSAGE }],
  };
}

function normalizeCondition(condition) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) return null;
  const type = normalizeConditionType(condition.type);
  return {
    ...cloneJsonSafe(condition),
    type,
    label: String(condition.label ?? "").trim(),
  };
}

function normalizeStep(step, index) {
  if (step == null) return null;
  const raw = typeof step === "string" ? { message: step } : step;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const message = String(raw.message ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 180);
  if (!message) return null;
  return {
    id: sanitizeId(raw.id, `step-${index + 1}`),
    enabled: raw.enabled !== false,
    message,
    intervalOverrideMs: raw.intervalOverrideMs == null ? undefined : Math.max(0, Number(raw.intervalOverrideMs) || 0),
  };
}

function normalizeConditionType(type) {
  const text = String(type ?? "always").trim();
  const lowered = text.toLowerCase();
  const aliases = {
    always: "always",
    all: "always",
    playtime: "playtimeHours",
    playtimehours: "playtimeHours",
    playtimeunknown: "playtimeUnknown",
    namecontains: "nameContains",
    nameregex: "nameRegex",
    steamidin: "steamIdIn",
    steamidlist: "steamIdIn",
    eosidin: "eosIdIn",
    eosidlist: "eosIdIn",
    ipcontains: "ipContains",
    ipregex: "ipRegex",
    teamidin: "teamIdIn",
    squadidin: "squadIdIn",
    factionin: "factionIn",
    fieldexists: "fieldExists",
    fieldequals: "fieldEquals",
  };
  return aliases[lowered] ?? text;
}

function buildSimulatedJoinEvent(payload = {}) {
  const playerName = String(payload?.playerName ?? payload?.name ?? "DebugPlayer").trim() || "DebugPlayer";
  const eventPayload = {
    name: playerName,
    playerName,
  };
  const paramMap = {
    PlayerName: playerName,
  };

  const fields = [
    ["steamID", "SteamID"],
    ["eosID", "EOSID"],
    ["ip", "PlayerIP"],
    ["teamID", "TeamID"],
    ["squadID", "SquadID"],
    ["faction", "Faction"],
    ["gameHours", "GameHours"],
  ];
  for (const [payloadKey, paramKey] of fields) {
    const value = payload?.[payloadKey];
    if (value == null || String(value).trim() === "") continue;
    eventPayload[payloadKey] = value;
    paramMap[paramKey] = value;
  }

  return {
    eventId: String(payload?.eventId ?? `manual:${Date.now()}`),
    eventName: "On_PlayerJoined",
    serverId: String(payload?.serverId ?? "").trim(),
    time: new Date().toISOString(),
    payload: eventPayload,
    paramMap,
  };
}

function resolvePlayerName(event = {}) {
  const fromEvent = firstText(
    getEventValue(event, ["name", "playerName", "PlayerName"]),
    parseJoinSucceededNameFromRawLog(event),
  );
  return fromEvent;
}

function resolvePlayerSteamID(event = {}) {
  return getEventValue(event, ["steamID", "SteamID", "steamId", "SteamId", "steam64", "steam64ID"]);
}

function parseJoinSucceededNameFromRawLog(event = {}) {
  const raw = String(event?.rawLog ?? event?.rawEvent?.Raw ?? "").trim();
  if (!raw) return "";

  const match = raw.match(/\bLogNet:\s*Join succeeded:\s*(.+?)\s*(?:\|\s*\[raw_log_line\]\s*)?$/i);
  if (!match) return "";

  return String(match[1] ?? "").replace(/\s*\|\s*.*$/, "").trim();
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

function getEventValue(event = {}, keys = []) {
  const payload = event?.payload ?? {};
  const paramMap = event?.paramMap ?? {};
  for (const key of keys) {
    const value = firstText(payload?.[key], paramMap?.[key]);
    if (value) return value;
  }

  const params = Array.isArray(event?.params) ? event.params : [];
  for (const param of params) {
    if (!keys.includes(param?.name)) continue;
    const value = firstText(param?.value);
    if (value) return value;
  }

  for (const key of keys) {
    const value = firstText(event?.[key]);
    if (value) return value;
  }

  return "";
}

function buildEventSummary(event, context) {
  return {
    eventId: String(event?.eventId ?? "").trim(),
    eventName: String(event?.eventName ?? "").trim(),
    serverId: String(event?.serverId ?? context?.serverId ?? "").trim(),
    playerName: context?.playerName ?? "",
    steamID: context?.steamID ?? "",
    eosID: context?.eosID ?? "",
    ip: context?.ip ?? "",
    time: String(event?.time ?? "").trim(),
  };
}

function buildTimerKey(event = {}, playerName = "") {
  const eventId = String(event?.eventId ?? "").trim();
  if (eventId) return eventId;

  const serverId = String(event?.serverId ?? "").trim();
  const time = String(event?.time ?? Date.now());
  return `${serverId}:${playerName}:${time}`;
}

function buildPlayerKey(context = {}) {
  if (context.steamID) return `steam:${context.steamID}`;
  if (context.eosID) return `eos:${context.eosID}`;
  if (context.playerName) return `name:${String(context.playerName).toLowerCase()}`;
  return "unknown";
}

function rulesNeedPlaytime(rules = []) {
  return rules.some((rule) => (rule.conditions ?? []).some((condition) => {
    const type = normalizeConditionType(condition?.type);
    return type === "playtimeHours" || type === "playtimeUnknown";
  }));
}

function includesText(value, wanted) {
  const text = String(value ?? "").toLowerCase();
  const needle = String(wanted ?? "").trim().toLowerCase();
  return Boolean(text && needle && text.includes(needle));
}

function testRegex(value, pattern) {
  const text = String(value ?? "");
  const source = String(pattern ?? "").trim();
  if (!text || !source) return false;
  return new RegExp(source, "i").test(text);
}

function valueInList(value, rawList) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return false;
  return normalizeList(rawList).some((item) => item.toLowerCase() === text);
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  return String(value ?? "")
    .split(/[\n,，;；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function sanitizeId(value, fallback) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  return text.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

function cloneJsonSafe(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

export default { createPlugin };
