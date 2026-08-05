// -*- coding: utf-8 -*-

import { DEFAULT_PRESSURE_ZONE_CONFIG, PRESSURE_ZONE_PRIORITIES, mergePressureZoneConfig } from "./defaults.js";
import { buildCapsulePolygon, clamp, distance, normalizeBounds, resolveCoordinateScaleMeters } from "./geometry.js";
import { normalizeObjectiveChain, resolveCombatPair } from "./objective-chain.js";

export function calculatePressureZones(input = {}) {
  const mode = normalizeMode(input.mode);
  if (!mode) return inactiveState("unsupported-mode", { mode: String(input.mode ?? "") });

  const bounds = normalizeBounds(input.mapBounds);
  const mains = normalizeMains(input.mains);
  const chain = normalizeObjectiveChain(input.objectiveChain);
  if (!bounds || mains.length < 2 || chain.length < 2) {
    return inactiveState("incomplete-geometry", {
      mode,
      hasBounds: Boolean(bounds),
      mainCount: mains.length,
      objectiveCount: chain.length,
    });
  }

  const config = mergePressureZoneConfig(DEFAULT_PRESSURE_ZONE_CONFIG, input.config);
  const coordinateScaleMeters = resolveCoordinateScaleMeters(bounds, config.coordinateScaleMeters);
  const worldUnitsPerMeter = 1 / coordinateScaleMeters;
  const map = resolveMapMetrics(input, bounds, coordinateScaleMeters, worldUnitsPerMeter, config);

  const fronts = resolveCombatPair(chain, input.objectiveState);
  const team1Main = mains.find((main) => main.teamId === 1);
  const team2Main = mains.find((main) => main.teamId === 2);
  if (!team1Main || !team2Main) return inactiveState("missing-team-main", { mode });

  const averageObjectiveSpacing = resolveAverageObjectiveSpacing(fronts.chain, coordinateScaleMeters);
  const warnings = [];

  const team1Base = calculateBaseZone({
    teamId: 1,
    main: team1Main,
    chain: fronts.chain,
    front: fronts.team1Front,
    coordinateScaleMeters,
    mapScale: map.scaleFactor,
    averageObjectiveSpacing,
    config,
    warnings,
  });
  const team2Base = calculateBaseZone({
    teamId: 2,
    main: team2Main,
    chain: fronts.chain,
    front: fronts.team2Front,
    coordinateScaleMeters,
    mapScale: map.scaleFactor,
    averageObjectiveSpacing,
    config,
    warnings,
  });

  const zones = [
    buildCircleZone(team1Base, "soft"),
    buildCircleZone(team2Base, "soft"),
  ];

  let combat = null;
  if (fronts.pair) {
    combat = calculateCombatZone({
      pair: fronts.pair,
      coordinateScaleMeters,
      worldUnitsPerMeter,
      rawMapScale: map.rawScaleFactor,
      config,
    });
    zones.push(combat.zone);
  } else {
    warnings.push("NO_ACTIVE_FRONT");
  }

  zones.push(buildCircleZone(team1Base, "hard"), buildCircleZone(team2Base, "hard"));

  return {
    active: true,
    mode,
    generatedAt: new Date().toISOString(),
    map,
    combat: combat?.state ?? null,
    bases: { team1: team1Base, team2: team2Base },
    zones,
    diagnostics: {
      mapSizeSource: map.sizeSource,
      effectiveMapSizeMeters: map.effectiveSizeMeters,
      rawMapScale: map.rawScaleFactor,
      effectiveMapScale: map.scaleFactor,
      averageObjectiveSpacingMeters: averageObjectiveSpacing,
      combatPairResolved: Boolean(fronts.pair),
      combatPairAdjacent: fronts.adjacent,
      team1FrontObjectiveId: fronts.team1Front?.id ?? null,
      team2FrontObjectiveId: fronts.team2Front?.id ?? null,
      ownership: fronts.chain.map((objective) => ({ id: objective.id, teamId: objective.ownerTeamId })),
      warnings,
      config,
    },
  };
}

