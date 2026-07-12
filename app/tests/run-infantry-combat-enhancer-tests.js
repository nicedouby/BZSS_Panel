import assert from "node:assert/strict";

import { createInfantryCombatEnhancerModule } from "../modules/infantry-combat-enhancer/index.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createEventBus() {
  const listeners = [];
  return {
    listeners,
    onModuleEvent(moduleId, eventName, handler) {
      const listener = { moduleId, eventName, handler };
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    async emitModuleEvent(moduleId, eventName, event) {
      const matches = listeners.filter((listener) => listener.moduleId === moduleId && listener.eventName === eventName);
      const normalizedEvent = injectSyntheticPlayerIds(event);
      const results = matches.map((listener) => listener.handler(normalizedEvent));
      await Promise.all(results.filter((result) => result && typeof result.then === "function"));
      return results;
    },
  };
}

function injectSyntheticPlayerIds(event) {
  if (!event || typeof event !== "object" || !event.record || typeof event.record !== "object") {
    return event;
  }

  return {
    ...event,
    record: {
      ...event.record,
      attackerPlayerID: event.record.attackerPlayerID
        ?? event.record.attackerPlayerId
        ?? event.record.attacker?.playerID
        ?? event.record.attacker?.playerId
        ?? event.record.attackerSteam64ID
        ?? event.record.attackerSteamId
        ?? "",
      victimPlayerID: event.record.victimPlayerID
        ?? event.record.victimPlayerId
        ?? event.record.victim?.playerID
        ?? event.record.victim?.playerId
        ?? event.record.victimSteam64ID
        ?? event.record.victimSteamId
        ?? "",
    },
  };
}

function createHarness({ moduleConfig = {}, adminWarn, subscriptionMap = {} } = {}) {
  const pages = [];
  const calls = [];
  const eventBus = createEventBus();

  const module = createInfantryCombatEnhancerModule({
    core: {
      logger: { info() {}, warn() {}, error() {} },
      webRegistry: {
        registerPage(page) {
          pages.push(page);
        },
      },
      eventBus,
      webStatus: { serverId: "S1" },
      pluginSubscriptions: {
        isSubscribed(id) {
          if (Object.prototype.hasOwnProperty.call(subscriptionMap, id)) {
            return Boolean(subscriptionMap[id]);
          }
          return true;
        },
      },
    },
    modules: {
      adminWarn: adminWarn ?? {
        async sendAdminWarn(request) {
          calls.push(request);
          const commandText = request.targetPlayerId
            ? `AdminWarnById ${request.targetPlayerId} "${request.message}"`
            : `AdminWarn "${request.targetName}" "${request.message}"`;
          return { success: true, skipped: false, commandText };
        },
      },

    },
    config: {
      get(pathText, defaultValue) {
        if (pathText === "modules.infantryCombatEnhancer") {
          return {
            enabled: true,
            forceAttackerDamageDisplay: false,
            minAttackerDamage: 15,
            damageDebounceMs: 0,
            showVictimDamage: true,
            showVictimWound: true,
            showVictimKill: true,
            showAttackerDamage: true,
            showOnlyLightWeaponDamage: true,
            storeRecentEventLimit: 10,
            ...moduleConfig,
          };
        }
        return defaultValue;
      },
    },
  });

  return { module, eventBus, pages, calls };
}

async function testDamageDebounceConfigAndDelay() {
  const { module, eventBus, calls } = createHarness({
    moduleConfig: {
      damageAggregation: {
        enabled: true,
      },
    },
  });
  await module.start();

  assert.equal(module.api.getConfig().damageDebounceMs, 0);

  const updated = module.api.updateConfig({
    damageAggregation: {
      enabled: true,
    },
    damageDebounceMs: 25,
  });
  assert.equal(updated.damageDebounceMs, 25);
  assert.equal(module.api.getState().config.damageDebounceMs, 25);
  assert.equal(updated.damageAggregation.enabled, true);

  const originalSetTimeout = globalThis.setTimeout;
  const delays = [];

  globalThis.setTimeout = (handler, delayMs) => {
    delays.push(delayMs);
    return originalSetTimeout(handler, 0);
  };

  try {
    await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
      record: {
        id: "combat-delay-check",
        serverId: "S1",
        type: "damage",
        time: "2026-05-30T12:00:00.000Z",
        attackerName: "Alpha",
        attackerSteam64ID: "123",
        victimName: "Bravo",
        victimSteam64ID: "456",
        damage: 42,
        weaponName: "M4A1",
        tags: ["weapon.small_arm", "damage.direct"],
      },
    });

    assert.deepEqual(delays, [25]);
    await new Promise((resolve) => originalSetTimeout(resolve, 50));
    assert.equal(calls.length, 2);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    await module.stop();
  }
}

