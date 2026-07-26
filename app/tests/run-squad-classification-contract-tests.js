import assert from "node:assert/strict";

import { classifySquadNameWithPolicy } from "../domain/squad-name-policy/index.js";

const policy = {
  version: 2,
  revision: 12,
  defaultNamePatterns: ["^squad\\s*\\d+$", "^小队\\s*\\d+$"],
  types: [
    { id: "infantry", label: "战斗步兵", nature: "infantry" },
    { id: "special_infantry", label: "空突", nature: "infantry" },
    { id: "ifv", label: "步兵战车", nature: "vehicle" },
    { id: "logistics", label: "后勤小队", nature: "logistics" },
    { id: "mortar", label: "迫击炮小队", nature: "support" },
  ],
  entries: [
    { id: "infantry.main", name: "步兵", typeId: "infantry", aliases: [] },
    { id: "infantry.air_assault", name: "空突", typeId: "special_infantry", aliases: [] },
    { id: "vehicle.ifv", name: "步兵战车", typeId: "ifv", aliases: ["步战", "IFV"], allowSquadSuffix: true },
    { id: "logistics.main", name: "后勤", typeId: "logistics", aliases: [] },
    { id: "support.mortar", name: "迫击炮", typeId: "mortar", aliases: [] },
  ],
};

function classify(name) {
  return classifySquadNameWithPolicy(name, policy).classification;
}

function assertNature(name, nature, typeId) {
  const result = classify(name);
  assert.equal(result.valid, true, name);
  assert.equal(result.nature, nature, name);
  assert.equal(result.typeId, typeId, name);
  assert.equal(result.source, "policy_event", name);
  assert.equal(result.policyRevision, 12, name);
}

for (const name of ["步兵战车", "步兵战车1", "步战", "步战2", "IFV", "IFV 1"]) {
  assertNature(name, "vehicle", "ifv");
}
assertNature("步兵", "infantry", "infantry");
assertNature("空突", "infantry", "special_infantry");
assertNature("Squad 1", "infantry", "infantry");
assertNature("小队 2", "infantry", "infantry");
assertNature("后勤", "logistics", "logistics");
assertNature("迫击炮", "support", "mortar");

assert.equal(classify("99A").valid, false);
assert.equal(classify("不存在的队").valid, false);

console.log("squad classification contract tests passed");
