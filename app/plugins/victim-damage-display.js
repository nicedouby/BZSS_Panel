// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const PLUGIN_ID = "plugin.victimDamageDisplay";
const EVENT_MODULE_ID = "module.combatManager";
const EVENT_NAME = "COMBAT_EVENT_PROCESSED";
const HANDLED_TTL_MS = 10 * 60_000;
const MAX_HANDLED_EVENTS = 2_000;
const DEFAULT_ADMIN_PUNISHMENT_DAMAGE = 1_000_000;

export function createPlugin({ core = {}, modules = {}, config = null, logger = console } = {}) {
  const unsubscribers = [];
  const handledEvents = new Map();
  const auditRecords = [];
  const MAX_AUDIT_RECORDS = 500;
  let runtimeConfig = readRuntimeConfig(config);
  let weaponAliases = new Map();

  const state = {
    received: 0,
    displayed: 0,
    attackerDisplayed: 0,
    skipped: 0,
    invalidAttackerSkipped: 0,
    invalidVictimSkipped: 0,
    selfAttackerSkipped: 0,
    adminPunishmentSkipped: 0,
    duplicateSkipped: 0,
    nonDamageSkipped: 0,
    lastReceivedAt: "",
    lastDisplayedAt: "",
    lastSkipReason: "",
    lastError: "",
  };

  function isSubscribed() {
    return core?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false
      && modules?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false;
  }

  function isActive() {
    return runtimeConfig.enabled && isSubscribed();
  }

  function recordAudit(event, record, status, reason, extra = {}) {
    const damage = normalizeDamage(record?.damage);
    const attacker = resolveIdentity(record, "attacker");
    const victim = resolveIdentity(record, "victim");
    auditRecords.unshift({
      id: String(Date.now()) + "-" + String(auditRecords.length),
      createdAt: new Date().toISOString(),
      status, reason,
      damage: Number.isFinite(damage) ? damage : null,
      attacker: attacker.displayName || attacker.name || (attacker.isBot ? "BOT" : ""),
      attackerId: stableIdentity(attacker),
      victim: victim.displayName || victim.name || "",
      victimId: stableIdentity(victim),
      weapon: displayWeapon(record),
      friendlyFire: Boolean(record?.isFriendlyFire ?? record?.relation?.isFriendlyFire),
      message: extra.message || "",
      success: extra.success ?? null,
      error: extra.error || "",
    });
    if (auditRecords.length > MAX_AUDIT_RECORDS) auditRecords.length = MAX_AUDIT_RECORDS;
  }

  function getDebugSnapshot() {
    const byReason = {};
    const byStatus = {};
    for (const item of auditRecords) {
      byReason[item.reason] = (byReason[item.reason] ?? 0) + 1;
      byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
    }
    return { state: getState(), records: auditRecords.slice(), byReason, byStatus, maxRecords: MAX_AUDIT_RECORDS };
  }

  function clearDebugRecords() {
    auditRecords.length = 0;
    return getDebugSnapshot();
  }
  function skip(reason) {
    state.skipped += 1;
    state.lastSkipReason = reason;
    if (reason === "invalid_attacker") state.invalidAttackerSkipped += 1;
    else if (reason === "invalid_victim") state.invalidVictimSkipped += 1;
    else if (reason === "self_attacker") state.selfAttackerSkipped += 1;
    else if (reason === "admin_punishment_damage") state.adminPunishmentSkipped += 1;
    else if (reason === "duplicate") state.duplicateSkipped += 1;
    else if (reason === "non_damage") state.nonDamageSkipped += 1;
    return { success: false, skipped: true, skipReason: reason };
  }

  function resolveRecord(event = {}) {
    return event?.record ?? event?.payload?.record ?? event?.payload ?? event ?? {};
  }

  function normalizeText(value) {
    return String(value ?? "").normalize("NFKC").trim();
  }

  function normalizeDamage(value) {
    const damage = Number(value);
    return Number.isFinite(damage) ? damage : NaN;
  }

  function resolveIdentity(record = {}, side) {
    const prefix = side === "attacker" ? "attacker" : "victim";
    const nested = record?.[side] && typeof record[side] === "object" ? record[side] : {};
    return {
      name: normalizeText(record?.[`${prefix}Name`] ?? nested.displayName ?? nested.name ?? nested.playerName),
      displayName: normalizeText(nested.displayName ?? nested.name ?? record?.[`${prefix}Name`]),
      playerId: normalizeText(record?.[`${prefix}PlayerId`] ?? record?.[`${prefix}PlayerID`] ?? nested.playerId ?? nested.playerID ?? nested.controllerID),
      steamId: normalizeText(record?.[`${prefix}Steam64ID`] ?? record?.[`${prefix}SteamId`] ?? record?.[`${prefix}SteamID`] ?? nested.steam64ID ?? nested.steamId ?? nested.steamID),
      eosId: normalizeText(record?.[`${prefix}EOSID`] ?? record?.[`${prefix}EosID`] ?? nested.eosID ?? nested.eosId),
      controllerId: normalizeText(record?.[`${prefix}ControllerID`] ?? record?.[`${prefix}ControllerId`] ?? nested.controllerID ?? nested.controllerId),
      resolved: nested.resolved === true || record?.[`${prefix}Resolved`] === true,
      isFallback: nested.isFallback === true,
      isBot: nested.isBot === true,
    };
  }

  function resolveLiveIdentity(serverId, identity = {}) {
    const playerState = modules?.playerState;
    const lookup = {
      steamID: identity.steamId,
      steam64ID: identity.steamId,
      eosID: identity.eosId,
      controllerID: identity.controllerId,
      name: identity.name,
    };
    let player = playerState?.findPlayer?.(serverId, lookup)
      ?? (identity.steamId ? playerState?.getPlayerBySteamID?.(serverId, identity.steamId) : null)
      ?? (identity.eosId ? playerState?.getPlayerByEOSID?.(serverId, identity.eosId) : null)
      ?? (identity.controllerId ? playerState?.getPlayerByControllerID?.(serverId, identity.controllerId) : null)
      ?? (identity.name ? playerState?.getPlayerByName?.(serverId, identity.name) : null)
      ?? null;

    // 兼容不同 playerState API 版本，并确保取到 ListPlayers 返回的数字 playerID。
    if (!player) {
      const livePlayers = playerState?.getPlayerList?.(serverId) ?? playerState?.getOnlinePlayers?.(serverId) ?? [];
      player = Array.isArray(livePlayers)
        ? livePlayers.find((candidate) => liveIdentityMatches(candidate, identity)) ?? null
        : null;
    }
    if (!player) return identity;
    return {
      ...identity,
      name: identity.name || normalizeText(player.name),
      displayName: identity.displayName || normalizeText(player.name),
      playerId: normalizeText(player.playerID ?? player.playerId ?? identity.playerId),
      steamId: identity.steamId || normalizeText(player.steamID ?? player.steamId ?? player.steam64ID),
      eosId: identity.eosId || normalizeText(player.eosID ?? player.eosId),
      controllerId: identity.controllerId || normalizeText(player.controllerID ?? player.controllerId),
      resolved: true,
    };
  }

  function liveIdentityMatches(player = {}, identity = {}) {
    const same = (left, right) => {
      const a = normalizeText(left).toLocaleLowerCase();
      const b = normalizeText(right).toLocaleLowerCase();
      return Boolean(a && b && a === b);
    };
    return same(player.steamID ?? player.steamId ?? player.steam64ID, identity.steamId)
      || same(player.eosID ?? player.eosId, identity.eosId)
      || same(player.controllerID ?? player.controllerId, identity.controllerId)
      || same(player.name ?? player.playerName, identity.name);
  }

  function stableIdentity(identity = {}) {
    if (identity.playerId) return `player:${identity.playerId}`;
    if (identity.steamId) return `steam:${identity.steamId}`;
    if (identity.eosId) return `eos:${identity.eosId}`;
    if (identity.controllerId) return `controller:${identity.controllerId}`;
    return "";
  }

  function classifyAttackerSource(record, attacker, victim) {
    if (Boolean(record?.isBotAttack) || attacker.isBot) return { kind: "bot", label: "BOT" };

    const attackerKey = stableIdentity(attacker);
    const victimKey = stableIdentity(victim);

    // CombatClean uses the victim as a technical fallback when the original
    // attacker is null.  This is environment damage, not self-attack.
    if (attacker.isFallback) return { kind: "environment", label: "自身/环境" };

    // A real player may never be presented as having attacked themselves.
    // Compare names as a final fallback because explosive damage records can
    // lack a stable attacker ID even when CombatClean has a player name.
    const attackerName = normalizeText(attacker.displayName || attacker.name).toLocaleLowerCase();
    const victimName = normalizeText(victim.displayName || victim.name).toLocaleLowerCase();
    if ((victimKey && attackerKey && attackerKey === victimKey) || (attackerName && victimName && attackerName === victimName)) {
      return { kind: "self", label: "自身" };
    }

    if (attacker.isFallback || !attackerKey && !attackerName) return { kind: "environment", label: "自身/环境" };

    // Do not drop valid damage merely because the explosive/projectile record
    // has not resolved the attacker's stable ID yet.  A non-empty, different
    // name is still useful to the victim; otherwise it is environment damage.
    if (!attacker.resolved && !attackerName) return { kind: "environment", label: "自身/环境" };
    return {
      kind: "player",
      label: runtimeConfig.showAttackerName ? (attacker.displayName || attacker.name || "未知玩家") : "敌方玩家",
    };
  }

  function buildEventKey(event, record, attacker, victim, damage) {
    const direct = normalizeText(record?.id ?? record?.sourceEventId ?? event?.eventId);
    if (direct) return direct;
    const weapon = resolveWeaponRaw(record);
    return [event?.serverId ?? record?.serverId, record?.time ?? event?.time, stableIdentity(attacker), stableIdentity(victim), damage, weapon]
      .map(normalizeText)
      .join("|");
  }

  function pruneHandledEvents(now = Date.now()) {
    for (const [key, timestamp] of handledEvents) {
      if (now - timestamp > HANDLED_TTL_MS) handledEvents.delete(key);
    }
    while (handledEvents.size > MAX_HANDLED_EVENTS) {
      handledEvents.delete(handledEvents.keys().next().value);
    }
  }

  function isDuplicate(eventKey) {
    const now = Date.now();
    pruneHandledEvents(now);
    if (!eventKey || handledEvents.has(eventKey)) return true;
    handledEvents.set(eventKey, now);
    return false;
  }

  function resolveWeaponRaw(record = {}) {
    const weapon = record?.weapon;
    if (weapon && typeof weapon === "object") {
      return normalizeText(weapon.displayName ?? weapon.cleaned ?? weapon.raw ?? weapon.name);
    }
    return normalizeText(weapon ?? record?.weaponName ?? record?.causedBy ?? record?.rawCausedBy);
  }

  function displayWeapon(record) {
    const raw = resolveWeaponRaw(record);
    if (!raw) return "";
    const normalized = raw.toLowerCase();
    if (weaponAliases.has(normalized)) return weaponAliases.get(normalized);
    for (const [alias, label] of weaponAliases) {
      if (normalized.includes(alias)) return label;
    }

    // Generated UE object names often contain a long instance suffix.  Keep
    // the useful weapon stem, then cap the remaining display value.
    const compact = raw
      .replace(/^\/?(?:game|content)\/[^/]+\//i, "")
      .replace(/(?:[_-](?:c|copy|instance|gen|generated))?[_-]\d{3,}.*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    return compact.length > 36 ? `${compact.slice(0, 35)}…` : compact;
  }

  function formatDamage(damage) {
    return Number.isInteger(damage) ? String(damage) : String(Math.round(damage * 100) / 100);
  }

  function buildVictimMessage(record, source, damage) {
    const relation = record?.relation ?? {};
    const friendly = Boolean(record?.isFriendlyFire ?? relation.isFriendlyFire);
    const sourceLabel = friendly && source.kind === "player" && runtimeConfig.showFriendlyFireLabel
      ? `友伤：${source.label}`
      : `来源：${source.label}`;
    const weapon = runtimeConfig.showWeapon ? `｜武器：${displayWeapon(record)}` : "";
    return `受到 ${formatDamage(damage)} 点伤害｜${sourceLabel}${weapon}`;
  }

  async function sendDamageWarning(event, record, target, message, reason, requireTargetPlayerId = false) {
    const sender = modules?.adminWarn?.warnPlayer ?? modules?.adminWarn?.sendAdminWarn;
    if (typeof sender !== "function") throw new Error("adminWarn API unavailable");
    return sender.call(modules.adminWarn, {
      targetPlayerId: target.playerId || undefined,
      targetName: target.name || undefined,
      targetEosId: target.eosId || undefined,
      targetSteamId: target.steamId || undefined,
      requireTargetPlayerId,
      message,
      reason,
      sourceModule: PLUGIN_ID,
      relatedEventId: normalizeText(record?.id ?? event?.eventId),
      system: true,
    });
  }

  async function handleCombatEvent(event = {}) {
    if (!isActive()) return skip("disabled");
    state.received += 1;
    state.lastReceivedAt = new Date().toISOString();
    const record = resolveRecord(event);
    if (event?.isReplay === true || record?.isReplay === true || event?.canTriggerActions === false || record?.canTriggerActions === false) {
      recordAudit(event, record, "intercepted", "replay_event");
      return skip("replay_event");
    }
    if (normalizeText(record?.type).toLowerCase() !== "damage") return skip("non_damage");

    const damage = normalizeDamage(record?.damage);
    if (!(damage > 0)) { recordAudit(event, record, "intercepted", "invalid_damage"); return skip("invalid_damage"); }

    const serverId = normalizeText(record?.serverId ?? event?.serverId ?? core?.webStatus?.serverId);
    const victim = resolveLiveIdentity(serverId, resolveIdentity(record, "victim"));
    if (!victim.playerId && !victim.name) { recordAudit(event, record, "intercepted", "invalid_victim"); return skip("invalid_victim"); }
    const attacker = resolveLiveIdentity(serverId, resolveIdentity(record, "attacker"));
    const source = classifyAttackerSource(record, attacker, victim);

    const eventKey = buildEventKey(event, record, attacker, victim, damage);
    if (isDuplicate(eventKey)) { recordAudit(event, record, "intercepted", "duplicate"); return skip("duplicate"); }

    try {
      const victimMessage = buildVictimMessage(record, source, damage);
      const canWarnVictim = runtimeConfig.showVictimDamage && /^\d+$/.test(victim.playerId);
      if (runtimeConfig.showVictimDamage && !canWarnVictim) {
        state.invalidVictimSkipped += 1;
        logger?.warn?.(`[VictimDamageDisplay] victim warning skipped: numeric ListPlayers playerID unavailable victim=${victim.name || victim.steamId || victim.eosId || victim.controllerId || "unknown"}`);
      }

      // 伤害信息只发送给受害者。攻击者永远不接收任何伤害反馈，
      // 避免向可疑玩家暴露命中结果，同时便于受害者追踪伤害来源。
      const victimResult = runtimeConfig.showVictimDamage
        ? (canWarnVictim
          ? settledResult(await settle(sendDamageWarning(
            event,
            record,
            victim,
            victimMessage,
            "victim_damage_display",
            true,
          )))
          : { success: false, skipped: true, skipReason: "victim_unavailable" })
        : { success: false, skipped: true, skipReason: "victim_display_disabled" };
      const attackerResult = {
        success: false,
        skipped: true,
        skipReason: "attacker_display_forbidden",
      };
      const success = Boolean(victimResult.success);
      const errorMessage = victimResult.errorMessage || "";

      recordAudit(event, record, success ? "warned" : "send_failed", success ? "admin_warn_sent" : "admin_warn_failed", {
        message: victimResult.success ? victimMessage : "",
        success,
        error: errorMessage,
      });
      if (victimResult.success) state.displayed += 1;
      if (success) state.lastDisplayedAt = new Date().toISOString();
      if (errorMessage) state.lastError = errorMessage;
      return { success, victimResult, attackerResult };
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : String(error);
      logger?.warn?.(`[VictimDamageDisplay] warning failed: ${state.lastError}`);
      recordAudit(event, record, "send_failed", "admin_warn_exception", { error: state.lastError });
      return { success: false, error: state.lastError };
    }
  }

  async function loadWeaponAliases() {
    const aliases = new Map();
    const configured = runtimeConfig.weaponAliases;
    for (const [alias, label] of Object.entries(configured)) addAlias(aliases, alias, label);
    if (runtimeConfig.weaponAliasFile) {
      try {
        const filePath = path.resolve(process.cwd(), runtimeConfig.weaponAliasFile);
        const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
        for (const [alias, label] of Object.entries(parsed ?? {})) addAlias(aliases, alias, label);
      } catch (error) {
        if (error?.code !== "ENOENT") logger?.warn?.(`[VictimDamageDisplay] weapon alias file unavailable: ${error?.message ?? error}`);
      }
    }
    weaponAliases = new Map([...aliases.entries()].sort((a, b) => b[0].length - a[0].length));
  }

  function getState() {
    return {
      enabled: runtimeConfig.enabled,
      subscribed: isSubscribed(),
      active: isActive(),
      config: { ...runtimeConfig, weaponAliases: undefined },
      weaponAliasCount: weaponAliases.size,
      handledEventCount: handledEvents.size,
      ...state,
    };
  }

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "战斗伤害显示",
      kind: "plugin",
      version: "1.3.0",
      category: "Combat",
      description: "订阅清洗后的伤害事件，只向受害者发送包含伤害来源的私人提示，攻击者永不接收伤害反馈。",
    },
    apiName: "victimDamageDisplay",
    api: { getState, handleCombatEvent, displayWeapon, getDebugSnapshot, clearDebugRecords },
    async start() {
      runtimeConfig = readRuntimeConfig(config);
      await loadWeaponAliases();
      unsubscribers.push(core?.eventBus?.onModuleEvent?.(EVENT_MODULE_ID, EVENT_NAME, (event) => { void handleCombatEvent(event); }));
      logger?.info?.("[VictimDamageDisplay] started; listening only to COMBAT_EVENT_PROCESSED.");
    },
    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try { unsubscribe?.(); } catch {}
      }
      handledEvents.clear();
      auditRecords.length = 0;
      weaponAliases.clear();
    },
  };
}

