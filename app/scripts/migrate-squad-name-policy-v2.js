// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";
import { validatePolicyDocument } from "../domain/squad-name-policy/index.js";

const args = process.argv.slice(2);
const noBackup = args.includes("--no-backup");
const requestedPath = args.find((item) => !item.startsWith("--"));
const policyPath = path.resolve(process.cwd(), requestedPath || "config/squad_name_policy.json");

const raw = JSON.parse(await fs.readFile(policyPath, "utf8"));
const result = validatePolicyDocument(raw, { policyPath });
if (!result.valid) {
  console.error(JSON.stringify(result.errors, null, 2));
  process.exitCode = 1;
} else {
  if (!noBackup) await fs.copyFile(policyPath, `${policyPath}.v1.bak`);
  await fs.writeFile(policyPath, `${JSON.stringify(result.normalized, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: true,
    policyPath,
    version: result.normalized.version,
    revision: result.normalized.revision,
    types: result.normalized.types.length,
    entries: result.normalized.entries.length,
    migrationWarnings: result.normalized.migrationWarnings?.length ?? 0,
  }, null, 2));
}
