// -*- coding: utf-8 -*-

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeBaseConfig } from "../modules/dynamic-pressure-zone/base-config-store.js";
import { mergePressureZoneConfig } from "../modules/dynamic-pressure-zone/defaults.js";
import { calculatePressureZones } from "../modules/dynamic-pressure-zone/engine.js";
import { classifyPoint } from "../modules/dynamic-pressure-zone/geometry.js";
import { createDynamicPressureZoneModule } from "../modules/dynamic-pressure-zone/index.js";
import { handleDynamicPressureZoneRoutes } from "../modules/dynamic-pressure-zone/routes.js";

function baseInput(overrides = {}) {
  return {
    mode: "RAAS",
    mapBounds: { minX: 0, minY: 0, maxX: 4000, maxY: 4000 },
    mains: [{ teamId: 1, x: 0, y: 0 }, { teamId: 2, x: 4000, y: 4000 }],
    objectiveChain: [
      { id: "p1", x: 1000, y: 0 },
      { id: "p2", x: 2000, y: 0 },
      { id: "p3", x: 2000, y: 4000 },
      { id: "p4", x: 3000, y: 4000 },
    ],
    objectiveState: { p1: 1, p2: 1, p3: 2, p4: 2 },
    ...overrides,
  };
}

const medium = calculatePressureZones(baseInput());
assert.equal(medium.active, true);
assert.equal(medium.map.widthMeters, 4000);
assert.equal(medium.map.heightMeters, 4000);
assert.equal(medium.map.effectiveSizeMeters, 4000);
assert.equal(medium.map.rawScaleFactor, 1);
assert.equal(medium.map.scaleFactor, 1);
assert.equal(medium.bases.team1.firstObjectiveId, "p1");
assert.equal(medium.bases.team2.firstObjectiveId, "p4");
assert.equal(Math.round(medium.bases.team1.hardRadius), 620);
assert.equal(medium.bases.team1.limitingFactor, "objective-distance");

const foldback = calculatePressureZones(baseInput({
  objectiveChain: [
    { id: "p1", x: 1000, y: 0 },
    { id: "p2", x: 1800, y: 100 },
    { id: "p3", x: 150, y: 150 },
    { id: "p4", x: 3000, y: 4000 },
  ],
}));
assert.equal(foldback.bases.team1.firstObjectiveId, "p1");
assert.equal(foldback.bases.team1.nearestObjectiveId, "p3");
assert.deepEqual(foldback.diagnostics.ownership.map((item) => item.id), ["p1", "p2", "p3", "p4"]);

const rectangular = calculatePressureZones(baseInput({
  mapBounds: { minX: 0, minY: 0, maxX: 3000, maxY: 6000 },
}));
assert.ok(Math.abs(rectangular.map.effectiveSizeMeters - Math.sqrt(3000 * 6000)) < 0.001);

const explicitSize = calculatePressureZones(baseInput({
  mapSize: { widthMeters: 2000, heightMeters: 8000 },
}));
assert.equal(explicitSize.map.sizeSource, "input-map-size");
assert.equal(explicitSize.map.effectiveSizeMeters, 4000);
assert.equal(explicitSize.map.scaleFactor, 1);

const small = calculatePressureZones(baseInput({
  mapBounds: { minX: 0, minY: 0, maxX: 2000, maxY: 2000 },
  mains: [{ teamId: 1, x: 0, y: 0 }, { teamId: 2, x: 2000, y: 2000 }],
  objectiveChain: [
    { id: "p1", x: 700, y: 0 },
    { id: "p2", x: 1200, y: 0 },
    { id: "p3", x: 800, y: 2000 },
    { id: "p4", x: 1300, y: 2000 },
  ],
}));
const large = calculatePressureZones(baseInput({
  mapBounds: { minX: 0, minY: 0, maxX: 8000, maxY: 8000 },
  mains: [{ teamId: 1, x: 0, y: 0 }, { teamId: 2, x: 8000, y: 8000 }],
  objectiveChain: [
    { id: "p1", x: 2200, y: 0 },
    { id: "p2", x: 3400, y: 0 },
    { id: "p3", x: 4600, y: 8000 },
    { id: "p4", x: 5800, y: 8000 },
  ],
}));
assert.ok(small.map.scaleFactor < 1);
assert.ok(large.map.scaleFactor > 1);
assert.ok(small.map.scaleFactor > 0.5);
assert.ok(large.map.scaleFactor < 1.5);
assert.ok(small.bases.team1.hardRadius < large.bases.team1.hardRadius);

