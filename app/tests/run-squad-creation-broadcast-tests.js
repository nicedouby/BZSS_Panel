import assert from "node:assert/strict";
import { createPlugin, parseSquadCreateEvent } from "../plugins/squad-creation-broadcast.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createHarness(options = {}) {
  const coreListeners = new Map();
  const moduleListeners = new Map();
  const broadcasts = [];
  let refreshCallCount = 0;

  const matchState = {
    squads: options.initialSquads ?? [],
  };

  const core = {
    logger: noopLogger(),
    createLogger() { return noopLogger(); },
    webStatus: {
      serverId: "test-server",
    },
    eventBus: {
      onCoreEvent(eventName, handler) {
        coreListeners.set(eventName, handler);
        return () => coreListeners.delete(eventName);
      },
      onModuleEvent(moduleId, eventName, handler) {
        moduleListeners.set(`${moduleId}:${eventName}`, handler);
        return () => moduleListeners.delete(`${moduleId}:${eventName}`);
      },
      emitCoreEvent(eventName, event) {
        const handler = coreListeners.get(eventName);
        if (handler) handler({ ...event, eventName });
      },
      emitModuleEvent(moduleId, eventName, event) {
        const handler = moduleListeners.get(`${moduleId}:${eventName}`);
        if (handler) handler({ ...event, eventName, source: moduleId });
      },
    },
  };

  const modules = {
    squadManagement: {
      getSquads(serverId) {
        return matchState.squads;
      },
    },
    matchState: {
      async refresh(type) {
        if (type === "squads") {
          refreshCallCount++;
          // Simulate some latency
          await sleep(20);
          if (options.onRefresh) {
            options.onRefresh(matchState);
          }
        }
      },
      getState(serverId) {
        return matchState;
      },
    },
    adminWarn: {
      async sendAdminBroadcast(req) {
        broadcasts.push(req);
        return { success: true, commandText: `AdminBroadcast ${req.message}` };
      },
      async broadcastMessage(req) {
        broadcasts.push(req);
        return { success: true, commandText: `AdminBroadcast ${req.message}` };
      },
    },
  };

  const config = {
    get(pathText, fallback) {
      if (pathText === "plugins.plugin.squad-creation-broadcast" || pathText === "plugins.squad-creation-broadcast") {
        return {
          enabled: true,
          delaySeconds: options.delaySeconds ?? 0.2, // 200ms default for fast tests
          messageTemplate: options.messageTemplate ?? "[建队播报] 玩家 ${creatorName} 创建了小队: ${squadName} (小队ID: ${squadId}) (${teamLabel})",
        };
      }
      return fallback;
    },
  };

  const plugin = createPlugin({
    core,
    modules,
    config,
    logger: noopLogger(),
  });

  await plugin.start();

  return {
    plugin,
    core,
    modules,
    matchState,
    broadcasts,
    getRefreshCallCount: () => refreshCallCount,
    async stop() {
      await plugin.stop();
    },
  };
}

function noopLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
}

// 1. Test Parsing
function testEventParsing() {
  // Test structured On_SquadCreated
  const ev1 = {
    eventName: "On_SquadCreated",
    serverId: "BZSS_Main",
    paramMap: {
      SquadID: "3",
      SquadName: "Armor",
      FactionName: "USA",
      PlayerName: "Douby",
    },
  };
  const parsed1 = parseSquadCreateEvent(ev1);
  assert.ok(parsed1);
  assert.equal(parsed1.serverId, "BZSS_Main");
  assert.equal(parsed1.squadId, 3);
  assert.equal(parsed1.squadName, "Armor");
  assert.equal(parsed1.factionName, "USA");
  assert.equal(parsed1.creatorName, "Douby");

  // Test RawLogLine
  const rawLog = "[2026.05.14-14.29.22:169][495]LogSquad: Donald·DoubyBear (Online IDs: EOS: eos-123 steam: 76561198194428818) has created Squad 5 (Squad Name: Squad 5) on United States Army";
  const ev2 = {
    eventName: "On_RawLogLine",
    serverId: "BZSS_Main",
    rawLog,
  };
  const parsed2 = parseSquadCreateEvent(ev2);
  assert.ok(parsed2);
  assert.equal(parsed2.serverId, "BZSS_Main");
  assert.equal(parsed2.squadId, 5);
  assert.equal(parsed2.squadName, "Squad 5");
  assert.equal(parsed2.factionName, "United States Army");
  assert.equal(parsed2.creatorName, "Donald·DoubyBear");
  assert.equal(parsed2.creatorSteamId, "76561198194428818");
  assert.equal(parsed2.creatorEosId, "eos-123");

  // Non-matching events
  const ev3 = { eventName: "On_PlayerJoined" };
  assert.equal(parseSquadCreateEvent(ev3), null);

  console.log("  - Event parsing tests passed");
}

