import assert from "node:assert/strict";

import { createPlayerStateModule } from "../modules/player-state/index.js";

function createHarness({ modulesOverride = null, configOverrides = {} } = {}) {
  const listeners = new Map();
  const moduleListeners = new Map();
  const moduleEvents = [];
  const configValues = new Map(Object.entries(configOverrides));
  const core = {
    logger: { info() {}, debug() {}, warn() {}, module() {} },
    config: {
      get(key, defaultValue) {
        return configValues.has(key) ? configValues.get(key) : defaultValue;
      },
    },
    webStatus: { set() {} },
    eventBus: {
      onCoreEvent(eventName, handler) {
        if (!listeners.has(eventName)) listeners.set(eventName, new Set());
        listeners.get(eventName).add(handler);
        return () => listeners.get(eventName)?.delete(handler);
      },
      onModuleEvent(moduleId, eventName, handler) {
        const key = `${moduleId}:${eventName}`;
        if (!moduleListeners.has(key)) moduleListeners.set(key, new Set());
        moduleListeners.get(key).add(handler);
        return () => moduleListeners.get(key)?.delete(handler);
      },
      emitModuleEvent(moduleId, eventName, event) {
        moduleEvents.push({ moduleId, eventName, event });
        const exactKey = `${moduleId}:${eventName}`;
        const wildcardKey = `${moduleId}:*`;
        for (const handler of moduleListeners.get(exactKey) ?? []) handler(event);
        for (const handler of moduleListeners.get(wildcardKey) ?? []) handler(event);
      },
    },
  };

  const modules = modulesOverride ?? {};

  return {
    listeners,
    moduleListeners,
    moduleEvents,
    module: createPlayerStateModule({ core, modules }),
  };
}

function emit(listeners, eventName, payload) {
  for (const handler of listeners.get(eventName) ?? []) handler(payload);
}

function emitModule(moduleListeners, moduleId, eventName, payload) {
  const exactKey = `${moduleId}:${eventName}`;
  for (const handler of moduleListeners.get(exactKey) ?? []) handler(payload);
}

function getModuleEvents(moduleEvents, eventName) {
  return moduleEvents.filter((item) => item.moduleId === "module.playerState" && item.eventName === eventName);
}

function assertSquadEventShape(event, expectedEventName, expectedReason) {
  assert.equal(event.eventName, expectedEventName);
  assert.equal(event.source, "module.playerState");
  assert.equal(event.reason, expectedReason);
  assert.equal(event.sourceEventName, "RCON_LIST_PLAYERS_UPDATED");
  assert.ok(event.serverId);
  assert.ok(event.time);
  assert.ok(event.player);
  assert.ok(event.previous);
  assert.ok(event.current);
}

function assertCommanderAuthorizedShape(event) {
  assert.equal(event.eventName, "module.playerState.commanderAuthorized");
  assert.equal(event.source, "module.playerState");
  assert.equal(event.reason, "rconListPlayersDiff");
  assert.equal(event.sourceEventName, "RCON_LIST_PLAYERS_UPDATED");
  assert.ok(event.serverId);
  assert.ok(event.time);
  assert.ok(event.player);
  assert.ok(event.previous);
  assert.ok(event.current);
  assert.equal(event.commander?.authorized, true);
  assert.equal(event.commander?.source, "commandSquad");
}

async function testBuildsCanonicalPlayerListFromRcon() {
  const harness = createHarness();
  await harness.module.start();

  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Alpha",
        steamID: "111",
        eosID: "eos-111",
        controllerID: "c-111",
        teamID: 2,
        squadID: 5,
        isLeader: true,
        role: "SL",
      },
    ],
  });

  const list = harness.module.api.getPlayerList("BZSS_Main");
  assert.equal(list.length, 1);
  assert.equal(list[0].teamID, "2");
  assert.equal(list[0].squadID, "5");
  assert.equal(list[0].position, null);
  assert.equal(list[0].rotation, null);
  assert.equal(list[0].health, null);
  assert.equal(list[0].weaponClass, "");
  assert.deepEqual(list[0].ammoValues, []);
  assert.equal(list[0].ping, null);
  assert.ok(list[0].soldierInfo);
  assert.ok(list[0].networkInfo);
  assert.equal(harness.module.api.getPlayerBySteamID("BZSS_Main", "111")?.name, "Alpha");
  assert.equal(harness.module.api.findPlayer("BZSS_Main", { name: " alpha " })?.steamID, "111");

  await harness.module.stop();
}

