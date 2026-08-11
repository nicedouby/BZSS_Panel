// -*- coding: utf-8 -*-

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_PRESSURE_ZONE_CONFIG, mergePressureZoneConfig } from "./defaults.js";

const FIELD_RULES = {
  referenceMapSizeMeters: [500, 20000],
  mapScaleInfluence: [0, 1],
  minMapScale: [0.1, 5],
  maxMapScale: [0.1, 5],
  "hard.baseRadiusMeters": [50, 5000],
  "hard.minRadiusMeters": [0, 10000],
  "hard.maxRadiusMeters": [0, 20000],
  "hard.emergencyMinimumRadiusMeters": [0, 5000],
  "hard.maxBaseToFirstObjectiveRatio": [0.05, 0.98],
  "soft.objectiveSpacingRatio": [0, 1],
  "soft.minExtensionMeters": [0, 10000],
  "soft.maxExtensionMeters": [0, 15000],
  "soft.fallbackExtensionMeters": [0, 10000],
  "soft.objectiveSafetyMarginMeters": [0, 10000],
  "combat.gapFactor": [0, 2],
  "combat.mapScaleInfluence": [0, 1],
  "combat.lateralFactor": [0.1, 5],
  "combat.minRadiusMeters": [0, 20000],
  "combat.maxRadiusMeters": [0, 30000],
  "combat.polygonArcSegments": [6, 128],
  "hotspot.referenceRadiusMeters": [50, 10000],
  "hotspot.minRadiusMeters": [0, 10000],
  "hotspot.maxRadiusMeters": [0, 20000],
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
    schemaVersion: 2,
    referenceMapSizeMeters: checked("referenceMapSizeMeters", merged.referenceMapSizeMeters),
    mapScaleInfluence: checked("mapScaleInfluence", merged.mapScaleInfluence),
    minMapScale: checked("minMapScale", merged.minMapScale),
    maxMapScale: checked("maxMapScale", merged.maxMapScale),
    coordinateScaleMeters: nullablePositive("coordinateScaleMeters", merged.coordinateScaleMeters),
    hard: {
      baseRadiusMeters: checked("hard.baseRadiusMeters", merged.hard.baseRadiusMeters),
      minRadiusMeters: checked("hard.minRadiusMeters", merged.hard.minRadiusMeters),
      maxRadiusMeters: checked("hard.maxRadiusMeters", merged.hard.maxRadiusMeters),
      emergencyMinimumRadiusMeters: checked("hard.emergencyMinimumRadiusMeters", merged.hard.emergencyMinimumRadiusMeters),
      maxBaseToFirstObjectiveRatio: checked("hard.maxBaseToFirstObjectiveRatio", merged.hard.maxBaseToFirstObjectiveRatio),
    },
    soft: {
      objectiveSpacingRatio: checked("soft.objectiveSpacingRatio", merged.soft.objectiveSpacingRatio),
      minExtensionMeters: checked("soft.minExtensionMeters", merged.soft.minExtensionMeters),
      maxExtensionMeters: checked("soft.maxExtensionMeters", merged.soft.maxExtensionMeters),
      fallbackExtensionMeters: checked("soft.fallbackExtensionMeters", merged.soft.fallbackExtensionMeters),
      objectiveSafetyMarginMeters: checked("soft.objectiveSafetyMarginMeters", merged.soft.objectiveSafetyMarginMeters),
    },
    combat: {
      gapFactor: checked("combat.gapFactor", merged.combat.gapFactor),
      mapScaleInfluence: checked("combat.mapScaleInfluence", merged.combat.mapScaleInfluence),
      lateralFactor: checked("combat.lateralFactor", merged.combat.lateralFactor),
      minRadiusMeters: checked("combat.minRadiusMeters", merged.combat.minRadiusMeters),
      maxRadiusMeters: checked("combat.maxRadiusMeters", merged.combat.maxRadiusMeters),
      polygonArcSegments: Math.round(checked("combat.polygonArcSegments", merged.combat.polygonArcSegments)),
    },
    hotspot: {
      referenceRadiusMeters: checked("hotspot.referenceRadiusMeters", merged.hotspot.referenceRadiusMeters),
      minRadiusMeters: checked("hotspot.minRadiusMeters", merged.hotspot.minRadiusMeters),
      maxRadiusMeters: checked("hotspot.maxRadiusMeters", merged.hotspot.maxRadiusMeters),
    },
  };

  if (normalized.minMapScale > normalized.maxMapScale) throw new Error("minMapScale cannot exceed maxMapScale.");
  if (normalized.hard.minRadiusMeters > normalized.hard.maxRadiusMeters) throw new Error("hard.minRadiusMeters cannot exceed hard.maxRadiusMeters.");
  if (normalized.hard.emergencyMinimumRadiusMeters > normalized.hard.minRadiusMeters) {
    throw new Error("hard.emergencyMinimumRadiusMeters cannot exceed hard.minRadiusMeters.");
  }
  if (normalized.soft.minExtensionMeters > normalized.soft.maxExtensionMeters) {
    throw new Error("soft.minExtensionMeters cannot exceed soft.maxExtensionMeters.");
  }
  if (normalized.combat.minRadiusMeters > normalized.combat.maxRadiusMeters) throw new Error("combat.minRadiusMeters cannot exceed combat.maxRadiusMeters.");
  if (normalized.hotspot.minRadiusMeters > normalized.hotspot.maxRadiusMeters) throw new Error("hotspot.minRadiusMeters cannot exceed hotspot.maxRadiusMeters.");
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
