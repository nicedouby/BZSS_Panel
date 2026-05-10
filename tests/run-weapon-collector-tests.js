import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPlugin } from "../plugins/weapon-collector.js";

async function testWeaponCollectorMergesAliases() {
  const listeners = new Map();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-weapon-collector-"));
  const previousCwd = process.cwd();
  process.chdir(tempDir);

  try {
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

    await plugin.start();

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
    assert.equal(byCategory.get("Soldiers_WPMC_Crewman")?.died, 1);
    assert.equal(byCategory.get("Projectile_30mm_HE")?.damaged, 2);

    const typeMap = plugin.api.getWeaponTypeMap();
    assert.equal(typeMap.C7A2_ET552_Foregrip, "C7A2");
    assert.equal(typeMap.C7A2_Ironsights, "C7A2");
    assert.equal(typeMap.C7A2_Ironsights_Foregrip, "C7A2");
    assert.equal(typeMap.T90A_Desert, "T90A");
    assert.equal(typeMap.Soldiers_WPMC_Crewman_01, "Soldiers_WPMC_Crewman");
    assert.equal(typeMap.Projectile_30mm_HE_Red, "Projectile_30mm_HE");
    assert.equal(typeMap.Projectile_30mm_HE_Green, "Projectile_30mm_HE");

    await plugin.stop();

    const persisted = JSON.parse(await fs.readFile(path.join(tempDir, "data", "weapon-stats.json"), "utf8"));
    assert.equal(persisted.servers.BZSS_Main.C7A2.died, 1);
    assert.equal(persisted.weaponTypeMap.C7A2_ET552_Foregrip, "C7A2");
  } finally {
    process.chdir(previousCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

await testWeaponCollectorMergesAliases();

console.log("weapon collector tests passed");
