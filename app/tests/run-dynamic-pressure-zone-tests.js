// -*- coding: utf-8 -*-

import assert from "node:assert/strict";
import { calculatePressureZones } from "../modules/dynamic-pressure-zone/engine.js";
import { classifyPoint } from "../modules/dynamic-pressure-zone/geometry.js";
import { createDynamicPressureZoneModule } from "../modules/dynamic-pressure-zone/index.js";

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
assert.equal(classifyPoint({ x: 520, y: 200 }, overlap.zones).type, "combat");

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
const module = createDynamicPressureZoneModule({
  core: { logger: { warn() {} }, createLogger() { return this.logger; } },
  modules: { tacticalState },
  config: { get(key, fallback) { return key === "modules.dynamicPressureZone" ? { dataDir: "/tmp/bzss-dynamic-pressure-zone-tests" } : fallback; } },
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
await module.stop();

console.log("Dynamic pressure zone tests passed.");
