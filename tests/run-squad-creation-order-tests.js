import assert from "node:assert/strict";

import { EventBus } from "../core/event-bus.js";
import { createSquadCreationOrderModule } from "../modules/squad-creation-order/index.js";

function createConfig(values = {}) {
  return {
    get(path, defaultValue) {
      return path in values ? values[path] : defaultValue;
    },
  };
}

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    module() {},
    web() {},
    event() {},
  };
}

function createCore(configValues = {}) {
  const logger = createLogger();
  const eventBus = new EventBus({ logger });

  return {
    logger,
    eventBus,
    config: createConfig(configValues),
    webStatus: {
      serverId: "BZSS_Main",
    },
    webRegistry: {
      registerPage() {},
    },
  };
}

function createModule(core) {
  return createSquadCreationOrderModule({ core, config: core.config });
}

function createSquadCreatedEvent(overrides = {}) {
  const event = {
    eventId: "BZSS_Main:session-a:123",
    eventName: "On_SquadCreated",
    layer: "core",
    source: "python-log-parser",
    serverId: "BZSS_Main",
    sessionId: "session-a",
    seq: "123",
    time: "2026-05-07 22:09:57.277",
    logTime: "2026.05.07-14.05.54:942",
    rawLog: "raw squad created log",
    paramMap: {
      SquadID: "1",
      SquadName: "INF",
      TeamID: "1",
      TeamName: "PLA",
      FactionName: "PLA",
      PlayerName: "PlayerA",
      EOSID: "0002-eos",
      Steam64ID: "7656119-steam",
    },
  };

  return {
    ...event,
    ...overrides,
    paramMap: {
      ...event.paramMap,
      ...(overrides.paramMap ?? {}),
    },
  };
}

async function testRequiresLogReadPermission() {
  const core = createCore({ "pythonLogParser.enabled": false });
  const module = createModule(core);

  await assert.rejects(
    module.start(),
    /Squad Creation Order plugin requires log\.read permission\./,
  );
}

async function testRecordsOrderAndEmitsModuleEvent() {
  const core = createCore({ "pythonLogParser.enabled": true });
  const module = createModule(core);
  const recordedEvents = [];

  core.eventBus.onModuleEvent("module.squadCreationOrder", "recorded", (event) => {
    recordedEvents.push(event);
  });

  await module.start();

  core.eventBus.emitCoreEvent("On_SquadCreated", createSquadCreatedEvent());
  core.eventBus.emitCoreEvent("On_SquadCreated", createSquadCreatedEvent({
    eventId: "BZSS_Main:session-a:124",
    seq: "124",
    time: "2026-05-07 22:10:25.277",
    paramMap: {
      SquadID: "2",
      SquadName: "HAT",
      TeamID: "1",
      TeamName: "PLA",
      PlayerName: "PlayerB",
      Steam64ID: "7656119-steam-b",
      EOSID: "0002-eos-b",
    },
  }));

  const records = module.api.getCurrentOrder("BZSS_Main");
  assert.equal(records.length, 2);
  assert.equal(records[0].order, 1);
  assert.equal(records[0].squadID, "1");
  assert.equal(records[0].status, "active");
  assert.equal(records[0].statusConfidence, "created_by_log");
  assert.equal(records[1].order, 2);
  assert.equal(records[1].squadName, "HAT");
  assert.equal(recordedEvents.length, 2);
  assert.equal(recordedEvents[1].eventName, "module.squadCreationOrder.recorded");
  assert.equal(recordedEvents[1].records.length, 2);
}

async function testDedupesSameSourceEventId() {
  const core = createCore({ "pythonLogParser.enabled": true });
  const module = createModule(core);
  await module.start();

  const event = createSquadCreatedEvent();
  core.eventBus.emitCoreEvent("On_SquadCreated", event);
  core.eventBus.emitCoreEvent("On_SquadCreated", event);

  const records = module.api.getCurrentOrder("BZSS_Main");
  assert.equal(records.length, 1);
  assert.equal(records[0].order, 1);
}

