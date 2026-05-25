// -*- coding: utf-8 -*-

import EventEmitter from "node:events";

export function createChatManagerService({ core, modules, config, logger }) {
  const eventEmitter = new EventEmitter();
  const chatHistory = [];
  const MAX_HISTORY = 1000;
  
  // Frequency monitoring state
  const playerStats = new Map(); // steamID -> { lastTime, count, name, messageTimestamps: [] }
  const SPAM_WINDOW_MS = 10000;
  const SPAM_THRESHOLD = 5;
  const FREQUENCY_WINDOW_MS = 60000;

  // New: Per-minute statistics for visualization
  const minuteStats = new Map(); // minuteTimestamp -> count
  const MAX_STATS_MINUTES = 60;

  const unsubscribers = [];

  // API for other modules/plugins
  const api = {
    getHistory() {
      return [...chatHistory];
    },

    getStats() {
      const now = Math.floor(Date.now() / 60000);
      const result = [];
      for (let i = MAX_STATS_MINUTES - 1; i >= 0; i--) {
        const m = now - i;
        result.push({
          minute: m * 60000,
          count: minuteStats.get(m) || 0
        });
      }
      return result;
    },

    getPlayerFrequencies() {
      const now = Date.now();
      const result = [];
      for (const [steamID, stats] of playerStats.entries()) {
        // Clean up old timestamps
        stats.messageTimestamps = (stats.messageTimestamps || [])
          .filter(t => now - t < FREQUENCY_WINDOW_MS);
        
        if (stats.messageTimestamps.length > 0) {
          result.push({
            steamID,
            name: stats.name,
            count: stats.messageTimestamps.length
          });
        }
      }
      return result.sort((a, b) => b.count - a.count);
    },

    getSpammers() {
      const spammers = [];
      for (const [steamID, stats] of playerStats.entries()) {
        if (stats.count > SPAM_THRESHOLD && Date.now() - stats.lastTime < SPAM_WINDOW_MS) {
          spammers.push({ steamID, name: stats.name, count: stats.count });
        }
      }
      return spammers;
    },
    
    /**
     * Subscribe to chat events.
     * @param {string} type 'message' | 'spam' | 'trigger'
     * @param {Function} handler 
     */
    on(type, handler) {
      eventEmitter.on(type, handler);
      return () => eventEmitter.off(type, handler);
    },

    /**
     * Register a simple string or regex trigger
     */
    registerTrigger(pattern, eventName) {
      // Implementation for triggers can be added here
      logger.debug(`Registered chat trigger: ${pattern} -> ${eventName}`);
    }
  };

  async function start() {
    if (core.eventBus?.onCoreEvent) {
      unsubscribers.push(core.eventBus.onCoreEvent("CHAT_MESSAGE", (event) => {
        handleChatMessage(event.payload, event.time);
      }));
    }
    
    logger.info("ChatManager service started.");
  }

  async function stop() {
    for (const un of unsubscribers.splice(0)) un();
    eventEmitter.removeAllListeners();
    logger.info("ChatManager service stopped.");
  }

  function handleChatMessage(payload, time) {
    const { channel, name, message, steamID, eosID } = payload;
    
    const entry = {
      time,
      channel,
      name,
      message,
      steamID,
      eosID,
      raw: payload.raw || payload.sourceRaw || "",
      seq: Date.now()
    };

    // 1. Add to history
    chatHistory.push(entry);
    if (chatHistory.length > MAX_HISTORY) chatHistory.shift();

    // New: Record per-minute stats
    const currentMinute = Math.floor(Date.now() / 60000);
    minuteStats.set(currentMinute, (minuteStats.get(currentMinute) || 0) + 1);
    
    // Cleanup old stats
    if (minuteStats.size > MAX_STATS_MINUTES + 10) {
      const oldestToKeep = currentMinute - MAX_STATS_MINUTES;
      for (const m of minuteStats.keys()) {
        if (m < oldestToKeep) minuteStats.delete(m);
      }
    }

    // 2. Frequency Monitoring (Spam Detection)
    if (steamID) {
      const now = Date.now();
      const stats = playerStats.get(steamID) || { lastTime: 0, count: 0, name: "" };
      stats.name = name; // Update name
      
      if (now - stats.lastTime < SPAM_WINDOW_MS) {
        stats.count++;
      } else {
        stats.count = 1;
        stats.lastTime = now;
      }
      playerStats.set(steamID, stats);

      // Record timestamp for rolling frequency
      if (!stats.messageTimestamps) stats.messageTimestamps = [];
      stats.messageTimestamps.push(now);

      if (stats.count > SPAM_THRESHOLD) {
        eventEmitter.emit("spam", { steamID, name, count: stats.count });
        logger.warn(`Potential spam detected from ${name} (${steamID}): ${stats.count} msgs in ${SPAM_WINDOW_MS}ms`);
      }
    }

    // 3. Emit basic event
    eventEmitter.emit("message", entry);

    // 4. Emit module event for broader ecosystem
    logger.debug(`Emitting CHAT_RECEIVED for ${name}: ${message}`);
    core.eventBus?.emitModuleEvent("module.chatManager", "CHAT_RECEIVED", {
      ...entry,
      serverId: core.webStatus?.serverId
    });

    // 5. Basic Trigger Check (Can be expanded)
    // For now, we just emit a generic event that others can listen to
    if (message.startsWith("!")) {
      eventEmitter.emit("command", { ...entry, cmd: message.slice(1).split(" ")[0] });
    }
  }

  return {
    api,
    start,
    stop,
  };
}