function resolveMapMetrics(input, bounds, coordinateScaleMeters, worldUnitsPerMeter, config) {
  const boundsWidthMeters = (bounds.maxX - bounds.minX) * coordinateScaleMeters;
  const boundsHeightMeters = (bounds.maxY - bounds.minY) * coordinateScaleMeters;
  const explicitWidth = positiveOrNull(input?.mapSize?.widthMeters ?? input?.mapWidthMeters);
  const explicitHeight = positiveOrNull(input?.mapSize?.heightMeters ?? input?.mapHeightMeters);
  const widthMeters = explicitWidth ?? boundsWidthMeters;
  const heightMeters = explicitHeight ?? boundsHeightMeters;
  const effectiveSizeMeters = Math.sqrt(widthMeters * heightMeters);
  const diagonalMeters = Math.hypot(widthMeters, heightMeters);
  const referenceMapSizeMeters = positive(config.referenceMapSizeMeters, 4000);
  const rawScaleFactor = Math.sqrt(effectiveSizeMeters / referenceMapSizeMeters);
  const influencedScale = 1 + ((rawScaleFactor - 1) * clamp(nonNegative(config.mapScaleInfluence, 0.65), 0, 1));
  const scaleFactor = clamp(
    influencedScale,
    positive(config.minMapScale, 0.55),
    positive(config.maxMapScale, 1.55),
  );

  return {
    bounds,
    widthMeters,
    heightMeters,
    effectiveSizeMeters,
    diagonalMeters,
    referenceMapSizeMeters,
    rawScaleFactor,
    scaleFactor,
    sizeSource: explicitWidth && explicitHeight ? "input-map-size" : "bounds",
    coordinateScaleMeters,
    worldUnitsPerMeter,
  };
}