const largeCloseP1 = calculatePressureZones(baseInput({
  mapBounds: { minX: 0, minY: 0, maxX: 8000, maxY: 8000 },
  mains: [{ teamId: 1, x: 0, y: 0 }, { teamId: 2, x: 8000, y: 8000 }],
  objectiveChain: [
    { id: "p1", x: 600, y: 0 },
    { id: "p2", x: 1200, y: 0 },
    { id: "p3", x: 6800, y: 8000 },
    { id: "p4", x: 7400, y: 8000 },
  ],
}));
assert.equal(Math.round(largeCloseP1.bases.team1.hardRadius), 372);
assert.equal(largeCloseP1.bases.team1.limitingFactor, "objective-distance");

const shortSpacing = calculatePressureZones(baseInput({
  objectiveChain: [
    { id: "p1", x: 1000, y: 0 },
    { id: "p2", x: 1200, y: 0 },
    { id: "p3", x: 2800, y: 4000 },
    { id: "p4", x: 3000, y: 4000 },
  ],
}));
const longSpacing = calculatePressureZones(baseInput({
  objectiveChain: [
    { id: "p1", x: 1000, y: 0 },
    { id: "p2", x: 2500, y: 0 },
    { id: "p3", x: 1500, y: 4000 },
    { id: "p4", x: 3000, y: 4000 },
  ],
}));
assert.ok(shortSpacing.bases.team1.formula.softExtension <= longSpacing.bases.team1.formula.softExtension);
assert.equal(shortSpacing.bases.team1.formula.softExtension, 100);
assert.equal(longSpacing.bases.team1.formula.softExtension, 300);

const closeCombat = calculatePressureZones(baseInput({
  objectiveChain: [
    { id: "p1", x: 800, y: 0 },
    { id: "p2", x: 1900, y: 2000 },
    { id: "p3", x: 1950, y: 2050 },
    { id: "p4", x: 3200, y: 4000 },
  ],
}));
assert.equal(closeCombat.combat.longitudinalRadius, 250);

const farCombat = calculatePressureZones(baseInput({
  mapBounds: { minX: 0, minY: 0, maxX: 8000, maxY: 8000 },
  mains: [{ teamId: 1, x: 0, y: 0 }, { teamId: 2, x: 8000, y: 8000 }],
  objectiveChain: [
    { id: "p1", x: 500, y: 0 },
    { id: "p2", x: 1000, y: 1000 },
    { id: "p3", x: 7000, y: 7000 },
    { id: "p4", x: 7500, y: 8000 },
  ],
}));
assert.equal(farCombat.combat.longitudinalRadius, 900);
assert.equal(farCombat.combat.limitingFactor, "maximum-radius");

const hotspotCentered = calculatePressureZones(baseInput({
  hotspot: { x: 2500, y: 1500, playerCount: 24 },
}));
assert.deepEqual(hotspotCentered.hotspot.center, { x: 2500, y: 1500 });
assert.equal(hotspotCentered.hotspot.radiusMeters, 1000);
assert.equal(hotspotCentered.hotspot.playerCount, 24);
assert.equal(hotspotCentered.combat.positionSource, "live-hotspot");
assert.deepEqual(hotspotCentered.combat.center, { x: 2500, y: 1500 });
assert.equal((hotspotCentered.combat.pointA.x + hotspotCentered.combat.pointB.x) / 2, 2500);
assert.equal((hotspotCentered.combat.pointA.y + hotspotCentered.combat.pointB.y) / 2, 1500);

