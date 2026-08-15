import assert from "node:assert/strict";

import { createSquadLifecycleModule } from "../modules/squad-lifecycle/index.js";
import { clearTeamFactionMappings } from "../core/team-faction-cache.js";

function createHarness() {
  clearTeamFactionMappings("BZSS_Main");
  const coreListeners = new Map();
  const moduleListeners = new Map();
  const commands = [];
  const emitted = [];
  const eventBus = {
    onCoreEvent(name, handler) { return subscribe(coreListeners, name, handler); },
    onModuleEvent(moduleId, name, handler) { return subscribe(moduleListeners, `${moduleId}:${name}`, handler); },
    emitCoreEvent(name, event) { emit(coreListeners, name, { ...event, eventName: name }); },
    emitModuleEvent(moduleId, name, event) {
      emitted.push({ moduleId, name, event });
      emit(moduleListeners, `${moduleId}:${name}`, { ...event, eventName: name, source: moduleId });
    },
  };
  const logger = { debug() {}, info() {}, warn() {}, error() {}, module() {} };
  const core = {
    eventBus,
    logger,
    createLogger: () => logger,
    webStatus: { serverId: "BZSS_Main", getSnapshot: () => ({ serverId: "BZSS_Main" }) },
    rcon: { async execute(command) { commands.push(command); } },
  };
  const config = {
    get(path, fallback) {
      if (path === "modules.squadLifecycle") return { enabled: true, replay: { enabled: true } };
      return fallback;
    },
  };
  return { core, commands, emitted, module: createSquadLifecycleModule({ core, config, logger }) };
}

function replay(overrides = {}) {
  const sourceOffset = overrides.sourceOffset ?? 100;
  return {
    serverId: "BZSS_Main",
    matchId: "match-replay",
    sourceMode: "replay",
    isReplay: true,
    canTriggerActions: false,
    eventTime: "2026-08-14T10:00:00.000Z",
    squadId: 7,
    squadName: "Squad 7",
    factionName: "United States Army",
    creatorName: "Leader",
    creatorSteamId: "76561198000000001",
    creatorEosId: "eos-1",
    teamId: 1,
    sourceFile: "SquadGame.log",
    sourceFileId: "file-1",
    sourceOffset,
    sourceEventId: `squadcreate:file-1:${sourceOffset}`,
    rawLog: `[2026.08.14-10.00.00:000] LogSquad: replay ${sourceOffset}`,
    ...overrides,
  };
}

async function testAcceptedOrderAndRejectedGap() {
  const harness = createHarness();
  await harness.module.start();
  let liveCreatedEvents = 0;
  const unsubscribe = harness.core.eventBus.onModuleEvent("module.squadLifecycle", "squadCreated", () => { liveCreatedEvents += 1; });

  const result = harness.module.api.importReplayCreateBatch([
    replay({ squadId: 7, squadName: "Squad 7", eventTime: "2026-08-14T10:00:00.000Z", sourceOffset: 300 }),
    replay({ squadId: 8, squadName: "INVALID HISTORICAL NAME", eventTime: "2026-08-14T10:01:00.000Z", sourceOffset: 400 }),
    replay({ squadId: 2, squadName: "Squad 2", eventTime: "2026-08-14T10:02:00.000Z", sourceOffset: 500 }),
  ]);
  assert.deepEqual(result, { found: 3, accepted: 2, rejectedPolicy: 1, duplicates: 0, pendingTeamResolution: 0 });
  harness.module.api.finalizeReplay({ serverId: "BZSS_Main" });

  const current = harness.module.api.getCurrent("BZSS_Main");
  assert.deepEqual(current.list.map((item) => item.squadName), ["Squad 7", "Squad 2"]);
  assert.deepEqual(current.list.map((item) => item.order), [1, 2]);
  assert.equal(liveCreatedEvents, 0, "replay import must not emit live squadCreated");
  assert.equal(harness.module.api.getReplayStatus().rejectedPolicy, 1);
  assert.equal(harness.module.api.getReplayRejected().length, 1);
  assert.equal(harness.commands.length, 0, "replay import must not execute RCON");

  unsubscribe();
  await harness.module.stop();
}

