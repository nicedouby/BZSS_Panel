// -*- coding: utf-8 -*-

import { normalizeSquadName } from "./squad_name_normalizer.js";
import { squadNameRules } from "./squad_name_rules.js";

export { normalizeSquadName };

export const SQUAD_NATURE = Object.freeze({
  INFANTRY: "infantry",
  VEHICLE: "vehicle",
  SUPPORT: "support",
  OTHER: "other",
});

export const SQUAD_NATURE_LABEL = Object.freeze({
  infantry: "步兵队",
  vehicle: "载具队",
  support: "支援队",
  other: "其他",
});

export const SQUAD_VEHICLE_CLASS = Object.freeze({
  IFV: "ifv",
  LIGHT_VEHICLE: "light_vehicle",
  TANK: "tank",
  SPG: "spg",
  OTHER: "other",
});

export const SQUAD_VEHICLE_CLASS_LABEL = Object.freeze({
  ifv: "步兵战车",
  light_vehicle: "轻型载具",
  tank: "坦克",
  spg: "SPG",
  other: "其他",
});

const NATURE_PRIORITY = Object.freeze([
  SQUAD_NATURE.SUPPORT,
  SQUAD_NATURE.VEHICLE,
  SQUAD_NATURE.INFANTRY,
  SQUAD_NATURE.OTHER,
]);

const RULE_STRENGTH = Object.freeze({
  exact: 3,
  alias: 3,
  contains: 2,
  regex: 1,
});

const VEHICLE_CLASS_PRIORITY = Object.freeze([
  SQUAD_VEHICLE_CLASS.SPG,
  SQUAD_VEHICLE_CLASS.TANK,
  SQUAD_VEHICLE_CLASS.IFV,
  SQUAD_VEHICLE_CLASS.LIGHT_VEHICLE,
]);

