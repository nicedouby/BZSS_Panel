import assert from "node:assert/strict";

import { createPlayerStateModule } from "../modules/player-state/index.js";

function createHarness() {
  const listeners = new Map();
  const moduleEvents = [];
  const core = {
    logger: { info() {}, debug() {}, warn() {}, module() {} },
    webStatus: { set() {} },
    eventBus: {
      onCoreEvent(eventName, handler) {
        if (!listeners.has(eventName)) listeners.set(eventName, new Set());
        listeners.get(eventName).add(handler);
        return () => listeners.get(eventName)?.delete(handler);
      },
      emitModuleEvent(moduleId, eventName, event) {
        moduleEvents.push({ moduleId, eventName, event });
      },
    },
  };

  return {
    listeners,
    moduleEvents,
    module: createPlayerStateModule({ core }),
  };
}

function emit(listeners, eventName, payload) {
  for (const handler of listeners.get(eventName) ?? []) handler(payload);
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

async function testEmitsCommanderAuthorizedWhenLeaderEntersCommandSquad() {
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
        squadID: "10",
        isLeader: true,
      },
    ],
  });

  const authEvents = getModuleEvents(harness.moduleEvents, "commanderAuthorized");
  assert.equal(authEvents.length, 1);
  const auth = authEvents[0].event;
  assertCommanderAuthorizedShape(auth);
  assert.equal(auth.previous.squadID, "");
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

await testBuildsCanonicalPlayerListFromRcon();
await testMergesEventUpdatesIntoGlobalPlayerList();
await testFirstSnapshotDoesNotEmitSquadMembershipEvents();
await testEmitsPlayerJoinedSquadFromSnapshotDiff();
await testLeaderJoinDoesNotEmitPlayerJoinedSquad();
await testEmitsPlayerLeftSquadFromSnapshotDiff();
await testEmitsPlayerChangedSquadFromSnapshotDiff();
await testOfflinePlayerDoesNotEmitLeftSquad();
await testEmitsCommanderAuthorizedWhenLeaderEntersCommandSquad();

console.log("player state tests passed");
