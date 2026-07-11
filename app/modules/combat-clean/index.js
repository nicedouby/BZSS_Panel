// -*- coding: utf-8 -*-

import {
  CombatEventTags,
  ConfidenceTags,
  DamageSourceTags,
  IdentityTags,
  RelationTags,
  SmallArmTags,
  TeamKillTags,
  WeaponCategoryTags,
} from "./tags.js";
import { classifyWeaponType, weaponTypeLabelForKey } from "./weapon-type.js";

const VALID_TYPES = new Set(["damage", "wound", "kill", "revive"]);
const DEFAULT_MAX_EVENTS = 1200;
const DEFAULT_WEAPON_HISTORY_WINDOW_MS = 300000;
const SQUID_BOT_CONTROLLER_ID = "SquidBotAIController_C";
const FALLBACK_REASON = "attacker_nullptr_use_victim";
const BOT_PROJECTILE_NULLPTR_REASON = "nullptr_projectile_7_62mm";
const WEAPON_PLACEHOLDER_PATTERNS = [
  /\bsoldier\b/i,
  /\brifleman\d*\b/i,
  /\bmarksman\b/i,
  /\bmedic\b/i,
  /\bgrenadier\b/i,
  /\bcrewman\b/i,
  /\bpilot\b/i,
  /\bengineer\b/i,
  /\brecon\b/i,
  /\bcommander\b/i,
  /\bautomatic rifleman\b/i,
];

