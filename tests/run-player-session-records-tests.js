import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

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
  const historyFilePath = path.join(
    os.tmpdir(),
    `player-session-records-test-${Date.now()}-${Math.random().toString(16).slice(2)}.jsonl`,
  );
  const players = new Map([
    ["BZSS_Main::steam::76561199666599667", { name: "Delta", steamID: "76561199666599667", eosID: "0002633b5836480d9593507d5ea0d8c8" }],
    ["BZSS_Main::eos::0002633b5836480d9593507d5ea0d8c8", { name: "Delta", steamID: "76561199666599667", eosID: "0002633b5836480d9593507d5ea0d8c8" }],
  ]);
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
    modules: {
      lianbanKick: {
        findMatchByIdentity(identity = {}) {
          if (identity?.steamID === "76561199666599667" || identity?.eosID === "0002633b5836480d9593507d5ea0d8c8") {
            return {
              matched: true,
              matchKey: identity?.steamID ? "steamID" : "eosID",
              matchedValue: identity?.steamID || identity?.eosID,
              fileName: "bans.cfg",
              lineNumber: 12,
              lineText: "76561199666599667:0//联办测试",
            };
          }
          return null;
        },
      },
      playerState: {
        getPlayerBySteamID(serverId, steamID) {
          return players.get(`${serverId}::steam::${steamID}`) ?? null;
        },
        getPlayerByEOSID(serverId, eosID) {
          return players.get(`${serverId}::eos::${eosID}`) ?? null;
        },
        getPlayerByControllerID() {
          return null;
        },
        getPlayerByName() {
          return null;
        },
      },
      playerDatabase: {
        getCachedPlayer(identity = {}) {
          if (identity?.steamID === "76561199666599666" || identity?.eosID === "0002633b5836480d9593507d5ea0d8c7") {
            return {
              current_name: "Braovo",
              steam_id: "76561199666599666",
              eos_id: "0002633b5836480d9593507d5ea0d8c7",
            };
          }
          return null;
        },
      },
    },
    config: {
      get(pathKey, defaultValue) {
        if (pathKey === "modules.playerSessionRecords") {
          return {
            ...(defaultValue ?? {}),
            filePath: historyFilePath,
          };
        }
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
      name: "Delta",
      playerName: "Delta",
      ip: "1.2.3.4",
      eosId: "0002633b5836480d9593507d5ea0d8c8",
      steam64Id: "76561199666599667",
    },
    paramMap: {
      PlayerName: "Delta",
      PlayerIP: "1.2.3.4",
      PlayerEOSID: "0002633b5836480d9593507d5ea0d8c8",
      PlayerSteam64ID: "76561199666599667",
    },
  });

  const state = module.api.getState(10);
  assert.equal(state.joinCount, 1);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].eventName, "PLAYER_POST_LOGIN");
  assert.equal(state.records[0].ip, "1.2.3.4");
  assert.equal(state.records[0].lianban?.matched, true);
  assert.equal(state.records[0].lianban?.label, "被联办");

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

async function testLogSquadPostLoginFallbackStillRecordsJoin() {
  const { module, eventBus } = createModule();
  await module.start();

  eventBus.emitCoreEvent("On_PlayerConnected", {
    eventId: "e3b",
    eventName: "On_PlayerConnected",
    serverId: "BZSS_Main",
    time: "2026-06-13T10:05:30.000Z",
    rawEvent: {
      Raw: "[2026.06.13-10.05.30:000]LogSquad: PostLogin: NewPlayer: BP_PlayerController_C_3 (IP: 9.8.7.6 | Online IDs: EOS: 0002633b5836480d9593507d5ea0d8c7 steam: 76561199666599666)",
    },
    payload: {
      name: "Carol",
      playerName: "Carol",
      ip: "9.8.7.6",
    },
    paramMap: {
      PlayerName: "Carol",
      IP: "9.8.7.6",
    },
  });

  const state = module.api.getState(10);
  assert.equal(state.joinCount, 1);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].eventName, "On_PlayerConnected");
  assert.equal(state.records[0].ip, "9.8.7.6");

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

async function testUnnamedDisconnectedEventIsIgnored() {
  const { module, eventBus } = createModule();
  await module.start();

  eventBus.emitCoreEvent("PLAYER_DISCONNECTED", {
    eventId: "e5",
    eventName: "PLAYER_DISCONNECTED",
    serverId: "BZSS_Main",
    time: "2026-06-13T10:11:00.000Z",
    payload: {
      ip: "1.2.3.4",
    },
    paramMap: {
      PlayerIP: "1.2.3.4",
    },
  });

  const state = module.api.getState(10);
  assert.equal(state.leaveCount, 0);
  assert.equal(state.records.length, 0);

  await module.stop();
}

