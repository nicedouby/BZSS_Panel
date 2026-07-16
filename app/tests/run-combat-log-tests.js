import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createCombatLogModule } from "../modules/combat-log/index.js";

function createHarness({ moduleConfig = {} } = {}) {
  const listeners = new Map();
  const registeredPages = [];

  const core = {
    logger: { info() {}, warn() {}, error() {}, module() {} },
    webRegistry: {
      registerPage(page) {
        registeredPages.push(page);
      },
    },
    pluginSubscriptions: {
      isSubscribed() {
        return true;
      },
    },
    eventBus: {
      onModuleEvent(moduleId, eventName, handler) {
        const key = `${moduleId}:${eventName}`;
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(handler);
        return () => listeners.get(key)?.delete(handler);
      },
    },
  };

  const config = {
    get(pathText, defaultValue) {
      if (pathText === "modules.combatLog") {
        return {
          enabled: true,
          directory: "./data/combat-logs",
          ...moduleConfig,
        };
      }
      return defaultValue;
    },
  };

  const module = createCombatLogModule({ core, modules: {}, config, logger: core.logger });

  return {
    module,
    registeredPages,
    async emit(moduleId, eventName, payload) {
      const handlers = [...(listeners.get(`${moduleId}:${eventName}`) ?? [])];
      return Promise.all(handlers.map((handler) => handler(payload)));
    },
  };
}

