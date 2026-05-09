// -*- coding: utf-8 -*-

/**
 * Module: LogClock
 *
 * Watches RawLog lines and resets core.webStatus.logClock when a match anchor log appears.
 *
 * Default anchor (inherited from MicePanel):
 * - LogWorld: SeamlessTravel to: ...
 */
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

function safeRegex(pattern, flags) {
  const text = String(pattern ?? "").trim();
  if (!text) return null;

  try {
    return new RegExp(text, flags);
  } catch {
    return null;
  }
}