export function classifySquadName(squadName, options = {}) {
  const includeDebug = options.includeDebug !== false;
  const rules = mergeRules(squadNameRules, options.rulesOverride ?? options.rules ?? null);
  const normalizedName = normalizeSquadName(squadName);

  if (!normalizedName) {
    return makeResult({
      nature: SQUAD_NATURE.OTHER,
      matchedRule: null,
      matchedValue: null,
      normalizedName,
      reason: "队名为空，归类为其他。",
      confidence: "low",
      debug: buildEmptyDebug(includeDebug),
    });
  }

  const debug = buildEmptyDebug(includeDebug);

  const defaultHit = matchDefaultPattern(normalizedName, rules.defaultSquadNamePatterns);
  if (defaultHit) {
    debug.defaultNameHit = true;
    const matchedRule = "defaultSquadNamePatterns";
    const vehicleClassMatch = classifyVehicleClass(normalizedName, rules.vehicle.classes ?? {}, debug);
    return makeResult({
      nature: SQUAD_NATURE.INFANTRY,
      matchedRule,
      matchedValue: defaultHit.pattern,
      normalizedName,
      reason: `队名命中默认队名模式：${defaultHit.pattern}`,
      confidence: "high",
      debug,
      vehicleClass: vehicleClassMatch.vehicleClass,
      vehicleClassLabel: vehicleClassMatch.vehicleClassLabel,
      vehicleClassRule: vehicleClassMatch.vehicleClassRule,
      vehicleClassValue: vehicleClassMatch.vehicleClassValue,
      vehicleClassReason: vehicleClassMatch.vehicleClassReason,
      vehicleClassConfidence: vehicleClassMatch.vehicleClassConfidence,
      category: SQUAD_NATURE.INFANTRY,
    });
  }

  const infantryOverride = matchInfantryOverride(normalizedName);
  const vehicleClassMatch = classifyVehicleClass(normalizedName, rules.vehicle.classes ?? {}, debug);
  if (infantryOverride) {
    return makeResult({
      nature: SQUAD_NATURE.INFANTRY,
      matchedRule: "infantry.contains",
      matchedValue: "步兵",
      normalizedName,
      reason: "队名包含步兵，归类为步兵队。",
      confidence: "high",
      debug,
      vehicleClass: vehicleClassMatch.vehicleClass,
      vehicleClassLabel: vehicleClassMatch.vehicleClassLabel,
      vehicleClassRule: vehicleClassMatch.vehicleClassRule,
      vehicleClassValue: vehicleClassMatch.vehicleClassValue,
      vehicleClassReason: vehicleClassMatch.vehicleClassReason,
      vehicleClassConfidence: vehicleClassMatch.vehicleClassConfidence,
      category: SQUAD_NATURE.INFANTRY,
    });
  }

  const candidates = collectCandidates(normalizedName, rules, debug);
  const exactCandidates = candidates.filter((item) => (item.bestKind === "exact" || item.bestKind === "alias") && !item.blacklisted);
  const activeCandidates = candidates.filter((item) => !item.blacklisted && item.bestStrength > 0);

  let selected = null;
  let conflictResolvedBy = null;

  if (exactCandidates.length > 0) {
    selected = pickByPriority(exactCandidates, rules.priority);
  } else if (activeCandidates.length > 0) {
    selected = pickByPriority(activeCandidates, rules.priority);
  } else {
    const blacklistedCandidates = candidates.filter((item) => item.bestStrength > 0);
    if (blacklistedCandidates.length > 0) {
      debug.conflictResolvedBy = "blacklist";
      return makeResult({
        nature: SQUAD_NATURE.OTHER,
        matchedRule: null,
        matchedValue: null,
        normalizedName,
        reason: "队名仅命中黑名单规则，归类为其他。",
        confidence: "low",
        debug,
      });
    }
  }

  if (!selected) {
    return makeResult({
      nature: SQUAD_NATURE.OTHER,
      matchedRule: null,
      matchedValue: null,
      normalizedName,
      reason: "未命中任何规则，归类为其他。",
      confidence: "low",
      debug,
    });
  }

  const topCandidates = candidates.filter((item) => item.bestStrength > 0);
  if (topCandidates.length > 1) {
    conflictResolvedBy = conflictResolvedBy || "priority";
  }

  debug.conflictResolvedBy = conflictResolvedBy;

  const confidence = toConfidence(selected.bestKind, selected.blacklisted, conflictResolvedBy);
  const reason = buildReason(selected, topCandidates.length > 1, conflictResolvedBy);
  const matchedRule = selected.bestRule ? `${selected.nature}.${selected.bestKind}` : null;
  return makeResult({
    nature: selected.nature,
    matchedRule,
    matchedValue: selected.bestValue,
    normalizedName,
    reason,
    confidence,
    debug,
    vehicleClass: vehicleClassMatch.vehicleClass,
    vehicleClassLabel: vehicleClassMatch.vehicleClassLabel,
    vehicleClassRule: vehicleClassMatch.vehicleClassRule,
    vehicleClassValue: vehicleClassMatch.vehicleClassValue,
    vehicleClassReason: vehicleClassMatch.vehicleClassReason,
    vehicleClassConfidence: vehicleClassMatch.vehicleClassConfidence,
    category: selected.nature,
  });
}

function collectCandidates(normalizedName, rules, debug) {
  const result = [];
  for (const nature of [SQUAD_NATURE.SUPPORT, SQUAD_NATURE.VEHICLE, SQUAD_NATURE.INFANTRY]) {
    const bucket = rules[nature] ?? {};
    const exactHits = matchList(normalizedName, bucket.exactWhitelist, "exact");
    const aliasHits = matchAliasList(normalizedName, bucket.aliases?.exactWhitelist ?? []);
    const containsHits = matchList(normalizedName, bucket.contains, "contains");
    const regexHits = matchRegexList(normalizedName, bucket.regex, "regex");
    const blacklistHits = [
      ...matchList(normalizedName, bucket.blacklist, "blacklist"),
      ...matchRegexList(normalizedName, bucket.blacklistRegex ?? [], "blacklist"),
    ];

    debug.exactHits.push(...exactHits.map((hit) => ({ nature, value: hit.value })));
    debug.aliasHits.push(...aliasHits.map((hit) => ({ nature, value: hit.value })));
    debug.containsHits.push(...containsHits.map((hit) => ({ nature, value: hit.value })));
    debug.blacklistHits.push(...blacklistHits.map((hit) => ({ nature, value: hit.value })));

    const allHits = [...exactHits, ...aliasHits, ...containsHits, ...regexHits];
    const best = chooseBestHit(allHits);
    result.push({
      nature,
      bestKind: best?.kind ?? null,
      bestValue: best?.value ?? null,
      bestRule: best?.rule ?? null,
      bestStrength: best?.strength ?? 0,
      blacklisted: blacklistHits.length > 0,
    });
  }
  return result;
}

