// -*- coding: utf-8 -*-

import { CONSOLE_CHANNELS, CONSOLE_LEVELS, DEFAULT_CONSOLE_LIMIT, LEGACY_STREAMS } from "./console-types.js";

const SYSTEM_LOGGER_PREFIXES = [
  "app.",
  "core.authManager",
  "core.pluginManager",
  "core.pythonLogParserManager",
  "core.rconManager",
  "core.udpEventReceiver",
  "core.webServer",
  "core.webStatus",
  "core.moduleManager",
  "core.runtimeState",
  "core.webRegistry",
];

export class ConsoleService {
  constructor({ maxEntries = DEFAULT_CONSOLE_LIMIT } = {}) {
    this.maxEntries = Math.max(100, Number(maxEntries) || DEFAULT_CONSOLE_LIMIT);
    this.buffer = [];
    this.seq = 0;
    this.subscribers = new Set();
    this.unsubscribers = [];
    this.core = null;
  }

  attachCore(core) {
    if (!core || core === this.core) {
      return this;
    }

    this.detachCore();
    this.core = core;

    if (core.logger?.subscribe) {
      this.unsubscribers.push(core.logger.subscribe((entry) => this.mirrorLoggerEntry(entry), { minLevel: "debug" }));
    }

    if (core.eventBus?.onCoreEvent) {
      this.unsubscribers.push(core.eventBus.onCoreEvent("*", (event) => this.mirrorCoreEvent(event)));
    }

    if (core.rconManager?.onNativeLog) {
      this.unsubscribers.push(core.rconManager.onNativeLog((line) => this.mirrorNativeRconLine(line)));
    }

    return this;
  }

