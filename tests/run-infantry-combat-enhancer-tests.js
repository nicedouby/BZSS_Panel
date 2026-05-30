import assert from "node:assert/strict";

import { createInfantryCombatEnhancerModule } from "../modules/infantry-combat-enhancer/index.js";

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
      const results = matches.map((listener) => listener.handler(event));
      await Promise.all(results.filter((result) => result && typeof result.then === "function"));
      return results;
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
          return { success: true, skipped: false, commandText: `AdminWarn "${request.targetName}"` };
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
            showVictimDamage: true,
            showVictimWound: true,
            showVictimKill: true,
            showAttackerDamage: true,
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
      eventFlags: [{ key: "self_damage", label: "自伤" }],
      eventFlagLabels: ["自伤"],
      tags: ["weapon.small_arm", "damage.direct"],
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].sourceModule, "module.infantryCombatEnhancer");
  assert.equal(calls[0].targetName, "Bravo");
  assert.equal(calls[1].targetName, "Alpha");

  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].victimWarning.success, true);
  assert.equal(events[0].attackerWarning.success, true);
  assert.equal(events[0].eventFlags[0].key, "self_damage");
  assert.equal(events[0].eventFlagLabels[0], "自伤");
  assert.ok(events[0].tags.includes("weapon.small_arm"));
  assert.equal(module.api.getOverview().stats.victimWarned, 1);
  assert.equal(module.api.getOverview().stats.attackerWarned, 1);

  await module.stop();
}

async function testSamePlayerStillDisplays() {
  const { module, eventBus, calls } = createHarness();
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

  assert.equal(calls.length, 2);
  assert.equal(calls[0].targetName, "Echo");
  assert.equal(calls[1].targetName, "Echo");

  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].victimWarning.success, true);
  assert.equal(events[0].attackerWarning.success, true);

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
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].targetName, "Target");
  const events = module.api.getEvents({ limit: 10 });
  assert.equal(events.length, 1);
  assert.equal(events[0].victimWarning.success, true);
  assert.equal(events[0].attackerWarning.skipped, true);
  assert.equal(events[0].attackerWarning.skipReason, "kill_display_disabled");

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

await testProcessingAndWarnings();
await testSamePlayerStillDisplays();
await testKillDisplayIsDisabledByDefault();
await testCombatCleanDependencyGate();

console.log("infantry combat enhancer tests passed");
