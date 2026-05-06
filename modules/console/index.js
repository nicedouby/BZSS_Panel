// -*- coding: utf-8 -*-

/**
 * Module: Console
 *
 * Web 控制台的数据源。
 * 注意：它不是 Logger 本身，只是提供给 Web 查看事件流。
 */
export function createConsoleModule({ core, config }) {
  const maxLines = config.get("modules.console.maxLines", 500);
  const lines = [];
  const unsubscribers = [];

  function push(type, message, extra = {}) {
    lines.push({
      time: new Date().toISOString(),
      type,
      message,
      ...extra,
    });

    while (lines.length > maxLines) lines.shift();
  }

  const api = {
    getLines() {
      return [...lines].reverse();
    },
    push,
  };

  return {
    manifest: { id: "module.console", name: "Console Module", kind: "module", version: "0.1.0" },
    apiName: "console",
    api,

    async start() {
      unsubscribers.push(core.eventBus.onCoreEvent("*", (event) => {
        push("core-event", event.eventName, {
          eventId: event.eventId,
          serverId: event.serverId,
        });
      }));
    },

    async stop() {
      for (const un of unsubscribers) un();
    },
  };
}