export function createCombatCleanModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.combatClean",
    source: "module.combatClean",
    channel: "module",
  }) ?? core.logger;
  const moduleConfig = config?.get?.("modules.combatClean", {}) ?? {};
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const maxEvents = Math.max(1, Number(moduleConfig.maxEvents ?? DEFAULT_MAX_EVENTS));
  const weaponHistoryBackfillConfig = moduleConfig.weaponHistoryBackfill ?? {};
  const weaponHistoryBackfillEnabled = Boolean(weaponHistoryBackfillConfig.enabled ?? true);
  const weaponHistoryWindowMs = Math.max(1000, Number(weaponHistoryBackfillConfig.windowMs ?? DEFAULT_WEAPON_HISTORY_WINDOW_MS));
  const events = [];
  const rejected = [];
  const sourceEventIds = new Set();
  const recentWeaponHistory = new Map();
  const unsubscribers = [];
  let lastUpdatedAt = "";

  function ingest(event, { optionalTkFeed = false } = {}) {
    if (!isSubscribed()) return null;

    const rawRecord = event?.record ?? event?.rawRecord ?? null;
    if (!rawRecord || typeof rawRecord !== "object") {
      return reject(event, rawRecord, "missing_raw_record", ["module.combatState event does not include record"]);
    }

    const sourceEventId = String(rawRecord.sourceEventId ?? event?.eventId ?? rawRecord.id ?? "").trim();
    if (optionalTkFeed && sourceEventId && sourceEventIds.has(sourceEventId)) return null;

    const cleanType = normalizeType(rawRecord.type, event);
    if (!cleanType) {
      return reject(event, rawRecord, "unsupported_type", [`Unsupported raw combat type: ${String(rawRecord.type ?? "")}`]);
    }

    const victimIdentity = extractIdentity(rawRecord, "victim");
    if (isNullishPlayerValue(victimIdentity.name)) {
      return reject(event, rawRecord, "missing_victim", ["Victim is null, nullptr, or empty"]);
    }

    const warnings = [];
    const attackerIdentity = extractIdentity(rawRecord, "attacker");

    const serverId = String(rawRecord.serverId ?? event?.serverId ?? core.webStatus?.serverId ?? "");
    const time = String(rawRecord.time ?? event?.time ?? new Date().toISOString());
    const timeMs = parseTimestampMs(time);
    const weapon = buildWeapon(rawRecord);
    const victim = makePlayerRef(serverId, victimIdentity, rawRecord, "victim");
    // Death records reuse the latest wound weapon within the history window.
    const resolvedWeapon = cleanType === "kill"
      ? resolveWeaponHistory({
        weapon,
        serverId,
        victim,
        eventTimeMs: timeMs,
        enabled: weaponHistoryBackfillEnabled,
        windowMs: weaponHistoryWindowMs,
      })
      : { weapon, applied: false };
    const finalWeapon = resolvedWeapon.weapon;
    const botAttack = buildBotAttackContext(finalWeapon, rawRecord);
    let resolvedAttackerIdentity = attackerIdentity;
    let attackerFallback = false;
    if (!botAttack.isBotAttack && isNullishPlayerValue(resolvedAttackerIdentity.name)) {
      resolvedAttackerIdentity = { ...victimIdentity };
      attackerFallback = true;
      warnings.push(FALLBACK_REASON);
    }
    const attacker = botAttack.isBotAttack
      ? makeBotPlayerRef(botAttack.reason)
      : makePlayerRef(serverId, resolvedAttackerIdentity, rawRecord, "attacker", {
        isFallback: attackerFallback,
        fallbackReason: attackerFallback ? FALLBACK_REASON : "",
      });
    const relation = buildRelation(cleanType, attacker, victim, rawRecord, { botAttack });
    if (resolvedWeapon.applied) warnings.push("weapon_history_backfill");
    const eventFlags = buildEventFlags(rawRecord, relation, { cleanType, weapon: finalWeapon, botAttack });
    const tags = buildProcessedCombatTags({
      cleanType,
      rawRecord,
      attacker,
      victim,
      weapon: finalWeapon,
      relation,
      warnings,
      botAttack,
    });
    const warningState = buildInitialWarningState();
    const record = {
      id: makeCleanId(cleanType, sourceEventId, rawRecord),
      serverId,
      matchId: firstPresent(rawRecord.matchId, rawRecord.matchID, event?.matchId),
      time,
      eventTime: timeMs,
      logTimeMs: parseTimestampMs(rawRecord.logTimeMs ?? rawRecord.logTime ?? event?.logTime ?? time),
      logTimeText: String(rawRecord.logTimeText ?? rawRecord.logTime ?? event?.logTime ?? ""),
      logTime: String(rawRecord.logTime ?? event?.logTime ?? ""),
      type: cleanType,
      eventName: cleanType === "damage" ? "BZSS_DAMAGE" : cleanType === "wound" ? "BZSS_WOUND" : cleanType === "revive" ? "BZSS_REVIVE" : "BZSS_KILL",
      attacker,
      victim,
      attackerName: attacker.name || attacker.displayName || "",
      attackerEosId: attacker.eosID || "",
      attackerEOSID: attacker.eosID || "",
      attackerSteamId: attacker.steam64ID || "",
      attackerSteam64ID: attacker.steam64ID || "",
      attackerControllerId: attacker.controllerID || "",
      attackerControllerID: attacker.controllerID || "",
      attackerTeamId: normalizeOptionalNumber(attacker.teamID),
      attackerTeamID: normalizeOptionalNumber(attacker.teamID),
      victimName: victim.name || victim.displayName || "",
      victimEosId: victim.eosID || "",
      victimEOSID: victim.eosID || "",
      victimSteamId: victim.steam64ID || "",
      victimSteam64ID: victim.steam64ID || "",
      victimControllerId: victim.controllerID || "",
      victimControllerID: victim.controllerID || "",
      victimTeamId: normalizeOptionalNumber(victim.teamID),
      victimTeamID: normalizeOptionalNumber(victim.teamID),
      damage: parseDamage(rawRecord.damage),
      weapon: finalWeapon,
      weaponClass: String(finalWeapon?.typeKey ?? "").trim(),
      weaponName: String(finalWeapon?.displayName ?? finalWeapon?.cleaned ?? finalWeapon?.raw ?? ""),
      tags,
      isBotAttack: botAttack.isBotAttack,
      botAttackReason: botAttack.reason,
      relation,
      displayText: buildDisplayText(cleanType, attacker, victim, finalWeapon, rawRecord.damage, relation),
      eventFlags,
      eventFlagLabels: eventFlags.map((flag) => String(flag?.label ?? "")).filter(Boolean),
      warningState,
      notify: warningState,
      rawLog: String(rawRecord.rawLog ?? event?.rawLog ?? "").substring(0, 300),
      raw: {
        sourceModule: "module.combatState",
        sourceEventId,
        rawLog: String(rawRecord.rawLog ?? event?.rawLog ?? "").substring(0, 300),
      },
      parse: {
        status: String(rawRecord.parseStatus ?? "Cleaned"),
        warnings,
      },
    };

    if (cleanType === "wound" && weaponHistoryBackfillEnabled && !resolvedWeapon.applied) {
      rememberWeaponHistory({
        store: recentWeaponHistory,
        serverId,
        victim,
        weapon: finalWeapon,
        eventTimeMs: timeMs,
        sourceEventId,
        type: cleanType,
        windowMs: weaponHistoryWindowMs,
      });
    }

    events.push(record);
    if (sourceEventId) sourceEventIds.add(sourceEventId);
    if (events.length > maxEvents) {
      const removed = events.splice(0, events.length - maxEvents);
      for (const item of removed) {
        const removedSourceEventId = String(item?.sourceEventId ?? "").trim();
        if (removedSourceEventId) sourceEventIds.delete(removedSourceEventId);
      }
    }
    lastUpdatedAt = record.time || new Date().toISOString();

    core.eventBus.emitModuleEvent("module.combatClean", `${cleanType}Resolved`, {
      eventId: `module.combatClean:${record.id}`,
      eventName: `module.combatClean.${cleanType}Resolved`,
      layer: "module",
      source: "module.combatClean",
      serverId: record.serverId,
      time: new Date().toISOString(),
      record,
    });
    if (cleanType !== "revive") {
      core.eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
        eventId: `module.combatClean.processed:${record.id}`,
        eventName: "combat.record.processed",
        layer: "module",
        source: "module.combatClean",
        serverId: record.serverId,
        time: new Date().toISOString(),
        record,
      });
    }
    core.eventBus.emitModuleEvent("module.combatClean", "updated", {
      eventId: `module.combatClean.updated:${Date.now()}`,
      eventName: "module.combatClean.updated",
      layer: "module",
      source: "module.combatClean",
      serverId: record.serverId,
      time: new Date().toISOString(),
      record,
      overview: api.getOverview(record.serverId),
    });

    logWithFallback(moduleLogger, "debug", () => `CombatClean accepted ${record.eventName}`, {
      operation: "ingest",
      eventName: record.eventName,
      data: { id: record.id, displayText: record.displayText },
    });

    return record;
  }

  function reject(event, rawRecord, status, warnings = []) {
    const item = {
      id: `rejected:${Date.now()}:${Math.random().toString(16).slice(2)}`,
      serverId: String(rawRecord?.serverId ?? event?.serverId ?? core.webStatus?.serverId ?? ""),
      time: String(rawRecord?.time ?? event?.time ?? new Date().toISOString()),
      status,
      warnings,
      raw: {
        sourceModule: "module.combatState",
        sourceEventId: String(rawRecord?.sourceEventId ?? event?.eventId ?? ""),
        rawLog: String(rawRecord?.rawLog ?? event?.rawLog ?? "").substring(0, 300),
      },
    };
    rejected.push(item);
    if (rejected.length > 300) rejected.splice(0, rejected.length - 300);
    core.eventBus.emitModuleEvent("module.combatClean", "rejected", {
      eventId: `module.combatClean:${item.id}`,
      eventName: "module.combatClean.rejected",
      layer: "module",
      source: "module.combatClean",
      serverId: item.serverId,
      time: new Date().toISOString(),
      rejection: item,
    });
    return item;
  }

  function makePlayerRef(serverId, identity, rawRecord, side, patch = {}) {
    const rawRef = {
      name: cleanPlayerValue(identity.name),
      teamID: identity.teamID ?? "",
      squadID: identity.squadID ?? "",
      steam64ID: cleanPlayerValue(identity.steam64ID),
      eosID: cleanPlayerValue(identity.eosID),
      controllerID: cleanPlayerValue(identity.controllerID),
      displayName: cleanPlayerValue(identity.name),
      playerId: cleanPlayerValue(identity.playerId ?? identity.playerID ?? identity.id),
      role: "",
      isLeader: false,
      resolved: false,
      resolutionSource: "raw",
      isNullptr: isNullishPlayerValue(identity.name),
      isFallback: false,
      fallbackReason: "",
    };

    const resolution = resolvePlayer(serverId, identity);
    if (resolution.player) {
      mergePlayer(rawRef, resolution.player);
      rawRef.resolved = true;
      rawRef.resolutionSource = resolution.source;
    } else if (rawRef.name || rawRef.steam64ID || rawRef.eosID || rawRef.controllerID) {
      rawRef.resolved = true;
      rawRef.resolutionSource = hasRawId(rawRef) ? "raw_id" : "raw_name";
    }

    if (side === "attacker" && patch.isFallback) {
      rawRef.isNullptr = false;
    }

    return {
      ...rawRef,
      ...patch,
    };
  }

  function makeBotPlayerRef(reason = "exact_projectile") {
    return {
      name: "",
      teamID: "",
      squadID: "",
      steam64ID: "",
      eosID: "",
      controllerID: "",
      displayName: "bot",
      role: "",
      isLeader: false,
      resolved: false,
      resolutionSource: "bot",
      isNullptr: false,
      isFallback: false,
      fallbackReason: "",
      isBot: true,
      botReason: reason,
    };
  }

  function resolvePlayer(serverId, identity = {}) {
    const steam64ID = cleanPlayerValue(identity.steam64ID);
    const eosID = cleanPlayerValue(identity.eosID);
    const controllerID = cleanPlayerValue(identity.controllerID);
    const name = cleanPlayerValue(identity.name);

    const playerState = modules?.playerState;
    const playerStatePlayer = playerState?.findPlayer?.(serverId, {
      steam64ID,
      eosID,
      controllerID,
      name,
    })
      ?? playerState?.getPlayerBySteamID?.(serverId, steam64ID)
      ?? playerState?.getPlayerByEOSID?.(serverId, eosID)
      ?? playerState?.getPlayerByControllerID?.(serverId, controllerID)
      ?? playerState?.getPlayerByName?.(serverId, name)
      ?? null;
    if (playerStatePlayer) {
      return { player: playerStatePlayer, source: "module.playerState" };
    }

    const matchPlayers = modules?.matchState?.getState?.()?.players;
    if (!matchPlayers) return { player: null, source: "" };

    const matchPlayer = matchPlayers.bySteam64ID?.[steam64ID]
      ?? matchPlayers.byEOSID?.[eosID]
      ?? matchPlayers.byControllerID?.[controllerID]
      ?? matchPlayers.byName?.[name]
      ?? findPlayerByNormalizedName(matchPlayers.list, serverId, name)
      ?? null;
    if (matchPlayer) {
      return { player: matchPlayer, source: "module.matchState" };
    }

    return { player: null, source: "" };
  }

  function buildRelation(type, attacker, victim, rawRecord, context = {}) {
    const attackerTeamID = context?.botAttack?.isBotAttack ? "" : firstPresent(rawRecord.attackerTeamID, attacker.teamID);
    const victimTeamID = firstPresent(rawRecord.victimTeamID, victim.teamID);
    const sameTeam = sameKnownTeam(attackerTeamID, victimTeamID);
    const rawFriendly = Boolean(rawRecord.isFriendlyFire || rawRecord.isTeamKill || rawRecord.tk || rawRecord.tkDown);
    const botAttack = Boolean(context?.botAttack?.isBotAttack);
    if (String(type ?? "").trim().toLowerCase() === "revive") {
      return {
        attackerTeamID,
        victimTeamID,
        sameTeam,
        isFriendlyFire: false,
        friendlyFireType: "",
        teamSource: resolveTeamSource(rawRecord, attacker, victim),
      };
    }
    if (botAttack) {
      return {
        attackerTeamID,
        victimTeamID,
        sameTeam: false,
        isFriendlyFire: false,
        friendlyFireType: "",
        teamSource: "bot",
      };
    }
    const isFriendlyFire = Boolean(sameTeam || rawFriendly);
    const friendlyFireType = isFriendlyFire
      ? String(rawRecord.friendlyFireType || friendlyFireKind(type))
      : "";
    const teamSource = resolveTeamSource(rawRecord, attacker, victim);

    return {
      attackerTeamID,
      victimTeamID,
      sameTeam,
      isFriendlyFire,
      friendlyFireType,
      teamSource,
    };
  }

  function buildEventFlags(rawRecord, relation, context = {}) {
    const flags = [];
    const botAttack = Boolean(context?.botAttack?.isBotAttack);

    const pushFlag = (flag) => {
      if (!flag) return;
      const key = String(flag.key ?? "").trim();
      const label = String(flag.label ?? "").trim();
      if (!key && !label) return;
      if (key && flags.some((item) => String(item.key ?? "").trim() === key)) return;
      if (!key && label && flags.some((item) => String(item.label ?? "").trim() === label)) return;
      flags.push(cloneJsonSafe(flag));
    };

    const sameTextId = (left, right) => {
      const a = String(left ?? "").trim();
      const b = String(right ?? "").trim();
      return Boolean(a && b && a === b);
    };

    const isSameCombatIdentity = () => sameTextId(rawRecord.attackerSteam64ID, rawRecord.victimSteam64ID)
      || sameTextId(rawRecord.attackerEOSID, rawRecord.victimEOSID)
      || sameTextId(rawRecord.attackerControllerID, rawRecord.victimControllerID)
      || sameTextId(rawRecord.attackerName, rawRecord.victimName);

    const type = String(rawRecord.type ?? "").trim().toLowerCase();
    const damage = Number(rawRecord.damage);
    if (!botAttack && (type === "died" || type === "death") && Number.isFinite(damage) && Math.abs(damage) === 300) {
      pushFlag({ key: "give_up", label: "放弃", level: "neutral", reason: "died_damage_300" });
    }

    for (const flag of Array.isArray(rawRecord.eventFlags) ? rawRecord.eventFlags : []) {
      const key = String(flag?.key ?? "").trim();
      const label = String(flag?.label ?? "").trim();
      if (botAttack && isSuppressedBotAttackFlag(key, label)) continue;
      pushFlag(flag);
    }

    for (const label of Array.isArray(rawRecord.eventFlagLabels) ? rawRecord.eventFlagLabels : []) {
      const text = String(label).trim();
      if (!text) continue;
      if (botAttack && isSuppressedBotAttackFlag("", text)) continue;
      pushFlag({ label: text });
    }

    if (flags.some((flag) => String(flag.key ?? "").trim() === "give_up" || String(flag.label ?? "").trim() === "放弃")) {
      if (isSameCombatIdentity()) {
        return flags;
      }
    }

    if (relation?.isFriendlyFire && relation?.friendlyFireType === "team_wound") {
      pushFlag({ key: "tk_down", label: "TK击倒", level: "warning", reason: "same_team" });
    }

    if (relation?.isFriendlyFire) {
      pushFlag({
        key: "friendly_fire",
        label: "友伤",
        level: relation?.friendlyFireType === "team_kill" ? "danger" : "warning",
        reason: rawRecord.friendlyFireReason || rawRecord.teamKillReason || "same_team",
      });
    }

    if (!botAttack && isSameCombatIdentity()) {
      pushFlag({
        key: "self_damage",
        label: "自伤",
        level: "warning",
        reason: "same_attacker_victim",
      });
    }

    if (context?.botAttack?.isBotAttack && context.cleanType === "kill") {
      pushFlag({
        key: "killed_by_bot",
        label: "被bot击杀",
        level: "danger",
        reason: context.botAttack.reason || "exact_projectile",
      });
    }

    if (context?.botAttack?.isBotAttack && context.cleanType === "wound") {
      pushFlag({
        key: "downed_by_bot",
        label: "被bot击倒",
        level: "warning",
        reason: context.botAttack.reason || "exact_projectile",
      });
    }

    return flags;
  }

  function buildWeapon(rawRecord) {
    const raw = String(rawRecord.rawCausedBy ?? rawRecord.weapon ?? rawRecord.causedBy ?? "").trim();
    const fallback = String(rawRecord.causedBy ?? rawRecord.weapon ?? rawRecord.rawCausedBy ?? "").trim();
    const cleaned = cleanWeaponName(raw || fallback);
    const displayName = cleaned || raw || fallback || "Unknown";
    const weaponType = classifyWeaponType({
      raw: raw || fallback,
      cleaned,
      displayName,
    });
    const isNullptrProjectileWeapon = isNullishPlayerValue(rawRecord.attackerName)
      && isNullptrProjectileWeaponName({
        raw,
        fallback,
        cleaned,
        displayName,
      });
    const resolvedWeaponType = isNullptrProjectileWeapon
      ? {
        ...weaponType,
        key: "bot_weapon",
        label: weaponTypeLabelForKey("bot_weapon"),
        ruleId: "weapon-type:bot_weapon:nullptr_projectile_7_62mm",
        matchedBy: "exact",
        matchedText: displayName,
        matchedTerm: "projectile 7 62mm",
        candidateIndex: 0,
        candidateSource: raw ? "rawCausedBy" : (fallback ? "causedBy" : ""),
      }
      : weaponType;
    const isBotWeapon = resolvedWeaponType.key === "bot_weapon";
    return {
      raw: raw || fallback,
      cleaned,
      category: String(rawRecord.weaponCategory ?? "").trim(),
      displayName,
      sourceType: String(rawRecord.causedByCategory ?? "").trim() || (raw ? "rawCausedBy" : (fallback ? "causedBy" : "")),
      weaponType: resolvedWeaponType,
      typeKey: resolvedWeaponType.key,
      typeLabel: resolvedWeaponType.label,
      typeMatchedBy: resolvedWeaponType.matchedBy,
      typeRuleId: resolvedWeaponType.ruleId,
      typeMatchText: resolvedWeaponType.matchedText,
      isBotWeapon,
      botWeaponReason: isBotWeapon
        ? (isNullptrProjectileWeapon ? BOT_PROJECTILE_NULLPTR_REASON : "exact_projectile")
        : "",
    };
  }

  function resolveWeaponHistory({ weapon, serverId, victim, eventTimeMs, enabled, windowMs }) {
    const baseWeapon = cloneJsonSafe(weapon) ?? weapon;
    if (!enabled) return { weapon: baseWeapon, applied: false };

    const history = findWeaponHistory({
      store: recentWeaponHistory,
      serverId,
      victim,
      eventTimeMs,
      windowMs,
    });
    if (!history) return { weapon: baseWeapon, applied: false };

    const appliedWeapon = {
      ...baseWeapon,
      cleaned: history.weapon.cleaned || baseWeapon.cleaned,
      displayName: history.weapon.displayName || history.weapon.cleaned || baseWeapon.displayName,
      weaponType: cloneJsonSafe(history.weapon.weaponType) ?? baseWeapon.weaponType,
      typeKey: history.weapon.typeKey || baseWeapon.typeKey,
      typeLabel: history.weapon.typeLabel || baseWeapon.typeLabel,
      typeMatchedBy: history.weapon.typeMatchedBy || baseWeapon.typeMatchedBy,
      typeRuleId: history.weapon.typeRuleId || baseWeapon.typeRuleId,
      typeMatchText: history.weapon.typeMatchText || baseWeapon.typeMatchText,
      isBotWeapon: Boolean(history.weapon.isBotWeapon ?? baseWeapon.isBotWeapon),
      botWeaponReason: history.weapon.botWeaponReason || baseWeapon.botWeaponReason || "",
      resolvedFromHistory: true,
      resolutionSource: "weaponHistoryBackfill",
      historyBackfill: {
        enabled: true,
        windowMs,
        ageMs: Math.max(0, eventTimeMs - history.timeMs),
        sourceEventId: history.sourceEventId,
        sourceTime: history.time,
        sourceType: history.type,
        sourceWeapon: history.weapon.displayName || history.weapon.cleaned || history.weapon.raw || "",
      },
    };

    return { weapon: appliedWeapon, applied: true };
  }

  function getState(serverId = "") {
    const filtered = filterByServer(events, serverId);
    return {
      events: filtered.map(cloneJsonSafe),
      count: filtered.length,
      stats: buildStats(filtered),
      lastUpdatedAt,
      rejected: filterByServer(rejected, serverId).map(cloneJsonSafe),
    };
  }

  const api = {
    getState,

    getEvents(filter = {}) {
      const serverId = String(filter.serverId ?? "").trim();
      const type = String(filter.type ?? "all").trim();
      const search = normalizeSearch(filter.search);
      const limit = clampLimit(filter.limit, 200);
      const offset = clampOffset(filter.offset);

      let result = filterByServer(events, serverId);
      if (VALID_TYPES.has(type)) result = result.filter((event) => event.type === type);
      if (search) result = result.filter((event) => matchesSearch(event, search));

      const playerKeys = buildPlayerKeys({
        playerKey: filter.playerKey,
        steam64ID: filter.steam64ID,
        steamID: filter.steamID,
        eosID: filter.eosID,
        controllerID: filter.controllerID,
        name: filter.name,
      });
      if (playerKeys.length) {
        result = result.filter((event) => playerKeys.some((key) => matchesPlayerKey(event, key)));
      }

      return result.slice().reverse().slice(offset, offset + limit).map(cloneJsonSafe);
    },

    getOverview(serverId = "") {
      const filtered = filterByServer(events, serverId);
      const rejectedFiltered = filterByServer(rejected, serverId);
      return {
        serverId: String(serverId ?? ""),
        count: filtered.length,
        stats: buildStats(filtered),
        rejected: rejectedFiltered.length,
        lastUpdatedAt,
        latest: filtered.slice(-20).reverse().map(cloneJsonSafe),
      };
    },

    getPlayerEvents(serverId, playerQuery = {}, options = {}) {
      const keys = buildPlayerKeys(playerQuery);
      const limit = clampLimit(options.limit, 50);
      const offset = clampOffset(options.offset);
      let result = filterByServer(events, String(serverId ?? "").trim());
      if (keys.length) {
        result = result.filter((event) => keys.some((key) => matchesPlayerKey(event, key)));
      }
      return result.slice().reverse().slice(offset, offset + limit).map(cloneJsonSafe);
    },

    getEventById(id) {
      const text = String(id ?? "").trim();
      const found = events.find((event) => event.id === text);
      return found ? cloneJsonSafe(found) : null;
    },

    updateWarningState(id, patch = {}) {
      const text = String(id ?? "").trim();
      if (!text) return null;
      const found = events.find((event) => event.id === text);
      if (!found) return null;

      const nextState = {
        attacker: {
          ...(found.warningState?.attacker ?? buildInitialWarningState().attacker),
          ...(patch.attacker ?? {}),
        },
        victim: {
          ...(found.warningState?.victim ?? buildInitialWarningState().victim),
          ...(patch.victim ?? {}),
        },
      };

      found.warningState = nextState;
      found.notify = nextState;
      core.eventBus.emitModuleEvent("module.combatClean", "updated", {
        eventId: `module.combatClean.warning:${found.id}:${Date.now()}`,
        eventName: "module.combatClean.updated",
        layer: "module",
        source: "module.combatClean",
        serverId: found.serverId,
        time: new Date().toISOString(),
        record: cloneJsonSafe(found),
        overview: api.getOverview(found.serverId),
      });
      return cloneJsonSafe(found);
    },

    getRateHistory(serverId = "", windowMinutes = 30) {
      const now = Date.now();
      const windowMs = Number.isFinite(windowMinutes) ? windowMinutes * 60 * 1000 : 30 * 60 * 1000;
      const cutoff = now - windowMs;
      const filtered = filterByServer(events, String(serverId ?? "").trim())
        .filter((e) => e.eventTime >= cutoff);

      const buckets = new Map();
      for (let i = 0; i <= (windowMs / 60000); i += 1) {
        const time = Math.floor((now - i * 60000) / 60000) * 60000;
        buckets.set(time, { damage: 0, wound: 0, kill: 0 });
      }

      for (const event of filtered) {
        const minute = Math.floor(event.eventTime / 60000) * 60000;
        const bucket = buckets.get(minute);
        if (bucket) {
          if (event.type === "damage") bucket.damage += 1;
          else if (event.type === "wound") bucket.wound += 1;
          else if (event.type === "kill") bucket.kill += 1;
        }
      }

      return Array.from(buckets.entries())
        .map(([time, counts]) => ({
          timestamp: time,
          ...counts,
        }))
        .sort((a, b) => a.timestamp - b.timestamp);
    },

    clear(serverId = "") {
      const target = String(serverId ?? "").trim();
      let cleared;
      if (target) {
        cleared = events.length;
        for (let i = events.length - 1; i >= 0; i -= 1) {
          if (String(events[i].serverId ?? "") === target) events.splice(i, 1);
        }
        cleared -= events.length;
      } else {
        cleared = events.length;
        events.splice(0);
      }
      sourceEventIds.clear();
      if (target) recentWeaponHistory.delete(target);
      else recentWeaponHistory.clear();
      lastUpdatedAt = new Date().toISOString();
      core.eventBus.emitModuleEvent("module.combatClean", "updated", {
        eventId: `module.combatClean.clear:${Date.now()}`,
        eventName: "module.combatClean.updated",
        layer: "module",
        source: "module.combatClean",
        serverId: target || core.webStatus?.serverId || "",
        time: lastUpdatedAt,
        cleared,
        overview: api.getOverview(target),
      });
      return { ok: true, cleared };
    },
  };

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.("module.combatClean") !== false
      && core.pluginSubscriptions?.isSubscribed?.("module.combatClean") !== false;
  }

  return {
    manifest: {
      id: "module.combatClean",
      name: "\u6218\u6597\u7ba1\u7406",
      kind: "module",
      version: "0.2.1",
      hidden: true,
      deprecated: true,
      description: "Combat clean layer built from raw module.combatState evidence records. It backfills kill event weapon names from recent wound history before external plugins and the UDP forwarder consume the record.",
    },
    apiName: "combatClean",
    api,

    async start() {
      core.webRegistry?.registerPage?.({
        id: "web.combatClean",
        title: "\u6218\u6597\u7ba1\u7406",
        group: "\u7ba1\u7406",
        route: "/combat-clean",
        pageModule: "/pages/combat-clean.js",
        source: "module.combatClean",
        required: false,
        enabled: true,
        order: 111,
        icon: "C",
        hiddenFromSidebar: true,
      });

      if (!enabled) return;
      unsubscribers.push(core.eventBus.onModuleEvent("module.combatState", "updated", ingest));
      logWithFallback(moduleLogger, "info", `CombatClean started. maxEvents=${maxEvents}`, {
        label: "MODULE",
        operation: "start",
        data: { maxEvents },
      });
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      events.splice(0);
      rejected.splice(0);
      sourceEventIds.clear();
      recentWeaponHistory.clear();
      lastUpdatedAt = "";
      logWithFallback(moduleLogger, "info", "CombatClean stopped.", {
        label: "MODULE",
        operation: "stop",
      });
    },
  };
}