async function testMergesEventUpdatesIntoGlobalPlayerList() {
  const harness = createHarness();
  await harness.module.start();

  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Bravo",
        steamID: "222",
        eosID: "eos-222",
        teamID: 1,
        squadID: 3,
        isLeader: false,
        role: "Medic",
      },
    ],
  });

  emit(harness.listeners, "On_PlayerDied", {
    serverId: "BZSS_Main",
    paramMap: {
      VictimName: "Bravo Renamed",
      VictimCachedSteam64ID: "222",
      VictimCachedEOSID: "eos-222",
      AttackerName: "Attacker",
      AttackerSteam64ID: "333",
      AttackerEOSID: "eos-333",
      AttackerControllerID: "c-333",
    },
  });

  const victim = harness.module.api.getPlayerBySteamID("BZSS_Main", "222");
  assert.equal(victim?.name, "Bravo Renamed");
  assert.equal(victim?.teamID, "1");
  assert.equal(victim?.state, "dead");

  const attacker = harness.module.api.findPlayer("BZSS_Main", { controllerID: "c-333" });
  assert.equal(attacker?.name, "Attacker");
  assert.equal(attacker?.state, "playing");

  await harness.module.stop();
}

async function testMergesBzssDerivedPlayerStateFields() {
  const harness = createHarness();
  await harness.module.start();

  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 7,
        name: "Charlie",
        steamID: "444",
        eosID: "eos-444",
        teamID: 1,
        squadID: 4,
        isLeader: false,
        role: "Rifleman",
      },
    ],
  });

  emitModule(harness.moduleListeners, "module.bzssCoreMonitor", "snapshotUpdated", {
    serverId: "BZSS_Main",
    status: "ready",
    players: [
      {
        playerGuid: "guid-444",
        playerName: "Charlie",
        teamId: 1,
        squadId: 4,
        ping: 37,
        playerScoreboard: {
          valuesByKey: { Ping: 37 },
        },
        soldierInfo: {
          raw: "SoldierInfo{}",
          fields: [],
          values: {},
          soldierClass: "BP_Soldier_Test",
          health: 88,
          weaponClass: "BP_Rifle_Test",
          ammoValues: [30, 29, 28],
          position: { x: 10, y: 20, z: 30 },
          rotation: { x: 1, y: 2, z: 3 },
        },
        vehicleInfo: {
          raw: "",
          vehicleType: "",
          healthText: "",
          health: null,
          maxHealth: null,
          position: null,
          rotation: null,
        },
      },
    ],
  });

  const player = harness.module.api.getPlayerBySteamID("BZSS_Main", "444");
  assert.equal(player?.position?.x, 10);
  assert.equal(player?.rotation?.z, 3);
  assert.equal(player?.health, 88);
  assert.equal(player?.weaponClass, "BP_Rifle_Test");
  assert.deepEqual(player?.ammoValues, [30, 29, 28]);
  assert.equal(player?.ping, 37);
  assert.equal(player?.soldierInfo?.soldierClass, "BP_Soldier_Test");
  assert.equal(player?.soldierInfo?.weaponClass, "BP_Rifle_Test");
  assert.equal(player?.soldierInfo?.health, 88);
  assert.equal(player?.networkInfo?.ping, 37);

  await harness.module.stop();
}

async function testFirstSnapshotDoesNotEmitSquadMembershipEvents() {
  const harness = createHarness();
  await harness.module.start();

  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Alpha",
        steamID: "1",
        teamID: "1",
        squadID: "2",
      },
    ],
  });

  assert.equal(getModuleEvents(harness.moduleEvents, "playerJoinedSquad").length, 0);
  assert.equal(getModuleEvents(harness.moduleEvents, "playerLeftSquad").length, 0);
  assert.equal(getModuleEvents(harness.moduleEvents, "playerChangedSquad").length, 0);

  const snapshots = getModuleEvents(harness.moduleEvents, "playersSnapshotUpdated");
  assert.equal(snapshots.length, 1);

  await harness.module.stop();
}

