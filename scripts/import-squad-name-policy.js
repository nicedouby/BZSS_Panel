// -*- coding: utf-8 -*-

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { normalizePolicyDocument } from "../domain/squad-name-policy/index.js";

const DEFAULT_INPUT = path.resolve(process.cwd(), "载具队队名规范.xlsx");
const DEFAULT_OUTPUT = path.resolve(process.cwd(), "config", "squad_name_policy.json");
const inputPath = path.resolve(process.cwd(), process.argv[2] ?? DEFAULT_INPUT);
const outputPath = path.resolve(process.cwd(), process.argv[3] ?? DEFAULT_OUTPUT);

const python = process.env.CODEX_PYTHON
  || process.env.PYTHON
  || "python";

const extractor = String.raw`
import json
import sys
from openpyxl import load_workbook

path = sys.argv[1]
wb = load_workbook(path, data_only=True, read_only=True)
ws = wb.active
entries = []
for row in ws.iter_rows(min_row=2, values_only=True):
    values = list(row or []) + [None] * 12
    values = values[:12]
    if not any(values):
        continue
    faction = str(values[0] or "").strip()
    vehicle_type = str(values[1] or "").strip()
    asset = str(values[2] or "").strip()
    name = str(values[3] or "").strip()
    if not name:
        continue
    aliases = [str(item or "").strip() for item in values[4:9] if str(item or "").strip()]
    keywords = [str(item or "").strip() for item in values[9:12] if str(item or "").strip()]
    entries.append({
        "faction": faction,
        "vehicleType": vehicle_type,
        "asset": asset,
        "name": name,
        "aliases": aliases,
        "keywords": keywords,
    })
print(json.dumps({
    "sheetName": ws.title,
    "entries": entries,
}, ensure_ascii=False))
`;

const raw = execFileSync(python, ["-c", extractor, inputPath], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 10,
});
const parsed = JSON.parse(raw);
const now = new Date().toISOString();
const policy = normalizePolicyDocument({
  version: 1,
  source: {
    type: "xlsx",
    fileName: path.basename(inputPath),
    path: inputPath,
    sheetName: parsed.sheetName,
  },
  importedAt: now,
  updatedAt: now,
  suggestionLimit: 5,
  entries: parsed.entries,
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify({
  version: policy.version,
  source: policy.source,
  importedAt: policy.importedAt,
  updatedAt: policy.updatedAt,
  suggestionLimit: policy.suggestionLimit,
  defaultNamePatterns: policy.defaultNamePatterns,
  infantryNames: policy.infantryNames,
  specialInfantryNames: policy.specialInfantryNames,
  entries: policy.entries,
}, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  outputPath,
  entries: policy.entries.length,
}, null, 2));
