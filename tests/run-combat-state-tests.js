import assert from "node:assert/strict";

import { createCombatStateModule, normalizeParams } from "../modules/combat-state/index.js";

function createHarness({ maxEvents = 5000, playerState = null } = {}) {
  const listeners = new Map();
  const moduleListeners = new Map();
  const moduleEvents = [];
  const core = {
    webStatus: { serverId: "BZSS_Main" },
    logger: { module() {}, warn() {}, error() {} },
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
      },
    },
  };
  const config = {
    get(path, defaultValue) {
      if (path === "modules.combatState") return { enabled: true, maxEvents };
      return defaultValue;
    },
  };
  const module = createCombatStateModule({ core, modules: playerState ? { playerState } : {}, config });

  return {
    module,
    moduleEvents,
    emit(eventName, event) {
      for (const handler of listeners.get(eventName) ?? []) handler({ eventName, ...event });
    },
    emitModule(moduleId, eventName, event) {
      for (const handler of moduleListeners.get(`${moduleId}:${eventName}`) ?? []) handler(event);
    },
  };
}

function makeEvent(eventName, params, patch = {}) {
  return {
    eventId: `${eventName}:1`,
    eventName,
    serverId: "BZSS_Main",
    time: "2026-05-08T11:00:00.000Z",
    params,
    rawLog: "raw combat log",
    ...patch,
  };
}

async function testNormalizesDamageEventAndSearches() {
  const harness = createHarness();
  await harness.module.start();

  harness.emit("On_PlayerDamaged", makeEvent("On_PlayerDamaged", [
    ["VictimName", "Victim"],
    ["ActualDamage", "62.000004"],
    ["AttackerName", "Attacker"],
    ["AttackerEOSID", "xxx"],
    ["AttackerSteam64ID", "76561198000000000"],
    ["CausedBy", "BP_Rifle_C"],
    ["ParseStatus", "Full"],
    ["ParseConfidence", "High"],
    ["IdentityConfidence", "High"],
    ["Confidence", "High"],
  ]));

  const events = harness.module.api.getEvents({ type: "damage", search: "attacker", limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "damage");
  assert.equal(events[0].victimName, "Victim");
  assert.equal(events[0].attackerName, "Attacker");
  assert.equal(events[0].damage, 62.000004);
  assert.equal(events[0].weapon, "BP_Rifle_C");
  assert.equal(events[0].rawLog, "raw combat log");
}

async function testKeepsNullptrInvalidDeathEvent() {
  const harness = createHarness();
  await harness.module.start();

  harness.emit("On_PlayerDied", makeEvent("On_PlayerDied", {
    VictimName: "Braovo",
    KillingDamage: "-300.000000",
    AttackerName: "",
    AttackerEOSID: "INVALID",
    AttackerSteam64ID: "",
    AttackerControllerID: "BP_PlayerController_C_2147413175",
    FromObject: "nullptr",
    CausedBy: "BP_Soldier_PLA_SquadLeader_Arid_C_2147373303",
    ParseStatus: "Full",
  }));

  const events = harness.module.api.getEvents({ type: "death" });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "death");
  assert.equal(events[0].victimName, "Braovo");
  assert.equal(events[0].attackerName, "");
  assert.equal(events[0].attackerControllerID, "BP_PlayerController_C_2147413175");
  assert.equal(events[0].damage, -300);
  assert.equal(events[0].fromObject, "nullptr");
  assert.equal(events[0].causedBy, "BP_Soldier_PLA_SquadLeader_Arid_C_2147373303");
}

async function testDeathDamage300AddsGiveUpLabel() {
  const harness = createHarness();
  await harness.module.start();

  harness.emit("On_PlayerDied", makeEvent("On_PlayerDied", [
    ["VictimName", "PlayerA"],
    ["KillingDamage", "300"],
    ["AttackerName", ""],
    ["CausedBy", "BP_Rifle_C"],
  ]));

  const events = harness.module.api.getEvents({ type: "death" });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].eventFlagLabels, ["放弃"]);
  assert.ok(events[0].eventFlags.some((flag) => flag.key === "give_up"));
  assert.ok(events[0].tags.includes("event:give_up"));
}