async function testEventTimeWinsOverArrivalOrder() {
  const harness = createHarness();
  await harness.module.start();
  harness.module.api.importReplayCreateBatch([
    replay({ squadId: 8, squadName: "Squad 8", eventTime: "2026-08-14T10:03:00.000Z", sourceOffset: 800 }),
    replay({ squadId: 4, squadName: "Squad 4", eventTime: "2026-08-14T10:01:00.000Z", sourceOffset: 400 }),
    replay({ squadId: 1, squadName: "Squad 1", eventTime: "2026-08-14T10:02:00.000Z", sourceOffset: 600 }),
  ]);
  harness.module.api.finalizeReplay({ serverId: "BZSS_Main" });
  const current = harness.module.api.getCurrent("BZSS_Main");
  assert.deepEqual(current.list.map((item) => item.squadId), [4, 1, 8]);
  assert.deepEqual(current.list.map((item) => item.order), [1, 2, 3]);
  await harness.module.stop();
}

async function testPendingTeamResolutionPreservesOriginalName() {
  const harness = createHarness();
  await harness.module.start();
  const pending = harness.module.api.importReplayCreate(replay({
    squadId: 3,
    squadName: "Squad 3",
    teamId: null,
    sourceOffset: 900,
  }));
  assert.equal(pending.status, "pending_team_resolution");
  harness.module.api.finalizeReplay({ serverId: "BZSS_Main" });
  assert.equal(harness.module.api.getReplayStatus().status, "resolving");

  harness.core.eventBus.emitModuleEvent("module.matchState", "squadsUpdated", {
    serverId: "BZSS_Main",
    sessionId: "match-replay",
    squads: [{ teamID: 1, squadID: 3, squadName: "Command Squad", teamName: "United States Army" }],
  });
  const current = harness.module.api.getCurrent("BZSS_Main");
  assert.equal(current.list[0].originalSquadName, "Squad 3");
  assert.equal(current.list[0].currentSquadName, "Command Squad");
  assert.equal(harness.module.api.getReplayStatus().pendingTeamResolution, 0);
  assert.equal(harness.module.api.getReplayStatus().status, "completed");
  assert.equal(harness.commands.length, 0);
  await harness.module.stop();
}

async function testSyntheticMatchIsPromotedToRealMatch() {
  const harness = createHarness();
  await harness.module.start();
  const imported = harness.module.api.importReplayCreate(replay({ matchId: null, squadId: 4, squadName: "Squad 4", sourceOffset: 950 }));
  assert.equal(imported.status, "accepted");
  assert.match(harness.module.api.getCurrentMatchId("BZSS_Main"), /^synthetic:/);
  harness.core.eventBus.emitModuleEvent("module.matchState", "squadsUpdated", {
    serverId: "BZSS_Main",
    sessionId: "real-match-id",
    squads: [{ teamID: 1, squadID: 4, squadName: "Squad 4", teamName: "United States Army" }],
  });
  const current = harness.module.api.getCurrent("BZSS_Main");
  assert.equal(current.matchId, "real-match-id");
  assert.equal(current.list.length, 1);
  assert.equal(current.list[0].matchId, "real-match-id");
  await harness.module.stop();
}

async function testReplayImportRejectsActionableRecord() {
  const harness = createHarness();
  await harness.module.start();
  const result = harness.module.api.importReplayCreate(replay({ canTriggerActions: true }));
  assert.equal(result.code, "replay_actions_must_be_disabled");
  assert.equal(harness.module.api.getCurrent("BZSS_Main").list.length, 0);
  await harness.module.stop();
}

function subscribe(map, key, handler) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(handler);
  return () => map.get(key)?.delete(handler);
}
function emit(map, key, event) { for (const handler of map.get(key) ?? []) handler(event); }

await testAcceptedOrderAndRejectedGap();
await testEventTimeWinsOverArrivalOrder();
await testPendingTeamResolutionPreservesOriginalName();
await testSyntheticMatchIsPromotedToRealMatch();
await testReplayImportRejectsActionableRecord();
console.log("squad lifecycle replay tests passed");
