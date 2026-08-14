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
    playerState: {
      findPlayer(_serverId, identity = {}) {
        if (identity.name === "Victim") return { name: "Victim", playerID: "84" };
        return null;
      },
    },
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

function damageRecord() {
  return {
    id: "damage-disabled",
    type: "damage",
    damage: 40,
    weapon: { raw: "QJB95-1 LSW Optic" },
    serverId: "BZSS_Main",
    attacker: { resolved: true, name: "Attacker" },
    victim: { resolved: true, name: "Victim", playerID: "84" },
  };
}

const harness = createHarness({
  enabled: true,
  showVictimDamage: true,
  showAttackerDamage: true,
});
await harness.plugin.start();

assert.equal(harness.plugin.api.getState().active, false);
assert.equal(harness.plugin.api.getState().config.enabled, false);
assert.equal(harness.plugin.api.getState().config.showVictimDamage, false);
assert.equal(harness.plugin.api.getState().config.showAttackerDamage, false);

const result = await harness.plugin.api.handleCombatEvent({
  eventId: "damage-disabled",
  record: damageRecord(),
});
assert.equal(result.skipped, true);
assert.equal(result.skipReason, "disabled");
assert.equal(harness.warnings.length, 0, "neither victim nor attacker may receive damage warnings");

const handler = [...harness.listeners.get("module.combatManager:COMBAT_EVENT_PROCESSED")][0];
handler({ eventId: "event-bus-damage", record: { ...damageRecord(), id: "event-bus-damage" } });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(harness.warnings.length, 0);

await harness.plugin.stop();
assert.equal(harness.listeners.get("module.combatManager:COMBAT_EVENT_PROCESSED").size, 0);

console.log("victim damage display disabled tests passed");
