// -*- coding: utf-8 -*-

const DEFAULT_STREAMS = [
  { id: "raw-log", title: "Raw Log" },
  { id: "modules", title: "模块日志" },
  { id: "rcon-native", title: "RCON 原生" },
];

const DEFAULT_LEVELS = [
  { id: "all", title: "全部级别" },
  { id: "debug", title: "Debug" },
  { id: "info", title: "Info" },
  { id: "warn", title: "Warn" },
  { id: "error", title: "Error" },
  { id: "input", title: "Input" },
  { id: "output", title: "Output" },
  { id: "push", title: "Push" },
  { id: "status", title: "Status" },
];

export function createConsoleModule({ core, config }) {
  const logger = core.createLogger?.({
    moduleId: "module.console",
    source: "module.console",
    channel: "module",
  }) ?? core.logger;
  const maxLines = Number(config.get("modules.console.maxLines", 5000));
  const store = new RingLogStore(maxLines);
  const unsubscribers = [];

  function getHiddenScopeIds() {
    const ids = new Set([
      "module.squadDisband",
      "module.squadKick",
      "module.squadRemove",
    ]);

    for (const instance of core.moduleManager?.instances ?? []) {
      if (!instance?.manifest) continue;
      if (!instance.manifest.hidden && !instance.manifest.deprecated) continue;
      const id = String(instance.manifest.id ?? "").trim();
      if (id) ids.add(id);
    }

    return ids;
  }

  function shouldHideScope(scope) {
    return getHiddenScopeIds().has(String(scope ?? "").trim());
  }

  function push(line) {
    return store.push({
      time: line.time || new Date().toISOString(),
      stream: line.stream || "modules",
      channel: line.channel || line.stream || "modules",
      level: line.level || "info",
      message: String(line.message ?? ""),
      scope: String(line.scope ?? line.moduleId ?? line.source ?? ""),
      source: String(line.source ?? line.moduleId ?? ""),
      moduleId: String(line.moduleId ?? ""),
      eventName: String(line.eventName ?? ""),
      operation: String(line.operation ?? ""),
      label: String(line.label ?? ""),
      tags: Array.isArray(line.tags) ? line.tags.map((item) => String(item)) : [],
      dataSummary: String(line.dataSummary ?? ""),
      ...line,
    });
  }

  const api = {
    getChannels(options = {}) {
      const stream = String(options.stream ?? "modules");
      const observedScopes = store.getObservedScopes(stream)
        .filter((id) => !shouldHideScope(id))
        .map((id) => ({ id, title: id }));

      return {
        streams: DEFAULT_STREAMS.map((item) => ({ ...item })),
        scopes: [{ id: "all", title: stream === "rcon-native" ? "全部来源" : "全部模块" }, ...observedScopes],
        levels: DEFAULT_LEVELS.map((item) => ({ ...item })),
      };
    },

    getLines(options = {}) {
      return store.query({
        stream: options.stream ?? "modules",
        scope: options.scope ?? "all",
        level: options.level ?? "all",
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

        push({
          stream: "rcon-native",
          channel: "rcon-native",
          level: "error",
          message: result.message,
          scope: meta.requestedBy ?? "web.console",
          source: meta.requestedBy ?? "web.console",
          moduleId: "module.console",
        });

        return result;
      }

      logger.debug(() => `Dispatching manual RCON command: ${commandText}`, {
        operation: "executeRconCommand",
        data: {
          requestedBy: meta.requestedBy ?? "web.console",
          command: commandText,
        },
      });

      const result = await core.rconManager.dispatchCommand({
        command: commandText,
        requestedBy: meta.requestedBy ?? "web.console",
        reason: meta.reason ?? "Manual RCON command from web console",
      });

      if (result.success) {
        const lines = String(result.message || "Command executed successfully.").split(/\r?\n/);
        for (const line of lines) {
          if (!line.trim() && lines.length > 1) continue;
          push({
            stream: "rcon-native",
            channel: "rcon-native",
            level: "info",
            message: line,
            scope: meta.requestedBy ?? "web.console",
            source: meta.requestedBy ?? "web.console",
            moduleId: "module.console",
            command: commandText,
            label: "Output",
          });
        }
        
        // Also push to modules stream for visibility
        push({
          stream: "modules",
          channel: "rcon",
          level: "info",
          message: `Executed RCON: ${commandText}`,
          scope: "WebConsole",
          label: "RCON",
        });
      } else {
        const lines = String(result.message || "Unknown error").split(/\r?\n/);
        for (const line of lines) {
          if (!line.trim() && lines.length > 1) continue;
          push({
            stream: "rcon-native",
            channel: "rcon-native",
            level: "error",
            message: line,
            scope: meta.requestedBy ?? "web.console",
            source: meta.requestedBy ?? "web.console",
            moduleId: "module.console",
            command: commandText,
            label: "Error",
          });
        }
      }

      return result;
    },
  };

  return {
    manifest: {
      id: "module.console",
      name: "Console Module",
      kind: "module",
      version: "0.4.0",
      description: "控制台日志聚合与 RCON 转发模块。",
    },
    apiName: "console",
    api,

    async start() {
      unsubscribers.push(core.logger.subscribe((entry) => {
        if (entry.stream !== "app") return;

        push({
          stream: "modules",
          channel: entry.channel || "module",
          level: entry.level,
          time: entry.time,
          message: entry.message,
          scope: entry.scope || entry.moduleId || entry.source || "app",
          source: entry.source,
          moduleId: entry.moduleId,
          eventName: entry.eventName,
          operation: entry.operation,
          label: entry.label,
          tags: entry.tags,
          dataSummary: summarizeData(entry.data),
        });
      }, { minLevel: "debug" }));

      if (core.rconManager?.onNativeLog) {
        unsubscribers.push(core.rconManager.onNativeLog((line) => {
          push({
            stream: "rcon-native",
            channel: "rcon-native",
            level: line.level || "info",
            message: line.message,
            command: line.command,
            host: line.host,
            port: line.port,
            reason: line.reason,
            source: line.source || "core.rconManager",
            moduleId: "core.rconManager",
            scope: line.source || "core.rconManager",
            nativeKind: line.kind,
            time: line.time || new Date().toISOString(),
            dataSummary: summarizeNativeLine(line),
            isTeamKill: Boolean(line.isTeamKill || line.tk),
            tags: Array.isArray(line.tags) ? line.tags : [],
          });
        }));
      }

      if (core.eventBus?.onCoreEvent) {
        unsubscribers.push(core.eventBus.onCoreEvent("*", (event) => {
          if (event?.eventName === "On_RawLogLine") {
            const rawSource = getEventParam(event, "Source") || "Squad.log";
            const rawChannel = getEventParam(event, "Channel") || extractChannel(event.rawLog ?? event.rawEvent?.Raw ?? "");

            push({
              stream: "raw-log",
              channel: rawChannel || "raw-log",
              level: event.rawEvent?.RawTruncated === "true" ? "warn" : "info",
              time: event.time || new Date().toISOString(),
              message: event.rawLog ?? event.rawEvent?.Raw ?? "",
              scope: rawChannel || rawSource,
              source: rawSource,
              moduleId: "logpost.raw",
              eventName: event.eventName,
              logTime: event.logTime,
              rawChannel,
              rawSource,
              rawTruncated: event.rawEvent?.RawTruncated === "true",
            });
            return;
          }

          if (event?.eventName === "CHAT_MESSAGE") {
            const p = event.payload || {};
            push({
              stream: "modules",
              channel: "chat",
              level: "info",
              time: event.time,
              message: `[${p.channel}] ${p.name}: ${p.message}`,
              scope: p.channel || "Chat",
              label: "Chat",
              tags: ["chat", p.channel?.toLowerCase()].filter(Boolean),
              playerName: p.name,
              steamID: p.steamid,
              eosID: p.eosid,
            });
            return;
          }

          if (event?.eventName === "TEAM_KILL") {
            const p = event.payload || {};
            push({
              stream: "modules",
              channel: "rcon",
              level: "warn",
              time: event.time,
              message: `TEAM KILL: ${p.killerName} killed ${p.victimName}`,
              scope: "TeamKill",
              label: "TK",
              tags: ["tk"],
              killerName: p.killerName,
              victimName: p.victimName,
            });
            return;
          }

          if (["SQUAD_CREATED", "POSSESSED_ADMIN_CAM", "UNPOSSESSED_ADMIN_CAM"].includes(event?.eventName)) {
            push({
              stream: "modules",
              channel: "rcon",
              level: "info",
              time: event.time,
              message: `${event.eventName}: ${JSON.stringify(event.payload)}`,
              scope: "RCON",
              label: "Event",
            });
          }
        }));
      }

      logger.info("Console module started.", {
        operation: "start",
        data: {
          maxLines,
        },
      });
    },

    async stop() {
      logger.info("Console module stopping.", {
        operation: "stop",
      });

      for (const un of unsubscribers.splice(0)) {
        try {
          un();
        } catch {}
      }
    },
  };
}

function summarizeData(data) {
  if (!data || typeof data !== "object") {
    return "";
  }

  if (typeof data.listenerCount === "number") {
    return `listeners=${data.listenerCount}`;
  }

  if (typeof data.players === "number") {
    return `players=${data.players}`;
  }

  if (typeof data.squads === "number") {
    return `squads=${data.squads}`;
  }

  if (typeof data.command === "string" && data.command) {
    return clipText(data.command, 96);
  }

  return clipText(safeJson(data), 180);
}

function summarizeNativeLine(line) {
  if (line.command) {
    return clipText(String(line.command), 120);
  }

  if (line.reason) {
    return clipText(String(line.reason), 120);
  }

  return "";
}

function getEventParam(event, name) {
  if (event?.paramMap && event.paramMap[name] != null) return String(event.paramMap[name]);

  if (Array.isArray(event?.params)) {
    const param = event.params.find((item) => item?.name === name);
    if (param) return String(param.value ?? "");
  }

  return "";
}

function extractChannel(line) {
  const match = String(line ?? "").match(/\b(Log[A-Za-z0-9_]+)\s*:/);
  return match ? match[1] : "";
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function clipText(value, maxLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
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
    this.observedScopesByStream = new Map();
  }

  push(line) {
    this.seq += 1;

    const item = {
      seq: this.seq,
      ...line,
    };

    item.searchText = buildSearchText(item);

    this.buffer[this.nextIndex] = item;
    this.nextIndex = (this.nextIndex + 1) % this.maxLines;
    this.size = Math.min(this.size + 1, this.maxLines);

    if (!this.observedScopesByStream.has(item.stream)) {
      this.observedScopesByStream.set(item.stream, new Set());
    }
    if (item.scope) {
      this.observedScopesByStream.get(item.stream).add(item.scope);
    }

    return item;
  }

  query({ stream = "modules", scope = "all", level = "all", afterSeq = 0, limit = 300, q = "" }) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 300, 1000));
    const queryText = String(q ?? "").trim().toLowerCase();
    const result = [];

    for (const item of this.iterOldestToNewest()) {
      if (!item) continue;
      if (afterSeq > 0 && item.seq <= afterSeq) continue;
      if (stream !== "all" && item.stream !== stream) continue;
      if (scope !== "all" && item.scope !== scope) continue;
      if (level !== "all" && item.level !== level) continue;
      if (queryText && !item.searchText.includes(queryText)) continue;

      result.push(stripSearchText(item));
      if (result.length > safeLimit) {
        result.shift();
      }
    }

    return result;
  }

  getObservedScopes(stream = "modules") {
    return [...(this.observedScopesByStream.get(stream) ?? new Set())].sort();
  }

  *iterOldestToNewest() {
    for (let i = 0; i < this.size; i++) {
      const idx = (this.nextIndex - this.size + i + this.maxLines) % this.maxLines;
      yield this.buffer[idx];
    }
  }
}

function buildSearchText(item) {
  return [
    item.stream,
    item.channel,
    item.level,
    item.message,
    item.scope,
    item.source,
    item.moduleId,
    item.eventName,
    item.operation,
    item.command,
    item.dataSummary,
    ...(Array.isArray(item.tags) ? item.tags : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function stripSearchText(item) {
  const { searchText, ...rest } = item;
  return rest;
}
