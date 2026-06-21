import assert from "node:assert/strict";

import { createSquadLifecycleModule } from "../modules/squad-lifecycle/index.js";
import { parseSquadCreateEvent } from "../modules/squad-lifecycle/log-adapter.js";
import { clearTeamFactionMappings } from "../core/team-faction-cache.js";

function createHarness() {
  clearTeamFactionMappings("BZSS_Main");
  const coreListeners = new Map();
  const moduleListeners = new Map();
  const webStatusState = {
    serverId: "BZSS_Main",
  };
  const logs = [];

  const core = {
    logger: makeLogger(logs),
    createLogger: () => makeLogger(logs),
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
          debug: false,
        };
      }
      return defaultValue;
    },
  };

  return {
    core,
    module: createSquadLifecycleModule({ core, config, logger: core.logger }),
    logs,
  };
}

function makeLogger(logs = []) {
  return {
    debug(message, context) {
      logs.push({ level: "debug", message: renderLogMessage(message), context });
    },
    info(message, context) {
      logs.push({ level: "info", message: renderLogMessage(message), context });
    },
    warn(message, context) {
      logs.push({ level: "warn", message: renderLogMessage(message), context });
    },
    error(message, context) {
      logs.push({ level: "error", message: renderLogMessage(message), context });
    },
    module(message, context) {
      logs.push({ level: "module", message: renderLogMessage(message), context });
    },
  };
}

