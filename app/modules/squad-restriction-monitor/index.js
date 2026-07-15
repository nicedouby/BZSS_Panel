// -*- coding: utf-8 -*-

import {
  evaluateSquadName,
  loadSquadNamePolicy,
} from "../../domain/squad-name-policy/index.js";

const MODULE_ID = "module.squadRestrictionMonitor";
const API_NAME = "squadRestrictionMonitor";

export const DEFAULT_SQUAD_RESTRICTION_RULES = Object.freeze({
  matv: Object.freeze({ allowLock: true, allowSoloLock: false, maxPlayersWhenLocked: 3 }),
  ifv: Object.freeze({ allowLock: true, allowSoloLock: false, maxPlayersWhenLocked: 3 }),
  apc: Object.freeze({ allowLock: true, allowSoloLock: false, maxPlayersWhenLocked: 3 }),
  tank: Object.freeze({ allowLock: true, allowSoloLock: false, maxPlayersWhenLocked: 3 }),
  atgm_matv: Object.freeze({ allowLock: true, allowSoloLock: true, maxPlayersWhenLocked: 3 }),
  artillery_vehicle: Object.freeze({ allowLock: true, allowSoloLock: true, maxPlayersWhenLocked: 3 }),
  helicopter: Object.freeze({ allowLock: true, allowSoloLock: true, maxPlayersWhenLocked: 3 }),
  attack_helicopter: Object.freeze({ allowLock: true, allowSoloLock: true, maxPlayersWhenLocked: 3 }),
  infantry: Object.freeze({ allowLock: false, allowSoloLock: false, maxPlayersWhenLocked: null }),
  logistics: Object.freeze({ allowLock: true, allowSoloLock: true, maxPlayersWhenLocked: 6 }),
  mortar: Object.freeze({ allowLock: true, allowSoloLock: true, maxPlayersWhenLocked: 4 }),
});

const NATURE_LABELS = Object.freeze({
  infantry: "步兵",
  vehicle: "载具",
  support: "支援",
  logistics: "后勤",
  other: "其他",
});

