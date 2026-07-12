// -*- coding: utf-8 -*-

import { randomUUID } from "node:crypto";
import EventEmitter from "node:events";

const DEFAULT_MAX_HISTORY = 300;
const DEFAULT_SPAM_WINDOW_MS = 10_000;
const DEFAULT_SPAM_THRESHOLD = 5;
const DEFAULT_FREQUENCY_WINDOW_MS = 60_000;
const DEFAULT_STATS_MINUTES = 60;

export function createChatManagerService({ core, config, logger }) {
  const eventEmitter = new EventEmitter();
  const chatHistory = [];

  const maxHistory = normalizePositiveInteger(
    config?.get?.("modules.chatManager.maxRecentMessages", DEFAULT_MAX_HISTORY),
    DEFAULT_MAX_HISTORY,
  );
  const exposeRawLog = Boolean(config?.get?.("modules.chatManager.exposeRawLog", false));
  const spamWindowMs = normalizePositiveInteger(
    config?.get?.("modules.chatManager.spamWindowMs", DEFAULT_SPAM_WINDOW_MS),
    DEFAULT_SPAM_WINDOW_MS,
  );
  const spamThreshold = normalizePositiveInteger(
    config?.get?.("modules.chatManager.spamThreshold", DEFAULT_SPAM_THRESHOLD),
    DEFAULT_SPAM_THRESHOLD,
  );
  const frequencyWindowMs = normalizePositiveInteger(
    config?.get?.("modules.chatManager.frequencyWindowMs", DEFAULT_FREQUENCY_WINDOW_MS),
    DEFAULT_FREQUENCY_WINDOW_MS,
  );
  const maxStatsMinutes = normalizePositiveInteger(
    config?.get?.("modules.chatManager.maxStatsMinutes", DEFAULT_STATS_MINUTES),
    DEFAULT_STATS_MINUTES,
  );
  const playerStatsIdleTtlMs = normalizePositiveInteger(
    config?.get?.("modules.chatManager.playerStatsIdleTtlMs", 3_600_000),
    3_600_000,
  );
  const maxTrackedPlayers = normalizePositiveInteger(
    config?.get?.("modules.chatManager.maxTrackedPlayers", 2000),
    2000,
  );

  // playerId -> monitoring state
  const playerStats = new Map();
  const minuteStats = new Map();
  const unsubscribers = [];
  let playerStatsCleanupTimer = null;

  const api = {
    getHistory(limit = maxHistory) {
      const recent = chatHistory.slice(-normalizePositiveInteger(limit, maxHistory));
      return recent.map((entry) => cloneChatEntry(entry, { exposeRawLog }));
    },

    getStats() {
      const nowMinute = Math.floor(Date.now() / 60_000);
      const result = [];

      for (let index = maxStatsMinutes - 1; index >= 0; index -= 1) {
        const minute = nowMinute - index;
        result.push({
          minute: minute * 60_000,
          count: minuteStats.get(minute) || 0,
        });
      }

      return result;
    },

    getPlayerFrequencies() {
      const now = Date.now();
      const result = [];

      for (const [playerKey, stats] of playerStats.entries()) {
        stats.messageTimestamps = (stats.messageTimestamps || []).filter((timestamp) => now - timestamp < frequencyWindowMs);

        if (stats.messageTimestamps.length > 0) {
          result.push({
            steamID: stats.steamID || "",
            eosID: stats.eosID || "",
            name: stats.name || "Unknown",
            count: stats.messageTimestamps.length,
            playerKey,
          });
        }
      }

      return result.sort((a, b) => b.count - a.count);
    },

    getSpammers() {
      const now = Date.now();
      const result = [];

      for (const stats of playerStats.values()) {
        if (stats.count > spamThreshold && now - stats.lastTime < spamWindowMs) {
          result.push({
            steamID: stats.steamID || "",
            eosID: stats.eosID || "",
            name: stats.name || "Unknown",
            count: stats.count,
          });
        }
      }

      return result;
    },

    on(type, handler) {
      eventEmitter.on(type, handler);
      return () => eventEmitter.off(type, handler);
    },

    registerTrigger(pattern, eventName) {
      logger?.debug?.(`Registered chat trigger: ${pattern} -> ${eventName}`);
    },
  };

  async function start() {
    if (core.eventBus?.onCoreEvent) {
      unsubscribers.push(
        core.eventBus.onCoreEvent("CHAT_MESSAGE", (event) => {
          handleChatMessage(event?.payload ?? {}, event?.time ?? null);
        }),
      );
    }

    if (!playerStatsCleanupTimer) {
      playerStatsCleanupTimer = setInterval(() => {
        prunePlayerStats(playerStats, {
          now: Date.now(),
          idleTtlMs: playerStatsIdleTtlMs,
          maxEntries: maxTrackedPlayers,
          frequencyWindowMs,
        });
      }, 300_000);
      playerStatsCleanupTimer.unref?.();
    }
    logger?.info?.("ChatManager service started.");
  }

  async function stop() {
    for (const un of unsubscribers.splice(0)) {
      try {
        un();
      } catch {}
    }

    if (playerStatsCleanupTimer) clearInterval(playerStatsCleanupTimer);
    playerStatsCleanupTimer = null;
    playerStats.clear();
    eventEmitter.removeAllListeners();
    logger?.info?.("ChatManager service stopped.");
  }

  function handleChatMessage(payload, time) {
    const timestamp = normalizeTimestamp(time ?? payload?.timestamp ?? payload?.time);
    const playerName = normalizeText(payload?.playerName ?? payload?.name ?? payload?.player_name);
    const steamId = normalizeText(payload?.steamId ?? payload?.steamID ?? payload?.steamid);
    const eosId = normalizeText(payload?.eosId ?? payload?.eosID ?? payload?.eosid);
    const channel = normalizeChannel(payload?.channel);
    const message = String(payload?.message ?? "").trim();
    const teamId = normalizeOptionalNumber(payload?.teamId ?? payload?.teamID);
    const squadId = normalizeOptionalNumber(payload?.squadId ?? payload?.squadID);
    const logTime = normalizeOptionalText(payload?.logTime ?? payload?.log_time);
    const raw = normalizeOptionalText(payload?.raw ?? payload?.rawLog ?? payload?.sourceRaw);
    const serverId = normalizeText(payload?.serverId ?? core.webStatus?.serverId ?? "");

    if (!message) {
      return;
    }

    const entry = {
      id: randomUUID(),
      serverId,
      timestamp,
      logTime,
      chatChannel: channel,
      channel,
      playerName: playerName || null,
      eosId: eosId || null,
      steamId: steamId || null,
      teamId,
      squadId,
      message,
      raw: exposeRawLog && raw ? raw : undefined,
    };

    // Keep compatibility with older consumers while exposing the new fields.
    entry.time = new Date(timestamp).toISOString();
    entry.name = entry.playerName;
    entry.eosID = entry.eosId;
    entry.steamID = entry.steamId;
    entry.seq = timestamp;
    entry.channel = toLegacyChannel(channel);

    chatHistory.push(entry);
    trimHistory(chatHistory, maxHistory);

    const currentMinute = Math.floor(timestamp / 60_000);
    minuteStats.set(currentMinute, (minuteStats.get(currentMinute) || 0) + 1);
    trimMinuteStats(minuteStats, currentMinute, maxStatsMinutes);

    updatePlayerStats(playerStats, {
      now: timestamp,
      steamId: steamId || eosId || playerName,
      eosId,
      playerName,
      spamWindowMs,
      frequencyWindowMs,
    });

    eventEmitter.emit("message", cloneChatEntry(entry, { exposeRawLog }));

    logger?.debug?.(`[ChatMonitor] parsed chat: ${entry.chatChannel} ${entry.playerName || "Unknown"}`, {
      operation: "chatMessageParsed",
      data: {
        channel: entry.channel,
        playerName: entry.playerName || "",
        serverId: entry.serverId,
      },
    });

    core.eventBus?.emitModuleEvent?.("module.chatManager", "CHAT_RECEIVED", {
      ...cloneChatEntry(entry, { exposeRawLog }),
      serverId: entry.serverId,
    });

    if (message.startsWith("!")) {
      eventEmitter.emit("command", {
        ...cloneChatEntry(entry, { exposeRawLog }),
        cmd: message.slice(1).split(/\s+/)[0] || "",
      });
    }
  }

  return {
    api,
    start,
    stop,
  };
}

