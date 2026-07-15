// -*- coding: utf-8 -*-

import {
  DEFAULT_SQUAD_TYPES,
  POLICY_VERSION,
  normalizePolicyEntryV2,
  normalizeSquadType,
  normalizeTypeId,
} from "./schema.js";

const LEGACY_VEHICLE_TYPE_MAP = Object.freeze({
  IFV: "ifv",
  MBT: "tank",
  TANK: "tank",
  MGS: "tank",
  APC: "apc",
  M1151: "matv",
  MATV: "matv",
  TAPV: "matv",
  HMMWV: "matv",
  MRAP: "matv",
  LTV: "matv",
  TD: "atgm_matv",
  SPA: "artillery_vehicle",
  RSV: "artillery_vehicle",
  SPAA: "artillery_vehicle",
  UH: "helicopter",
  AH: "attack_helicopter",
});

const SPECIAL_NAME_TYPE_MAP = new Map([
  ["迫击炮小队", "mortar"],
  ["迫击炮队", "mortar"],
  ["迫击炮", "mortar"],
  ["后勤队", "logistics"],
  ["后勤", "logistics"],
  ["货拉拉", "logistics"],
  ["指挥小队", "infantry"],
]);

export function migratePolicyV1ToV2(rawPolicy = {}, options = {}) {
  const source = isRecord(rawPolicy) ? rawPolicy : {};
  if (Number(source.version) >= POLICY_VERSION && Array.isArray(source.types)) {
    return { ...source, version: POLICY_VERSION };
  }

  const normalizeName = options.normalizeName;
  const types = DEFAULT_SQUAD_TYPES.map((item, index) => normalizeSquadType(item, index * 10));
  const typeIds = new Set(types.map((item) => item.id));
  const entries = [];
  const occupiedNames = new Set();

  for (const rawEntry of Array.isArray(source.entries) ? source.entries : []) {
    const legacyVehicleType = String(rawEntry?.vehicleType ?? rawEntry?.type ?? "").trim();
    const typeId = resolveLegacyVehicleType(legacyVehicleType, rawEntry?.name ?? rawEntry?.vehicleName);
    ensureLegacyType(types, typeIds, typeId, legacyVehicleType);
    addEntry(entries, occupiedNames, normalizePolicyEntryV2({
      ...rawEntry,
      typeId,
      legacyVehicleType,
      maxPlayersOverride: rawEntry?.maxPlayersOverride ?? (isTapvName(rawEntry?.name ?? rawEntry?.vehicleName) ? 4 : null),
      allowSquadSuffix: rawEntry?.allowSquadSuffix ?? false,
      enabled: rawEntry?.enabled ?? true,
      priority: rawEntry?.priority ?? 100,
      source: rawEntry?.source ?? (source.source?.type === "xlsx" ? "xlsx_import" : "migration"),
    }, { normalizeName, defaultTypeId: typeId, defaultSource: "migration" }), normalizeName, { allowCanonicalConflict: true });
  }

  for (const name of Array.isArray(source.infantryNames) ? source.infantryNames : []) {
    addEntry(entries, occupiedNames, normalizePolicyEntryV2({
      id: buildMigratedRuleId(name, normalizeName),
      name,
      typeId: "infantry",
      allowSquadSuffix: false,
      source: "migration",
    }, { normalizeName, defaultTypeId: "infantry", defaultSource: "migration" }), normalizeName);
  }

  for (const name of Array.isArray(source.specialInfantryNames) ? source.specialInfantryNames : []) {
    const typeId = SPECIAL_NAME_TYPE_MAP.get(String(name ?? "").trim()) || "infantry";
    addEntry(entries, occupiedNames, normalizePolicyEntryV2({
      id: buildMigratedRuleId(name, normalizeName),
      name,
      typeId,
      allowSquadSuffix: false,
      source: "migration",
    }, { normalizeName, defaultTypeId: typeId, defaultSource: "migration" }), normalizeName);
  }
  addEntry(entries, occupiedNames, normalizePolicyEntryV2({
    id: "rule:zsj",
    name: "zsj",
    typeId: "infantry",
    allowSquadSuffix: false,
    source: "migration",
  }, { normalizeName, defaultTypeId: "infantry", defaultSource: "migration" }), normalizeName);

  addRecommendedRules(entries, occupiedNames, normalizeName);
  const migrationWarnings = [];
  const resolvedEntries = resolveLegacyConflicts(entries, normalizeName, migrationWarnings);

  return {
    ...source,
    version: POLICY_VERSION,
    revision: normalizeRevision(source.revision),
    types: types.filter(Boolean),
    migrationWarnings,
    entries: resolvedEntries,
  };
}

