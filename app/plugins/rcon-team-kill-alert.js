// -*- coding: utf-8 -*-

/**
 * RCON TK 双向提醒
 *
 * 只订阅 Squad RCON 解析后的 TEAM_KILL 核心事件。日志战斗事件、回放事件
 * 和其他模块事件都不会进入此插件，因此同一次 TK 不会因多条数据链重复提醒。
 */
const PLUGIN_ID = "plugin.rcon-team-kill-alert";
const CONFIG_KEY = "plugins.rconTeamKillAlert";
const HANDLED_TTL_MS = 15 * 60_000;
const MAX_HANDLED_EVENTS = 2_000;
const MAX_HISTORY = 300;

export function createPlugin({ core = {}, modules = {}, config = null, logger = console } = {}) {
  const unsubscribers = [];
  const handledEvents = new Map();
  const history = [];
  let runtimeConfig = readConfig(config);

  const state = {
    received: 0,
    alerted: 0,
    attackerAlerted: 0,
    victimAlerted: 0,
    skipped: 0,
    failed: 0,
    lastReceivedAt: "",
    lastAlertedAt: "",
    lastError: "",
  };

  function text(value, fallback = "") {
    const normalized = String(value ?? "").normalize("NFKC").trim();
    return normalized || fallback;
  }

  function isSubscribed() {
    return core?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false
      && modules?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false;
  }

  function isActive() {
    return runtimeConfig.enabled && isSubscribed();
  }

  function resolveRecord(event = {}) {
    return event?.record
      ?? event?.payload?.record
      ?? event?.payload
      ?? event?.data?.record
      ?? event?.data
      ?? event
      ?? {};
  }

  function resolveIdentity(record = {}, side) {
    const isAttacker = side === "attacker";
    const nested = record?.[side] && typeof record[side] === "object" ? record[side] : {};
    const prefix = isAttacker ? "attacker" : "victim";
    return {
      name: text(
        record?.[`${prefix}Name`]
          ?? record?.[isAttacker ? "killerName" : "victimName"]
          ?? record?.[isAttacker ? "tk1" : "tk2"]
          ?? nested?.name
          ?? nested?.playerName,
      ),
      steamId: text(
        record?.[`${prefix}Steam64ID`]
          ?? record?.[`${prefix}SteamId`]
          ?? record?.[`${prefix}SteamID`]
          ?? nested?.steamId
          ?? nested?.steamID
          ?? nested?.steam64ID,
      ),
      eosId: text(
        record?.[`${prefix}EOSID`]
          ?? record?.[`${prefix}EosID`]
          ?? nested?.eosId
          ?? nested?.eosID,
      ),
      playerId: text(
        record?.[`${prefix}PlayerID`]
          ?? record?.[`${prefix}PlayerId`]
          ?? nested?.playerId
          ?? nested?.playerID
          ?? nested?.controllerId
          ?? nested?.controllerID,
      ),
    };
  }

  function resolveLivePlayer(serverId, identity) {
    const players = modules?.playerState;
    const live = (
      identity.steamId && players?.getPlayerBySteamID?.(serverId, identity.steamId)
    ) || (
      identity.eosId && players?.getPlayerByEOSID?.(serverId, identity.eosId)
    ) || (
      identity.playerId && players?.getPlayerByControllerID?.(serverId, identity.playerId)
    ) || (
      identity.name && players?.getPlayerByName?.(serverId, identity.name)
    ) || null;

    if (!live) return identity;
    return {
      name: text(live.name, identity.name),
      steamId: text(live.steamId ?? live.steamID ?? live.steam64ID, identity.steamId),
      eosId: text(live.eosId ?? live.eosID, identity.eosId),
      playerId: text(live.playerId ?? live.playerID ?? live.controllerId ?? live.controllerID, identity.playerId),
    };
  }

  function eventId(event, record, attacker, victim) {
    return text(event?.eventId ?? record?.sourceEventId ?? record?.id)
      || [
        text(record?.time ?? event?.time),
        text(record?.sourceRaw ?? event?.sourceRaw),
        attacker.steamId || attacker.eosId || attacker.playerId || attacker.name,
        victim.steamId || victim.eosId || victim.playerId || victim.name,
      ].join("|");
  }

  function claimEvent(id) {
    const now = Date.now();
    for (const [key, at] of handledEvents) {
      if (now - at > HANDLED_TTL_MS) handledEvents.delete(key);
    }
    if (!id || handledEvents.has(id)) return false;
    handledEvents.set(id, now);
    if (handledEvents.size > MAX_HANDLED_EVENTS) {
      const oldest = handledEvents.keys().next().value;
      if (oldest) handledEvents.delete(oldest);
    }
    return true;
  }

  function pushHistory(entry = {}) {
    history.unshift({
      id: `rcon-tk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      ...entry,
    });
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  }

  async function sendWarning(target, message, reason, relatedEventId) {
    const sender = modules?.adminWarn?.sendAdminWarn ?? modules?.adminWarn?.warnPlayer;
    if (typeof sender !== "function") throw new Error("adminWarn API unavailable");

    const result = await sender.call(modules.adminWarn, {
      targetName: target.name,
      targetSteamId: target.steamId || undefined,
      targetEosId: target.eosId || undefined,
      targetPlayerId: target.playerId || undefined,
      requireTargetPlayerId: false,
      message,
      reason,
      sourceModule: PLUGIN_ID,
      relatedEventId,
      system: true,
    });

    if (!result?.success) {
      throw new Error(text(result?.errorMessage ?? result?.error ?? result?.message, "AdminWarn failed"));
    }
    return result;
  }

  function attackerMessage(victim) {
    return `[友伤提醒] 你攻击了友军：${victim.name}`;
  }

  function victimMessage(attacker) {
    return `[友伤提醒] 你被友军 ${attacker.name} 攻击了`;
  }

  async function handleTeamKill(event = {}) {
    // 此条件防止 API 被其他调用方误喂入非 RCON TK 数据。
    if (text(event?.eventName, "TEAM_KILL").toUpperCase() !== "TEAM_KILL") return skip("not_team_kill");
    state.received += 1;
    state.lastReceivedAt = new Date().toISOString();

    if (!isActive()) return skip("disabled_or_unsubscribed");

    const record = resolveRecord(event);
    const serverId = text(record?.serverId ?? event?.serverId ?? core?.webStatus?.serverId);
    const attacker = resolveLivePlayer(serverId, resolveIdentity(record, "attacker"));
    const victim = resolveLivePlayer(serverId, resolveIdentity(record, "victim"));
    const relatedEventId = eventId(event, record, attacker, victim);

    if (!attacker.name || !victim.name) {
      return skip("identity_missing", { relatedEventId, attacker, victim });
    }
    if (!claimEvent(relatedEventId)) {
      return skip("duplicate", { relatedEventId, attacker, victim });
    }

    const outcomes = await Promise.allSettled([
      sendWarning(attacker, attackerMessage(victim), "rcon_team_kill_attacker", relatedEventId),
      sendWarning(victim, victimMessage(attacker), "rcon_team_kill_victim", relatedEventId),
    ]);

    const attackerOk = outcomes[0].status === "fulfilled";
    const victimOk = outcomes[1].status === "fulfilled";
    if (attackerOk) state.attackerAlerted += 1;
    if (victimOk) state.victimAlerted += 1;
    state.alerted += Number(attackerOk) + Number(victimOk);
    state.lastAlertedAt = new Date().toISOString();

    const failures = outcomes
      .filter((outcome) => outcome.status === "rejected")
      .map((outcome) => String(outcome.reason?.message ?? outcome.reason ?? "unknown error"));

    if (failures.length) {
      state.failed += failures.length;
      state.lastError = failures.join(" | ");
      logger?.warn?.(`[RconTeamKillAlert] notification failed: ${state.lastError}`);
    } else {
      state.lastError = "";
    }

    pushHistory({
      success: failures.length === 0,
      relatedEventId,
      serverId,
      attacker,
      victim,
      attackerAlerted: attackerOk,
      victimAlerted: victimOk,
      error: failures.join(" | "),
    });

    return {
      success: failures.length === 0,
      relatedEventId,
      attackerAlerted: attackerOk,
      victimAlerted: victimOk,
    };
  }

  function skip(reason, extra = {}) {
    state.skipped += 1;
    pushHistory({ success: false, skipped: true, reason, ...extra });
    return { success: false, skipped: true, reason };
  }

  function getState() {
    return {
      enabled: runtimeConfig.enabled,
      subscribed: isSubscribed(),
      active: isActive(),
      summary: { ...state },
      history: [...history],
    };
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "RCON TK 双向提醒",
      kind: "plugin",
      version: "1.0.0",
      category: "Moderation",
      description: "仅订阅 RCON TEAM_KILL 事件，分别私信攻击者和受害者。",
    },
    apiName: "rconTeamKillAlert",
    api: { getState, handleTeamKill },

    async start() {
      runtimeConfig = readConfig(config);
      const subscribe = core?.eventBus?.onCoreEvent;
      if (typeof subscribe === "function") {
        unsubscribers.push(subscribe.call(core.eventBus, "TEAM_KILL", (event) => {
          void handleTeamKill(event);
        }));
      } else {
        logger?.warn?.("[RconTeamKillAlert] core event bus unavailable; plugin is idle.");
      }
      logger?.info?.("[RconTeamKillAlert] started; listening only to RCON TEAM_KILL.");
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try { unsubscribe?.(); } catch {}
      }
      handledEvents.clear();
    },
  };
}

function readConfig(config) {
  const raw = config?.get?.(CONFIG_KEY, {}) ?? {};
  return { enabled: raw?.enabled !== false };
}

export default createPlugin;