function extractIdentity(rawRecord, side) {
  const prefix = side === "attacker" ? "attacker" : "victim";
  const title = side === "attacker" ? "Attacker" : "Victim";
  return {
    name: firstPresent(rawRecord[`${prefix}Name`], rawRecord[`${title}Name`]),
    teamID: firstPresent(rawRecord[`${prefix}TeamID`], rawRecord[`${title}TeamID`], rawRecord[`${prefix}TeamId`]),
    squadID: firstPresent(rawRecord[`${prefix}SquadID`], rawRecord[`${title}SquadID`], rawRecord[`${prefix}SquadId`]),
    steam64ID: firstPresent(rawRecord[`${prefix}Steam64ID`], rawRecord[`${prefix}SteamID`], rawRecord[`${title}Steam64ID`], rawRecord[`${title}SteamID`]),
    eosID: firstPresent(rawRecord[`${prefix}EOSID`], rawRecord[`${prefix}EosID`], rawRecord[`${title}EOSID`]),
    controllerID: firstPresent(rawRecord[`${prefix}ControllerID`], rawRecord[`${prefix}ControllerId`], rawRecord[`${title}ControllerID`]),
  };
}

function normalizeType(type, event) {
  const text = String(type ?? event?.record?.type ?? "").trim().toLowerCase();
  if (text === "damage" || text === "damaged") return "damage";
  if (text === "wound" || text === "wounded") return "wound";
  if (text === "revive" || text === "revived") return "revive";
  if (text === "kill" || text === "killed" || text === "death" || text === "died" || text === "tk") return "kill";
  return "";
}

