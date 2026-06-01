import assert from "node:assert/strict";

import { createKillManageModule } from "../modules/kill-manage/index.js";

async function testProxiesRecentKillsToCombatManager() {
  const coreListeners = new Map();
  const moduleEvents = [];
  const module = createKillManageModule({
    core: {
      logger: { info() {}, debug() {}, warn() {}, error() {} },
      eventBus: {
        onModuleEvent(moduleId, eventName, handler) {
          const key = `${moduleId}:${eventName}`;
          if (!coreListeners.has(key)) coreListeners.set(key, new Set());
          coreListeners.get(key).add(handler);
          return () => coreListeners.get(key)?.delete(handler);
        },
        emitModuleEvent(moduleId, eventName, event) {
          moduleEvents.push({ moduleId, eventName, event });
        },
      },
    },
    modules: {
      combatManager: {
        getRecentKills(serverId, limit) {
          return [{ serverId, limit, id: "recent-1" }];
        },
      },
    },
    config: { get() { return {}; } },
  });

  assert.deepEqual(module.api.getRecentKills("BZSS_Main", 12), [{ serverId: "BZSS_Main", limit: 12, id: "recent-1" }]);
  await module.start();
  await module.stop();
  assert.equal(coreListeners.size, 1);
  assert.equal(moduleEvents.length, 0);
}

async function testForwardsLegacyEventsFromCombatManager() {
  const coreListeners = new Map();
  const moduleEvents = [];
  const module = createKillManageModule({
    core: {
      logger: { info() {}, debug() {}, warn() {}, error() {} },
      eventBus: {
        onModuleEvent(moduleId, eventName, handler) {
          const key = `${moduleId}:${eventName}`;
          if (!coreListeners.has(key)) coreListeners.set(key, new Set());
          coreListeners.get(key).add(handler);
          return () => coreListeners.get(key)?.delete(handler);
        },
        emitModuleEvent(moduleId, eventName, event) {
          moduleEvents.push({ moduleId, eventName, event });
        },
      },
    },
    modules: {},
    config: { get() { return {}; } },
  });

  await module.start();

  for (const handler of coreListeners.get("module.combatManager:KILL_MANAGER_EVENT") ?? []) {
    handler({
      eventId: "combat-manager:1",
      eventName: "KILL_MANAGER_EVENT",
      serverId: "BZSS_Main",
      time: "2026-05-09T10:01:00.000Z",
      record: {
        id: "combatClean:kill:1",
        serverId: "BZSS_Main",
        type: "kill",
        attackerName: "Attacker",
        victimName: "Victim",
        isFriendlyFire: true,
        isTeamKill: true,
        friendlyFireLabel: "友伤",
      },
    });
  }

  await module.stop();

  assert.equal(moduleEvents.filter((item) => item.eventName === "combatResolved").length, 1);
  assert.equal(moduleEvents.filter((item) => item.eventName === "friendlyFireResolved").length, 1);
  assert.equal(moduleEvents.filter((item) => item.eventName === "teamKillResolved").length, 1);
}

async function testDoesNotSubscribeToCoreEventsOrWriteLogs() {
  const coreListeners = new Map();
  const moduleEvents = [];
  const module = createKillManageModule({
    core: {
      logger: { info() {}, debug() {}, warn() {}, error() {} },
      eventBus: {
        onCoreEvent(eventName, handler) {
          if (!coreListeners.has(eventName)) coreListeners.set(eventName, new Set());
          coreListeners.get(eventName).add(handler);
          return () => coreListeners.get(eventName)?.delete(handler);
        },
        onModuleEvent(moduleId, eventName, handler) {
          const key = `${moduleId}:${eventName}`;
          if (!coreListeners.has(key)) coreListeners.set(key, new Set());
          coreListeners.get(key).add(handler);
          return () => coreListeners.get(key)?.delete(handler);
        },
        emitModuleEvent(moduleId, eventName, event) {
          moduleEvents.push({ moduleId, eventName, event });
        },
      },
    },
    modules: {},
    config: { get() { return {}; } },
  });

  await module.start();
  await module.stop();

  assert.equal(coreListeners.has("On_PlayerDamaged"), false);
  assert.equal(coreListeners.has("On_PlayerWounded"), false);
  assert.equal(coreListeners.has("On_PlayerDied"), false);
  assert.equal(coreListeners.has("On_PlayerRevived"), false);
  assert.equal(coreListeners.has("TEAM_KILL"), false);
  assert.equal(moduleEvents.length, 0);
}

await testProxiesRecentKillsToCombatManager();
await testForwardsLegacyEventsFromCombatManager();
await testDoesNotSubscribeToCoreEventsOrWriteLogs();

console.log("kill manage compatibility tests passed");