async function testDamageAggregationDisabledProcessesEachHit() {
  const { module, eventBus, calls } = createHarness({
    moduleConfig: {
      damageAggregation: {
        enabled: false,
        debounceMs: 0,
      },
      showOnlyLightWeaponDamage: false,
    },
  });

  await module.start();

  const recordBase = {
    serverId: "S1",
    type: "damage",
    attackerName: "Alpha",
    attackerSteam64ID: "123",
    victimName: "Bravo",
    victimSteam64ID: "456",
    weaponName: "M4A1",
    tags: ["weapon.small_arm", "damage.direct"],
  };

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      ...recordBase,
      id: "damage-no-agg-1",
      time: "2026-05-30T13:30:00.000Z",
      damage: 30,
    },
  });

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      ...recordBase,
      id: "damage-no-agg-2",
      time: "2026-05-30T13:30:00.200Z",
      damage: 40,
    },
  });

  assert.equal(calls.length, 4);

  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events.length, 2);
  assert.equal(events[0].damage, 40);
  assert.equal(events[1].damage, 30);

  await module.stop();
}

async function testProcessingAndWarnings() {
  const { module, eventBus, pages, calls } = createHarness();
  await module.start();

  assert.equal(pages.length, 1);
  assert.equal(pages[0].route, "/plugins/infantry-combat-enhancer");

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      id: "combat-1",
      serverId: "S1",
      type: "damage",
      time: "2026-05-30T12:00:00.000Z",
      attackerName: "Alpha",
      attackerSteam64ID: "123",
      victimName: "Bravo",
      victimSteam64ID: "456",
      damage: 42,
      weaponName: "M4A1",
      eventFlags: [{ key: "self_damage", label: "鑷激" }],
      eventFlagLabels: ["鑷激"],
      tags: ["weapon.small_arm", "damage.direct"],
    },
  });

  await sleep(500);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].sourceModule, "module.infantryCombatEnhancer");
  assert.equal(calls[0].targetName, "Bravo");
  assert.equal(calls[0].targetPlayerId, "456");
  assert.equal(calls[0].requireTargetPlayerId, true);
  assert.equal(calls[1].targetName, "Alpha");
  assert.equal(calls[1].targetPlayerId, "123");
  assert.equal(calls[1].requireTargetPlayerId, true);

  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].victimWarning.success, true);
  assert.equal(events[0].attackerWarning.success, true);
  assert.equal(events[0].victim.playerId, "456");
  assert.equal(events[0].attacker.playerId, "123");
  assert.equal(events[0].eventFlags[0].key, "self_damage");
  assert.equal(events[0].eventFlagLabels[0], "鑷激");
  assert.ok(events[0].tags.includes("weapon.small_arm"));
  assert.equal(module.api.getOverview().stats.victimWarned, 1);
  assert.equal(module.api.getOverview().stats.attackerWarned, 1);

  await module.stop();
}

