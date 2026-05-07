// -*- coding: utf-8 -*-

/**
 * Module: ServerStatus
 *
 * 统一消费服务端状态类事件，并写入 WebStatus。
 */
export function createServerStatusModule({ core }) {
  const unsubscribers = [];

  return {
    manifest: { id: "module.serverStatus", name: "Server Status Module", kind: "module", version: "0.1.0" },
    apiName: "serverStatus",
    api: {},

    async start() {
      unsubscribers.push(core.eventBus.onCoreEvent("On_ServerTickRateUpdated", (event) => {
        const metric = event.normalized?.serverTickRate;
        if (!metric) return;
        core.webStatus.applyServerTickRateUpdate(metric);
      }));
    },

    async stop() {
      for (const unsubscribe of unsubscribers) unsubscribe();
    },
  };
}