  detachCore() {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch {}
    }
    this.core = null;
  }

  subscribe(handler) {
    if (typeof handler !== "function") {
      return () => {};
    }

    this.subscribers.add(handler);
    return () => this.subscribers.delete(handler);
  }

  unsubscribe(handler) {
    this.subscribers.delete(handler);
  }

  emit(entry) {
    const normalized = normalizeConsoleEntry(entry, ++this.seq);
    this.buffer.push(normalized);

    if (this.buffer.length > this.maxEntries) {
      this.buffer.splice(0, this.buffer.length - this.maxEntries);
    }

    for (const subscriber of [...this.subscribers]) {
      try {
        subscriber(normalized);
      } catch {}
    }

    return normalized;
  }

  rawLog(message, meta = {}) {
    return this.emit({
      channel: "raw_log",
      level: meta.level ?? "info",
      source: meta.source ?? "SquadGame.log",
      message: String(message ?? ""),
      raw: String(meta.raw ?? message ?? ""),
      payload: meta.payload ?? null,
      ts: meta.ts ?? meta.time ?? Date.now(),
      id: meta.id,
    });
  }

  event(message, meta = {}) {
    return this.emit({
      channel: "event",
      level: meta.level ?? "info",
      source: meta.source ?? "LogParser",
      message: String(message ?? ""),
      raw: meta.raw ?? null,
      payload: meta.payload ?? null,
      ts: meta.ts ?? meta.time ?? Date.now(),
      id: meta.id,
    });
  }

  rcon(message, meta = {}) {
    return this.emit({
      channel: "rcon",
      level: meta.level ?? "info",
      source: meta.source ?? "RCON",
      message: String(message ?? ""),
      raw: meta.raw ?? null,
      payload: meta.payload ?? null,
      ts: meta.ts ?? meta.time ?? Date.now(),
      id: meta.id,
    });
  }

  plugin(pluginName, message, meta = {}) {
    return this.emit({
      channel: "plugin",
      level: meta.level ?? "debug",
      source: String(pluginName ?? meta.source ?? "plugin"),
      message: String(message ?? ""),
      raw: meta.raw ?? null,
      payload: meta.payload ?? null,
      ts: meta.ts ?? meta.time ?? Date.now(),
      id: meta.id,
    });
  }

  system(message, meta = {}) {
    return this.emit({
      channel: "system",
      level: meta.level ?? "info",
      source: String(meta.source ?? "BZSS Panel"),
      message: String(message ?? ""),
      raw: meta.raw ?? null,
      payload: meta.payload ?? null,
      ts: meta.ts ?? meta.time ?? Date.now(),
      id: meta.id,
    });
  }

  getRecent({
    limit = 500,
    channel = undefined,
    level = undefined,
    source = undefined,
    keyword = undefined,
  } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 500, this.maxEntries));
    const channelFilter = normalizeOptionalText(channel);
    const levelFilter = normalizeOptionalText(level);
    const sourceFilter = normalizeOptionalText(source);
    const keywordFilter = normalizeOptionalText(keyword);

    let items = [...this.buffer];

    if (channelFilter && channelFilter !== "all") {
      items = items.filter((item) => item.channel === channelFilter);
    }

    if (levelFilter && levelFilter !== "all") {
      items = items.filter((item) => item.level === levelFilter);
    }

    if (sourceFilter && sourceFilter !== "all") {
      items = items.filter((item) => item.source === sourceFilter);
    }

    if (keywordFilter) {
      items = items.filter((item) => {
        if (textIncludes(item.message, keywordFilter)) return true;
        if (textIncludes(item.raw, keywordFilter)) return true;
        if (textIncludes(item.source, keywordFilter)) return true;
        if (textIncludes(item.channel, keywordFilter)) return true;
        return textIncludes(safeJson(item.payload), keywordFilter);
      });
    }

    return items.slice(-safeLimit);
  }

  getLegacyChannels({ stream = "modules" } = {}) {
    const streamName = normalizeOptionalText(stream) || "modules";
    const channels = [
      { id: "all", title: "All" },
      ...CONSOLE_CHANNELS.map((item) => ({
        id: item,
        title: item,
      })),
    ];

    const items = this.buffer.filter((entry) => legacyStreamMatchesEntry(streamName, entry));
    const sourceSet = new Set();
    for (const item of items) {
      if (item.source) sourceSet.add(item.source);
    }

    return {
      streams: LEGACY_STREAMS.map((id) => ({ id, title: legacyStreamTitle(id) })),
      scopes: [
        { id: "all", title: "All sources" },
        ...[...sourceSet].sort().map((id) => ({ id, title: id })),
      ],
      levels: [
        { id: "all", title: "All levels" },
        { id: "debug", title: "Debug" },
        { id: "info", title: "Info" },
        { id: "warn", title: "Warn" },
        { id: "error", title: "Error" },
      ],
      channels,
    };
  }

  getLegacyLines({
    stream = "modules",
    scope = "all",
    level = "all",
    afterSeq = 0,
    limit = 300,
    q = "",
  } = {}) {
    const legacyStream = normalizeOptionalText(stream) || "modules";
    const safeAfterSeq = Math.max(0, Number(afterSeq) || 0);
    const safeLimit = Math.max(1, Math.min(Number(limit) || 300, 1000));
    const scopeFilter = normalizeOptionalText(scope);
    const levelFilter = normalizeOptionalText(level);
    const keywordFilter = normalizeOptionalText(q);

    const lines = [];

    for (const entry of this.buffer) {
      if (safeAfterSeq > 0 && Number(entry.seq ?? 0) <= safeAfterSeq) continue;
      if (!legacyStreamMatchesEntry(legacyStream, entry)) continue;
      if (scopeFilter && scopeFilter !== "all" && entry.source !== scopeFilter) continue;
      if (levelFilter && levelFilter !== "all" && entry.level !== levelFilter) continue;
      if (keywordFilter && !legacyEntryMatchesKeyword(entry, keywordFilter)) continue;
      lines.push(toLegacyLine(entry, legacyStream));
      if (lines.length > safeLimit) {
        lines.shift();
      }
    }

    return lines;
  }

  async executeRconCommand(command, meta = {}) {
    const commandText = String(command ?? "").trim();
    const requestedBy = String(meta.requestedBy ?? "web.console").trim() || "web.console";
    const startedAt = Date.now();

    this.rcon(`执行命令：${commandText || "(empty)"}`, {
      level: "info",
      payload: {
        command: commandText,
        status: "pending",
      },
      source: "RCON",
    });

    if (!commandText) {
      const result = {
        success: false,
        ok: false,
        message: "RCON command is empty.",
        response: "",
        status: "failed",
        durationMs: 0,
      };

      this.rcon("命令执行失败：RCON 命令为空", {
        level: "error",
        payload: {
          command: commandText,
          status: "failed",
          error: "RCON command is empty.",
        },
      });

      return result;
    }

    if (!this.core?.rconManager?.dispatchCommand) {
      const message = "RCON manager is unavailable.";
      this.rcon(`执行失败：${message}`, {
        level: "error",
        payload: {
          command: commandText,
          status: "failed",
          error: message,
        },
      });
      return {
        success: false,
        ok: false,
        message,
        response: "",
        status: "failed",
        durationMs: 0,
      };
    }

    try {
      const result = await this.core.rconManager.dispatchCommand({
        command: commandText,
        requestedBy,
        reason: meta.reason ?? "Manual RCON command from web console",
        actor: meta.actor ?? meta.user ?? null,
        system: Boolean(meta.system),
        requiredPermission: meta.requiredPermission,
      });

      const durationMs = Date.now() - startedAt;
      const response = String(result?.message ?? result?.rconResponse ?? "");
      const success = Boolean(result?.success);

      if (success) {
        this.rcon(`${commandText} 执行完成，用时 ${durationMs}ms`, {
          level: "info",
          payload: {
            command: commandText,
            status: "success",
            durationMs,
            response,
          },
        });
      } else {
        this.rcon(`${commandText} 执行失败：${response || "RCON error"}`, {
          level: "error",
          payload: {
            command: commandText,
            status: "failed",
            durationMs,
            error: response || "RCON error",
          },
        });
      }

      return {
        ...result,
        ok: success,
        status: success ? "success" : "failed",
        response,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error ?? "RCON error");

      this.rcon(`${commandText} 执行失败：${message}`, {
        level: "error",
        payload: {
          command: commandText,
          status: "failed",
          durationMs,
          error: message,
        },
      });

      return {
        success: false,
        ok: false,
        message,
        response: "",
        status: "failed",
        durationMs,
      };
    }
  }

  mirrorLoggerEntry(entry = {}) {
    const moduleId = String(entry.moduleId ?? entry.source ?? "").trim();
    if (!moduleId) return;

    if (moduleId.startsWith("plugin.")) {
      this.plugin(moduleId, String(entry.message ?? ""), {
        level: normalizeLevel(entry.level),
        payload: entry.data ?? null,
        ts: entry.time ? Date.parse(String(entry.time)) || Date.now() : Date.now(),
      });
      return;
    }

    if (!moduleId.startsWith("module.") && !isSystemLoggerSource(moduleId)) {
      return;
    }

    this.system(String(entry.message ?? ""), {
      level: normalizeLevel(entry.level),
      source: moduleId,
      payload: entry.data ?? null,
      ts: entry.time ? Date.parse(String(entry.time)) || Date.now() : Date.now(),
    });
  }

  mirrorNativeRconLine(line = {}) {
    const rawLevel = String(line.level ?? "info").trim().toLowerCase();
    const level = normalizeLevel(rawLevel);
    const message = String(line.message ?? "");
    const source = String(line.source ?? "core.rconManager");

    if (rawLevel === "status" || rawLevel === "debug") {
      this.system(message, {
        level: rawLevel === "debug" ? "info" : "info",
        source,
        payload: cloneJsonSafe(line),
        ts: line.time ? Date.parse(String(line.time)) || Date.now() : Date.now(),
      });
      return;
    }

    this.rcon(message, {
      level,
      source: "RCON",
      payload: cloneJsonSafe(line),
      ts: line.time ? Date.parse(String(line.time)) || Date.now() : Date.now(),
    });
  }

  mirrorCoreEvent(event = {}) {
    const entry = normalizeCoreEvent(event);
    if (!entry) return;
    this.emit(entry);
  }
}