async function testSeparatesSessionsAndSupportsClearApi() {
  const core = createCore({ "pythonLogParser.enabled": true });
  const module = createModule(core);
  await module.start();

  core.eventBus.emitCoreEvent("On_SquadCreated", createSquadCreatedEvent());
  core.eventBus.emitCoreEvent("On_SquadCreated", createSquadCreatedEvent({
    eventId: "BZSS_Main:session-b:1",
    sessionId: "session-b",
    seq: "1",
    paramMap: {
      SquadID: "1",
      SquadName: "LOGI",
      TeamID: "1",
      TeamName: "PLA",
      PlayerName: "PlayerC",
    },
  }));

  const sessionARecords = module.api.getOrderBySession("BZSS_Main", "session-a");
  const sessionBRecords = module.api.getOrderBySession("BZSS_Main", "session-b");

  assert.equal(sessionARecords.length, 1);
  assert.equal(sessionBRecords.length, 1);
  assert.equal(sessionBRecords[0].order, 1);
  assert.equal(module.api.getCurrentOrder("BZSS_Main")[0].sessionId, "session-b");

  module.api.clearSession("BZSS_Main", "session-b");
  assert.equal(module.api.getOrderBySession("BZSS_Main", "session-b").length, 0);
  assert.equal(module.api.getCurrentOrder("BZSS_Main").length, 0);

  module.api.clearServer("BZSS_Main");
  assert.equal(module.api.getOrderBySession("BZSS_Main", "session-a").length, 0);
}

async function testReusedSquadSlotMarksPreviousRecordReplaced() {
  const core = createCore({ "pythonLogParser.enabled": true });
  const module = createModule(core);
  await module.start();

  core.eventBus.emitCoreEvent("On_SquadCreated", createSquadCreatedEvent());
  core.eventBus.emitCoreEvent("On_SquadCreated", createSquadCreatedEvent({
    eventId: "BZSS_Main:session-a:124",
    seq: "124",
    paramMap: {
      SquadID: "1",
      SquadName: "INF NEW",
      TeamID: "1",
      TeamName: "PLA",
      PlayerName: "PlayerB",
    },
  }));

  const records = module.api.getCurrentOrder("BZSS_Main");
  assert.equal(records.length, 2);
  assert.equal(records[0].status, "replaced");
  assert.equal(records[0].generation, 1);
  assert.equal(records[1].status, "active");
  assert.equal(records[1].generation, 2);
  assert.equal(records[1].reusedSlot, true);
}

async function testRconMissingRequiresConfirmationBeforeDisbanded() {
  const core = createCore({
    "pythonLogParser.enabled": true,
    "rcon.enabled": true,
    "modules.squadCreationOrder": {
      missingConfirmSnapshots: 2,
      missingConfirmMs: 0,
    },
  });
  const module = createModule(core);
  const disbandedEvents = [];

  core.eventBus.onModuleEvent("module.squadCreationOrder", "disbandedInferred", (event) => {
    disbandedEvents.push(event);
  });

  await module.start();

  core.eventBus.emitCoreEvent("On_SquadCreated", createSquadCreatedEvent());
  core.eventBus.emitCoreEvent("RCON_LIST_SQUADS_UPDATED", {
    serverId: "BZSS_Main",
    squads: [{
      teamID: 1,
      teamName: "PLA",
      squadID: 1,
      squadName: "INF",
      creatorName: "PlayerA",
    }],
  });

  let records = module.api.getCurrentOrder("BZSS_Main");
  assert.equal(records[0].status, "active");
  assert.equal(records[0].statusConfidence, "confirmed_by_rcon");

  core.eventBus.emitCoreEvent("RCON_LIST_SQUADS_UPDATED", {
    serverId: "BZSS_Main",
    squads: [],
  });

  records = module.api.getCurrentOrder("BZSS_Main");
  assert.equal(records[0].status, "missing");
  assert.equal(records[0].missingSnapshotCount, 1);
  assert.equal(disbandedEvents.length, 0);

  core.eventBus.emitCoreEvent("RCON_LIST_SQUADS_UPDATED", {
    serverId: "BZSS_Main",
    squads: [],
  });

  records = module.api.getCurrentOrder("BZSS_Main");
  assert.equal(records[0].status, "disbanded");
  assert.equal(records[0].statusConfidence, "inferred_by_rcon_absence");
  assert.ok(records[0].disappearedAt);
  assert.equal(disbandedEvents.length, 1);
}

