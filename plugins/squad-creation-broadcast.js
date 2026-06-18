// -*- coding: utf-8 -*-

const PLUGIN_ID = "plugin.squad-creation-broadcast";

function readRuntimeConfig(config) {
  const cfg = config?.get?.(`plugins.${PLUGIN_ID}`, {})
    ?? config?.get?.(`plugins.plugin.squad-creation-broadcast`, {})
    ?? {};
  return {
    enabled: Boolean(cfg.enabled ?? true),
    delaySeconds: Number(cfg.delaySeconds ?? 5),
    messageTemplate: String(cfg.messageTemplate ?? "[建队播报] 玩家 ${creatorName} 创建了小队: ${squadName} (小队ID: ${squadId})"),
  };
}

function getParam(event, name) {
  const params = event?.paramMap ?? event?.ParamMap ?? {};
  return params[name];
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseRawLogTimestamp(rawLog) {
  const text = String(rawLog ?? "");
  const match = text.match(/\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d{3})\]/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number(match[7]);

  const date = new Date(year, month, day, hour, minute, second, millisecond);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseRawSquadCreateLog(rawLog) {
  const text = String(rawLog ?? "");
  if (!text) return null;

  const match = text.match(/LogSquad:\s*(.+?)\s*\(Online IDs:\s*EOS:\s*([^\s)]+)\s*steam:\s*([^\s)]+)\)\s*has created Squad\s*(\d+)\s*\(Squad Name:\s*(.+?)\)\s*on\s*(.+?)\s*$/i);
  if (!match) return null;

  return {
    creatorName: match[1].trim(),
    creatorEosId: match[2].trim(),
    creatorSteamId: match[3].trim(),
    squadId: toNumber(match[4]),
    squadName: match[5].trim(),
    factionName: match[6].trim(),
  };
}

export function parseSquadCreateEvent(event) {
  if (!event || typeof event !== "object") return null;

  const eventName = String(
    event.eventName
      ?? event.Event
      ?? event.rawEvent?.Event
      ?? event.rawEvent?.eventName
      ?? "",
  ).trim();

  const serverId = String(event.serverId ?? event.ServerID ?? getParam(event, "ServerID") ?? "").trim();
  const squadId = toNumber(
    event.squadId
      ?? getParam(event, "SquadID")
      ?? getParam(event, "SquadId"),
  );

  if (eventName === "On_RawLogLine") {
    const rawLog = String(event.rawLog ?? event.rawEvent?.Raw ?? event.sourceRaw ?? event.raw ?? "").trim();
    const parsed = parseRawSquadCreateLog(rawLog);
    if (!serverId || !parsed) return null;

    return {
      serverId,
      squadId: parsed.squadId,
      squadName: parsed.squadName,
      factionName: parsed.factionName,
      creatorName: parsed.creatorName,
      creatorSteamId: parsed.creatorSteamId,
      creatorEosId: parsed.creatorEosId,
      eventTime: parseRawLogTimestamp(rawLog) ?? String(
        event.eventTime
          ?? event.time
          ?? getParam(event, "Time")
          ?? new Date().toISOString(),
      ).trim(),
    };
  }

  if (eventName !== "On_SquadCreated" && eventName !== "SQUAD_CREATED") {
    return null;
  }

  if (!serverId || squadId == null) {
    return null;
  }

  const squadName = String(
    event.squadName
      ?? getParam(event, "SquadName")
      ?? "",
  ).trim();

  const creatorName = String(
    event.creatorName
      ?? event.playerName
      ?? getParam(event, "PlayerName")
      ?? "",
  ).trim();

  const creatorSteamId = String(
    event.creatorSteamId
      ?? event.steamID
      ?? getParam(event, "Steam64ID")
      ?? getParam(event, "SteamID")
      ?? "",
  ).trim();

  const creatorEosId = String(
    event.creatorEosId
      ?? event.eosID
      ?? getParam(event, "EOSID")
      ?? "",
  ).trim();

  const factionName = String(
    event.factionName
      ?? getParam(event, "FactionName")
      ?? getParam(event, "TeamName")
      ?? "",
  ).trim();

  const eventTime = String(
    event.eventTime
      ?? event.time
      ?? getParam(event, "Time")
      ?? new Date().toISOString(),
  ).trim();

  return {
    serverId,
    squadId,
    squadName,
    factionName,
    creatorName,
    creatorSteamId,
    creatorEosId,
    eventTime,
  };
}

