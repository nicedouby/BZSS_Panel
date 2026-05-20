import assert from "node:assert/strict";

import { createPlugin } from "../plugins/damage-display.js";

function createHarness({ warnPlayer } = {}) {
  const listeners = new Map();
  const warningPatches = [];
  const warnCalls = [];

  const plugin = createPlugin({
    core: {
      logger: { info() {}, warn() {} },
      config: {
        get(pathText, defaultValue) {
          if (pathText === "plugins.damageDisplay") return {};
          return defaultValue;
        },
      },
      pluginSubscriptions: { isSubscribed() { return true; } },
      eventBus: {
        onModuleEvent(moduleId, eventName, handler) {
          const key = `${moduleId}:${eventName}`;
          if (!listeners.has(key)) listeners.set(key, new Set());
          listeners.get(key).add(handler);
          return () => listeners.get(key)?.delete(handler);
        },
      },
    },
    modules: {
      pluginSubscriptions: { isSubscribed() { return true; } },
      combatClean: {
        updateWarningState(id, patch) {
          warningPatches.push({ id, patch });
        },
      },
      adminWarn: {
        async warnPlayer(input) {
          warnCalls.push(input);
          if (typeof warnPlayer === "function") return warnPlayer(input);
          return { success: true, skipped: false };
        },
      },
    },
  });

  return { plugin, listeners, warningPatches, warnCalls };
}

async function testSmallArmDamageWarnsVictimAndAttacker() {
  const { plugin, listeners, warningPatches, warnCalls } = createHarness();
  await plugin.start();
  const handler = [...(listeners.get("module.combatClean:combat.record.processed") ?? [])][0];
  assert.ok(handler);

  await handler({
    record: {
      id: "combat-1",
      type: "damage",
      damage: 24,
      attackerName: "玩家A",
      attackerEosId: "eos-a",
      victimName: "玩家B",
      victimEosId: "eos-b",
      weaponName: "AK74",
      tags: [
        "combat.damage",
        "weapon.small_arm",
        "weapon.rifle",
        "damage.direct",
        "attacker.valid",
        "victim.valid",
        "relation.enemy",
      ],
    },
  });

  assert.equal(warnCalls.length, 2);
  assert.equal(warnCalls[0].targetName, "玩家B");
  assert.equal(warnCalls[0].message, "你受到 玩家A 的 24 点伤害");
  assert.equal(warnCalls[1].targetName, "玩家A");
  assert.equal(warnCalls[1].message, "命中 玩家B，造成 24 点伤害");
  assert.equal(warningPatches.length, 2);
  assert.equal(warningPatches[0].patch.victim.success, true);
  assert.equal(warningPatches[1].patch.attacker.success, true);
  await plugin.stop();
}

async function testExplosiveDamageOnlyWarnsVictim() {
  const { plugin, listeners, warningPatches, warnCalls } = createHarness();
  await plugin.start();
  const handler = [...(listeners.get("module.combatClean:combat.record.processed") ?? [])][0];

  await handler({
    record: {
      id: "combat-2",
      type: "damage",
      damage: 65,
      attackerName: "玩家A",
      victimName: "玩家B",
      weaponName: "Frag",
      tags: [
        "combat.damage",
        "weapon.explosive",
        "damage.splash",
        "attacker.valid",
        "victim.valid",
        "relation.enemy",
      ],
    },
  });

  assert.equal(warnCalls.length, 1);
  assert.equal(warnCalls[0].targetName, "玩家B");
  assert.equal(warningPatches.length, 2);
  assert.equal(warningPatches[0].patch.victim.success, true);
  assert.equal(warningPatches[1].patch.attacker.reason, "policy_denied");
  assert.equal(warningPatches[1].patch.attacker.skipped, true);
  await plugin.stop();
}

async function testWorldFallDamageUsesResolvedVictimMessage() {
  const { plugin, listeners, warningPatches, warnCalls } = createHarness();
  await plugin.start();
  const handler = [...(listeners.get("module.combatClean:combat.record.processed") ?? [])][0];

  await handler({
    record: {
      id: "combat-3",
      type: "damage",
      damage: 18,
      victimName: "玩家B",
      victimEosId: "eos-b",
      weaponName: "",
      tags: [
        "combat.damage",
        "attacker.world",
        "victim.valid",
        "damage.fall",
        "relation.unknown",
      ],
    },
  });

  assert.equal(warnCalls.length, 1);
  assert.equal(warnCalls[0].message, "你受到 摔落 的 18 点伤害");
  assert.equal(warningPatches[0].patch.victim.success, true);
  assert.equal(warningPatches[1].patch.attacker.reason, "policy_denied");
  await plugin.stop();
}

await testSmallArmDamageWarnsVictimAndAttacker();
await testExplosiveDamageOnlyWarnsVictim();
await testWorldFallDamageUsesResolvedVictimMessage();

console.log("damage display tests passed");