async function testReviveResolvedWarnings() {
  const { module, eventBus, calls } = createHarness();
  await module.start();

  await eventBus.emitModuleEvent("module.combatClean", "reviveResolved", {
    eventId: "module.combatClean:revive-1",
    serverId: "S1",
    time: "2026-05-30T12:01:00.000Z",
    record: {
      id: "revive-1",
      serverId: "S1",
      type: "revive",
      time: "2026-05-30T12:01:00.000Z",
      attackerName: "Medic",
      attackerSteam64ID: "111",
      victimName: "Downed",
      victimSteam64ID: "222",
      tags: ["combat.revive"],
    },
  });

  assert.equal(calls.length, 4);
  assert.equal(calls[0].targetName, "Downed");
  assert.ok(String(calls[0].message).includes("Medic") || String(calls[0].message).includes("Killer") || String(calls[0].message).includes("Attacker"));
  assert.equal(calls[0].reason, "infantry_revive_victim");
  assert.equal(calls[1].targetName, "Medic");
  assert.ok(String(calls[1].message).includes("Downed") || String(calls[1].message).includes("Victim"));
  assert.equal(calls[1].reason, "infantry_revive_attacker");

  const events = module.api.getEvents({ type: "revive", limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "revive");
  assert.equal(events[0].victimWarning.success, true);
  assert.equal(events[0].attackerWarning.success, true);
  assert.equal(module.api.getOverview().stats.revive, 1);
  assert.equal(module.api.getOverview().stats.victimWarned, 1);
  assert.equal(module.api.getOverview().stats.attackerWarned, 1);

  await module.stop();
}

async function testTagDrivenMessages() {
  const { module, eventBus, calls } = createHarness({
    moduleConfig: {
      showKillDisplay: true,
    },
  });
  await module.start();

  const emit = async (record) => {
    await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", { record });
  };

  await emit({
    id: "combat-damage-enemy",
    serverId: "S1",
    type: "damage",
    time: "2026-05-30T12:10:00.000Z",
    attackerName: "Attacker",
    attackerSteam64ID: "111",
    victimName: "Victim",
    victimSteam64ID: "222",
    damage: 60,
    weaponName: "XX",
    tags: ["combat.damage", "weapon.small_arm", "damage.direct"],
  });

  await sleep(500);
  assert.ok(String(calls.at(-2).message).includes("Attacker"));
  assert.ok(String(calls.at(-1).message).includes("Victim"));

  await emit({
    id: "combat-damage-friendly",
    serverId: "S1",
    type: "damage",
    time: "2026-05-30T12:10:01.000Z",
    attackerName: "Attacker",
    attackerSteam64ID: "111",
    victimName: "Victim",
    victimSteam64ID: "222",
    damage: 60,
    weaponName: "XX",
    tags: ["combat.team_damage", "friendly_fire", "combat.damage", "weapon.small_arm", "damage.direct"],
  });

  await sleep(500);
  assert.ok(String(calls.at(-2).message).includes("Attacker"));
  assert.ok(String(calls.at(-1).message).includes("Victim"));

  await emit({
    id: "combat-wound-friendly",
    serverId: "S1",
    type: "wound",
    time: "2026-05-30T12:10:02.000Z",
    attackerName: "Attacker",
    attackerSteam64ID: "111",
    victimName: "Victim",
    victimSteam64ID: "222",
    damage: 60,
    weaponName: "XX",
    tags: ["combat.team_wound", "friendly_fire", "combat.wound", "weapon.small_arm"],
  });
  assert.ok(String(calls.at(-2).message).includes("Attacker"));
  assert.ok(String(calls.at(-1).message).includes("Victim"));

  await emit({
    id: "combat-kill-enemy",
    serverId: "S1",
    type: "kill",
    time: "2026-05-30T12:10:03.000Z",
    attackerName: "Attacker",
    attackerSteam64ID: "111",
    victimName: "Victim",
    victimSteam64ID: "222",
    damage: 300,
    weaponName: "XX",
    tags: ["combat.kill", "weapon.small_arm"],
  });
  assert.ok(String(calls.at(-2).message).includes("Attacker"));
  assert.ok(String(calls.at(-1).message).includes("Victim"));

  await emit({
    id: "combat-kill-friendly",
    serverId: "S1",
    type: "kill",
    time: "2026-05-30T12:10:04.000Z",
    attackerName: "Attacker",
    attackerSteam64ID: "111",
    victimName: "Victim",
    victimSteam64ID: "222",
    damage: 300,
    weaponName: "XX",
    tags: ["combat.team_kill", "friendly_fire", "combat.kill", "weapon.small_arm"],
  });
  assert.ok(String(calls.at(-2).message).includes("Attacker"));
  assert.ok(String(calls.at(-1).message).includes("Victim"));

  await module.stop();
}

async function testOnlyLightWeaponDamageSkipsNonLightWeapons() {
  const { module, eventBus, calls } = createHarness();
  await module.start();

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      id: "combat-heavy-damage",
      serverId: "S1",
      type: "damage",
      time: "2026-05-30T12:11:00.000Z",
      attackerName: "Attacker",
      attackerSteam64ID: "111",
      victimName: "Victim",
      victimSteam64ID: "222",
      damage: 60,
      weaponName: "Grenade",
      tags: ["combat.damage", "weapon.explosive", "damage.splash"],
    },
  });

  await sleep(500);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].targetName, "Victim");
  assert.ok(String(calls[0].message).includes("Attacker"));

  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].victimWarning.success, true);
  assert.equal(events[0].attackerWarning.skipped, true);
  assert.equal(events[0].attackerWarning.skipReason, "non_light_weapon_hidden");

  await module.stop();
}