const smallHotspot = calculatePressureZones(baseInput({
  mapBounds: { minX: 0, minY: 0, maxX: 2000, maxY: 2000 },
  hotspot: { x: 1000, y: 1000, playerCount: 8 },
}));
const largeHotspot = calculatePressureZones(baseInput({
  mapBounds: { minX: 0, minY: 0, maxX: 8000, maxY: 8000 },
  hotspot: { x: 4000, y: 4000, playerCount: 80 },
}));
assert.equal(smallHotspot.hotspot.radiusMeters, 500);
assert.equal(largeHotspot.hotspot.radiusMeters, 1600);

const overlap = calculatePressureZones(baseInput({
  objectiveChain: [
    { id: "p1", x: 350, y: 0 },
    { id: "p2", x: 450, y: 0 },
    { id: "p3", x: 550, y: 0 },
    { id: "p4", x: 3000, y: 4000 },
  ],
}));
assert.equal(classifyPoint({ x: 450, y: 0 }, overlap.zones).type, "combat");
assert.equal(classifyPoint({ x: 0, y: 0 }, overlap.zones).type, "hard");

const centimeters = calculatePressureZones({
  ...baseInput(),
  mapBounds: { minX: 0, minY: 0, maxX: 400000, maxY: 400000 },
  mains: [{ teamId: 1, x: 0, y: 0 }, { teamId: 2, x: 400000, y: 400000 }],
  objectiveChain: baseInput().objectiveChain.map((item) => ({ ...item, x: item.x * 100, y: item.y * 100 })),
});
assert.equal(centimeters.map.widthMeters, 4000);
assert.equal(centimeters.map.worldUnitsPerMeter, 100);
assert.equal(calculatePressureZones(baseInput({ mode: "Invasion" })).active, false);

const migrated = mergePressureZoneConfig({
  referenceDiagonalMeters: 5600,
  minMapScale: 0.7,
  maxMapScale: 1.4,
  coordinateScaleMeters: 0.01,
  hard: { mapFactor: 0.4, nearestObjectiveFactor: 1.1, minRadiusMeters: 350, maxRadiusMeters: 1000 },
  combat: { gapFactor: 0.9, lateralFactor: 1.4, polygonArcSegments: 24 },
});
assert.equal(migrated.schemaVersion, 2);
assert.ok(Math.abs(migrated.referenceMapSizeMeters - (5600 / Math.SQRT2)) < 0.001);
assert.equal(migrated.combat.gapFactor, 0.30);
assert.equal(migrated.combat.lateralFactor, 1.4);
assert.equal(migrated.hard.minRadiusMeters, 350);

const normalized = normalizeBaseConfig({
  schemaVersion: 2,
  referenceMapSizeMeters: 5000,
  mapScaleInfluence: 0.5,
  hard: { maxBaseToFirstObjectiveRatio: 0.55 },
  combat: { gapFactor: 0.25 },
});
assert.equal(normalized.referenceMapSizeMeters, 5000);
assert.equal(normalized.hard.maxBaseToFirstObjectiveRatio, 0.55);
assert.equal(normalized.combat.gapFactor, 0.25);
assert.equal(normalized.hotspot.referenceRadiusMeters, 1000);
assert.throws(() => normalizeBaseConfig({ schemaVersion: 2, minMapScale: 2, maxMapScale: 1 }), /cannot exceed/);
assert.throws(() => normalizeBaseConfig({ schemaVersion: 2, hard: { emergencyMinimumRadiusMeters: 500, minRadiusMeters: 300 } }), /cannot exceed/);

