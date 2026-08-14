// -*- coding: utf-8 -*-

const PLUGIN_ID = "plugin.enemy-combat-feedback";
const COMBAT_MODULE_ID = "module.combatState";
const COMBAT_EVENT_NAME = "combatEvent";
const HANDLED_TTL_MS = 60_000;
const MAX_HANDLED_EVENTS = 2_000;

const DEFAULT_CONFIG = {
  enabled: true,
  damageEnabled: false,
  woundEnabled: true,
  deathEnabled: true,
  ignoreGiveUp: true,
  requirePlayerId: true,
  damageMessage: "[伤害反馈] 你对 {victim} 造成了 {damage} 点伤害",
  woundMessage: "[击杀反馈] 你击倒了 {victim}",
  deathMessage: "[击杀反馈] 你击杀了 {victim}",
};

export function createPlugin({ core = {}, modules = {}, config = null, logger = console } = {}) {
  const unsubscribers = [];
  const handledEventIds = new Map();
  let runtimeConfig = readConfig(config);

  const state = {
    totalDamageFeedback: 0,
    totalWoundFeedback: 0,
    totalDeathFeedback: 0,
    totalSkipped: 0,
    totalSendFailed: 0,
    lastFeedbackAt: "",
    lastError: "",
  };

  function readConfig(configStore) {
    const value = configStore?.get?.("plugins.enemyCombatFeedback", {});
    return { ...DEFAULT_CONFIG, ...(value && typeof value === "object" ? value : {}) };
  }

  function normalizeText(value) {
    return String(value ?? "").normalize("NFKC").trim();
  }

  function normalizeName(value) {
    return normalizeText(value).replace(/\s+/g, " ").toLocaleLowerCase();
  }

  function normalizeTeamId(value) {
    const normalized = normalizeText(value);
    if (!normalized || normalized === "0" || normalized.toLocaleLowerCase() === "null" || normalized.toLocaleLowerCase() === "undefined") return "";
    return normalized;
  }

  function getRecord(event = {}) {
    return event?.record ?? event?.payload?.record ?? event?.payload ?? event ?? {};
  }

  function isSubscribed() {
    return core?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false
      && modules?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false;
  }

  function skip(reason) {
    state.totalSkipped += 1;
    logger?.debug?.(`[EnemyCombatFeedback] skipped reason=${reason}`);
    return { success: false, skipped: true, reason };
  }

  function getEventId(event, record) {
    const direct = normalizeText(record?.id ?? record?.sourceEventId ?? event?.eventId);
    if (direct) return direct;
    return [
      normalizeText(record?.serverId ?? event?.serverId),
      normalizeText(record?.time ?? event?.time),
      normalizeText(record?.type),
      normalizeText(record?.attackerSteam64ID),
      normalizeText(record?.victimSteam64ID),
    ].join("|");
  }

  function cleanupHandledEvents(now = Date.now()) {
    for (const [id, timestamp] of handledEventIds) {
      if (now - timestamp > HANDLED_TTL_MS) handledEventIds.delete(id);
    }
    while (handledEventIds.size > MAX_HANDLED_EVENTS) {
      handledEventIds.delete(handledEventIds.keys().next().value);
    }
  }

  function claimEvent(eventId) {
    const now = Date.now();
    cleanupHandledEvents(now);
    if (!eventId || handledEventIds.has(eventId)) return false;
    handledEventIds.set(eventId, now);
    return true;
  }

  function sameIdentity(record) {
    const pairs = [
      [record?.attackerSteam64ID, record?.victimSteam64ID],
      [record?.attackerEOSID, record?.victimEOSID],
      [record?.attackerControllerID, record?.victimControllerID],
    ];
    if (pairs.some(([left, right]) => normalizeText(left) && normalizeText(left) === normalizeText(right))) return true;
    const attackerName = normalizeName(record?.attackerName);
    const victimName = normalizeName(record?.victimName);
    return Boolean(attackerName && victimName && attackerName === victimName);
  }

  function isConfirmedEnemy(record) {
    const attackerTeamID = normalizeTeamId(record?.attackerTeamID);
    const victimTeamID = normalizeTeamId(record?.victimTeamID);
    return Boolean(attackerTeamID && victimTeamID && attackerTeamID !== victimTeamID);
  }

  function isGiveUp(record) {
    const flags = Array.isArray(record?.eventFlags) ? record.eventFlags : [];
    return flags.some((flag) => normalizeText(flag?.key).toLocaleLowerCase() === "give_up")
      || (Array.isArray(record?.eventFlagLabels) && record.eventFlagLabels.some((label) => normalizeText(label) === "放弃"));
  }

  function hasFriendlyFire(record) {
    return record?.isFriendlyFire === true
      || record?.isTeamKill === true
      || record?.isTeamKillDown === true
      || record?.tk === true
      || record?.tkDown === true
      || ["team_damage", "team_wound", "team_kill"].includes(normalizeText(record?.friendlyFireType).toLocaleLowerCase());
  }

  function resolveAttacker(serverId, record) {
    const playerState = modules?.playerState;
    return playerState?.getPlayerBySteamID?.(serverId, record?.attackerSteam64ID)
      ?? playerState?.getPlayerByEOSID?.(serverId, record?.attackerEOSID)
      ?? playerState?.getPlayerByControllerID?.(serverId, record?.attackerControllerID)
      ?? playerState?.getPlayerByName?.(serverId, record?.attackerName)
      ?? null;
  }

  function playerIdOf(player) {
    return normalizeText(player?.playerID ?? player?.playerId);
  }

  function safeVictimName(record) {
    const victim = normalizeText(record?.victimName).replaceAll('"', "").replace(/[\r\n]+/g, " ");
    return (victim || "未知玩家").slice(0, 80);
  }

  function formatDamage(value) {
    const damage = Number(value);
    if (!Number.isFinite(damage)) return "";
    return Number.isInteger(damage) ? String(damage) : String(Math.round(damage * 100) / 100);
  }

  function formatMessage(template, record) {
    return String(template ?? "")
      .replaceAll("{victim}", safeVictimName(record))
      .replaceAll("{damage}", formatDamage(record?.damage));
  }

  async function handleCombatEvent(event = {}) {
    runtimeConfig = readConfig(config);
    if (!runtimeConfig.enabled || !isSubscribed()) return skip("disabled");

    const record = getRecord(event);
    if (event?.isReplay === true || record?.isReplay === true || event?.canTriggerActions === false || record?.canTriggerActions === false) {
      return skip("replay_event");
    }
    const type = normalizeText(record?.type).toLocaleLowerCase();
    if (type !== "damage" && type !== "wound" && type !== "death") return skip("unsupported_type");
    // 全局策略：彻底关闭实时伤害显示。即使配置误设 damageEnabled=true，
    // damage 事件也永远不会向攻击者发送 AdminWarn；击倒和击杀反馈保持独立。
    if (type === "damage") return skip("damage_display_disabled");
    if (type === "wound" && !runtimeConfig.woundEnabled) return skip("wound_disabled");
    if (type === "death" && !runtimeConfig.deathEnabled) return skip("death_disabled");
    if (type === "damage" && !(Number(record?.damage) > 0)) return skip("invalid_damage");
    if (hasFriendlyFire(record)) return skip("friendly_fire");
    if (sameIdentity(record)) return skip("self_damage");
    if (!isConfirmedEnemy(record)) return skip("team_unknown");
    if (type === "death" && runtimeConfig.ignoreGiveUp && isGiveUp(record)) return skip("give_up");

    const eventId = getEventId(event, record);
    if (!claimEvent(eventId)) return skip("duplicate_event");

    const serverId = normalizeText(record?.serverId ?? event?.serverId ?? core?.webStatus?.serverId);
    const attacker = resolveAttacker(serverId, record);
    if (!attacker) return skip("attacker_missing");

    const playerID = playerIdOf(attacker);
    if (runtimeConfig.requirePlayerId && !playerID) return skip("player_id_missing");

    const template = type === "damage"
      ? runtimeConfig.damageMessage
      : type === "wound"
        ? runtimeConfig.woundMessage
        : runtimeConfig.deathMessage;
    const message = formatMessage(template, record);
    const reason = `enemy_combat_feedback_${type}`;

    try {
      const result = await modules?.adminWarn?.sendAdminWarn?.({
        targetName: normalizeText(attacker.name) || normalizeText(record?.attackerName),
        targetPlayerId: playerID || undefined,
        targetSteamId: normalizeText(attacker.steamID ?? attacker.steamId ?? record?.attackerSteam64ID) || undefined,
        targetEosId: normalizeText(attacker.eosID ?? attacker.eosId ?? record?.attackerEOSID) || undefined,
        requireTargetPlayerId: Boolean(runtimeConfig.requirePlayerId),
        message,
        sourceModule: PLUGIN_ID,
        reason,
        relatedEventId: eventId,
        system: true,
      });
      if (!result?.success) {
        state.totalSendFailed += 1;
        state.lastError = normalizeText(result?.errorMessage ?? result?.error ?? "AdminWarn failed");
        logger?.warn?.(`[EnemyCombatFeedback] send failed: ${state.lastError}`);
        return { success: false, error: state.lastError };
      }

      if (type === "damage") state.totalDamageFeedback += 1;
      else if (type === "wound") state.totalWoundFeedback += 1;
      else state.totalDeathFeedback += 1;
      state.lastFeedbackAt = new Date().toISOString();
      logger?.info?.(`[EnemyCombatFeedback] ${type} attacker=${normalizeText(attacker.name)} victim=${safeVictimName(record)} playerID=${playerID}`);
      return result;
    } catch (error) {
      state.totalSendFailed += 1;
      state.lastError = error instanceof Error ? error.message : String(error);
      logger?.warn?.(`[EnemyCombatFeedback] send exception: ${state.lastError}`);
      return { success: false, error: state.lastError };
    }
  }

  function getState() {
    return { ...state };
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "敌方战斗反馈",
      kind: "plugin",
      version: "0.3.0",
      description: "仅在击倒或击杀敌方玩家时向攻击者发送私人反馈；实时伤害显示永久关闭。",
    },
    api: { getState, handleCombatEvent },
    async start() {
      if (!isSubscribed()) return;
      unsubscribers.push(core?.eventBus?.onModuleEvent?.(COMBAT_MODULE_ID, COMBAT_EVENT_NAME, (event) => {
        void handleCombatEvent(event);
      }));
      logger?.info?.("[EnemyCombatFeedback] started");
    },
    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe?.();
      handledEventIds.clear();
    },
  };
}
