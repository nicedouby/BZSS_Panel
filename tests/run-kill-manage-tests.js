import assert from "node:assert/strict";

import { createKillManageModule } from "../modules/kill-manage/index.js";

async function testKillsOnlyThroughRcon() {
  const calls = [];
  const module = createKillManageModule({
    core: {
      logger: { info() {}, debug() {}, warn() {}, error() {} },
      rconManager: {
        async dispatchCommand(payload) {
          calls.push(payload);
          return { success: true, response: "ok" };
        },
      },
    },
    modules: {},
    config: { get() { return {}; } },
  });

  const result = await module.api.killPlayer({
    targetName: "PlayerA",
    reason: "manual test",
    operatorId: "admin-1",
    operatorName: "Admin",
    source: "web.killManage",
  });

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'AdminKill "PlayerA"');
  assert.equal(calls[0].requestedBy, "module.killManage");
  assert.equal(calls[0].reason, "manual test");
}

async function testStoresExecutionRecords() {
  const module = createKillManageModule({
    core: {
      logger: { info() {}, debug() {}, warn() {}, error() {} },
      rconManager: {
        async dispatchCommand() {
          return { success: false, message: "Denied" };
        },
      },
    },
    modules: {},
    config: { get() { return {}; } },
  });

  await module.api.killPlayer({ targetSteamId: "76561198000000000", operatorName: "Admin" });
  const recent = module.api.getRecentKills("", 10);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].command, 'AdminKill "76561198000000000"');
  assert.equal(recent[0].success, false);
}

async function testDoesNotSubscribeToCombatEvents() {
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
      rconManager: {
        async dispatchCommand() {
          return { success: true };
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
  assert.equal(coreListeners.has("module.combatManager:KILL_MANAGER_EVENT"), false);
  assert.equal(moduleEvents.length, 0);
}

await testKillsOnlyThroughRcon();
await testStoresExecutionRecords();
await testDoesNotSubscribeToCombatEvents();

console.log("kill manage admin-kill tests passed");
