// -*- coding: utf-8 -*-

export const POLICY_VERSION = 2;

export const SQUAD_NATURES = Object.freeze([
  "infantry",
  "vehicle",
  "support",
  "logistics",
  "other",
]);

export const ASSET_MODES = Object.freeze(["none", "optional", "required"]);

export const DEFAULT_SQUAD_TYPES = Object.freeze([
  { id: "matv", label: "MATV / 吉普车", nature: "vehicle", defaultMaxPlayers: null, assetMode: "optional", enabled: true, sortOrder: 10, description: "轻型防护车、吉普车及武装轻型车辆小队" },
  { id: "ifv", label: "IFV / 步战车", nature: "vehicle", defaultMaxPlayers: null, assetMode: "optional", enabled: true, sortOrder: 20, description: "步兵战车小队" },
  { id: "apc", label: "APC / 装甲运兵车", nature: "vehicle", defaultMaxPlayers: null, assetMode: "optional", enabled: true, sortOrder: 30, description: "装甲运兵车小队" },
  { id: "tank", label: "Tank / 坦克", nature: "vehicle", defaultMaxPlayers: null, assetMode: "optional", enabled: true, sortOrder: 40, description: "主战坦克及机动火炮系统小队" },
  { id: "atgm_matv", label: "ATGM MATV", nature: "vehicle", defaultMaxPlayers: null, assetMode: "optional", enabled: true, sortOrder: 50, description: "搭载反坦克导弹或无后坐力炮的轻型车辆小队" },
  { id: "artillery_vehicle", label: "Artillery Vehicle / 炮兵载具", nature: "vehicle", defaultMaxPlayers: null, assetMode: "optional", enabled: true, sortOrder: 60, description: "自行火炮、火箭炮、迫击炮车及防空炮车小队" },
  { id: "helicopter", label: "Helicopter / 直升机", nature: "vehicle", defaultMaxPlayers: null, assetMode: "optional", enabled: true, sortOrder: 70, description: "运输及通用直升机小队" },
  { id: "attack_helicopter", label: "Attacker Helicopter / 攻击直升机", nature: "vehicle", defaultMaxPlayers: null, assetMode: "optional", enabled: true, sortOrder: 80, description: "攻击及近距空中支援直升机小队" },
  { id: "infantry", label: "战斗步兵", nature: "infantry", defaultMaxPlayers: null, assetMode: "none", enabled: true, sortOrder: 90, description: "承担正面战斗任务的步兵小队" },
  { id: "logistics", label: "后勤小队", nature: "logistics", defaultMaxPlayers: null, assetMode: "none", enabled: true, sortOrder: 100, description: "后勤运输与建设小队" },
  { id: "mortar", label: "迫击炮小队", nature: "support", defaultMaxPlayers: null, assetMode: "none", enabled: true, sortOrder: 110, description: "迫击炮及间接火力步兵小队" },
]);

export function normalizeTypeId(value, fallback = "other") {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return normalized || fallback;
}

export function normalizeSquadType(rawType = {}, fallbackSortOrder = 0) {
  const source = isRecord(rawType) ? rawType : {};
  const id = normalizeTypeId(source.id, "");
  if (!id) return null;
  const nature = SQUAD_NATURES.includes(String(source.nature ?? "").trim())
    ? String(source.nature).trim()
    : "other";
  let assetMode = ASSET_MODES.includes(String(source.assetMode ?? "").trim())
    ? String(source.assetMode).trim()
    : (nature === "vehicle" ? "optional" : "none");
  if (nature !== "vehicle") assetMode = "none";
  return {
    id,
    label: optionalString(source.label) || id,
    nature,
    description: optionalString(source.description),
    defaultMaxPlayers: normalizePlayerLimit(source.defaultMaxPlayers),
    assetMode,
    enabled: source.enabled !== false,
    sortOrder: normalizeInteger(source.sortOrder, fallbackSortOrder),
  };
}

export function normalizePolicyEntryV2(rawEntry = {}, options = {}) {
  const source = isRecord(rawEntry) ? rawEntry : {};
  const name = optionalString(source.name ?? source.vehicleName);
  if (!name) return null;
  const typeId = normalizeTypeId(source.typeId ?? options.defaultTypeId, "other");
  const aliases = dedupeStrings(asStringArray(source.aliases), options.normalizeName);
  const keywords = dedupeStrings(asStringArray(source.keywords), options.normalizeName);
  const asset = optionalString(source.asset ?? source.vehicleAsset);
  const faction = optionalString(source.faction ?? source.factionName);
  const id = optionalString(source.id) || buildRuleId(name, options.normalizeName);
  return {
    id,
    name,
    aliases,
    keywords,
    typeId,
    faction,
    asset,
    maxPlayersOverride: normalizePlayerLimit(source.maxPlayersOverride),
    allowSquadSuffix: source.allowSquadSuffix !== false,
    enabled: source.enabled !== false,
    priority: normalizeInteger(source.priority, 100),
    source: optionalString(source.source) || options.defaultSource || "manual",
    notes: optionalString(source.notes),
    ruleExemptions: isRecord(source.ruleExemptions) ? { ...source.ruleExemptions } : {},
    legacyVehicleType: optionalString(source.legacyVehicleType ?? source.vehicleType),
    searchTokens: dedupeStrings([
      ...asStringArray(source.searchTokens),
      ...extractSearchTokens(name),
      ...aliases.flatMap(extractSearchTokens),
      ...extractSearchTokens(asset),
    ]),
  };
}

export function buildTypeIndex(types = []) {
  const index = new Map();
  for (const [position, rawType] of (Array.isArray(types) ? types : []).entries()) {
    const type = normalizeSquadType(rawType, position * 10);
    if (type && !index.has(type.id)) index.set(type.id, type);
  }
  return index;
}

export function resolveEffectiveMaxPlayers(entry, squadType) {
  if (entry?.maxPlayersOverride != null) {
    return { effectiveMaxPlayers: entry.maxPlayersOverride, maxPlayersSource: "rule_override" };
  }
  if (squadType?.defaultMaxPlayers != null) {
    return { effectiveMaxPlayers: squadType.defaultMaxPlayers, maxPlayersSource: "type_default" };
  }
  return { effectiveMaxPlayers: null, maxPlayersSource: "none" };
}

export function buildRuleClassification(entry, squadType, reason = "") {
  const maxPlayers = resolveEffectiveMaxPlayers(entry, squadType);
  return {
    nature: squadType?.nature || "other",
    typeId: squadType?.id || entry?.typeId || "other",
    typeLabel: squadType?.label || entry?.typeId || "其他",
    label: squadType?.label || entry?.typeId || "其他",
    ruleId: entry?.id || "",
    ...maxPlayers,
    assetPath: entry?.asset || "",
    ruleExemptions: entry?.ruleExemptions ?? squadType?.ruleExemptions ?? {},
    reason,
  };
}

export function normalizePlayerLimit(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const integer = Math.trunc(number);
  return integer > 0 ? integer : null;
}

export function optionalString(value) {
  return String(value ?? "").trim();
}

export function asStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => optionalString(item)).filter(Boolean)
    : [];
}

export function dedupeStrings(values = [], normalizeName = null) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = optionalString(value);
    if (!text) continue;
    const key = typeof normalizeName === "function" ? normalizeName(text) : text.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function normalizeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function buildRuleId(name, normalizeName = null) {
  const normalized = typeof normalizeName === "function"
    ? normalizeName(name)
    : normalizeTypeId(name, "rule");
  return `rule:${normalized || Math.random().toString(36).slice(2)}`;
}

function extractSearchTokens(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .split(/[^A-Za-z0-9]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