function calculateBaseZone({
  teamId,
  main,
  chain,
  front,
  coordinateScaleMeters,
  mapScale,
  averageObjectiveSpacing,
  config,
  warnings,
}) {
  const distances = chain.map((objective) => ({
    objectiveId: objective.id,
    objectiveName: objective.name,
    distanceMeters: distance(main, objective) * coordinateScaleMeters,
  }));
  const nearest = distances.reduce((best, item) => !best || item.distanceMeters < best.distanceMeters ? item : best, null);
  const firstIndex = teamId === 1 ? 0 : chain.length - 1;
  const secondIndex = teamId === 1 ? 1 : chain.length - 2;
  const firstObjective = chain[firstIndex] ?? null;
  const secondObjective = chain[secondIndex] ?? null;
  const firstObjectiveDistance = firstObjective ? distance(main, firstObjective) * coordinateScaleMeters : null;
  const firstObjectiveSpacing = firstObjective && secondObjective
    ? distance(firstObjective, secondObjective) * coordinateScaleMeters
    : null;
  const currentFrontDistance = front ? distance(main, front) * coordinateScaleMeters : firstObjectiveDistance ?? nearest?.distanceMeters ?? 0;

  const hardBaseRadius = positive(config.hard.baseRadiusMeters, 650);
  const hardScaledRadius = hardBaseRadius * mapScale;
  const hardMinRadius = nonNegative(config.hard.minRadiusMeters, 300);
  const hardMaxRadius = Math.max(hardMinRadius, nonNegative(config.hard.maxRadiusMeters, 1100));
  const emergencyMinimumRadius = Math.min(
    hardMinRadius,
    nonNegative(config.hard.emergencyMinimumRadiusMeters, 150),
  );
  const maxBaseToFirstObjectiveRatio = clamp(
    positive(config.hard.maxBaseToFirstObjectiveRatio, 0.62),
    0.05,
    0.98,
  );

  let hardRadius = clamp(hardScaledRadius, hardMinRadius, hardMaxRadius);
  let hardLimit = hardRadius === hardMaxRadius && hardScaledRadius > hardMaxRadius
    ? "maximum-radius"
    : hardRadius === hardMinRadius && hardScaledRadius < hardMinRadius
      ? "minimum-radius"
      : "map-scale";

  const hardObjectiveLimit = firstObjectiveDistance != null
    ? firstObjectiveDistance * maxBaseToFirstObjectiveRatio
    : null;

  if (hardObjectiveLimit != null && hardObjectiveLimit < hardRadius) {
    hardRadius = Math.max(emergencyMinimumRadius, hardObjectiveLimit);
    hardLimit = "objective-distance";
    if (hardObjectiveLimit < emergencyMinimumRadius) {
      warnings.push(`TEAM_${teamId}_FIRST_OBJECTIVE_INSIDE_EMERGENCY_MINIMUM`);
    }
  }
  hardRadius = Math.min(hardRadius, hardMaxRadius);

  const resolvedSpacing = positiveOrNull(firstObjectiveSpacing)
    ?? positiveOrNull(averageObjectiveSpacing)
    ?? positive(config.soft.fallbackExtensionMeters, 200);
  const softExtensionRaw = resolvedSpacing * nonNegative(config.soft.objectiveSpacingRatio, 0.20);
  const softExtension = clamp(
    softExtensionRaw,
    nonNegative(config.soft.minExtensionMeters, 100),
    Math.max(
      nonNegative(config.soft.minExtensionMeters, 100),
      nonNegative(config.soft.maxExtensionMeters, 400),
    ),
  );
  const softCandidate = hardRadius + softExtension;
  const objectiveSafetyMargin = nonNegative(config.soft.objectiveSafetyMarginMeters, 150);
  const softObjectiveCap = firstObjectiveDistance != null
    ? Math.max(hardRadius, firstObjectiveDistance - objectiveSafetyMargin)
    : Number.POSITIVE_INFINITY;
  const softRadius = Math.min(softCandidate, softObjectiveCap);
  const softLimit = softRadius < softCandidate ? "objective-safety-margin" : "objective-spacing";

  if (firstObjectiveDistance != null && firstObjectiveDistance <= hardRadius) {
    warnings.push(`TEAM_${teamId}_FIRST_OBJECTIVE_OVERLAPS_HARD_ZONE`);
  }

  return {
    teamId,
    main: { x: main.x, y: main.y },
    firstObjective: firstObjective ? { id: firstObjective.id, name: firstObjective.name, x: firstObjective.x, y: firstObjective.y } : null,
    secondObjective: secondObjective ? { id: secondObjective.id, name: secondObjective.name, x: secondObjective.x, y: secondObjective.y } : null,
    firstObjectiveId: firstObjective?.id ?? null,
    firstObjectiveDistance,
    firstObjectiveSpacing,
    nearestObjectiveId: nearest?.objectiveId ?? null,
    nearestObjectiveDistance: nearest?.distanceMeters ?? null,
    objectiveDistances: distances,
    currentFrontObjectiveId: front?.id ?? null,
    currentFrontDistance,
    hardRadius,
    softRadius,
    hardRadiusWorld: hardRadius / coordinateScaleMeters,
    softRadiusWorld: softRadius / coordinateScaleMeters,
    limitingFactor: hardLimit,
    formula: {
      mapScale,
      hardBaseRadius,
      hardScaledRadius,
      hardMinRadius,
      hardMaxRadius,
      emergencyMinimumRadius,
      maxBaseToFirstObjectiveRatio,
      hardObjectiveLimit,
      hardLimit,
      resolvedSpacing,
      softExtensionRaw,
      softExtension,
      objectiveSafetyMargin,
      softObjectiveCap: Number.isFinite(softObjectiveCap) ? softObjectiveCap : null,
      softLimit,
    },
  };
}

function resolveAverageObjectiveSpacing(chain, coordinateScaleMeters) {
  if (!Array.isArray(chain) || chain.length < 2) return null;
  const spacings = [];
  for (let index = 0; index < chain.length - 1; index += 1) {
    const meters = distance(chain[index], chain[index + 1]) * coordinateScaleMeters;
    if (Number.isFinite(meters) && meters > 0) spacings.push(meters);
  }
  if (!spacings.length) return null;
  return spacings.reduce((sum, value) => sum + value, 0) / spacings.length;
}

