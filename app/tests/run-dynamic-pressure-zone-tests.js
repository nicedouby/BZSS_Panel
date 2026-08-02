// -*- coding: utf-8 -*-

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeBaseConfig } from "../modules/dynamic-pressure-zone/base-config-store.js";
import { calculatePressureZones } from "../modules/dynamic-pressure-zone/engine.js";
import { classifyPoint } from "../modules/dynamic-pressure-zone/geometry.js";
import { createDynamicPressureZoneModule } from "../modules/dynamic-pressure-zone/index.js";
import { handleDynamicPressureZoneRoutes } from "../modules/dynamic-pressure-zone/routes.js";

function baseInput(overrides = {}) {
  return {
    mode: "RAAS",
    mapBounds: { minX: 0, minY: 0, maxX: 4000, maxY: 4000 },
    mains: [{ teamId: 1, x: 200, y: 200 }, { teamId: 2, x: 3800, y: 3800 }],
    objectiveChain: [
      { id: "p1", x: 700, y: 650 },
      { id: "p2", x: 1600, y: 1450 },
      { id: "p3", x: 2400, y: 2550 },
      { id: "p4", x: 3300, y: 3350 },
    ],
    objectiveState: { p1: 1, p2: 1, p3: 2, p4: 2 },
    ...overrides,
  };
}

// 1. Normal straight chain.
const straight = calculatePressureZones(baseInput());
assert.equal(straight.active, true);
assert.equal(straight.combat.team1ObjectiveId, "p2");
assert.equal(straight.combat.team2ObjectiveId, "p3");

// 2. Foldback objective: topology is preserved while nearest distance is spatial.
const foldback = calculatePressureZones(baseInput({
  objectiveChain: [
    { id: "p1", x: 900, y: 900 },
    { id: "p2", x: 1700, y: 1600 },
    { id: "p3", x: 450, y: 450 },
    { id: "p4", x: 3300, y: 3300 },
  ],
}));
assert.equal(foldback.bases.team1.nearestObjectiveId, "p3");
assert.equal(foldback.combat.team1ObjectiveId, "p2");
assert.equal(foldback.combat.team2ObjectiveId, "p3");

// 3. Very close combat objectives clamp to the minimum radius.
const close = calculatePressureZones(baseInput({
  objectiveChain: [{ id: "p1", x: 800, y: 800 }, { id: "p2", x: 2000, y: 2000 }, { id: "p3", x: 2050, y: 2050 }, { id: "p4", x: 3200, y: 3200 }],
}));
assert.equal(close.combat.longitudinalRadius, 450);

// 4. Very distant combat objectives clamp to the maximum radius.
const far = calculatePressureZones(baseInput({
  mapBounds: { minX: 0, minY: 0, maxX: 8000, maxY: 8000 },
  mains: [{ teamId: 1, x: 100, y: 100 }, { teamId: 2, x: 7900, y: 7900 }],
  objectiveChain: [{ id: "p1", x: 500, y: 500 }, { id: "p2", x: 1200, y: 1200 }, { id: "p3", x: 6800, y: 6800 }, { id: "p4", x: 7500, y: 7500 }],
}));
assert.equal(far.combat.longitudinalRadius, 1600);

// 5/6. Map size changes the scale modifier.
const small = calculatePressureZones(baseInput({ mapBounds: { minX: 0, minY: 0, maxX: 2000, maxY: 2000 } }));
const large = calculatePressureZones(baseInput({ mapBounds: { minX: 0, minY: 0, maxX: 8000, maxY: 8000 } }));
assert.equal(small.map.scaleFactor, 0.75);
assert.equal(large.map.scaleFactor, 1.3);

// 7. Combat wins over Soft where both contain the point.
const overlapInput = baseInput({
  mains: [{ teamId: 1, x: 200, y: 200 }, { teamId: 2, x: 3800, y: 3800 }],
  objectiveChain: [{ id: "p1", x: 500, y: 200 }, { id: "p2", x: 600, y: 200 }, { id: "p3", x: 700, y: 200 }, { id: "p4", x: 3200, y: 3200 }],
});
const overlap = calculatePressureZones(overlapInput);
assert.equal(classifyPoint({ x: 600, y: 200 }, overlap.zones).type, "combat");

// 8. Hard always wins over Combat.
assert.equal(classifyPoint({ x: 200, y: 200 }, overlap.zones).type, "hard");
assert.deepEqual(overlap.combat.hardExclusionZoneIds, ["team1-hard", "team2-hard"]);

// 9. A folded RAAS chain remains in declared topology order.
assert.deepEqual(foldback.diagnostics.ownership.map((item) => item.id), ["p1", "p2", "p3", "p4"]);

// 10. Unsupported modes are inactive.
assert.equal(calculatePressureZones(baseInput({ mode: "Invasion" })).active, false);

// UE centimeter coordinates are converted to meters without altering geometry coordinates.
const centimeters = calculatePressureZones(baseInput({
  mapBounds: { minX: 0, minY: 0, maxX: 400000, maxY: 400000 },
  mains: [{ teamId: 1, x: 20000, y: 20000 }, { teamId: 2, x: 380000, y: 380000 }],
  objectiveChain: baseInput().objectiveChain.map((item) => ({ ...item, x: item.x * 100, y: item.y * 100 })),
}));
assert.equal(centimeters.map.widthMeters, 4000);
assert.equal(centimeters.map.worldUnitsPerMeter, 100);