async function settle(promise) {
  try {
    return { status: "fulfilled", value: await promise };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

function settledResult(result) {
  if (result?.status === "fulfilled") return result.value ?? { success: false };
  const errorMessage = result?.reason instanceof Error ? result.reason.message : String(result?.reason ?? "AdminWarn failed");
  return { success: false, errorMessage };
}

function readRuntimeConfig(config) {
  const raw = config?.get?.("plugins.victimDamageDisplay", {}) ?? {};
  const adminPunishmentDamage = Number(raw.adminPunishmentDamage);
  return {
    enabled: raw.enabled !== false,
    showWeapon: raw.showWeapon !== false,
    showVictimDamage: raw.showVictimDamage !== false,
    // 安全策略：攻击者伤害反馈永久关闭，不允许配置重新启用。
    showAttackerDamage: false,
    showAttackerName: raw.showAttackerName !== false,
    showFriendlyFireLabel: raw.showFriendlyFireLabel !== false,
    adminPunishmentDamage: Number.isFinite(adminPunishmentDamage) ? adminPunishmentDamage : DEFAULT_ADMIN_PUNISHMENT_DAMAGE,
    weaponAliasFile: String(raw.weaponAliasFile ?? "./config/victim-damage-display-weapons.json").trim(),
    weaponAliases: raw.weaponAliases && typeof raw.weaponAliases === "object" ? raw.weaponAliases : {},
  };
}

function addAlias(map, alias, label) {
  const key = String(alias ?? "").trim().toLowerCase();
  const value = String(label ?? "").trim();
  if (key && value) map.set(key, value);
}

export default { createPlugin };
