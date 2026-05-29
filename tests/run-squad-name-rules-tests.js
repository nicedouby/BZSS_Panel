import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { classifySquadName, getSquadNameClassifierRules } from "../core/squad-name-classifier.js";

async function main() {
  assert.equal(classifySquadName("Squad 7").category, "infantry");
  assert.equal(classifySquadName("步兵队").category, "infantry");
  assert.equal(classifySquadName("装甲队").category, "vehicle");
  assert.equal(classifySquadName("后勤支援").category, "support");

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

  console.log("run-squad-name-rules-tests: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
