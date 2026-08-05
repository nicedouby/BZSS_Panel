// -*- coding: utf-8 -*-

export const PRESSURE_ZONE_PRIORITIES = Object.freeze({
  FREE: 0,
  SOFT: 50,
  COMBAT: 80,
  HARD: 100,
});

export const DEFAULT_PRESSURE_ZONE_CONFIG = Object.freeze({
  schemaVersion: 2,
  referenceMapSizeMeters: 4000,
  mapScaleInfluence: 0.65,
  minMapScale: 0.55,
  maxMapScale: 1.55,
  coordinateScaleMeters: null,
  hard: Object.freeze({
    baseRadiusMeters: 650,
    minRadiusMeters: 300,
    maxRadiusMeters: 1100,
    emergencyMinimumRadiusMeters: 150,
    maxBaseToFirstObjectiveRatio: 0.62,
  }),
  soft: Object.freeze({
    objectiveSpacingRatio: 0.20,
    minExtensionMeters: 100,
    maxExtensionMeters: 400,
    fallbackExtensionMeters: 200,
    objectiveSafetyMarginMeters: 150,
  }),
  combat: Object.freeze({
    gapFactor: 0.30,
    mapScaleInfluence: 0.20,
    lateralFactor: 1.20,
    minRadiusMeters: 250,
    maxRadiusMeters: 900,
    polygonArcSegments: 18,
  }),
});

export function mergePressureZoneConfig(...sources) {
  const result = {
    ...DEFAULT_PRESSURE_ZONE_CONFIG,
    hard: { ...DEFAULT_PRESSURE_ZONE_CONFIG.hard },
    soft: { ...DEFAULT_PRESSURE_ZONE_CONFIG.soft },
    combat: { ...DEFAULT_PRESSURE_ZONE_CONFIG.combat },
  };
  for (const rawSource of sources) {
    if (!rawSource || typeof rawSource !== "object") continue;
    const source = migrateLegacyPressureZoneConfig(rawSource);
    const { hard, soft, combat, ...topLevel } = source;
    Object.assign(result, topLevel);
    if (hard) Object.assign(result.hard, hard);
    if (soft) Object.assign(result.soft, soft);
    if (combat) Object.assign(result.combat, combat);
  }
  result.schemaVersion = 2;
  return result;
}

export function migrateLegacyPressureZoneConfig(source) {
  if (!source || typeof source !== "object") return {};
  if (Number(source.schemaVersion) >= 2 || source.referenceMapSizeMeters != null) return source;

  const migrated = {
    schemaVersion: 2,
    coordinateScaleMeters: source.coordinateScaleMeters ?? null,
  };

  const referenceDiagonalMeters = Number(source.referenceDiagonalMeters);
  if (Number.isFinite(referenceDiagonalMeters) && referenceDiagonalMeters > 0) {
    migrated.referenceMapSizeMeters = referenceDiagonalMeters / Math.SQRT2;
  }

  const minMapScale = Number(source.minMapScale);
  const maxMapScale = Number(source.maxMapScale);
  if (Number.isFinite(minMapScale)) migrated.minMapScale = minMapScale;
  if (Number.isFinite(maxMapScale)) migrated.maxMapScale = maxMapScale;

  if (source.hard && typeof source.hard === "object") {
    migrated.hard = {};
    if (Number.isFinite(Number(source.hard.minRadiusMeters))) migrated.hard.minRadiusMeters = Number(source.hard.minRadiusMeters);
    if (Number.isFinite(Number(source.hard.maxRadiusMeters))) migrated.hard.maxRadiusMeters = Number(source.hard.maxRadiusMeters);
  }

  if (source.combat && typeof source.combat === "object") {
    migrated.combat = {};
    if (Number.isFinite(Number(source.combat.lateralFactor))) migrated.combat.lateralFactor = Number(source.combat.lateralFactor);
    if (Number.isFinite(Number(source.combat.polygonArcSegments))) migrated.combat.polygonArcSegments = Number(source.combat.polygonArcSegments);
  }

  return migrated;
}
