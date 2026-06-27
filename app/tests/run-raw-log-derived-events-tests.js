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

function testLogSquadPostLoginDerivesIdentityFields() {
  const logger = createSilentLogger();
  const eventBus = new EventBus({ logger });

  const deriver = new RawLogDerivedEvents({ eventBus, logger });
  deriver.start();

  let emitted = null;
  eventBus.onCoreEvent("PLAYER_POST_LOGIN", (event) => {
    emitted = event;
  });

  const raw = "[2026.06.14-03.22.17:220][665]LogSquad: PostLogin: NewPlayer: BP_PlayerController_C /Game/Maps/Sumari/Gameplay_Layers/Sumari_Seed_v1.Sumari_Seed_v1:PersistentLevel.BP_PlayerController_C_2147359428 (IP: 192.168.0.1 | Online IDs: EOS: 0002633b5836480d9593507d5ea0d8c7 steam: 76561199666599666)";

  eventBus.emitCoreEvent("On_RawLogLine", {
    eventId: "S:SS:3",
    eventName: "On_RawLogLine",
    serverId: "BZSS_Main",
    time: "2026-06-14 03:22:17.220",
    logTime: "2026.06.14-03.22.17:220",
    rawLog: raw,
    paramMap: {},
    params: [],
  });

  assert.ok(emitted);
  assert.equal(emitted.eventName, "PLAYER_POST_LOGIN");
  assert.equal(emitted.payload.ip, "192.168.0.1");
  assert.equal(emitted.payload.eosId, "0002633b5836480d9593507d5ea0d8c7");
  assert.equal(emitted.payload.steam64Id, "76561199666599666");
  assert.equal(emitted.paramMap.PlayerEOSID, "0002633b5836480d9593507d5ea0d8c7");
  assert.equal(emitted.paramMap.PlayerSteam64ID, "76561199666599666");
}

function run() {
  testJoinSucceededDerivesConnectedEvent();
  testUnetCloseDerivesDisconnectedEvent();
  testLogSquadPostLoginDerivesIdentityFields();
  console.log("[run-raw-log-derived-events-tests] OK");
}

run();
