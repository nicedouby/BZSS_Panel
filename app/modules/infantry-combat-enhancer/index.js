// -*- coding: utf-8 -*-

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  minAttackerDamage: 15,
  damageDebounceMs: 0,
  showVictimDamage: true,
  showVictimWound: true,
  showVictimKill: true,
  showAttackerDamage: true,
  storeRecentEventLimit: 300,
  damageAggregation: {
    enabled: false,
    debounceMs: 0,
  },
});

const VALID_TYPES = new Set(["damage", "wound", "kill", "revive"]);
const COMBAT_CLEAN_SUBSCRIPTION_ID = "module.combatClean";

export function createInfantryCombatEnhancerModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.infantryCombatEnhancer",
    source: "module.infantryCombatEnhancer",
    channel: "module",
  }) ?? core.logger;
  const moduleConfig = normalizeModuleConfig(config?.get?.("modules.infantryCombatEnhancer", {}));
  const store = new InfantryEnhancerStore(moduleConfig.storeRecentEventLimit);
  const damageAggregation = new Map();
  const unsubscribers = [];
  let lastUpdatedAt = "";

  const api = {
    getConfig() {
      return cloneJsonSafe(moduleConfig);
    },

    updateConfig(patch = {}) {
      const next = normalizeModuleConfig({
        ...moduleConfig,
        ...patch,
      });
      Object.assign(moduleConfig, next);
      store.setMaxRecords(moduleConfig.storeRecentEventLimit);
      return api.getConfig();
    },

    getEvents(filter = {}) {
      return store.query(filter);
    },

    getOverview(filter = {}) {
      return buildOverview(filter);
    },

    getState(filter = {}) {
      return {
        config: api.getConfig(),
        overview: api.getOverview(filter),
        events: api.getEvents({ ...filter, limit: moduleConfig.storeRecentEventLimit }),
        lastUpdatedAt,
      };
    },

    clear() {
      const cleared = store.clear();
      lastUpdatedAt = new Date().toISOString();
      return {
        ok: true,
        cleared,
      };
    },

    async ingest(event) {
      return handleCombatProcessedEvent(event);
    },
  };

  async function handleCombatProcessedEvent(event) {
    if (!isEnabled() || !isSubscribed()) return null;

    const record = event?.record;
    if (!record || typeof record !== "object") return null;

    const type = normalizeType(record.type);
    if (!type || !VALID_TYPES.has(type)) return null;

    const processedAt = new Date().toISOString();
    const attacker = extractIdentity(record, "attacker");
    const victim = extractIdentity(record, "victim");
    const damage = normalizeDamage(record.damage);
    if (!victim.name) return null;
    const samePlayer = isSamePlayer(attacker, victim);
    const weaponName = resolveWeaponName(record);
    const serverId = String(record.serverId ?? event?.serverId ?? core.webStatus?.serverId ?? "").trim();
    const sourceEventId = String(event?.eventId ?? record.sourceEventId ?? record.id ?? "").trim();
    const combatEventId = String(record.id ?? "").trim();

    const baseEntry = {
      id: makeEntryId(processedAt, combatEventId || sourceEventId),
      createdAt: processedAt,
      serverId,
      sourceEventId,
      combatEventId,
      type,
      time: String(record.time ?? event?.time ?? processedAt),
      attacker,
      victim,
      attackerName: attacker.name,
      victimName: victim.name,
      attackerSteam64ID: attacker.steam64ID,
      attackerEOSID: attacker.eosID,
      attackerControllerID: attacker.controllerID,
      attackerTeamID: attacker.teamID,
      victimSteam64ID: victim.steam64ID,
      victimEOSID: victim.eosID,
      victimControllerID: victim.controllerID,
      victimTeamID: victim.teamID,
      damage,
      weapon: weaponName,
      samePlayer,
      relation: cloneJsonSafe(record.relation ?? null),
      parse: cloneJsonSafe(record.parse ?? null),
      eventFlags: Array.isArray(record.eventFlags) ? cloneJsonSafe(record.eventFlags) : [],
      eventFlagLabels: Array.isArray(record.eventFlagLabels) ? cloneJsonSafe(record.eventFlagLabels) : [],
      tags: Array.isArray(record.tags) ? cloneJsonSafe(record.tags) : [],
      warnings: [],
      victimWarning: null,
      attackerWarning: null,
    };

    if (baseEntry.type === "damage") {
      if (moduleConfig.damageAggregation?.enabled === true) {
        bufferDamageEntry(baseEntry);
        return null;
      }

      return processEntryNow(baseEntry);
    }

    if (baseEntry.type === "wound") {
      mergePendingDamageIntoWound(baseEntry);
    }

    return processEntryNow(baseEntry);
  }

  function makeAggregationKey(entry) {
    const server = normalizeText(entry?.serverId);
    const attackerKey = normalizeText(pickText(entry?.attackerSteam64ID, entry?.attackerEOSID, entry?.attackerControllerID, entry?.attackerName));
    const victimKey = normalizeText(pickText(entry?.victimSteam64ID, entry?.victimEOSID, entry?.victimControllerID, entry?.victimName));
    const weaponKey = normalizeText(entry?.weapon);
    return `${server}|${attackerKey}|${victimKey}|${weaponKey}`;
  }

  function mergeTextArray(left, right) {
    const result = [];
    const seen = new Set();
    for (const value of [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]) {
      const text = String(value ?? "");
      if (!text) continue;
      if (seen.has(text)) continue;
      seen.add(text);
      result.push(text);
    }
    return result;
  }

  function mergeEventFlags(left, right) {
    const result = [];
    const seen = new Set();
    const items = [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])].filter((item) => item && typeof item === "object");
    for (const item of items) {
      const key = String(item.key ?? "").trim();
      const label = String(item.label ?? "").trim();
      const id = `${key}|${label}`;
      if (seen.has(id)) continue;
      seen.add(id);
      result.push(cloneJsonSafe(item));
    }
    return result;
  }

  function takeDamageBuffer(key) {
    const buffer = damageAggregation.get(key);
    if (!buffer) return null;
    damageAggregation.delete(key);
    if (buffer.timeoutId) {
      try {
        clearTimeout(buffer.timeoutId);
      } catch {}
    }
    return buffer;
  }

  function bufferDamageEntry(entry) {
    const key = makeAggregationKey(entry);
    const nextDamage = Number.isFinite(entry.damage) ? entry.damage : 0;
    const debounceMs = Math.max(
      0,
      Number(
        moduleConfig.damageAggregation?.debounceMs
        ?? moduleConfig.damageDebounceMs
        ?? DEFAULT_CONFIG.damageDebounceMs,
      ),
    );
    if (debounceMs <= 0) {
      processEntryNow(entry).catch((error) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        moduleLogger?.warn?.(`Infantry combat damage processing failed: ${errorMessage}`);
      });
      return;
    }
    const existing = damageAggregation.get(key);

    const merged = existing ?? {
      sumDamage: 0,
      lastDamage: 0,
      templateEntry: null,
      tags: [],
      eventFlags: [],
      eventFlagLabels: [],
      timeoutId: null,
    };

    if (merged.timeoutId) {
      try {
        clearTimeout(merged.timeoutId);
      } catch {}
    }

    merged.sumDamage += nextDamage;
    merged.lastDamage = nextDamage;
    merged.templateEntry = cloneJsonSafe(entry);
    merged.tags = mergeTextArray(merged.tags, entry.tags);
    merged.eventFlags = mergeEventFlags(merged.eventFlags, entry.eventFlags);
    merged.eventFlagLabels = mergeTextArray(merged.eventFlagLabels, entry.eventFlagLabels);

    merged.timeoutId = setTimeout(() => {
      flushDamageKey(key);
    }, debounceMs);

    damageAggregation.set(key, merged);
  }

  function flushDamageKey(key) {
    const buffer = takeDamageBuffer(key);
    if (!buffer) return;
    if (!isEnabled() || !isSubscribed()) return;

    const template = buffer.templateEntry;
    if (!template || typeof template !== "object") return;

    const aggregatedEntry = cloneJsonSafe(template);
    aggregatedEntry.damage = normalizeDamage(buffer.sumDamage);
    aggregatedEntry.tags = mergeTextArray(aggregatedEntry.tags, buffer.tags);
    aggregatedEntry.eventFlags = mergeEventFlags(aggregatedEntry.eventFlags, buffer.eventFlags);
    aggregatedEntry.eventFlagLabels = mergeTextArray(aggregatedEntry.eventFlagLabels, buffer.eventFlagLabels);
    aggregatedEntry.victimWarning = null;
    aggregatedEntry.attackerWarning = null;
    aggregatedEntry.warnings = [];

    processEntryNow(aggregatedEntry).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      moduleLogger?.warn?.(`Infantry combat damage flush failed: ${errorMessage}`);
    });
  }

  function mergePendingDamageIntoWound(woundEntry) {
    const key = makeAggregationKey(woundEntry);
    const buffer = takeDamageBuffer(key);
    if (!buffer) return;

    const extra = Math.max(0, Number(buffer.sumDamage ?? 0) - Number(buffer.lastDamage ?? 0));
    if (Number.isFinite(woundEntry.damage)) {
      woundEntry.damage = normalizeDamage(woundEntry.damage + extra);
    } else if (Number.isFinite(extra)) {
      woundEntry.damage = normalizeDamage(extra);
    }

    woundEntry.tags = mergeTextArray(woundEntry.tags, buffer.tags);
    woundEntry.eventFlags = mergeEventFlags(woundEntry.eventFlags, buffer.eventFlags);
    woundEntry.eventFlagLabels = mergeTextArray(woundEntry.eventFlagLabels, buffer.eventFlagLabels);
  }

  async function processEntryNow(entry) {
    const victimDecision = buildVictimDecision(entry);
    const attackerDecision = buildAttackerDecision(entry);

    const [victimWarning, attackerWarning] = await Promise.all([
      executeDecision(victimDecision),
      executeDecision(attackerDecision),
    ]);

    entry.victimWarning = victimWarning;
    entry.attackerWarning = attackerWarning;
    entry.warnings = [victimWarning, attackerWarning].filter(Boolean);

    store.push(entry);
    lastUpdatedAt = new Date().toISOString();

    core.eventBus?.emitModuleEvent?.("module.infantryCombatEnhancer", "updated", {
      eventName: "module.infantryCombatEnhancer.updated",
      layer: "module",
      source: "module.infantryCombatEnhancer",
      serverId: entry.serverId,
      time: lastUpdatedAt,
      record: cloneJsonSafe(entry),
      overview: buildOverview(),
    });

    return entry;
  }

  function buildVictimDecision(entry) {
    if (!entry.victim.name) {
      return makeSkipDecision(entry, "victim", "victim_missing_target");
    }

    return makeSendDecision({
      entry,
      role: "victim",
      target: entry.victim,
      message: buildVictimMessage(entry),
      reason: `infantry_${entry.type}_victim`,
    });
  }

  function buildAttackerDecision(entry) {
    if (entry.samePlayer) {
      return makeSkipDecision(entry, "attacker", "same_player");
    }
    if (!entry.attacker.name) {
      return makeSkipDecision(entry, "attacker", "attacker_missing_target");
    }
    if (entry.type !== "damage") {
      return makeSkipDecision(entry, "attacker", "attacker_damage_only");
    }
    if (!moduleConfig.showAttackerDamage) {
      return makeSkipDecision(entry, "attacker", "attacker_damage_disabled");
    }
    if (
      entry.type === "damage"
      && Number.isFinite(entry.damage)
      && entry.damage < moduleConfig.minAttackerDamage
    ) {
      return makeSkipDecision(entry, "attacker", "below_min_attacker_damage");
    }
    if (!isLightWeaponEntry(entry)) {
      return makeSkipDecision(entry, "attacker", "non_light_weapon_hidden");
    }

    return makeSendDecision({
      entry,
      role: "attacker",
      target: entry.attacker,
      message: buildAttackerMessage(entry),
      reason: `infantry_${entry.type}_attacker`,
    });
  }

  async function executeDecision(decision) {
    if (!decision) return null;
    if (decision.skipped) {
      return decision;
    }

    try {
      const result = await sendAdminWarn(decision.target, decision.message, decision.reason, decision.entry);
      return {
        role: decision.role,
        targetName: decision.target.name,
        message: decision.message,
        reason: decision.reason,
        success: Boolean(result?.success),
        skipped: Boolean(result?.skipped),
        skipReason: result?.skipReason ? String(result.skipReason) : "",
        errorMessage: result?.errorMessage ? String(result.errorMessage) : "",
        commandText: result?.commandText ? String(result.commandText) : "",
        relatedEventId: result?.relatedEventId ? String(result.relatedEventId) : decision.entry.combatEventId || decision.entry.sourceEventId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      moduleLogger?.warn?.(`Infantry combat warning failed for ${decision.target.name}: ${errorMessage}`);
      return {
        role: decision.role,
        targetName: decision.target.name,
        message: decision.message,
        reason: decision.reason,
        success: false,
        skipped: false,
        skipReason: "",
        errorMessage,
        commandText: "",
        relatedEventId: decision.entry.combatEventId || decision.entry.sourceEventId,
      };
    }
  }

  async function sendAdminWarn(target, message, reason, entry) {
    const adminWarn = modules?.adminWarn;
    const sender = adminWarn?.sendAdminWarn ?? adminWarn?.warnPlayer;
    if (typeof sender !== "function") {
      return {
        success: false,
        skipped: true,
        skipReason: "admin_warn_unavailable",
      };
    }

    return sender.call(adminWarn, {
      targetName: target.name,
      targetPlayerId: target.playerId,
      targetEosId: target.eosID,
      targetSteamId: target.steam64ID,
      message,
      reason,
      sourceModule: "module.infantryCombatEnhancer",
      relatedEventId: entry.combatEventId || entry.sourceEventId,
      system: true,
      requireTargetPlayerId: true,
    });
  }

  function makeSendDecision({ entry, role, target, message, reason }) {
    return {
      entry,
      role,
      target,
      message,
      reason,
      skipped: false,
    };
  }

  function makeSkipDecision(entry, role, skipReason) {
    return {
      role,
      target: role === "attacker" ? entry.attacker : entry.victim,
      message: "",
      reason: `infantry_${entry.type}_${role}`,
      skipped: true,
      skipReason,
      success: false,
      relatedEventId: entry.combatEventId || entry.sourceEventId,
    };
  }

  function buildVictimMessage(entry) {
    if (entry.type === "revive") {
      return `[BZSS]${entry.attacker.name || "队友"}复苏了你，立即归队作战`;
    }

    const damageText = Number.isFinite(entry.damage) ? `${trimTrailingZeros(entry.damage)}` : "unknown";
    const weaponText = entry.weapon || "unknown weapon";
    const friendlyFire = isFriendlyFireEntry(entry);
    const attackerName = friendlyFire ? `<友军>${entry.attacker.name || "the attacker"}` : (entry.attacker.name || "the attacker");
    if (entry.type === "damage") {
      return friendlyFire
        ? `[BZSS]你被${attackerName}使用${weaponText}造成${damageText}伤害`
        : `[BZSS]你被${attackerName}使用${weaponText}造成${damageText}伤害`;
    }
    if (entry.type === "wound") {
      return friendlyFire
        ? `[BZSS]你被${attackerName}使用${weaponText}击倒，造成${damageText}伤害`
        : `[BZSS]你被${attackerName}使用${weaponText}击倒，造成${damageText}伤害`;
    }
    if (entry.type === "kill") {
      return friendlyFire
        ? `[BZSS]你被${attackerName}击杀了`
        : `[BZSS]你被${attackerName}击杀了`;
    }
    return "Combat event processed.";
  }

  function buildAttackerMessage(entry) {
    if (entry.type === "revive") {
      return `[BZSS]你复苏了${entry.victim.name || "队友"}，继续并肩作战`;
    }

    const damageText = Number.isFinite(entry.damage) ? `${trimTrailingZeros(entry.damage)}` : "unknown";
    const victimName = entry.victim.name || "the target";
    const friendlyFire = isFriendlyFireEntry(entry);
    const friendlyVictimName = friendlyFire ? `<友军>${victimName}` : victimName;
    if (entry.type === "damage") {
      return friendlyFire
        ? `[BZSS]你他奶奶的使用${entry.weapon || "unknown weapon"}对${friendlyVictimName}，造成${damageText}伤害`
        : `[BZSS]你使用${entry.weapon || "unknown weapon"}对${friendlyVictimName}造成${damageText}伤害`;
    }
    if (entry.type === "wound") {
      return friendlyFire
        ? `[BZSS]你他奶奶的使用${entry.weapon || "unknown weapon"}击倒${friendlyVictimName}，造成${damageText}伤害`
        : `[BZSS]你使用${entry.weapon || "unknown weapon"}击倒${friendlyVictimName}，造成${damageText}伤害`;
    }
    if (entry.type === "kill") {
      return friendlyFire
        ? `[BZSS]你他奶奶的杀了${friendlyVictimName}`
        : `[BZSS]你击杀了${friendlyVictimName}`;
    }
    return "Combat event processed.";
  }

  function isFriendlyFireEntry(entry) {
    if (entry?.relation?.isFriendlyFire) return true;

    const tags = Array.isArray(entry?.tags) ? entry.tags.map((tag) => normalizeText(tag)) : [];
    if (tags.includes("combat.team_damage") || tags.includes("combat.team_wound") || tags.includes("combat.team_kill") || tags.includes("friendly_fire")) {
      return true;
    }

    const flags = Array.isArray(entry?.eventFlags) ? entry.eventFlags : [];
    return flags.some((flag) => {
      const key = normalizeText(flag?.key);
      const label = normalizeText(flag?.label);
      return key === "friendly_fire" || key === "tk_down" || label === "友伤" || label === "tk击倒" || label === "友军击杀";
    });
  }

  function isLightWeaponEntry(entry) {
    const tags = new Set([
      ...(Array.isArray(entry?.tags) ? entry.tags : []),
      ...(Array.isArray(entry?.eventFlagLabels) ? entry.eventFlagLabels : []),
      ...(Array.isArray(entry?.eventFlags)
        ? entry.eventFlags.flatMap((flag) => [flag?.key, flag?.label]).filter(Boolean)
        : []),
    ].map((tag) => normalizeText(tag)));

    // Explicit non-infantry sources always win, even if an upstream parser
    // accidentally leaves a small-arms tag on the same record.
    for (const tag of tags) {
      if (
        tag === "weapon.explosive"
        || tag === "weapon.vehicle"
        || tag === "weapon.emplacement"
        || tag === "weapon.artillery"
        || tag === "weapon.indirect_fire"
        || tag === "weapon.mortar"
        || tag === "weapon.rocket"
        || tag === "weapon.grenade"
        || tag === "weapon.unknown"
      ) {
        return false;
      }
    }

    return [...tags].some((tag) => LIGHT_WEAPON_TAGS.has(tag));
  }

  function extractIdentity(record, side) {
    const source = record?.[side] && typeof record[side] === "object" ? record[side] : {};
    const prefix = side === "attacker" ? "attacker" : "victim";
    return {
      name: pickText(
        record?.[`${prefix}Name`],
        source.name,
        source.displayName,
        source.playerName,
        source.nickname,
      ),
      playerId: pickText(
        record?.[`${prefix}PlayerID`],
        record?.[`${prefix}PlayerId`],
        source.playerID,
        source.playerId,
        source.id,
      ),
      steam64ID: pickText(
        record?.[`${prefix}Steam64ID`],
        record?.[`${prefix}SteamId`],
        source.steam64ID,
        source.steamID,
        source.steamId,
      ),
      eosID: pickText(
        record?.[`${prefix}EOSID`],
        record?.[`${prefix}EosID`],
        source.eosID,
        source.eosId,
      ),
      controllerID: pickText(
        record?.[`${prefix}ControllerID`],
        record?.[`${prefix}ControllerId`],
        source.controllerID,
        source.controllerId,
      ),
      teamID: pickText(
        record?.[`${prefix}TeamID`],
        record?.[`${prefix}TeamId`],
        source.teamID,
        source.teamId,
      ),
    };
  }

  function isSamePlayer(left, right) {
    const ids = [
      [left.steam64ID, right.steam64ID],
      [left.eosID, right.eosID],
      [left.controllerID, right.controllerID],
    ];

    for (const [a, b] of ids) {
      if (a && b && normalizeText(a) === normalizeText(b)) return true;
    }

    const leftName = normalizeText(left.name);
    const rightName = normalizeText(right.name);
    return Boolean(leftName && rightName && leftName === rightName);
  }

  function resolveWeaponName(record) {
    return pickText(
      record?.weaponName,
      record?.weapon?.displayName,
      record?.weapon?.cleaned,
      record?.weapon?.raw,
      record?.weapon,
      record?.causedBy,
      "",
    );
  }

  function buildOverview(filter = {}) {
    const records = store.list(filter);
    const stats = {
      total: 0,
      damage: 0,
      wound: 0,
      kill: 0,
      revive: 0,
      victimWarned: 0,
      attackerWarned: 0,
      skipped: 0,
      failed: 0,
      victimSkipped: 0,
      attackerSkipped: 0,
      victimFailed: 0,
      attackerFailed: 0,
      friendlyFire: 0,
      selfDamage: 0,
      samePlayer: 0,
      lightWeapon: 0,
      nonLightWeapon: 0,
      skipReasons: Object.create(null),
    };

    for (const record of records) {
      stats.total += 1;
      if (record.type && record.type in stats) stats[record.type] += 1;
      if (record.victimWarning?.success) stats.victimWarned += 1;
      if (record.attackerWarning?.success) stats.attackerWarned += 1;
      if (record.victimWarning?.skipped) stats.victimSkipped += 1;
      if (record.attackerWarning?.skipped) stats.attackerSkipped += 1;
      if (record.victimWarning && record.victimWarning.success === false && !record.victimWarning.skipped) stats.victimFailed += 1;
      if (record.attackerWarning && record.attackerWarning.success === false && !record.attackerWarning.skipped) stats.attackerFailed += 1;
      if (record.victimWarning?.skipped || record.attackerWarning?.skipped) stats.skipped += 1;
      if (record.victimWarning && record.victimWarning.success === false && !record.victimWarning.skipped) stats.failed += 1;
      if (record.attackerWarning && record.attackerWarning.success === false && !record.attackerWarning.skipped) stats.failed += 1;
      if (isFriendlyFireEntry(record)) stats.friendlyFire += 1;
      if (isSelfDamageEntry(record)) stats.selfDamage += 1;
      if (record.samePlayer) stats.samePlayer += 1;
      if (isLightWeaponEntry(record)) stats.lightWeapon += 1;
      else stats.nonLightWeapon += 1;
      collectSkipReason(stats.skipReasons, record.victimWarning);
      collectSkipReason(stats.skipReasons, record.attackerWarning);
    }

    return {
      count: records.length,
      stats,
      lastUpdatedAt,
      config: api.getConfig(),
      dependencies: {
        combatClean: {
          loaded: Boolean(modules?.combatClean),
          subscribed: modules?.pluginSubscriptions?.isSubscribed?.(COMBAT_CLEAN_SUBSCRIPTION_ID) !== false
            && core.pluginSubscriptions?.isSubscribed?.(COMBAT_CLEAN_SUBSCRIPTION_ID) !== false,
        },
        adminWarn: {
          loaded: Boolean(modules?.adminWarn),
          available: Boolean(modules?.adminWarn?.sendAdminWarn || modules?.adminWarn?.warnPlayer),
        },
      },
      latest: records.slice(0, 20).map(cloneJsonSafe),
    };
  }

  function isEnabled() {
    return Boolean(moduleConfig.enabled);
  }

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.("module.infantryCombatEnhancer") !== false
      && core.pluginSubscriptions?.isSubscribed?.("module.infantryCombatEnhancer") !== false
      && modules?.pluginSubscriptions?.isSubscribed?.(COMBAT_CLEAN_SUBSCRIPTION_ID) !== false
      && core.pluginSubscriptions?.isSubscribed?.(COMBAT_CLEAN_SUBSCRIPTION_ID) !== false;
  }

  return {
    manifest: {
      id: "module.infantryCombatEnhancer",
      name: "Infantry Combat Enhancer",
      kind: "module",
      version: "0.1.0",
      description: "Consumes processed combat records and sends short-lived warning messages to the players involved while keeping a recent event buffer for the web UI.",
    },
    apiName: "infantryCombatEnhancer",
    api,

    async start() {
      core.webRegistry?.registerPage?.({
        id: "web.infantryCombatEnhancer",
        title: "Infantry Combat Enhancer",
        group: "扩展",
        route: "/plugins/infantry-combat-enhancer",
        pageModule: "/pages/infantry-combat-enhancer.js",
        source: "module.infantryCombatEnhancer",
        description: "Processed combat warnings for the current infantry flow.",
        required: false,
        enabled: true,
        order: 113,
        icon: "I",
        hiddenFromSidebar: true,
      });

      if (!isEnabled() || !isSubscribed()) {
        moduleLogger?.info?.("InfantryCombatEnhancer started in disabled mode.");
        return;
      }

      const eventBus = core.eventBus;
      if (eventBus?.onModuleEvent) {
        unsubscribers.push(eventBus.onModuleEvent("module.combatClean", "combat.record.processed", handleCombatProcessedEvent));
        unsubscribers.push(eventBus.onModuleEvent("module.combatClean", "reviveResolved", handleCombatProcessedEvent));
      }

      moduleLogger?.info?.("InfantryCombatEnhancer started.");
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe();
        } catch {}
      }

      for (const buffer of damageAggregation.values()) {
        if (buffer?.timeoutId) {
          try {
            clearTimeout(buffer.timeoutId);
          } catch {}
        }
      }
      damageAggregation.clear();

      store.clear();
      moduleLogger?.info?.("InfantryCombatEnhancer stopped.");
    },
  };
}