function mergePlayer(target, player) {
  if (!target.name && player.name) target.name = String(player.name);
  if (!target.steam64ID && (player.steamID || player.steam64ID)) target.steam64ID = String(player.steamID ?? player.steam64ID);
  if (!target.eosID && player.eosID) target.eosID = String(player.eosID);
  if (!target.controllerID && player.controllerID) target.controllerID = String(player.controllerID);
  if ((target.teamID == null || target.teamID === "") && player.teamID != null) target.teamID = player.teamID;
  if ((target.squadID == null || target.squadID === "") && player.squadID != null) target.squadID = player.squadID;
  if (player.role) target.role = String(player.role);
  target.isLeader = Boolean(player.isLeader);
  if (!target.playerId && (player.playerId || player.playerID || player.id)) {
    target.playerId = String(player.playerId ?? player.playerID ?? player.id);
  }
}

function buildDisplayText(type, attacker, victim, weapon, damage, relation) {
  if (String(type ?? "").trim().toLowerCase() === "revive") {
    const ff = relation.isFriendlyFire ? " [friendly fire]" : "";
    return `${displayPlayerName(attacker)} revived ${displayPlayerName(victim)}${ff}`;
  }
  const verb = type === "damage" ? "damaged" : type === "wound" ? "wounded" : "killed";
  const amount = damage == null || damage === "" ? "" : ` (${trimNumber(damage)})`;
  const ff = relation.isFriendlyFire ? " [friendly fire]" : "";
  const typeSuffix = weapon?.typeLabel ? ` ${weapon.typeLabel}` : "";
  return `${displayPlayerName(attacker)} ${verb} ${displayPlayerName(victim)} with ${weapon.displayName || "Unknown"}${typeSuffix}${amount}${ff}`;
}