function matchInfantryOverride(normalizedName) {
  return normalizedName.includes("步兵");
}

function classifyVehicleClass(normalizedName, classRules = {}, debug) {
  const buckets = [];
  const debugHits = [];

  for (const vehicleClass of VEHICLE_CLASS_PRIORITY) {
    const bucket = classRules?.[vehicleClass] ?? {};
    const exactHits = matchList(normalizedName, bucket.exactWhitelist, "exact");
    const aliasHits = matchAliasList(normalizedName, bucket.aliases?.exactWhitelist ?? []);
    const containsHits = matchList(normalizedName, bucket.contains, "contains");
    const regexHits = matchRegexList(normalizedName, bucket.regex, "regex");
    const allHits = [...exactHits, ...aliasHits, ...containsHits, ...regexHits];
    const best = chooseBestHit(allHits);
    debugHits.push(
      ...exactHits.map((hit) => ({ vehicleClass, kind: "exact", value: hit.value })),
      ...aliasHits.map((hit) => ({ vehicleClass, kind: "alias", value: hit.value })),
      ...containsHits.map((hit) => ({ vehicleClass, kind: "contains", value: hit.value })),
      ...regexHits.map((hit) => ({ vehicleClass, kind: "regex", value: hit.value })),
    );
    if (best) {
      buckets.push({
        vehicleClass,
        label: String(bucket.label ?? SQUAD_VEHICLE_CLASS_LABEL[vehicleClass] ?? vehicleClass),
        bestKind: best.kind,
        bestValue: best.value,
        bestRule: best.rule,
        bestStrength: best.strength,
      });
    }
  }

  debug.vehicleClassHits.push(...debugHits);

  if (buckets.length === 0) {
    return buildEmptyVehicleClass();
  }

  const selected = pickVehicleClassByPriority(buckets, classRules.priority);
  if (!selected) {
    return buildEmptyVehicleClass();
  }

  const label = SQUAD_VEHICLE_CLASS_LABEL[selected.vehicleClass] ?? selected.label ?? SQUAD_VEHICLE_CLASS_LABEL.other;
  const hasConflict = buckets.length > 1;
  const confidence = toVehicleClassConfidence(selected.bestKind, hasConflict);
  const reason = buildVehicleClassReason(label, selected.bestKind, selected.bestValue, hasConflict);
  const rule = selected.bestRule ? `vehicleClasses.${selected.vehicleClass}.${selected.bestKind}` : null;

  return {
    vehicleClass: selected.vehicleClass,
    vehicleClassLabel: label,
    vehicleClassRule: rule,
    vehicleClassValue: selected.bestValue,
    vehicleClassReason: reason,
    vehicleClassConfidence: confidence,
  };
}

function pickVehicleClassByPriority(candidates, priority) {
  const order = Array.isArray(priority) && priority.length ? priority : [...VEHICLE_CLASS_PRIORITY];
  const priorityIndex = new Map(order.map((vehicleClass, index) => [vehicleClass, index]));
  return [...candidates].sort((left, right) => {
    const leftPriority = priorityIndex.has(left.vehicleClass) ? priorityIndex.get(left.vehicleClass) : 99;
    const rightPriority = priorityIndex.has(right.vehicleClass) ? priorityIndex.get(right.vehicleClass) : 99;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    if (right.bestStrength !== left.bestStrength) return right.bestStrength - left.bestStrength;
    return String(left.vehicleClass).localeCompare(String(right.vehicleClass));
  })[0] ?? null;
}

