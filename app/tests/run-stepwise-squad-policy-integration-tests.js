import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = await fs.readFile(path.join(root, "app/plugins/stepwise-squad-playtime-guard.js"), "utf8");

assert.match(source, /classifySquadNameWithPolicy/);
assert.match(source, /classification\?\.source/);
assert.match(source, /classification_missing/);
assert.doesNotMatch(source, /domain\/squad\/squad_name_classifier/);

console.log("stepwise squad policy integration tests passed");

assert.match(source, /isSquadSupervisionExempt/);
assert.match(source, /supervision_exempt/);
