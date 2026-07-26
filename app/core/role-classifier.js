// -*- coding: utf-8 -*-

/**
 * 统一兵种角色映射表。
 *
 * roleKey: 稳定的内部角色键
 * label:   对外显示名称
 * short:   紧凑显示名称
 * icon:    web-client/public/assets/icons 下的图标文件名
 */
export const ROLE_DEFINITIONS = Object.freeze([
  { roleKey: "pilot_squadleader", patterns: ["pilot squadleader", "pilot sl", "squadleader pilot", "sl pilot"], label: "飞行员队长", short: "飞行队长", icon: "T_role_pilot_squadleader.PNG" },
  { roleKey: "crewman_squadleader", patterns: ["crewman squadleader", "crew squadleader", "squadleader crewman", "sl crewman", "crew sl"], label: "乘员队长", short: "乘员队长", icon: "T_role_crewman_squadleader.PNG" },
  { roleKey: "squadleader", patterns: ["squadleader", "squad leader", " sl ", "leader"], label: "队长", short: "队长", icon: "T_role_squadleader.PNG" },
  { roleKey: "medic", patterns: ["medic"], label: "医疗", short: "医疗", icon: "T_role_medic.PNG" },
  { roleKey: "heavy_antitank", patterns: ["heavyantitank", "heavy anti tank", "heavy anti-tank", "hat", "重筒"], label: "重筒", short: "重筒", icon: "T_role_heavyantitank.PNG" },
  { roleKey: "light_antitank", patterns: ["lightantitank", "light anti tank", "light anti-tank", "antitank", "anti tank", "lat", "轻筒"], label: "轻筒", short: "轻筒", icon: "T_role_lightantitank.PNG" },
  { roleKey: "machinegunner", patterns: ["machinegunner", "machine gunner", "machine gun", "mg", "通机"], label: "通机", short: "通机", icon: "T_role_machinegunner.PNG" },
  { roleKey: "automatic_rifleman", patterns: ["automaticrifleman", "automatic rifleman", "automatic rifle", " ar ", "班机"], label: "班机", short: "班机", icon: "T_role_automaticrifleman.PNG" },
  { roleKey: "grenadier", patterns: ["grenadier", "grenade", "榴弹"], label: "榴弹", short: "榴弹", icon: "T_role_grenadier.PNG" },
  { roleKey: "engineer", patterns: ["combatengineer", "combat engineer", "engineer", "sapper", "工兵"], label: "工兵", short: "工兵", icon: "T_role_engineer.PNG" },
  { roleKey: "raider", patterns: ["raider", "奇袭"], label: "奇袭", short: "奇袭", icon: "T_role_raider.PNG" },
  { roleKey: "marksman", patterns: ["designatedmarksman", "designated marksman", "marksman", "dmr"], label: "精确射手", short: "射手", icon: "T_role_designatedmarksman.PNG" },
  { roleKey: "sniper", patterns: ["sniper"], label: "狙击", short: "狙击", icon: "T_role_sniper.PNG" },
  { roleKey: "crewman", patterns: ["crewman", "crew", "乘员"], label: "乘员", short: "乘员", icon: "T_role_crewman.PNG" },
  { roleKey: "pilot", patterns: ["pilot", "飞行员"], label: "飞行员", short: "飞行员", icon: "T_role_pilot.PNG" },
  { roleKey: "rifleman", patterns: ["rifleman", "plain", "步枪"], label: "步枪", short: "步枪", icon: "T_role_rifleman.PNG" },
]);

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_.\\/-]+/g, " ")
    .replace(/\\s+/g, " ")
    .trim();
}

function compact(value) {
  return normalize(value).replace(/\\s+/g, "");
}

function matches(value, pattern) {
  const normalized = normalize(value);
  const target = normalize(pattern);
  if (!target) return false;
  if (target === "sl" || target === "ar" || target === "mg") {
    return new Set(normalized.split(/[^a-z0-9]+/g).filter(Boolean)).has(target);
  }
  return normalized.includes(target) || compact(normalized).includes(compact(target));
}

function fallbackLabel(value) {
  const raw = String(value ?? "").trim();
  return raw
    .split(/[./\\\\]/)
    .pop()
    .replace(/_C$/i, "")
    .replace(/^(BP_|Role_|Soldier_)/i, "")
    .replaceAll("_", " ") || "未知兵种";
}

export function resolveRoleDefinition(value) {
  const definition = ROLE_DEFINITIONS.find((item) => item.patterns.some((pattern) => matches(value, pattern)));
  return definition ?? {
    roleKey: "unknown",
    label: fallbackLabel(value),
    short: fallbackLabel(value),
    icon: "",
  };
}

export function resolveRoleLabel(value) {
  return resolveRoleDefinition(value).label;
}

export function resolveRoleShortLabel(value) {
  return resolveRoleDefinition(value).short;
}
