// -*- coding: utf-8 -*-

const PLUGIN_ID = "plugin.attack-defense-opening-warning";
const PLUGIN_CONFIG_KEY = "attack-defense-opening-warning";

const DEFAULT_TRIGGER_MINUTES = [2, 3, 4];
const DEFAULT_CHECK_INTERVAL_MS = 1000;
const DEFAULT_TRIGGER_GRACE_SECONDS = 15;
const DEFAULT_MESSAGE = [
  "【开局规则】AAS/RAAS 开局阶段，禁止截获或攻击敌方在前两点范围内执行拉点任务的队伍。",
  "【处罚说明】违规截获若造成敌方人员、载具或资源损失，将根据实际影响扣除违规方相应票数。",
].join("\n");

const SUPPORTED_MODES = new Set(["AAS", "RAAS"]);
const ROUND_START_EVENTS = [
  "round.world_bring_up",
  "GAME_START",
  "MATCH_START",
  "ROUND_START",
  "NEW_GAME",
];
const ROUND_END_EVENTS = ["GAME_END", "MATCH_END", "ROUND_END", "ROUND_ENDED"];

export function createPlugin({ core, modules, config, logger } = {}) {
  const pluginLogger =
    logger
    ?? core?.createLogger?.({
      moduleId: PLUGIN_ID,
      source: PLUGIN_ID,
      channel: "plugin",
    })
    ?? core?.logger
    ?? console;

  let runtimeConfig = readRuntimeConfig(config);
  let timer = null;
  let checking = false;
  let lastClockSeconds = null;
  let currentRoundKey = "";
  const firedTriggers = new Set();
  const expiredTriggers = new Set();
  const unsubscribers = [];

  const state = {
    enabled: runtimeConfig.enabled,
    subscribed: true,
    active: false,
    currentMode: "",
    currentRoundKey: "",
    currentClockSeconds: null,
    firedTriggerSeconds: [],
    expiredTriggerSeconds: [],
    warningWindowEndSecond: runtimeConfig.warningWindowEndSecond,
    warningWindowExpired: false,
    dispatchCount: 0,
    warnSuccessCount: 0,
    warnFailedCount: 0,
    skippedCount: 0,
    lastTriggerSecond: null,
    lastDispatchAt: "",
    lastCheckAt: "",
    lastResetAt: "",
    lastResetReason: "",
    lastRecipientCount: 0,
    lastError: "",
  };

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false
      && core?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false;
  }

  function isActive() {
    return Boolean(runtimeConfig.enabled) && isSubscribed();
  }

  function clearTimer() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function getWarnApi() {
    return modules?.adminWarn?.sendAdminWarn ?? modules?.adminWarn?.warnPlayer ?? null;
  }

  function getClockSeconds() {
    const candidates = [
      modules?.logClock?.getSeconds?.(),
      modules?.matchState?.getState?.()?.rconPolling?.logClockSeconds,
      core?.webStatus?.logClock?.getSeconds?.(),
      core?.webStatus?.getSnapshot?.()?.logClockSeconds,
    ];

    for (const value of candidates) {
      const number = Number(value);
      if (Number.isFinite(number) && number >= 0) return Math.floor(number);
    }

    return null;
  }

  function getMatchSnapshot() {
    return modules?.matchState?.getState?.()
      ?? modules?.matchState?.getOverview?.()?.matchState
      ?? null;
  }

  function getCurrentMode(snapshot = getMatchSnapshot()) {
    const webStatus = core?.webStatus?.getSnapshot?.() ?? null;
    const candidates = [
      snapshot?.round?.current?.gameMode,
      snapshot?.round?.current?.mode,
      snapshot?.match?.mode,
      snapshot?.serverStatus?.mode,
      snapshot?.round?.current?.layerName,
      snapshot?.match?.layer,
      snapshot?.serverStatus?.layer,
      webStatus?.gameMode,
      webStatus?.mode,
      webStatus?.layer,
    ];

    for (const candidate of candidates) {
      const mode = normalizeGameMode(candidate);
      if (mode) return mode;
    }

    return "";
  }

  function getRoundKey(snapshot = getMatchSnapshot()) {
    const round = snapshot?.round?.current ?? null;
    if (!round || typeof round !== "object") return "";

    const parts = [
      round.serverId,
      round.logLineTime,
      round.serverPlayAt,
      round.worldPath,
      round.layerName,
      round.mapName,
    ]
      .map((value) => normalizeText(value))
      .filter(Boolean);

    return parts.join("|");
  }

  function syncTriggerState() {
    state.firedTriggerSeconds = [...firedTriggers].sort((a, b) => a - b);
    state.expiredTriggerSeconds = [...expiredTriggers].sort((a, b) => a - b);
  }

  function resetRound(reason = "round_reset", roundKey = "") {
    firedTriggers.clear();
    expiredTriggers.clear();
    lastClockSeconds = null;
    currentRoundKey = normalizeText(roundKey);
    state.currentRoundKey = currentRoundKey;
    state.currentClockSeconds = null;
    state.firedTriggerSeconds = [];
    state.expiredTriggerSeconds = [];
    state.warningWindowEndSecond = runtimeConfig.warningWindowEndSecond;
    state.warningWindowExpired = false;
    state.lastTriggerSecond = null;
    state.lastResetAt = new Date().toISOString();
    state.lastResetReason = reason;
    state.lastError = "";
  }

  function handleRoundStart(event) {
    const eventRound = event?.normalized?.roundWorldBringUp ?? event?.record ?? null;
    const roundKey = eventRound
      ? [
          eventRound.serverId,
          eventRound.logLineTime,
          eventRound.serverPlayAt,
          eventRound.worldPath,
          eventRound.layerName,
          eventRound.mapName,
        ].map((value) => normalizeText(value)).filter(Boolean).join("|")
      : "";

    resetRound(`event:${normalizeText(event?.eventName, "round_start")}`, roundKey);
  }

  function handleRoundEnd(event) {
    resetRound(`event:${normalizeText(event?.eventName, "round_end")}`, "");
  }

  async function resolveOnlinePlayers() {
    const snapshot = getMatchSnapshot();
    const overview = modules?.matchState?.getOverview?.(snapshot) ?? null;
    const serverId = normalizeText(core?.webStatus?.serverId ?? snapshot?.serverId ?? overview?.status?.serverId);
    const statePlayers = modules?.playerState?.getPlayerList?.(serverId);
    const onlinePlayers = modules?.playerState?.getOnlinePlayers?.(serverId);

    const candidates = [
      ...(Array.isArray(snapshot?.players?.list) ? snapshot.players.list : []),
      ...(Array.isArray(overview?.players) ? overview.players : []),
      ...(Array.isArray(statePlayers) ? statePlayers : []),
      ...(Array.isArray(onlinePlayers) ? onlinePlayers : []),
    ];

    if (typeof modules?.tacticalState?.getPlayers === "function") {
      try {
        const tacticalPlayers = await modules.tacticalState.getPlayers();
        if (Array.isArray(tacticalPlayers)) candidates.push(...tacticalPlayers);
      } catch (error) {
        pluginLogger?.debug?.(
          `[AttackDefenseOpeningWarning] tactical player lookup failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const deduped = new Map();
    for (const player of candidates) {
      const target = normalizePlayerTarget(player);
      if (!target.targetName && !target.targetPlayerId) continue;
      const key = target.targetPlayerId
        || target.targetSteamId
        || target.targetEosId
        || target.targetName.toLowerCase();
      if (!key || deduped.has(key)) continue;
      deduped.set(key, target);
    }

    return [...deduped.values()];
  }

  async function dispatchWarning(triggerSecond, reason = "scheduled") {
    const mode = getCurrentMode();
    state.currentMode = mode;

    if (!SUPPORTED_MODES.has(mode)) {
      state.skippedCount += 1;
      state.lastError = mode ? `unsupported_mode:${mode}` : "mode_unknown";
      return { success: false, skipped: true, skipReason: state.lastError, mode };
    }

    const warnApi = getWarnApi();
    if (typeof warnApi !== "function") {
      state.lastError = "admin_warn_api_unavailable";
      pluginLogger?.warn?.("[AttackDefenseOpeningWarning] AdminWarn API unavailable.");
      return { success: false, skipped: true, skipReason: state.lastError, mode };
    }

    const players = await resolveOnlinePlayers();
    state.lastRecipientCount = players.length;
    if (!players.length) {
      state.skippedCount += 1;
      state.lastError = "no_online_players";
      return { success: false, skipped: true, skipReason: state.lastError, mode };
    }

    let successCount = 0;
    let failedCount = 0;
    const relatedEventId = `attack_defense_opening_warning_${triggerSecond}_${Date.now()}`;

    for (const player of players) {
      try {
        const result = await warnApi({
          targetName: player.targetName || undefined,
          targetPlayerId: player.targetPlayerId || undefined,
          targetSteamId: player.targetSteamId || undefined,
          targetEosId: player.targetEosId || undefined,
          message: runtimeConfig.message,
          sourceModule: PLUGIN_ID,
          reason: `attack_defense_opening_warning_${reason}_${triggerSecond}s`,
          relatedEventId,
          system: true,
        });

        if (result?.success) successCount += 1;
        else failedCount += 1;
      } catch (error) {
        failedCount += 1;
        state.lastError = error instanceof Error ? error.message : String(error ?? "admin_warn_failed");
      }
    }

    state.warnSuccessCount += successCount;
    state.warnFailedCount += failedCount;

    if (successCount > 0) {
      firedTriggers.add(triggerSecond);
      expiredTriggers.delete(triggerSecond);
      syncTriggerState();
      state.dispatchCount += 1;
      state.lastTriggerSecond = triggerSecond;
      state.lastDispatchAt = new Date().toISOString();
    }

    state.lastError = failedCount > 0 ? `warn_failed_${failedCount}` : successCount > 0 ? "" : "warn_no_success";

    pluginLogger?.info?.(
      `[AttackDefenseOpeningWarning] AdminWarn dispatched at ${triggerSecond}s. mode=${mode} success=${successCount} failed=${failedCount}`,
    );

    return {
      success: successCount > 0 && failedCount === 0,
      skipped: false,
      mode,
      triggerSecond,
      playerCount: players.length,
      successCount,
      failedCount,
    };
  }

  async function checkClock() {
    if (checking) return;
    checking = true;
    state.lastCheckAt = new Date().toISOString();
    state.enabled = runtimeConfig.enabled;
    state.subscribed = isSubscribed();
    state.active = isActive();

    try {
      if (!isActive()) return;

      const snapshot = getMatchSnapshot();
      const roundKey = getRoundKey(snapshot);
      if (roundKey && roundKey !== currentRoundKey) {
        resetRound("round_key_changed", roundKey);
      }

      const clockSeconds = getClockSeconds();
      state.currentClockSeconds = clockSeconds;
      state.currentMode = getCurrentMode(snapshot);
      state.warningWindowEndSecond = runtimeConfig.warningWindowEndSecond;

      if (clockSeconds == null) {
        state.lastError = "log_clock_unavailable";
        return;
      }

      if (lastClockSeconds != null && clockSeconds + 5 < lastClockSeconds) {
        resetRound("log_clock_rollback", roundKey);
        state.currentClockSeconds = clockSeconds;
      }

      lastClockSeconds = clockSeconds;

      for (const triggerSecond of runtimeConfig.triggerSeconds) {
        if (firedTriggers.has(triggerSecond) || expiredTriggers.has(triggerSecond)) continue;
        if (clockSeconds > triggerSecond + runtimeConfig.triggerGraceSeconds) {
          expiredTriggers.add(triggerSecond);
        }
      }
      syncTriggerState();

      state.warningWindowExpired = clockSeconds > runtimeConfig.warningWindowEndSecond;
      if (state.warningWindowExpired) {
        state.lastError = "";
        return;
      }

      const eligibleTrigger = runtimeConfig.triggerSeconds
        .filter((triggerSecond) => !firedTriggers.has(triggerSecond))
        .filter((triggerSecond) => !expiredTriggers.has(triggerSecond))
        .filter((triggerSecond) => clockSeconds >= triggerSecond)
        .filter((triggerSecond) => clockSeconds <= triggerSecond + runtimeConfig.triggerGraceSeconds)
        .at(-1);

      if (eligibleTrigger == null) return;

      await dispatchWarning(eligibleTrigger, "scheduled");
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error ?? "check_failed");
      pluginLogger?.warn?.(`[AttackDefenseOpeningWarning] check failed: ${state.lastError}`);
    } finally {
      checking = false;
    }
  }

  function startTimer() {
    clearTimer();
    if (!isActive()) return;
    timer = setInterval(() => {
      void checkClock();
    }, runtimeConfig.checkIntervalMs);
    timer.unref?.();
    void checkClock();
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "攻守模式开局禁止截获拉点队警告",
      kind: "plugin",
      version: "1.1.0",
      category: "规则警告",
      description: "仅在 AAS/RAAS 中，于开局第 2、3、4 分钟的允许延迟窗口内，通过 AdminWarn 向全部在线玩家发送前两点拉点队保护规则；过期不追发。",
      configSchema: [
        { key: "enabled", type: "boolean", default: true, label: "启用插件" },
        { key: "triggerMinutes", type: "number[]", default: DEFAULT_TRIGGER_MINUTES, label: "警告分钟" },
        { key: "triggerGraceSeconds", type: "number", default: DEFAULT_TRIGGER_GRACE_SECONDS, label: "允许延迟秒数" },
        { key: "message", type: "string", default: DEFAULT_MESSAGE, label: "警告文案" },
      ],
    },

    apiName: "attackDefenseOpeningWarning",

    api: {
      getState() {
        return {
          ...state,
          enabled: runtimeConfig.enabled,
          subscribed: isSubscribed(),
          active: isActive(),
          timerActive: Boolean(timer),
          config: { ...runtimeConfig },
        };
      },

      async runNow() {
        const clockSeconds = getClockSeconds() ?? 0;
        return dispatchWarning(clockSeconds, "manual");
      },

      reloadConfig() {
        runtimeConfig = readRuntimeConfig(config);
        state.warningWindowEndSecond = runtimeConfig.warningWindowEndSecond;
        startTimer();
        return this.getState();
      },
    },

    async start() {
      runtimeConfig = readRuntimeConfig(config);
      state.warningWindowEndSecond = runtimeConfig.warningWindowEndSecond;

      if (core?.eventBus?.onCoreEvent) {
        for (const eventName of ROUND_START_EVENTS) {
          unsubscribers.push(core.eventBus.onCoreEvent(eventName, handleRoundStart));
        }
        for (const eventName of ROUND_END_EVENTS) {
          unsubscribers.push(core.eventBus.onCoreEvent(eventName, handleRoundEnd));
        }
      }

      startTimer();
      pluginLogger?.info?.(
        `[AttackDefenseOpeningWarning] started. AdminWarn only; modes=AAS,RAAS; triggers=${runtimeConfig.triggerSeconds.join(",")}s; grace=${runtimeConfig.triggerGraceSeconds}s; end=${runtimeConfig.warningWindowEndSecond}s.`,
      );
    },

    async stop() {
      clearTimer();
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe();
        } catch {}
      }
      pluginLogger?.info?.("[AttackDefenseOpeningWarning] stopped.");
    },
  };
}

function readRuntimeConfig(config) {
  const pluginConfig =
    config?.get?.(`plugins.${PLUGIN_CONFIG_KEY}`, null)
    ?? config?.get?.(`plugins.${PLUGIN_ID}`, null)
    ?? config?.get?.(`plugins.plugin.${PLUGIN_CONFIG_KEY}`, null)
    ?? {};

  const triggerMinutes = normalizeTriggerMinutes(pluginConfig.triggerMinutes);
  const triggerSeconds = triggerMinutes.map((minute) => Math.round(minute * 60));
  const triggerGraceSeconds = clampNumber(
    pluginConfig.triggerGraceSeconds,
    DEFAULT_TRIGGER_GRACE_SECONDS,
    1,
    60,
  );
  const warningWindowEndSecond = Math.max(...triggerSeconds) + triggerGraceSeconds;

  return {
    enabled: pluginConfig.enabled !== false,
    triggerMinutes,
    triggerSeconds,
    checkIntervalMs: clampNumber(pluginConfig.checkIntervalMs, DEFAULT_CHECK_INTERVAL_MS, 250, 10_000),
    triggerGraceSeconds,
    warningWindowEndSecond,
    message: normalizeText(pluginConfig.message, DEFAULT_MESSAGE),
  };
}

function normalizeTriggerMinutes(value) {
  const source = Array.isArray(value) ? value : DEFAULT_TRIGGER_MINUTES;
  const normalized = source
    .map(Number)
    .filter((minute) => Number.isFinite(minute) && minute > 0 && minute <= 60)
    .map((minute) => Math.round(minute * 1000) / 1000);

  const unique = [...new Set(normalized)].sort((a, b) => a - b);
  return unique.length ? unique : [...DEFAULT_TRIGGER_MINUTES];
}

function normalizeGameMode(value) {
  const text = normalizeText(value).toUpperCase();
  if (!text) return "";

  const compact = text.replace(/[^A-Z0-9]/g, "");
  if (compact.includes("RANDOMADVANCEANDSECURE")) return "RAAS";
  if (compact.includes("ADVANCEANDSECURE")) return "AAS";

  const tokens = text.split(/[^A-Z0-9]+/).filter(Boolean);
  if (tokens.includes("RAAS")) return "RAAS";
  if (tokens.includes("AAS")) return "AAS";

  return "";
}

function normalizePlayerTarget(player = {}) {
  const identity = player?.identity ?? {};
  return {
    targetName: normalizeText(player?.name ?? player?.playerName ?? identity.name),
    targetPlayerId: normalizeIdentifier(
      player?.playerID
      ?? player?.playerId
      ?? identity.playerID
      ?? identity.playerId,
    ),
    targetSteamId: normalizeIdentifier(
      player?.steamID
      ?? player?.steamId
      ?? player?.steam64ID
      ?? identity.steamID
      ?? identity.steamId,
    ),
    targetEosId: normalizeIdentifier(
      player?.eosID
      ?? player?.eosId
      ?? identity.eosID
      ?? identity.eosId,
    ),
  };
}

function normalizeIdentifier(value) {
  const text = normalizeText(value);
  return text && text !== "N/A" ? text : "";
}

function normalizeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