// Every base-size control is effective: contributions are additive and zero
// remains a valid configured value instead of falling back to defaults.
const influenceConfig = {
  baseRadiusMultiplier: 1,
  hard: {
    mapFactor: 0,
    nearestObjectiveFactor: 0,
    minRadiusMeters: 0,
    maxRadiusMeters: 5000,
    frontSafetyMarginMeters: 0,
  },
  soft: {
    mapFactor: 0,
    nearestObjectiveFactor: 0,
    minExtraOverHardMeters: 0,
    maxRadiusMeters: 5000,
    frontSafetyMarginMeters: 0,
  },
};
const zeroContribution = calculatePressureZones(baseInput({ config: influenceConfig }));
assert.equal(zeroContribution.bases.team1.hardRadius, 0);
assert.equal(zeroContribution.bases.team1.softRadius, 0);
const mapContribution = calculatePressureZones(baseInput({ config: { ...influenceConfig, hard: { ...influenceConfig.hard, mapFactor: 0.1 } } }));
const objectiveContribution = calculatePressureZones(baseInput({ config: { ...influenceConfig, hard: { ...influenceConfig.hard, nearestObjectiveFactor: 0.5 } } }));
const multipliedContribution = calculatePressureZones(baseInput({ config: { ...influenceConfig, baseRadiusMultiplier: 2, hard: { ...influenceConfig.hard, mapFactor: 0.1 } } }));
assert.ok(mapContribution.bases.team1.hardRadius > zeroContribution.bases.team1.hardRadius);
assert.ok(objectiveContribution.bases.team1.hardRadius > zeroContribution.bases.team1.hardRadius);
assert.equal(multipliedContribution.bases.team1.hardRadius, mapContribution.bases.team1.hardRadius * 2);
assert.ok(straight.bases.team1.hardRadius > 700);
assert.ok(straight.bases.team1.softRadius > 1200);

// Tactical player ticks do not trigger recalculation; ownership changes do.
const liveSnapshot = {
  server: { map: "Al Basrah", layer: "AlBasrah_RAAS_v1", mode: "RAAS" },
  match: {},
  players: [],
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
const testDataDir = await mkdtemp(path.join(tmpdir(), "bzss-dynamic-pressure-zone-"));
const module = createDynamicPressureZoneModule({
  core: { logger: { warn() {} }, createLogger() { return this.logger; } },
  modules: { tacticalState },
  config: { get(key, fallback) { return key === "modules.dynamicPressureZone" ? { dataDir: testDataDir } : fallback; } },
  logger: { warn() {} },
});
let livePublishCount = 0;
module.api.subscribe(() => { livePublishCount += 1; });
await module.init();
await module.start();
assert.equal(livePublishCount, 1);
tacticalListener?.({ ...liveSnapshot, players: [{ identity: { name: "Player Tick" } }] });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(livePublishCount, 1);
const ownershipChanged = structuredClone(liveSnapshot);
ownershipChanged.assets.captureZones[1].ownerTeamId = 2;
tacticalListener?.(ownershipChanged);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(livePublishCount, 2);

// Base settings persist, validate, and immediately affect simulations and live state.
const defaultBaseConfig = module.api.getBaseConfig();
assert.equal(defaultBaseConfig.config.combat.gapFactor, 0.6);
assert.equal(defaultBaseConfig.config.baseRadiusMultiplier, 1.15);
const updatedConfig = structuredClone(defaultBaseConfig.config);
updatedConfig.combat.gapFactor = 0.9;
let routeResponse = null;
const routeContext = {
  core: { authManager: { hasPermission: () => true } },
  module: module.api,
  user: { id: "pressure-zone-test-admin" },
  readJsonBody: async () => updatedConfig,
  json: (status, body) => { routeResponse = { status, body }; },
};
assert.equal(await handleDynamicPressureZoneRoutes({ ...routeContext, url: new URL("http://localhost/api/dynamic-pressure-zone/base-config"), req: { method: "GET" } }), true);
assert.equal(routeResponse.status, 200);
assert.equal(routeResponse.body.config.combat.gapFactor, 0.6);
assert.equal(await handleDynamicPressureZoneRoutes({ ...routeContext, url: new URL("http://localhost/api/dynamic-pressure-zone/base-config"), req: { method: "PUT" } }), true);
assert.equal(routeResponse.status, 200);
assert.equal(module.api.getBaseConfig().config.combat.gapFactor, 0.9);
assert.equal(livePublishCount, 3);
const persistedConfig = JSON.parse(await readFile(path.join(testDataDir, "base-config.json"), "utf8"));
assert.equal(persistedConfig.combat.gapFactor, 0.9);
assert.equal(module.api.simulate(baseInput()).diagnostics.config.combat.gapFactor, 0.9);
assert.throws(() => normalizeBaseConfig({ minMapScale: 2, maxMapScale: 1 }), /cannot exceed/);
assert.throws(() => normalizeBaseConfig({ combat: { polygonArcSegments: 2 } }), /between 6 and 128/);
await module.stop();
await rm(testDataDir, { recursive: true, force: true });

console.log("Dynamic pressure zone tests passed.");
