// -*- coding: utf-8 -*-

import { resolveTacticalMapKey, TACTICAL_MAP_CONFIGS } from "../../../web-client/src/shared/tactical-map-data.shared.js";

export const TEMPORARY_SHRINK_RULES = Object.freeze([
  "当当前交战位于一方的压家圈内，首先根据争议点位位置减少压家圈层级。",
  "通常一个向外衍生的完整 FOB 圈有 3 个逐渐减少的层级：第一次减少为 FOB 排除半径减 FOB 施工半径；第二次减少为 FOB 施工半径；第三次减少为 FOB 排除半径减 FOB 施工半径。",
  "如果只有 FOB 内圈，则只减少压家圈内圈部分。",
  "争议交战点位为中心的一个完整 FOB 圈内为可活动区域，但不得覆盖敌方主基地向外的一个 FOB 内圈。",
].join("\\n"));

const groups = [
  { id: "full-1", label: "1 个完整 FOB 圈", fullCount: 1, innerCount: 0, mapKeys: ["AlBasrah", "Chora", "Fallujah", "Harju", "Kokan", "Lashkar", "Sumari"], maps: ["巴士拉", "乔拉", "费卢杰", "哈尤", "科坎", "拉什卡山谷", "三鲜岛"] },
  { id: "full-1-inner-1", label: "1 个完整 FOB 圈 + 1 个 FOB 内圈", fullCount: 1, innerCount: 1, mapKeys: ["GooseBay", "Gorodok", "Yehorivka", "BlackCoast"], maps: ["黑海", "鹅湾", "格罗多克", "叶城"] },
  { id: "full-2", label: "2 个完整 FOB 圈", fullCount: 2, innerCount: 0, mapKeys: ["Tallil", "Skorpo"], maps: ["塔利尔", "斯科普"] },
  { id: "inner-2", label: "2 个 FOB 内圈", fullCount: 0, innerCount: 2, mapKeys: ["Kohat", "Mutaha", "Narva", "Kamdesh"], maps: ["克哈特", "木塔哈", "纳尔瓦", "坎德仕高地"] },
  { id: "full-3", label: "3 个完整 FOB 圈", fullCount: 3, innerCount: 0, mapKeys: ["Manicouagan"], maps: ["曼尼古根"] },
  { id: "inner-1", label: "1 个 FOB 内圈", fullCount: 0, innerCount: 1, mapKeys: ["Mestia", "FoolsRoad"], maps: ["梅斯蒂亚", "愚者之路"] },
];

export const MAP_PRESSURE_RULES = Object.freeze(groups.map((group) => Object.freeze({
  ...group,
  maps: Object.freeze([...group.maps]),
})));

const aliases = new Map([
  ["albasrah", "巴士拉"], ["chora", "乔拉"], ["fallujah", "费卢杰"], ["harju", "哈尤"],
  ["kokan", "科坎"], ["lashkar", "拉什卡山谷"], ["lashkarvalley", "拉什卡山谷"], ["sumari", "三鲜岛"],
  ["blackcoast", "黑海"], ["goosebay", "鹅湾"], ["gorodok", "格罗多克"], ["yehorivka", "叶城"],
  ["talil", "塔利尔"], ["tallil", "塔利尔"], ["skorpo", "斯科普"], ["kohat", "克哈特"],
  ["mutaha", "木塔哈"], ["narva", "纳尔瓦"], ["kamdesh", "坎德仕高地"], ["mestia", "梅斯蒂亚"],
  ["foolsroad", "愚者之路"], ["manicouagan", "曼尼古根"],
]);

export function resolvePressureRule(mapName = "") {
  const raw = String(mapName ?? "").trim();
  if (!raw) return null;
  const mapKey = resolveTacticalMapKey(raw);
  const compactKey = String(mapKey ?? "").replace(/_(?:AAS|RAAS|Seed)_v\d+$/i, "").toLowerCase();
  const lower = raw.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
  const chineseName = aliases.get(lower) ?? aliases.get(compactKey) ?? raw;
  return MAP_PRESSURE_RULES.find((group) =>
    group.mapKeys?.some((key) => compactKey.includes(String(key).toLowerCase()))
    || group.maps.some((name) => chineseName.includes(name) || lower.includes(name.toLowerCase()))
  ) ?? null;
}

const MAP_DISPLAY_NAMES = Object.freeze({
  AlBasrah: "巴士拉", Chora: "乔拉", Fallujah: "费卢杰", Harju: "哈尤", Kokan: "科坎",
  Lashkar: "拉什卡山谷", Sumari: "三鲜岛", GooseBay: "鹅湾", Gorodok: "格罗多克",
  Yehorivka: "叶城", Tallil: "塔利尔", Skorpo: "斯科普", Kohat: "克哈特",
  Mutaha: "木塔哈", Narva: "纳尔瓦", Kamdesh: "坎德仕高地", Manicouagan: "曼尼古根",
  Mestia: "梅斯蒂亚", FoolsRoad: "愚者之路",
});

export function resolvePressureMapKey(mapName = "") {
  return resolveTacticalMapKey(String(mapName ?? "")) ?? "";
}

export function getMapAssetName(mapKey = "") {
  return TACTICAL_MAP_CONFIGS[String(mapKey ?? "")]?.name ?? "";
}

export function getMapDisplayName(mapKey = "", fallback = "") {
  const compactKey = String(mapKey ?? "").replace(/_(?:AAS|RAAS|Seed)_v\\d+$/i, "");
  return MAP_DISPLAY_NAMES[compactKey] ?? String(fallback ?? "").trim();
}
