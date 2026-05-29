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

const NATURE_PRIORITY = Object.freeze([
  SQUAD_NATURE.SUPPORT,
  SQUAD_NATURE.VEHICLE,
  SQUAD_NATURE.INFANTRY,
  SQUAD_NATURE.OTHER,
]);

const RULE_STRENGTH = Object.freeze({
  exact: 3,
  contains: 2,
  regex: 1,
});

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
    return makeResult({
      nature: SQUAD_NATURE.INFANTRY,
      matchedRule,
      matchedValue: defaultHit.pattern,
      normalizedName,
      reason: `队名命中默认队名模式：${defaultHit.pattern}`,
      confidence: "high",
      debug,
      category: SQUAD_NATURE.INFANTRY,
    });
  }

  const candidates = collectCandidates(normalizedName, rules, debug);
  const exactCandidates = candidates.filter((item) => item.bestKind === "exact" && !item.blacklisted);
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
    category: selected.nature,
  });
}

function collectCandidates(normalizedName, rules, debug) {
  const result = [];
  for (const nature of [SQUAD_NATURE.SUPPORT, SQUAD_NATURE.VEHICLE, SQUAD_NATURE.INFANTRY]) {
    const bucket = rules[nature] ?? {};
    const exactHits = matchList(normalizedName, bucket.exactWhitelist, "exact");
    const containsHits = matchList(normalizedName, bucket.contains, "contains");
    const regexHits = matchRegexList(normalizedName, bucket.regex, "regex");
    const blacklistHits = [
      ...matchList(normalizedName, bucket.blacklist, "blacklist"),
      ...matchRegexList(normalizedName, bucket.blacklistRegex ?? [], "blacklist"),
    ];

    debug.exactHits.push(...exactHits.map((hit) => ({ nature, value: hit.value })));
    debug.containsHits.push(...containsHits.map((hit) => ({ nature, value: hit.value })));
    debug.blacklistHits.push(...blacklistHits.map((hit) => ({ nature, value: hit.value })));

    const allHits = [...exactHits, ...containsHits, ...regexHits];
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
  if (bestKind === "exact") return blacklisted ? "medium" : "high";
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
  if (selected.bestKind === "contains") {
    return `队名命中${label}关键词：${value}`;
  }
  if (selected.bestKind === "regex") {
    return `队名命中${label}正则规则：${value}`;
  }
  return `队名归类为${label}：${value}`;
}

function makeResult({ nature, matchedRule, matchedValue, normalizedName, reason, confidence, debug, category = nature }) {
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
  };
  return payload;
}

function buildEmptyDebug(includeDebug) {
  if (!includeDebug) {
    return {
      defaultNameHit: false,
      exactHits: [],
      containsHits: [],
      blacklistHits: [],
      conflictResolvedBy: null,
    };
  }

  return {
    defaultNameHit: false,
    exactHits: [],
    containsHits: [],
    blacklistHits: [],
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
  };
}

function mergeCategoryRules(baseCategory, overrideCategory) {
  return {
    exactWhitelist: dedupeStrings([...(baseCategory?.exactWhitelist ?? []), ...(overrideCategory?.exactWhitelist ?? [])]),
    contains: dedupeStrings([...(baseCategory?.contains ?? []), ...(overrideCategory?.contains ?? [])]),
    blacklist: dedupeStrings([...(baseCategory?.blacklist ?? []), ...(overrideCategory?.blacklist ?? [])]),
    regex: dedupeStrings([...(baseCategory?.regex ?? []), ...(overrideCategory?.regex ?? [])]),
    blacklistRegex: dedupeStrings([...(baseCategory?.blacklistRegex ?? []), ...(overrideCategory?.blacklistRegex ?? [])]),
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
  };
}

function normalizeCategoryInput(category) {
  const source = category && typeof category === "object" && !Array.isArray(category) ? category : {};
  return {
    exactWhitelist: asStringArray(source.exactWhitelist ?? source.exact),
    contains: asStringArray(source.contains),
    blacklist: asStringArray(source.blacklist),
    regex: asStringArray(source.regex),
    blacklistRegex: asStringArray(source.blacklistRegex),
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
  };
}

function cloneCategoryRules(category) {
  return {
    exactWhitelist: [...(category?.exactWhitelist ?? [])],
    contains: [...(category?.contains ?? [])],
    blacklist: [...(category?.blacklist ?? [])],
    regex: [...(category?.regex ?? [])],
    blacklistRegex: [...(category?.blacklistRegex ?? [])],
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
};