// 2. Test Broadcast on Success
async function testBroadcastOnSuccess() {
  const harness = await createHarness({
    initialSquads: [
      { squadID: 1, squadName: "Alpha", creatorName: "Douby", teamID: 1 },
    ],
  });

  try {
    harness.core.eventBus.emitCoreEvent("On_SquadCreated", {
      serverId: "test-server",
      paramMap: {
        SquadID: "1",
        SquadName: "Alpha",
        FactionName: "USA",
        PlayerName: "Douby",
      },
    });

    // Check immediately: shouldn't broadcast yet
    assert.equal(harness.broadcasts.length, 0);

    // Sleep for 300ms (timer is set to 200ms)
    await sleep(300);

    assert.equal(harness.broadcasts.length, 1);
    assert.equal(
      harness.broadcasts[0].message,
      "[建队播报] 玩家 Douby 创建了小队: Alpha (小队ID: 1) (蓝军)"
    );
  } finally {
    await harness.stop();
  }
  console.log("  - Broadcast on success tests passed");
}

// 3. Test Disbanded Squad is Not Broadcasted
async function testDisbandedNotBroadcasted() {
  // Initially, squad is created.
  // But when refresh is called 5s later, the squad is not in the list.
  const harness = await createHarness({
    initialSquads: [], // Empty list = disbanded
  });

  try {
    harness.core.eventBus.emitCoreEvent("On_SquadCreated", {
      serverId: "test-server",
      paramMap: {
        SquadID: "2",
        SquadName: "Bravo",
        FactionName: "USA",
        PlayerName: "Douby",
      },
    });

    await sleep(300);

    // Should not broadcast since the squad is not in matchState squads
    assert.equal(harness.broadcasts.length, 0);
  } finally {
    await harness.stop();
  }
  console.log("  - Disbanded squad skipped tests passed");
}

// 4. Test Timer Reset on Recreation
async function testTimerResetOnRecreation() {
  let squads = [
    { squadID: 4, squadName: "Delta", creatorName: "Builder", teamID: 2 },
  ];

  const harness = await createHarness({
    initialSquads: squads,
    delaySeconds: 0.3, // 300ms delay
  });

  try {
    // 1. First trigger at t=0
    harness.core.eventBus.emitCoreEvent("On_SquadCreated", {
      serverId: "test-server",
      paramMap: {
        SquadID: "4",
        SquadName: "Delta",
        FactionName: "USA",
        PlayerName: "Builder",
      },
    });

    await sleep(150);
    // At t=150ms: shouldn't broadcast yet
    assert.equal(harness.broadcasts.length, 0);

    // 2. Re-creation trigger at t=150ms
    harness.core.eventBus.emitCoreEvent("On_SquadCreated", {
      serverId: "test-server",
      paramMap: {
        SquadID: "4",
        SquadName: "Delta",
        FactionName: "USA",
        PlayerName: "Builder",
      },
    });

    // If it didn't reset, the first timer would fire at t=300ms.
    // Let's wait until t=350ms.
    await sleep(200); // Now total time ~350ms since start, ~200ms since second trigger.
    assert.equal(harness.broadcasts.length, 0); // Still 0 because timer got reset!

    // The second timer should fire at t=150ms + 300ms = 450ms.
    // Let's wait until t=550ms.
    await sleep(200);
    assert.equal(harness.broadcasts.length, 1);
    assert.equal(
      harness.broadcasts[0].message,
      "[建队播报] 玩家 Builder 创建了小队: Delta (小队ID: 4) (红军)"
    );
  } finally {
    await harness.stop();
  }
  console.log("  - Timer reset on recreation tests passed");
}

// 5. Test Debounced Refresh
async function testDebouncedRefresh() {
  const harness = await createHarness({
    initialSquads: [
      { squadID: 1, squadName: "Alpha", creatorName: "A", teamID: 1 },
      { squadID: 2, squadName: "Bravo", creatorName: "B", teamID: 2 },
    ],
  });

  try {
    // Trigger two creations at once
    harness.core.eventBus.emitCoreEvent("On_SquadCreated", {
      serverId: "test-server",
      paramMap: { SquadID: "1", SquadName: "Alpha", FactionName: "USA", PlayerName: "A" },
    });
    harness.core.eventBus.emitCoreEvent("On_SquadCreated", {
      serverId: "test-server",
      paramMap: { SquadID: "2", SquadName: "Bravo", FactionName: "USA", PlayerName: "B" },
    });

    await sleep(300);

    // Both should broadcast
    assert.equal(harness.broadcasts.length, 2);

    // But refresh should only be called once because it is debounced/shared
    assert.equal(harness.getRefreshCallCount(), 1);
  } finally {
    await harness.stop();
  }
  console.log("  - Debounced refresh tests passed");
}

// Run all tests
async function runAll() {
  console.log("Running squad creation broadcast plugin tests...");
  testEventParsing();
  await testBroadcastOnSuccess();
  await testDisbandedNotBroadcasted();
  await testTimerResetOnRecreation();
  await testDebouncedRefresh();
  console.log("All squad creation broadcast plugin tests passed!");
}

runAll().catch(err => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
