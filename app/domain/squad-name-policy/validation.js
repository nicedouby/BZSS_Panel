// -*- coding: utf-8 -*-

import { ASSET_MODES, SQUAD_NATURES, buildTypeIndex } from "./schema.js";

export function validatePolicyDocument(policy = {}, options = {}) {
  const errors = [];
  const warnings = [];
  const types = Array.isArray(policy.types) ? policy.types : [];
  const entries = Array.isArray(policy.entries) ? policy.entries : [];
  const normalizeName = options.normalizeName ?? defaultNormalizeName;
  const typeIndex = buildTypeIndex(types);
  const seenTypeIds = new Map();
  const seenRuleIds = new Map();
  const occupiedNames = new Map();

  types.forEach((type, index) => {
    const location = { section: "types", index, typeId: type?.id ?? "" };
    if (!type?.id) pushError(errors, "type_id_required", "队伍类型必须拥有稳定的 ID。", location);
    if (seenTypeIds.has(type?.id)) {
      pushError(errors, "duplicate_type_id", `类型 ID ${type.id} 重复。`, location, { conflictIndex: seenTypeIds.get(type.id) });
    } else if (type?.id) {
      seenTypeIds.set(type.id, index);
    }
    if (!type?.label) pushError(errors, "type_label_required", "队伍类型必须填写显示名称。", location);
    if (!SQUAD_NATURES.includes(type?.nature)) {
      pushError(errors, "invalid_nature", `类型 ${type?.id || index} 使用了无效性质 ${type?.nature || "(空)"}。`, location);
    }
    if (!ASSET_MODES.includes(type?.assetMode)) {
      pushError(errors, "invalid_asset_mode", `类型 ${type?.id || index} 使用了无效资产模式。`, location);
    }
    if (type?.nature !== "vehicle" && type?.assetMode !== "none") {
      pushError(errors, "non_vehicle_asset_mode", `非载具类型 ${type?.label || type?.id} 的资产模式必须为 none。`, location);
    }
  });

  entries.forEach((entry, index) => {
    const location = { section: "entries", index, ruleId: entry?.id ?? "" };
    if (!entry?.id) pushError(errors, "rule_id_required", "队名规则必须拥有稳定的 ID。", location);
    if (seenRuleIds.has(entry?.id)) {
      pushError(errors, "duplicate_rule_id", `规则 ID ${entry.id} 重复。`, location, { conflictIndex: seenRuleIds.get(entry.id) });
    } else if (entry?.id) {
      seenRuleIds.set(entry.id, index);
    }
    if (!entry?.name) pushError(errors, "rule_name_required", "队名规则必须填写允许队名。", location);
    const squadType = typeIndex.get(entry?.typeId);
    if (!squadType) {
      pushError(errors, "unknown_type", `规则 ${entry?.name || entry?.id || index} 引用了不存在的类型 ${entry?.typeId || "(空)"}。`, location);
    } else {
      if (squadType.nature !== "vehicle" && entry?.asset) {
        pushError(errors, "non_vehicle_asset", `非载具规则 ${entry.name} 不能设置资产路径。`, location);
      }
      if (squadType.assetMode === "required" && !entry?.asset) {
        pushError(errors, "asset_required", `规则 ${entry.name} 所属类型要求填写资产路径。`, location);
      }
      if (!squadType.enabled && entry?.enabled) {
        pushError(errors, "disabled_type_in_use", `启用的规则 ${entry.name} 不能引用已停用类型 ${squadType.label}。`, location);
      }
    }

    if (entry?.enabled !== false) {
      registerOccupiedName(occupiedNames, errors, entry?.name, "canonical", entry, index, normalizeName);
      for (const alias of Array.isArray(entry?.aliases) ? entry.aliases : []) {
        registerOccupiedName(occupiedNames, errors, alias, "alias", entry, index, normalizeName);
      }
    }
  });

  const referencedTypeIds = new Set(entries.map((entry) => entry?.typeId).filter(Boolean));
  for (const type of types) {
    if (String(type?.id ?? "").startsWith("legacy_") && referencedTypeIds.has(type.id)) {
      warnings.push({
        code: "legacy_type_pending",
        message: `类型 ${type.label || type.id} 仍为待确认的旧类型。`,
        section: "types",
        typeId: type.id,
      });
    }
  }

  return {
    ok: true,
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      errorCount: errors.length,
      warningCount: warnings.length,
      typeCount: types.length,
      ruleCount: entries.length,
    },
  };
}

function registerOccupiedName(index, errors, value, kind, entry, entryIndex, normalizeName) {
  const key = normalizeName(value);
  if (!key) return;
  const current = { value, kind, ruleId: entry?.id ?? "", ruleName: entry?.name ?? "", entryIndex };
  const previous = index.get(key);
  if (previous && previous.ruleId !== current.ruleId) {
    pushError(
      errors,
      "duplicate_name",
      `“${value}”标准化后同时属于规则 ${previous.ruleName || previous.ruleId} 与 ${current.ruleName || current.ruleId}。`,
      { section: "entries", index: entryIndex, ruleId: current.ruleId, field: kind === "canonical" ? "name" : "aliases" },
      { normalizedValue: key, conflictRuleId: previous.ruleId, conflictIndex: previous.entryIndex },
    );
    return;
  }
  if (!previous) index.set(key, current);
}

function pushError(errors, code, message, location = {}, extra = {}) {
  errors.push({ code, message, ...location, ...extra });
}

function defaultNormalizeName(value) {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/[\s\-_]+/g, "");
}
