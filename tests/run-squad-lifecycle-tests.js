import assert from "node:assert/strict";

import { createSquadLifecycleModule } from "../modules/squad-lifecycle/index.js";

function createHarness() {
  const coreListeners = new Map();
  const moduleListeners = new Map();
  const webStatusState = {
    serverId: "BZSS_Main",
  };

  const core = {
    logger: makeLogger(),
    createLogger: makeLogger,
    webStatus: {
      serverId: "BZSS_Main",
      getSnapshot() {
        return { ...webStatusState };
      },
    },
    eventBus: {
      onCoreEvent(eventName, handler) {
        return subscribe(coreListeners, eventName, handler);
      },
      onModuleEvent(moduleId, eventName, handler) {
        return subscribe(moduleListeners, `${moduleId}:${eventName}`, handler);
      },
      emitCoreEvent(eventName, event) {
        emit(coreListeners, eventName, { ...event, eventName });
      },
      emitModuleEvent(moduleId, eventName, event) {
        emit(moduleListeners, `${moduleId}:${eventName}`, { ...event, eventName, source: moduleId });
      },
    },
  };

  const config = {
    get(path, defaultValue) {
      if (path === "modules.squadLifecycle") {
        return {
          enabled: true,
          preferLogCreateEvent: true,
          debug: false,
        };
      }
      return defaultValue;
    },
  };

  return {
    core,
    module: createSquadLifecycleModule({ core, config, logger: core.logger }),
  };
}

function makeLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
    module() {},
  };
}

function subscribe(map, key, handler) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(handler);
  return () => map.get(key)?.delete(handler);
}

function emit(map, key, event) {
  for (const handler of map.get(key) ?? []) {
    handler(event);
  }
}

function squadEventBase(overrides = {}) {
  return {
    serverId: "BZSS_Main",
    sessionId: "session-1",
    time: "2026-05-13 20:31:42",
    rawLog: "raw squad create log",
    paramMap: {},
    ...overrides,
  };
}

async function testLogCreateWithTeamId() {
  const harness = createHarness();
  await harness.module.start();

  harness.core.eventBus.emitCoreEvent("On_SquadCreated", squadEventBase({
    paramMap: {
      SquadID: "1",
      SquadName: "Alpha",
      FactionName: "USA",
      TeamID: "1",
      PlayerName: "Leader",
      Steam64ID: "76561198000000001",
      EOSID: "eos-1",
    },
  }));

  const current = harness.module.api.getCurrent("BZSS_Main");
  assert.equal(current.list.length, 1);
  assert.equal(current.list[0].creationSource, "LOG");
  assert.equal(current.list[0].creationConfidence, "HIGH");
  assert.equal(current.list[0].createdDisplayText, "\u521b\u5efa\u4e8e 20:31:42");
  assert.equal(current.list[0].sourceLabel, "\u65e5\u5fd7\u786e\u8ba4");
  await harness.module.stop();
}

async function testPendingCreateFlushesFromSnapshot() {
  const harness = createHarness();
  await harness.module.start();

  harness.core.eventBus.emitCoreEvent("On_SquadCreated", squadEventBase({
    paramMap: {
      SquadID: "2",
      SquadName: "Bravo",
      FactionName: "PMCs",
      PlayerName: "Leader",
      Steam64ID: "76561198000000002",
      EOSID: "eos-2",
    },
  }));

  assert.equal(harness.module.api.getPendingCount() > 0, true);

  harness.core.eventBus.emitModuleEvent("module.matchState", "squadsUpdated", {
    serverId: "BZSS_Main",
    time: "2026-05-13 20:31:45",
    squads: [
      {
        teamID: 2,
        squadID: 2,
        squadName: "Bravo",
        teamName: "PMCs",
        creatorName: "Leader",
      },
    ],
  });

  const current = harness.module.api.getCurrent("BZSS_Main");
  assert.equal(current.list.length, 1);
  assert.equal(current.list[0].teamId, 2);
  assert.equal(current.list[0].creationSource, "LOG");
  assert.equal(current.list[0].creationConfidence, "HIGH");
  assert.equal(current.list[0].createdDisplayText, "\u521b\u5efa\u4e8e 20:31:42");
  assert.equal(current.list[0].sourceLabel, "\u65e5\u5fd7\u786e\u8ba4");
  assert.equal(harness.module.api.getPendingCount(), 0);
  await harness.module.stop();
}