function normalizeConsoleEntry(entry = {}, seq = 0) {
  const ts = normalizeTimestamp(entry.ts ?? entry.time);
  const id = String(entry.id ?? `console-${seq}-${ts}`);
  const channel = normalizeChannel(entry.channel);
  const level = normalizeLevel(entry.level);
  const source = String(entry.source ?? "").trim() || channelToDefaultSource(channel);
  const message = String(entry.message ?? "");
  const raw = entry.raw == null ? null : String(entry.raw);

  return {
    id,
    seq,
    ts,
    channel,
    level,
    source,
    message,
    raw,
    payload: cloneJsonSafe(entry.payload ?? null),
  };
}

function normalizeTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  const text = String(value ?? "").trim();
  if (!text) return Date.now();
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizeChannel(value) {
  const text = String(value ?? "system").trim().toLowerCase();
  if (CONSOLE_CHANNELS.includes(text)) return text;
  if (text === "raw-log" || text === "rawlog") return "raw_log";
  if (text === "rcon-native" || text === "rconnative") return "rcon";
  if (text === "module" || text === "modules" || text === "eventbus") return "event";
  return "system";
}

function normalizeLevel(value) {
  const text = String(value ?? "info").trim().toLowerCase();
  if (CONSOLE_LEVELS.includes(text)) return text;
  return "info";
}

