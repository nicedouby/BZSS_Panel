import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = await fs.readFile(path.join(root, "app/plugins/fair-squad-guard.js"), "utf8");

assert.match(source, /isInfantryClassification/);
assert.match(source, /classification\?\.nature === "infantry"/);
assert.doesNotMatch(source, /DEFAULT_INFANTRY_PATTERNS/);
assert.doesNotMatch(source, /function isAllowedInfantryName/);
assert.doesNotMatch(source, /domain\/squad\/squad_name_classifier/);
assert.match(source, /classification missing/);

console.log("fair squad policy integration tests passed");

assert.match(source, /isSquadSupervisionExempt/);
assert.match(source, /supervision_exempt/);
