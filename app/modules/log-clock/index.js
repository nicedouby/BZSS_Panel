// -*- coding: utf-8 -*-

/**
 * Module: LogClock
 *
 * Watches RawLog lines and resets core.webStatus.logClock when a match anchor log appears.
 *
 * Default anchor (inherited from MicePanel):
 * - LogWorld: SeamlessTravel to: ...
 */
const WORLD_BRING_UP_GAME_MODES = new Set([
  "AAS",
  "RAAS",
  "INVASION",
  "SEED",
  "SKIRMISH",
  "TC",
  "INSURGENCY",
  "DESTRUCTION",
  "TRAINING",
]);

export function createLogClockModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.logClock",
    source: "module.logClock",
    channel: "module",
  }) ?? core.logger;
  const moduleConfig = config?.get?.("modules.logClock", {}) ?? {};
  const enabled = moduleConfig.enabled !== false;
  const resetPattern = String(moduleConfig.resetPattern ?? "LogWorld:\\s+SeamlessTravel to:\\s+.+$");
  const resetRegex = safeRegex(resetPattern, "i");
  const unsubscribers = [];

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.("module.logClock") !== false
      && core.pluginSubscriptions?.isSubscribed?.("module.logClock") !== false;
  }

  function handleRawLogLine(event) {
    if (!enabled) return;
    if (!isSubscribed()) return;
    if (isReplayEvent(event)) return;
    if (event?.eventName !== "On_RawLogLine") return;
    if (!resetRegex) return;

    const raw = String(event.rawLog ?? event.rawEvent?.Raw ?? "");
    if (!raw) return;

    if (!resetRegex.test(raw)) return;

    core.webStatus.resetLogClock({
      reason: "seamlessTravel",
      anchorLogTime: event.logTime ?? "",
      anchorRawLog: raw,
    });

    moduleLogger.info(() => "LogClock anchored by SeamlessTravel. Reset to 0.", {
      operation: "anchor",
      eventName: event.eventName,
      data: {
        logTime: event.logTime ?? "",
      },
    });
  }

  function handleWorldBringUp(event) {
    if (!enabled) return;
    if (!isSubscribed()) return;
    if (isReplayEvent(event)) return;
    if (event?.eventName !== "round.world_bring_up") return;

    const round = event?.normalized?.roundWorldBringUp
      ?? resolveRoundWorldBringUpFromParamMap(event);

    core.webStatus.resetLogClock({
      reason: "worldBringUp",
      anchorLogTime: round?.logLineTime || event?.logTime || "",
      anchorRawLog: event?.rawLog || round?.rawLog || "",
    });

    moduleLogger.info(
      `[ROUND] LogClock anchored by WorldBringUp. Reset to 0. layer=${round?.layerName || "unknown"} map=${round?.mapName || "unknown"} mode=${round?.gameMode || "unknown"}`,
      {
        operation: "anchor",
        eventName: event?.eventName,
        data: {
          logLineTime: round?.logLineTime || "",
          layerName: round?.layerName || "",
          mapName: round?.mapName || "",
          gameMode: round?.gameMode || "",
        },
      },
    );
  }

  return {
    manifest: {
      id: "module.logClock",
      name: "Log Clock Module",
      kind: "module",
      version: "0.1.0",
      description: "监听 RawLog 日志锚点（默认 SeamlessTravel），用于重置顶栏的「日志时间」。",
    },
    apiName: "logClock",
    api: {
      getSeconds() {
        return core.webStatus.logClock.getSeconds();
      },
      setSeconds(seconds) {
        return core.webStatus.setLogClockSeconds(seconds, { reason: "manual" });
      },
      reset() {
        return core.webStatus.resetLogClock({ reason: "manualReset" });
      },
    },

    async start() {
      if (!enabled) {
        moduleLogger.info("LogClock module disabled by config.", { operation: "start" });
        return;
      }

      if (!core.eventBus?.onCoreEvent) return;
      unsubscribers.push(core.eventBus.onCoreEvent("On_RawLogLine", handleRawLogLine));
      unsubscribers.push(core.eventBus.onCoreEvent("round.world_bring_up", handleWorldBringUp));
      moduleLogger.info("LogClock module started.", {
        operation: "start",
        data: {
          resetPattern,
        },
      });
    },

    async stop() {
      for (const un of unsubscribers.splice(0)) {
        try { un(); } catch {}
      }
    },
  };
}

// Startup recovery replays recent LogPost rows. Those historical anchors are
// useful to restore state elsewhere, but must not reset the LogClock's
// intentional 10-minute boot fallback.
function isReplayEvent(event) {
  return Boolean(event?.isReplay || event?.fileBridgeReplay);
}

function resolveRoundWorldBringUpFromParamMap(event) {
  const paramMap = event?.paramMap && typeof event.paramMap === "object" ? event.paramMap : {};
  const logLineTime = stringParam(paramMap, "logLineTime") || stringParam(paramMap, "LogLineTime");
  const worldPath = stringParam(paramMap, "worldPath") || stringParam(paramMap, "WorldPath");
  const layerName = stringParam(paramMap, "layerName") || extractLayerName(worldPath);
  const mapName = stringParam(paramMap, "mapName") || inferMapName(layerName);
  const gameMode = stringParam(paramMap, "gameMode") || inferGameMode(layerName);

  return {
    logLineTime,
    rawLog: String(event?.rawLog ?? ""),
    layerName,
    mapName,
    gameMode,
  };
}

function stringParam(paramMap, key) {
  const value = paramMap?.[key];
  return value == null ? "" : String(value);
}

function extractLayerName(worldPath) {
  const text = String(worldPath ?? "").trim();
  if (!text) return "";
  const lastSegment = text.split("/").filter(Boolean).pop() || "";
  return lastSegment.split(".")[0].trim();
}

function inferMapName(layerName) {
  const text = String(layerName ?? "").trim();
  if (!text) return "";

  const tokens = text.split("_").filter(Boolean);
  if (tokens.length < 2) return "";

  let end = tokens.length;
  while (end > 0 && isVersionToken(tokens[end - 1])) {
    end -= 1;
  }

  for (let index = end - 1; index > 0; index -= 1) {
    if (WORLD_BRING_UP_GAME_MODES.has(tokens[index].toUpperCase())) {
      return tokens.slice(0, index).join("_");
    }
  }

  return "";
}

function inferGameMode(layerName) {
  const text = String(layerName ?? "").trim();
  if (!text) return "";

  const tokens = text.split("_").filter(Boolean);
  if (tokens.length < 2) return "";

  let end = tokens.length;
  while (end > 0 && isVersionToken(tokens[end - 1])) {
    end -= 1;
  }

  for (let index = end - 1; index > 0; index -= 1) {
    if (WORLD_BRING_UP_GAME_MODES.has(tokens[index].toUpperCase())) {
      return tokens[index];
    }
  }

  return "";
}

function isVersionToken(token) {
  return /^\d+(?:\.\d+)*$/.test(String(token ?? "").trim());
}

function safeRegex(pattern, flags) {
  const text = String(pattern ?? "").trim();
  if (!text) return null;

  try {
    return new RegExp(text, flags);
  } catch {
    return null;
  }
}
