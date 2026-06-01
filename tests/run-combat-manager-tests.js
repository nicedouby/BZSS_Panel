import assert from "node:assert/strict";

import { createCombatManagerService, bindCombatManagerModules } from "../plugins/services/combat_manager_service.js";

function createHarness({ combatStateEvents = [], combatCleanEvents = [], combatStateOverview = {}, combatCleanOverview = {}, combatStateClear = 0, combatCleanClear = 0 } = {}) {
  const moduleEvents = [];
  const moduleListeners = new Map();
  const core = {
    webStatus: { serverId: "BZSS_Main" },
    logger: { info() {}, debug() {}, warn() {}, error() {} },
    eventBus: {
      onModuleEvent(moduleId, eventName, handler) {
        const key = `${moduleId}:${eventName}`;
        if (!moduleListeners.has(key)) moduleListeners.set(key, new Set());
        moduleListeners.get(key).add(handler);
        return () => moduleListeners.get(key)?.delete(handler);
      },
      emitModuleEvent(moduleId, eventName, event) {
        moduleEvents.push({ moduleId, eventName, event });
      },
    },
  };
  const modules = {
    combatState: {
      getState() {
        return {
          events: combatStateEvents,
          count: combatStateEvents.length,
          stats: combatStateOverview.stats ?? {},
          lastUpdatedAt: combatStateOverview.lastUpdatedAt ?? "",
        };
      },
      getEvents() {
        return combatStateEvents;
      },
      clear() {
        return { ok: true, cleared: combatStateClear };
      },
    },
    combatClean: {
      getOverview() {
        return {
          count: combatCleanEvents.length,
          stats: combatCleanOverview.stats ?? {},
          lastUpdatedAt: combatCleanOverview.lastUpdatedAt ?? "",
          rejected: combatCleanOverview.rejected ?? 0,
        };
      },
      getEvents() {
        return combatCleanEvents;
      },
      getEventById(id) {
        return combatCleanEvents.find((event) => String(event.id ?? "") === String(id ?? "")) ?? null;
      },
      clear() {
        return { ok: true, cleared: combatCleanClear };
      },
    },
  };
  const service = createCombatManagerService({ core, modules, config: { get() { return { enabled: true }; } } });
  bindCombatManagerModules(modules);
  return { service, core, modules, moduleEvents, moduleListeners };
}

async function testGetRecentKillsAndOverview() {
  const { service } = createHarness({
    combatStateEvents: [{ id: "raw-1", type: "death", time: "2026-05-09T10:00:00.000Z", serverId: "BZSS_Main", eventName: "BZSS_DIED" }],
    combatCleanEvents: [{ id: "clean-1", type: "kill", time: "2026-05-09T10:00:01.000Z", serverId: "BZSS_Main", eventName: "BZSS_KILL" }],
    combatStateOverview: { stats: { death: 1 } },
    combatCleanOverview: { stats: { kill: 1 } },
  });

  await service.start();

  const kills = service.api.getRecentKills("BZSS_Main", 20);
  assert.equal(kills.length, 1);
  assert.equal(kills[0].id, "clean-1");
  assert.equal(service.api.getEvents({ serverId: "BZSS_Main" }).length, 1);
  assert.equal(service.api.getOverview("BZSS_Main").processedCount, 1);
  assert.equal(service.api.getEventById("clean-1").id, "clean-1");

  await service.stop();
}

async function testUsesCombatCleanAsPrimaryIngress() {
  const { service, moduleListeners, moduleEvents } = createHarness({
    combatCleanEvents: [],
  });

  await service.start();

  for (const handler of moduleListeners.get("module.combatClean:updated") ?? []) {
    handler({
      eventName: "module.combatClean.updated",
      serverId: "BZSS_Main",
      time: "2026-05-09T10:10:00.000Z",
      record: {
        id: "clean-2",
        serverId: "BZSS_Main",
        type: "kill",
        time: "2026-05-09T10:10:00.000Z",
        attackerName: "Attacker",
        victimName: "Victim",
        isFriendlyFire: true,
        isTeamKill: true,
        sourceEventId: "raw-2",
      },
    });
  }

  assert.ok(moduleEvents.some((item) => item.eventName === "COMBAT_MANAGER_UPDATED"));
  assert.ok(moduleEvents.some((item) => item.eventName === "KILL_MANAGER_EVENT"));
  assert.ok(moduleEvents.some((item) => item.eventName === "KILL_MANAGER_UPDATED"));
  assert.ok(moduleEvents.some((item) => item.eventName === "KILL_MANAGER_LOG_UPDATED"));

  const emittedRecord = moduleEvents.find((item) => item.eventName === "KILL_MANAGER_EVENT")?.event?.record;
  assert.equal(emittedRecord?.id, "clean-2");
  assert.equal(emittedRecord?.isTeamKill, true);

  await service.stop();
}

async function testIgnoresCombatStateUpdatedDirectly() {
  const { service, moduleListeners, moduleEvents } = createHarness();
  await service.start();
  moduleEvents.splice(0);

  for (const handler of moduleListeners.get("module.combatState:updated") ?? []) {
    handler({
      eventName: "module.combatState.updated",
      serverId: "BZSS_Main",
      time: "2026-05-09T10:20:00.000Z",
      record: {
        id: "raw-ignored",
        serverId: "BZSS_Main",
        type: "death",
        time: "2026-05-09T10:20:00.000Z",
      },
    });
  }

  assert.equal(moduleEvents.length, 0);

  await service.stop();
}

await testGetRecentKillsAndOverview();
await testUsesCombatCleanAsPrimaryIngress();
await testIgnoresCombatStateUpdatedDirectly();

console.log("combat manager tests passed");
