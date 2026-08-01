import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createStepCalculator } from "../modules/step-counter/calculator.js";
import { createStepCounterModule, getStepRoundKey } from "../modules/step-counter/index.js";
import { createStepStorage } from "../modules/step-counter/storage.js";

const steamID = "76561198000000000";

testCalculator();
await testStorageRecoveryAndMonotonicTotals();
await testOnlyConfirmedRoundEventsResetMatchCounters();
console.log("step-counter tests passed");

function testCalculator() {
  const calculator = createStepCalculator();
  const player = makePlayer(0);
  assert.equal(calculator.observe(player, "2026-07-31T00:00:00.000Z").valid, false);
  player.telemetry.position.x = 100;
  const result = calculator.observe(player, "2026-07-31T00:00:01.000Z");
  assert.equal(result.valid, true);
  assert.equal(Math.round(result.distanceMeters * 10), 10);
  assert.ok(result.steps > 0);
  calculator.resetAll();
  assert.equal(calculator.observe(player, "2026-07-31T00:00:02.000Z").reason, "warmingUp");
}

async function testStorageRecoveryAndMonotonicTotals() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-step-storage-"));
  try {
    const storage = createStepStorage({ dataDir });
    await storage.init();
    storage.upsert(steamID, { totalSteps: 100, totalDistanceMeters: 80, matchSteps: 50 });
    storage.upsert(steamID, { totalSteps: 0, totalDistanceMeters: 0 });
    assert.equal(storage.getPlayer(steamID).totalSteps, 100);
    assert.equal(storage.getPlayer(steamID).totalDistanceMeters, 80);
    await storage.flush();

    storage.upsert(steamID, { totalSteps: 150 });
    const inFlight = storage.flush();
    await Promise.resolve();
    storage.upsert(steamID, { totalSteps: 160 });
    await inFlight;
    await storage.flush();

    await fs.writeFile(path.join(dataDir, "stats.json"), "{broken", "utf8");
    const restored = createStepStorage({ dataDir });
    await restored.init();
    assert.equal(restored.getPlayer(steamID).totalSteps, 160);
    await restored.flush();
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

async function testOnlyConfirmedRoundEventsResetMatchCounters() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-step-module-"));
  let snapshotListener = null;
  let roundListener = null;
  const currentRound = { dedupeKey: "server:round-a" };
  const core = {
    logger: { info() {}, warn() {} },
    webRegistry: { registerPage() {} },
    eventBus: {
      onModuleEvent(moduleId, eventName, listener) {
        if (moduleId === "module.matchState" && eventName === "roundUpdated") roundListener = listener;
        return () => { roundListener = null; };
      },
    },
  };
  const modules = {
    matchState: { getState: () => ({ round: { current: currentRound } }) },
    tacticalState: {
      subscribe(listener) {
        snapshotListener = listener;
        return () => { snapshotListener = null; };
      },
    },
  };
  const config = { get: (key, fallback) => key === "modules.stepCounter" ? { dataDir } : fallback };
  const module = createStepCounterModule({ core, modules, config });

  try {
    await module.init();
    await module.start();
    assert.equal(typeof snapshotListener, "function");
    assert.equal(typeof roundListener, "function");
    assert.equal(getStepRoundKey({ record: currentRound }), "server:round-a");

    snapshotListener(makeSnapshot(0, "2026-07-31T00:00:00.000Z", "Layer_A"));
    snapshotListener(makeSnapshot(100, "2026-07-31T00:00:01.000Z", "Layer_A"));
    const beforeTransientChange = module.api.getPlayer(steamID);
    assert.ok(beforeTransientChange.matchSteps > 0);

    // Missing/changing map metadata is no longer treated as a round change.
    snapshotListener(makeSnapshot(200, "2026-07-31T00:00:02.000Z", ""));
    const afterTransientChange = module.api.getPlayer(steamID);
    assert.ok(afterTransientChange.matchSteps > beforeTransientChange.matchSteps);

    roundListener({ record: { dedupeKey: "server:round-a" } });
    assert.equal(module.api.getPlayer(steamID).matchSteps, afterTransientChange.matchSteps);

    roundListener({ record: { dedupeKey: "server:round-b" } });
    const afterConfirmedRound = module.api.getPlayer(steamID);
    assert.equal(afterConfirmedRound.matchSteps, 0);
    assert.equal(afterConfirmedRound.matchDistanceMeters, 0);
    assert.equal(afterConfirmedRound.totalSteps, afterTransientChange.totalSteps);
    assert.equal(afterConfirmedRound.matches, 1);
  } finally {
    await module.stop();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

function makePlayer(x) {
  return {
    identity: { steamID, name: "Tester" },
    presence: { online: true, state: "online" },
    telemetry: { position: { x, y: 0, z: 0 } },
    vehicle: { vehicleType: "" },
  };
}

function makeSnapshot(x, generatedAt, layer) {
  return {
    meta: { generatedAt },
    server: { serverId: "server", map: "Map", layer },
    match: { map: "Map", layer },
    players: [makePlayer(x)],
  };
}