async function testEmitsPlayerJoinedSquadFromSnapshotDiff() {
  const harness = createHarness();
  await harness.module.start();

  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Alpha",
        steamID: "1",
        teamID: "1",
        squadID: "",
      },
    ],
  });

  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Alpha",
        steamID: "1",
        teamID: "1",
        squadID: "3",
      },
    ],
  });

  const joinedEvents = getModuleEvents(harness.moduleEvents, "playerJoinedSquad");
  assert.equal(joinedEvents.length, 1);

  const joined = joinedEvents[0].event;
  assertSquadEventShape(joined, "module.playerState.playerJoinedSquad", "rconListPlayersDiff");
  assert.equal(joined.previous.squadID, "");
  assert.equal(joined.current.squadID, "3");
  assert.equal(joined.player.name, "Alpha");
  assert.equal(joined.player.steamID, "1");

  await harness.module.stop();
}

async function testLeaderJoinDoesNotEmitPlayerJoinedSquad() {
  const harness = createHarness();
  await harness.module.start();

  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Leader",
        steamID: "10",
        teamID: "1",
        squadID: "",
        isLeader: false,
      },
    ],
  });

  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Leader",
        steamID: "10",
        teamID: "1",
        squadID: "3",
        isLeader: true,
      },
    ],
  });

  assert.equal(getModuleEvents(harness.moduleEvents, "playerJoinedSquad").length, 0);
  assert.equal(getModuleEvents(harness.moduleEvents, "playerChangedSquad").length, 0);
  assert.equal(getModuleEvents(harness.moduleEvents, "playerLeftSquad").length, 0);

  await harness.module.stop();
}

async function testEmitsPlayerLeftSquadFromSnapshotDiff() {
  const harness = createHarness();
  await harness.module.start();

  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Alpha",
        steamID: "1",
        teamID: "1",
        squadID: "3",
      },
    ],
  });

  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Alpha",
        steamID: "1",
        teamID: "1",
        squadID: "",
      },
    ],
  });

  const leftEvents = getModuleEvents(harness.moduleEvents, "playerLeftSquad");
  assert.equal(leftEvents.length, 1);

  const left = leftEvents[0].event;
  assertSquadEventShape(left, "module.playerState.playerLeftSquad", "rconListPlayersDiff");
  assert.equal(left.previous.squadID, "3");
  assert.equal(left.current.squadID, "");

  await harness.module.stop();
}

async function testEmitsPlayerChangedSquadFromSnapshotDiff() {
  const harness = createHarness();
  await harness.module.start();

  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Alpha",
        steamID: "1",
        teamID: "1",
        squadID: "3",
      },
    ],
  });

  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Alpha",
        steamID: "1",
        teamID: "1",
        squadID: "5",
      },
    ],
  });

  const changedEvents = getModuleEvents(harness.moduleEvents, "playerChangedSquad");
  assert.equal(changedEvents.length, 1);

  const changed = changedEvents[0].event;
  assertSquadEventShape(changed, "module.playerState.playerChangedSquad", "rconListPlayersDiff");
  assert.equal(changed.previous.squadID, "3");
  assert.equal(changed.current.squadID, "5");

  await harness.module.stop();
}

async function testOfflinePlayerDoesNotEmitLeftSquad() {
  const harness = createHarness();
  await harness.module.start();

  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Alpha",
        steamID: "1",
        teamID: "1",
        squadID: "3",
      },
    ],
  });

  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [],
  });

  assert.equal(getModuleEvents(harness.moduleEvents, "playerLeftSquad").length, 0);

  await harness.module.stop();
}

