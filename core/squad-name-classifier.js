// -*- coding: utf-8 -*-

import fs from "node:fs";
import path from "node:path";

import {
  classifySquadName as classifySquadNameDomain,
  normalizeSquadName,
  SQUAD_NATURE,
  SQUAD_NATURE_LABEL,
  SQUAD_VEHICLE_CLASS,
  SQUAD_VEHICLE_CLASS_LABEL,
} from "../domain/squad/squad_name_classifier.js";
import { squadNameRules } from "../domain/squad/squad_name_rules.js";

const DEFAULT_EXTERNAL_RULES_PATH = path.resolve(process.cwd(), "./config/squad_name_nature_rules.json");
const DEFAULT_CONFIG_PATH = "squadNameClassifier.rulesPath";

export function classifySquadName(rawName, options = {}) {
  const rulesOverride = options.rulesOverride ?? options.rules ?? null;
  return classifySquadNameDomain(rawName, {
    ...options,
    rulesOverride,
  });
}

export function getSquadNameClassifierRules(configManager = null) {
  const rulesPath = resolveRulesPath(configManager);
  if (!rulesPath) {
    return cloneRules(squadNameRules);
  }

  const overrideRules = loadExternalRules(rulesPath);
  return cloneRules(mergeRules(squadNameRules, overrideRules));
}

export default {
  classifySquadName,
  normalizeSquadName,
  SQUAD_NATURE,
  SQUAD_NATURE_LABEL,
  SQUAD_VEHICLE_CLASS,
  SQUAD_VEHICLE_CLASS_LABEL,
};

function resolveRulesPath(configManager) {
  const configuredPath = String(configManager?.get?.(DEFAULT_CONFIG_PATH) ?? "").trim();
  if (!configuredPath) {
    return DEFAULT_EXTERNAL_RULES_PATH;
  }

  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(process.cwd(), configuredPath);
}

function loadExternalRules(rulesPath) {
  try {
    const raw = fs.readFileSync(rulesPath, "utf8").trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return normalizeExternalRuleObject(parsed.rules ?? parsed);
  } catch {
    return {};
  }
}

function normalizeExternalRuleObject(rawRules = {}) {
  const source = rawRules && typeof rawRules === "object" && !Array.isArray(rawRules) ? rawRules : {};
  return {
    version: Number(source.version ?? 1),
    defaultSquadNamePatterns: asStringArray(source.defaultSquadNamePatterns),
    priority: asStringArray(source.priority),
    infantry: normalizeCategory(source.infantry),
    vehicle: normalizeCategory(source.vehicle),
    support: normalizeCategory(source.support),
    vehicleClasses: normalizeVehicleClasses(source.vehicleClasses),
  };
}

function normalizeCategory(category) {
  const source = category && typeof category === "object" && !Array.isArray(category) ? category : {};
  return {
    exactWhitelist: asStringArray(source.exactWhitelist ?? source.exact),
    aliases: normalizeAlias(source.aliases ?? source.alias),
    contains: asStringArray(source.contains),
    blacklist: asStringArray(source.blacklist),
    regex: asStringArray(source.regex),
    blacklistRegex: asStringArray(source.blacklistRegex),
    classes: normalizeVehicleClasses(source.classes ?? source.vehicleClasses),
  };
}

function mergeRules(baseRules, overrideRules) {
  const override = normalizeExternalRuleObject(overrideRules);
  return {
    version: Number(override.version ?? baseRules.version ?? 1),
    defaultSquadNamePatterns: dedupeStrings([
      ...(baseRules.defaultSquadNamePatterns ?? []),
      ...(override.defaultSquadNamePatterns ?? []),
    ]),
    priority: dedupeStrings([
      ...(override.priority ?? []),
      ...(baseRules.priority ?? []),
    ]),
    infantry: mergeCategoryRules(baseRules.infantry, override.infantry),
    vehicle: mergeCategoryRules(baseRules.vehicle, override.vehicle),
    support: mergeCategoryRules(baseRules.support, override.support),
    vehicleClasses: mergeVehicleClassRules(baseRules.vehicleClasses, override.vehicleClasses),
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

function normalizeVehicleClasses(vehicleClasses) {
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
    aliases: normalizeAlias(source.aliases ?? source.alias),
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

function normalizeAlias(alias) {
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

function asStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function dedupeStrings(values = []) {
  const seen = new Set();
  const result = [];
  for (const item of values) {
    const text = String(item ?? "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}
