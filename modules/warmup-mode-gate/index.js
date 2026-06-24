// -*- coding: utf-8 -*-

const MODULE_ID = "module.warmupModeGate";
const DEFAULT_MAX_PLAYERS = 40;
const DEFAULT_MIN_PLAYERS = 1;

export function createWarmupModeGateModule({ core, config, logger }) {
  const moduleLogger =
    logger ??
    core.createLogger?.({
      moduleId: MODULE_ID,
      source: MODULE_ID,
      channel: "module",
    }) ??
    core.logger;

  function readSettings() {
    const warmupMode = config?.get?.("warmupMode", null);
    const warmup = config?.get?.("warmup", null);
    const source =
      (warmupMode && typeof warmupMode === "object" ? warmupMode : null) ??
      (warmup && typeof warmup === "object" ? warmup : null) ??
      {};
    return {
      enabled: Boolean(source.enabled ?? false),
      source: String(source.source ?? "auto"),
      maxPlayers: Math.max(1, Number(source.maxPlayers ?? DEFAULT_MAX_PLAYERS) || DEFAULT_MAX_PLAYERS),
      minPlayers: Math.max(0, Number(source.minPlayers ?? DEFAULT_MIN_PLAYERS) || DEFAULT_MIN_PLAYERS),
      requireLiveMatch: source.requireLiveMatch !== false,
      ignoreAdminManualOverride: Boolean(source.ignoreAdminManualOverride ?? false),
      countSpectators: Boolean(source.countSpectators ?? false),
      countAdmins: Boolean(source.countAdmins ?? true),
    };
  }

  function evaluate() {
    const settings = readSettings();
    const snapshot = core.webStatus?.getSnapshot?.() ?? core.webStatus?.state ?? {};
    const playerCount = Number(snapshot.playerCount ?? 0) || 0;
    const globalWarmupEnabled = Boolean(snapshot.isWarmup);
    if (!settings.enabled && !globalWarmupEnabled) {
      return { active: false, reason: "plugin_disabled", playerCount, settings };
    }
    if (playerCount > settings.maxPlayers) {
      return { active: false, reason: "player_count_above_threshold", playerCount, settings };
    }
    if (playerCount < settings.minPlayers) {
      return { active: false, reason: "player_count_below_threshold", playerCount, settings };
    }
    if (settings.requireLiveMatch && String(snapshot.matchState ?? "").toLowerCase() === "unknown") {
      return { active: false, reason: "no_live_match", playerCount, settings };
    }
    return { active: true, reason: "player_count_below_threshold", playerCount, settings };
  }

  return {
    manifest: {
      id: MODULE_ID,
      name: "Warmup Mode Gate",
      kind: "module",
      version: "0.1.0",
      description: "Evaluates whether the server is currently in a warmup window for reserve exchange accumulation.",
    },
    apiName: "warmupModeGate",
    api: {
      getState() {
        return evaluate();
      },
      evaluate,
    },
    async start() {
      moduleLogger?.info?.("[WarmupModeGate] started.");
    },
    async stop() {
      moduleLogger?.info?.("[WarmupModeGate] stopped.");
    },
  };
}
