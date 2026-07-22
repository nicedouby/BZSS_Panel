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
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].targetPlayerId, "victim-id");
  assert.match(warnings[0].message, /来源：Attacker/);
  assert.match(warnings[0].message, /武器：M4A1突击步枪/);
  await plugin.stop();
}

async function testFriendlyFallbackBotAndEmptyWeapon() {
  const { plugin, warnings } = createHarness();
  await plugin.start();
  await plugin.api.handleCombatEvent({ eventId: "friendly", record: damageRecord({ id: "friendly", relation: { isFriendlyFire: true } }) });
  await plugin.api.handleCombatEvent({ eventId: "fallback", record: damageRecord({ id: "fallback", attacker: { resolved: true, isFallback: true, playerId: "victim-id", name: "Victim" }, weapon: "" }) });
  await plugin.api.handleCombatEvent({ eventId: "bot", record: damageRecord({ id: "bot", isBotAttack: true, attacker: { isBot: true }, weapon: { raw: "Projectile 7.62mm" } }) });
  assert.equal(warnings.length, 3);
  assert.match(warnings[0].message, /友伤：Attacker/);
  assert.match(warnings[1].message, /来源：自身\/环境｜武器：$/);
  assert.match(warnings[2].message, /来源：BOT/);
  await plugin.stop();
}

async function testRejectsAdministrativeInvalidAndSelfDamage() {
  const { plugin, warnings } = createHarness();
  await plugin.start();
  await plugin.api.handleCombatEvent({ eventId: "admin", record: damageRecord({ damage: "1000000" }) });
  await plugin.api.handleCombatEvent({ eventId: "wound", record: damageRecord({ type: "wound" }) });
  await plugin.api.handleCombatEvent({ eventId: "invalid", record: damageRecord({ attacker: { resolved: false, name: "Unknown" } }) });
  await plugin.api.handleCombatEvent({ eventId: "self", record: damageRecord({ attacker: { resolved: true, playerId: "victim-id", name: "Victim" } }) });
  assert.equal(warnings.length, 0);
  const state = plugin.api.getState();
  assert.equal(state.adminPunishmentSkipped, 1);
  assert.equal(state.nonDamageSkipped, 1);
  assert.equal(state.invalidAttackerSkipped, 1);
  assert.equal(state.selfAttackerSkipped, 1);
  await plugin.stop();
}

async function testDedupesAndUnsubscribes() {
  const { plugin, listeners, warnings } = createHarness();
  await plugin.start();
  const handler = [...listeners.get("module.combatManager:COMBAT_EVENT_PROCESSED")][0];
  handler({ eventId: "dup", record: damageRecord({ id: "dup" }) });
  await new Promise((resolve) => setImmediate(resolve));
  await plugin.api.handleCombatEvent({ eventId: "dup", record: damageRecord({ id: "dup" }) });
  assert.equal(warnings.length, 1);
  assert.equal(plugin.api.getState().duplicateSkipped, 1);
  await plugin.stop();
  assert.equal(listeners.get("module.combatManager:COMBAT_EVENT_PROCESSED").size, 0);
}

await testStandardDamageAndWeaponCompaction();
await testFriendlyFallbackBotAndEmptyWeapon();
await testRejectsAdministrativeInvalidAndSelfDamage();
await testDedupesAndUnsubscribes();

console.log("victim damage display tests passed");
