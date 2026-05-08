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
    webRegistry: {
      registerPage() {},
    },
  };
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
      FactionName: "PLA",
      PlayerName: "玩家A",
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
  const module = createSquadCreationOrderModule({ core });

  await assert.rejects(
    module.start(),
    /Squad Creation Order plugin requires log\.read permission\./,
  );
}

async function testRecordsOrderAndEmitsModuleEvent() {
  const core = createCore({ "pythonLogParser.enabled": true });
  const module = createSquadCreationOrderModule({ core });
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
      PlayerName: "玩家B",
      Steam64ID: "7656119-steam-b",
      EOSID: "0002-eos-b",
    },
  }));

  const records = module.api.getCurrentOrder("BZSS_Main");
  assert.equal(records.length, 2);
  assert.equal(records[0].order, 1);
  assert.equal(records[0].squadID, "1");
  assert.equal(records[1].order, 2);
  assert.equal(records[1].squadName, "HAT");
  assert.equal(recordedEvents.length, 2);
  assert.equal(recordedEvents[1].eventName, "module.squadCreationOrder.recorded");
  assert.equal(recordedEvents[1].records.length, 2);
}

async function testDedupesSameSourceEventId() {
  const core = createCore({ "pythonLogParser.enabled": true });
  const module = createSquadCreationOrderModule({ core });
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
  const module = createSquadCreationOrderModule({ core });
  await module.start();

  core.eventBus.emitCoreEvent("On_SquadCreated", createSquadCreatedEvent());
  core.eventBus.emitCoreEvent("On_SquadCreated", createSquadCreatedEvent({
    eventId: "BZSS_Main:session-b:1",
    sessionId: "session-b",
    seq: "1",
    paramMap: {
      SquadID: "1",
      SquadName: "LOGI",
      PlayerName: "玩家C",
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

await testRequiresLogReadPermission();
await testRecordsOrderAndEmitsModuleEvent();
await testDedupesSameSourceEventId();
await testSeparatesSessionsAndSupportsClearApi();

console.log("squad creation order tests passed");