function toVehicleClassConfidence(bestKind, hasConflict) {
  if (hasConflict) return "medium";
  if (bestKind === "exact" || bestKind === "alias") return "high";
  if (bestKind === "contains") return "medium";
  if (bestKind === "regex") return "low";
  return "low";
}

function buildVehicleClassReason(label, bestKind, value, hasConflict) {
  if (hasConflict) {
    return `队名同时命中多个车辆子类，按优先级判定为${label}：${value}`;
  }
  if (bestKind === "exact") {
    return `队名命中${label}白名单：${value}`;
  }
  if (bestKind === "alias") {
    return `队名命中${label}别名：${value}`;
  }
  if (bestKind === "contains") {
    return `队名命中${label}关键词：${value}`;
  }
  if (bestKind === "regex") {
    return `队名命中${label}正则规则：${value}`;
  }
  return `队名归类为${label}：${value}`;
}

function buildEmptyVehicleClass() {
  return {
    vehicleClass: SQUAD_VEHICLE_CLASS.OTHER,
    vehicleClassLabel: SQUAD_VEHICLE_CLASS_LABEL.other,
    vehicleClassRule: null,
    vehicleClassValue: null,
    vehicleClassReason: null,
    vehicleClassConfidence: "low",
  };
}

function chooseBestHit(hits = []) {
  let best = null;
  for (const hit of hits) {
    if (!best) {
      best = hit;
      continue;
    }
    if (hit.strength > best.strength) {
      best = hit;
      continue;
    }
    if (hit.strength === best.strength) {
      const currentPriority = NATURE_PRIORITY.indexOf(hit.nature);
      const bestPriority = NATURE_PRIORITY.indexOf(best.nature);
      if (currentPriority !== -1 && bestPriority !== -1 && currentPriority < bestPriority) {
        best = hit;
      }
    }
  }
  return best;
}

function pickByPriority(candidates, priority) {
  const order = Array.isArray(priority) && priority.length ? priority : [...NATURE_PRIORITY];
  const priorityIndex = new Map(order.map((nature, index) => [nature, index]));
  return [...candidates].sort((left, right) => {
    const leftPriority = priorityIndex.has(left.nature) ? priorityIndex.get(left.nature) : 99;
    const rightPriority = priorityIndex.has(right.nature) ? priorityIndex.get(right.nature) : 99;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    if (right.bestStrength !== left.bestStrength) return right.bestStrength - left.bestStrength;
    return String(left.nature).localeCompare(String(right.nature));
  })[0] ?? null;
}

function matchDefaultPattern(normalizedName, patterns = []) {
  for (const pattern of patterns) {
    const regex = toRegex(pattern);
    if (regex && regex.test(normalizedName)) {
      return { pattern: String(pattern) };
    }
  }
  return null;
}

function matchList(normalizedName, values = [], kind = "contains") {
  const hits = [];
  for (const value of values) {
    const normalizedValue = normalizeSquadName(String(value ?? ""));
    if (!normalizedValue) continue;
    if (kind === "exact" && normalizedName === normalizedValue) {
      hits.push({ kind, value: String(value), rule: String(value), strength: RULE_STRENGTH.exact, nature: null });
      continue;
    }
    if (kind !== "exact" && normalizedName.includes(normalizedValue)) {
      hits.push({ kind, value: String(value), rule: String(value), strength: RULE_STRENGTH.contains, nature: null });
    }
  }
  return hits;
}

function matchAliasList(normalizedName, values = []) {
  const hits = [];
  for (const value of values) {
    const normalizedValue = normalizeSquadName(String(value ?? ""));
    if (!normalizedValue) continue;
    const regex = buildAliasRegex(normalizedValue);
    if (regex && regex.test(normalizedName)) {
      hits.push({
        kind: "alias",
        value: String(value),
        rule: String(value),
        strength: RULE_STRENGTH.alias,
        nature: null,
      });
    }
  }
  return hits;
}