async function testReusedSquadIdCreatesNewGeneration() {
  const harness = createHarness();
  await harness.module.start();

  harness.core.eventBus.emitCoreEvent("On_SquadCreated", squadEventBase({
    time: "2026-05-13 20:31:42",
    paramMap: {
      SquadID: "5",
      SquadName: "Echo",
      FactionName: "USA",
      TeamID: "1",
      PlayerName: "Leader One",
      Steam64ID: "76561198000000005",
      EOSID: "eos-5",
    },
  }));

  harness.core.eventBus.emitCoreEvent("On_SquadCreated", squadEventBase({
    time: "2026-05-13 20:40:00",
    rawLog: "raw squad create log - reused slot",
    paramMap: {
      SquadID: "5",
      SquadName: "Echo",
      FactionName: "USA",
      TeamID: "1",
      PlayerName: "Leader Two",
      Steam64ID: "76561198000000015",
      EOSID: "eos-15",
    },
  }));

  const current = harness.module.api.getCurrent("BZSS_Main");
  assert.equal(current.list.length, 1);
  assert.equal(current.list[0].generation, 2);
  assert.equal(current.list[0].key, "BZSS_Main:session-1:T1:S5:G2");
  assert.equal(current.list[0].createdDisplayText, "\u521b\u5efa\u4e8e 20:40:00");
  assert.equal(current.byKey[current.list[0].key].creatorName, "Leader Two");
  await harness.module.stop();
}

async function testRconOnlySnapshotCreatesFallbackLifecycle() {
  const harness = createHarness();
  await harness.module.start();

  harness.core.eventBus.emitModuleEvent("module.matchState", "squadsUpdated", {
    serverId: "BZSS_Main",
    time: "2026-05-13 20:31:45",
    squads: [
      {
        teamID: 1,
        squadID: 3,
        squadName: "Charlie",
        teamName: "USA",
        creatorName: "Leader",
      },
    ],
  });

  const current = harness.module.api.getCurrent("BZSS_Main");
  assert.equal(current.list.length, 1);
  assert.equal(current.list[0].creationSource, "RCON_SNAPSHOT");
  assert.equal(current.list[0].creationConfidence, "MEDIUM");
  assert.equal(current.list[0].sourceLabel, "RCON\u9996\u6b21\u53d1\u73b0");
  assert.equal(current.list[0].createdDisplayText, "\u9996\u6b21\u53d1\u73b0\u4e8e 20:31:45");
  await harness.module.stop();
}

async function testMatchEndClearsPendingAndCurrent() {
  const harness = createHarness();
  await harness.module.start();

  harness.core.eventBus.emitCoreEvent("On_SquadCreated", squadEventBase({
    paramMap: {
      SquadID: "4",
      SquadName: "Delta",
      FactionName: "USA",
      PlayerName: "Leader",
      Steam64ID: "76561198000000004",
      EOSID: "eos-4",
    },
  }));
  assert.equal(harness.module.api.getPendingCount() > 0, true);

  harness.core.eventBus.emitCoreEvent("GAME_END", {
    serverId: "BZSS_Main",
    time: "2026-05-13 20:35:00",
  });

  const current = harness.module.api.getCurrent("BZSS_Main");
  assert.equal(current.list.length, 0);
  assert.equal(harness.module.api.getPendingCount(), 0);
  await harness.module.stop();
}

await testLogCreateWithTeamId();
await testPendingCreateFlushesFromSnapshot();
await testReusedSquadIdCreatesNewGeneration();
await testRconOnlySnapshotCreatesFallbackLifecycle();
await testMatchEndClearsPendingAndCurrent();

console.log("squad lifecycle tests passed");
