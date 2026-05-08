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

  const responses = {
    ShowServerInfo: [
      "MapName_s=AlBasrah",
      "Layer_s=AlBasrah_RAAS_v1",
      "GameMode_s=RAAS",
      "NextLayer_s=Fallujah_RAAS_v2",
      "PlayerCount_I=1",
      "MaxPlayers=100",
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
        return {
          success: true,
          rconResponse: responses[command] ?? "",
        };
      },
      getStatus() {
        return {
          enabled: true,
          connected: true,
          authenticated: true,
          queueSize: 0,
        };
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

await testAggregatesRconSnapshots();

console.log("match state tests passed");
