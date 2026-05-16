import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createKillManageModule } from "../modules/kill-manage/index.js";

async function testWritesOnlyRawLogLines() {
  const listeners = new Map();
  const moduleEvents = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-kill-manage-"));
  const rawLogFile = path.join(tempDir, "combat-raw.log");

  const core = {
    logger: { warn() {}, module() {}, info() {}, debug() {} },
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

  const config = {
    get(pathText, defaultValue) {
      if (pathText === "modules.killManage") {
        return { enabled: true, rawLogFile };
      }
      return defaultValue;
    },
  };

  const module = createKillManageModule({ core, modules: {}, config });
  await module.start();

  for (const handler of listeners.get("On_PlayerDamaged") ?? []) {
    handler({
      eventId: "combat:1",
      eventName: "On_PlayerDamaged",
      serverId: "BZSS_Main",
      time: "2026-05-09T10:00:00.000Z",
      logTime: "2026.05.09-10.00.00",
      rawLog: "[2026.05.09-10.00.00] LogSquadTrace: damage raw line",
      normalized: {
        combat: {
          type: "damaged",
          victimName: "Victim",
          attackerName: "Attacker",
          damage: 25,
          weapon: "BP_Rifle_C",
        },
      },
    });
  }

  await module.stop();

  const fileText = await fs.readFile(rawLogFile, "utf8");
  assert.equal(fileText, "[2026.05.09-10.00.00] LogSquadTrace: damage raw line\n");
  assert.equal(moduleEvents.length, 1);
  assert.equal(moduleEvents[0].event.record.rawLog, "[2026.05.09-10.00.00] LogSquadTrace: damage raw line");

  await fs.rm(tempDir, { recursive: true, force: true });
}

async function testRconTeamKillEmitsTkRecord() {
  const listeners = new Map();
  const moduleEvents = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-kill-manage-"));
  const rawLogFile = path.join(tempDir, "rcon-tk.log");
  const core = {
    logger: { warn() {}, module() {}, info() {}, debug() {} },
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
  const config = {
    get(pathText, defaultValue) {
      if (pathText === "modules.killManage") return { enabled: true, rawLogFile };
      return defaultValue;
    },
  };
  const module = createKillManageModule({ core, modules: {}, config });
  await module.start();

  for (const handler of listeners.get("TEAM_KILL") ?? []) {
    handler({
      eventId: "rcon:TEAM_KILL:1",
      eventName: "TEAM_KILL",
      serverId: "BZSS_Main",
      time: "2026-05-09T10:01:00.000Z",
      payload: {
        sourceRaw: "[ChatAdmin] ASQKillDeathRuleset : Player Donald·DoubyBear Team Killed Player Braovo",
        killerName: "Donald·DoubyBear",
        victimName: "Braovo",
      },
    });
  }

  await module.stop();

  const combatEvent = moduleEvents.find((item) => item.eventName === "combatResolved");
  const tkEvent = moduleEvents.find((item) => item.eventName === "teamKillResolved");
  assert.ok(combatEvent, "combatResolved should be emitted for RCON TK");
  assert.ok(tkEvent, "teamKillResolved should be emitted for RCON TK");
  assert.equal(combatEvent.event.record.type, "tk");
  assert.equal(combatEvent.event.record.isTeamKill, true);
  assert.equal(combatEvent.event.record.teamKillReason, "rcon_team_kill");
  assert.equal(combatEvent.event.record.attackerName, "Donald·DoubyBear");
  assert.equal(combatEvent.event.record.victimName, "Braovo");

  await fs.rm(tempDir, { recursive: true, force: true });
}

async function testSameTeamCombatRecordIsMarkedTk() {
  const listeners = new Map();
  const moduleEvents = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-kill-manage-"));
  const rawLogFile = path.join(tempDir, "same-team.log");
  const core = {
    logger: { warn() {}, module() {}, info() {}, debug() {} },
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
  const playerState = {
    getPlayerByName(serverId, name) {
      if (serverId !== "BZSS_Main") return null;
      if (name === "Attacker") return { name, teamID: 1 };
      if (name === "Victim") return { name, teamID: 1 };
      return null;
    },
  };
  const config = {
    get(pathText, defaultValue) {
      if (pathText === "modules.killManage") return { enabled: true, rawLogFile };
      return defaultValue;
    },
  };
  const module = createKillManageModule({ core, modules: { playerState }, config });
  await module.start();

  for (const handler of listeners.get("On_PlayerDied") ?? []) {
    handler({
      eventId: "combat:tk",
      eventName: "On_PlayerDied",
      serverId: "BZSS_Main",
      time: "2026-05-09T10:02:00.000Z",
      rawLog: "raw tk death",
      normalized: {
        combat: {
          type: "died",
          victimName: "Victim",
          attackerName: "Attacker",
          damage: 100,
          weapon: "BP_Rifle_C",
        },
      },
    });
  }

  await module.stop();

  const combatEvent = moduleEvents.find((item) => item.eventName === "combatResolved");
  assert.equal(combatEvent.event.record.type, "died");
  assert.equal(combatEvent.event.record.isTeamKill, true);
  assert.equal(combatEvent.event.record.attackerTeamID, 1);
  assert.equal(combatEvent.event.record.victimTeamID, 1);
  assert.ok(combatEvent.event.record.tags.includes("tk"));
  assert.ok(moduleEvents.some((item) => item.eventName === "teamKillResolved"));

  await fs.rm(tempDir, { recursive: true, force: true });
}

async function testSameTeamDamageIsFriendlyDamageNotTk() {
  const listeners = new Map();
  const moduleEvents = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-kill-manage-"));
  const rawLogFile = path.join(tempDir, "same-team-damage.log");
  const core = {
    logger: { warn() {}, module() {}, info() {}, debug() {} },
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
  const playerState = {
    getPlayerByName(serverId, name) {
      if (serverId !== "BZSS_Main") return null;
      if (name === "Attacker") return { name, teamID: 1 };
      if (name === "Victim") return { name, teamID: 1 };
      return null;
    },
  };
  const config = {
    get(pathText, defaultValue) {
      if (pathText === "modules.killManage") return { enabled: true, rawLogFile };
      return defaultValue;
    },
  };
  const module = createKillManageModule({ core, modules: { playerState }, config });
  await module.start();

  for (const handler of listeners.get("On_PlayerDamaged") ?? []) {
    handler({
      eventId: "combat:friendly-damage",
      eventName: "On_PlayerDamaged",
      serverId: "BZSS_Main",
      time: "2026-05-09T10:03:00.000Z",
      rawLog: "raw friendly damage",
      normalized: {
        combat: {
          type: "damaged",
          victimName: "Victim",
          attackerName: "Attacker",
          damage: 25,
          weapon: "BP_Rifle_C",
        },
      },
    });
  }

  await module.stop();

  const combatEvent = moduleEvents.find((item) => item.eventName === "combatResolved");
  assert.equal(combatEvent.event.record.isFriendlyFire, true);
  assert.equal(combatEvent.event.record.isTeamKill, false);
  assert.equal(combatEvent.event.record.friendlyFireType, "team_damage");
  assert.equal(combatEvent.event.record.friendlyFireLabel, "友军伤害");
  assert.ok(moduleEvents.some((item) => item.eventName === "friendlyFireResolved"));
  assert.ok(!moduleEvents.some((item) => item.eventName === "teamKillResolved"));

  await fs.rm(tempDir, { recursive: true, force: true });
}

async function testSameTeamWoundIsTkDownNotTkKill() {
  const listeners = new Map();
  const moduleEvents = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-kill-manage-"));
  const rawLogFile = path.join(tempDir, "same-team-wound.log");
  const core = {
    logger: { warn() {}, module() {}, info() {}, debug() {} },
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
  const playerState = {
    getPlayerByName(serverId, name) {
      if (serverId !== "BZSS_Main") return null;
      if (name === "Attacker") return { name, teamID: 1 };
      if (name === "Victim") return { name, teamID: 1 };
      return null;
    },
  };
  const config = {
    get(pathText, defaultValue) {
      if (pathText === "modules.killManage") return { enabled: true, rawLogFile };
      return defaultValue;
    },
  };
  const module = createKillManageModule({ core, modules: { playerState }, config });
  await module.start();

  for (const handler of listeners.get("On_PlayerWounded") ?? []) {
    handler({
      eventId: "combat:tk-down",
      eventName: "On_PlayerWounded",
      serverId: "BZSS_Main",
      time: "2026-05-09T10:04:00.000Z",
      rawLog: "raw tk down",
      normalized: {
        combat: {
          type: "wounded",
          victimName: "Victim",
          attackerName: "Attacker",
          damage: 80,
          weapon: "BP_Rifle_C",
        },
      },
    });
  }

  await module.stop();

  const combatEvent = moduleEvents.find((item) => item.eventName === "combatResolved");
  assert.equal(combatEvent.event.record.isFriendlyFire, true);
  assert.equal(combatEvent.event.record.isTeamKill, false);
  assert.equal(combatEvent.event.record.isTeamKillDown, true);
  assert.equal(combatEvent.event.record.friendlyFireType, "team_wound");
  assert.equal(combatEvent.event.record.friendlyFireLabel, "TK击倒");
  assert.ok(combatEvent.event.record.tags.includes("tk_down"));
  assert.ok(combatEvent.event.record.eventFlagLabels.includes("TK击倒"));
  assert.ok(moduleEvents.some((item) => item.eventName === "friendlyFireResolved"));
  assert.ok(!moduleEvents.some((item) => item.eventName === "teamKillResolved"));

  await fs.rm(tempDir, { recursive: true, force: true });
}

async function testDiedDamage300AddsGiveUpFlag() {
  const listeners = new Map();
  const moduleEvents = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-kill-manage-"));
  const rawLogFile = path.join(tempDir, "give-up.log");
  const core = {
    logger: { warn() {}, module() {}, info() {}, debug() {} },
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
  const config = {
    get(pathText, defaultValue) {
      if (pathText === "modules.killManage") return { enabled: true, rawLogFile };
      return defaultValue;
    },
  };
  const module = createKillManageModule({ core, modules: {}, config });
  await module.start();

  for (const handler of listeners.get("On_PlayerDied") ?? []) {
    handler({
      eventId: "combat:give-up",
      eventName: "On_PlayerDied",
      serverId: "BZSS_Main",
      time: "2026-05-09T10:05:00.000Z",
      rawLog: "raw give up",
      normalized: {
        combat: {
          type: "died",
          victimName: "PlayerA",
          attackerName: "",
          damage: 300,
          weapon: "",
        },
      },
    });
  }

  await module.stop();

  const combatEvent = moduleEvents.find((item) => item.eventName === "combatResolved");
  assert.deepEqual(combatEvent.event.record.eventFlagLabels, ["放弃"]);
  assert.ok(combatEvent.event.record.eventFlags.some((flag) => flag.key === "give_up"));
  assert.ok(combatEvent.event.record.tags.includes("event:give_up"));

  await fs.rm(tempDir, { recursive: true, force: true });
}

async function testDiedDamage300SameTeamKeepsFriendlyFireInfo() {
  const listeners = new Map();
  const moduleEvents = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-kill-manage-"));
  const rawLogFile = path.join(tempDir, "give-up-tk.log");
  const core = {
    logger: { warn() {}, module() {}, info() {}, debug() {} },
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
  const playerState = {
    getPlayerByName(serverId, name) {
      if (serverId !== "BZSS_Main") return null;
      if (name === "Attacker") return { name, teamID: 2 };
      if (name === "Victim") return { name, teamID: 2 };
      return null;
    },
  };
  const config = {
    get(pathText, defaultValue) {
      if (pathText === "modules.killManage") return { enabled: true, rawLogFile };
      return defaultValue;
    },
  };
  const module = createKillManageModule({ core, modules: { playerState }, config });
  await module.start();

  for (const handler of listeners.get("On_PlayerDied") ?? []) {
    handler({
      eventId: "combat:give-up-tk",
      eventName: "On_PlayerDied",
      serverId: "BZSS_Main",
      time: "2026-05-09T10:05:30.000Z",
      rawLog: "raw give up tk",
      normalized: {
        combat: {
          type: "died",
          victimName: "Victim",
          attackerName: "Attacker",
          damage: 300,
          weapon: "",
        },
      },
    });
  }

  await module.stop();

  const combatEvent = moduleEvents.find((item) => item.eventName === "combatResolved");
  assert.ok(combatEvent.event.record.eventFlagLabels.includes("放弃"));
  assert.ok(combatEvent.event.record.eventFlagLabels.includes("友伤"));
  assert.equal(combatEvent.event.record.isTeamKill, true);

  await fs.rm(tempDir, { recursive: true, force: true });
}

async function testSameTeamWoundAddsFriendlyFireFlag() {
  const listeners = new Map();
  const moduleEvents = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-kill-manage-"));
  const rawLogFile = path.join(tempDir, "friendly-fire.log");
  const core = {
    logger: { warn() {}, module() {}, info() {}, debug() {} },
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
  const playerState = {
    getPlayerByName(serverId, name) {
      if (serverId !== "BZSS_Main") return null;
      if (name === "A") return { name, teamID: 1 };
      if (name === "B") return { name, teamID: 1 };
      return null;
    },
  };
  const config = {
    get(pathText, defaultValue) {
      if (pathText === "modules.killManage") return { enabled: true, rawLogFile };
      return defaultValue;
    },
  };
  const module = createKillManageModule({ core, modules: { playerState }, config });
  await module.start();

  for (const handler of listeners.get("On_PlayerWounded") ?? []) {
    handler({
      eventId: "combat:friendly-fire",
      eventName: "On_PlayerWounded",
      serverId: "BZSS_Main",
      time: "2026-05-09T10:06:00.000Z",
      rawLog: "raw friendly fire",
      normalized: {
        combat: {
          type: "wounded",
          victimName: "B",
          attackerName: "A",
          damage: 35,
          weapon: "BP_Rifle_C",
        },
      },
    });
  }

  await module.stop();

  const combatEvent = moduleEvents.find((item) => item.eventName === "combatResolved");
  assert.ok(combatEvent.event.record.eventFlags.some((flag) => flag.key === "friendly_fire"));
  assert.ok(combatEvent.event.record.eventFlagLabels.includes("友伤"));
  assert.ok(combatEvent.event.record.tags.includes("event:friendly_fire"));

  await fs.rm(tempDir, { recursive: true, force: true });
}

async function testSameIdentityAddsSelfDamageFlag() {
  const listeners = new Map();
  const moduleEvents = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-kill-manage-"));
  const rawLogFile = path.join(tempDir, "self-damage.log");
  const core = {
    logger: { warn() {}, module() {}, info() {}, debug() {} },
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
  const config = {
    get(pathText, defaultValue) {
      if (pathText === "modules.killManage") return { enabled: true, rawLogFile };
      return defaultValue;
    },
  };
  const module = createKillManageModule({ core, modules: {}, config });
  await module.start();

  for (const handler of listeners.get("On_PlayerDamaged") ?? []) {
    handler({
      eventId: "combat:self-damage",
      eventName: "On_PlayerDamaged",
      serverId: "BZSS_Main",
      time: "2026-05-09T10:07:00.000Z",
      rawLog: "raw self damage",
      normalized: {
        combat: {
          type: "damaged",
          victimName: "A",
          attackerName: "A",
          victimSteam64ID: "765xxx",
          attackerSteam64ID: "765xxx",
          damage: 15,
          weapon: "BP_Rifle_C",
        },
      },
    });
  }

  await module.stop();

  const combatEvent = moduleEvents.find((item) => item.eventName === "combatResolved");
  assert.ok(combatEvent.event.record.eventFlags.some((flag) => flag.key === "self_damage"));
  assert.ok(combatEvent.event.record.eventFlagLabels.includes("自伤"));
  assert.ok(combatEvent.event.record.tags.includes("event:self_damage"));

  await fs.rm(tempDir, { recursive: true, force: true });
}

await testWritesOnlyRawLogLines();
await testRconTeamKillEmitsTkRecord();
await testSameTeamCombatRecordIsMarkedTk();
await testSameTeamDamageIsFriendlyDamageNotTk();
await testSameTeamWoundIsTkDownNotTkKill();
await testDiedDamage300AddsGiveUpFlag();
await testDiedDamage300SameTeamKeepsFriendlyFireInfo();
await testSameTeamWoundAddsFriendlyFireFlag();
await testSameIdentityAddsSelfDamageFlag();

console.log("kill manage tests passed");