function buildProcessedCombatTags({ cleanType, rawRecord, attacker, victim, weapon, relation, warnings, botAttack }) {
  const tags = [];
  pushTag(tags, eventTypeTagFor(cleanType));
  pushTag(tags, weaponCategoryTagFor(weapon));
  pushTag(tags, smallArmSubTypeTagFor(weapon));
  for (const tag of damageSourceTagsFor({ cleanType, rawRecord, weapon, botAttack })) {
    pushTag(tags, tag);
  }
  for (const tag of identityTagsFor({ attacker, victim, rawRecord, botAttack, warnings })) {
    pushTag(tags, tag);
  }
  for (const tag of relationTagsFor({ relation, attacker, victim, botAttack })) {
    pushTag(tags, tag);
  }
  pushTag(tags, teamKillTagFor({ cleanType, relation }));
  pushTag(tags, confidenceTagFor({ attacker, victim, weapon, warnings, botAttack }));
  return tags;
}

function eventTypeTagFor(cleanType) {
  if (cleanType === "damage") return CombatEventTags.Damage;
  if (cleanType === "wound") return CombatEventTags.Wound;
  if (cleanType === "kill") return CombatEventTags.Kill;
  return "";
}

function weaponCategoryTagFor(weapon = {}) {
  const typeKey = String(weapon?.typeKey ?? "").trim().toLowerCase();
  if (typeKey === "light") return WeaponCategoryTags.SmallArm;
  if (typeKey === "explosive" || typeKey === "anti_tank" || typeKey === "bot_weapon") return WeaponCategoryTags.Explosive;
  if (typeKey === "melee") return WeaponCategoryTags.Melee;

  const raw = `${weapon?.raw ?? ""} ${weapon?.cleaned ?? ""} ${weapon?.displayName ?? ""}`.toLowerCase();
  if (/\b(tank|btr|bmp|lav|stryker|bradley|helicopter|heli|ifv|apc|vehicle|car|truck)\b/.test(raw)) {
    return WeaponCategoryTags.Vehicle;
  }
  if (/\b(mortar|tow|hmg|emplacement|dshk|spg|zu23|crows)\b/.test(raw)) {
    return WeaponCategoryTags.Emplacement;
  }
  return WeaponCategoryTags.UnknownWeapon;
}

