// -*- coding: utf-8 -*-

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_PRESSURE_ZONE_CONFIG, mergePressureZoneConfig } from "./defaults.js";

const FIELD_RULES = {
  referenceDiagonalMeters: [500, 20000],
  minMapScale: [0.1, 5],
  maxMapScale: [0.1, 5],
  baseRadiusMultiplier: [0.25, 4],
  "hard.mapFactor": [0, 2],
  "hard.nearestObjectiveFactor": [0, 3],
  "hard.minRadiusMeters": [0, 10000],
  "hard.maxRadiusMeters": [0, 20000],
  "hard.frontSafetyMarginMeters": [0, 10000],
  "soft.mapFactor": [0, 3],
  "soft.nearestObjectiveFactor": [0, 5],
  "soft.minExtraOverHardMeters": [0, 10000],
  "soft.maxRadiusMeters": [0, 30000],
  "soft.frontSafetyMarginMeters": [0, 10000],
  "combat.gapFactor": [0, 5],
  "combat.lateralFactor": [0, 5],
  "combat.minRadiusMeters": [0, 20000],
  "combat.maxRadiusMeters": [0, 30000],
  "combat.polygonArcSegments": [6, 128],
};

export function createBaseConfigStore({ dataDir = "data/dynamic-pressure-zone", logger = null } = {}) {
  const filePath = path.resolve(dataDir, "base-config.json");

  async function init() {
    await mkdir(path.dirname(filePath), { recursive: true });
  }

  async function get() {
    try {
      return normalizeBaseConfig(JSON.parse(await readFile(filePath, "utf8")));
    } catch (error) {
      if (error?.code !== "ENOENT") logger?.warn?.(`[DynamicPressureZone] base config read failed: ${error.message}`);
      return null;
    }
  }

  async function save(value) {
    const config = normalizeBaseConfig(value);
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
    return { config, filePath };
  }

  return { init, get, save, filePath };
}

export function normalizeBaseConfig(value = {}) {
  const merged = mergePressureZoneConfig(DEFAULT_PRESSURE_ZONE_CONFIG, value);
  const normalized = {
    referenceDiagonalMeters: checked("referenceDiagonalMeters", merged.referenceDiagonalMeters),
    minMapScale: checked("minMapScale", merged.minMapScale),
    maxMapScale: checked("maxMapScale", merged.maxMapScale),
    coordinateScaleMeters: nullablePositive("coordinateScaleMeters", merged.coordinateScaleMeters),
    baseRadiusMultiplier: checked("baseRadiusMultiplier", merged.baseRadiusMultiplier),
    hard: {
      mapFactor: checked("hard.mapFactor", merged.hard.mapFactor),
      nearestObjectiveFactor: checked("hard.nearestObjectiveFactor", merged.hard.nearestObjectiveFactor),
      minRadiusMeters: checked("hard.minRadiusMeters", merged.hard.minRadiusMeters),
      maxRadiusMeters: checked("hard.maxRadiusMeters", merged.hard.maxRadiusMeters),
      frontSafetyMarginMeters: checked("hard.frontSafetyMarginMeters", merged.hard.frontSafetyMarginMeters),
    },
    soft: {
      mapFactor: checked("soft.mapFactor", merged.soft.mapFactor),
      nearestObjectiveFactor: checked("soft.nearestObjectiveFactor", merged.soft.nearestObjectiveFactor),
      minExtraOverHardMeters: checked("soft.minExtraOverHardMeters", merged.soft.minExtraOverHardMeters),
      maxRadiusMeters: checked("soft.maxRadiusMeters", merged.soft.maxRadiusMeters),
      frontSafetyMarginMeters: checked("soft.frontSafetyMarginMeters", merged.soft.frontSafetyMarginMeters),
    },
    combat: {
      gapFactor: checked("combat.gapFactor", merged.combat.gapFactor),
      lateralFactor: checked("combat.lateralFactor", merged.combat.lateralFactor),
      minRadiusMeters: checked("combat.minRadiusMeters", merged.combat.minRadiusMeters),
      maxRadiusMeters: checked("combat.maxRadiusMeters", merged.combat.maxRadiusMeters),
      polygonArcSegments: Math.round(checked("combat.polygonArcSegments", merged.combat.polygonArcSegments)),
    },
  };

  if (normalized.minMapScale > normalized.maxMapScale) throw new Error("minMapScale cannot exceed maxMapScale.");
  if (normalized.hard.minRadiusMeters > normalized.hard.maxRadiusMeters) throw new Error("hard.minRadiusMeters cannot exceed hard.maxRadiusMeters.");
  if (normalized.combat.minRadiusMeters > normalized.combat.maxRadiusMeters) throw new Error("combat.minRadiusMeters cannot exceed combat.maxRadiusMeters.");
  return normalized;
}

function checked(field, value) {
  const numeric = Number(value);
  const [min, max] = FIELD_RULES[field];
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
    throw new Error(`${field} must be a finite number between ${min} and ${max}.`);
  }
  return numeric;
}

function nullablePositive(field, value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 1000) {
    throw new Error(`${field} must be null or a number between 0 and 1000.`);
  }
  return numeric;
}
