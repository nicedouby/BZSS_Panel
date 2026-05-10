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
  assert.equal(list[0].teamID, 2);
  assert.equal(list[0].squadID, 5);
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
  assert.equal(victim?.teamID, 1);
  assert.equal(victim?.state, "dead");

  const attacker = harness.module.api.findPlayer("BZSS_Main", { controllerID: "c-333" });
  assert.equal(attacker?.name, "Attacker");
  assert.equal(attacker?.state, "playing");

  await harness.module.stop();
}

await testBuildsCanonicalPlayerListFromRcon();
await testMergesEventUpdatesIntoGlobalPlayerList();

console.log("player state tests passed");
