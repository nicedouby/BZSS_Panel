import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

import { createMatchStateModule } from "../modules/match-state/index.js";

function createHarness({ sessionStateFile = "", logs = [], subscribed = true, squadRestrictionMonitor = null } = {}) {
  const subscriptionState = { subscribed };
  const coreEvents = [];
  const moduleEvents = [];
  const commandCalls = [];
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
      "Team ID: 2 (Russian Ground Forces)",
    ].join("\n"),
    ShowCurrentMap: "Current level is AlBasrah, layer is AlBasrah_RAAS_v1",
    ShowNextMap: "Next level is Fallujah, layer is Fallujah_RAAS_v2",
  };

  const listeners = new Map();

  const core = {
    logger: makeLogger(logs),
    eventBus: {
      onCoreEvent(eventName, handler) {
        if (!listeners.has(eventName)) listeners.set(eventName, []);
        listeners.get(eventName).push(handler);
        return () => {
          const arr = listeners.get(eventName);
          const idx = arr.indexOf(handler);
          if (idx !== -1) arr.splice(idx, 1);
        };
      },
      emitCoreEvent(eventName, event) {
        coreEvents.push({ eventName, event });
        const arr = listeners.get(eventName);
        if (arr) {
          for (const handler of arr) handler(event);
        }
      },
      emitModuleEvent(moduleId, eventName, event) {
        moduleEvents.push({ moduleId, eventName, event });
      },
    },
    rconManager: {
      async dispatchCommand({ command }) {
        commandCalls.push(command);
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
        const value = {
          enabled: true,
          polling: {
            serverInfoIntervalMs: 0,
            playersIntervalMs: 0,
            squadsIntervalMs: 0,
            currentMapIntervalMs: 0,
            nextMapIntervalMs: 0,
          },
        };
        if (sessionStateFile) {
          value.sessionStateFile = sessionStateFile;
        }
        return value;
      }
      return defaultValue;
    },
  };

  const modules = {
    pluginSubscriptions: {
      isSubscribed() {
        return subscriptionState.subscribed;
      },
    },
    ...(squadRestrictionMonitor ? { squadRestrictionMonitor } : {}),
  };

  return {
    module: createMatchStateModule({ core, modules, config }),
    core,
    coreEvents,
    moduleEvents,
    commandCalls,
    responses,
    webStatusState,
    logs,
    subscriptionState,
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

function sleep(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  assert.deepEqual(state.squads.teams, [
    { teamID: 1, teamName: "USA" },
    { teamID: 2, teamName: "Russian Ground Forces" },
  ]);

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

async function testRestrictionMonitorEnrichesSquadSnapshot() {
  let evaluated = 0;
  const harness = createHarness({
    squadRestrictionMonitor: {
      evaluateSquads(squads) {
        evaluated += 1;
        return squads.map((squad) => ({
          ...squad,
          squadTypeId: "ifv",
          squadTypeLabel: "IFV / 步战车",
          restrictionViolation: true,
          restrictionReasons: ["测试违规原因"],
        }));
      },
    },
  });

  await harness.module.api.refresh("squads");
  const state = harness.module.api.getState();
  assert.equal(evaluated, 1);
  assert.equal(state.squads.list[0].squadTypeId, "ifv");
  assert.equal(state.squads.list[0].restrictionViolation, true);
  assert.deepEqual(state.squads.list[0].restrictionReasons, ["测试违规原因"]);
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

async function testIngestWorldBringUp() {
  const harness = createHarness();
  await harness.module.start();

  const event = {
    eventName: "round.world_bring_up",
    serverId: "BZSS_Main",
    normalized: {
      roundWorldBringUp: {
        mapName: "Al Basrah",
        layerName: "Al Basrah RAAS v1",
        gameMode: "RAAS",
        worldPath: "/Game/Maps/Al_Basrah/Al_Basrah_RAAS_v1",
        logLineTime: "2023.01.01-12.00.00:000",
        serverPlayAt: "2023.01.01-12.00.00:000",
        maxTickRate: 20,
        logTimeStartedAtMs: Date.now(),
      },
    },
  };

  harness.core.eventBus.emitCoreEvent("round.world_bring_up", event);

  const state = harness.module.api.getState();
  assert.equal(state.round.current.mapName, "Al Basrah");
  assert.equal(state.round.current.layerName, "Al Basrah RAAS v1");
  assert.equal(state.match.phase, "warmup");
  assert.equal(harness.webStatusState.matchPhase, "warmup");

  const roundOverview = harness.module.api.getRoundOverview();
  assert.equal(roundOverview.roundState.current.mapName, "Al Basrah");
  assert.equal(roundOverview.roundState.history.length, 1);

  assert.ok(harness.moduleEvents.some((item) => item.eventName === "roundUpdated"));
  // Legacy event check
  assert.ok(harness.moduleEvents.some((item) => item.moduleId === "module.roundState" && item.eventName === "updated"));
}

async function testStartedModuleSyncsPlayersAndSquadsFromRconEvents() {
  const harness = createHarness();
  await harness.module.start();
  await sleep();

  assert.equal(harness.commandCalls.includes("ListPlayers"), false);
  assert.equal(harness.commandCalls.includes("ListSquads"), false);

  harness.core.eventBus.emitCoreEvent("RCON_LIST_PLAYERS_UPDATED", {
    eventName: "RCON_LIST_PLAYERS_UPDATED",
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 7,
        steamID: "76561198000000007",
        eosID: "eos-7",
        name: "Bob",
        teamID: 2,
        squadID: 3,
        isLeader: false,
        role: "Medic",
      },
    ],
    time: new Date().toISOString(),
  });

  harness.core.eventBus.emitCoreEvent("RCON_LIST_SQUADS_UPDATED", {
    eventName: "RCON_LIST_SQUADS_UPDATED",
    serverId: "BZSS_Main",
    squads: [
      {
        teamID: 2,
        squadID: 3,
        squadName: "Bravo",
        size: 1,
      },
    ],
    time: new Date().toISOString(),
  });

  const state = harness.module.api.getState();
  assert.equal(state.players.count, 1);
  assert.equal(state.players.bySteam64ID["76561198000000007"].name, "Bob");
  assert.equal(state.squads.count, 1);
  assert.equal(state.squads.list[0].squadName, "Bravo");
  assert.equal(harness.webStatusState.playerCount, 1);
  assert.equal(harness.webStatusState.squadCount, 1);

  await harness.module.stop();
}

async function testMatchStateSessionContinuityAcrossRestart() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-match-state-"));
  const sessionStateFile = path.join(tempDir, "match-state-session.json");
  const sameMatchMessage = "/xm 当前对局与上一次关闭的对局为同一对局";

  try {
    const firstHarness = createHarness({ sessionStateFile, logs: [] });
    await firstHarness.module.start();
    await firstHarness.module.api.refresh("all");
    await firstHarness.module.stop();

    const persisted = JSON.parse(await fs.readFile(sessionStateFile, "utf8"));
    assert.equal(persisted.version, 1);
    assert.ok(persisted.servers.BZSS_Main);
    assert.equal(persisted.servers.BZSS_Main.baseKey, "albasrah|albasrah_raas_v1|raas");

    const restartLogs = [];
    const secondHarness = createHarness({ sessionStateFile, logs: restartLogs });
    await secondHarness.module.start();
    await secondHarness.module.api.refresh("all");
    await secondHarness.module.api.refresh("all");

    const sameMatchLogs = restartLogs.filter((entry) => entry.message === sameMatchMessage);
    assert.equal(sameMatchLogs.length, 1);
    assert.equal(sameMatchLogs[0].level, "info");
    assert.equal(sameMatchLogs[0].context?.operation, "matchState.sameMatchRestored");
    assert.equal(sameMatchLogs[0].context?.data?.serverId, "BZSS_Main");

    await secondHarness.module.stop();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testMatchStateSessionContinuityAcrossSubscriptionToggle() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-match-state-"));
  const sessionStateFile = path.join(tempDir, "match-state-session.json");
  const sameMatchMessage = "/xm 当前对局与上一次关闭的对局为同一对局";

  try {
    const harness = createHarness({ sessionStateFile, logs: [], subscribed: true });
    await harness.module.start();
    await harness.module.api.refresh("all");

    harness.subscriptionState.subscribed = false;
    await harness.module.api.refresh("serverInfo");

    const persisted = JSON.parse(await fs.readFile(sessionStateFile, "utf8"));
    assert.equal(persisted.servers.BZSS_Main.baseKey, "albasrah|albasrah_raas_v1|raas");
    assert.ok(harness.logs.some((entry) => String(entry.message).includes("订阅已关闭，已保存上一局对局指纹")));

    harness.subscriptionState.subscribed = true;
    await harness.module.api.refresh("all");

    const sameMatchLogs = harness.logs.filter((entry) => entry.message === sameMatchMessage);
    assert.equal(sameMatchLogs.length, 1);
    assert.ok(harness.logs.some((entry) => String(entry.message).includes("订阅已重新开启，正在比对当前对局")));

    await harness.module.stop();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testMatchStateSessionStateMissingOrCorruptFileDoesNotCrash() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-match-state-"));
  const missingFile = path.join(tempDir, "missing-session.json");
  const corruptFile = path.join(tempDir, "corrupt-session.json");
  const corruptLogs = [];

  try {
    const missingHarness = createHarness({ sessionStateFile: missingFile, logs: [] });
    await missingHarness.module.start();
    await missingHarness.module.api.refresh("serverInfo");
    await missingHarness.module.stop();

    await fs.writeFile(corruptFile, "{not-json", "utf8");
    const corruptHarness = createHarness({ sessionStateFile: corruptFile, logs: corruptLogs });
    await corruptHarness.module.start();
    await corruptHarness.module.api.refresh("serverInfo");
    await corruptHarness.module.stop();

    assert.ok(corruptLogs.some((entry) => entry.level === "warn" && String(entry.message).includes("session state read failed")));
    assert.ok(!corruptLogs.some((entry) => entry.message === "/xm 当前对局与上一次关闭的对局为同一对局"));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testMatchStateSessionDifferentMapDoesNotMatchPreviousMatch() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-match-state-"));
  const sessionStateFile = path.join(tempDir, "match-state-session.json");
  const sameMatchMessage = "/xm 当前对局与上一次关闭的对局为同一对局";
  const differentMatchMessage = "/xm 当前对局与上一次关闭的对局不是同一对局";

  try {
    const firstHarness = createHarness({ sessionStateFile, logs: [] });
    await firstHarness.module.start();
    await firstHarness.module.api.refresh("all");
    await firstHarness.module.stop();

    const secondHarness = createHarness({ sessionStateFile, logs: [] });
    secondHarness.responses.ShowServerInfo = [
      "MapName_s=Yehorivka",
      "Layer_s=Yehorivka_RAAS_v2",
      "GameMode_s=RAAS",
      "NextLayer_s=Fallujah_RAAS_v2",
      "PlayerCount_I=1",
      "MaxPlayers_I=100",
      "Queue_I=2",
      "PLAYTIME_I=123",
      "ServerTPS=29.7",
    ].join("\n");
    secondHarness.responses.ShowCurrentMap = "Current level is Yehorivka, layer is Yehorivka_RAAS_v2";
    secondHarness.responses.ShowNextMap = "Next level is Fallujah, layer is Fallujah_RAAS_v2";

    await secondHarness.module.start();
    await secondHarness.module.api.refresh("all");
    await secondHarness.module.stop();

    assert.equal(secondHarness.logs.filter((entry) => entry.message === sameMatchMessage).length, 0);
    assert.equal(secondHarness.logs.filter((entry) => entry.message === differentMatchMessage).length, 1);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

await testAggregatesRconSnapshots();
await testRestrictionMonitorEnrichesSquadSnapshot();
await testMissingServerInfoFieldsDoNotClobberLastGoodValues();
await testJsonShowServerInfoUpdatesPlaytime();
await testLayerSuffixDerivesModeWhenGameModeMissing();
await testJsonShowNextMapUpdatesNextLayerWhenServerInfoOmitsIt();
await testMatchingNextLayerIsCleared();
await testRefreshFailurePreservesLastGoodSnapshot();
await testIngestWorldBringUp();
await testStartedModuleSyncsPlayersAndSquadsFromRconEvents();
await testMatchStateSessionContinuityAcrossRestart();
await testMatchStateSessionContinuityAcrossSubscriptionToggle();
await testMatchStateSessionStateMissingOrCorruptFileDoesNotCrash();
await testMatchStateSessionDifferentMapDoesNotMatchPreviousMatch();

console.log("match state tests passed");