export function createSquadRestrictionMonitorModule({ core, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: MODULE_ID,
    source: MODULE_ID,
    channel: "module",
  }) ?? core.logger;

  const unsubscribers = [];
  const classificationCache = new Map();
  let runtimeConfig = readConfig(config);
  let cachedPolicy = null;
  let cachedPolicyFingerprint = "";
  let state = makeEmptyState(runtimeConfig.enabled);

  const api = {
    evaluateSquad(squad = {}, options = {}) {
      runtimeConfig = readConfig(config);
      const policy = options.policy ?? getPolicy();
      return evaluateSquad(squad, policy, runtimeConfig);
    },

    evaluateSquads(squads = []) {
      runtimeConfig = readConfig(config);
      const policy = getPolicy();
      return (Array.isArray(squads) ? squads : []).map((squad) => evaluateSquad(squad, policy, runtimeConfig));
    },

    getRule(typeId = "") {
      runtimeConfig = readConfig(config);
      return clone(runtimeConfig.typeRules[String(typeId ?? "").trim()] ?? null);
    },

    getState() {
      return clone(state);
    },

    reload() {
      cachedPolicy = null;
      cachedPolicyFingerprint = "";
      classificationCache.clear();
      runtimeConfig = readConfig(config);
      return {
        ok: true,
        enabled: runtimeConfig.enabled,
        ruleCount: Object.keys(runtimeConfig.typeRules).length,
      };
    },
  };

  return {
    manifest: {
      id: MODULE_ID,
      name: "Squad Restriction Monitor",
      kind: "module",
      version: "1.0.0",
      description: "Detect locked-squad rule violations without taking enforcement actions.",
    },
    apiName: API_NAME,
    api,

    async start() {
      runtimeConfig = readConfig(config);
      state = makeEmptyState(runtimeConfig.enabled);
      unsubscribers.push(core.eventBus.onModuleEvent("module.matchState", "squadsUpdated", (event = {}) => {
        const squads = Array.isArray(event.squads) ? event.squads : [];
        const evaluations = squads.map((squad) => {
          if (squad?.squadRestriction && typeof squad.squadRestriction === "object") {
            return squad;
          }
          return api.evaluateSquad(squad);
        });
        const violations = evaluations.filter((squad) => squad?.squadRestriction?.isViolation);
        state = {
          enabled: runtimeConfig.enabled,
          enforcementEnabled: false,
          serverId: text(event.serverId),
          updatedAt: new Date().toISOString(),
          squadCount: evaluations.length,
          evaluatedCount: evaluations.filter((squad) => squad?.squadRestriction?.evaluated).length,
          violationCount: violations.length,
          violations: violations.map(toStateRecord),
          squads: evaluations.map(toStateRecord),
        };
        core.eventBus.emitModuleEvent(MODULE_ID, "updated", {
          eventName: `${MODULE_ID}.updated`,
          source: MODULE_ID,
          ...clone(state),
        });
      }));

      moduleLogger?.info?.("SquadRestrictionMonitor module started in monitor-only mode.", {
        operation: "start",
        data: {
          enforcementEnabled: false,
          ruleCount: Object.keys(runtimeConfig.typeRules).length,
        },
      });
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe();
        } catch {}
      }
      classificationCache.clear();
      cachedPolicy = null;
      cachedPolicyFingerprint = "";
    },
  };

  function getPolicy() {
    const policy = loadSquadNamePolicy(config);
    const fingerprint = [
      Number(policy?.version ?? 0),
      Number(policy?.revision ?? 0),
      String(policy?.updatedAt ?? ""),
      Array.isArray(policy?.types) ? policy.types.length : 0,
      Array.isArray(policy?.entries) ? policy.entries.length : 0,
    ].join("|");
    if (fingerprint !== cachedPolicyFingerprint) {
      cachedPolicy = policy;
      cachedPolicyFingerprint = fingerprint;
      classificationCache.clear();
    }
    return cachedPolicy;
  }

  function evaluateSquad(squad, policy, settings) {
    const squadName = text(squad?.squadName ?? squad?.name);
    const classification = resolveClassification(squadName, policy);
    const typeId = text(classification?.typeId ?? squad?.squadTypeId);
    const typeLabel = text(classification?.typeLabel ?? squad?.squadTypeLabel);
    const nature = text(classification?.nature ?? squad?.squadNature) || "other";
    const locked = Boolean(squad?.locked ?? squad?.isLocked);
    const playerCount = normalizePlayerCount(squad?.size ?? squad?.memberCount ?? squad?.playerCount);
    const rule = typeId ? settings.typeRules[typeId] ?? null : null;
    const restriction = evaluateRestriction({
      enabled: settings.enabled,
      typeId,
      typeLabel,
      locked,
      playerCount,
      rule,
    });

    return {
      ...squad,
      squadType: nature,
      squadNature: nature,
      squadNatureLabel: NATURE_LABELS[nature] ?? NATURE_LABELS.other,
      squadNatureReason: text(classification?.reason) || null,
      squadNatureRule: text(classification?.ruleId) || null,
      squadNatureConfidence: classification ? "high" : "low",
      squadNatureNormalizedName: squadName,
      squadTypeId: typeId,
      squadTypeLabel: typeLabel,
      squadRuleId: text(classification?.ruleId),
      effectiveMaxPlayers: nullableNumber(classification?.effectiveMaxPlayers),
      maxPlayersSource: text(classification?.maxPlayersSource) || "none",
      assetPath: text(classification?.assetPath),
      classificationMetadata: clone(classification?.metadata ?? {}),
      squadRestriction: restriction,
      restrictionStatus: restriction.status,
      restrictionViolation: restriction.isViolation,
      restrictionReasons: [...restriction.reasons],
    };
  }

  function resolveClassification(squadName, policy) {
    const cacheKey = squadName.trim().toLocaleLowerCase();
    if (classificationCache.has(cacheKey)) return classificationCache.get(cacheKey);
    const evaluation = evaluateSquadName(squadName, policy);
    const classification = evaluation?.classification && typeof evaluation.classification === "object"
      ? evaluation.classification
      : null;
    classificationCache.set(cacheKey, classification);
    return classification;
  }
}