function renderLogMessage(message) {
  return typeof message === "function" ? message() : message;
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

async function testRawLogLineCreatesPendingAndFlushesToLog() {
  const harness = createHarness();
  await harness.module.start();

  const rawLogLine = "[2026.05.14-14.29.22:169][495]LogSquad: Donald·DoubyBear (Online IDs: EOS: 00026a0bbf67442f84777b964560fba4 steam: 76561198194428818) has created Squad 5 (Squad Name: Squad 5) on United States Army";

  harness.core.eventBus.emitCoreEvent("On_RawLogLine", {
    serverId: "BZSS_Main",
    sessionId: "session-raw-1",
    eventId: "BZSS_Main:session-raw-1:100",
    time: "2026-05-14 14:29:22.169",
    rawLog: rawLogLine,
    rawEvent: { Raw: rawLogLine },
  });

  assert.equal(harness.module.api.getPendingCount(), 1);
  assert.equal(
    harness.logs.some((entry) => entry.level === "info" && String(entry.message ?? "").includes("[SquadLifecycle] squad create accepted: S5 Squad 5")),
    true,
  );

  harness.core.eventBus.emitCoreEvent("On_SquadCreated", squadEventBase({
    sessionId: "session-raw-1",
    eventId: "BZSS_Main:session-raw-1:101",
    time: "2026-05-14 14:29:22.169",
    rawLog: rawLogLine,
    paramMap: {
      SquadID: "5",
      SquadName: "Squad 5",
      FactionName: "United States Army",
      PlayerName: "Donald\u00b7DoubyBear",
      Steam64ID: "76561198194428818",
      EOSID: "00026a0bbf67442f84777b964560fba4",
    },
  }));

  assert.equal(
    harness.logs.filter((entry) => entry.level === "info" && String(entry.message ?? "").includes("[SquadLifecycle] squad create accepted: S5 Squad 5")).length,
    1,
  );

  harness.core.eventBus.emitModuleEvent("module.matchState", "squadsUpdated", {
    serverId: "BZSS_Main",
    sessionId: "session-raw-1",
    time: "2026-05-14 14:29:30",
    squads: [
      {
        teamID: 1,
        squadID: 5,
        squadName: "Squad 5",
        teamName: "United States Army",
        creatorName: "Donald·DoubyBear",
      },
    ],
  });

  const current = harness.module.api.getCurrent("BZSS_Main");
  assert.equal(current.list.length, 1);
  assert.equal(current.list[0].squadId, 5);
  assert.equal(current.list[0].creationSource, "LOG");
  assert.equal(current.list[0].createdDisplayText, "\u521b\u5efa\u4e8e 14:29:22");
  assert.equal(current.list[0].sourceLabel, "\u65e5\u5fd7\u786e\u8ba4");
  assert.equal(current.list[0].teamId, 1);
  assert.equal(
    harness.logs.some((entry) => entry.level === "info" && entry.message === "[SquadLifecycle] pending create flushed to LOG: T1 S5 Squad 5"),
    true,
  );
  await harness.module.stop();
}

async function testRawLogLineParseFailureWarns() {
  const harness = createHarness();
  await harness.module.start();

  harness.core.eventBus.emitCoreEvent("On_RawLogLine", {
    serverId: "BZSS_Main",
    sessionId: "session-raw-2",
    time: "2026-05-14 14:29:22.169",
    rawLog: "[2026.05.14-14.29.22:169][495]LogSquad: Something has created Squad 5",
    rawEvent: {
      Raw: "[2026.05.14-14.29.22:169][495]LogSquad: Something has created Squad 5",
    },
  });

  assert.equal(harness.module.api.getPendingCount(), 0);
  assert.equal(
    harness.logs.some((entry) => entry.level === "warn" && String(entry.message ?? "").includes("raw squad create log could not be parsed")),
    true,
  );
  await harness.module.stop();
}

async function testPendingFlushWarnsWhenRconMissingMatch() {
  const harness = createHarness();
  await harness.module.start();

  const rawLogLine = "[2026.05.14-14.29.22:169][495]LogSquad: Donald\u00b7DoubyBear (Online IDs: EOS: 00026a0bbf67442f84777b964560fba4 steam: 76561198194428818) has created Squad 11 (Squad Name: Squad 11) on United States Army";

  harness.core.eventBus.emitCoreEvent("On_RawLogLine", {
    serverId: "BZSS_Main",
    sessionId: "session-raw-3",
    time: "2026-05-14 14:29:22.169",
    rawLog: rawLogLine,
    rawEvent: { Raw: rawLogLine },
  });

  harness.core.eventBus.emitModuleEvent("module.matchState", "squadsUpdated", {
    serverId: "BZSS_Main",
    sessionId: "session-raw-3",
    time: "2026-05-14 14:29:30",
    squads: [
      {
        teamID: 1,
        squadID: 12,
        squadName: "Squad 12",
        teamName: "United States Army",
        creatorName: "Someone Else",
      },
    ],
  });

  assert.equal(harness.module.api.getPendingCount(), 1);
  assert.equal(
    harness.logs.some((entry) => entry.level === "warn" && String(entry.message ?? "").includes("pending create did not match current RCON squads")),
    true,
  );
  await harness.module.stop();
}

async function testRconFirstThenLogPromotesToLog() {
  const harness = createHarness();
  await harness.module.start();

  harness.core.eventBus.emitModuleEvent("module.matchState", "squadsUpdated", {
    serverId: "BZSS_Main",
    sessionId: "session-1",
    time: "2026-05-13 20:31:40",
    squads: [
      {
        teamID: 1,
        squadID: 6,
        squadName: "Foxtrot",
        teamName: "USA",
        creatorName: "Leader",
      },
    ],
  });

  harness.core.eventBus.emitCoreEvent("On_SquadCreated", squadEventBase({
    time: "2026-05-13 20:31:42",
    paramMap: {
      SquadID: "6",
      SquadName: "Foxtrot",
      FactionName: "USA",
      TeamID: "1",
      PlayerName: "Leader",
      Steam64ID: "76561198000000006",
      EOSID: "eos-6",
    },
  }));

  const current = harness.module.api.getCurrent("BZSS_Main");
  assert.equal(current.list.length, 1);
  assert.equal(current.list[0].creationSource, "LOG");
  assert.equal(current.list[0].creationConfidence, "HIGH");
  assert.equal(current.list[0].createdAtMs, new Date("2026-05-13 20:31:42").getTime());
  assert.equal(current.list[0].createdDisplayText, "\u521b\u5efa\u4e8e 20:31:42");
  assert.equal(current.list[0].sourceLabel, "\u65e5\u5fd7\u786e\u8ba4");
  assert.equal(current.list[0].rconPromotedToLog, true);
  assert.equal(typeof current.list[0].logConfirmedAt, "string");
  await harness.module.stop();
}

async function testPendingLogWithoutTeamIdMatchesRconSnapshot() {
  const harness = createHarness();
  await harness.module.start();
  const emitted = [];
  const unsubscribe = harness.core.eventBus.onModuleEvent("module.squadLifecycle", "squadCreated", (event) => {
    emitted.push(event);
  });

  harness.core.eventBus.emitCoreEvent("On_SquadCreated", {
    serverId: "BZSS_Main",
    sessionId: "session-1",
    time: "2026-05-13 20:31:42",
    rawLog: "raw squad create log",
    eventName: "On_SquadCreated",
    paramMap: {
      SquadID: "7",
      SquadName: "Golf",
      FactionName: "USA",
      PlayerName: "Leader",
      Steam64ID: "76561198000000007",
      EOSID: "eos-7",
    },
  });

  assert.equal(harness.module.api.getPendingCount(), 1);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].teamId, null);

  harness.core.eventBus.emitModuleEvent("module.matchState", "squadsUpdated", {
    serverId: "BZSS_Main",
    sessionId: "session-1",
    time: "2026-05-13 20:31:45",
    squads: [
      {
        teamID: 2,
        squadID: 7,
        squadName: "Golf",
        teamName: "USA",
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
  assert.equal(harness.module.api.getPendingCount(), 0);
  assert.equal(emitted.length, 2);
  assert.equal(emitted[1].teamId, 2);
  unsubscribe();
  await harness.module.stop();
}

async function testCreateLogUsesKnownFactionTeamMappingImmediately() {
  const harness = createHarness();
  await harness.module.start();
  const emitted = [];
  const unsubscribe = harness.core.eventBus.onModuleEvent("module.squadLifecycle", "squadCreated", (event) => {
    emitted.push(event);
  });

  harness.core.eventBus.emitModuleEvent("module.matchState", "squadsUpdated", {
    serverId: "BZSS_Main",
    sessionId: "session-1",
    time: "2026-05-13 20:31:00",
    squads: [
      {
        teamID: 1,
        squadID: 1,
        squadName: "Alpha",
        teamName: "United States Army",
        creatorName: "Existing",
      },
      {
        teamID: 2,
        squadID: 1,
        squadName: "Bravo",
        teamName: "PMCs",
        creatorName: "Existing Two",
      },
    ],
  });

  harness.core.eventBus.emitCoreEvent("On_RawLogLine", {
    serverId: "BZSS_Main",
    sessionId: "session-1",
    rawLog: "[2026.05.14-14.29.22:169][495]LogSquad: Fast Leader (Online IDs: EOS: eos-fast steam: 76561198000000999) has created Squad 5 (Squad Name: Tank) on United States Army",
    eventName: "On_RawLogLine",
  });

  const current = harness.module.api.getCurrent("BZSS_Main");
  assert.equal(harness.module.api.getPendingCount(), 0);
  assert.equal(current.list.some((record) => record.squadId === 5 && record.teamId === 1), true);
  const created = emitted.find((event) => event.squadId === 5);
  assert.equal(created?.teamId, 1);
  assert.equal(created?.factionName, "United States Army");

  unsubscribe();
  await harness.module.stop();
}

async function testSyntheticCurrentMatchIdKeepsPendingAndSnapshotAligned() {
  const harness = createHarness();
  await harness.module.start();

  harness.core.eventBus.emitCoreEvent("On_SquadCreated", {
    serverId: "BZSS_Main",
    time: "2026-05-13 20:31:42",
    rawLog: "raw squad create log",
    eventName: "On_SquadCreated",
    paramMap: {
      SquadID: "8",
      SquadName: "Hotel",
      FactionName: "USA",
      PlayerName: "Leader",
      Steam64ID: "76561198000000008",
      EOSID: "eos-8",
    },
  });

  assert.equal(harness.module.api.getPendingCount(), 1);

  harness.core.eventBus.emitModuleEvent("module.matchState", "squadsUpdated", {
    serverId: "BZSS_Main",
    time: "2026-05-13 20:31:45",
    squads: [
      {
        teamID: 3,
        squadID: 8,
        squadName: "Hotel",
        teamName: "USA",
        creatorName: "Leader",
      },
    ],
  });

  const current = harness.module.api.getCurrent("BZSS_Main");
  assert.equal(current.matchId, "synthetic:BZSS_Main:current");
  assert.equal(current.list.length, 1);
  assert.equal(current.list[0].matchId, "synthetic:BZSS_Main:current");
  assert.equal(current.list[0].teamId, 3);
  assert.equal(current.list[0].creationSource, "LOG");
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

function testParseSquadCreateEventRecognizesEventNameVariants() {
  const parsedFromEvent = parseSquadCreateEvent({
    Event: "On_SquadCreated",
    serverId: "BZSS_Main",
    sessionId: "session-1",
    time: "2026-05-13 20:31:42",
    rawLog: "raw squad create log",
    paramMap: {
      SquadID: "9",
      SquadName: "India",
    },
  });

  assert.equal(parsedFromEvent?.squadId, 9);
  assert.equal(parsedFromEvent?.matchId, "session-1");

  const parsedFromRawEvent = parseSquadCreateEvent({
    rawEvent: {
      Event: "On_SquadCreated",
    },
    serverId: "BZSS_Main",
    sessionId: "session-1",
    time: "2026-05-13 20:31:42",
    rawLog: "raw squad create log",
    paramMap: {
      SquadID: "10",
      SquadName: "Juliet",
    },
  });

  assert.equal(parsedFromRawEvent?.squadId, 10);
  assert.equal(parsedFromRawEvent?.matchId, "session-1");
}

function testParseSquadCreateEventRecognizesRawLogLine() {
  const rawLogLine = "[2026.05.14-14.29.22:169][495]LogSquad: Donald·DoubyBear (Online IDs: EOS: 00026a0bbf67442f84777b964560fba4 steam: 76561198194428818) has created Squad 5 (Squad Name: Squad 5) on United States Army";
  const parsed = parseSquadCreateEvent({
    eventName: "On_RawLogLine",
    serverId: "BZSS_Main",
    sessionId: "session-raw-1",
    time: "2026-05-14 14:29:22.169",
    rawLog: rawLogLine,
    rawEvent: {
      Raw: rawLogLine,
    },
  });

  assert.equal(parsed?.serverId, "BZSS_Main");
  assert.equal(parsed?.matchId, "session-raw-1");
  assert.equal(Number.isNaN(Date.parse(parsed?.eventTime ?? "")), false);
  assert.equal(parsed?.squadId, 5);
  assert.equal(parsed?.squadName, "Squad 5");
  assert.equal(parsed?.factionName, "United States Army");
  assert.equal(parsed?.creatorName, "Donald·DoubyBear");
  assert.equal(parsed?.creatorSteamId, "76561198194428818");
  assert.equal(parsed?.creatorEosId, "00026a0bbf67442f84777b964560fba4");
  assert.equal(parsed?.teamId, null);
  assert.equal(parsed?.needsTeamId, true);
  assert.equal(parsed?.parsedFromRawLogLine, true);
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
await testRawLogLineCreatesPendingAndFlushesToLog();
await testRawLogLineParseFailureWarns();
await testPendingFlushWarnsWhenRconMissingMatch();
await testRconFirstThenLogPromotesToLog();
await testPendingLogWithoutTeamIdMatchesRconSnapshot();
await testCreateLogUsesKnownFactionTeamMappingImmediately();
await testSyntheticCurrentMatchIdKeepsPendingAndSnapshotAligned();
await testReusedSquadIdCreatesNewGeneration();
await testRconOnlySnapshotCreatesFallbackLifecycle();
testParseSquadCreateEventRecognizesEventNameVariants();
testParseSquadCreateEventRecognizesRawLogLine();
await testMatchEndClearsPendingAndCurrent();

console.log("squad lifecycle tests passed");
