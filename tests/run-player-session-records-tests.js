import assert from "node:assert/strict";

import { EventBus } from "../core/event-bus.js";
import { createPlayerSessionRecordsModule } from "../modules/player-session-records/index.js";

function createSilentLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
    event() {},
    child() { return this; },
  };
}

function createModule() {
  const logger = createSilentLogger();
  const eventBus = new EventBus({ logger });
  const pages = [];
  const module = createPlayerSessionRecordsModule({
    core: {
      logger,
      eventBus,
      webRegistry: {
        registerPage(page) {
          pages.push(page);
        },
      },
      createLogger() {
        return logger;
      },
    },
    config: {
      get(_path, defaultValue) {
        return defaultValue;
      },
    },
    logger,
  });

  return { module, eventBus, pages };
}

async function testOnlyAnchoredJoinEventsAreRecorded() {
  const { module, eventBus } = createModule();
  await module.start();

  eventBus.emitCoreEvent("PLAYER_CONNECTED", {
    eventId: "e1",
    eventName: "PLAYER_CONNECTED",
    serverId: "BZSS_Main",
    time: "2026-06-13T10:00:00.000Z",
    payload: {
      name: "Alice",
      playerName: "Alice",
    },
    paramMap: {
      PlayerName: "Alice",
    },
  });

  eventBus.emitCoreEvent("PLAYER_POST_LOGIN", {
    eventId: "e2",
    eventName: "PLAYER_POST_LOGIN",
    serverId: "BZSS_Main",
    time: "2026-06-13T10:00:02.000Z",
    rawLog: "[2026.06.13-10.00.02:000]LogNet: PostLogin: NewPlayer: BP_PlayerController_C_1 (IP: 1.2.3.4|7777) Online IDs: EOS:abc steam:76561198000000000",
    payload: {
      name: "Alice",
      playerName: "Alice",
      ip: "1.2.3.4",
    },
    paramMap: {
      PlayerName: "Alice",
      PlayerIP: "1.2.3.4",
    },
  });

  const state = module.api.getState(10);
  assert.equal(state.joinCount, 1);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].eventName, "PLAYER_POST_LOGIN");
  assert.equal(state.records[0].ip, "1.2.3.4");

  await module.stop();
}

async function testLegacyPostLoginFallbackStillRecordsJoin() {
  const { module, eventBus } = createModule();
  await module.start();

  eventBus.emitCoreEvent("On_PlayerConnected", {
    eventId: "e3",
    eventName: "On_PlayerConnected",
    serverId: "BZSS_Main",
    time: "2026-06-13T10:05:00.000Z",
    rawEvent: {
      Raw: "[2026.06.13-10.05.00:000]LogNet: PostLogin: NewPlayer: BP_PlayerController_C_2 (IP: 5.6.7.8|7777) (Online IDs: EOS: def steam: 76561198000000001)",
    },
    payload: {
      name: "Bob",
      playerName: "Bob",
      ip: "5.6.7.8",
    },
    paramMap: {
      PlayerName: "Bob",
      IP: "5.6.7.8",
    },
  });

  const state = module.api.getState(10);
  assert.equal(state.joinCount, 1);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].eventName, "On_PlayerConnected");
  assert.equal(state.records[0].ip, "5.6.7.8");

  await module.stop();
}

async function testDisconnectedEventIsRecordedForLeave() {
  const { module, eventBus } = createModule();
  await module.start();

  eventBus.emitCoreEvent("PLAYER_DISCONNECTED", {
    eventId: "e4",
    eventName: "PLAYER_DISCONNECTED",
    serverId: "BZSS_Main",
    time: "2026-06-13T10:10:00.000Z",
    payload: {
      name: "Alice",
      playerName: "Alice",
      ip: "1.2.3.4",
    },
    paramMap: {
      PlayerName: "Alice",
      PlayerIP: "1.2.3.4",
    },
  });

  const state = module.api.getState(10);
  assert.equal(state.leaveCount, 1);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].eventName, "PLAYER_DISCONNECTED");
  assert.equal(state.records[0].ip, "1.2.3.4");

  await module.stop();
}

async function run() {
  await testOnlyAnchoredJoinEventsAreRecorded();
  await testLegacyPostLoginFallbackStillRecordsJoin();
  await testDisconnectedEventIsRecordedForLeave();
  console.log("[run-player-session-records-tests] OK");
}

run();