async function testRconOnlySquadsDoNotReceiveRealOrder() {
  const core = createCore({
    "pythonLogParser.enabled": true,
    "rcon.enabled": true,
  });
  const module = createModule(core);
  await module.start();

  core.eventBus.emitCoreEvent("On_SquadCreated", createSquadCreatedEvent());
  core.eventBus.emitCoreEvent("RCON_LIST_SQUADS_UPDATED", {
    serverId: "BZSS_Main",
    squads: [
      {
        teamID: 1,
        teamName: "PLA",
        squadID: 1,
        squadName: "INF",
      },
      {
        teamID: 1,
        teamName: "PLA",
        squadID: 2,
        squadName: "RCON ONLY",
      },
    ],
  });
  core.eventBus.emitCoreEvent("RCON_LIST_SQUADS_UPDATED", {
    serverId: "BZSS_Main",
    squads: [
      {
        teamID: 1,
        teamName: "PLA",
        squadID: 1,
        squadName: "INF",
      },
      {
        teamID: 1,
        teamName: "PLA",
        squadID: 2,
        squadName: "RCON ONLY",
      },
    ],
  });

  const records = module.api.getCurrentOrder("BZSS_Main");
  assert.equal(records.length, 2);
  assert.equal(records[0].order, 1);
  assert.equal(records[1].order, null);
  assert.equal(records[1].source, "rcon_snapshot_without_log");
  assert.equal(records[1].statusConfidence, "rcon_only");
}

async function testNoRconPermissionStillRecordsLogOrder() {
  const core = createCore({
    "pythonLogParser.enabled": true,
    "rcon.enabled": false,
  });
  const module = createModule(core);
  await module.start();

  core.eventBus.emitCoreEvent("On_SquadCreated", createSquadCreatedEvent());
  core.eventBus.emitCoreEvent("RCON_LIST_SQUADS_UPDATED", {
    serverId: "BZSS_Main",
    squads: [],
  });

  const records = module.api.getCurrentOrder("BZSS_Main");
  assert.equal(records.length, 1);
  assert.equal(records[0].order, 1);
  assert.equal(records[0].status, "active");
  assert.equal(records[0].statusConfidence, "created_by_log");
}

async function testNewSessionClearsActiveSlotsButKeepsHistorySeparated() {
  const core = createCore({
    "pythonLogParser.enabled": true,
    "rcon.enabled": true,
    "modules.squadCreationOrder": {
      missingConfirmSnapshots: 2,
      missingConfirmMs: 0,
    },
  });
  const module = createModule(core);
  await module.start();

  core.eventBus.emitCoreEvent("On_SquadCreated", createSquadCreatedEvent());
  core.eventBus.emitCoreEvent("On_SquadCreated", createSquadCreatedEvent({
    eventId: "BZSS_Main:session-b:1",
    sessionId: "session-b",
    seq: "1",
    paramMap: {
      SquadID: "1",
      SquadName: "NEW SESSION",
      TeamID: "1",
      TeamName: "PLA",
      PlayerName: "PlayerC",
    },
  }));

  core.eventBus.emitCoreEvent("RCON_LIST_SQUADS_UPDATED", {
    serverId: "BZSS_Main",
    squads: [],
  });

  assert.equal(module.api.getOrderBySession("BZSS_Main", "session-a")[0].status, "active");
  assert.equal(module.api.getOrderBySession("BZSS_Main", "session-b")[0].status, "missing");
}

await testRequiresLogReadPermission();
await testRecordsOrderAndEmitsModuleEvent();
await testDedupesSameSourceEventId();
await testSeparatesSessionsAndSupportsClearApi();
await testReusedSquadSlotMarksPreviousRecordReplaced();
await testRconMissingRequiresConfirmationBeforeDisbanded();
await testRconOnlySquadsDoNotReceiveRealOrder();
await testNoRconPermissionStillRecordsLogOrder();
await testNewSessionClearsActiveSlotsButKeepsHistorySeparated();

console.log("squad creation order tests passed");
