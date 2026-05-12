import assert from "node:assert/strict";

import { createMatchStateModule } from "../modules/match-state/index.js";

function createHarness() {
  const coreEvents = [];
  const moduleEvents = [];
  const webStatusState = {
    serverId: "BZSS_Main",
    serverName: "BZSS Main Server",
    pythonLogParser: "running",
    udpReceiver: "listening",
  };
  const rconStatusState = {
    enabled: true,
    connected: true,
    authenticated: true,
    queueSize: 0,
    lastError: "",
  };

  const responses = {
    failCommands: new Set(),
    ShowServerInfo: [
      "MapName_s=AlBasrah",
      "Layer_s=AlBasrah_RAAS_v1",
      "GameMode_s=RAAS",
      "NextLayer_s=Fallujah_RAAS_v2",
      "PlayerCount_I=1",
      "MaxPlayers_I=100",
      "Queue_I=2",
      "PLAYTIME_I=123",
      "ServerTPS=29.7",
    ].join("\n"),
    ListPlayers: "ID: 1 | Online IDs: EOS: eos-1 steam: 76561198000000001 | Name: Alice | Team ID: 1 | Squad ID: 2 | Is Leader: True | Role: Rifleman",
    ListSquads: [
      "Team ID: 1 (USA)",
      "ID: 2 | Name: Alpha | Size: 1 | Locked: False | Creator Name: Alice | Creator Online IDs: EOS: eos-1 steam: 76561198000000001",
    ].join("\n"),
    ShowCurrentMap: "Current level is AlBasrah, layer is AlBasrah_RAAS_v1",
    ShowNextMap: "Next level is Fallujah, layer is Fallujah_RAAS_v2",
  };

  const core = {
    logger: {
      warn() {},
      module() {},
    },
    eventBus: {
      onCoreEvent() {
        return () => {};
      },
      emitCoreEvent(eventName, event) {
        coreEvents.push({ eventName, event });
      },
      emitModuleEvent(moduleId, eventName, event) {
        moduleEvents.push({ moduleId, eventName, event });
      },
    },
    rconManager: {
      async dispatchCommand({ command }) {
        if (responses.failCommands.has(command)) {
          rconStatusState.lastError = "simulated failure";
          return {
            success: false,
            message: "simulated failure",
            rconResponse: "",
          };
        }
        return {
          success: true,
          rconResponse: responses[command] ?? "",
        };
      },
      getStatus() {
        return { ...rconStatusState };
      },
    },
    webRegistry: {
      registerPage() {},
    },
    webStatus: {
      serverId: "BZSS_Main",
      getSnapshot() {
        return { ...webStatusState };
      },
      patch(patch) {
        Object.assign(webStatusState, patch);
      },
    },
  };

  const config = {
    get(path, defaultValue) {
      if (path === "modules.matchState") {
        return {
          enabled: true,
          polling: {
            serverInfoIntervalMs: 0,
            playersIntervalMs: 0,
            squadsIntervalMs: 0,
            currentMapIntervalMs: 0,
            nextMapIntervalMs: 0,
          },
        };
      }
      return defaultValue;
    },
  };

  return {
    module: createMatchStateModule({ core, modules: {}, config }),
    coreEvents,
    moduleEvents,
    responses,
    webStatusState,
  };
}

async function testAggregatesRconSnapshots() {
  const harness = createHarness();

  await harness.module.api.refresh("all");

  const state = harness.module.api.getState();
  assert.equal(state.serverStatus.map, "AlBasrah");
  assert.equal(state.serverStatus.layer, "AlBasrah_RAAS_v1");
  assert.equal(state.serverStatus.mode, "RAAS");
  assert.equal(state.serverStatus.nextLayer, "Fallujah_RAAS_v2");
  assert.equal(state.serverStatus.playerCount, 1);
  assert.equal(state.serverStatus.maxPlayers, 100);
  assert.equal(state.serverStatus.queueCount, 2);
  assert.equal(state.serverStatus.playtime, 123);
  assert.equal(state.serverStatus.tps, 29.7);
  assert.equal(state.serverStatus.tpsStatus, "good");

  assert.equal(state.players.count, 1);
  assert.equal(state.players.bySteam64ID["76561198000000001"].name, "Alice");
  assert.equal(state.players.byEOSID["eos-1"].name, "Alice");
  assert.equal(state.players.byName.Alice.isLeader, true);
  assert.equal(state.squads.count, 1);
  assert.equal(state.squads.list[0].squadName, "Alpha");

  assert.equal(harness.webStatusState.map, "AlBasrah");
  assert.equal(harness.webStatusState.layer, "AlBasrah_RAAS_v1");
  assert.equal(harness.webStatusState.mode, "RAAS");
  assert.equal(harness.webStatusState.nextLayer, "Fallujah_RAAS_v2");
  assert.equal(harness.webStatusState.playerCount, 1);
  assert.equal(harness.webStatusState.maxPlayers, 100);
  assert.equal(harness.webStatusState.queueCount, 2);
  assert.equal(harness.webStatusState.tps, 29.7);
  assert.equal(harness.webStatusState.tpsStatus, "good");
  assert.equal(harness.webStatusState.playtime, 123);
  assert.equal(harness.webStatusState.rconStatus, "connected");
  assert.equal(harness.webStatusState.logAccessGranted, true);
  assert.equal(harness.webStatusState.squadCount, 1);

  assert.ok(harness.moduleEvents.some((item) => item.eventName === "updated"));
  assert.ok(harness.moduleEvents.some((item) => item.eventName === "serverStatusUpdated"));
  assert.ok(harness.moduleEvents.some((item) => item.eventName === "playersUpdated"));
  assert.ok(harness.moduleEvents.some((item) => item.eventName === "squadsUpdated"));
  assert.ok(harness.coreEvents.some((item) => item.eventName === "RCON_MATCH_STATE_UPDATED"));
  assert.ok(harness.coreEvents.some((item) => item.eventName === "RCON_LIST_PLAYERS_UPDATED"));
  assert.ok(harness.coreEvents.some((item) => item.eventName === "RCON_LIST_SQUADS_UPDATED"));
}