class InfantryEnhancerStore {
  constructor(maxRecords) {
    this.maxRecords = Math.max(1, Number(maxRecords ?? 300));
    this.records = [];
  }

  setMaxRecords(maxRecords) {
    this.maxRecords = Math.max(1, Number(maxRecords ?? this.maxRecords));
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
  }

  push(record) {
    this.records.push(cloneJsonSafe(record));
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
    return this.records[this.records.length - 1];
  }

  list(filter = {}) {
    const serverId = normalizeText(filter.serverId);
    const type = normalizeType(filter.type);
    const warning = normalizeWarning(filter.warning);
    const relation = normalizeRelation(filter.relation);
    const weapon = normalizeWeapon(filter.weapon);
    const search = normalizeText(filter.search);

    return this.records
      .slice()
      .reverse()
      .filter((record) => {
        if (serverId && normalizeText(record.serverId) !== serverId) return false;
        if (type && type !== "all" && record.type !== type) return false;
        if (warning && warning !== "all" && !matchesWarning(record, warning)) return false;
        if (relation && relation !== "all" && !matchesRelation(record, relation)) return false;
        if (weapon && weapon !== "all" && !matchesWeapon(record, weapon)) return false;
        if (search && !recordMatchesSearch(record, search)) return false;
        return true;
      });
  }

