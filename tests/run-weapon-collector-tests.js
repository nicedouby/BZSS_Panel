import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPlugin } from "../plugins/weapon-collector.js";

async function withWeaponCollector({ initialState } = {}, run) {
  const listeners = new Map();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-weapon-collector-"));
  const previousCwd = process.cwd();
  process.chdir(tempDir);

  try {
    if (initialState) {
      await fs.mkdir(path.join(tempDir, "data"), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, "data", "weapon-stats.json"),
        `${JSON.stringify(initialState, null, 2)}\n`,
        "utf8",
      );
    }

    const core = {
      logger: { warn() {}, info() {} },
      pluginSubscriptions: { isSubscribed() { return true; } },
      webRegistry: { registerPage() {} },
      eventBus: {
        onModuleEvent(moduleId, eventName, handler) {
          const key = `${moduleId}:${eventName}`;
          if (!listeners.has(key)) listeners.set(key, new Set());
          listeners.get(key).add(handler);
          return () => listeners.get(key)?.delete(handler);
        },
      },
    };

    const plugin = createPlugin({
      core,
      modules: {
        pluginSubscriptions: { isSubscribed() { return true; } },
      },
    });

    let stopped = false;
    const stopPlugin = async () => {
      if (stopped) return;
      stopped = true;
      await plugin.stop();
    };

    await plugin.start();
    try {
      await run({ plugin, listeners, tempDir, stopPlugin });
    } finally {
      await stopPlugin();
    }
  } finally {
    process.chdir(previousCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testWeaponCollectorMergesAliases() {
  await withWeaponCollector({}, async ({ plugin, listeners, stopPlugin }) => {
    const handler = [...(listeners.get("module.killManage:combatResolved") ?? [])][0];
    assert.ok(handler, "combatResolved handler should be registered");

    const records = [
      { weapon: "BP_C7A2_ET552_Foregrip_C_1001", type: "damaged" },
      { weapon: "BP_C7A2_Ironsights_C_1002", type: "wounded" },
      { weapon: "BP_C7A2_Ironsights_Foregrip_C_1003", type: "died" },
      { weapon: "BP_T90A_Desert_C_1004", type: "died" },
      { weapon: "BP_Soldiers_WPMC_Crewman_01_C_1005", type: "died" },
      { weapon: "BP_Projectile_30mm_HE_Red_C_1006", type: "damaged" },
      { weapon: "BP_Projectile_30mm_HE_Green_C_1007", type: "damaged" },
    ];

    for (const [index, record] of records.entries()) {
      handler({
        record: {
          serverId: "BZSS_Main",
          time: new Date(Date.UTC(2026, 4, 9, 10, index, 0)).toISOString(),
          ...record,
        },
      });
    }

    const stats = plugin.api.getWeaponStats("BZSS_Main");
    const byCategory = new Map(stats.map((entry) => [entry.category, entry]));

    assert.equal(byCategory.get("C7A2")?.damaged, 1);
    assert.equal(byCategory.get("C7A2")?.wounded, 1);
    assert.equal(byCategory.get("C7A2")?.died, 1);
    assert.deepEqual(byCategory.get("C7A2")?.aliases?.sort(), [
      "C7A2_ET552_Foregrip",
      "C7A2_Ironsights",
      "C7A2_Ironsights_Foregrip",
    ]);

    assert.equal(byCategory.get("T90A")?.died, 1);
    assert.equal(byCategory.get("T90A")?.sourceType, "vehicle");
    assert.equal(byCategory.get("Soldiers_WPMC_Crewman")?.died, 1);
    assert.equal(byCategory.get("Soldiers_WPMC_Crewman")?.sourceType, "soldier");
    assert.equal(byCategory.get("Projectile_30mm_HE")?.damaged, 2);

    const typeMap = plugin.api.getWeaponTypeMap();
    assert.equal(typeMap.C7A2_ET552_Foregrip, "C7A2");
    assert.equal(typeMap.C7A2_Ironsights, "C7A2");
    assert.equal(typeMap.C7A2_Ironsights_Foregrip, "C7A2");
    assert.equal(typeMap.T90A_Desert, "T90A");
    assert.equal(typeMap.Soldiers_WPMC_Crewman_01, "Soldiers_WPMC_Crewman");
    assert.equal(typeMap.Projectile_30mm_HE_Red, "Projectile_30mm_HE");
    assert.equal(typeMap.Projectile_30mm_HE_Green, "Projectile_30mm_HE");

    await stopPlugin();
    const persisted = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "weapon-stats.json"), "utf8"));
    assert.equal(persisted.servers.BZSS_Main.C7A2.died, 1);
    assert.equal(persisted.weaponTypeMap.C7A2_ET552_Foregrip, "C7A2");
  });
}