async function testForceAttackerDamageDisplayOverridesLightWeaponFilter() {
  const { module, eventBus, calls } = createHarness({
    moduleConfig: {
      forceAttackerDamageDisplay: true,
      showOnlyLightWeaponDamage: true,
    },
  });
  await module.start();

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      id: "combat-force-attacker-damage",
      serverId: "S1",
      type: "damage",
      time: "2026-05-30T12:11:30.000Z",
      attackerName: "Attacker",
      attackerSteam64ID: "111",
      victimName: "Victim",
      victimSteam64ID: "222",
      damage: 60,
      weaponName: "Grenade",
      tags: ["combat.damage", "weapon.explosive", "damage.splash"],
    },
  });

  await sleep(500);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].targetName, "Victim");
  assert.equal(calls[1].targetName, "Attacker");

  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].victimWarning.success, true);
  assert.equal(events[0].attackerWarning.success, true);

  await module.stop();
}

async function testOnlyLightWeaponDamageSkipsHeavyKillAttacker() {
  const { module, eventBus, calls } = createHarness({
    moduleConfig: {
      showKillDisplay: true,
      showOnlyLightWeaponDamage: true,
    },
  });
  await module.start();

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      id: "combat-heavy-kill",
      serverId: "S1",
      type: "kill",
      time: "2026-05-30T12:12:00.000Z",
      attackerName: "Attacker",
      attackerSteam64ID: "111",
      victimName: "Victim",
      victimSteam64ID: "222",
      damage: 300,
      weaponName: "ZBD04A AP",
      tags: ["combat.kill", "weapon.vehicle", "damage.direct"],
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].targetName, "Victim");

  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].victimWarning.success, true);
  assert.equal(events[0].attackerWarning.skipped, true);
  assert.equal(events[0].attackerWarning.skipReason, "non_light_weapon_hidden");

  await module.stop();
}

async function testSamePlayerStillDisplays() {
  const { module, eventBus, calls } = createHarness({
    moduleConfig: {
      showOnlyLightWeaponDamage: false,
    },
  });
  await module.start();

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      id: "combat-2",
      serverId: "S1",
      type: "wound",
      time: "2026-05-30T12:05:00.000Z",
      attackerName: "Echo",
      attackerSteam64ID: "999",
      victimName: "Echo",
      victimSteam64ID: "999",
      damage: 5,
      weaponName: "Grenade",
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].targetName, "Echo");

  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].victimWarning.success, true);
  assert.equal(events[0].attackerWarning.skipped, true);
  assert.equal(events[0].attackerWarning.skipReason, "same_player");

  const cleared = module.api.clear();
  assert.equal(cleared.ok, true);
  assert.equal(cleared.cleared, 1);
  assert.equal(module.api.getEvents({ limit: 10 }).length, 0);

  await module.stop();
}

async function testKillDisplayIsDisabledByDefault() {
  const { module, eventBus, calls } = createHarness();
  await module.start();

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      id: "combat-kill",
      serverId: "S1",
      type: "kill",
      time: "2026-05-30T12:06:00.000Z",
      attackerName: "Killer",
      attackerSteam64ID: "111",
      victimName: "Target",
      victimSteam64ID: "222",
      damage: 300,
      weaponName: "M4A1",
      tags: ["combat.kill", "weapon.small_arm"],
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].targetName, "Target");
  assert.ok(String(calls[0].message).includes("Killer"));
  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].victimWarning.success, true);
  assert.equal(events[0].attackerWarning.skipped, true);
  assert.equal(events[0].attackerWarning.skipReason, "kill_display_disabled");

  await module.stop();
}

