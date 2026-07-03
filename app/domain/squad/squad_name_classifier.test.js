import assert from "node:assert/strict";

import { classifySquadName, SQUAD_NATURE, SQUAD_NATURE_LABEL, normalizeSquadName } from "./squad_name_classifier.js";

const INFANTRY_CASES = [
  "Squad 1",
  "squad1",
  "小队1",
  "小队 1",
  "步兵一队",
  "机械化步兵（bmp2）",
  "空突",
  "INF",
  "LOCKED INF",
  "步兵战车",
];

const VEHICLE_CASES = [
  "BTR",
  "BMP",
  "IFV CLAIM",
  "zcc",
  "zcc 1",
  "BJC",
  "zjc-2",
  "tank",
  "装甲队",
  "载具队",
  "轮战",
  "SPG",
];

const SUPPORT_CASES = [
  "迫击炮",
  "mortar",
  "logi",
  "zsj",
  "ZSJ 1",
  "后勤车",
  "补给队",
  "FOB",
  "HAB",
];

const LOGISTICS_CASES = [
  "后勤队",
  "logistics",
  "fob",
  "hab",
  "运输队",
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

for (const name of LOGISTICS_CASES) {
  expectNature(name, SQUAD_NATURE.LOGISTICS, SQUAD_NATURE_LABEL.logistics);
}

assert.equal(classifySquadName("hello").nature, SQUAD_NATURE.OTHER);
assert.equal(classifySquadName("").nature, SQUAD_NATURE.OTHER);
assert.equal(classifySquadName(null).nature, SQUAD_NATURE.OTHER);
assert.equal(classifySquadName(undefined).nature, SQUAD_NATURE.OTHER);

assert.equal(classifySquadName("步兵战车").nature, SQUAD_NATURE.INFANTRY);
assert.equal(classifySquadName("bmp2").vehicleClass, "ifv");
assert.equal(classifySquadName("bmp-2").vehicleClass, "ifv");
assert.equal(classifySquadName("zcc").nature, SQUAD_NATURE.VEHICLE);
assert.equal(classifySquadName("matv").vehicleClass, "light_vehicle");
assert.equal(classifySquadName("后勤车").nature, SQUAD_NATURE.SUPPORT);
assert.equal(classifySquadName("zsj").nature, SQUAD_NATURE.SUPPORT);
assert.equal(classifySquadName("99a").vehicleClass, "tank");
assert.equal(classifySquadName("SPG").nature, SQUAD_NATURE.VEHICLE);
assert.equal(classifySquadName("SPG").vehicleClass, "spg");
assert.equal(classifySquadName("logi truck").nature, SQUAD_NATURE.SUPPORT);
assert.equal(classifySquadName("mortar vehicle").nature, SQUAD_NATURE.SUPPORT);
assert.equal(classifySquadName("M1A2").vehicleClass, "tank");
assert.equal(classifySquadName("BMP-2M").vehicleClass, "ifv");
assert.equal(classifySquadName("MATV_USMC").vehicleClass, "light_vehicle");
assert.equal(classifySquadName("UH60M").vehicleClass, "light_vehicle");
assert.equal(classifySquadName("Ural375").vehicleClass, "light_vehicle");
assert.equal(classifySquadName("IED").nature, SQUAD_NATURE.INFANTRY);
assert.equal(classifySquadName("3030").nature, SQUAD_NATURE.VEHICLE);
assert.equal(classifySquadName("8080").nature, SQUAD_NATURE.VEHICLE);
assert.equal(classifySquadName("1212").nature, SQUAD_NATURE.VEHICLE);
assert.equal(classifySquadName("12-12").nature, SQUAD_NATURE.VEHICLE);
assert.equal(classifySquadName("82A").nature, SQUAD_NATURE.VEHICLE);
assert.equal(classifySquadName("ZLT05").nature, SQUAD_NATURE.VEHICLE);
assert.equal(classifySquadName("FV107").nature, SQUAD_NATURE.VEHICLE);
assert.equal(classifySquadName("08IFV").nature, SQUAD_NATURE.VEHICLE);
assert.equal(classifySquadName("92IFV").nature, SQUAD_NATURE.VEHICLE);
assert.equal(classifySquadName("PJP车").nature, SQUAD_NATURE.VEHICLE);
assert.equal(classifySquadName("M1").nature, SQUAD_NATURE.VEHICLE);
assert.equal(classifySquadName("FV123").nature, SQUAD_NATURE.VEHICLE);

console.log("squad_name_classifier.test.js passed");
