import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  evaluateSquadName,
  normalizePolicyDocument,
  readSquadNamePolicyState,
  saveSquadNamePolicyState,
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
  ],
});

assert.equal(evaluateSquadName("op", samplePolicy).valid, true);
assert.equal(evaluateSquadName("op", samplePolicy).matched.matchedKind, "admin");

assert.equal(evaluateSquadName("BMP1", samplePolicy).valid, true);
assert.equal(evaluateSquadName("BMP-1", samplePolicy).matched.name, "BMP-1");
assert.equal(evaluateSquadName("BMP 1", samplePolicy).matched.name, "BMP-1");
assert.equal(evaluateSquadName("bmp 2", samplePolicy).matched.name, "BMP-2");
assert.equal(evaluateSquadName("Squad 1", samplePolicy).valid, true);
assert.equal(evaluateSquadName("机械化步兵队", samplePolicy).matched.matchedKind, "infantry");
assert.equal(evaluateSquadName("龟壳", samplePolicy).matched.matchedKind, "special_infantry");
assert.equal(evaluateSquadName("后勤队", samplePolicy).valid, true);

const bmpTeam = evaluateSquadName("BMP队", samplePolicy);
assert.equal(bmpTeam.valid, false);
assert.equal(bmpTeam.suffixStripped, true);
assert.deepEqual(bmpTeam.keywordSuggestions.map((item) => item.name).slice(0, 3), ["BMP-1", "BMP-2", "BMP-2M"]);
assert.equal(bmpTeam.warningMessage.includes("BMP-1"), true);

assert.equal(evaluateSquadName("TANK", samplePolicy).suggestions[0].name, "M1A1");
assert.equal(evaluateSquadName("LAV RWS", samplePolicy).suggestions[0].name, "LAV III C6 RWS");

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
assert.equal(weirdChinese.classification?.nature, "infantry");
assert.equal(weirdChinese.classification?.reason.includes("已认定为步兵队"), true);

const bizarreChinese = evaluateSquadName("我是傻逼", samplePolicy);
assert.equal(bizarreChinese.valid, false);
assert.equal(bizarreChinese.suggestions.length, 0);
assert.equal(bizarreChinese.classification?.nature, "infantry");
assert.equal(bizarreChinese.classification?.reason.includes("奇葩中文队名"), true);

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-squad-name-policy-"));
const policyPath = path.join(tempDir, "policy.json");
const config = {
  get(name) {
    return name === "squadNamePolicy.path" ? policyPath : undefined;
  },
};
await saveSquadNamePolicyState(config, {
  suggestionLimit: 3,
  entries: samplePolicy.entries,
});
const state = await readSquadNamePolicyState(config);
assert.equal(state.stats.entries, samplePolicy.entries.length);
assert.equal(state.suggestionLimit, 3);
const saved = JSON.parse(await fs.readFile(policyPath, "utf8"));
assert.equal(Array.isArray(saved.entries), true);

console.log("run-squad-name-policy-tests.js passed");
