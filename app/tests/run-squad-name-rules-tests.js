import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  classifySquadName,
  getSquadNameClassifierRules,
  getSquadNameExactRuleConfig,
  updateSquadNameExactRuleConfig,
} from "../core/squad-name-classifier.js";

async function main() {
  assert.equal(classifySquadName("Squad 7").category, "infantry");
  assert.equal(classifySquadName("步兵队").category, "infantry");
  assert.equal(classifySquadName("装甲队").category, "vehicle");
  assert.equal(classifySquadName("后勤支援").category, "logistics");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-squad-rules-"));
  const rulesPath = path.join(tempDir, "rules.json");
  await fs.writeFile(rulesPath, JSON.stringify({
    rules: {
      infantry: {
        exact: ["alpha squad"],
      },
      vehicle: {
        exact: ["bravo armor"],
      },
      logistics: {
        exact: ["logi one"],
      },
    },
  }), "utf8");

  const configManager = {
    get(pathText) {
      return pathText === "squadNameClassifier.rulesPath" ? rulesPath : undefined;
    },
  };

  const rules = getSquadNameClassifierRules(configManager);
  assert.equal(classifySquadName("alpha squad", { rules }).category, "infantry");
  assert.equal(classifySquadName("bravo armor", { rules }).category, "vehicle");
  assert.equal(classifySquadName("logi one", { rules }).category, "logistics");
  assert.equal(classifySquadName("直升机", { rules }).category, "support");

  const updated = await updateSquadNameExactRuleConfig(configManager, {
    infantry: ["alpha squad", "green squad"],
    vehicle: ["bravo armor", "alpha squad"],
    support: ["logi 1"],
    logistics: ["logi one"],
  });
  assert.deepEqual(updated.exactRules, {
    infantry: ["green squad"],
    vehicle: ["alpha squad", "bravo armor"],
    support: ["logi 1"],
    logistics: ["logi one"],
  });

  const savedConfig = await getSquadNameExactRuleConfig(configManager);
  assert.deepEqual(savedConfig.exactRules, updated.exactRules);

  const savedRules = getSquadNameClassifierRules(configManager);
  assert.equal(classifySquadName("green squad", { rules: savedRules }).category, "infantry");
  assert.equal(classifySquadName("alpha squad", { rules: savedRules }).category, "vehicle");
  assert.equal(classifySquadName("logi 1", { rules: savedRules }).category, "support");
  assert.equal(classifySquadName("logi one", { rules: savedRules }).category, "logistics");
  assert.equal(classifySquadName("直升机", { rules: savedRules }).category, "support");

  console.log("run-squad-name-rules-tests: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