function normalizeOptionalText(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

function channelToDefaultSource(channel) {
  switch (channel) {
    case "raw_log":
      return "SquadGame.log";
    case "event":
      return "LogParser";
    case "rcon":
      return "RCON";
    case "plugin":
      return "plugin";
    default:
      return "BZSS Panel";
  }
}

function isSystemLoggerSource(moduleId) {
  return SYSTEM_LOGGER_PREFIXES.some((prefix) => moduleId.startsWith(prefix));
}

function legacyStreamToChannel(stream) {
  const normalized = String(stream ?? "").trim();
  if (normalized === "raw-log") return "raw_log";
  if (normalized === "rcon-native") return "rcon";
  if (normalized === "modules") return "modules";
  if (normalized === "all") return "all";
  return "all";
}

function legacyStreamMatchesEntry(stream, entry) {
  const normalized = String(stream ?? "").trim();
  if (normalized === "all") return true;
  if (normalized === "raw-log") return entry.channel === "raw_log";
  if (normalized === "rcon-native") return entry.channel === "rcon";
  if (normalized === "modules") return entry.channel !== "raw_log" && entry.channel !== "rcon";
  return true;
}

function legacyStreamTitle(id) {
  switch (id) {
    case "modules":
      return "Modules";
    case "raw-log":
      return "Raw Log";
    case "rcon-native":
      return "RCON";
    default:
      return id;
  }
}

function legacyEntryMatchesKeyword(entry, keyword) {
  return [
    entry.message,
    entry.raw,
    entry.source,
    entry.channel,
    safeJson(entry.payload),
  ].some((value) => textIncludes(value, keyword));
}

function textIncludes(value, keyword) {
  return String(value ?? "").toLowerCase().includes(String(keyword ?? "").toLowerCase());
}

function cloneJsonSafe(value) {
  if (value == null) return null;
  if (typeof value !== "object") return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function normalizeCoreEvent(event = {}) {
  const eventName = String(event?.eventName ?? "").trim();
  if (!eventName) return null;

  if (eventName === "On_RawLogLine") {
    const raw = String(event.rawLog ?? event.rawEvent?.Raw ?? "");
    if (!raw) return null;
    const rawSource = getEventParam(event, "Source") || event.source || "SquadGame.log";
    const rawChannel = getEventParam(event, "Channel") || extractRawChannel(raw) || "";
    return {
      channel: "raw_log",
      level: event.rawEvent?.RawTruncated === "true" ? "warn" : "info",
      source: String(rawSource || "SquadGame.log"),
      message: raw,
      raw,
      payload: {
        type: "raw_log_line",
        eventName,
        rawLogTime: String(event.logTime ?? ""),
        rawChannel,
      },
      ts: event.time ?? Date.now(),
    };
  }

  if (eventName === "CHAT_MESSAGE") {
    const payload = cloneJsonSafe(event.payload ?? {});
    const channel = String(payload?.channel ?? "Chat").trim();
    const name = String(payload?.name ?? payload?.playerName ?? "Unknown").trim();
    const message = String(payload?.message ?? "");
    return {
      channel: "event",
      level: "info",
      source: "LogParser",
      message: `玩家聊天：${name} 说 ${message}`,
      raw: String(event.rawLog ?? ""),
      payload: {
        type: "chat_message",
        channel,
        name,
        message,
        steamid: payload?.steamid ?? "",
        eosid: payload?.eosid ?? "",
      },
      ts: event.time ?? Date.now(),
    };
  }

  if (eventName === "TEAM_KILL") {
    const payload = cloneJsonSafe(event.payload ?? {});
    const killerName = String(payload?.killerName ?? payload?.attackerName ?? "Unknown");
    const victimName = String(payload?.victimName ?? payload?.targetName ?? "Unknown");
    return {
      channel: "event",
      level: "warn",
      source: "LogParser",
      message: `击杀/误伤：${killerName} -> ${victimName}`,
      raw: String(event.rawLog ?? ""),
      payload: {
        type: "team_kill",
        killerName,
        victimName,
        weapon: payload?.weapon ?? "",
        damage: payload?.damage ?? null,
      },
      ts: event.time ?? Date.now(),
    };
  }

  if (eventName === "On_PlayerJoined" || eventName === "PLAYER_JOINED") {
    const payload = cloneJsonSafe(event.payload ?? {});
    const name = String(payload?.name ?? payload?.playerName ?? getEventParam(event, "PlayerName") ?? "Unknown");
    return makeEventEntry("player_joined", `玩家加入：${name}`, event, payload, "info");
  }

  if (eventName === "On_PlayerLeft" || eventName === "PLAYER_LEFT") {
    const payload = cloneJsonSafe(event.payload ?? {});
    const name = String(payload?.name ?? payload?.playerName ?? getEventParam(event, "PlayerName") ?? "Unknown");
    return makeEventEntry("player_left", `玩家离开：${name}`, event, payload, "info");
  }

  if (eventName === "On_PlayerWounded" || eventName === "PLAYER_WOUNDED") {
    const payload = cloneJsonSafe(event.payload ?? {});
    const victimName = String(payload?.victimName ?? payload?.name ?? getEventParam(event, "VictimName") ?? "Unknown");
    return makeEventEntry("wounded", `玩家倒地：${victimName}`, event, payload, "info");
  }

  if (eventName === "On_PlayerDied" || eventName === "PLAYER_DIED") {
    const payload = cloneJsonSafe(event.payload ?? {});
    const victimName = String(payload?.victimName ?? payload?.name ?? getEventParam(event, "VictimName") ?? "Unknown");
    return makeEventEntry("died", `玩家阵亡：${victimName}`, event, payload, "warn");
  }

  if (eventName === "On_SquadCreated" || eventName === "SQUAD_CREATED") {
    const payload = cloneJsonSafe(event.payload ?? {});
    const squadName = String(payload?.squadName ?? getEventParam(event, "SquadName") ?? "Unknown");
    return makeEventEntry("squad_created", `小队创建：${squadName}`, event, payload, "info");
  }

  if (eventName === "On_SquadDisbanded" || eventName === "SQUAD_DISBANDED") {
    const payload = cloneJsonSafe(event.payload ?? {});
    const squadName = String(payload?.squadName ?? getEventParam(event, "SquadName") ?? "Unknown");
    return makeEventEntry("squad_removed", `小队解散：${squadName}`, event, payload, "info");
  }

  if (eventName === "MAP_CHANGED" || eventName === "round.world_bring_up" || eventName === "GAME_START" || eventName === "MATCH_START" || eventName === "ROUND_START" || eventName === "NEW_GAME") {
    const payload = cloneJsonSafe(event.payload ?? {});
    const mapName = String(payload?.map ?? payload?.mapName ?? payload?.layerName ?? getEventParam(event, "MapName") ?? getEventParam(event, "LayerName") ?? getEventParam(event, "mapName") ?? "");
    const type = eventName === "round.world_bring_up" ? "map_bring_up" : "map_changed";
    const message = mapName ? `地图切换：${mapName}` : `地图切换：${eventName}`;
    return makeEventEntry(type, message, event, payload, "info");
  }

  if (eventName === "RCON_LIST_PLAYERS_UPDATED" || eventName === "RCON_LIST_SQUADS_UPDATED" || eventName === "SERVER_INFO_UPDATED") {
    const payload = cloneJsonSafe(event.payload ?? {});
    const players = Array.isArray(payload?.players) ? payload.players.length : Number(payload?.playerCount ?? payload?.count ?? 0);
    const squads = Array.isArray(payload?.squads) ? payload.squads.length : Number(payload?.squadCount ?? 0);
    const mapName = String(payload?.currentMap ?? payload?.mapName ?? payload?.map ?? "");
    const messageParts = [];
    if (players) messageParts.push(`人数 ${players}`);
    if (squads) messageParts.push(`小队 ${squads}`);
    if (mapName) messageParts.push(`地图 ${mapName}`);
    return makeEventEntry("server_info_updated", `服务器信息更新：${messageParts.join(" / ") || eventName}`, event, payload, "info");
  }

  if (eventName === "LOG_TIME_RESET") {
    const payload = cloneJsonSafe(event.payload ?? {});
    return makeEventEntry("log_time_reset", "日志时间重置", event, payload, "info");
  }

  if (eventName === "RCON_TIME_UPDATED") {
    const payload = cloneJsonSafe(event.payload ?? {});
    return makeEventEntry("rcon_time_updated", "RCON 时间更新", event, payload, "info");
  }

  return null;
}

function makeEventEntry(type, message, event, payload, level = "info") {
  return {
    channel: "event",
    level,
    source: "LogParser",
    message,
    raw: String(event.rawLog ?? event.rawEvent?.Raw ?? ""),
    payload: {
      type,
      ...cloneJsonSafe(payload ?? {}),
    },
    ts: event.time ?? Date.now(),
  };
}

function getEventParam(event, name) {
  if (event?.paramMap && event.paramMap[name] != null) return String(event.paramMap[name]);

  if (Array.isArray(event?.params)) {
    const param = event.params.find((item) => item?.name === name);
    if (param) return String(param.value ?? "");
  }

  return "";
}

function extractRawChannel(line) {
  const match = String(line ?? "").match(/\b(Log[A-Za-z0-9_]+)\s*:/);
  return match ? match[1] : "";
}

function toLegacyLine(entry, stream) {
  const channel = entry.channel === "raw_log"
    ? "raw-log"
    : entry.channel === "rcon"
      ? "rcon-native"
      : "modules";

  const payload = cloneJsonSafe(entry.payload ?? {});
  const legacy = {
    seq: entry.seq,
    time: new Date(entry.ts).toISOString(),
    stream,
    channel,
    level: entry.level,
    message: entry.message,
    scope: entry.source,
    source: entry.source,
    moduleId: entry.source,
    eventName: String(payload?.type ?? ""),
    operation: String(payload?.operation ?? ""),
    label: legacyLabelFor(entry),
    tags: Array.isArray(payload?.tags) ? payload.tags : [],
    dataSummary: summarizeLegacyPayload(payload),
    raw: entry.raw ?? null,
    payload,
  };

  if (entry.channel === "raw_log") {
    legacy.rawSource = entry.source;
    legacy.rawChannel = String(payload?.rawChannel ?? "");
    legacy.rawTruncated = Boolean(payload?.rawTruncated);
  }

  if (entry.channel === "rcon") {
    legacy.command = String(payload?.command ?? "");
    legacy.status = String(payload?.status ?? "");
  }

  return legacy;
}

function summarizeLegacyPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (typeof payload.command === "string" && payload.command) {
    return clipText(payload.command, 96);
  }

  if (typeof payload.type === "string" && payload.type) {
    return payload.type;
  }

  return clipText(safeJson(payload), 180);
}

function legacyLabelFor(entry) {
  switch (entry.channel) {
    case "raw_log":
      return "Raw";
    case "event":
      return "Event";
    case "rcon":
      return "RCON";
    case "plugin":
      return "Plugin";
    default:
      return "System";
  }
}

function clipText(value, maxLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}