async function testDeathDamage300SameTeamKeepsTkInfo() {
  const playerState = {
    getPlayerByName(serverId, name) {
      if (serverId !== "BZSS_Main") return null;
      if (name === "Attacker") return { name, teamID: 1 };
      if (name === "Victim") return { name, teamID: 1 };
      return null;
    },
  };
  const harness = createHarness({ playerState });
  await harness.module.start();

  harness.emit("On_PlayerDied", makeEvent("On_PlayerDied", [
    ["VictimName", "Victim"],
    ["KillingDamage", "300"],
    ["AttackerName", "Attacker"],
    ["CausedBy", "BP_Rifle_C"],
  ]));

  const events = harness.module.api.getEvents({ type: "death" });
  assert.ok(events[0].eventFlagLabels.includes("放弃"));
  assert.ok(events[0].eventFlagLabels.includes("友伤"));
  assert.equal(events[0].isTeamKill, true);

  await harness.module.stop();
}

async function testMaxEventsAndClear() {
  const harness = createHarness({ maxEvents: 2 });
  await harness.module.start();

  harness.emit("On_PlayerDamaged", makeEvent("On_PlayerDamaged", [["VictimName", "A"], ["ActualDamage", "1"]], { eventId: "1" }));
  harness.emit("On_PlayerWounded", makeEvent("On_PlayerWounded", [["VictimName", "B"], ["KillingDamage", "2"]], { eventId: "2" }));
  harness.emit("On_PlayerDied", makeEvent("On_PlayerDied", [["VictimName", "C"], ["KillingDamage", "3"]], { eventId: "3" }));

  const state = harness.module.api.getState();
  assert.equal(state.count, 2);
  assert.deepEqual(state.events.map((event) => event.id), ["2", "3"]);
  assert.equal(state.stats.damage, 0);
  assert.equal(state.stats.wound, 1);
  assert.equal(state.stats.death, 1);

  const cleared = harness.module.api.clear();
  assert.equal(cleared.cleared, 2);
  assert.equal(harness.module.api.getState().count, 0);
}

async function testSameTeamEventIsMarkedTeamKill() {
  const playerState = {
    getPlayerByName(serverId, name) {
      if (serverId !== "BZSS_Main") return null;
      if (name === "Attacker") return { name, teamID: 2 };
      if (name === "Victim") return { name, teamID: 2 };
      return null;
    },
  };
  const harness = createHarness({ playerState });
  await harness.module.start();

  harness.emit("On_PlayerDied", makeEvent("On_PlayerDied", [
    ["VictimName", "Victim"],
    ["KillingDamage", "100"],
    ["AttackerName", "Attacker"],
    ["CausedBy", "BP_Rifle_C"],
  ]));

  const events = harness.module.api.getEvents({ type: "tk" });
  const overview = harness.module.api.getOverview();
  assert.equal(events.length, 1);
  assert.equal(events[0].isTeamKill, true);
  assert.equal(events[0].attackerTeamID, 2);
  assert.equal(events[0].victimTeamID, 2);
  assert.equal(overview.stats.teamKill, 1);
}

async function testSameTeamDamageIsFriendlyDamageNotTeamKill() {
  const playerState = {
    getPlayerByName(serverId, name) {
      if (serverId !== "BZSS_Main") return null;
      if (name === "Attacker") return { name, teamID: 2 };
      if (name === "Victim") return { name, teamID: 2 };
      return null;
    },
  };
  const harness = createHarness({ playerState });
  await harness.module.start();

  harness.emit("On_PlayerDamaged", makeEvent("On_PlayerDamaged", [
    ["VictimName", "Victim"],
    ["ActualDamage", "25"],
    ["AttackerName", "Attacker"],
    ["CausedBy", "BP_Rifle_C"],
  ]));

  const events = harness.module.api.getEvents({ type: "teamDamage" });
  const overview = harness.module.api.getOverview();
  assert.equal(events.length, 1);
  assert.equal(events[0].isFriendlyFire, true);
  assert.equal(events[0].isTeamKill, false);
  assert.equal(events[0].friendlyFireType, "team_damage");
  assert.equal(events[0].friendlyFireLabel, "友军伤害");
  assert.equal(overview.stats.teamDamage, 1);
  assert.equal(overview.stats.teamKill, 0);
}