  query(filter = {}) {
    const limit = clampLimit(filter.limit, this.maxRecords);
    const offset = Math.max(Number(filter.offset ?? 0) || 0, 0);
    return this.list(filter).slice(offset, offset + limit).map(cloneJsonSafe);
  }

  clear() {
    const cleared = this.records.length;
    this.records.splice(0);
    return cleared;
  }
}

function normalizeModuleConfig(source = {}) {
  return {
    enabled: source.enabled !== false,
      minAttackerDamage: Math.max(0, Number(source.minAttackerDamage ?? DEFAULT_CONFIG.minAttackerDamage)),
    damageDebounceMs: Math.max(0, Number(source.damageDebounceMs ?? DEFAULT_CONFIG.damageDebounceMs)),
    showVictimDamage: source.showVictimDamage !== false,
    showVictimWound: source.showVictimWound !== false,
    showVictimKill: source.showVictimKill !== false,
    showAttackerDamage: source.showAttackerDamage !== false,
    storeRecentEventLimit: Math.max(1, Number(source.storeRecentEventLimit ?? source.maxRecords ?? DEFAULT_CONFIG.storeRecentEventLimit)),
    damageAggregation: normalizeDamageAggregationConfig(source.damageAggregation, source),
  };
}

function normalizeDamageAggregationConfig(source = {}, root = {}) {
  const legacyDebounceMs = Math.max(0, Number(root.damageDebounceMs ?? DEFAULT_CONFIG.damageDebounceMs));
  return {
    enabled: source?.enabled === true,
    debounceMs: Math.max(0, Number(source?.debounceMs ?? legacyDebounceMs)),
  };
}

