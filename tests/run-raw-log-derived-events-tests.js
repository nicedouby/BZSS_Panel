import assert from "node:assert/strict";

import { EventBus } from "../core/event-bus.js";
import { RawLogDerivedEvents } from "../core/raw-log-derived-events.js";

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

function testJoinSucceededDerivesConnectedEvent() {
  const logger = createSilentLogger();
  const eventBus = new EventBus({ logger });

  const deriver = new RawLogDerivedEvents({ eventBus, logger });
  deriver.start();

  let emitted = null;
  eventBus.onCoreEvent("PLAYER_CONNECTED", (event) => {
    emitted = event;
  });

  eventBus.emitCoreEvent("On_RawLogLine", {
    eventId: "S:SS:1",
    eventName: "On_RawLogLine",
    serverId: "BZSS_Main",
    time: "2026-06-04 01:12:30.000",
    logTime: "2026.06.04-01.12.30:000",
    rawLog: "[2026.06.04-01.12.30:000][996]LogNet: Join succeeded: Alice",
    paramMap: {},
    params: [],
  });

  assert.ok(emitted);
  assert.equal(emitted.eventName, "PLAYER_CONNECTED");
  assert.equal(emitted.serverId, "BZSS_Main");
  assert.equal(emitted.payload.playerName, "Alice");
  assert.equal(emitted.paramMap.PlayerName, "Alice");
}

function testUnetCloseDerivesDisconnectedEvent() {
  const logger = createSilentLogger();
  const eventBus = new EventBus({ logger });

  const deriver = new RawLogDerivedEvents({ eventBus, logger });
  deriver.start();

  let emitted = null;
  eventBus.onCoreEvent("PLAYER_DISCONNECTED", (event) => {
    emitted = event;
  });

  const raw = "[2026.06.04-01.12.31:244][997]LogNet: UNetConnection::Close: [UNetConnection] RemoteAddr: 192.168.0.1:24049, Name: RedpointEOSIpNetConnection_2147481769, Driver: Name:GameNetDriver Def:GameNetDriver RedpointEOSNetDriver_2147482319, IsServer: YES, PC: BP_PlayerController_C_2147481748, Owner: BP_PlayerController_C_2147481748, UniqueId: RedpointEOS:00026a0bbf67442f84777b964560fba4, Channels: 208, Time: 2026.06.04-01.12.31";

  eventBus.emitCoreEvent("On_RawLogLine", {
    eventId: "S:SS:2",
    eventName: "On_RawLogLine",
    serverId: "BZSS_Main",
    time: "2026-06-04 01:12:31.244",
    logTime: "2026.06.04-01.12.31:244",
    rawLog: raw,
    paramMap: {},
    params: [],
  });

  assert.ok(emitted);
  assert.equal(emitted.eventName, "PLAYER_DISCONNECTED");
  assert.equal(emitted.payload.remoteAddr, "192.168.0.1:24049");
  assert.equal(emitted.payload.playerControllerId, "BP_PlayerController_C_2147481748");
  assert.equal(emitted.payload.eosId, "00026a0bbf67442f84777b964560fba4");
  assert.equal(emitted.payload.channels, 208);
  assert.equal(emitted.payload.isServer, true);
}

function run() {
  testJoinSucceededDerivesConnectedEvent();
  testUnetCloseDerivesDisconnectedEvent();
  console.log("[run-raw-log-derived-events-tests] OK");
}

run();
