// -*- coding: utf-8 -*-

export const PRESSURE_ZONE_PRIORITIES = Object.freeze({
  FREE: 0,
  SOFT: 50,
  COMBAT: 80,
  HARD: 100,
});

export const DEFAULT_PRESSURE_ZONE_CONFIG = Object.freeze({
  referenceDiagonalMeters: 5600,
  minMapScale: 0.75,
  maxMapScale: 1.30,
  coordinateScaleMeters: null,
  hard: Object.freeze({
    mapFactor: 0.075,
    nearestObjectiveFactor: 0.35,
    minRadiusMeters: 250,
    maxRadiusMeters: 700,
    frontSafetyMarginMeters: 300,
  }),
  soft: Object.freeze({
    mapFactor: 0.14,
    nearestObjectiveFactor: 0.70,
    minExtraOverHardMeters: 100,
    maxRadiusMeters: 1600,
    frontSafetyMarginMeters: 150,
  }),
  combat: Object.freeze({
    gapFactor: 0.60,
    lateralFactor: 1.20,
    minRadiusMeters: 450,
    maxRadiusMeters: 1600,
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
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const { hard, soft, combat, ...topLevel } = source;
    Object.assign(result, topLevel);
    if (hard) Object.assign(result.hard, hard);
    if (soft) Object.assign(result.soft, soft);
    if (combat) Object.assign(result.combat, combat);
  }
  return result;
}