async function withTempCombatLog(run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-combat-log-"));
  const previousCwd = process.cwd();
  process.chdir(tempDir);

  try {
    const harness = createHarness();
    await run({ ...harness, tempDir });
  } finally {
    process.chdir(previousCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testWritesDailyFileAndExposesBrowseApis() {
  await withTempCombatLog(async ({ module, emit, tempDir, registeredPages }) => {
    await module.start();

    const payload = {
      record: {
        sourceEventId: "combat-log-test-1",
        serverId: "BZSS_Main",
        time: "2026-06-02T15:04:05+08:00",
        type: "damaged",
        eventFlagLabels: ["友军伤害"],
        attackerName: "Attacker",
        victimName: "Victim",
        damage: 37.5,
        weapon: "BP_Rifle_C",
      },
    };

    await emit("module.combatState", "updated", payload);
    await emit("module.combatClean", "damageResolved", payload);
    await module.stop();

    const filePath = path.join(tempDir, "data", "combat-logs", "2026-06", "2026-06-02.log");
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.trim().split(/\r?\n/);

    assert.equal(lines.length, 1);
    assert.equal(lines[0], "15:04:05\tdamage\t友军伤害\tAttacker\tVictim\t37.5\tBP_Rifle_C");

    const months = await module.api.listMonths();
    assert.equal(months.length, 1);
    assert.equal(months[0].month, "2026-06");
    assert.equal(months[0].fileCount, 1);
    assert.equal(months[0].latestDate, "2026-06-02");

    const files = await module.api.listFiles("2026-06");
    assert.equal(files.length, 1);
    assert.equal(files[0].date, "2026-06-02");
    assert.equal(files[0].size > 0, true);

    const result = await module.api.readLog({
      month: "2026-06",
      date: "2026-06-02",
      q: "Attacker",
      limit: 50,
      offset: 0,
    });

    assert.equal(result.total, 1);
    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0].attacker, "Attacker");
    assert.equal(result.lines[0].weapon, "BP_Rifle_C");

    const status = module.api.getStatus();
    assert.match(status.currentFilePath, /2026-06-02\.log$/);
    assert.equal(registeredPages.some((page) => page.route === "/combat-log"), true);
  });
}

async function testDuplicateEventKeyIsWrittenOnce() {
  await withTempCombatLog(async ({ module, emit, tempDir }) => {
    await module.start();

    const payload = {
      record: {
        sourceEventId: "combat-log-test-dup",
        serverId: "BZSS_Main",
        time: "2026-06-02T20:00:00+08:00",
        type: "died",
        attackerName: "Attacker",
        victimName: "Victim",
        damage: 100,
        weapon: "BP_Sniper_C",
      },
    };

    await emit("module.combatState", "updated", payload);
    await emit("module.killManage", "teamKillResolved", payload);
    await module.stop();

    const filePath = path.join(tempDir, "data", "combat-logs", "2026-06", "2026-06-02.log");
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.trim().split(/\r?\n/);

    assert.equal(lines.length, 1);
    assert.equal(lines[0], "20:00:00\tkill\t-\tAttacker\tVictim\t100\tBP_Sniper_C");
  });
}

async function testSquidBotAttackerWritesBotInCombatLog() {
  await withTempCombatLog(async ({ module, emit, tempDir }) => {
    await module.start();

    const payload = {
      record: {
        sourceEventId: "combat-log-bot-controller",
        serverId: "BZSS_Main",
        time: "2026-06-02T16:54:24+08:00",
        type: "died",
        attackerName: "SquidBotAIController_C_2147353751",
        attackerControllerID: "SquidBotAIController_C_2147353751",
        victimName: "JoStar",
        damage: -300,
        weapon: "Grenade爆炸物",
      },
    };

    await emit("module.combatState", "updated", payload);
    await module.stop();

    const filePath = path.join(tempDir, "data", "combat-logs", "2026-06", "2026-06-02.log");
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.trim().split(/\r?\n/);

    assert.equal(lines.length, 1);
    assert.equal(lines[0], "16:54:24\tkill\t-\tbot\tJoStar\t-300\tGrenade爆炸物");
  });
}

async function testProjectileWeaponWritesBotInCombatLog() {
  await withTempCombatLog(async ({ module, emit, tempDir }) => {
    await module.start();

    const payload = {
      record: {
        sourceEventId: "combat-log-bot-projectile",
        serverId: "BZSS_Main",
        time: "2026-06-02T16:54:25+08:00",
        type: "died",
        attackerName: "JoStar",
        victimName: "Victim",
        damage: 300,
        weapon: "Projectile",
      },
    };

    await emit("module.combatState", "updated", payload);
    await module.stop();

    const filePath = path.join(tempDir, "data", "combat-logs", "2026-06", "2026-06-02.log");
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.trim().split(/\r?\n/);

    assert.equal(lines.length, 1);
    assert.equal(lines[0], "16:54:25\tkill\t-\tbot\tVictim\t300\tProjectile");
  });
}

async function testSearchesAcrossFilesAndMatchesVictimTeamId() {
  await withTempCombatLog(async ({ module, emit }) => {
    await module.start();

    await emit("module.combatState", "updated", {
      record: {
        sourceEventId: "combat-search-1",
        time: "2026-06-02T10:00:00+08:00",
        type: "damaged",
        attackerName: "Alpha",
        victimName: "Bravo",
        victimTeamID: "2",
        damage: 37.5,
        weapon: "Rifle",
      },
    });
    await emit("module.combatState", "updated", {
      record: {
        sourceEventId: "combat-search-2",
        time: "2026-06-03T11:00:00+08:00",
        type: "died",
        attackerName: "Charlie",
        victimName: "Delta",
        victimTeamID: "1",
        damage: 100,
        weapon: "Pistol",
      },
    });
    await module.stop();

    const result = await module.api.searchLog({
      from: "2026-06-02T00:00:00+08:00",
      to: "2026-06-02T23:59:59+08:00",
      victim: "2",
      eventType: "damage",
      weapon: "rifle",
      damage: "37.5",
      limit: 50,
    });

    assert.equal(result.total, 1);
    assert.equal(result.lines[0].victim, "Bravo");
    assert.equal(result.lines[0].victimTeamId, "2");
    assert.equal(result.lines[0].weapon, "Rifle");
  });
}


async function testRawAndCleanRepresentationsAreWrittenOnce() {
  await withTempCombatLog(async ({ module, emit, tempDir }) => {
    await module.start();

    const rawPayload = {
      record: {
        sourceEventId: "raw-clean-dup",
        serverId: "BZSS_Main",
        time: "2026-06-02T21:00:00+08:00",
        type: "wound",
        victimName: "Victim",
        damage: 62,
        weapon: "BP_Projectile_C_2147432581",
        rawLog: "same-combat-log-line",
      },
    };
    const cleanPayload = {
      record: {
        serverId: "BZSS_Main",
        time: "2026-06-02T21:00:00+08:00",
        type: "wound",
        attackerName: "",
        victimName: "Victim",
        damage: 62,
        weapon: "Projectile",
        raw: {
          sourceEventId: "raw-clean-dup",
          rawLog: "same-combat-log-line",
        },
      },
    };

    await emit("module.combatState", "updated", rawPayload);
    await emit("module.combatClean", "woundResolved", cleanPayload);
    await module.stop();

    const filePath = path.join(tempDir, "data", "combat-logs", "2026-06", "2026-06-02.log");
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.trim().split(/\r?\n/);
    assert.equal(lines.length, 1);
  });
}
await testWritesDailyFileAndExposesBrowseApis();
await testDuplicateEventKeyIsWrittenOnce();
await testRawAndCleanRepresentationsAreWrittenOnce();
await testSquidBotAttackerWritesBotInCombatLog();
await testProjectileWeaponWritesBotInCombatLog();
await testSearchesAcrossFilesAndMatchesVictimTeamId();

console.log("combat log tests passed");
