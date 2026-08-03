import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildSquadNamePolicyWarningMessages,
  evaluateSquadName,
  normalizePolicyDocument,
  readSquadNamePolicyState,
  saveSquadNamePolicyState,
  validatePolicyDocument,
} from "../domain/squad-name-policy/index.js";

const samplePolicy = normalizePolicyDocument({
  version: 1,
  suggestionLimit: 5,
  infantryNames: ["机械化步兵队", "拉点队"],
  specialInfantryNames: ["龟壳", "后勤队"],
  entries: [
    {
      faction: "AFU",
      vehicleType: "IFV",
      asset: "/Game/Vehicles/BMP1_AFU/BP_BMP1_AFU.BP_BMP1_AFU",
      name: "BMP-1",
      aliases: [],
      keywords: ["BMP"],
    },
    {
      faction: "AFU",
      vehicleType: "IFV",
      asset: "/Game/Vehicles/BMP2_AFU/BP_BMP2_AFU.BP_BMP2_AFU",
      name: "BMP-2",
      aliases: ["BMP 2"],
      keywords: ["BMP"],
    },
    {
      faction: "AFU",
      vehicleType: "IFV",
      asset: "/Game/Vehicles/BMP2M/BP_BMP2M.BP_BMP2M",
      name: "BMP-2M",
      aliases: [],
      keywords: ["BMP"],
    },
    {
      faction: "CAF",
      vehicleType: "APC",
      asset: "/Game/Vehicles/LAV_RWS/BP_LAV_RWS_C6.BP_LAV_RWS_C6",
      name: "LAV III C6 RWS",
      aliases: ["LAV C6"],
      keywords: ["LAV RWS"],
    },
    {
      faction: "ADF",
      vehicleType: "MBT",
      asset: "/Game/Vehicles/AUS_M1A1/BP_AUS_M1A1.BP_AUS_M1A1",
      name: "M1A1",
      aliases: ["Abrams"],
      keywords: ["TANK"],
    },
    {
      faction: "CAF",
      vehicleType: "APC",
      asset: "/Game/Vehicles/M113A3/BP_M113A3_C6.BP_M113A3_C6",
      name: "M113A3 C6",
      aliases: [],
      keywords: ["M113"],
    },
    {
      faction: "PLA",
      vehicleType: "IFV",
      asset: "/Game/Vehicles/ZBL08/BP_ZBL08.BP_ZBL08",
      name: "ZBL08",
      aliases: ["08式步战车", "08式"],
      keywords: ["ZBL", "ZBL08", "08"],
    },
  ],
});

assert.deepEqual(samplePolicy.types.map((type) => type.id), [
  "matv",
  "ifv",
  "apc",
  "tank",
  "atgm_matv",
  "artillery_vehicle",
  "helicopter",
  "attack_helicopter",
  "infantry",
  "logistics",
  "mortar",
]);
assert.equal(samplePolicy.types.every((type) => type.defaultMaxPlayers == null), true);

assert.equal(evaluateSquadName("op", samplePolicy).valid, true);
assert.equal(evaluateSquadName("op", samplePolicy).matched.matchedKind, "admin");

assert.equal(evaluateSquadName("BMP1", samplePolicy).valid, true);
assert.equal(evaluateSquadName("BMP-1", samplePolicy).matched.name, "BMP-1");
assert.equal(evaluateSquadName("BMP 1", samplePolicy).matched.name, "BMP-1");
assert.equal(evaluateSquadName("bmp 2", samplePolicy).matched.name, "BMP-2");
const defaultSquad = evaluateSquadName("Squad 1", samplePolicy);
assert.equal(defaultSquad.valid, true);
assert.equal(defaultSquad.classification.nature, "infantry");
assert.equal(defaultSquad.classification.typeId, "infantry");
assert.equal(defaultSquad.classification.typeLabel, "战斗步兵");
assert.equal(evaluateSquadName("机械化步兵队", samplePolicy).matched.matchedKind, "infantry");
assert.equal(evaluateSquadName("龟壳", samplePolicy).matched.matchedKind, "infantry");
assert.equal(evaluateSquadName("后勤队", samplePolicy).valid, true);