function matchRegexList(normalizedName, values = [], kind = "regex") {
  const hits = [];
  for (const value of values) {
    const regex = toRegex(value);
    if (!regex) continue;
    if (regex.test(normalizedName)) {
      hits.push({ kind, value: String(value), rule: String(value), strength: RULE_STRENGTH.regex, nature: null });
    }
  }
  return hits;
}

function buildAliasRegex(value) {
  const token = escapeRegExp(value);
  return new RegExp(`(^|[^a-z0-9])${token}(?:\\s*\\d+)?(?=$|[^a-z0-9])`, "i");
}

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toRegex(value) {
  if (value instanceof RegExp) return value;
  const text = String(value ?? "").trim();
  if (!text) return null;
  try {
    return new RegExp(text, "i");
  } catch {
    return null;
  }
}

function toConfidence(bestKind, blacklisted, conflictResolvedBy) {
  if (conflictResolvedBy === "blacklist") return "low";
  if (bestKind === "exact" || bestKind === "alias") return blacklisted ? "medium" : "high";
  if (bestKind === "contains") return blacklisted ? "low" : "medium";
  if (bestKind === "regex") return "low";
  return "low";
}

function buildReason(selected, hasConflict, conflictResolvedBy) {
  const label = SQUAD_NATURE_LABEL[selected.nature] ?? SQUAD_NATURE_LABEL.other;
  const value = selected.bestValue ?? "";
  if (hasConflict) {
    return `队名同时命中多个性质，按优先级判定为${label}：${value}`;
  }
  if (selected.bestKind === "exact") {
    return `队名命中${label}白名单：${value}`;
  }
  if (selected.bestKind === "alias") {
    return `队名命中${label}黑话别名：${value}`;
  }
  if (selected.bestKind === "contains") {
    return `队名命中${label}关键词：${value}`;
  }
  if (selected.bestKind === "regex") {
    return `队名命中${label}正则规则：${value}`;
  }
  return `队名归类为${label}：${value}`;
}

function makeResult({
  nature,
  matchedRule,
  matchedValue,
  normalizedName,
  reason,
  confidence,
  debug,
  vehicleClass = SQUAD_VEHICLE_CLASS.OTHER,
  vehicleClassLabel = SQUAD_VEHICLE_CLASS_LABEL.other,
  vehicleClassRule = null,
  vehicleClassValue = null,
  vehicleClassReason = null,
  vehicleClassConfidence = "low",
  category = nature,
}) {
  const label = SQUAD_NATURE_LABEL[nature] ?? SQUAD_NATURE_LABEL.other;
  const payload = {
    nature,
    category,
    label,
    confidence,
    normalizedName,
    matchedRule,
    matchedValue,
    reason,
    debug,
    vehicleClass,
    vehicleClassLabel,
    vehicleClassRule,
    vehicleClassValue,
    vehicleClassReason,
    vehicleClassConfidence,
  };
  return payload;
}

function buildEmptyDebug(includeDebug) {
  if (!includeDebug) {
    return {
      defaultNameHit: false,
      exactHits: [],
      aliasHits: [],
      containsHits: [],
      blacklistHits: [],
      vehicleClassHits: [],
      conflictResolvedBy: null,
    };
  }

  return {
    defaultNameHit: false,
    exactHits: [],
    aliasHits: [],
    containsHits: [],
    blacklistHits: [],
    vehicleClassHits: [],
    conflictResolvedBy: null,
  };
}

