import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createBzssCoreMonitorModule } from "../modules/bzss-core-monitor/index.js";
import { createStepCalculator } from "../modules/step-counter/calculator.js";
import { createStepCounterModule, getStepRoundKey } from "../modules/step-counter/index.js";
import { createStepStorage } from "../modules/step-counter/storage.js";

const steamID = "76561198000000000";
const baseTime = Date.parse("2026-07-31T00:00:00.000Z");

testCalculatorTelemetrySamples();
testCalculatorFiltersAndBaselines();
testBzssCoreChunkMetadata();
await testStorageRecoveryAndMonotonicTotals();
await testOnlyConfirmedRoundEventsResetMatchCounters();
console.log("step-counter tests passed");

function testCalculatorTelemetrySamples() {
  const calculator = createStepCalculator();

  assert.equal(calculator.observe(makePlayer({ x: 0, ms: 0, tick: 100, seq: 1 })).reason, "warmingUp");
  const duplicateA = calculator.observe(makePlayer({ x: 0, ms: 0, tick: 100, seq: 1 }));
  const duplicateB = calculator.observe(makePlayer({ x: 0, ms: 0, tick: 100, seq: 1 }));
  assert.equal(duplicateA.reason, "duplicateTelemetry");
  assert.equal(duplicateB.reason, "duplicateTelemetry");

  const moving = calculator.observe(makePlayer({ x: 200, ms: 500, tick: 101, seq: 2 }));
  assert.equal(moving.valid, true);
  assert.ok(Math.abs(moving.speedMps - 4) < 0.001);
  assert.ok(Math.abs(moving.distanceMeters - 2) < 0.001);

  const movingAgain = calculator.observe(makePlayer({ x: 400, ms: 1000, tick: 102, seq: 3 }));
  assert.equal(movingAgain.valid, true);
  assert.ok(Math.abs(movingAgain.speedMps - 4) < 0.001);

  const stationary = calculator.observe(makePlayer({ x: 400, ms: 1500, tick: 103, seq: 4 }));
  assert.equal(stationary.reason, "stationary");
  assert.equal(stationary.speedMps, 0);
  assert.equal(stationary.steps, 0);

  calculator.resetAll();
  assert.equal(calculator.observe(makePlayer({ x: 0, z: 0, ms: 0, tick: 1, seq: 1 })).reason, "warmingUp");
  const verticalOnly = calculator.observe(makePlayer({ x: 0, z: 500, ms: 500, tick: 2, seq: 2 }));
  assert.equal(verticalOnly.reason, "stationary");
  assert.equal(verticalOnly.distanceMeters, 0);

  calculator.resetAll();
  let validCount = 0;
  for (let index = 0; index <= 60; index += 1) {
    const sample = calculator.observe(makePlayer({
      x: index * 250,
      ms: index * 500,
      tick: index,
      seq: index,
    }));
    if (sample.valid) validCount += 1;
  }
  assert.equal(validCount, 60);
}

function testCalculatorFiltersAndBaselines() {
  const calculator = createStepCalculator();

  const missingTimestamp = makePlayer({ x: 0, ms: 0, tick: 1, seq: 1 });
  delete missingTimestamp.telemetry.observedAt;
  delete missingTimestamp.freshness.bzssCoreUpdatedAt;
  assert.equal(calculator.observe(missingTimestamp).reason, "missingTelemetryTimestamp");

  assert.equal(calculator.observe(makePlayer({ x: 0, ms: 0, tick: 1, seq: 1 })).reason, "warmingUp");
  const teleport = calculator.observe(makePlayer({ x: 10_000, ms: 500, tick: 2, seq: 2 }));
  assert.equal(teleport.reason, "teleportOrRespawn");
  assert.equal(teleport.steps, 0);
  const recoveredAfterTeleport = calculator.observe(makePlayer({ x: 10_200, ms: 1000, tick: 3, seq: 3 }));
  assert.equal(recoveredAfterTeleport.valid, true);
  assert.ok(Math.abs(recoveredAfterTeleport.speedMps - 4) < 0.001);

  calculator.resetAll();
  assert.equal(calculator.observe(makePlayer({ x: 0, ms: 0, tick: 1, seq: 1 })).reason, "warmingUp");
  const stale = calculator.observe(makePlayer({ x: 800, ms: 8000, tick: 2, seq: 2 }));
  assert.equal(stale.reason, "staleTelemetry");
  assert.equal(stale.steps, 0);
  const recoveredAfterStale = calculator.observe(makePlayer({ x: 1000, ms: 8500, tick: 3, seq: 3 }));
  assert.equal(recoveredAfterStale.valid, true);

  calculator.resetAll();
  assert.equal(calculator.observe(makePlayer({ x: 0, ms: 0, tick: 1, seq: 1 })).reason, "warmingUp");
  const inVehicle = calculator.observe(makePlayer({ x: 1000, ms: 500, tick: 2, seq: 2, onVehicle: true }));
  assert.equal(inVehicle.reason, "onVehicle");
  assert.equal(inVehicle.steps, 0);

  calculator.resetAll();
  assert.equal(calculator.observe(makePlayer({ x: 0, ms: 0, tick: 1, seq: 1, vehicleSeatIndex: -1 })).reason, "warmingUp");
  const seated = calculator.observe(makePlayer({ x: 1000, ms: 500, tick: 2, seq: 2, vehicleSeatIndex: 0 }));
  assert.equal(seated.reason, "onVehicle");
  assert.equal(seated.steps, 0);
  const afterVehicle = calculator.observe(makePlayer({ x: 1200, ms: 1000, tick: 3, seq: 3 }));
  assert.equal(afterVehicle.valid, true);

  calculator.resetAll();
  assert.equal(calculator.observe(makePlayer({ x: 0, ms: 0, tick: 1, seq: 1 })).reason, "warmingUp");
  const inactive = makePlayer({ x: 0, ms: 500, tick: 2, seq: 2 });
  inactive.presence.state = "noPawn";
  assert.equal(calculator.observe(inactive).reason, "inactive");
  assert.equal(calculator.observe(makePlayer({ x: 50_000, ms: 1000, tick: 3, seq: 3 })).reason, "warmingUp");
}