export function createPlugin({ core, modules, config, logger } = {}) {
  const pluginLogger =
    logger
    ?? core?.createLogger?.({ moduleId: PLUGIN_ID, source: PLUGIN_ID, channel: "plugin" })
    ?? core?.logger
    ?? console;

  let runtimeConfig = readRuntimeConfig(config);
  const unsubscribers = [];

  const timers = new Map();
  const seenEvents = new Set();

  const state = {
    enabled: true,
    subscribed: true,
    broadcastCount: 0,
    lastBroadcastAt: "",
  };

  let lastRefreshTime = 0;
  let activeRefreshPromise = null;

  async function forceSquadsRefresh(serverId) {
    const now = Date.now();
    if (now - lastRefreshTime < 1000) {
      return;
    }
    if (activeRefreshPromise) {
      return activeRefreshPromise;
    }
    activeRefreshPromise = (async () => {
      try {
        const matchState = modules.matchState;
        if (typeof matchState?.refresh === "function") {
          await matchState.refresh("squads");
        }
      } catch (err) {
        pluginLogger.warn(`[SquadBroadcast] Failed to refresh squads: ${err.message}`);
      } finally {
        lastRefreshTime = Date.now();
        activeRefreshPromise = null;
      }
    })();
    return activeRefreshPromise;
  }

  function isPluginSubscribed() {
    const isSubscribed = core?.pluginSubscriptions?.isSubscribed;
    if (typeof isSubscribed !== "function") return true;
    return isSubscribed(PLUGIN_ID);
  }

  function isActive() {
    return Boolean(state.enabled) && isPluginSubscribed();
  }

  async function handleSquadCreatedEvent(event = {}) {
    if (!isActive()) return;

    const parsed = parseSquadCreateEvent(event);
    if (!parsed) return;

    const { serverId, squadId, squadName, creatorName, factionName, eventTime } = parsed;

    // Deduplicate identical events by server, faction, squad, and log timestamp
    const eventSignature = `${serverId}:${factionName}:${squadId}:${eventTime}`;
    if (seenEvents.has(eventSignature)) {
      return;
    }
    seenEvents.add(eventSignature);
    if (seenEvents.size > 1000) {
      const first = seenEvents.values().next().value;
      seenEvents.delete(first);
    }

    const key = `${serverId}:${factionName}:${squadId}`;

    if (timers.has(key)) {
      clearTimeout(timers.get(key));
      timers.delete(key);
      pluginLogger.info(`[SquadBroadcast] Re-creation detected for ${key}, resetting timer.`);
    }

    const timer = setTimeout(async () => {
      timers.delete(key);
      await checkAndBroadcast({ serverId, squadId, squadName, creatorName, factionName });
    }, runtimeConfig.delaySeconds * 1000);

    timers.set(key, timer);
  }

  async function checkAndBroadcast({ serverId, squadId, squadName, creatorName, factionName }) {
    try {
      // 1. Force refresh squad snapshot (debounced)
      await forceSquadsRefresh(serverId);

      // 2. Get current squads from squadManagement
      const currentSquads = modules.squadManagement?.getSquads?.(serverId) ?? [];

      // 3. Find if squad still exists (matching squadId and creatorName/squadName)
      const matchedSquad = currentSquads.find((s) => {
        const sId = Number(s.squadID ?? s.squadId);
        if (sId !== Number(squadId)) return false;

        const creatorMatches = s.creatorName && s.creatorName.toLowerCase() === creatorName.toLowerCase();
        const squadNameMatches = (s.squadName && s.squadName.toLowerCase() === squadName.toLowerCase())
          || (s.name && s.name.toLowerCase() === squadName.toLowerCase());

        return creatorMatches || squadNameMatches;
      });

      if (!matchedSquad) {
        pluginLogger.info(`[SquadBroadcast] Squad ${squadId} created by ${creatorName} no longer exists. Broadcast skipped.`);
        return;
      }

      // 4. Send the broadcast
      const template = runtimeConfig.messageTemplate;
      const finalSquadName = matchedSquad.squadName || matchedSquad.name || squadName;
      const teamId = matchedSquad.teamID ?? matchedSquad.teamId;
      const teamLabel = teamId === 1 ? "蓝军" : (teamId === 2 ? "红军" : `阵营${teamId ?? ""}`);

      const message = template
        .replace(/\$\{creatorName\}/g, creatorName)
        .replace(/\$\{squadName\}/g, finalSquadName)
        .replace(/\$\{squadId\}/g, String(squadId))
        .replace(/\$\{teamLabel\}/g, teamLabel);

      const broadcaster = modules?.adminWarn?.sendAdminBroadcast ?? modules?.adminWarn?.broadcastMessage;
      if (typeof broadcaster === "function") {
        await broadcaster.call(modules.adminWarn, {
          message,
          reason: "squad_creation_broadcast",
          sourceModule: PLUGIN_ID,
          system: true,
        });
        pluginLogger.info(`[SquadBroadcast] Broadcasted: ${message}`);
        state.broadcastCount++;
        state.lastBroadcastAt = new Date().toISOString();
      } else {
        pluginLogger.warn("[SquadBroadcast] Broadcast API is unavailable.");
      }
    } catch (error) {
      pluginLogger.error(`[SquadBroadcast] Error in checkAndBroadcast: ${error.stack}`);
    }
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "建队播报插件",
      kind: "plugin",
      version: "1.0.0",
      description: "延迟检查并广播小队创建信息。当建队日志触发后，等待数秒检查小队是否依然存在，若存在则播报，每次重新建队都会重置延迟定时器。",
      category: "Broadcast",
      configSchema: [
        {
          key: `plugins.${PLUGIN_ID}.enabled`,
          type: "boolean",
          default: true,
          description: "是否启用建队播报插件",
        },
        {
          key: `plugins.${PLUGIN_ID}.delaySeconds`,
          type: "number",
          default: 5,
          description: "检查并播报的延迟时间(秒)",
        },
        {
          key: `plugins.${PLUGIN_ID}.messageTemplate`,
          type: "string",
          default: "[建队播报] 玩家 ${creatorName} 创建了小队: ${squadName} (小队ID: ${squadId})",
          description: "播报消息的模板内容。支持变量: ${creatorName}, ${squadName}, ${squadId}, ${teamLabel}",
        },
      ],
    },

    apiName: "squadCreationBroadcast",
    api: {
      getState() {
        return {
          ...state,
          subscribed: isPluginSubscribed(),
        };
      },
      checkAndBroadcast,
      forceSquadsRefresh,
      handleSquadCreatedEvent,
    },

    async start() {
      runtimeConfig = readRuntimeConfig(config);
      state.enabled = runtimeConfig.enabled;

      if (!state.enabled) {
        pluginLogger.info("[SquadBroadcast] Plugin disabled by config.");
        return;
      }

      if (typeof core?.eventBus?.onCoreEvent !== "function") {
        pluginLogger.warn("[SquadBroadcast] core.eventBus.onCoreEvent unavailable.");
        return;
      }

      unsubscribers.push(
        core.eventBus.onCoreEvent("On_SquadCreated", handleSquadCreatedEvent),
      );
      unsubscribers.push(
        core.eventBus.onCoreEvent("SQUAD_CREATED", handleSquadCreatedEvent),
      );
      unsubscribers.push(
        core.eventBus.onCoreEvent("On_RawLogLine", handleSquadCreatedEvent),
      );

      pluginLogger.info(`[SquadBroadcast] Subscriptions registered. Delay: ${runtimeConfig.delaySeconds}s`);
    },

    async stop() {
      for (const unsub of unsubscribers.splice(0)) unsub();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      seenEvents.clear();
      pluginLogger.info("[SquadBroadcast] Plugin stopped.");
    },
  };
}