function mergeRules(baseRules, overrideRules) {
  if (!overrideRules || typeof overrideRules !== "object" || Array.isArray(overrideRules)) {
    return cloneRules(baseRules);
  }

  const normalizedOverride = normalizeRulesInput(overrideRules);
  const normalizedBase = normalizeRulesInput(baseRules);

  return {
    version: Number(normalizedOverride.version ?? normalizedBase.version ?? 1),
    defaultSquadNamePatterns: dedupeStrings([
      ...normalizedBase.defaultSquadNamePatterns,
      ...normalizedOverride.defaultSquadNamePatterns,
    ]),
    priority: dedupeStrings([
      ...normalizedOverride.priority,
      ...normalizedBase.priority,
    ]),
    infantry: mergeCategoryRules(normalizedBase.infantry, normalizedOverride.infantry),
    vehicle: mergeCategoryRules(normalizedBase.vehicle, normalizedOverride.vehicle),
    support: mergeCategoryRules(normalizedBase.support, normalizedOverride.support),
    vehicleClasses: mergeVehicleClassRules(normalizedBase.vehicleClasses, normalizedOverride.vehicleClasses),
  };
}

function mergeCategoryRules(baseCategory, overrideCategory) {
  return {
    exactWhitelist: dedupeStrings([...(baseCategory?.exactWhitelist ?? []), ...(overrideCategory?.exactWhitelist ?? [])]),
    aliases: mergeAliasRules(baseCategory?.aliases, overrideCategory?.aliases),
    contains: dedupeStrings([...(baseCategory?.contains ?? []), ...(overrideCategory?.contains ?? [])]),
    blacklist: dedupeStrings([...(baseCategory?.blacklist ?? []), ...(overrideCategory?.blacklist ?? [])]),
    regex: dedupeStrings([...(baseCategory?.regex ?? []), ...(overrideCategory?.regex ?? [])]),
    blacklistRegex: dedupeStrings([...(baseCategory?.blacklistRegex ?? []), ...(overrideCategory?.blacklistRegex ?? [])]),
    classes: mergeVehicleClassRules(baseCategory?.classes, overrideCategory?.classes),
  };
}

function normalizeRulesInput(rules) {
  return {
    version: Number(rules?.version ?? 1),
    defaultSquadNamePatterns: asStringArray(rules?.defaultSquadNamePatterns),
    priority: asStringArray(rules?.priority),
    infantry: normalizeCategoryInput(rules?.infantry),
    vehicle: normalizeCategoryInput(rules?.vehicle),
    support: normalizeCategoryInput(rules?.support),
    vehicleClasses: normalizeVehicleClassInput(rules?.vehicleClasses),
  };
}

function normalizeCategoryInput(category) {
  const source = category && typeof category === "object" && !Array.isArray(category) ? category : {};
  return {
    exactWhitelist: asStringArray(source.exactWhitelist ?? source.exact),
    aliases: normalizeAliasInput(source.aliases ?? source.alias),
    contains: asStringArray(source.contains),
    blacklist: asStringArray(source.blacklist),
    regex: asStringArray(source.regex),
    blacklistRegex: asStringArray(source.blacklistRegex),
    classes: normalizeVehicleClassInput(source.classes ?? source.vehicleClasses),
  };
}

function cloneRules(rules) {
  return {
    version: Number(rules?.version ?? 1),
    defaultSquadNamePatterns: [...(rules?.defaultSquadNamePatterns ?? [])],
    priority: [...(rules?.priority ?? [])],
    infantry: cloneCategoryRules(rules?.infantry),
    vehicle: cloneCategoryRules(rules?.vehicle),
    support: cloneCategoryRules(rules?.support),
    vehicleClasses: cloneVehicleClassRules(rules?.vehicleClasses),
  };
}

function cloneCategoryRules(category) {
  return {
    exactWhitelist: [...(category?.exactWhitelist ?? [])],
    aliases: cloneAliasRules(category?.aliases),
    contains: [...(category?.contains ?? [])],
    blacklist: [...(category?.blacklist ?? [])],
    regex: [...(category?.regex ?? [])],
    blacklistRegex: [...(category?.blacklistRegex ?? [])],
    classes: cloneVehicleClassRules(category?.classes),
  };
}

function normalizeAliasInput(alias) {
  const source = alias && typeof alias === "object" && !Array.isArray(alias) ? alias : {};
  return {
    exactWhitelist: asStringArray(source.exactWhitelist ?? source.exact ?? source.values ?? source.list),
  };
}

