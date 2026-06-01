// -*- coding: utf-8 -*-

/**
 * Module: KillManage
 *
 * Deprecated compatibility shim.
 * Real combat ingestion lives in combatState -> combatClean -> combatManager.
 */
export function createKillManageModule({ core, modules, logger }) {
  const unsubscribers = [];
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.killManage",
    source: "module.killManage",
    channel: "module",
  }) ?? core.logger;

  function forwardLegacyCombatEvent(event = {}) {
    const record = event?.record ?? null;
    if (!record) return;

    const payload = {
      ...event,
      layer: "module",
      source: "module.killManage",
      eventName: "module.killManage.combatResolved",
      record,
    };

    core.eventBus?.emitModuleEvent?.("module.killManage", "combatResolved", payload);

    if (record.isFriendlyFire) {
      core.eventBus?.emitModuleEvent?.("module.killManage", "friendlyFireResolved", {
        ...payload,
        eventName: "module.killManage.friendlyFireResolved",
      });
    }

    if (record.isTeamKill) {
      core.eventBus?.emitModuleEvent?.("module.killManage", "teamKillResolved", {
        ...payload,
        eventName: "module.killManage.teamKillResolved",
      });
    }
  }

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.("module.killManage") !== false;
  }

  const api = {
    getRecentKills(serverId, limit = 50) {
      return modules?.combatManager?.getRecentKills?.(serverId, limit) ?? [];
    },
  };

  return {
    manifest: {
      id: "module.killManage",
      name: "Kill Manage Module",
      kind: "module",
      version: "0.1.0",
      hidden: true,
      deprecated: true,
      description: "Deprecated compatibility shim. Keeps legacy kill-manage API and events available while combatManager owns combat handling.",
    },
    apiName: "killManage",
    api,

    async start() {
      if (!core.eventBus?.onModuleEvent) {
        moduleLogger?.info?.("KillManage compatibility shim started without event bus.");
        return;
      }

      unsubscribers.push(
        core.eventBus.onModuleEvent("module.combatManager", "KILL_MANAGER_EVENT", (event) => {
          if (!isSubscribed()) return;
          forwardLegacyCombatEvent(event);
        }),
      );

      moduleLogger?.info?.("KillManage compatibility shim started.", {
        operation: "start",
      });
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe?.();
        } catch {}
      }
      moduleLogger?.info?.("KillManage compatibility shim stopped.", {
        operation: "stop",
      });
    },
  };
}

export default createKillManageModule;