async function testFractionalDamageRoundsToInteger() {
  const { module, eventBus, calls } = createHarness({
    moduleConfig: {
      showOnlyLightWeaponDamage: false,
    },
  });
  await module.start();

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      id: "combat-fractional-damage",
      serverId: "S1",
      type: "damage",
      time: "2026-05-30T12:13:00.000Z",
      attackerName: "Attacker",
      attackerSteam64ID: "111",
      victimName: "Victim",
      victimSteam64ID: "222",
      damage: 42.6,
      weaponName: "M4A1",
      tags: ["combat.damage", "weapon.small_arm", "damage.direct"],
    },
  });

  await sleep(500);

  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].damage, 43);
  assert.equal(calls.length, 2);
  assert.ok(String(calls[0].message).includes("43"));
  assert.ok(String(calls[1].message).includes("43"));

  await module.stop();
}

async function testCombatCleanDependencyGate() {
  const { module, eventBus, pages } = createHarness({
    subscriptionMap: {
      "module.combatClean": false,
    },
  });

  await module.start();

  assert.equal(pages.length, 1);
  assert.equal(eventBus.listeners.length, 0);

  await module.stop();
}

async function testDamageDebounceDisabledProcessesImmediately() {
  const { module, eventBus, calls } = createHarness({
    moduleConfig: {
      damageAggregation: {
        enabled: true,
      },
      showOnlyLightWeaponDamage: false,
    },
  });
  await module.start();

  const recordBase = {
    serverId: "S1",
    type: "damage",
    attackerName: "Alpha",
    attackerSteam64ID: "123",
    victimName: "Bravo",
    victimSteam64ID: "456",
    weaponName: "M4A1",
    tags: ["weapon.small_arm", "damage.direct"],
  };

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      ...recordBase,
      id: "agg-dmg-1",
      time: "2026-05-30T13:00:00.000Z",
      damage: 30,
    },
  });

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      ...recordBase,
      id: "agg-dmg-2",
      time: "2026-05-30T13:00:00.200Z",
      damage: 40,
    },
  });

  assert.equal(calls.length, 2);
  assert.ok(String(calls[0].message).includes("30伤害"));
  assert.ok(String(calls[1].message).includes("30伤害"));

  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events.length, 2);
  assert.equal(events[0].type, "damage");
  assert.equal(events[0].damage, 30);

  await module.stop();
}

async function testWoundMergesPendingDamageExcludingLastHit() {
  const { module, eventBus, calls } = createHarness({
    moduleConfig: {
      damageAggregation: {
        enabled: true,
      },
      showOnlyLightWeaponDamage: false,
    },
  });
  await module.start();

  const recordBase = {
    serverId: "S1",
    attackerName: "Alpha",
    attackerSteam64ID: "123",
    victimName: "Bravo",
    victimSteam64ID: "456",
    weaponName: "M4A1",
    tags: ["weapon.small_arm"],
  };

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      ...recordBase,
      id: "wound-merge-dmg-1",
      type: "damage",
      time: "2026-05-30T13:10:00.000Z",
      damage: 30,
    },
  });

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      ...recordBase,
      id: "wound-merge-dmg-2",
      type: "damage",
      time: "2026-05-30T13:10:00.200Z",
      damage: 40,
    },
  });

  await eventBus.emitModuleEvent("module.combatClean", "combat.record.processed", {
    record: {
      ...recordBase,
      id: "wound-merge-wound",
      type: "wound",
      time: "2026-05-30T13:10:00.400Z",
      damage: 20,
    },
  });

  assert.equal(calls.length, 2);
  assert.ok(String(calls[0].message).includes("閫犳垚50浼ゅ"));
  assert.ok(String(calls[1].message).includes("閫犳垚50浼ゅ"));

  await sleep(500);
  assert.equal(calls.length, 2);

  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "wound");
  assert.equal(events[0].damage, 50);

  await module.stop();
}

await testProcessingAndWarnings();
await testDamageDebounceConfigAndDelay();
await testDamageAggregationDisabledProcessesEachHit();
await testReviveResolvedWarnings();
await testTagDrivenMessages();
await testOnlyLightWeaponDamageSkipsNonLightWeapons();
await testForceAttackerDamageDisplayOverridesLightWeaponFilter();
await testOnlyLightWeaponDamageSkipsHeavyKillAttacker();
await testSamePlayerStillDisplays();
await testKillDisplayIsDisabledByDefault();
await testFractionalDamageRoundsToInteger();
await testCombatCleanDependencyGate();
await testDamageDebounceDisabledProcessesImmediately();
await testWoundMergesPendingDamageExcludingLastHit();

console.log("infantry combat enhancer tests passed");