function updatePlayerStats(playerStats, { now, steamId, eosId, playerName, spamWindowMs, frequencyWindowMs }) {
  const playerKey = String(steamId || eosId || playerName || "").trim();
  if (!playerKey) {
    return;
  }

  const stats = playerStats.get(playerKey) || {
    lastTime: 0,
    count: 0,
    name: "",
    steamID: String(steamId ?? ""),
    eosID: String(eosId ?? ""),
    messageTimestamps: [],
    lastActivityAt: 0,
  };

  stats.name = String(playerName ?? stats.name ?? "Unknown").trim() || "Unknown";
  stats.steamID = String(steamId ?? stats.steamID ?? "");
  stats.eosID = String(eosId ?? stats.eosID ?? "");

  if (now - stats.lastTime < spamWindowMs) {
    stats.count += 1;
  } else {
    stats.count = 1;
  }
  stats.lastTime = now;
  stats.lastActivityAt = now;

  stats.messageTimestamps = (stats.messageTimestamps || []).filter((timestamp) => now - timestamp < frequencyWindowMs);
  stats.messageTimestamps.push(now);
  playerStats.set(playerKey, stats);
}

function prunePlayerStats(playerStats, { now, idleTtlMs, maxEntries, frequencyWindowMs }) {
  for (const [key, stats] of playerStats) {
    stats.messageTimestamps = (stats.messageTimestamps || [])
      .filter((timestamp) => now - timestamp < frequencyWindowMs);
    if (stats.messageTimestamps.length === 0 && now - Number(stats.lastActivityAt || stats.lastTime || 0) > idleTtlMs) {
      playerStats.delete(key);
    }
  }
  if (playerStats.size <= maxEntries) return;
  const oldest = [...playerStats.entries()]
    .sort((left, right) => Number(left[1].lastActivityAt || 0) - Number(right[1].lastActivityAt || 0));
  for (const [key] of oldest.slice(0, playerStats.size - maxEntries)) playerStats.delete(key);
}

