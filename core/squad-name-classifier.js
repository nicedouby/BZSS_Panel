// -*- coding: utf-8 -*-

const CATEGORY_LABELS = {
  infantry: "步兵队",
  vehicle: "载具队",
  support: "支援队",
  other: "其他",
};

const DEFAULT_RULES = {
  blacklist: [
    "测试",
    "临时",
    "备用",
    "预备",
    "待定",
    "demo",
    "演示",
  ],
  infantry: {
    exact: [
      "步兵队",
      "步兵",
      "空突",
    ],
    contains: [
      "步兵",
      "空突",
      "空降",
      "轻步",
    ],
  },
  vehicle: {
    exact: [
      "载具队",
      "装甲队",
      "机步队",
      "坦克队",
    ],
    contains: [
      "载具",
      "装甲",
      "坦克",
      "机步",
      "摩步",
      "战车",
      "直升机",
      "炮车",
    ],
  },
  support: {
    exact: [
      "支援队",
      "后勤队",
      "维修队",
      "医疗队",
      "工兵队",
    ],
    contains: [
      "支援",
      "后勤",
      "维修",
      "医疗",
      "工兵",
      "补给",
      "炮兵",
    ],
  },
  defaultInfantryPatterns: [
    /^Squad\s*\d+$/i,
    /^小队\s*\d+$/,
  ],
};

export function classifySquadName(rawName, options = {}) {
  const rules = mergeRules(DEFAULT_RULES, options.rules ?? {});
  const input = normalizeSquadName(rawName);
  const normalized = input.normalized;

  if (!normalized) {
    return buildResult({
      rawName: input.raw,
      normalizedName: normalized,
      category: "other",
      matchedRule: "empty",
      matchedValue: "",
      reason: "队名为空，无法判定。",
    });
  }

  const blacklistHit = findContainsMatch(normalized, rules.blacklist);
  if (blacklistHit) {
    return buildResult({
      rawName: input.raw,
      normalizedName: normalized,
      category: "other",
      matchedRule: "blacklist",
      matchedValue: blacklistHit,
      reason: `命中黑名单：${blacklistHit}`,
    });
  }

  const exactOrder = [
    ["vehicle", rules.vehicle.exact],
    ["support", rules.support.exact],
    ["infantry", rules.infantry.exact],
  ];

  for (const [category, values] of exactOrder) {
    const matchedValue = findExactMatch(normalized, values);
    if (matchedValue) {
      return buildResult({
        rawName: input.raw,
        normalizedName: normalized,
        category,
        matchedRule: `${category}.exact`,
        matchedValue,
        reason: `命中${CATEGORY_LABELS[category]}白名单：${matchedValue}`,
      });
    }
  }

  const defaultInfantryPattern = rules.defaultInfantryPatterns.find((pattern) => pattern.test(normalized));
  if (defaultInfantryPattern) {
    return buildResult({
      rawName: input.raw,
      normalizedName: normalized,
      category: "infantry",
      matchedRule: "infantry.default",
      matchedValue: defaultInfantryPattern.toString(),
      reason: "命中默认队名规则，归类为步兵队。",
    });
  }

  const partialOrder = [
    ["vehicle", rules.vehicle.contains],
    ["support", rules.support.contains],
    ["infantry", rules.infantry.contains],
  ];

  for (const [category, values] of partialOrder) {
    const matchedValue = findContainsMatch(normalized, values);
    if (matchedValue) {
      return buildResult({
        rawName: input.raw,
        normalizedName: normalized,
        category,
        matchedRule: `${category}.contains`,
        matchedValue,
        reason: `命中${CATEGORY_LABELS[category]}关键词：${matchedValue}`,
      });
    }
  }

  return buildResult({
    rawName: input.raw,
    normalizedName: normalized,
    category: "other",
    matchedRule: "none",
    matchedValue: "",
    reason: "未命中任何规则，归类为其他。",
  });
}

export function getSquadNameClassifierRules() {
  return cloneRules(DEFAULT_RULES);
}

function normalizeSquadName(value) {
  const raw = String(value ?? "");
  const normalized = raw
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

  return { raw, normalized };
}

function mergeRules(baseRules, overrideRules) {
  return {
    blacklist: mergeList(baseRules.blacklist, overrideRules.blacklist),
    infantry: {
      exact: mergeList(baseRules.infantry.exact, overrideRules.infantry?.exact),
      contains: mergeList(baseRules.infantry.contains, overrideRules.infantry?.contains),
    },
    vehicle: {
      exact: mergeList(baseRules.vehicle.exact, overrideRules.vehicle?.exact),
      contains: mergeList(baseRules.vehicle.contains, overrideRules.vehicle?.contains),
    },
    support: {
      exact: mergeList(baseRules.support.exact, overrideRules.support?.exact),
      contains: mergeList(baseRules.support.contains, overrideRules.support?.contains),
    },
    defaultInfantryPatterns: mergeList(baseRules.defaultInfantryPatterns, overrideRules.defaultInfantryPatterns),
  };
}

function cloneRules(rules) {
  return {
    blacklist: [...rules.blacklist],
    infantry: {
      exact: [...rules.infantry.exact],
      contains: [...rules.infantry.contains],
    },
    vehicle: {
      exact: [...rules.vehicle.exact],
      contains: [...rules.vehicle.contains],
    },
    support: {
      exact: [...rules.support.exact],
      contains: [...rules.support.contains],
    },
    defaultInfantryPatterns: [...rules.defaultInfantryPatterns],
  };
}

function mergeList(baseList = [], overrideList = []) {
  const result = [];
  const seen = new Set();
  for (const item of [...baseList, ...overrideList]) {
    if (item == null) continue;
    const key = item instanceof RegExp ? item.toString() : String(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function findExactMatch(value, list = []) {
  const matched = list.find((item) => matchesRule(value, item));
  return matched ? formatRuleValue(matched) : "";
}

function findContainsMatch(value, list = []) {
  const matched = list.find((item) => matchesContains(value, item));
  return matched ? formatRuleValue(matched) : "";
}

function matchesRule(value, rule) {
  if (rule instanceof RegExp) {
    return rule.test(value);
  }
  return value === String(rule ?? "").normalize("NFKC").replace(/\u3000/g, " ").trim().replace(/\s+/g, " ").toLowerCase();
}

function matchesContains(value, rule) {
  if (rule instanceof RegExp) {
    return rule.test(value);
  }
  return value.includes(String(rule ?? "").normalize("NFKC").replace(/\u3000/g, " ").trim().replace(/\s+/g, " ").toLowerCase());
}

function formatRuleValue(rule) {
  return rule instanceof RegExp ? rule.toString() : String(rule);
}

function buildResult({ rawName, normalizedName, category, matchedRule, matchedValue, reason }) {
  return {
    rawName,
    normalizedName,
    category,
    label: CATEGORY_LABELS[category] ?? CATEGORY_LABELS.other,
    matchedRule,
    matchedValue,
    reason,
  };
}
