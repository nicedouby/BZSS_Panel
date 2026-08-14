import assert from "node:assert/strict";

import { createPlugin } from "../plugins/victim-damage-display.js";

function createHarness(pluginConfig = {}) {
  const listeners = new Map();
  const warnings = [];
  const core = {
    eventBus: {
      onModuleEvent(moduleId, eventName, handler) {
        const key = `${moduleId}:${eventName}`;
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(handler);
        return () => listeners.get(key)?.delete(handler);
      },
    },
    pluginSubscriptions: { isSubscribed: () => true },
  };
  const modules = {
    adminWarn: {
      async warnPlayer(request) {
        warnings.push(request);
        return { success: true };
      },
    },
  };
  const plugin = createPlugin({
    core,
    modules,
    logger: { info() {}, warn() {} },
    config: { get(key, fallback) { return key === "plugins.victimDamageDisplay" ? pluginConfig : fallback; } },
  });
  return { plugin, listeners, warnings };
}

function damageRecord(overrides = {}) {
  return {
    id: "damage-1",
    type: "damage",
    damage: 25,
    weapon: { raw: "BP-M4A1-C-123456789" },
    attacker: { resolved: true, playerId: "attacker-id", name: "Attacker" },
    victim: { resolved: true, playerId: "victim-id", name: "Victim" },
    relation: { isFriendlyFire: false },
    ...overrides,
  };
}

async function testStandardDamageAndWeaponCompaction() {
  const { plugin, warnings } = createHarness({ weaponAliases: { "bp-m4a1-c": "M4A1突击步枪" } });
  await plugin.start();
  await plugin.api.handleCombatEvent({ eventId: "event-1", record: damageRecord() });
  assert.equal(warnings.length, 2);
  const victimWarning = warnings.find((warning) => warning.reason === "victim_damage_display");
  const attackerWarning = warnings.find((warning) => warning.reason === "attacker_damage_display");
  assert.equal(victimWarning.targetPlayerId, "victim-id");
  assert.match(victimWarning.message, /来源：Attacker/);
  assert.match(victimWarning.message, /武器：M4A1突击步枪/);
  assert.equal(attackerWarning.targetPlayerId, "attacker-id");
  assert.equal(attackerWarning.targetName, "Attacker");
  assert.match(attackerWarning.message, /造成 25 点伤害/);
  assert.match(attackerWarning.message, /目标：Victim/);
  assert.match(attackerWarning.message, /武器：M4A1突击步枪/);
  await plugin.stop();
}

async function testFriendlyFallbackBotAndEmptyWeapon() {
  const { plugin, warnings } = createHarness();
  await plugin.start();
  await plugin.api.handleCombatEvent({ eventId: "friendly", record: damageRecord({ id: "friendly", relation: { isFriendlyFire: true } }) });
  await plugin.api.handleCombatEvent({ eventId: "fallback", record: damageRecord({ id: "fallback", attacker: { resolved: true, isFallback: true, playerId: "victim-id", name: "Victim" }, weapon: "" }) });
  await plugin.api.handleCombatEvent({ eventId: "bot", record: damageRecord({ id: "bot", isBotAttack: true, attacker: { isBot: true }, weapon: { raw: "Projectile 7.62mm" } }) });
  assert.equal(warnings.length, 4);
  assert.match(warnings.find((warning) => warning.reason === "attacker_damage_display").message, /造成 25 点友军伤害/);
  const victimWarnings = warnings.filter((warning) => warning.reason === "victim_damage_display");
  assert.match(victimWarnings[0].message, /友伤：Attacker/);
  assert.match(victimWarnings[1].message, /来源：自身\/环境｜武器：$/);
  assert.match(victimWarnings[2].message, /来源：BOT/);
  await plugin.stop();
}

async function testExplosiveDamageWithoutResolvedAttackerStillDisplays() {
  const { plugin, warnings } = createHarness();
  await plugin.start();
  await plugin.api.handleCombatEvent({
    eventId: "explosive",
    record: damageRecord({
      id: "explosive",
      attacker: { resolved: false },
      weapon: { raw: "BP_M67_Frag_Grenade_C_123456" },
    }),
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /来源：自身\/环境/);
  await plugin.stop();
}

async function testWarnsEveryPositiveDamageIncludingAdministrativeAndSelfDamage() {
  const { plugin, warnings } = createHarness();
  await plugin.start();
  await plugin.api.handleCombatEvent({ eventId: "admin", record: damageRecord({ id: "admin", damage: "1000000" }) });
  await plugin.api.handleCombatEvent({ eventId: "wound", record: damageRecord({ id: "wound", type: "wound" }) });
  await plugin.api.handleCombatEvent({ eventId: "unresolved", record: damageRecord({ id: "unresolved", attacker: { resolved: false } }) });
  await plugin.api.handleCombatEvent({ eventId: "self", record: damageRecord({ id: "self", attacker: { resolved: true, playerId: "victim-id", name: "Victim" } }) });
  assert.equal(warnings.length, 4);
  const victimWarnings = warnings.filter((warning) => warning.reason === "victim_damage_display");
  const attackerWarnings = warnings.filter((warning) => warning.reason === "attacker_damage_display");
  assert.equal(attackerWarnings.length, 1);
  assert.match(attackerWarnings[0].message, /造成 1000000 点伤害/);
  assert.match(victimWarnings[0].message, /受到 1000000 点伤害/);
  assert.match(victimWarnings[1].message, /来源：自身\/环境/);
  assert.match(victimWarnings[2].message, /来源：自身/);
  const state = plugin.api.getState();
  assert.equal(state.adminPunishmentSkipped, 0);
  assert.equal(state.nonDamageSkipped, 1);
  assert.equal(state.selfAttackerSkipped, 0);
  await plugin.stop();
}

async function testDedupesAndUnsubscribes() {
  const { plugin, listeners, warnings } = createHarness();
  await plugin.start();
  const handler = [...listeners.get("module.combatManager:COMBAT_EVENT_PROCESSED")][0];
  handler({ eventId: "dup", record: damageRecord({ id: "dup" }) });
  await new Promise((resolve) => setImmediate(resolve));
  await plugin.api.handleCombatEvent({ eventId: "dup", record: damageRecord({ id: "dup" }) });
  assert.equal(warnings.length, 2);
  assert.equal(warnings.filter((warning) => warning.reason === "attacker_damage_display").length, 1);
  assert.equal(plugin.api.getState().attackerDisplayed, 1);
  assert.equal(plugin.api.getState().duplicateSkipped, 1);
  await plugin.stop();
  assert.equal(listeners.get("module.combatManager:COMBAT_EVENT_PROCESSED").size, 0);
}

await testStandardDamageAndWeaponCompaction();
await testFriendlyFallbackBotAndEmptyWeapon();
await testExplosiveDamageWithoutResolvedAttackerStillDisplays();
await testWarnsEveryPositiveDamageIncludingAdministrativeAndSelfDamage();
await testDedupesAndUnsubscribes();

console.log("victim damage display tests passed");