const liveSnapshot = {
  server: { map: "Al Basrah", layer: "AlBasrah_RAAS_v1", mode: "RAAS" },
  match: {},
  players: [
    { identity: { key: "p1" }, telemetry: { position: { x: -60000, y: -40000 }, health: 100, inactive: false, onVehicle: false } },
    { identity: { key: "p2" }, telemetry: { position: { x: -20000, y: 0 }, health: 75, inactive: false, onVehicle: false } },
    { identity: { key: "dead" }, telemetry: { position: { x: 60000, y: 60000 }, health: 0, inactive: false, onVehicle: false } },
  ],
  assets: {
    mainZones: [
      { teamId: 1, position: { x: -130000, y: -130000 } },
      { teamId: 2, position: { x: 70000, y: 70000 } },
    ],
    captureZones: [
      { name: "01-AlKhora", ownerTeamId: 1, position: { x: -120000, y: -120000 } },
      { name: "03-Courtyard", ownerTeamId: 1, position: { x: -50000, y: -50000 } },
      { name: "05-Mosque", ownerTeamId: 2, position: { x: -10000, y: 20000 } },
      { name: "07-IslandSuburbs", ownerTeamId: 2, position: { x: 60000, y: 60000 } },
    ],
  },
};

let tacticalListener = null;
const tacticalState = {
  subscribe(listener) { tacticalListener = listener; return () => { tacticalListener = null; }; },
  async getSnapshot() { return liveSnapshot; },
};

const testDataDir = await mkdtemp(path.join(tmpdir(), "bzss-dynamic-pressure-zone-v2-"));
const module = createDynamicPressureZoneModule({
  core: { logger: { warn() {} }, createLogger() { return this.logger; } },
  modules: { tacticalState },
  config: { get(key, fallback) { return key === "modules.dynamicPressureZone" ? { dataDir: testDataDir } : fallback; } },
  logger: { warn() {} },
});

let publishCount = 0;
module.api.subscribe(() => { publishCount += 1; });
await module.init();
await module.start();
assert.equal(publishCount, 1);
assert.deepEqual(module.api.getState().hotspot.center, { x: -40000, y: -20000 });
assert.equal(module.api.getState().hotspot.playerCount, 2);
assert.equal(module.api.getState().combat.positionSource, "live-hotspot");

const defaultBaseConfig = module.api.getBaseConfig();
assert.equal(defaultBaseConfig.config.schemaVersion, 2);
assert.equal(defaultBaseConfig.config.referenceMapSizeMeters, 4000);
assert.equal(defaultBaseConfig.config.combat.gapFactor, 0.30);

const updatedConfig = structuredClone(defaultBaseConfig.config);
updatedConfig.mapScaleInfluence = 0.4;
updatedConfig.hard.maxBaseToFirstObjectiveRatio = 0.55;
updatedConfig.combat.gapFactor = 0.25;

let routeResponse = null;
const routeContext = {
  core: { authManager: { hasPermission: () => true } },
  module: module.api,
  user: { id: "pressure-zone-v2-test-admin" },
  readJsonBody: async () => updatedConfig,
  json: (status, body) => { routeResponse = { status, body }; },
};

assert.equal(await handleDynamicPressureZoneRoutes({
  ...routeContext,
  url: new URL("http://localhost/api/dynamic-pressure-zone/base-config"),
  req: { method: "PUT" },
}), true);
assert.equal(routeResponse.status, 200);
assert.equal(module.api.getBaseConfig().config.hard.maxBaseToFirstObjectiveRatio, 0.55);
assert.equal(module.api.getBaseConfig().config.combat.gapFactor, 0.25);
assert.equal(publishCount, 2);

const persistedConfig = JSON.parse(await readFile(path.join(testDataDir, "base-config.json"), "utf8"));
assert.equal(persistedConfig.schemaVersion, 2);
assert.equal(persistedConfig.mapScaleInfluence, 0.4);
assert.equal(persistedConfig.hard.maxBaseToFirstObjectiveRatio, 0.55);
assert.equal(persistedConfig.combat.gapFactor, 0.25);
assert.equal(module.api.simulate(baseInput()).diagnostics.config.combat.gapFactor, 0.25);

await module.stop();
await rm(testDataDir, { recursive: true, force: true });

console.log("Dynamic pressure zone V2 tests passed.");