const supervisionPolicy = normalizePolicyDocument({
  ...samplePolicy,
  types: [...samplePolicy.types, {
    id: "supervision",
    label: "督战队",
    nature: "other",
    description: "不受监督规则限制的督战队",
    defaultMaxPlayers: null,
    assetMode: "none",
    enabled: true,
    sortOrder: 120,
    ruleExemptions: { supervision: true },
  }],
  entries: [...samplePolicy.entries, {
    name: "OPOP 督战队",
    typeId: "supervision",
    enabled: true,
  }],
});
const supervisionSquad = evaluateSquadName("OPOP 督战队", supervisionPolicy);
assert.equal(supervisionSquad.valid, true);
assert.equal(supervisionSquad.classification.typeId, "supervision");
assert.equal(supervisionSquad.classification.nature, "other");
assert.equal(supervisionSquad.classification.ruleExemptions.supervision, true);

const bmpTeam = evaluateSquadName("BMP队", samplePolicy);
assert.equal(bmpTeam.valid, true);
assert.equal(bmpTeam.suffixStripped, true);
assert.equal(bmpTeam.classification.typeId, "ifv");
assert.equal(bmpTeam.classification.nature, "vehicle");
assert.equal(bmpTeam.matched.matchedKind, "suffix");

const invalidBmp = evaluateSquadName("BMP违规队", samplePolicy);
assert.equal(invalidBmp.valid, false);
assert.equal(invalidBmp.suggestions.some((item) => item.name.startsWith("BMP")), true);

assert.deepEqual(buildSquadNamePolicyWarningMessages([
  { name: "BMP-1" },
  { name: "BMP-1TS" },
  { name: "BMP-2" },
  { name: "BMP-1" },
  { name: "ZU-23-2" },
  { name: "BMP-1AM" },
]), [
  "警告违规队名！\n本服对队名要求十分严格。",
  "警告你可能想建立\nBMP-1，BMP-1TS\nBMP-2，BMP-1\nZU-23-2，BMP-1AM 队。",
]);

assert.equal(evaluateSquadName("TANK", samplePolicy).suggestions[0].name, "M1A1");
assert.equal(evaluateSquadName("LAV RWS", samplePolicy).suggestions[0].name, "LAV III C6 RWS");
assert.equal(evaluateSquadName("zsj", samplePolicy).matched.matchedKind, "infantry");

const typo = evaluateSquadName("BPM2", samplePolicy);
assert.equal(typo.valid, false);
assert.equal(typo.algorithmSuggestions[0].name, "BMP-2");

const bmp2m = evaluateSquadName("BMP2M", samplePolicy);
assert.equal(bmp2m.valid, true);
assert.equal(bmp2m.matched.name, "BMP-2M");

const m113 = evaluateSquadName("M113A3", samplePolicy);
assert.equal(m113.valid, false);
assert.equal(m113.algorithmSuggestions[0].name, "M113A3 C6");

const empty = evaluateSquadName("", samplePolicy);
assert.equal(empty.valid, false);
assert.equal(empty.suggestions.length, 0);

const none = evaluateSquadName("hello", samplePolicy);
assert.equal(none.valid, false);
assert.equal(none.suggestions.length, 0);

const numeric = evaluateSquadName("131", samplePolicy);
assert.equal(numeric.valid, false);
assert.equal(numeric.suggestions.length, 0);
assert.equal(numeric.classification?.nature, "infantry");
assert.equal(numeric.classification?.reason.includes("步兵队"), true);

const weirdChinese = evaluateSquadName("离谱中文队名", samplePolicy);
assert.equal(weirdChinese.valid, false);
assert.equal(weirdChinese.suggestions.length, 0);
assert.equal(weirdChinese.classification ?? null, null);

const bizarreChinese = evaluateSquadName("我是傻逼", samplePolicy);
assert.equal(bizarreChinese.valid, false);
assert.equal(bizarreChinese.suggestions.length, 0);
assert.equal(bizarreChinese.classification ?? null, null);

const modelChinese = evaluateSquadName("08式", samplePolicy);
assert.equal(modelChinese.valid, true);
assert.equal(modelChinese.matched?.name, "ZBL08");
assert.equal(modelChinese.classification?.typeId, "ifv");

const modelChineseTeam = evaluateSquadName("08式队", samplePolicy);
assert.equal(modelChineseTeam.valid, false);
assert.equal(modelChineseTeam.classification ?? null, null);
assert.equal(modelChineseTeam.suggestions.some((item) => item.name === "ZBL08"), true);

