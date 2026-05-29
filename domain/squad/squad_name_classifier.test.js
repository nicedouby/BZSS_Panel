import assert from "node:assert/strict";

import { classifySquadName, SQUAD_NATURE, SQUAD_NATURE_LABEL, normalizeSquadName } from "./squad_name_classifier.js";

const INFANTRY_CASES = [
  "Squad 1",
  "squad1",
  "小队1",
  "小队 1",
  "步兵一队",
  "空突",
  "INF",
  "LOCKED INF",
];

const VEHICLE_CASES = [
  "步兵战车",
  "BTR",
  "BMP",
  "IFV CLAIM",
  "tank",
  "装甲队",
  "载具队",
  "轮战",
];

const SUPPORT_CASES = [
  "迫击炮",
  "mortar",
  "logi",
  "后勤车",
  "补给队",
  "FOB",
  "HAB",
];

function expectNature(name, nature, label = null) {
  const result = classifySquadName(name);
  assert.equal(result.nature, nature, name);
  if (label) {
    assert.equal(result.label, label, name);
  }
  return result;
}

assert.equal(normalizeSquadName("  Squad   1  "), "squad 1");
assert.equal(normalizeSquadName("小队１"), "小队1");
assert.equal(normalizeSquadName(" IFV CLAIM "), "ifv claim");
assert.equal(normalizeSquadName("（IFV）"), "(ifv)");

for (const name of INFANTRY_CASES) {
  expectNature(name, SQUAD_NATURE.INFANTRY, SQUAD_NATURE_LABEL.infantry);
}

for (const name of VEHICLE_CASES) {
  expectNature(name, SQUAD_NATURE.VEHICLE, SQUAD_NATURE_LABEL.vehicle);
}

for (const name of SUPPORT_CASES) {
  expectNature(name, SQUAD_NATURE.SUPPORT, SQUAD_NATURE_LABEL.support);
}

assert.equal(classifySquadName("hello").nature, SQUAD_NATURE.OTHER);
assert.equal(classifySquadName("").nature, SQUAD_NATURE.OTHER);
assert.equal(classifySquadName(null).nature, SQUAD_NATURE.OTHER);
assert.equal(classifySquadName(undefined).nature, SQUAD_NATURE.OTHER);

assert.equal(classifySquadName("步兵战车").nature, SQUAD_NATURE.VEHICLE);
assert.equal(classifySquadName("后勤车").nature, SQUAD_NATURE.SUPPORT);
assert.equal(classifySquadName("logi truck").nature, SQUAD_NATURE.SUPPORT);
assert.equal(classifySquadName("mortar vehicle").nature, SQUAD_NATURE.SUPPORT);

console.log("squad_name_classifier.test.js passed");