export function resolveLegacyVehicleType(vehicleType, vehicleName = "") {
  const normalizedName = String(vehicleName ?? "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]+/g, "");
  if (/^(?:TAPV|HMMWV|M1151)/.test(normalizedName)) return "matv";
  const legacy = String(vehicleType ?? "").trim().toUpperCase();
  if (LEGACY_VEHICLE_TYPE_MAP[legacy]) return LEGACY_VEHICLE_TYPE_MAP[legacy];
  return `legacy_${normalizeTypeId(legacy, "vehicle")}`;
}

function resolveLegacyConflicts(entries, normalizeName, warnings) {
  const canonical = new Map();
  const collapsed = [];
  for (const entry of entries) {
    const key = normalized(entry.name, normalizeName);
    const previous = canonical.get(key);
    if (!previous) {
      canonical.set(key, entry);
      collapsed.push(entry);
      continue;
    }
    if (previous.typeId === entry.typeId) {
      previous.aliases = mergeStrings(previous.aliases, entry.aliases, normalizeName);
      previous.keywords = mergeStrings(previous.keywords, entry.keywords, normalizeName);
      previous.searchTokens = mergeStrings(previous.searchTokens, entry.searchTokens, normalizeName);
      const mergeNote = "由旧配置中的同名跨阵营规则合并；保留首条规则的阵营与资产路径。";
      if (!previous.notes.includes(mergeNote)) previous.notes = [previous.notes, mergeNote].filter(Boolean).join(" ");
      warnings.push({ code: "merged_duplicate_rule", name: entry.name, keptRuleId: previous.id, removedRuleId: entry.id });
      continue;
    }
    entry.enabled = false;
    entry.notes = [entry.notes, `迁移时与 ${previous.id} 发生队名冲突，已停用等待确认。`].filter(Boolean).join(" ");
    collapsed.push(entry);
    warnings.push({ code: "disabled_ambiguous_rule", name: entry.name, keptRuleId: previous.id, disabledRuleId: entry.id });
  }

  const occupied = new Map();
  for (const entry of collapsed.filter((item) => item.enabled)) {
    occupied.set(normalized(entry.name, normalizeName), entry.id);
  }
  for (const entry of collapsed.filter((item) => item.enabled)) {
    entry.aliases = entry.aliases.filter((alias) => {
      const key = normalized(alias, normalizeName);
      const owner = occupied.get(key);
      if (owner && owner !== entry.id) {
        warnings.push({ code: "removed_conflicting_alias", alias, ownerRuleId: owner, removedFromRuleId: entry.id });
        return false;
      }
      occupied.set(key, entry.id);
      return true;
    });
  }
  return collapsed;
}

function mergeStrings(left = [], right = [], normalizeName) {
  const seen = new Set();
  return [...left, ...right].filter((value) => {
    const key = normalized(value, normalizeName);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isTapvName(value) {
  return String(value ?? "").normalize("NFKC").trim().toUpperCase() === "TAPV";
}

function ensureLegacyType(types, typeIds, typeId, legacyLabel) {
  if (typeIds.has(typeId)) return;
  types.push(normalizeSquadType({
    id: typeId,
    label: `${legacyLabel || typeId}（待确认）`,
    nature: "vehicle",
    defaultMaxPlayers: null,
    assetMode: "optional",
    enabled: true,
    sortOrder: 1000 + types.length * 10,
    description: `由旧载具类型 ${legacyLabel || typeId} 自动迁移，请在类型管理器中确认。`,
  }));
  typeIds.add(typeId);
}

function addRecommendedRules(entries, occupiedNames, normalizeName) {
  const rules = [
    { id: "rule:bmp", name: "BMP", aliases: ["步战", "步战车"], keywords: ["BMP"], typeId: "ifv", allowSquadSuffix: true },
    { id: "rule:hmmwv", name: "悍马", aliases: ["悍马车", "HMMWV", "M1151"], keywords: ["HMMWV", "M1151"], typeId: "matv", allowSquadSuffix: true },
    { id: "rule:tapv", name: "TAPV", aliases: [], keywords: ["TAPV"], typeId: "matv", allowSquadSuffix: true },
    { id: "rule:mortar", name: "迫击炮队", aliases: ["迫击炮", "Mortar", "Mortar Team"], keywords: ["MORTAR"], typeId: "mortar", allowSquadSuffix: false },
    { id: "rule:infantry", name: "步兵队", aliases: ["步兵", "INF", "Infantry"], keywords: ["INF"], typeId: "infantry", allowSquadSuffix: false },
  ];
  for (const rule of rules) {
    addEntry(entries, occupiedNames, normalizePolicyEntryV2({
      ...rule,
      source: "migration",
      enabled: true,
      priority: 110,
    }, { normalizeName, defaultTypeId: rule.typeId, defaultSource: "migration" }), normalizeName);
  }
}

function addEntry(entries, occupiedNames, entry, normalizeName, options = {}) {
  if (!entry) return;
  const key = normalized(entry.name, normalizeName);
  if (!key) return;
  if (occupiedNames.has(key) && !options.allowCanonicalConflict) return;
  occupiedNames.add(key);
  entries.push(entry);
}

function buildMigratedRuleId(name, normalizeName) {
  return `rule:${normalized(name, normalizeName) || Math.random().toString(36).slice(2)}`;
}

function normalized(value, normalizeName) {
  return typeof normalizeName === "function"
    ? normalizeName(value)
    : normalizeTypeId(value, "");
}

function normalizeRevision(value) {
  const revision = Number(value);
  return Number.isInteger(revision) && revision > 0 ? revision : 1;
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