function testBzssCoreChunkMetadata() {
  const monitor = createBzssCoreMonitorModule({
    core: {
      logger: { info() {}, warn() {} },
      eventBus: { emitModuleEvent() {} },
      webStatus: {},
    },
    modules: {},
    config: { get: (_key, fallback) => fallback },
  });
  const ingested = monitor.api.ingestPlayerChunk({
    version: "v1",
    seq: "42",
    tick: "9001",
    players: [{
      playerId: 7,
      playerName: "Telemetry Tester",
      position: { x: 100, y: 200, z: 300 },
    }],
  }, "");

  assert.equal(ingested.ok, true);
  const player = monitor.api.getRuntimePlayers()[0];
  assert.equal(player.sourceSeq, "42");
  assert.equal(player.sourceTick, "9001");
  assert.ok(Date.parse(player.observedAt) > 0);
  const diagnostics = monitor.api.getState().playerChunkDiagnostics;
  assert.equal(diagnostics.lastSeq, "42");
  assert.equal(diagnostics.lastTick, "9001");
  assert.equal(diagnostics.totalChunks, 1);
  assert.equal(diagnostics.tickAdvance, null);
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

    // Compose timestamps alone are not accepted as movement timestamps.
    snapshotListener(makeSnapshot({ x: 0, ms: null, tick: null, seq: null, layer: "Layer_A" }));
    assert.equal(module.api.getPlayer(steamID).lastReason, "missingTelemetryTimestamp");

    snapshotListener(makeSnapshot({ x: 0, ms: 0, tick: 100, seq: 1, layer: "Layer_A" }));
    snapshotListener(makeSnapshot({ x: 0, ms: 0, tick: 100, seq: 1, layer: "Layer_A" }));
    snapshotListener(makeSnapshot({ x: 100, ms: 1000, tick: 101, seq: 2, layer: "Layer_A" }));
    const beforeTransientChange = module.api.getPlayer(steamID);
    assert.ok(beforeTransientChange.matchSteps > 0);
    assert.equal(beforeTransientChange.currentStatus, "VALID");

    // Missing/changing map metadata is no longer treated as a round change.
    snapshotListener(makeSnapshot({ x: 200, ms: 2000, tick: 102, seq: 3, layer: "" }));
    const afterTransientChange = module.api.getPlayer(steamID);
    assert.ok(afterTransientChange.matchSteps > beforeTransientChange.matchSteps);

    const stats = module.api.getStats();
    assert.equal(stats.sampleDiagnostics.duplicateSamples, 1);
    assert.ok(stats.sampleDiagnostics.validSamples >= 2);

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

function makePlayer({ x, y = 0, z = 0, ms, tick, seq, onVehicle = false, vehicleSeatIndex = null }) {
  const observedAt = ms == null ? "" : new Date(baseTime + ms).toISOString();
  return {
    identity: { steamID, name: "Tester" },
    presence: { online: true, state: "online" },
    telemetry: {
      position: { x, y, z },
      sourceTick: tick,
      sourceSeq: seq,
      observedAt,
      onVehicle,
      vehicleSeatIndex,
    },
    freshness: { bzssCoreUpdatedAt: observedAt },
    vehicle: { vehicleType: "" },
  };
}

function makeSnapshot({ x, ms, tick, seq, layer }) {
  return {
    meta: { generatedAt: new Date(baseTime + (ms ?? 0)).toISOString() },
    server: { serverId: "server", map: "Map", layer },
    match: { map: "Map", layer },
    players: [makePlayer({ x, ms, tick, seq })],
  };
}