function normalizeType(value) {
  const text = normalizeText(value);
  if (text === "damage" || text === "wound" || text === "kill" || text === "revive") return text;
  if (text === "revived") return "revive";
  if (text === "death") return "kill";
  return text;
}

function normalizeWarning(value) {
  const text = normalizeText(value);
  if (text === "victim_sent" || text === "attacker_sent" || text === "skipped" || text === "failed") return text;
  return "all";
}

function normalizeRelation(value) {
  const text = normalizeText(value);
  if (text === "enemy" || text === "friendly" || text === "self" || text === "same_player") return text;
  return "all";
}

function normalizeWeapon(value) {
  const text = normalizeText(value);
  if (text === "light" || text === "non_light" || text === "explosive" || text === "vehicle" || text === "emplacement" || text === "unknown") return text;
  return "all";
}

function normalizeDamage(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : NaN;
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function pickText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

const LIGHT_WEAPON_TAGS = new Set([
  "weapon.small_arm",
  "weapon.rifle",
  "weapon.carbine",
  "weapon.machine_gun",
  "weapon.marksman_rifle",
  "weapon.sniper_rifle",
  "weapon.pistol",
  "weapon.shotgun",
]);

function makeEntryId(time, seed) {
  const token = String(seed ?? "").replace(/[^A-Za-z0-9_.:-]/g, "_") || "event";
  return `infantry:${token}:${String(time).replace(/[^A-Za-z0-9_.:-]/g, "_")}:${Math.random().toString(16).slice(2)}`;
}

function trimTrailingZeros(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return String(Math.round(number));
}

function collectSkipReason(bucket, decision) {
  const reason = String(decision?.skipReason ?? "").trim();
  if (!reason) return;
  bucket[reason] = (bucket[reason] ?? 0) + 1;
}

function matchesWarning(record, warning) {
  const victim = record?.victimWarning;
  const attacker = record?.attackerWarning;

  if (warning === "victim_sent") return Boolean(victim?.success);
  if (warning === "attacker_sent") return Boolean(attacker?.success);
  if (warning === "skipped") return Boolean(victim?.skipped || attacker?.skipped);
  if (warning === "failed") {
    return Boolean(
      (victim && victim.success === false && !victim.skipped)
      || (attacker && attacker.success === false && !attacker.skipped),
    );
  }

  return true;
}

function matchesRelation(record, relation) {
  if (relation === "same_player") return Boolean(record?.samePlayer);
  if (relation === "friendly") return isFriendlyFireEntry(record);
  if (relation === "self") return isSelfDamageEntry(record);
  if (relation === "enemy") return !isFriendlyFireEntry(record) && !record?.samePlayer && !isSelfDamageEntry(record);
  return true;
}

function matchesWeapon(record, weapon) {
  if (weapon === "light") return isLightWeaponEntry(record);
  if (weapon === "non_light") return !isLightWeaponEntry(record);
  if (weapon === "explosive") return hasAnyTag(record, ["weapon.explosive"]);
  if (weapon === "vehicle") return hasAnyTag(record, ["weapon.vehicle"]);
  if (weapon === "emplacement") return hasAnyTag(record, ["weapon.emplacement"]);
  if (weapon === "unknown") return !record?.weapon || hasAnyTag(record, ["weapon.unknown"]);
  return true;
}

function hasAnyTag(record, tags) {
  const values = new Set([
    ...(Array.isArray(record?.tags) ? record.tags : []),
    ...(Array.isArray(record?.eventFlagLabels) ? record.eventFlagLabels : []),
    ...(Array.isArray(record?.eventFlags) ? record.eventFlags.map((flag) => flag?.key || flag?.label).filter(Boolean) : []),
  ].map((value) => normalizeText(value)));

  return tags.some((tag) => values.has(normalizeText(tag)));
}

function isSelfDamageEntry(entry) {
  if (entry?.samePlayer) return true;
  if (entry?.relation?.isSelfDamage || entry?.relation?.selfDamage) return true;
  return hasAnyTag(entry, ["relation.self", "event:self_damage", "self_damage", "combat.self_damage"]);
}

function recordMatchesSearch(record, search) {
  const haystacks = [
    record?.attackerName,
    record?.victimName,
    record?.weapon,
    record?.attackerSteam64ID,
    record?.attackerEOSID,
    record?.victimSteam64ID,
    record?.victimEOSID,
    record?.attackerControllerID,
    record?.victimControllerID,
    record?.sourceEventId,
    record?.combatEventId,
    record?.victimWarning?.skipReason,
    record?.attackerWarning?.skipReason,
    record?.victimWarning?.errorMessage,
    record?.attackerWarning?.errorMessage,
    record?.victimWarning?.commandText,
    record?.attackerWarning?.commandText,
  ].filter(Boolean).map((value) => normalizeText(value));

  const needle = normalizeText(search);
  return haystacks.some((value) => value.includes(needle));
}

function clampLimit(value, maxLimit) {
  const number = Number(value);
  if (!Number.isFinite(number)) return Math.max(1, Math.min(100, maxLimit));
  return Math.max(1, Math.min(Math.floor(number), maxLimit));
}

function cloneJsonSafe(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}