function smallArmSubTypeTagFor(weapon = {}) {
  const raw = `${weapon?.raw ?? ""} ${weapon?.cleaned ?? ""} ${weapon?.displayName ?? ""}`.toLowerCase();
  const typeKey = String(weapon?.typeKey ?? "").trim().toLowerCase();
  if (typeKey !== "light") return "";
  if (/\b(pkp|pkm|rpk|m249|m240|m60|mg3|mg34|mg42|c6|c9|bren|dp28)\b/.test(raw)) return SmallArmTags.MachineGun;
  if (/\b(m110|sr25|svd|m21|mk14|ebr|sks|qbu)\b/.test(raw)) return SmallArmTags.MarksmanRifle;
  if (/\b(m24|mosin|m38|sv98|awm|m2010)\b/.test(raw)) return SmallArmTags.SniperRifle;
  if (/\b(g17|glock|m9|p226|1911|makarov|cz75|p320|usp|deagle)\b/.test(raw)) return SmallArmTags.Pistol;
  if (/\b(saiga|m870|shotgun)\b/.test(raw)) return SmallArmTags.Shotgun;
  if (/\b(c8|carbine|m4|hk416|g36c)\b/.test(raw)) return SmallArmTags.Carbine;
  return SmallArmTags.Rifle;
}

function damageSourceTagsFor({ cleanType, rawRecord, weapon, botAttack }) {
  if (cleanType === "revive") return [];

  const tags = [];
  const raw = `${rawRecord?.causedBy ?? ""} ${rawRecord?.weapon ?? ""} ${weapon?.raw ?? ""} ${weapon?.displayName ?? ""}`.toLowerCase();
  const attackerText = String(rawRecord?.attackerName ?? "").trim().toLowerCase();
  const isWorld = botAttack?.isBotAttack !== true && /^(world|environment)$/i.test(attackerText);

  if (/\bbleed|bleeding\b/.test(raw)) pushTag(tags, DamageSourceTags.Bleed);
  if (/\bfall|fell|falling\b/.test(raw)) pushTag(tags, DamageSourceTags.Fall);
  if (/\bburn|fire|flame|incendiary|molotov\b/.test(raw)) pushTag(tags, DamageSourceTags.Burn);
  if (/\bcrash|collision|ram\b/.test(raw)) pushTag(tags, DamageSourceTags.VehicleCrash);
  if (/\bgrenade|frag|shell|rocket|projectile|explosive|mortar|artillery|mine|claymore|c4|satchel|hedp|hesh|30mm|40mm|60mm|81mm|120mm|155mm\b/.test(raw)) {
    pushTag(tags, DamageSourceTags.Splash);
  }
  if (isWorld) pushTag(tags, DamageSourceTags.UnknownSource);
  if (!tags.length && cleanType === "damage") pushTag(tags, DamageSourceTags.Direct);
  if (!tags.length) pushTag(tags, DamageSourceTags.UnknownSource);
  return tags;
}

function identityTagsFor({ attacker, victim, rawRecord, botAttack, warnings }) {
  const tags = [];
  const attackerText = String(rawRecord?.attackerName ?? "").trim().toLowerCase();
  const sourceText = `${rawRecord?.causedBy ?? ""} ${rawRecord?.weapon ?? ""}`.toLowerCase();
  const worldLike = /^(world|environment)$/i.test(attackerText);
  const environmentalLike = /\b(world|environment|fall|fell|falling|bleed|bleeding|burn|fire|crash|collision)\b/.test(sourceText);
  if (victim?.name || victim?.displayName) pushTag(tags, IdentityTags.VictimValid);
  else pushTag(tags, IdentityTags.VictimNull);

  if (botAttack?.isBotAttack || worldLike || ((!attacker?.name && !attacker?.displayName) && environmentalLike)) {
    pushTag(tags, IdentityTags.AttackerWorld);
    return tags;
  }

  if (attacker?.name || attacker?.displayName) {
    if (Array.isArray(warnings) && warnings.includes(FALLBACK_REASON)) pushTag(tags, IdentityTags.AttackerNull);
    pushTag(tags, IdentityTags.AttackerValid);
    return tags;
  }

  pushTag(tags, IdentityTags.AttackerNull);
  return tags;
}

