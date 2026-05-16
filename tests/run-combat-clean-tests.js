import assert from "node:assert/strict";

import { createCombatCleanModule } from "../modules/combat-clean/index.js";

function createHarness({ playerState, matchState } = {}) {
  const listeners = new Map();
  const moduleEvents = [];
  const core = {
    logger: { info() {}, debug() {}, warn() {}, error() {} },
    webStatus: { serverId: "BZSS_Main" },
    webRegistry: { registerPage() {} },
    eventBus: {
      onModuleEvent(moduleId, eventName, handler) {
        const key = `${moduleId}:${eventName}`;
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(handler);
        return () => listeners.get(key)?.delete(handler);
      },
      emitModuleEvent(moduleId, eventName, event) {
        moduleEvents.push({ moduleId, eventName, event });
      },
    },
  };
  const config = {
    get(pathText, defaultValue) {
      if (pathText === "modules.combatClean") return { enabled: true, maxEvents: 100 };
      return defaultValue;
    },
  };
  const module = createCombatCleanModule({
    core,
    modules: { playerState, matchState },
    config,
  });
  return { module, listeners, moduleEvents };
}

function emitCombatResolved(listeners, record) {
  for (const handler of listeners.get("module.killManage:combatResolved") ?? []) {
    handler({
      eventId: record.sourceEventId,
      eventName: "module.killManage.combatResolved",
      layer: "module",
      source: "module.killManage",
      serverId: record.serverId,
      time: record.time,
      record,
    });
  }
}

async function testAttackerNullptrFallsBackToVictimExactly() {
  const { module, listeners, moduleEvents } = createHarness();
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:1",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:00:00.000Z",
    type: "damaged",
    attackerName: "nullptr",
    victimName: "Victim",
    victimSteam64ID: "76561198000000001",
    damage: 12,
    weapon: "BP_Rifle_C_214748",
    rawLog: "raw damage",
  });

  const clean = module.api.getEvents({ serverId: "BZSS_Main" })[0];
  assert.equal(clean.type, "damage");
  assert.equal(clean.eventName, "BZSS_DAMAGE");
  assert.equal(clean.attacker.name, "Victim");
  assert.equal(clean.attacker.steam64ID, "76561198000000001");
  assert.equal(clean.attacker.isFallback, true);
  assert.equal(clean.attacker.fallbackReason, "attacker_nullptr_use_victim");
  assert.deepEqual(clean.parse.warnings, ["attacker_nullptr_use_victim"]);
  assert.ok(moduleEvents.some((item) => item.eventName === "damageResolved"));
  assert.ok(moduleEvents.some((item) => item.eventName === "updated"));

  await module.stop();
}

async function testRejectsNullptrVictim() {
  const { module, listeners, moduleEvents } = createHarness();
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:reject",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:01:00.000Z",
    type: "wounded",
    attackerName: "Attacker",
    victimName: "nullptr",
    weapon: "BP_Rifle_C",
    rawLog: "raw reject",
  });

  assert.equal(module.api.getEvents({ serverId: "BZSS_Main" }).length, 0);
  const rejected = moduleEvents.find((item) => item.eventName === "rejected");
  assert.ok(rejected);
  assert.equal(rejected.event.rejection.status, "missing_victim");

  await module.stop();
}

async function testResolvesPlayersAndRelation() {
  const playerState = {
    getPlayerBySteamID(serverId, steamID) {
      if (serverId === "BZSS_Main" && steamID === "111") {
        return { name: "Attacker Live", steamID, eosID: "eos-a", teamID: 1, squadID: 2, role: "Rifleman", isLeader: true };
      }
      return null;
    },
    getPlayerByEOSID() { return null; },
    getPlayerByControllerID() { return null; },
    getPlayerByName() { return null; },
  };
  const matchState = {
    getState() {
      return {
        players: {
          bySteam64ID: {},
          byEOSID: {},
          byControllerID: {},
          byName: {},
          list: [{ name: "victim live", steamID: "222", teamID: 1, squadID: 3 }],
        },
      };
    },
  };
  const { module, listeners } = createHarness({ playerState, matchState });
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:2",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:02:00.000Z",
    type: "died",
    attackerName: "Attacker",
    attackerSteam64ID: "111",
    victimName: "Victim Live",
    damage: 100,
    causedBy: "BP_Rifle_C",
    rawLog: "raw kill",
  });

  const clean = module.api.getEvents({ type: "kill" })[0];
  assert.equal(clean.eventName, "BZSS_KILL");
  assert.equal(clean.attacker.name, "Attacker");
  assert.equal(clean.attacker.steam64ID, "111");
  assert.equal(clean.attacker.teamID, 1);
  assert.equal(clean.attacker.resolutionSource, "module.playerState");
  assert.equal(clean.victim.name, "Victim Live");
  assert.equal(clean.victim.teamID, 1);
  assert.equal(clean.victim.resolutionSource, "module.matchState");
  assert.equal(clean.relation.sameTeam, true);
  assert.equal(clean.relation.isFriendlyFire, true);
  assert.equal(clean.relation.friendlyFireType, "team_kill");

  await module.stop();
}

async function testGiveUpOnlyKeepsSingleLabelInProcessedData() {
  const { module, listeners } = createHarness();
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:give-up",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:04:00.000Z",
    type: "died",
    attackerName: "PlayerA",
    victimName: "PlayerA",
    damage: 300,
    eventFlags: [{ key: "give_up", label: "放弃", level: "neutral", reason: "died_damage_300" }],
    eventFlagLabels: ["放弃"],
    rawLog: "raw give up",
  });

  const clean = module.api.getEvents({ serverId: "BZSS_Main" })[0];
  assert.deepEqual(clean.eventFlagLabels, ["放弃"]);
  assert.equal(clean.eventFlags.length, 1);
  assert.equal(clean.eventFlags[0].key, "give_up");
  await module.stop();
}

