// -*- coding: utf-8 -*-

/**
 * Module: Console
 *
 * Web 控制台的数据源。
 *
 * 设计目标：
 * - 把事件分发器视图与 RCON 原生视图拆开
 * - 支持按 channel 查询
 * - 支持 afterSeq 增量拉取
 * - 支持手动执行 RCON
 */

const DEFAULT_CHANNELS = [
  { id: "all", title: "全部" },
  { id: "dispatcher", title: "事件分发器" },
  { id: "rcon-native", title: "RCON 原生" },
  { id: "system", title: "系统" },
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
        const result = {
          success: false,
          message: "RCON command is empty.",
          rconResponse: "",
        };

        push("rcon-native", "error", result.message, {
          owner: meta.requestedBy ?? "web.console",
        });

        return result;
      }

      const result = await core.rconManager.dispatchCommand({
        command: commandText,
        requestedBy: meta.requestedBy ?? "web.console",
        reason: meta.reason ?? "Manual RCON command from web console",
      });

      if (!result.success) {
        push("rcon-native", "error", result.message, {
          owner: meta.requestedBy ?? "web.console",
          command: commandText,
        });
      }

      return result;
    },
  };

  return {
    manifest: { id: "module.console", name: "Console Module", kind: "module", version: "0.3.0" },
    apiName: "console",
    api,

    async start() {
      push("system", "info", "Console module started.");

      if (core.rconManager?.onNativeLog) {
        unsubscribers.push(core.rconManager.onNativeLog((line) => {
          push("rcon-native", line.level || "info", line.message, {
            command: line.command,
            host: line.host,
            port: line.port,
            reason: line.reason,
            source: "core.rconManager",
            nativeKind: line.kind,
            time: line.time || new Date().toISOString(),
          });
        }));
      }

      unsubscribers.push(core.eventBus.onCoreEvent("*", (event) => {
        push("dispatcher", getDispatcherLevel(event), formatDispatcherMessage(event), {
          eventId: event.eventId,
          eventName: event.eventName,
          serverId: event.serverId,
          source: event.source,
          time: event.time || new Date().toISOString(),
        });
      }));
    },

    async stop() {
      for (const un of unsubscribers.splice(0)) {
        try {
          un();
        } catch {}
      }

      push("system", "warn", "Console module stopped.");
    },
  };
}

function getDispatcherLevel(event) {
  const name = String(event?.eventName ?? "");
  if (name === "RCON_ERROR" || name === "RCON_DISCONNECTED") return "error";
  return "event";
}

function formatDispatcherMessage(event) {
  const eventName = String(event?.eventName ?? "UnknownEvent");
  const details = summarizeDispatcherEvent(event);
  return details ? `${eventName} | ${details}` : eventName;
}

function summarizeDispatcherEvent(event) {
  if (Array.isArray(event?.players)) {
    return `players=${event.players.length}`;
  }

  if (Array.isArray(event?.squads)) {
    return `squads=${event.squads.length}`;
  }

  if (event?.payload && typeof event.payload === "object" && !Array.isArray(event.payload)) {
    return safeJson(event.payload, 420);
  }

  if (Array.isArray(event?.params) && event.params.length > 0) {
    const values = event.params
      .slice(0, 6)
      .map((param) => clipText(param?.value || "-", 48));

    if (event.params.length > 6) {
      values.push(`...+${event.params.length - 6}`);
    }

    return values.join(" | ");
  }

  if (event?.rawLog) {
    return clipText(event.rawLog, 220);
  }

  return "";
}

function safeJson(value, maxLength) {
  try {
    return clipText(JSON.stringify(value), maxLength);
  } catch {
    return "[unserializable payload]";
  }
}

function clipText(value, maxLength) {
  const text = String(value ?? "").replace(/\r/g, " ").replace(/\n/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
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
        const haystack = [
          item.channel,
          item.level,
          item.message,
          item.eventId,
          item.eventName,
          item.command,
          item.source,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

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
