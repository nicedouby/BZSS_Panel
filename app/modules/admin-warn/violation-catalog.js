// -*- coding: utf-8 -*-

export const VIOLATION_WARNING_CATALOG = [
  {
    key: "main_camping",
    label: "压家警告",
    items: [
      { key: "main_camping", label: "压家", warningText: "压家警告" },
      { key: "severe_main_camping", label: "严重压家", warningText: "严重压家警告" },
      { key: "main_camping_intent", label: "压家意图", warningText: "压家意图警告" },
      { key: "borderline_main_camping", label: "擦边压家", warningText: "擦边压家警告" },
    ],
  },
  {
    key: "solo_vehicle",
    label: "违规单载警告",
    items: [{ key: "solo_vehicle", label: "违规单载", warningText: "违规单载警告" }],
  },
  {
    key: "wandering",
    label: "郊游警告",
    items: [
      { key: "infantry_squad_wandering", label: "步兵队队长带队郊游", warningText: "带队郊游警告" },
      { key: "individual_wandering", label: "个人郊游", warningText: "个人郊游警告" },
      { key: "vehicle_squad_wandering", label: "载具队郊游", warningText: "载具郊游警告" },
    ],
  },
  {
    key: "invalid_vehicle_claim",
    label: "违规认领载具警告",
    items: [{ key: "invalid_vehicle_claim", label: "违规认领载具", warningText: "违规认领载具警告" }],
  },
  {
    key: "invalid_squad_creation",
    label: "违规建队警告",
    items: [{ key: "invalid_mortar_squad", label: "攻守模式建立迫击炮队", warningText: "违规迫击炮建队" }],
  },
  {
    key: "abuse_main_base_protection",
    label: "违规利用压家保护警告",
    items: [
      { key: "vehicle_abuse_main_base_protection", label: "载具队恶意利用压家保护", warningText: "载具队恶意利用压家保护警告" },
      { key: "invalid_fire_support_position", label: "违规火力支援阵地", warningText: "违规火力支援阵地警告" },
      { key: "infantry_abuse_main_base_protection", label: "步兵恶意利用压家保护", warningText: "步兵恶意利用压家保护警告" },
    ],
  },
  {
    key: "invalid_squad_loadout",
    label: "队装不规范警告",
    items: [
      { key: "invalid_infantry_leader_loadout", label: "步兵队长不规范队装", warningText: "步兵队队长不规范队装警告" },
      { key: "invalid_vehicle_leader_loadout", label: "载具队长不规范队装", warningText: "载具队队长不规范队装警告" },
    ],
  },
  {
    key: "failure_squad_duty",
    label: "不履行队伍性质义务警告",
    items: [
      { key: "infantry_squad_duty_failure", label: "步兵队不履行步兵队职责", warningText: "步兵队不履行步兵队职责警告" },
      { key: "vehicle_squad_duty_failure", label: "载具队不履行载具队职责", warningText: "载具队不履行载具队职责警告" },
      { key: "logistics_squad_duty_failure", label: "后勤队不履行后勤队职责", warningText: "后勤队不履行后勤队职责警告" },
    ],
  },
];

const violationByKey = new Map();
for (const category of VIOLATION_WARNING_CATALOG) {
  for (const item of category.items) {
    violationByKey.set(item.key, { ...item, categoryKey: category.key, categoryLabel: category.label });
  }
}

export function resolveViolationWarning(value = {}) {
  const violationKey = String(value?.violationKey ?? value?.key ?? "").trim();
  const catalogItem = violationByKey.get(violationKey);
  if (!catalogItem) return null;

  const categoryKey = String(value?.categoryKey ?? "").trim();
  if (categoryKey && categoryKey !== catalogItem.categoryKey) return null;

  const detail = String(value?.detail ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/"/g, "'")
    .trim()
    .slice(0, 120);
  if (!detail) return null;

  return {
    ...catalogItem,
    detail,
    message: `${catalogItem.warningText}，${detail}`.slice(0, 180),
  };
}
