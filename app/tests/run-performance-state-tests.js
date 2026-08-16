import assert from "node:assert/strict";
import { RuntimeState } from "../core/runtime-state.js";
import { PerformanceMonitor } from "../core/performance-monitor.js";
import { ConfigManager } from "../core/config-manager.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function createTempConfig(content) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-perf-test-"));
  const configPath = path.join(tempDir, "config.json");
  await fs.writeFile(configPath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
  return { tempDir, configPath };
}

async function testPerformanceMonitor() {
  const { tempDir, configPath } = await createTempConfig({
    performance: {
      enabled: true,
      sampleIntervalMs: 100,
      logIntervalMs: 500,
      maxHistoryPoints: 5,
    },
  });

  const config = new ConfigManager(configPath);
  await config.load();

  const logs = [];
  const mockLogger = {
    info(msg) { logs.push(msg); },
    warn(msg) { logs.push(msg); },
    error(msg) { logs.push(msg); },
  };

  const monitor = new PerformanceMonitor({ config, logger: mockLogger });
  monitor.start();

  // Wait to allow a meaningful utilization delta, then force a second sample.
  await new Promise((resolve) => setTimeout(resolve, 350));
  monitor.sample();
  monitor.stop();

  const snapshot = monitor.getSnapshot();
  assert.ok(snapshot.history.length > 0, "Should have collected history points");
  assert.ok(snapshot.history.length <= 5, "Should not exceed max history points");
  assert.ok(snapshot.latest, "Should have latest snapshot");
  assert.ok(snapshot.latest.memory.rss > 0, "RSS should be positive");
  assert.ok(snapshot.latest.eventLoop, "Should have eventLoop latency stats");
  assert.ok(Number.isFinite(snapshot.latest.eventLoop.utilization), "Should expose event loop utilization");
  assert.ok(snapshot.latest.eventLoop.utilization >= 0 && snapshot.latest.eventLoop.utilization <= 1, "Event loop utilization should be a ratio");
  assert.ok(Number.isFinite(snapshot.latest.eventLoop.utilizationPercent), "Should expose event loop utilization percent");
  assert.ok(Number.isFinite(snapshot.latest.eventLoop.activeMs), "Should expose active event loop time");
  assert.ok(Number.isFinite(snapshot.latest.eventLoop.idleMs), "Should expose idle event loop time");

  monitor.recordOperation("eventBus:On_BzssCorePlayerChunk", 18.5);
  monitor.recordOperation("eventBus:On_BzssCorePlayerChunk", 6.5);
  const operation = monitor.getSnapshot().operations.find((item) => item.name === "eventBus:On_BzssCorePlayerChunk");
  assert.equal(operation?.count, 2, "Should aggregate slow operation samples");
  assert.equal(operation?.maxDurationMs, 18.5, "Should retain the operation peak duration");

  await fs.rm(tempDir, { recursive: true, force: true });
  console.log("  - PerformanceMonitor tests passed");
}

async function testRuntimeStateSlimming() {
  const { tempDir, configPath } = await createTempConfig({
    runtimeState: {
      eventHistory: {
        raw: 5,
        rcon: 5,
        round: 2,
        combat: 10,
      },
      includeEventsInAllSnapshot: false,
    },
  });

  const config = new ConfigManager(configPath);
  await config.load();

  const state = new RuntimeState({ config });
  
  // Verify limits parsed correctly
  assert.equal(state.limits.raw, 5);
  assert.equal(state.limits.round, 2);

  // Test event record with large player array
  const mockEvent = {
    eventName: "RCON_LIST_PLAYERS_UPDATED",
    players: [
      { name: "Player1", steamID: "123", teamID: 1 },
      { name: "Player2", steamID: "456", teamID: 2 },
    ],
  };

  state.recordEvent("raw", mockEvent);
  
  const rawEvents = state.getEvents().raw;
  assert.equal(rawEvents.length, 1);
  assert.ok(!rawEvents[0].players, "Event in history should not contain player list");
  assert.equal(rawEvents[0].playerCount, 2, "Event in history should store player count");

  // Record more events than limits
  state.recordEvent("round", { eventName: "round.world_bring_up", id: 1 });
  state.recordEvent("round", { eventName: "round.world_bring_up", id: 2 });
  state.recordEvent("round", { eventName: "round.world_bring_up", id: 3 });

  assert.equal(state.getEvents().round.length, 2, "Round events bucket should be capped at 2");
  assert.equal(state.getEvents().round[0].id, 2);

  // Verify getAll() behavior with includeEventsInAllSnapshot: false
  const allSnapshot = state.getAll();
  assert.deepEqual(allSnapshot.events, { console: [], raw: [], rcon: [], round: [], combat: [] }, "Events should be empty when includeEventsInAllSnapshot is false");

  // Recreate with includeEventsInAllSnapshot: true
  const { tempDir: tempDir2, configPath: configPath2 } = await createTempConfig({
    runtimeState: {
      includeEventsInAllSnapshot: true,
    },
  });
  const config2 = new ConfigManager(configPath2);
  await config2.load();
  const state2 = new RuntimeState({ config: config2 });
  state2.recordEvent("round", { eventName: "round.world_bring_up" });
  
  const allSnapshot2 = state2.getAll();
  assert.equal(allSnapshot2.events.round.length, 1, "Events should be present in all snapshot");

  await fs.rm(tempDir, { recursive: true, force: true });
  await fs.rm(tempDir2, { recursive: true, force: true });
  console.log("  - RuntimeState slimming tests passed");
}

async function run() {
  console.log("Running performance and runtime state tests...");
  await testPerformanceMonitor();
  await testRuntimeStateSlimming();
  console.log("All performance & runtime state tests passed!");
}

run().catch((err) => {
  console.error("Test failed: ", err);
  process.exit(1);
});