async function testMissingServerInfoFieldsDoNotClobberLastGoodValues() {
  const harness = createHarness();

  await harness.module.api.refresh("serverInfo");
  harness.responses.ShowServerInfo = [
    "MapName_s=AlBasrah",
    "Layer_s=AlBasrah_RAAS_v1",
    "GameMode_s=RAAS",
  ].join("\n");

  await harness.module.api.refresh("serverInfo");
  const state = harness.module.api.getState();

  assert.equal(state.serverStatus.playerCount, 1);
  assert.equal(state.serverStatus.maxPlayers, 100);
  assert.equal(state.serverStatus.queueCount, 2);
  assert.equal(state.serverStatus.playtime, 123);
  assert.equal(state.serverStatus.nextLayer, "Fallujah_RAAS_v2");
  assert.equal(harness.webStatusState.playerCount, 1);
  assert.equal(harness.webStatusState.maxPlayers, 100);
  assert.equal(harness.webStatusState.playtime, 123);
}

async function testJsonShowServerInfoUpdatesPlaytime() {
  const harness = createHarness();
  harness.responses.ShowServerInfo = JSON.stringify({
    MaxPlayers: 100,
    GameMode_s: "RAAS",
    MapName_s: "Narva_RAAS_v1",
    ServerName_s: "BZSS Main Server",
    PLAYTIME_I: "4152",
    PlayerCount_I: "8",
  });

  await harness.module.api.refresh("serverInfo");
  const state = harness.module.api.getState();

  assert.equal(state.serverStatus.map, "Narva_RAAS_v1");
  assert.equal(state.serverStatus.mode, "RAAS");
  assert.equal(state.serverStatus.playerCount, 8);
  assert.equal(state.serverStatus.maxPlayers, 100);
  assert.equal(state.serverStatus.playtime, 4152);
  assert.equal(harness.webStatusState.playtime, 4152);
}

async function testLayerSuffixDerivesModeWhenGameModeMissing() {
  const harness = createHarness();
  harness.responses.ShowServerInfo = JSON.stringify({
    MaxPlayers: 100,
    MapName_s: "Narva_RAAS_v1",
    PLAYTIME_I: "4152",
    PlayerCount_I: "8",
    Layer_s: "Narva_RAAS_v1",
  });

  await harness.module.api.refresh("serverInfo");
  const state = harness.module.api.getState();

  assert.equal(state.serverStatus.layer, "Narva_RAAS_v1");
  assert.equal(state.serverStatus.mode, "RAAS");
  assert.equal(harness.webStatusState.mode, "RAAS");
}

async function testJsonShowNextMapUpdatesNextLayerWhenServerInfoOmitsIt() {
  const harness = createHarness();
  harness.responses.ShowServerInfo = JSON.stringify({
    MaxPlayers: 100,
    GameMode_s: "RAAS",
    MapName_s: "Narva_RAAS_v1",
    PLAYTIME_I: "4152",
    PlayerCount_I: "8",
  });
  harness.responses.ShowNextMap = JSON.stringify({
    NextLevel_s: "Belaya",
    NextLayer_s: "Belaya_RAAS_v3",
  });

  await harness.module.api.refresh("all");
  const state = harness.module.api.getState();

  assert.equal(state.serverStatus.nextLayer, "Belaya_RAAS_v3");
  assert.equal(harness.webStatusState.nextLayer, "Belaya_RAAS_v3");
}

async function testMatchingNextLayerIsCleared() {
  const harness = createHarness();
  harness.responses.ShowServerInfo = JSON.stringify({
    MaxPlayers: 100,
    GameMode_s: "RAAS",
    MapName_s: "Tallil_Outskirts",
    Layer_s: "Tallil_Outskirts_RAAS_v1",
    NextLayer_s: "Tallil_Outskirts_RAAS_v1",
    PlayerCount_I: "8",
  });

  await harness.module.api.refresh("serverInfo");
  const state = harness.module.api.getState();

  assert.equal(state.serverStatus.nextLayer, "");
  assert.equal(harness.webStatusState.nextLayer, "");
}

async function testRefreshFailurePreservesLastGoodSnapshot() {
  const harness = createHarness();

  await harness.module.api.refresh("all");
  harness.responses.failCommands.add("ListPlayers");

  await harness.module.api.refresh("players");
  const state = harness.module.api.getState();

  assert.equal(state.players.count, 1);
  assert.equal(state.players.bySteam64ID["76561198000000001"].name, "Alice");
  assert.equal(state.serverStatus.map, "AlBasrah");
  assert.equal(state.rconStatus.lastError, "simulated failure");
}

await testAggregatesRconSnapshots();
await testMissingServerInfoFieldsDoNotClobberLastGoodValues();
await testJsonShowServerInfoUpdatesPlaytime();
await testLayerSuffixDerivesModeWhenGameModeMissing();
await testJsonShowNextMapUpdatesNextLayerWhenServerInfoOmitsIt();
await testMatchingNextLayerIsCleared();
await testRefreshFailurePreservesLastGoodSnapshot();

console.log("match state tests passed");
