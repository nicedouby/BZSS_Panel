import assert from "node:assert/strict";

import { normalizeSquadLifecycleConfig } from "../modules/squad-lifecycle/config.js";
import { SquadLifecycleReducer } from "../modules/squad-lifecycle/reducer.js";
import { InMemorySquadLifecycleRepository } from "../modules/squad-lifecycle/repository.js";
import { SquadLifecycleService } from "../modules/squad-lifecycle/service.js";

function makeConfig(overrides = {}) {
  return normalizeSquadLifecycleConfig({
    enabled: true,
    debug: false,
    ...overrides,
  });
}

class CollectEventBus {
  constructor() {
    this.events = [];
  }

  async emitSquadLifecycleEvent(event) {
    this.events.push(event);
  }
}

async function testLogCreate() {
  const reducer = new SquadLifecycleReducer(makeConfig());
  const result = await reducer.createOrUpdateFromLog({
    logEvent: {
      serverId: "BZSS_Main",
      matchId: "match_001",
      eventTime: 1000,
      teamId: 1,
      squadId: 3,
      squadName: "INF",
      creatorName: "Alice",
      creatorSteamId: null,
      creatorEosId: null,
      rawLog: "xxx",
      sourceEventId: null,
    },
    activeState: null,
    nextGeneration: 1,
  });

  assert.equal(result.state.status, "ACTIVE");
  assert.equal(result.state.createSource, "LOG");
  assert.equal(result.events[0].eventType, "squad.created");
  assert.equal(result.events[0].confidence, "HIGH");
}

async function testRconFallbackCreate() {
  const reducer = new SquadLifecycleReducer(makeConfig());
  const result = await reducer.applyRconSnapshot({
    snapshot: {
      serverId: "BZSS_Main",
      matchId: "match_001",
      capturedAt: 2000,
      playerCount: 20,
      squads: [
        {
          serverId: "BZSS_Main",
          matchId: "match_001",
          teamId: 1,
          squadId: 3,
          squadName: "INF",
          leaderName: "Alice",
          memberCount: 8,
          locked: false,
        },
      ],
    },
    activeStates: [],
    getNextGeneration: async () => 1,
  });

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].eventType, "squad.created");
  assert.equal(result.events[0].source, "RCON");
  assert.equal(result.events[0].confidence, "MEDIUM");
}

async function testMissingThenDisband() {
  const reducer = new SquadLifecycleReducer(makeConfig({ missingConfirmCount: 2 }));
  const active = {
    lifecycleId: "a",
    runtimeKey: "rk",
    serverId: "BZSS_Main",
    matchId: "match_001",
    teamId: 1,
    squadId: 3,
    generation: 1,
    squadName: "INF",
    leaderName: null,
    leaderSteamId: null,
    leaderEosId: null,
    creatorName: null,
    creatorSteamId: null,
    creatorEosId: null,
    memberCount: 8,
    locked: false,
    status: "ACTIVE",
    createdAt: 1000,
    firstSeenAt: 1000,
    lastSeenAt: 1000,
    missingSince: null,
    missingCount: 0,
    disbandedAt: null,
    closedAt: null,
    closeReason: null,
    createSource: "LOG",
    disbandSource: null,
    confidence: "HIGH",
    updatedAt: 1000,
  };

  const first = await reducer.applyRconSnapshot({
    snapshot: {
      serverId: "BZSS_Main",
      matchId: "match_001",
      capturedAt: 2000,
      playerCount: 20,
      squads: [],
    },
    activeStates: [active],
    getNextGeneration: async () => 2,
  });

  assert.equal(first.statesToSave[0].status, "MISSING_CANDIDATE");
  assert.equal(first.events[0].eventType, "squad.missing_candidate");

  const second = await reducer.applyRconSnapshot({
    snapshot: {
      serverId: "BZSS_Main",
      matchId: "match_001",
      capturedAt: 3000,
      playerCount: 20,
      squads: [],
    },
    activeStates: [{ ...first.statesToSave[0] }],
    getNextGeneration: async () => 2,
  });

  assert.equal(second.statesToSave[0].status, "DISBANDED");
  assert.equal(second.events[0].eventType, "squad.disbanded");
}

async function testRecoverFromMissing() {
  const reducer = new SquadLifecycleReducer(makeConfig({ missingConfirmCount: 2 }));

  const missingState = {
    lifecycleId: "a",
    runtimeKey: "BZSS_Main:match_001:T1:S3",
    serverId: "BZSS_Main",
    matchId: "match_001",
    teamId: 1,
    squadId: 3,
    generation: 1,
    squadName: "INF",
    leaderName: null,
    leaderSteamId: null,
    leaderEosId: null,
    creatorName: null,
    creatorSteamId: null,
    creatorEosId: null,
    memberCount: 8,
    locked: false,
    status: "MISSING_CANDIDATE",
    createdAt: 1000,
    firstSeenAt: 1000,
    lastSeenAt: 1000,
    missingSince: 2000,
    missingCount: 1,
    disbandedAt: null,
    closedAt: null,
    closeReason: null,
    createSource: "LOG",
    disbandSource: null,
    confidence: "HIGH",
    updatedAt: 2000,
  };

  const result = await reducer.applyRconSnapshot({
    snapshot: {
      serverId: "BZSS_Main",
      matchId: "match_001",
      capturedAt: 3000,
      playerCount: 20,
      squads: [
        {
          serverId: "BZSS_Main",
          matchId: "match_001",
          teamId: 1,
          squadId: 3,
          squadName: "INF",
          leaderName: "Alice",
          memberCount: 8,
          locked: false,
        },
      ],
    },
    activeStates: [missingState],
    getNextGeneration: async () => 2,
  });

  assert.equal(result.statesToSave[0].status, "ACTIVE");
  assert.equal(result.statesToSave[0].missingCount, 0);
  assert.equal(result.events[0].eventType, "squad.recovered");
}

async function testSuspiciousEmptySnapshotGuard() {
  const repository = new InMemorySquadLifecycleRepository();
  const eventBus = new CollectEventBus();
  const service = new SquadLifecycleService(makeConfig({
    emptySnapshotGuard: true,
    suspiciousEmptySnapshotPlayerThreshold: 5,
  }), repository, eventBus, console);

  await service.handleRconSnapshot({
    serverId: "BZSS_Main",
    matchId: "match_001",
    capturedAt: 1000,
    playerCount: 40,
    squads: [],
    isMatchChanging: false,
  });

  assert.equal(eventBus.events.length, 0);
  assert.equal(repository.dumpStates().length, 0);
}

async function run() {
  await testLogCreate();
  await testRconFallbackCreate();
  await testMissingThenDisband();
  await testRecoverFromMissing();
  await testSuspiciousEmptySnapshotGuard();
  console.log("run-squad-lifecycle-tests: all tests passed");
}

run().catch((error) => {
  console.error("run-squad-lifecycle-tests: failed");
  console.error(error);
  process.exitCode = 1;
});
