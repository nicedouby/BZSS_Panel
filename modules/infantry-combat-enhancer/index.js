// -*- coding: utf-8 -*-

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  forceAttackerDamageDisplay: false,
  minAttackerDamage: 15,
  showKillDisplay: false,
  showOnlyLightWeaponDamage: true,
  showVictimDamage: true,
  showVictimWound: true,
  showVictimKill: true,
  showAttackerDamage: true,
  storeRecentEventLimit: 300,
});

const VALID_TYPES = new Set(["damage", "wound", "kill"]);
const COMBAT_CLEAN_SUBSCRIPTION_ID = "module.combatClean";

export function createInfantryCombatEnhancerModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.infantryCombatEnhancer",
    source: "module.infantryCombatEnhancer",
    channel: "module",
  }) ?? core.logger;
  const moduleConfig = normalizeModuleConfig(config?.get?.("modules.infantryCombatEnhancer", {}));
  const store = new InfantryEnhancerStore(moduleConfig.storeRecentEventLimit);
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

    getOverview() {
      return buildOverview();
    },

    getState() {
      return {
        config: api.getConfig(),
        overview: api.getOverview(),
        events: api.getEvents({ limit: moduleConfig.storeRecentEventLimit }),
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
    if (Number.isFinite(damage) && Math.abs(damage) < 5) return null;
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

    const victimDecision = buildVictimDecision(baseEntry);
    const attackerDecision = buildAttackerDecision(baseEntry);

    const [victimWarning, attackerWarning] = await Promise.all([
      executeDecision(victimDecision),
      executeDecision(attackerDecision),
    ]);

    baseEntry.victimWarning = victimWarning;
    baseEntry.attackerWarning = attackerWarning;
    baseEntry.warnings = [victimWarning, attackerWarning].filter(Boolean);

    store.push(baseEntry);
    lastUpdatedAt = processedAt;

    core.eventBus?.emitModuleEvent?.("module.infantryCombatEnhancer", "updated", {
      eventName: "module.infantryCombatEnhancer.updated",
      layer: "module",
      source: "module.infantryCombatEnhancer",
      serverId,
      time: processedAt,
      record: cloneJsonSafe(baseEntry),
      overview: buildOverview(),
    });

    return baseEntry;
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
    if (entry.type === "damage" && moduleConfig.showOnlyLightWeaponDamage && !isLightWeaponEntry(entry)) {
      return makeSkipDecision(entry, "attacker", "non_light_weapon_hidden");
    }
    if (entry.type === "kill" && !moduleConfig.showKillDisplay) {
      return makeSkipDecision(entry, "attacker", "kill_display_disabled");
    }
    if (!entry.attacker.name) {
      return makeSkipDecision(entry, "attacker", "attacker_missing_target");
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
      targetEosId: target.eosID,
      targetSteamId: target.steam64ID,
      message,
      reason,
      sourceModule: "module.infantryCombatEnhancer",
      relatedEventId: entry.combatEventId || entry.sourceEventId,
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
    const damageText = Number.isFinite(entry.damage) ? `${trimTrailingZeros(entry.damage)}` : "unknown";
    const victimName = entry.victim.name || "the target";
    const friendlyFire = isFriendlyFireEntry(entry);
    const friendlyVictimName = friendlyFire ? `<友军>${victimName}` : victimName;
    if (entry.type === "damage") {
      return friendlyFire
        ? `[BZSS]你他妈的使用${entry.weapon || "unknown weapon"}对${friendlyVictimName}，造成${damageText}伤害`
        : `[BZSS]你使用${entry.weapon || "unknown weapon"}对${friendlyVictimName}造成${damageText}伤害`;
    }
    if (entry.type === "wound") {
      return friendlyFire
        ? `[BZSS]你他妈的使用${entry.weapon || "unknown weapon"}击倒${friendlyVictimName}，造成${damageText}伤害`
        : `[BZSS]你使用${entry.weapon || "unknown weapon"}击倒${friendlyVictimName}，造成${damageText}伤害`;
    }
    if (entry.type === "kill") {
      return friendlyFire
        ? `[BZSS]你他妈的杀了${friendlyVictimName}`
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
    const tags = Array.isArray(entry?.tags) ? entry.tags.map((tag) => normalizeText(tag)) : [];
    return tags.some((tag) => LIGHT_WEAPON_TAGS.has(tag));
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

  function buildOverview() {
    const stats = {
      total: 0,
      damage: 0,
      wound: 0,
      kill: 0,
      victimWarned: 0,
      attackerWarned: 0,
      samePlayerSuppressed: 0,
      skipped: 0,
      failed: 0,
    };

    for (const record of store.records) {
      stats.total += 1;
      if (record.type in stats) stats[record.type] += 1;
      if (record.victimWarning?.success) stats.victimWarned += 1;
      if (record.attackerWarning?.success) stats.attackerWarned += 1;
      if (record.attackerWarning?.skipReason === "same_player") stats.samePlayerSuppressed += 1;
      if (record.victimWarning?.skipped || record.attackerWarning?.skipped) stats.skipped += 1;
      if (record.victimWarning && record.victimWarning.success === false && !record.victimWarning.skipped) stats.failed += 1;
      if (record.attackerWarning && record.attackerWarning.success === false && !record.attackerWarning.skipped) stats.failed += 1;
    }

    return {
      count: store.records.length,
      stats,
      lastUpdatedAt,
      config: api.getConfig(),
      latest: store.records.slice(-20).reverse().map(cloneJsonSafe),
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
      }

      moduleLogger?.info?.("InfantryCombatEnhancer started.");
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe();
        } catch {}
      }
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

  query(filter = {}) {
    const limit = clampLimit(filter.limit, this.maxRecords);
    const offset = Math.max(Number(filter.offset ?? 0) || 0, 0);
    const search = normalizeText(filter.search);
    const type = normalizeType(filter.type);
    const serverId = normalizeText(filter.serverId);

    return this.records
      .slice()
      .reverse()
      .filter((record) => {
        if (serverId && normalizeText(record.serverId) !== serverId) return false;
        if (type && type !== "all" && record.type !== type) return false;
        if (search && !recordMatchesSearch(record, search)) return false;
        return true;
      })
      .slice(offset, offset + limit)
      .map(cloneJsonSafe);
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
    forceAttackerDamageDisplay: Boolean(source.forceAttackerDamageDisplay ?? DEFAULT_CONFIG.forceAttackerDamageDisplay),
    minAttackerDamage: Math.max(0, Number(source.minAttackerDamage ?? DEFAULT_CONFIG.minAttackerDamage)),
    showKillDisplay: source.showKillDisplay ?? DEFAULT_CONFIG.showKillDisplay,
    showOnlyLightWeaponDamage: source.showOnlyLightWeaponDamage ?? DEFAULT_CONFIG.showOnlyLightWeaponDamage,
    showVictimDamage: source.showVictimDamage !== false,
    showVictimWound: source.showVictimWound !== false,
    showVictimKill: source.showVictimKill !== false,
    showAttackerDamage: source.showAttackerDamage !== false,
    storeRecentEventLimit: Math.max(1, Number(source.storeRecentEventLimit ?? source.maxRecords ?? DEFAULT_CONFIG.storeRecentEventLimit)),
  };
}

function normalizeType(value) {
  const text = normalizeText(value);
  if (text === "damage" || text === "wound" || text === "kill") return text;
  if (text === "death") return "kill";
  return text;
}

function normalizeDamage(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
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
  const text = String(value);
  if (!text.includes(".")) return text;
  return text.replace(/\.0+$/, "").replace(/(\.\d*?[1-9])0+$/, "$1");
}

function clampLimit(value, maxLimit) {
  const number = Number(value);
  if (!Number.isFinite(number)) return Math.max(1, Math.min(200, maxLimit));
  return Math.max(1, Math.min(Math.floor(number), maxLimit));
}

function recordMatchesSearch(record, search) {
  const fields = [
    record.attackerName,
    record.victimName,
    record.weapon,
    record.reason,
    record.type,
    record.serverId,
    record.sourceEventId,
    record.combatEventId,
    record.victimWarning?.message,
    record.attackerWarning?.message,
    record.victimWarning?.skipReason,
    record.attackerWarning?.skipReason,
  ];
  return fields.some((field) => normalizeText(field).includes(search));
}

function cloneJsonSafe(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}