function relationTagsFor({ relation, attacker, victim, botAttack }) {
  const tags = [];
  if (botAttack?.isBotAttack) {
    pushTag(tags, RelationTags.UnknownRelation);
    return tags;
  }
  if (sameKnownIdentity(attacker, victim)) {
    pushTag(tags, RelationTags.Self);
    return tags;
  }
  if (relation?.isFriendlyFire) {
    pushTag(tags, RelationTags.Friendly);
    return tags;
  }
  if (relation?.sameTeam === false) {
    pushTag(tags, RelationTags.Enemy);
    return tags;
  }
  pushTag(tags, RelationTags.UnknownRelation);
  return tags;
}

function teamKillTagFor({ cleanType, relation }) {
  if (!relation?.isFriendlyFire) return "";
  if (cleanType === "damage") return TeamKillTags.TeamDamage;
  if (cleanType === "wound") return TeamKillTags.TeamWound;
  if (cleanType === "kill") return TeamKillTags.TeamKill;
  return "";
}

function confidenceTagFor({ attacker, victim, weapon, warnings, botAttack }) {
  if (!victim?.name && !victim?.displayName) return ConfidenceTags.Low;
  if (botAttack?.isBotAttack) return ConfidenceTags.Medium;
  if (String(weapon?.typeKey ?? "").trim() === "" || Array.isArray(warnings) && warnings.includes(FALLBACK_REASON)) {
    return ConfidenceTags.Low;
  }
  if (attacker?.resolved && victim?.resolved) return ConfidenceTags.High;
  return ConfidenceTags.Medium;
}

function pushTag(tags, tag) {
  const text = String(tag ?? "").trim();
  if (!text || tags.includes(text)) return;
  tags.push(text);
}

function buildStats(list) {
  const stats = {
    total: list.length,
    damage: 0,
    wound: 0,
    kill: 0,
    revive: 0,
    friendlyFire: 0,
    teamDamage: 0,
    teamWound: 0,
    teamKill: 0,
  };
  for (const event of list) {
    if (event.type in stats) stats[event.type] += 1;
    if (event.relation?.isFriendlyFire) stats.friendlyFire += 1;
    if (event.relation?.friendlyFireType === "team_damage") stats.teamDamage += 1;
    if (event.relation?.friendlyFireType === "team_wound") stats.teamWound += 1;
    if (event.relation?.friendlyFireType === "team_kill") stats.teamKill += 1;
  }
  return stats;
}

function buildInitialWarningState() {
  return {
    attacker: {
      warned: false,
      skipped: false,
      success: false,
      reason: "",
      message: "",
      updatedAt: 0,
    },
    victim: {
      warned: false,
      skipped: false,
      success: false,
      reason: "",
      message: "",
      updatedAt: 0,
    },
  };
}

function matchesSearch(event, search) {
  return [
    event.id,
    event.type,
    event.eventName,
    event.displayText,
    event.attacker?.name,
    event.attacker?.displayName,
    event.victim?.name,
    event.victim?.displayName,
    event.attacker?.steam64ID,
    event.victim?.steam64ID,
    event.attacker?.eosID,
    event.victim?.eosID,
    event.weapon?.raw,
    event.weapon?.cleaned,
    event.weapon?.displayName,
    event.weapon?.category,
    event.weapon?.typeKey,
    event.weapon?.typeLabel,
    event.weapon?.typeMatchText,
    ...(Array.isArray(event.tags) ? event.tags : []),
    event.warningState?.attacker?.reason,
    event.warningState?.victim?.reason,
    event.raw?.rawLog,
  ].some((value) => normalizeSearch(value).includes(search));
}

function matchesPlayerKey(event, playerKey) {
  const key = normalizeSearch(playerKey);
  if (!key) return true;
  return [event.attacker, event.victim].some((player) => {
    // Exact match for IDs and keys to prevent partial match bugs (e.g., short key "7" matching steam64IDs containing "7")
    if (player?.steam64ID && normalizeSearch(player.steam64ID) === key) return true;
    if (player?.eosID && normalizeSearch(player.eosID) === key) return true;
    if (player?.controllerID && normalizeSearch(player.controllerID) === key) return true;
    if (player?.playerId && normalizeSearch(player.playerId) === key) return true;
    if (player?.id && normalizeSearch(player.id) === key) return true;

    // Substring or exact match for name / display name
    const name = player?.name;
    const displayName = player?.displayName;
    return [
      displayName,
      name,
      normalizeName(name),
    ].some((value) => value && (normalizeSearch(value) === key || normalizeSearch(value).includes(key)));
  });
}

function buildPlayerKeys(query) {
  if (typeof query === "string") return [normalizeSearch(query)].filter(Boolean);
  return [
    query?.playerKey,
    query?.steam64ID,
    query?.steamID,
    query?.eosID,
    query?.controllerID,
    query?.name,
  ].map(normalizeSearch).filter(Boolean);
}

function findPlayerByNormalizedName(players, serverId, name) {
  const normalizedName = normalizeName(name);
  if (!normalizedName) return null;
  for (const player of Array.isArray(players) ? players : []) {
    if (!player) continue;
    if (player.serverId != null && String(player.serverId) !== String(serverId)) continue;
    if (normalizeName(player.name) === normalizedName) return player;
  }
  return null;
}

function resolveTeamSource(rawRecord, attacker, victim) {
  if (rawRecord.attackerTeamID != null || rawRecord.victimTeamID != null) return "raw";
  const sources = new Set([attacker.resolutionSource, victim.resolutionSource].filter(Boolean));
  if (sources.size === 0) return "unknown";
  return [...sources].join("+");
}

function friendlyFireKind(type) {
  if (type === "damage") return "team_damage";
  if (type === "wound") return "team_wound";
  return "team_kill";
}

function cleanWeaponName(value) {
  return String(value ?? "")
    .trim()
    .replace(/^.+\./, "")
    .replace(/_C_\d+$/i, "")
    .replace(/_C$/i, "")
    .replace(/^BP_/, "")
    .replace(/_/g, " ")
    .trim();
}