async function testWeaponCollectorPreservesEmbeddedC7A2() {
  await withWeaponCollector({}, async ({ plugin, listeners }) => {
    const handler = [...(listeners.get("module.killManage:combatResolved") ?? [])][0];
    assert.ok(handler, "combatResolved handler should be registered");

    handler({
      record: {
        serverId: "BZSS_Main",
        time: new Date(Date.UTC(2026, 4, 9, 10, 0, 0)).toISOString(),
        weapon: "BP_C7A2",
        type: "damaged",
      },
    });

    const stats = plugin.api.getWeaponStats("BZSS_Main");
    const byCategory = new Map(stats.map((entry) => [entry.category, entry]));

    assert.equal(byCategory.get("C7A2")?.damaged, 1);
    assert.equal(byCategory.get("C7A2")?.rawName, "BP_C7A2");
    assert.equal(byCategory.get("BP"), undefined);
  });
}

async function testWeaponCollectorDropsUnknownAliases() {
  await withWeaponCollector({
    initialState: {
      updatedAt: "2026-05-09T10:00:00.000Z",
      servers: {
        BZSS_Main: {
          Unknown: {
            category: "Unknown",
            cleanedName: "Unknown",
            rawName: "",
            rawCategory: null,
            aliases: [null, "", "Unknown"],
            damaged: 0,
            wounded: 0,
            died: 0,
            firstSeen: "2026-05-09T10:00:00.000Z",
            lastSeen: "2026-05-09T10:00:00.000Z",
          },
        },
      },
      weaponTypeMap: {},
    },
  }, async ({ plugin }) => {
    const stats = plugin.api.getWeaponStats("BZSS_Main");
    assert.equal(stats.length, 1);
    assert.deepEqual(stats[0].aliases, []);
  });
}

async function testWeaponCollectorHandlesInvalidEventTime() {
  await withWeaponCollector({}, async ({ plugin, listeners, tempDir, stopPlugin }) => {
    const handler = [...(listeners.get("module.killManage:combatResolved") ?? [])][0];
    assert.ok(handler, "combatResolved handler should be registered");

    handler({
      record: {
        serverId: "BZSS_Main",
        time: "not-a-date",
        weapon: "BP_C7A2",
        type: "damaged",
      },
    });

    await stopPlugin();
    const persisted = JSON.parse(await fs.readFile(path.join(tempDir, "data", "weapon-stats.json"), "utf8"));
    const saved = persisted.servers.BZSS_Main.C7A2;
    assert.equal(Number.isNaN(Date.parse(saved.firstSeen)), false);
    assert.equal(Number.isNaN(Date.parse(saved.lastSeen)), false);
  });
}

async function testWeaponCollectorClassifiesT90AAsVehicle() {
  await withWeaponCollector({}, async ({ plugin, listeners }) => {
    const handler = [...(listeners.get("module.killManage:combatResolved") ?? [])][0];
    assert.ok(handler, "combatResolved handler should be registered");

    handler({
      record: {
        serverId: "BZSS_Main",
        time: new Date(Date.UTC(2026, 4, 9, 10, 0, 0)).toISOString(),
        weapon: "BP_T90A_Desert_C_1004",
        type: "died",
      },
    });

    const stats = plugin.api.getWeaponStats("BZSS_Main");
    const byCategory = new Map(stats.map((entry) => [entry.category, entry]));

    assert.equal(byCategory.get("T90A")?.died, 1);
    assert.equal(byCategory.get("T90A")?.sourceType, "vehicle");
    assert.equal(byCategory.get("T90A")?.rawCategory, "T90A_Desert");
    assert.equal(plugin.api.getWeaponTypeMap().T90A_Desert, "T90A");
  });
}

await testWeaponCollectorMergesAliases();
await testWeaponCollectorPreservesEmbeddedC7A2();
await testWeaponCollectorDropsUnknownAliases();
await testWeaponCollectorHandlesInvalidEventTime();
await testWeaponCollectorClassifiesT90AAsVehicle();

console.log("weapon collector tests passed");
