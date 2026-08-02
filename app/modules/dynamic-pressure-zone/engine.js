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
  const widthMeters = (bounds.maxX - bounds.minX) * coordinateScaleMeters;
  const heightMeters = (bounds.maxY - bounds.minY) * coordinateScaleMeters;
  const diagonalMeters = Math.hypot(widthMeters, heightMeters);
  const mapScale = clamp(
    diagonalMeters / positive(config.referenceDiagonalMeters, 5600),
    positive(config.minMapScale, 0.75),
    positive(config.maxMapScale, 1.30),
  );

  const fronts = resolveCombatPair(chain, input.objectiveState);
  const team1Main = mains.find((main) => main.teamId === 1);
  const team2Main = mains.find((main) => main.teamId === 2);
  if (!team1Main || !team2Main) return inactiveState("missing-team-main", { mode });

  const team1Base = calculateBaseZone({
    teamId: 1,
    main: team1Main,
    chain: fronts.chain,
    front: fronts.team1Front,
    diagonalMeters,
    coordinateScaleMeters,
    config,
  });
  const team2Base = calculateBaseZone({
    teamId: 2,
    main: team2Main,
    chain: fronts.chain,
    front: fronts.team2Front,
    diagonalMeters,
    coordinateScaleMeters,
    config,
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
      mapScale,
      config,
    });
    zones.push(combat.zone);
  }
  zones.push(buildCircleZone(team1Base, "hard"), buildCircleZone(team2Base, "hard"));

  return {
    active: true,
    mode,
    generatedAt: new Date().toISOString(),
    map: {
      bounds,
      widthMeters,
      heightMeters,
      diagonalMeters,
      scaleFactor: mapScale,
      coordinateScaleMeters,
      worldUnitsPerMeter,
    },
    combat: combat?.state ?? null,
    bases: { team1: team1Base, team2: team2Base },
    zones,
    diagnostics: {
      combatPairResolved: Boolean(fronts.pair),
      combatPairAdjacent: fronts.adjacent,
      team1FrontObjectiveId: fronts.team1Front?.id ?? null,
      team2FrontObjectiveId: fronts.team2Front?.id ?? null,
      ownership: fronts.chain.map((objective) => ({ id: objective.id, teamId: objective.ownerTeamId })),
      warnings: fronts.pair ? [] : ["No adjacent Team 1 / Team 2 combat pair is currently available."],
      config,
    },
  };
}

function calculateBaseZone({ teamId, main, chain, front, diagonalMeters, coordinateScaleMeters, config }) {
  const distances = chain.map((objective) => ({
    objectiveId: objective.id,
    objectiveName: objective.name,
    distanceMeters: distance(main, objective) * coordinateScaleMeters,
  }));
  const nearest = distances.reduce((best, item) => !best || item.distanceMeters < best.distanceMeters ? item : best, null);
  const currentFrontDistance = front ? distance(main, front) * coordinateScaleMeters : nearest?.distanceMeters ?? 0;

  const baseRadiusMultiplier = positive(config.baseRadiusMultiplier, 1.15);
  const hardMapContribution = diagonalMeters * nonNegative(config.hard.mapFactor, 0.075);
  const hardObjectiveContribution = (nearest?.distanceMeters ?? 0) * nonNegative(config.hard.nearestObjectiveFactor, 0.35);
  const hardRaw = (hardMapContribution + hardObjectiveContribution) * baseRadiusMultiplier;
  const hardMinRadius = nonNegative(config.hard.minRadiusMeters, 350);
  const hardMaxRadius = nonNegative(config.hard.maxRadiusMeters, 1000);
  const hardClamped = clamp(hardRaw, hardMinRadius, hardMaxRadius);
  const hardFrontCap = Math.max(
    hardMinRadius,
    currentFrontDistance - nonNegative(config.hard.frontSafetyMarginMeters, 250),
  );
  const hardRadius = Math.min(hardClamped, hardFrontCap);

  const softFloor = hardRadius + nonNegative(config.soft.minExtraOverHardMeters, 200);
  const softMapContribution = diagonalMeters * nonNegative(config.soft.mapFactor, 0.14);
  const softObjectiveContribution = (nearest?.distanceMeters ?? 0) * nonNegative(config.soft.nearestObjectiveFactor, 0.70);
  const softRaw = (softMapContribution + softObjectiveContribution) * baseRadiusMultiplier;
  const softMaxRadius = nonNegative(config.soft.maxRadiusMeters, 2200);
  const softClamped = clamp(softRaw, softFloor, Math.max(softFloor, softMaxRadius));
  const softFrontCap = Math.max(softFloor, currentFrontDistance - nonNegative(config.soft.frontSafetyMarginMeters, 100));
  const softRadius = Math.min(softClamped, softFrontCap);

  return {
    teamId,
    main: { x: main.x, y: main.y },
    nearestObjectiveId: nearest?.objectiveId ?? null,
    nearestObjectiveDistance: nearest?.distanceMeters ?? null,
    objectiveDistances: distances,
    currentFrontObjectiveId: front?.id ?? null,
    currentFrontDistance,
    hardRadius,
    softRadius,
    hardRadiusWorld: hardRadius / coordinateScaleMeters,
    softRadiusWorld: softRadius / coordinateScaleMeters,
    formula: {
      baseRadiusMultiplier,
      hardMapContribution,
      hardObjectiveContribution,
      hardRaw,
      hardClamped,
      hardFrontCap,
      hardLimit: resolveLimit(hardRadius, hardRaw, hardClamped, hardFrontCap),
      softMapContribution,
      softObjectiveContribution,
      softRaw,
      softClamped,
      softFrontCap,
      softLimit: resolveLimit(softRadius, softRaw, softClamped, softFrontCap),
    },
  };
}

function calculateCombatZone({ pair, coordinateScaleMeters, worldUnitsPerMeter, mapScale, config }) {
  const pointA = { x: pair.pointA.x, y: pair.pointA.y };
  const pointB = { x: pair.pointB.x, y: pair.pointB.y };
  const gapMeters = distance(pointA, pointB) * coordinateScaleMeters;
  const baseRadius = gapMeters * positive(config.combat.gapFactor, 0.60);
  const combatRadius = clamp(
    baseRadius * mapScale,
    positive(config.combat.minRadiusMeters, 450),
    positive(config.combat.maxRadiusMeters, 1600),
  );
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
      mapModifier: mapScale,
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

function nonNegative(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function resolveLimit(radius, raw, clamped, frontCap) {
  if (radius === frontCap && frontCap < clamped) return "front-safety-cap";
  if (clamped < raw) return "maximum-radius";
  if (clamped > raw) return "minimum-radius";
  return "formula";
}