async function testGiveUpSameTeamKeepsFriendlyFireLabelInProcessedData() {
  const playerState = {
    getPlayerByName(serverId, name) {
      if (serverId !== "BZSS_Main") return null;
      if (name === "Attacker") return { name, teamID: 2 };
      if (name === "Victim") return { name, teamID: 2 };
      return null;
    },
  };
  const { module, listeners } = createHarness({ playerState });
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:give-up-tk",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:04:30.000Z",
    type: "died",
    attackerName: "Attacker",
    victimName: "Victim",
    damage: 300,
    rawLog: "raw give up tk",
  });

  const clean = module.api.getEvents({ serverId: "BZSS_Main" })[0];
  assert.ok(clean.eventFlagLabels.includes("放弃"));
  assert.ok(clean.eventFlagLabels.includes("友伤"));
  assert.equal(clean.relation.isFriendlyFire, true);

  await module.stop();
}

async function testTeamWoundGetsTkDownLabelInProcessedData() {
  const playerState = {
    getPlayerByName(serverId, name) {
      if (serverId !== "BZSS_Main") return null;
      if (name === "Attacker") return { name, teamID: 2 };
      if (name === "Victim") return { name, teamID: 2 };
      return null;
    },
  };
  const { module, listeners } = createHarness({ playerState });
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:tk-down",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:05:00.000Z",
    type: "wounded",
    attackerName: "Attacker",
    victimName: "Victim",
    damage: 80,
    rawLog: "raw tk down",
  });

  const clean = module.api.getEvents({ type: "wound" })[0];
  assert.ok(clean.eventFlagLabels.includes("TK击倒"));
  assert.ok(clean.eventFlags.some((flag) => flag.key === "tk_down"));
  assert.equal(clean.relation.friendlyFireType, "team_wound");

  await module.stop();
}

async function testProcessedDataPreservesAllIncomingFlags() {
  const playerState = {
    getPlayerByName(serverId, name) {
      if (serverId !== "BZSS_Main") return null;
      if (name === "Attacker") return { name, teamID: 2 };
      if (name === "Victim") return { name, teamID: 2 };
      return null;
    },
  };
  const { module, listeners } = createHarness({ playerState });
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:multi-flags",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:06:00.000Z",
    type: "wounded",
    attackerName: "Attacker",
    victimName: "Victim",
    damage: 80,
    eventFlags: [
      { key: "friendly_fire", label: "友伤", level: "warning", reason: "same_team" },
      { key: "self_damage", label: "自伤", level: "warning", reason: "same_attacker_victim" },
    ],
    eventFlagLabels: ["友伤", "自伤"],
    rawLog: "raw multi flags",
  });

  const clean = module.api.getEvents({ type: "wound" })[0];
  assert.ok(clean.eventFlagLabels.includes("友伤"));
  assert.ok(clean.eventFlagLabels.includes("自伤"));
  assert.ok(clean.eventFlagLabels.includes("TK击倒"));
  assert.ok(clean.eventFlags.some((flag) => flag.key === "friendly_fire"));
  assert.ok(clean.eventFlags.some((flag) => flag.key === "self_damage"));
  assert.ok(clean.eventFlags.some((flag) => flag.key === "tk_down"));

  await module.stop();
}

async function testProcessedDataBackfillsFriendlyFireFlags() {
  const playerState = {
    getPlayerByName(serverId, name) {
      if (serverId !== "BZSS_Main") return null;
      if (name === "Attacker") return { name, teamID: 2 };
      if (name === "Victim") return { name, teamID: 2 };
      return null;
    },
  };
  const { module, listeners } = createHarness({ playerState });
  await module.start();

  emitCombatResolved(listeners, {
    sourceEventId: "raw:backfill",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:07:00.000Z",
    type: "wounded",
    attackerName: "Attacker",
    victimName: "Victim",
    damage: 80,
    rawLog: "raw backfill",
  });

  const clean = module.api.getEvents({ type: "wound" })[0];
  assert.ok(clean.eventFlagLabels.includes("友伤"));
  assert.ok(clean.eventFlagLabels.includes("TK击倒"));

  await module.stop();
}

async function testPlayerEventsAndClear() {
  const { module, listeners } = createHarness();
  await module.start();
  emitCombatResolved(listeners, {
    sourceEventId: "raw:3",
    serverId: "BZSS_Main",
    time: "2026-05-10T01:03:00.000Z",
    type: "wounded",
    attackerName: "Attacker",
    victimName: "Victim",
    victimEOSID: "eos-v",
  });

  assert.equal(module.api.getPlayerEvents("BZSS_Main", { eosID: "eos-v" }, { limit: 20 }).length, 1);
  assert.equal(module.api.getOverview("BZSS_Main").stats.wound, 1);
  assert.equal(module.api.clear("BZSS_Main").cleared, 1);
  assert.equal(module.api.getEvents({ serverId: "BZSS_Main" }).length, 0);

  await module.stop();
}

await testAttackerNullptrFallsBackToVictimExactly();
await testRejectsNullptrVictim();
await testResolvesPlayersAndRelation();
await testGiveUpOnlyKeepsSingleLabelInProcessedData();
await testGiveUpSameTeamKeepsFriendlyFireLabelInProcessedData();
await testTeamWoundGetsTkDownLabelInProcessedData();
await testProcessedDataPreservesAllIncomingFlags();
await testProcessedDataBackfillsFriendlyFireFlags();
await testPlayerEventsAndClear();

console.log("combat clean tests passed");
