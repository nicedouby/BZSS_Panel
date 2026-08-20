// -*- coding: utf-8 -*-

export const TEMPORARY_SHRINK_RULES = Object.freeze([
  "当当前交战位于一方的压家圈内，首先根据争议点位位置减少压家圈层级。",
  "通常一个向外衍生的完整 FOB 圈有 3 个逐渐减少的层级：第一次减少为 FOB 排除半径减 FOB 施工半径；第二次减少为 FOB 施工半径；第三次减少为 FOB 排除半径减 FOB 施工半径。",
  "如果只有 FOB 内圈，则只减少压家圈内圈部分。",
  "争议交战点位为中心的一个完整 FOB 圈内为可活动区域，但不得覆盖敌方主基地向外的一个 FOB 内圈。",
].join("\\n"));

const groups = [
  { id: "full-1", label: "1 个完整 FOB 圈", fullCount: 1, innerCount: 0, maps: ["巴士拉", "乔拉", "费卢杰", "哈尤", "科坎", "拉什卡山谷", "三鲜岛"] },
  { id: "full-1-inner-1", label: "1 个完整 FOB 圈 + 1 个 FOB 内圈", fullCount: 1, innerCount: 1, maps: ["黑海", "鹅湾", "格罗多克", "叶城"] },
  { id: "full-2", label: "2 个完整 FOB 圈", fullCount: 2, innerCount: 0, maps: ["塔利尔", "斯科普"] },
  { id: "inner-2", label: "2 个 FOB 内圈", fullCount: 0, innerCount: 2, maps: ["克哈特", "木塔哈", "纳尔瓦", "坎德仕高地"] },
  { id: "full-3", label: "3 个完整 FOB 圈", fullCount: 3, innerCount: 0, maps: ["曼尼古根"] },
  { id: "inner-1", label: "1 个 FOB 内圈", fullCount: 0, innerCount: 1, maps: ["梅斯蒂亚", "愚者之路"] },
];

export const MAP_PRESSURE_RULES = Object.freeze(groups.map((group) => Object.freeze({
  ...group,
  maps: Object.freeze([...group.maps]),
})));

const aliases = new Map([
  ["basrah", "巴士拉"], ["chora", "乔拉"], ["fallujah", "费卢杰"], ["harju", "哈尤"],
  ["kokan", "科坎"], ["lashkar valley", "拉什卡山谷"], ["sanxian islands", "三鲜岛"],
  ["black coast", "黑海"], ["goose bay", "鹅湾"], ["gorodok", "格罗多克"], ["yecheng", "叶城"],
  ["talil", "塔利尔"], ["skorpo", "斯科普"], ["kohat", "克哈特"], ["mutaha", "木塔哈"],
  ["narva", "纳尔瓦"], ["kandahar highlands", "坎德仕高地"], ["mestia", "梅斯蒂亚"],
  ["fool's road", "愚者之路"],
]);

export function resolvePressureRule(mapName = "") {
  const raw = String(mapName ?? "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const chineseName = aliases.get(lower) ?? raw;
  return MAP_PRESSURE_RULES.find((group) => group.maps.some((name) => chineseName.includes(name) || lower.includes(name.toLowerCase()))) ?? null;
}