async function testEmitsCommanderAuthorizedWhenCommandSquadCommanderPresent() {
  const harness = createHarness();
  await harness.module.start();

  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Leader",
        steamID: "10",
        teamID: "1",
        squadID: "10",
        isLeader: true,
      },
    ],
  });

  const authEvents = getModuleEvents(harness.moduleEvents, "commanderAuthorized");
  assert.equal(authEvents.length, 1);
  const auth = authEvents[0].event;
  assertCommanderAuthorizedShape(auth);
  assert.equal(auth.current.squadID, "10");
  assert.equal(auth.current.squadID, "10");
  assert.equal(auth.player.name, "Leader");
  assert.equal(auth.player.isLeader, true);

  // Same snapshot again should not re-emit.
  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Leader",
        steamID: "10",
        teamID: "1",
        squadID: "10",
        isLeader: true,
      },
    ],
  });

  assert.equal(getModuleEvents(harness.moduleEvents, "commanderAuthorized").length, 1);
  await harness.module.stop();
}

async function testResolvesCommandSquadFromSquadManagementName() {
  const harness = createHarness({
    modulesOverride: {
      squadManagement: {
        getSquads() {
          return [
            { teamId: 1, squadId: 1, squadName: "Command Squad" },
            { teamId: 1, squadId: 2, squadName: "Squad 2" },
          ];
        },
      },
    },
  });
  await harness.module.start();

  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Donald",
        steamID: "76561198194428818",
        teamID: "1",
        squadID: "1",
        isLeader: true,
      },
    ],
  });

  const authEvents = getModuleEvents(harness.moduleEvents, "commanderAuthorized");
  assert.equal(authEvents.length, 1);
  const auth = authEvents[0].event;
  assertCommanderAuthorizedShape(auth);
  assert.equal(auth.current.teamID, "1");
  assert.equal(auth.current.squadID, "1");
  assert.equal(auth.player.name, "Donald");

  await harness.module.stop();
}

async function testTracksSquadlessTimingUntilJoin() {
  const harness = createHarness();
  await harness.module.start();

  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Wanderer",
        steamID: "999",
        teamID: "1",
        squadID: "",
      },
    ],
  });

  const first = harness.module.api.getPlayerBySteamID("BZSS_Main", "999");
  assert.ok(first);
  assert.equal(first?.squadID, "");
  assert.ok(String(first?.squadlessSince ?? "").length > 0);

  // Same (still squadless) snapshot should keep the original squadlessSince.
  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Wanderer",
        steamID: "999",
        teamID: "1",
        squadID: "",
      },
    ],
  });

  const second = harness.module.api.getPlayerBySteamID("BZSS_Main", "999");
  assert.equal(second?.squadlessSince, first?.squadlessSince);

  // Joining a squad should clear squadless timing.
  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Wanderer",
        steamID: "999",
        teamID: "1",
        squadID: "2",
      },
    ],
  });

  const joined = harness.module.api.getPlayerBySteamID("BZSS_Main", "999");
  assert.equal(joined?.squadID, "2");
  assert.equal(joined?.squadlessSince, "");
  assert.equal(joined?.squadlessSeconds, 0);

  await harness.module.stop();
}

async function testBzssPriorityUsesBzssTeamAndSquadWhenAvailable() {
  const harness = createHarness({
    configOverrides: {
      "modules.playerState.teamSquadSourcePriority": "bzssCore",
    },
  });
  await harness.module.start();

  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Alpha",
        steamID: "111",
        teamID: "1",
        squadID: "3",
      },
    ],
  });

  emitModule(harness.moduleListeners, "module.bzssCoreMonitor", "snapshotUpdated", {
    serverId: "BZSS_Main",
    status: "ready",
    revision: 1,
    players: [
      {
        playerGuid: "abc",
        playerName: "Alpha",
        teamId: 4,
        squadId: 9,
      },
    ],
  });

  const player = harness.module.api.getPlayerBySteamID("BZSS_Main", "111");
  assert.equal(player?.teamID, "4");
  assert.equal(player?.squadID, "9");

  await harness.module.stop();
}

