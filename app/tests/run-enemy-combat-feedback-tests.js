import assert from "node:assert/strict";
import { createPlugin } from "../plugins/enemy-combat-feedback.js";

function createHarness(overrides = {}) {
  const moduleHandlers = new Map();
  const warnings = [];
  const settings = new Map(Object.entries({
    "plugins.enemyCombatFeedback": { enabled: true },
    ...(overrides.settings ?? {}),
  }));
  const attacker = overrides.attacker === undefined ? {
    name: "Attacker", steamID: "steam-attacker", eosID: "eos-attacker", playerID: "42", teamID: "1",
  } : overrides.attacker;
  const plugin = createPlugin({
    core: {
      webStatus: { serverId: "BZSS_Main" },
      pluginSubscriptions: { isSubscribed: () => true },
      eventBus: {
        onModuleEvent(moduleId, eventName, handler) {
          moduleHandlers.set(`${moduleId}:${eventName}`, handler);
          return () => moduleHandlers.delete(`${moduleId}:${eventName}`);
        },
      },
    },
    modules: {
      playerState: {
        getPlayerBySteamID(_serverId, steamID) { return steamID === "steam-attacker" ? attacker : null; },
        getPlayerByEOSID(_serverId, eosID) { return eosID === "eos-attacker" ? attacker : null; },
        getPlayerByControllerID() { return null; },
        getPlayerByName(_serverId, name) { return name === "Attacker" ? attacker : null; },
      },
      adminWarn: { async sendAdminWarn(request) { warnings.push(request); return { success: true }; } },
    },
    config: { get(key, fallback) { return settings.get(key) ?? fallback; } },
    logger: { debug() {}, info() {}, warn() {} },
  });
  return { plugin, warnings, moduleHandlers };
}

function event(overrides = {}) {
  return {
    eventId: "combat-1",
    serverId: "BZSS_Main",
    record: {
      id: "combat-1",
      serverId: "BZSS_Main",
      time: "2026-08-13T00:00:00.000Z",
      type: "wound",
      damage: 25,
      attackerName: "Attacker",
      attackerSteam64ID: "steam-attacker",
      attackerEOSID: "eos-attacker",
      attackerTeamID: "1",
      victimName: "Victim",
      victimSteam64ID: "steam-victim",
      victimEOSID: "eos-victim",
      victimTeamID: "2",
      ...overrides,
    },
  };
}

async function send(overrides, harnessOptions) {
  const harness = createHarness(harnessOptions);
  await harness.plugin.start();
  await harness.plugin.api.handleCombatEvent(event(overrides));
  await harness.plugin.stop();
  return harness;
}

let harness = await send({ type: "damage", damage: 25.125 });
assert.equal(harness.warnings.length, 0, "damage feedback must remain globally disabled");
assert.equal(harness.plugin.api.getState().totalDamageFeedback, 0);

harness = await send({});
assert.equal(harness.warnings.length, 0, "wound feedback must remain globally disabled");
assert.equal(harness.plugin.api.getState().totalWoundFeedback, 0);

harness = await send({ type: "death" });
assert.equal(harness.warnings.length, 0, "death feedback must remain globally disabled");
assert.equal(harness.plugin.api.getState().totalDeathFeedback, 0);

for (const record of [
  { type: "damage", damage: 0 },
  { type: "damage", damage: "invalid" },
  { type: "damage", attackerTeamID: "1", victimTeamID: "1" },
  { attackerTeamID: "1", victimTeamID: "1" },
  { type: "death", attackerTeamID: "1", victimTeamID: "1" },
  { isFriendlyFire: true },
  { isTeamKillDown: true },
  { type: "death", isTeamKill: true },
  { attackerSteam64ID: "steam-victim" },
  { attackerTeamID: "" },
  { victimTeamID: "" },
  { type: "death", eventFlags: [{ key: "give_up" }] },
]) {
  harness = await send(record);
  assert.equal(harness.warnings.length, 0, JSON.stringify(record));
}

harness = createHarness();
await harness.plugin.api.handleCombatEvent(event({ type: "death" }));
await harness.plugin.api.handleCombatEvent(event({ type: "death" }));
assert.equal(harness.warnings.length, 0, "death events must never produce real-time warnings");

harness = await send({ type: "death" }, { attacker: { name: "Attacker", steamID: "steam-attacker" } });
assert.equal(harness.warnings.length, 0);

harness = await send({ type: "damage" }, { settings: { "plugins.enemyCombatFeedback": { damageEnabled: true, woundEnabled: true, deathEnabled: true } } });
assert.equal(harness.warnings.length, 0, "configuration must not re-enable damage feedback");
harness = await send({ type: "wound" }, { settings: { "plugins.enemyCombatFeedback": { damageEnabled: true, woundEnabled: true, deathEnabled: true } } });
assert.equal(harness.warnings.length, 0, "configuration must not re-enable wound feedback");
harness = await send({ type: "death" }, { settings: { "plugins.enemyCombatFeedback": { damageEnabled: true, woundEnabled: true, deathEnabled: true } } });
assert.equal(harness.warnings.length, 0, "configuration must not re-enable death feedback");

harness = await send({}, { settings: { "plugins.enemyCombatFeedback": { enabled: false } } });
assert.equal(harness.warnings.length, 0);

harness = await send({ type: "damage", isReplay: true, canTriggerActions: false });
assert.equal(harness.warnings.length, 0);

harness = createHarness();
await harness.plugin.start();
assert.equal(harness.moduleHandlers.has("module.combatState:combatEvent"), true);
await harness.plugin.stop();

console.log("enemy combat feedback tests passed");
