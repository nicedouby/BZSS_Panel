// -*- coding: utf-8 -*-

/**
 * Module: ServerStatus
 *
 * 统一消费服务端状态类事件，并写入 WebStatus。
 */
export function createServerStatusModule({ core }) {
  const unsubscribers = [];

  return {
    manifest: { id: "module.serverStatus", name: "Server Status Module", kind: "module", version: "0.1.0", description: "服务器运行指标模块。订阅 On_ServerTickRateUpdated 核心事件，将当前服务器 Tick 率写入 WebStatus 快照，供顶部状态栏和其他模块实时感知服务器健康度。当 Tick 率低于警戒阈值时，上层模块可据此降级操作以避免误判。" },
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
