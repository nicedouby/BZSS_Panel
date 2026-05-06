// -*- coding: utf-8 -*-

/**
 * Module: Console
 *
 * Web 控制台的数据源。
 *
 * 设计目标：
 * - 支持频道 channel
 * - 支持服务端筛选，避免前端一次性拿太多日志
 * - 支持 afterSeq 增量获取，提高性能
 * - 支持执行手动 RCON，并把请求/响应写入 rcon 频道
 */

const DEFAULT_CHANNELS = [
  { id: "all", title: "全部" },
  { id: "system", title: "系统" },
  { id: "events", title: "事件" },
  { id: "rcon", title: "RCON" },
  { id: "python", title: "Python" },
  { id: "error", title: "错误" },
];

export function createConsoleModule({ core, config }) {
  const maxLines = Number(config.get("modules.console.maxLines", 5000));
  const store = new RingLogStore(maxLines);
  const unsubscribers = [];

  function push(channel, level, message, extra = {}) {
    const line = store.push({
      channel,
      level,
      time: new Date().toISOString(),
      message: String(message ?? ""),
      ...extra,
    });

    return line;
  }

  const api = {
    getChannels() {
      const observed = store.getObservedChannels()
        .filter((id) => !DEFAULT_CHANNELS.some((c) => c.id === id))
        .map((id) => ({ id, title: id }));

      return [...DEFAULT_CHANNELS, ...observed];
    },

    getLines(options = {}) {
      return store.query({
        channel: options.channel ?? "all",
        afterSeq: Number(options.afterSeq ?? 0),
        limit: Number(options.limit ?? 300),
        q: String(options.q ?? ""),
      });
    },

    push,

    async executeRconCommand(command, meta = {}) {
      const commandText = String(command ?? "").trim();

      if (!commandText) {
        return {
          success: false,
          message: "Command is empty.",
          rconResponse: "",
        };
      }

      push("rcon", "input", `> ${commandText}`, {
        owner: meta.requestedBy ?? "web.console",
      });

      const result = await core.rconManager.dispatchCommand({
        command: commandText,
        requestedBy: meta.requestedBy ?? "web.console",
        reason: meta.reason ?? "Manual RCON command from web console",
      });

      if (result.success) {
        push("rcon", "output", result.rconResponse || "(empty response)", {
          command: commandText,
        });
      } else {
        push("rcon", "error", result.message, {
          command: commandText,
        });
      }

      return result;
    },
  };

  return {
    manifest: { id: "module.console", name: "Console Module", kind: "module", version: "0.2.0" },
    apiName: "console",
    api,

    async start() {
      push("system", "info", "Console module started.");

      unsubscribers.push(core.eventBus.onCoreEvent("*", (event) => {
        const channel = getChannelForCoreEvent(event.eventName);
        const level = channel === "error" ? "error" : "event";

        push(channel, level, event.eventName, {
          eventId: event.eventId,
          serverId: event.serverId,
          source: event.source,
        });
      }));
    },

    async stop() {
      for (const un of unsubscribers) un();
      push("system", "warn", "Console module stopped.");
    },
  };
}

function getChannelForCoreEvent(eventName) {
  if (eventName === "RCON_ERROR" || eventName === "RCON_DISCONNECTED") return "error";
  if (eventName.startsWith("RCON_") || eventName === "CHAT_MESSAGE") return "rcon";
  return "events";
}

class RingLogStore {
  constructor(maxLines) {
    this.maxLines = Math.max(100, Number(maxLines) || 5000);
    this.buffer = new Array(this.maxLines);
    this.nextIndex = 0;
    this.size = 0;
    this.seq = 0;
    this.observedChannels = new Set();
  }

  push(line) {
    this.seq += 1;

    const item = {
      seq: this.seq,
      ...line,
    };

    this.buffer[this.nextIndex] = item;
    this.nextIndex = (this.nextIndex + 1) % this.maxLines;
    this.size = Math.min(this.size + 1, this.maxLines);
    this.observedChannels.add(item.channel);

    return item;
  }

  query({ channel = "all", afterSeq = 0, limit = 300, q = "" }) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 300, 1000));
    const queryText = String(q ?? "").trim().toLowerCase();
    const result = [];

    for (const item of this.iterOldestToNewest()) {
      if (!item) continue;
      if (afterSeq > 0 && item.seq <= afterSeq) continue;
      if (channel !== "all" && item.channel !== channel) continue;

      if (queryText) {
        const haystack = `${item.channel} ${item.level} ${item.message} ${item.eventId ?? ""} ${item.source ?? ""}`.toLowerCase();
        if (!haystack.includes(queryText)) continue;
      }

      result.push(item);

      if (result.length > safeLimit) {
        result.shift();
      }
    }

    return result;
  }

  getObservedChannels() {
    return [...this.observedChannels].sort();
  }

  *iterOldestToNewest() {
    for (let i = 0; i < this.size; i++) {
      const idx = (this.nextIndex - this.size + i + this.maxLines) % this.maxLines;
      yield this.buffer[idx];
    }
  }
}