function mergeAliasRules(baseAlias, overrideAlias) {
  return {
    exactWhitelist: dedupeStrings([...(baseAlias?.exactWhitelist ?? []), ...(overrideAlias?.exactWhitelist ?? [])]),
  };
}

function cloneAliasRules(alias) {
  return {
    exactWhitelist: [...(alias?.exactWhitelist ?? [])],
  };
}

function normalizeVehicleClassInput(vehicleClasses) {
  const source = vehicleClasses && typeof vehicleClasses === "object" && !Array.isArray(vehicleClasses) ? vehicleClasses : {};
  return {
    priority: asStringArray(source.priority),
    ifv: normalizeVehicleClassBucket(source.ifv),
    light_vehicle: normalizeVehicleClassBucket(source.light_vehicle ?? source.lightVehicle),
    tank: normalizeVehicleClassBucket(source.tank),
    spg: normalizeVehicleClassBucket(source.spg),
  };
}

function normalizeVehicleClassBucket(bucket) {
  const source = bucket && typeof bucket === "object" && !Array.isArray(bucket) ? bucket : {};
  return {
    label: String(source.label ?? "").trim(),
    exactWhitelist: asStringArray(source.exactWhitelist ?? source.exact),
    aliases: normalizeAliasInput(source.aliases ?? source.alias),
    contains: asStringArray(source.contains),
    regex: asStringArray(source.regex),
  };
}

function mergeVehicleClassRules(baseVehicleClasses, overrideVehicleClasses) {
  return {
    priority: dedupeStrings([...(overrideVehicleClasses?.priority ?? []), ...(baseVehicleClasses?.priority ?? [])]),
    ifv: mergeVehicleClassBucket(baseVehicleClasses?.ifv, overrideVehicleClasses?.ifv),
    light_vehicle: mergeVehicleClassBucket(baseVehicleClasses?.light_vehicle, overrideVehicleClasses?.light_vehicle),
    tank: mergeVehicleClassBucket(baseVehicleClasses?.tank, overrideVehicleClasses?.tank),
    spg: mergeVehicleClassBucket(baseVehicleClasses?.spg, overrideVehicleClasses?.spg),
  };
}

function mergeVehicleClassBucket(baseBucket, overrideBucket) {
  return {
    label: String(overrideBucket?.label ?? baseBucket?.label ?? "").trim(),
    exactWhitelist: dedupeStrings([...(baseBucket?.exactWhitelist ?? []), ...(overrideBucket?.exactWhitelist ?? [])]),
    aliases: mergeAliasRules(baseBucket?.aliases, overrideBucket?.aliases),
    contains: dedupeStrings([...(baseBucket?.contains ?? []), ...(overrideBucket?.contains ?? [])]),
    regex: dedupeStrings([...(baseBucket?.regex ?? []), ...(overrideBucket?.regex ?? [])]),
  };
}

function cloneVehicleClassRules(vehicleClasses) {
  return {
    priority: [...(vehicleClasses?.priority ?? [])],
    ifv: cloneVehicleClassBucket(vehicleClasses?.ifv),
    light_vehicle: cloneVehicleClassBucket(vehicleClasses?.light_vehicle),
    tank: cloneVehicleClassBucket(vehicleClasses?.tank),
    spg: cloneVehicleClassBucket(vehicleClasses?.spg),
  };
}

function cloneVehicleClassBucket(bucket) {
  return {
    label: String(bucket?.label ?? "").trim(),
    exactWhitelist: [...(bucket?.exactWhitelist ?? [])],
    aliases: cloneAliasRules(bucket?.aliases),
    contains: [...(bucket?.contains ?? [])],
    regex: [...(bucket?.regex ?? [])],
  };
}

function dedupeStrings(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

export default {
  classifySquadName,
  normalizeSquadName,
  SQUAD_NATURE,
  SQUAD_NATURE_LABEL,
  SQUAD_VEHICLE_CLASS,
  SQUAD_VEHICLE_CLASS_LABEL,
};