async function testPostLoginUpgradesFallbackJoinInsteadOfDuplicating() {
  const { module, eventBus } = createModule();
  await module.start();

  eventBus.emitCoreEvent("On_PlayerConnected", {
    eventId: "e6",
    eventName: "On_PlayerConnected",
    serverId: "BZSS_Main",
    time: "2026-06-13T10:12:00.000Z",
    rawEvent: {
      Raw: "[2026.06.13-10.12.00:000]LogSquad: PostLogin: NewPlayer: BP_PlayerController_C_4 (IP: 2.3.4.5 | Online IDs: EOS: 0002633b5836480d9593507d5ea0d8c8 steam: 76561199666599667)",
    },
    payload: {
      ip: "2.3.4.5",
    },
    paramMap: {
      IP: "2.3.4.5",
    },
  });

  eventBus.emitCoreEvent("PLAYER_POST_LOGIN", {
    eventId: "e7",
    eventName: "PLAYER_POST_LOGIN",
    serverId: "BZSS_Main",
    time: "2026-06-13T10:12:01.000Z",
    payload: {
      ip: "2.3.4.5",
      eosId: "0002633b5836480d9593507d5ea0d8c8",
      steam64Id: "76561199666599667",
    },
    paramMap: {
      PlayerIP: "2.3.4.5",
      PlayerEOSID: "0002633b5836480d9593507d5ea0d8c8",
      PlayerSteam64ID: "76561199666599667",
    },
  });

  const state = module.api.getState(10);
  assert.equal(state.joinCount, 1);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].eventName, "PLAYER_POST_LOGIN");
  assert.equal(state.records[0].playerName, "Delta");
  assert.equal(state.records[0].ip, "2.3.4.5");
  assert.equal(state.records[0].eosId, "0002633b5836480d9593507d5ea0d8c8");
  assert.equal(state.records[0].steam64Id, "76561199666599667");

  await module.stop();
}

async function testFallbackJoinAfterPostLoginDoesNotDuplicate() {
  const { module, eventBus } = createModule();
  await module.start();

  eventBus.emitCoreEvent("PLAYER_POST_LOGIN", {
    eventId: "e8",
    eventName: "PLAYER_POST_LOGIN",
    serverId: "BZSS_Main",
    time: "2026-06-13T10:13:00.000Z",
    payload: {
      ip: "6.7.8.9",
      eosId: "0002633b5836480d9593507d5ea0d8c8",
      steam64Id: "76561199666599667",
    },
    paramMap: {
      PlayerIP: "6.7.8.9",
      PlayerEOSID: "0002633b5836480d9593507d5ea0d8c8",
      PlayerSteam64ID: "76561199666599667",
    },
  });

  eventBus.emitCoreEvent("On_PlayerConnected", {
    eventId: "e9",
    eventName: "On_PlayerConnected",
    serverId: "BZSS_Main",
    time: "2026-06-13T10:13:01.000Z",
    rawEvent: {
      Raw: "[2026.06.13-10.13.01:000]LogSquad: PostLogin: NewPlayer: BP_PlayerController_C_5 (IP: 6.7.8.9 | Online IDs: EOS: 0002633b5836480d9593507d5ea0d8c8 steam: 76561199666599667)",
    },
    payload: {
      ip: "6.7.8.9",
    },
    paramMap: {
      IP: "6.7.8.9",
    },
  });

  const state = module.api.getState(10);
  assert.equal(state.joinCount, 1);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].eventName, "PLAYER_POST_LOGIN");
  assert.equal(state.records[0].playerName, "Delta");

  await module.stop();
}

async function testJoinNameFallsBackToPlayerDatabaseCache() {
  const { module, eventBus } = createModule();
  await module.start();

  eventBus.emitCoreEvent("PLAYER_POST_LOGIN", {
    eventId: "e10",
    eventName: "PLAYER_POST_LOGIN",
    serverId: "BZSS_Main",
    time: "2026-06-13T10:14:00.000Z",
    payload: {
      ip: "192.168.0.1",
      eosId: "0002633b5836480d9593507d5ea0d8c7",
      steam64Id: "76561199666599666",
    },
    paramMap: {
      PlayerIP: "192.168.0.1",
      PlayerEOSID: "0002633b5836480d9593507d5ea0d8c7",
      PlayerSteam64ID: "76561199666599666",
    },
  });

  const state = module.api.getState(10);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].playerName, "Braovo");
  assert.equal(state.records[0].eosId, "0002633b5836480d9593507d5ea0d8c7");
  assert.equal(state.records[0].steam64Id, "76561199666599666");

  await module.stop();
}

async function run() {
  await testOnlyAnchoredJoinEventsAreRecorded();
  await testLegacyPostLoginFallbackStillRecordsJoin();
  await testLogSquadPostLoginFallbackStillRecordsJoin();
  await testDisconnectedEventIsRecordedForLeave();
  await testUnnamedDisconnectedEventIsIgnored();
  await testPostLoginUpgradesFallbackJoinInsteadOfDuplicating();
  await testFallbackJoinAfterPostLoginDoesNotDuplicate();
  await testJoinNameFallsBackToPlayerDatabaseCache();
  console.log("[run-player-session-records-tests] OK");
}

run();