const repeatedDigits = evaluateSquadName("0808", samplePolicy);
assert.equal(repeatedDigits.valid, false);
assert.equal(repeatedDigits.classification ?? null, null);
assert.equal(repeatedDigits.suggestions.some((item) => item.name === "ZBL08"), true);

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-squad-name-policy-"));
const policyPath = path.join(tempDir, "policy.json");
const config = {
  get(name) {
    return name === "squadNamePolicy.path" ? policyPath : undefined;
  },
};
await saveSquadNamePolicyState(config, {
  revision: 1,
  suggestionLimit: 3,
  types: samplePolicy.types,
  entries: samplePolicy.entries,
});
const state = await readSquadNamePolicyState(config);
assert.equal(state.stats.entries, samplePolicy.entries.length);
assert.equal(state.suggestionLimit, 3);
const saved = JSON.parse(await fs.readFile(policyPath, "utf8"));
assert.equal(Array.isArray(saved.entries), true);
assert.equal(Array.isArray(saved.types), true);
assert.equal(saved.version, 2);
assert.equal(saved.infantryNames, undefined);

const matrix = [
  ["悍马车", "vehicle", "matv", null],
  ["TAPV", "vehicle", "matv", null],
  ["M1A1", "vehicle", "tank", null],
  ["迫击炮队", "support", "mortar", null],
  ["步兵队", "infantry", "infantry", null],
  ["后勤队", "logistics", "logistics", null],
];
for (const [name, nature, typeId, maxPlayers] of matrix) {
  const result = evaluateSquadName(name, samplePolicy);
  assert.equal(result.valid, true, String(name));
  assert.equal(result.classification?.nature, nature, String(name));
  assert.equal(result.classification?.typeId, typeId, String(name));
  assert.equal(result.classification?.effectiveMaxPlayers, maxPlayers, String(name));
}
assert.equal(evaluateSquadName("M1A1", samplePolicy).classification.assetPath.includes("AUS_M1A1"), true);
assert.equal(evaluateSquadName("LAV C6", samplePolicy).classification.typeId, "apc");

const legacyCategoryPolicy = normalizePolicyDocument({
  version: 1,
  entries: [
    { name: "ATGM Test", vehicleType: "TD" },
    { name: "Artillery Test", vehicleType: "SPA" },
    { name: "Transport Heli Test", vehicleType: "UH" },
    { name: "Attack Heli Test", vehicleType: "AH" },
  ],
});
assert.deepEqual(
  legacyCategoryPolicy.entries.filter((entry) => entry.name.endsWith("Test")).map((entry) => entry.typeId),
  ["atgm_matv", "artillery_vehicle", "helicopter", "attack_helicopter"],
);

const overridePolicy = normalizePolicyDocument({
  ...samplePolicy,
  entries: samplePolicy.entries.map((entry) => entry.id === "rule:tapv"
    ? { ...entry, maxPlayersOverride: 3 }
    : entry),
});
assert.equal(evaluateSquadName("TAPV", overridePolicy).classification.effectiveMaxPlayers, 3);
assert.equal(evaluateSquadName("TAPV", overridePolicy).classification.maxPlayersSource, "rule_override");

const duplicatePolicy = {
  ...samplePolicy,
  entries: [...samplePolicy.entries, {
    id: "rule:duplicate_bmp",
    name: "Duplicate",
    aliases: ["BMP"],
    keywords: [],
    typeId: "ifv",
    faction: "",
    asset: "",
    enabled: true,
  }],
};
assert.equal(validatePolicyDocument(duplicatePolicy).errors.some((item) => item.code === "duplicate_name"), true);
assert.equal(validatePolicyDocument({
  ...samplePolicy,
  entries: [{ ...samplePolicy.entries[0], typeId: "missing_type" }],
}).errors.some((item) => item.code === "unknown_type"), true);
assert.equal(validatePolicyDocument({
  ...samplePolicy,
  entries: [{ ...samplePolicy.entries.find((entry) => entry.typeId === "infantry"), asset: "/Game/Invalid" }],
}).errors.some((item) => item.code === "non_vehicle_asset"), true);
assert.equal(validatePolicyDocument({
  ...samplePolicy,
  types: [...samplePolicy.types, { ...samplePolicy.types[0] }],
}).errors.some((item) => item.code === "duplicate_type_id"), true);
assert.equal(validatePolicyDocument({
  ...samplePolicy,
  types: samplePolicy.types.map((type, index) => index === 0 ? { ...type, nature: "invalid" } : type),
}).errors.some((item) => item.code === "invalid_nature"), true);

await assert.rejects(
  saveSquadNamePolicyState(config, { revision: 1, types: state.types, entries: state.entries }),
  (error) => error?.code === "PolicyRevisionConflict",
);
const state2 = await saveSquadNamePolicyState(config, {
  revision: state.revision,
  suggestionLimit: 4,
  types: state.types,
  entries: state.entries,
});
assert.equal(state2.revision, state.revision + 1);
assert.equal(await fs.stat(`${policyPath}.bak`).then(() => true), true);

console.log("run-squad-name-policy-tests.js passed");