async function testBzssPriorityFallsBackToRconWhenBzssMissingValues() {
  const harness = createHarness({
    configOverrides: {
      "modules.playerState.teamSquadSourcePriority": "bzssCore",
    },
  });
  await harness.module.start();

  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Bravo",
        steamID: "222",
        teamID: "1",
        squadID: "3",
      },
    ],
  });

  emitModule(harness.moduleListeners, "module.bzssCoreMonitor", "snapshotUpdated", {
    serverId: "BZSS_Main",
    status: "ready",
    revision: 2,
    players: [
      {
        playerGuid: "def",
        playerName: "Bravo",
        teamId: "",
        squadId: "",
      },
    ],
  });

  const player = harness.module.api.getPlayerBySteamID("BZSS_Main", "222");
  assert.equal(player?.teamID, "1");
  assert.equal(player?.squadID, "3");

  await harness.module.stop();
}

async function testRconPriorityFallsBackToBzssWhenRconMissingValues() {
  const harness = createHarness({
    configOverrides: {
      "modules.playerState.teamSquadSourcePriority": "rcon",
    },
  });
  await harness.module.start();

  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Charlie",
        steamID: "333",
        teamID: "",
        squadID: "",
      },
    ],
  });

  emitModule(harness.moduleListeners, "module.bzssCoreMonitor", "snapshotUpdated", {
    serverId: "BZSS_Main",
    status: "ready",
    revision: 3,
    players: [
      {
        playerGuid: "ghi",
        playerName: "Charlie",
        teamId: 2,
        squadId: 7,
      },
    ],
  });

  const player = harness.module.api.getPlayerBySteamID("BZSS_Main", "333");
  assert.equal(player?.teamID, "2");
  assert.equal(player?.squadID, "7");

  await harness.module.stop();
}

async function testEffectiveSquadChangesOnlyEmitWhenMergedValueChanges() {
  const harness = createHarness({
    configOverrides: {
      "modules.playerState.teamSquadSourcePriority": "bzssCore",
    },
  });
  await harness.module.start();

  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Delta",
        steamID: "444",
        teamID: "",
        squadID: "",
      },
    ],
  });

  emitModule(harness.moduleListeners, "module.bzssCoreMonitor", "snapshotUpdated", {
    serverId: "BZSS_Main",
    status: "ready",
    revision: 4,
    players: [
      {
        playerGuid: "jkl",
        playerName: "Delta",
        teamId: 2,
        squadId: 6,
      },
    ],
  });

  emit(harness.listeners, "RCON_LIST_PLAYERS_UPDATED", {
    serverId: "BZSS_Main",
    players: [
      {
        playerID: 1,
        name: "Delta",
        steamID: "444",
        teamID: "",
        squadID: "",
      },
    ],
  });

  emitModule(harness.moduleListeners, "module.bzssCoreMonitor", "snapshotUpdated", {
    serverId: "BZSS_Main",
    status: "ready",
    revision: 5,
    players: [
      {
        playerGuid: "jkl",
        playerName: "Delta",
        teamId: 2,
        squadId: 6,
      },
    ],
  });

  const joinedEvents = getModuleEvents(harness.moduleEvents, "playerJoinedSquad");
  assert.equal(joinedEvents.length, 1);
  assert.equal(joinedEvents[0].event.current.squadID, "6");

  await harness.module.stop();
}

await testBuildsCanonicalPlayerListFromRcon();
await testMergesEventUpdatesIntoGlobalPlayerList();
await testMergesBzssDerivedPlayerStateFields();
await testFirstSnapshotDoesNotEmitSquadMembershipEvents();
await testEmitsPlayerJoinedSquadFromSnapshotDiff();
await testLeaderJoinDoesNotEmitPlayerJoinedSquad();
await testEmitsPlayerLeftSquadFromSnapshotDiff();
await testEmitsPlayerChangedSquadFromSnapshotDiff();
await testOfflinePlayerDoesNotEmitLeftSquad();
await testEmitsCommanderAuthorizedWhenCommandSquadCommanderPresent();
await testResolvesCommandSquadFromSquadManagementName();
await testTracksSquadlessTimingUntilJoin();
await testBzssPriorityUsesBzssTeamAndSquadWhenAvailable();
await testBzssPriorityFallsBackToRconWhenBzssMissingValues();
await testRconPriorityFallsBackToBzssWhenRconMissingValues();
await testEffectiveSquadChangesOnlyEmitWhenMergedValueChanges();

console.log("player state tests passed");
