#!/usr/bin/env node
// -*- coding: utf-8 -*-
import fs from "node:fs/promises";
import path from "node:path";
import { migrateLegacyConfig } from "../../core/config-manager.js";

const overwrite = process.argv.includes("--overwrite");
const result = await migrateLegacyConfig({ overwrite });
const legacyPath = path.resolve(process.cwd(), "config.json");
const legacyOutput = `${legacyPath}.legacy`;
if (process.argv.includes("--rename-legacy")) {
  await fs.rename(legacyPath, legacyOutput);
  result.legacyPath = legacyOutput;
}
console.log(`Migrated ${result.files.length} config files to ${result.targetDirectory}.`);