function calculateCombatZone({ pair, coordinateScaleMeters, worldUnitsPerMeter, rawMapScale, config }) {
  const pointA = { x: pair.pointA.x, y: pair.pointA.y };
  const pointB = { x: pair.pointB.x, y: pair.pointB.y };
  const gapMeters = distance(pointA, pointB) * coordinateScaleMeters;
  const baseRadius = gapMeters * nonNegative(config.combat.gapFactor, 0.30);
  const mapInfluence = clamp(nonNegative(config.combat.mapScaleInfluence, 0.20), 0, 1);
  const mapModifier = 1 + ((rawMapScale - 1) * mapInfluence);
  const scaledRadius = baseRadius * mapModifier;
  const minRadiusMeters = nonNegative(config.combat.minRadiusMeters, 250);
  const maxRadiusMeters = Math.max(minRadiusMeters, nonNegative(config.combat.maxRadiusMeters, 900));
  const combatRadius = clamp(scaledRadius, minRadiusMeters, maxRadiusMeters);
  const longitudinalRadius = combatRadius;
  const lateralRadius = combatRadius * positive(config.combat.lateralFactor, 1.20);
  const longitudinalWorld = longitudinalRadius * worldUnitsPerMeter;
  const lateralWorld = lateralRadius * worldUnitsPerMeter;
  const polygon = buildCapsulePolygon(
    pointA,
    pointB,
    longitudinalWorld,
    lateralWorld,
    config.combat.polygonArcSegments,
  );
  const geometry = {
    type: "capsule",
    a: pointA,
    b: pointB,
    longitudinalRadius: longitudinalWorld,
    lateralRadius: lateralWorld,
    longitudinalRadiusMeters: longitudinalRadius,
    lateralRadiusMeters: lateralRadius,
    polygon,
    excludeZoneIds: ["team1-hard", "team2-hard"],
  };
  return {
    zone: {
      id: "combat-buffer",
      type: "combat",
      teamId: null,
      priority: PRESSURE_ZONE_PRIORITIES.COMBAT,
      geometry,
    },
    state: {
      team1ObjectiveId: pair.pointA.id,
      team2ObjectiveId: pair.pointB.id,
      pointA,
      pointB,
      gapMeters,
      baseRadius,
      rawMapScale,
      mapInfluence,
      mapModifier,
      scaledRadius,
      limitingFactor: combatRadius <= minRadiusMeters && scaledRadius < minRadiusMeters
        ? "minimum-radius"
        : combatRadius >= maxRadiusMeters && scaledRadius > maxRadiusMeters
          ? "maximum-radius"
          : "front-gap",
      longitudinalRadius,
      lateralRadius,
      polygon,
      hardExclusionZoneIds: geometry.excludeZoneIds,
    },
  };
}

function buildCircleZone(base, type) {
  const isHard = type === "hard";
  return {
    id: `team${base.teamId}-${type}`,
    type,
    teamId: base.teamId,
    priority: isHard ? PRESSURE_ZONE_PRIORITIES.HARD : PRESSURE_ZONE_PRIORITIES.SOFT,
    geometry: {
      type: "circle",
      center: { ...base.main },
      radius: isHard ? base.hardRadiusWorld : base.softRadiusWorld,
      radiusMeters: isHard ? base.hardRadius : base.softRadius,
    },
  };
}

function normalizeMains(value) {
  const list = Array.isArray(value)
    ? value
    : Object.entries(value ?? {}).map(([teamId, main]) => ({ ...main, teamId }));
  return list.map((main) => ({
    teamId: Number(main?.teamId ?? main?.teamID),
    x: Number(main?.x ?? main?.position?.x),
    y: Number(main?.y ?? main?.position?.y),
  })).filter((main) => (main.teamId === 1 || main.teamId === 2) && Number.isFinite(main.x) && Number.isFinite(main.y));
}

function normalizeMode(value) {
  const text = String(value ?? "").trim().toUpperCase();
  if (text.includes("RAAS")) return "RAAS";
  if (/(^|[^R])AAS([^A-Z]|$)/.test(text)) return "AAS";
  return "";
}

function inactiveState(reason, diagnostics = {}) {
  return { active: false, reason, map: null, combat: null, bases: {}, zones: [], diagnostics };
}

function positive(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function positiveOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function nonNegative(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}
