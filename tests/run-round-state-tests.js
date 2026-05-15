import assert from "node:assert/strict";

import { createRoundStateModule } from "../modules/round-state/index.js";

function createHarness() {
  const coreEvents = [];
  const moduleEvents = [];
  const webStatusState = {
    serverId: "BZSS_Main",
    serverName: "BZSS Main Server",
    pythonLogParser: "running",
    udpReceiver: "listening",
  };

  const core = {
    logger: {
      info() {},
      warn() {},
      debug() {},
      error() {},
      module() {},
    },
    createLogger() {
      return this.logger;
    },
    webStatus: {
      serverId: "BZSS_Main",
      patch(patch) {
        Object.assign(webStatusState, patch);
      },
      getSnapshot() {
        return { ...webStatusState };
      },
    },
    eventBus: {
      onCoreEvent(eventName, handler) {
        coreListeners.set(eventName, handler);
        return () => coreListeners.delete(eventName);
      },
      onModuleEvent(moduleId, eventName, handler) {
        moduleListeners.set(`${moduleId}:${eventName}`, handler);
        return () => moduleListeners.delete(`${moduleId}:${eventName}`);
      },
      emitCoreEvent(eventName, event) {
        coreEvents.push({ eventName, event });
        const handler = coreListeners.get(eventName);
        if (handler) handler({ ...event, eventName });
      },
      emitModuleEvent(moduleId, eventName, event) {
        moduleEvents.push({ moduleId, eventName, event });
        const handler = moduleListeners.get(`${moduleId}:${eventName}`);
        if (handler) handler({ ...event, eventName, source: moduleId });
      },
    },
  };

  const coreListeners = new Map();
  const moduleListeners = new Map();

  const config = {
    get(path, defaultValue) {
      if (path === "modules.roundState") {
        return {
          enabled: true,
          dedupeTtlMs: 60_000,
          maxHistory: 10,
        };
      }
      return defaultValue;
    },
  };

  return {
    core,
    module: createRoundStateModule({ core, modules: {}, config }),
    coreEvents,
    moduleEvents,
    webStatusState,
  };
}

function roundEventBase(overrides = {}) {
  return {
    eventName: "round.world_bring_up",
    serverId: "BZSS_Main",
    eventId: "event-1",
    time: "2026-05-12 18:46:27.432",
    logTime: "2026.05.12-10.46.27:432",
    rawLog: "[2026.05.12-10.46.27:432][ 11]LogWorld: Bringing World /Game/Maps/Mutaha/Gameplay_Layers/Mutaha_RAAS_v1.Mutaha_RAAS_v1 up for play (max tick rate 50) at 2026.05.12-18.46.27",
    paramMap: {
      logLineTime: "2026.05.12-10.46.27:432",
      frame: "11",
      worldPath: "/Game/Maps/Mutaha/Gameplay_Layers/Mutaha_RAAS_v1.Mutaha_RAAS_v1",
      layerName: "Mutaha_RAAS_v1",
      mapName: "Mutaha",
      gameMode: "RAAS",
      maxTickRate: "50",
      serverPlayAt: "2026.05.12-18.46.27",
    },
    ...overrides,
  };
}

async function testRoundWorldBringUpUpdatesStateAndWebStatus() {
  const harness = createHarness();
  await harness.module.start();

  harness.core.eventBus.emitCoreEvent("round.world_bring_up", roundEventBase());

  const state = harness.module.api.getState();
  assert.equal(state.current.layerName, "Mutaha_RAAS_v1");
  assert.equal(state.current.mapName, "Mutaha");
  assert.equal(state.current.gameMode, "RAAS");
  assert.equal(state.current.maxTickRate, 50);
  assert.equal(state.history.length, 1);
  assert.equal(harness.webStatusState.map, "Mutaha");
  assert.equal(harness.webStatusState.layer, "Mutaha_RAAS_v1");
  assert.equal(harness.webStatusState.mode, "RAAS");
  assert.equal(harness.webStatusState.logTime.mapName, "Mutaha");
  assert.equal(harness.webStatusState.logTime.gameMode, "RAAS");
}

async function testRoundWorldBringUpDedupesRepeatedLogLine() {
  const harness = createHarness();
  await harness.module.start();

  const event = roundEventBase();
  harness.core.eventBus.emitCoreEvent("round.world_bring_up", event);
  harness.core.eventBus.emitCoreEvent("round.world_bring_up", event);

  const state = harness.module.api.getState();
  assert.equal(state.history.length, 1);
  assert.equal(state.current.serverId, "BZSS_Main");
  assert.equal(harness.moduleEvents.filter((item) => item.eventName === "updated").length, 1);
}

await testRoundWorldBringUpUpdatesStateAndWebStatus();
await testRoundWorldBringUpDedupesRepeatedLogLine();

console.log("round state tests passed");