async function testSameTeamWoundIsTkDownNotTeamKill() {
  const playerState = {
    getPlayerByName(serverId, name) {
      if (serverId !== "BZSS_Main") return null;
      if (name === "Attacker") return { name, teamID: 2 };
      if (name === "Victim") return { name, teamID: 2 };
      return null;
    },
  };
  const harness = createHarness({ playerState });
  await harness.module.start();

  harness.emit("On_PlayerWounded", makeEvent("On_PlayerWounded", [
    ["VictimName", "Victim"],
    ["KillingDamage", "80"],
    ["AttackerName", "Attacker"],
    ["CausedBy", "BP_Rifle_C"],
  ]));

  const events = harness.module.api.getEvents({ type: "teamWound" });
  const overview = harness.module.api.getOverview();
  assert.equal(events.length, 1);
  assert.equal(events[0].isFriendlyFire, true);
  assert.equal(events[0].isTeamKill, false);
  assert.equal(events[0].isTeamKillDown, true);
  assert.equal(events[0].friendlyFireType, "team_wound");
  assert.equal(events[0].friendlyFireLabel, "TK击倒");
  assert.ok(events[0].tags.includes("tk_down"));
  assert.ok(events[0].eventFlagLabels.includes("TK击倒"));
  assert.equal(overview.stats.teamWound, 1);
  assert.equal(overview.stats.teamKill, 0);
}

async function testRconTkFromKillManageIsVisible() {
  const harness = createHarness();
  await harness.module.start();

  harness.emitModule("module.killManage", "teamKillResolved", {
    eventId: "module-tk-1",
    eventName: "module.killManage.teamKillResolved",
    serverId: "BZSS_Main",
    time: "2026-05-08T11:01:00.000Z",
    record: {
      sourceEventId: "rcon:TEAM_KILL:1",
      type: "tk",
      serverId: "BZSS_Main",
      time: "2026-05-08T11:01:00.000Z",
      attackerName: "Donald·DoubyBear",
      victimName: "Braovo",
      causedBy: "RCON_TEAM_KILL",
      rawLog: "[ChatAdmin] ASQKillDeathRuleset : Player Donald·DoubyBear Team Killed Player Braovo",
      isTeamKill: true,
    },
  });

  const events = harness.module.api.getEvents({ type: "tk" });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "tk");
  assert.equal(events[0].isTeamKill, true);
  assert.equal(events[0].attackerName, "Donald·DoubyBear");
}

function testNormalizeParamsCompatibility() {
  const params = normalizeParams({
    params: [["VictimName", "ArrayVictim"]],
    rawEvent: {
      Param1_ActualDamage: "25",
      Param2_CausedBy: "BP_Test_C",
    },
  });

  assert.equal(params.VictimName, "ArrayVictim");
  assert.equal(params.Param1_ActualDamage, "25");
  assert.equal(params.ActualDamage, "25");
  assert.equal(params.CausedBy, "BP_Test_C");
}

await testNormalizesDamageEventAndSearches();
await testKeepsNullptrInvalidDeathEvent();
await testDeathDamage300AddsGiveUpLabel();
await testDeathDamage300SameTeamKeepsTkInfo();
await testMaxEventsAndClear();
await testSameTeamEventIsMarkedTeamKill();
await testSameTeamDamageIsFriendlyDamageNotTeamKill();
await testSameTeamWoundIsTkDownNotTeamKill();
await testRconTkFromKillManageIsVisible();
testNormalizeParamsCompatibility();

console.log("combat state tests passed");