function displayPlayerName(player = {}) {
  return String(player?.displayName || player?.name || "Unknown").trim() || "Unknown";
}

  function buildBotAttackContext(weapon = {}, rawRecord = {}) {
    const attackerControllerID = String(
      rawRecord?.attackerControllerID
      ?? rawRecord?.attackerControllerId
      ?? rawRecord?.attackerName
      ?? ""
    ).trim();
    if (isSquidBotControllerID(attackerControllerID)) {
      return { isBotAttack: true, reason: "squidbot_controller" };
    }
    const key = String(weapon?.typeKey ?? "").trim().toLowerCase();
    if (key !== "bot_weapon") {
      return { isBotAttack: false, reason: "" };
    }
    return { isBotAttack: true, reason: String(weapon?.botWeaponReason ?? "").trim() || "exact_projectile" };
  }

  function isSquidBotControllerID(value) {
    const text = String(value ?? "").trim();
    return text === SQUID_BOT_CONTROLLER_ID || text.startsWith(`${SQUID_BOT_CONTROLLER_ID}_`);
  }

  function isNullptrProjectileWeaponName({ raw = "", fallback = "", cleaned = "", displayName = "" } = {}) {
    const candidates = [
      raw,
      fallback,
      cleaned,
      displayName,
    ]
      .map((value) => normalizeProjectileWeaponText(value))
      .filter(Boolean);
    return candidates.some((text) => {
      const compact = text.replace(/[\s.-]+/g, "");
      return text === "projectile"
        || text === "projectile 7 62mm"
        || text === "projectile 7.62mm"
        || compact === "projectile762mm";
    });
  }

  function normalizeProjectileWeaponText(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

function isSuppressedBotAttackFlag(key, label) {
  const normalizedKey = String(key ?? "").trim().toLowerCase();
  const normalizedLabel = String(label ?? "").trim().toLowerCase();
  return normalizedKey === "friendly_fire"
    || normalizedKey === "tk_down"
    || normalizedKey === "team_kill"
    || normalizedKey === "give_up"
    || normalizedLabel === "友伤"
    || normalizedLabel === "tk击倒"
    || normalizedLabel === "自伤"
    || normalizedLabel === "放弃";
}

function cleanPlayerValue(value) {
  return isNullishPlayerValue(value) ? "" : String(value ?? "").trim();
}

function isNullishPlayerValue(value) {
  const text = String(value ?? "").trim();
  return text === "" || /^null(?:ptr)?$/i.test(text) || /^none$/i.test(text);
}

function sameKnownTeam(left, right) {
  const leftText = String(left ?? "").trim();
  const rightText = String(right ?? "").trim();
  return leftText !== "" && rightText !== "" && leftText === rightText;
}

function sameKnownIdentity(left = {}, right = {}) {
  return sameKnownValue(left.steam64ID, right.steam64ID)
    || sameKnownValue(left.eosID, right.eosID)
    || sameKnownValue(left.controllerID, right.controllerID)
    || sameKnownValue(left.name, right.name);
}

function sameKnownValue(left, right) {
  const leftText = String(left ?? "").trim();
  const rightText = String(right ?? "").trim();
  return Boolean(leftText && rightText && leftText === rightText);
}

function normalizeOptionalNumber(value) {
  if (value == null || String(value).trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function hasRawId(ref) {
  return Boolean(ref.steam64ID || ref.eosID || ref.controllerID);
}

function firstPresent(...values) {
  for (const value of values) {
    if (value != null && String(value).trim() !== "") return value;
  }
  return "";
}

function parseDamage(value) {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseTimestampMs(value) {
  const text = String(value ?? "").trim();
  if (!text) return Date.now();
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

  function normalizeName(value) {
    return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  }

function normalizeSearch(value) {
  return String(value ?? "").trim().toLowerCase();
}

function filterByServer(list, serverId) {
  const target = String(serverId ?? "").trim();
  return target ? list.filter((event) => String(event.serverId ?? "") === target) : list;
}

function makeCleanId(type, sourceEventId, rawRecord) {
  const base = sourceEventId || rawRecord.id || `${rawRecord.serverId ?? ""}:${rawRecord.time ?? Date.now()}:${Math.random().toString(16).slice(2)}`;
  return `combatClean:${type}:${String(base).replace(/[^A-Za-z0-9_.:-]/g, "_")}`;
}

function clampLimit(value, defaultValue) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(5000, Math.max(1, parsed));
}

function clampOffset(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function trimNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "");
  return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(6)));
}

function cloneJsonSafe(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function sanitizeRawRecord(rawRecord) {
  const cloned = cloneJsonSafe(rawRecord);
  if (!cloned || typeof cloned !== "object") return cloned;

  delete cloned.confidence;
  delete cloned.Confidence;
  delete cloned.parseConfidence;
  delete cloned.ParseConfidence;
  delete cloned.identityConfidence;
  delete cloned.IdentityConfidence;
  delete cloned.teamConfidence;
  delete cloned.TeamConfidence;

  return cloned;
}

function sanitizeRawEvent(rawEvent) {
  const cloned = cloneJsonSafe(rawEvent);
  if (!cloned || typeof cloned !== "object") return cloned;
  if (cloned.record) delete cloned.record;
  if (cloned.rawRecord) delete cloned.rawRecord;
  return cloned;
}

function logWithFallback(logger, method, message, context) {
  const fn = logger?.[method];
  if (typeof fn === "function") {
    fn.call(logger, message, context);
    return;
  }
  logger?.info?.(typeof message === "function" ? message() : message);
}

function buildWeaponHistoryKeys(victim) {
  return [
    victim?.steam64ID,
    victim?.eosID,
    victim?.controllerID,
    victim?.name,
  ].map((value) => normalizeSearch(value)).filter(Boolean);
}

function rememberWeaponHistory({ store, serverId, victim, weapon, eventTimeMs, sourceEventId, type, windowMs }) {
  const victimKeys = buildWeaponHistoryKeys(victim);
  if (!victimKeys.length) return;
  if (!weapon) return;

  const entry = {
    serverId: String(serverId ?? "").trim(),
    victimKeys,
    timeMs: Number.isFinite(eventTimeMs) ? eventTimeMs : Date.now(),
    time: new Date(Number.isFinite(eventTimeMs) ? eventTimeMs : Date.now()).toISOString(),
    sourceEventId: String(sourceEventId ?? "").trim(),
    type: String(type ?? "").trim(),
    weapon: cloneJsonSafe(weapon),
  };

  const history = store.get(entry.serverId) ?? [];
  history.push(entry);
  const cutoff = entry.timeMs - Math.max(1000, Number(windowMs ?? DEFAULT_WEAPON_HISTORY_WINDOW_MS));
  while (history.length && Number(history[0].timeMs ?? 0) < cutoff) history.shift();
  store.set(entry.serverId, history);
}

function findWeaponHistory({ store, serverId, victim, eventTimeMs, windowMs }) {
  const history = store.get(String(serverId ?? "").trim()) ?? [];
  if (!history.length) return null;

  const victimKeys = buildWeaponHistoryKeys(victim);
  if (!victimKeys.length) return null;

  const cutoff = Number.isFinite(eventTimeMs)
    ? eventTimeMs - Math.max(1000, Number(windowMs ?? DEFAULT_WEAPON_HISTORY_WINDOW_MS))
    : -Infinity;

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (!entry) continue;
    if (Number(entry.timeMs ?? 0) < cutoff) continue;
    if (!entry.victimKeys?.some((key) => victimKeys.includes(key))) continue;
    return entry;
  }

  return null;
}