export function evaluateRestriction({ enabled = true, typeId = "", typeLabel = "", locked = false, playerCount = 0, rule = null } = {}) {
  const normalizedRule = normalizeRule(rule);
  const base = {
    moduleId: MODULE_ID,
    enforcementEnabled: false,
    evaluated: Boolean(enabled && normalizedRule),
    status: "not_applicable",
    isViolation: false,
    typeId: text(typeId),
    typeLabel: text(typeLabel),
    locked: Boolean(locked),
    playerCount: normalizePlayerCount(playerCount),
    allowLock: normalizedRule?.allowLock ?? null,
    allowSoloLock: normalizedRule?.allowSoloLock ?? null,
    maxPlayersWhenLocked: normalizedRule?.maxPlayersWhenLocked ?? null,
    violations: [],
    reasons: [],
  };

  if (!enabled) return { ...base, status: "disabled" };
  if (!normalizedRule) return base;
  if (!base.locked) return { ...base, status: "compliant" };

  const violations = [];
  if (!normalizedRule.allowLock) {
    violations.push({
      code: "lock_forbidden",
      message: `${base.typeLabel || base.typeId || "该类型队伍"}不允许锁队。`,
      actual: true,
      expected: false,
    });
  } else {
    if (!normalizedRule.allowSoloLock && base.playerCount <= 1) {
      violations.push({
        code: "solo_lock_forbidden",
        message: `${base.typeLabel || base.typeId || "该类型队伍"}不允许单人锁队。`,
        actual: base.playerCount,
        limit: 2,
      });
    }
    if (normalizedRule.maxPlayersWhenLocked != null && base.playerCount > normalizedRule.maxPlayersWhenLocked) {
      violations.push({
        code: "locked_player_limit_exceeded",
        message: `锁队时人数必须不超过 ${normalizedRule.maxPlayersWhenLocked} 人，当前为 ${base.playerCount} 人。`,
        actual: base.playerCount,
        limit: normalizedRule.maxPlayersWhenLocked,
      });
    }
  }

  return {
    ...base,
    status: violations.length > 0 ? "violation" : "compliant",
    isViolation: violations.length > 0,
    violations,
    reasons: violations.map((item) => item.message),
  };
}

function readConfig(config) {
  const raw = config?.get?.("modules.squadRestrictionMonitor", {}) ?? {};
  const overrides = raw.typeRules && typeof raw.typeRules === "object" && !Array.isArray(raw.typeRules)
    ? raw.typeRules
    : {};
  const typeRules = {};
  for (const [typeId, defaultRule] of Object.entries(DEFAULT_SQUAD_RESTRICTION_RULES)) {
    typeRules[typeId] = normalizeRule({
      ...defaultRule,
      ...(overrides[typeId] && typeof overrides[typeId] === "object" ? overrides[typeId] : {}),
    });
  }
  for (const [typeId, override] of Object.entries(overrides)) {
    if (Object.hasOwn(typeRules, typeId)) continue;
    const rule = normalizeRule(override);
    if (rule) typeRules[typeId] = rule;
  }
  return {
    enabled: raw.enabled !== false,
    enforcementEnabled: false,
    typeRules,
  };
}

function normalizeRule(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule) || rule.enabled === false) return null;
  return {
    allowLock: rule.allowLock !== false,
    allowSoloLock: rule.allowSoloLock !== false,
    maxPlayersWhenLocked: nullablePositiveInteger(rule.maxPlayersWhenLocked),
  };
}

function toStateRecord(squad = {}) {
  return {
    key: text(squad?.key) || buildSquadKey(squad),
    teamId: nullableNumber(squad?.teamID ?? squad?.teamId),
    squadId: nullableNumber(squad?.squadID ?? squad?.squadId),
    squadName: text(squad?.squadName ?? squad?.name),
    locked: Boolean(squad?.locked ?? squad?.isLocked),
    playerCount: normalizePlayerCount(squad?.size ?? squad?.memberCount ?? squad?.playerCount),
    squadNature: text(squad?.squadNature),
    squadTypeId: text(squad?.squadTypeId),
    squadTypeLabel: text(squad?.squadTypeLabel),
    squadRuleId: text(squad?.squadRuleId),
    restriction: clone(squad?.squadRestriction ?? null),
  };
}

function makeEmptyState(enabled) {
  return {
    enabled: Boolean(enabled),
    enforcementEnabled: false,
    serverId: "",
    updatedAt: "",
    squadCount: 0,
    evaluatedCount: 0,
    violationCount: 0,
    violations: [],
    squads: [],
  };
}

function buildSquadKey(squad = {}) {
  const teamId = nullableNumber(squad?.teamID ?? squad?.teamId);
  const squadId = nullableNumber(squad?.squadID ?? squad?.squadId);
  return teamId != null && squadId != null ? `${teamId}:${squadId}` : "";
}

function normalizePlayerCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

function nullablePositiveInteger(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nullableNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value) {
  return String(value ?? "").trim();
}

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}