function cloneChatEntry(entry, { exposeRawLog }) {
  const cloned = {
    id: entry.id,
    serverId: entry.serverId,
    timestamp: entry.timestamp,
    logTime: entry.logTime ?? null,
    chatChannel: entry.chatChannel ?? normalizeChannel(entry.channel),
    channel: entry.channel,
    playerName: entry.playerName ?? null,
    eosId: entry.eosId ?? null,
    steamId: entry.steamId ?? null,
    teamId: entry.teamId ?? null,
    squadId: entry.squadId ?? null,
    message: entry.message,
    time: entry.time,
    name: entry.name ?? null,
    eosID: entry.eosID ?? null,
    steamID: entry.steamID ?? null,
    seq: entry.seq,
  };

  if (exposeRawLog && entry.raw) {
    cloned.raw = entry.raw;
  }

  return cloned;
}

function normalizeChannel(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return "unknown";

  if (text === "chatall" || text === "all") return "all";
  if (text === "chatteam" || text === "team") return "team";
  if (text === "chatsquad" || text === "squad") return "squad";
  if (text === "chatadmin" || text === "admin") return "admin";
  if (text === "system" || text === "chatsystem") return "system";
  if (text === "unknown") return "unknown";
  return text;
}

function toLegacyChannel(value) {
  const normalized = normalizeChannel(value);
  if (normalized === "all") return "ChatAll";
  if (normalized === "team") return "ChatTeam";
  if (normalized === "squad") return "ChatSquad";
  if (normalized === "admin") return "ChatAdmin";
  if (normalized === "system") return "ChatSystem";
  return "Unknown";
}

function normalizeTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const text = String(value ?? "").trim();
  if (!text) {
    return Date.now();
  }

  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  return Date.now();
}

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text;
}

function normalizeOptionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeOptionalNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizePositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return Math.max(1, Math.trunc(Number(fallback) || 1));
  }
  return Math.max(1, Math.trunc(numeric));
}

function trimHistory(history, maxItems) {
  if (history.length <= maxItems) return;
  history.splice(0, history.length - maxItems);
}

function trimMinuteStats(minuteStats, currentMinute, maxStatsMinutes) {
  if (minuteStats.size <= maxStatsMinutes + 10) return;
  const oldestToKeep = currentMinute - maxStatsMinutes;
  for (const minute of minuteStats.keys()) {
    if (minute < oldestToKeep) {
      minuteStats.delete(minute);
    }
  }
}