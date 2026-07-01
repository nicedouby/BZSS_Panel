// -*- coding: utf-8 -*-

const MODULE_ID = "module.squadFollowWarning";
const DEFAULT_RECENT_LIMIT = 100;

export function createSquadFollowWarningModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: MODULE_ID,
    source: MODULE_ID,
    channel: "module",
  }) ?? core.logger;

  const moduleConfig = config?.get?.("modules.squadFollowWarning", {}) ?? {};
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const recentLimit = Math.max(1, Number(moduleConfig.recentLimit ?? DEFAULT_RECENT_LIMIT));
  const exitMessage = String(moduleConfig.exitMessage ?? "已为你关闭伤害显示。\n 你脱离了你的队长。请立即回到队长身边").trim();
  const enterMessage = String(moduleConfig.enterMessage ?? "已为你打开伤害显示。\n 团队合作才能胜利。保持在你的队长身边").trim();

  const unsubscribers = [];
  const recentWarnings = [];

  const api = {
    getState() {
      return {
        enabled,
        recentWarnings: recentWarnings.slice().reverse(),
        stats: {
          warnings: recentWarnings.length,
        },
      };
    },
  };

  return {
    manifest: {
      id: MODULE_ID,
      name: "Squad Follow Warning Module",
      kind: "module",
      version: "0.1.0",
      hidden: true,
      description: "Subscribes to squad follow radius transitions and warns the affected player.",
    },
    apiName: "squadFollowWarning",
    api,

    start() {
      if (!enabled) {
        moduleLogger?.info?.("Squad follow warning module disabled.");
        return;
      }

      if (typeof core.eventBus?.onModuleEvent !== "function") {
        moduleLogger?.warn?.("Squad follow warning module cannot subscribe: eventBus.onModuleEvent unavailable.");
        return;
      }

      unsubscribers.push(
        core.eventBus.onModuleEvent("module.squadFollowState", "playerExitedLeaderRadius", (event) => {
          void handleTransition("exit", event);
        }),
      );
      unsubscribers.push(
        core.eventBus.onModuleEvent("module.squadFollowState", "playerEnteredLeaderRadius", (event) => {
          void handleTransition("enter", event);
        }),
      );

      moduleLogger?.info?.("Squad follow warning module started.");
    },

    stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe();
        } catch { }
      }

      moduleLogger?.info?.("Squad follow warning module stopped.");
    },
  };

  async function handleTransition(type, event) {
    if (!enabled) return;

    const payload = event?.payload ?? event ?? {};
    const player = payload?.player ?? {};
    const targetName = String(player?.name ?? "").trim();
    if (!targetName) {
      moduleLogger?.debug?.("Squad follow warning skipped: missing player name.", {
        operation: "squadFollowWarningSkipped",
      });
      return;
    }

    const sender = modules?.adminWarn?.sendAdminWarn ?? modules?.adminWarn?.warnPlayer;
    if (typeof sender !== "function") {
      moduleLogger?.warn?.("Squad follow warning skipped: adminWarn unavailable.");
      return;
    }

    const message = type === "exit" ? exitMessage : enterMessage;
    if (!message) return;

    const result = await sender.call(modules.adminWarn, {
      targetName,
      targetSteamId: String(player?.steamID ?? player?.steamId ?? "").trim() || undefined,
      message,
      reason: `squad_follow_warning_${type}`,
      sourceModule: MODULE_ID,
      relatedEventId: String(payload?.eventId ?? ""),
      system: true,
    });

    rememberWarning({
      id: `${MODULE_ID}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
      type,
      serverId: String(payload?.serverId ?? ""),
      targetName,
      targetSteamId: String(player?.steamID ?? player?.steamId ?? "").trim(),
      message,
      success: Boolean(result?.success),
      skipped: Boolean(result?.skipped),
      skipReason: String(result?.skipReason ?? ""),
      commandText: String(result?.commandText ?? ""),
      relatedEventId: String(payload?.eventId ?? ""),
      createdAt: new Date().toISOString(),
    });
  }

  function rememberWarning(record) {
    recentWarnings.push(record);
    if (recentWarnings.length > recentLimit) {
      recentWarnings.splice(0, recentWarnings.length - recentLimit);
    }
  }
}
