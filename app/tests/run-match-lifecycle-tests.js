import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createMatchLifecycleModule,
  MATCH_LIFECYCLE_STATE,
} from "../modules/match-lifecycle/index.js";

function createEventBus() {
  const coreListeners = new Map();
  const moduleListeners = new Map();

  function add(map, key, handler) {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(handler);
    return () => {
      const list = map.get(key) ?? [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    };
  }

  return {
    onCoreEvent(name, handler) {
      return add(coreListeners, name, handler);
    },
    onModuleEvent(moduleId, name, handler) {
      return add(moduleListeners, `${moduleId}:${name}`, handler);
    },
    emitCoreEvent(name, event = {}) {
      for (const handler of [...(coreListeners.get(name) ?? [])]) handler({ eventName: name, ...event });
    },
    emitModuleEvent(moduleId, name, event = {}) {
      for (const handler of [...(moduleListeners.get(`${moduleId}:${name}`) ?? [])]) handler(event);
    },
  };
}

async function createHarness(options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-match-lifecycle-"));
  const eventBus = createEventBus();
  const webStatusState = {
    serverId: "BZSS_Main",
    serverName: "BZSS Main",
  };
  const matchStateSnapshot = {
    serverId: "BZSS_Main",
    serverStatus: {
      map: options.map ?? "AlBasrah",
      layer: options.layer ?? "AlBasrah_RAAS_v1",
      mode: options.mode ?? "RAAS",
      nextLayer: options.nextLayer ?? "Fallujah_RAAS_v2",
      playtime: options.playtime ?? 120,
    },
    match: {},
    rconStatus: {
      connected: options.connected ?? true,
    },
  };

  const core = {
    eventBus,
    webStatus: {
      serverId: "BZSS_Main",
      state: webStatusState,
      patch(patch) {
        Object.assign(webStatusState, patch, { updatedAt: new Date().toISOString() });
      },
    },
    rconManager: {
      getStatus() {
        return { connected: Boolean(matchStateSnapshot.rconStatus.connected) };
      },
    },
    logger: makeLogger(),
  };

  const modules = {
    matchState: {
      getState() {
        return matchStateSnapshot;
      },
    },
  };

  const config = {
    get(key, fallback) {
      if (key !== "modules.matchLifecycle") return fallback;
      return {
        enabled: true,
        stateFile: path.join(directory, "lifecycle.json"),
        finishSettleMs: options.finishSettleMs ?? 0,
        nextMatchDelayMs: options.nextMatchDelayMs ?? 60_000,
      };
    },
  };

  const instance = createMatchLifecycleModule({ core, modules, config, logger: core.logger });
  await instance.start();

  return {
    directory,
    eventBus,
    webStatusState,
    matchStateSnapshot,
    instance,
    api: instance.api,
    async cleanup() {
      await instance.stop();
      await fs.rm(directory, { recursive: true, force: true });
    },
  };
}

function makeLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

function winnerEvent(overrides = {}) {
  return {
    eventId: overrides.eventId ?? "winner-1",
    sourceMode: overrides.sourceMode ?? "live",
    isReplay: overrides.isReplay ?? false,
    canTriggerActions: overrides.canTriggerActions ?? true,
    normalized: {
      roundMatchWinner: {
        winner: overrides.winner ?? "USA",
        mapName: overrides.mapName ?? "AlBasrah",
        logLineTime: overrides.logLineTime ?? "2026.08.16-01.10.00:000",
      },
    },
  };
}

function worldEvent(overrides = {}) {
  return {
    eventId: overrides.eventId ?? "world-1",
    sourceMode: overrides.sourceMode ?? "live",
    isReplay: overrides.isReplay ?? false,
    canTriggerActions: overrides.canTriggerActions ?? true,
    normalized: {
      roundWorldBringUp: {
        serverId: "BZSS_Main",
        mapName: overrides.mapName ?? "Fallujah",
        layerName: overrides.layerName ?? "Fallujah_RAAS_v2",
        gameMode: overrides.gameMode ?? "RAAS",
        worldPath: overrides.worldPath ?? "/Game/Maps/Fallujah/Fallujah_RAAS_v2",
        logLineTime: overrides.logLineTime ?? "2026.08.16-01.11.00:000",
        serverPlayAt: overrides.serverPlayAt ?? "2026.08.16-01.11.00:000",
      },
    },
  };
}

async function testStartupRconReconcilesToLive() {
  const harness = await createHarness({ playtime: 123 });
  try {
    const lifecycle = harness.api.getState();
    assert.equal(lifecycle.state, MATCH_LIFECYCLE_STATE.LIVE);
    assert.equal(lifecycle.layer, "AlBasrah_RAAS_v1");
    assert.equal(lifecycle.connected, true);
    assert.equal(harness.webStatusState.matchLifecycle.state, MATCH_LIFECYCLE_STATE.LIVE);
  } finally {
    await harness.cleanup();
  }
}

async function testRealRoundWinnerEndsMatch() {
  const harness = await createHarness({ playtime: 123 });
  try {
    harness.eventBus.emitCoreEvent("round.match_winner", winnerEvent());
    const lifecycle = harness.api.getState();
    assert.equal(lifecycle.state, MATCH_LIFECYCLE_STATE.FINISHED);
    assert.equal(lifecycle.winner, "USA");
    assert.ok(lifecycle.endedAt);
    assert.ok(lifecycle.history.some((item) => item.to === MATCH_LIFECYCLE_STATE.ENDING));
    assert.ok(lifecycle.history.some((item) => item.to === MATCH_LIFECYCLE_STATE.FINISHED));
  } finally {
    await harness.cleanup();
  }
}

async function testPositiveOldPlaytimeCannotResurrectFinishedMatch() {
  const harness = await createHarness({ playtime: 123 });
  try {
    harness.eventBus.emitCoreEvent("round.match_winner", winnerEvent());
    harness.matchStateSnapshot.serverStatus.playtime = 130;
    harness.eventBus.emitModuleEvent("module.matchState", "updated", {});
    assert.equal(harness.api.getState().state, MATCH_LIFECYCLE_STATE.FINISHED);
  } finally {
    await harness.cleanup();
  }
}

async function testWorldBringUpMovesEndedMatchToMapReady() {
  const harness = await createHarness({ playtime: 123 });
  try {
    harness.eventBus.emitCoreEvent("round.match_winner", winnerEvent());
    harness.matchStateSnapshot.serverStatus.map = "Fallujah";
    harness.matchStateSnapshot.serverStatus.layer = "Fallujah_RAAS_v2";
    harness.matchStateSnapshot.serverStatus.playtime = 0;
    harness.eventBus.emitCoreEvent("round.world_bring_up", worldEvent());

    const lifecycle = harness.api.getState();
    assert.equal(lifecycle.state, MATCH_LIFECYCLE_STATE.MAP_READY);
    assert.equal(lifecycle.layer, "Fallujah_RAAS_v2");
    assert.equal(lifecycle.winner, "");
    assert.equal(lifecycle.endedAt, "");
  } finally {
    await harness.cleanup();
  }
}

async function testRconMapChangeCreatesLoadingTransition() {
  const harness = await createHarness({ playtime: 123 });
  try {
    harness.matchStateSnapshot.serverStatus.map = "Fallujah";
    harness.matchStateSnapshot.serverStatus.layer = "Fallujah_RAAS_v2";
    harness.matchStateSnapshot.serverStatus.playtime = 0;
    harness.eventBus.emitModuleEvent("module.matchState", "serverStatusUpdated", {});

    const lifecycle = harness.api.getState();
    assert.equal(lifecycle.state, MATCH_LIFECYCLE_STATE.MAP_READY);
    assert.ok(lifecycle.history.some((item) => item.to === MATCH_LIFECYCLE_STATE.LOADING_MAP));
    assert.ok(lifecycle.history.some((item) => item.to === MATCH_LIFECYCLE_STATE.MAP_READY));
  } finally {
    await harness.cleanup();
  }
}

async function testStaleReplayWinnerCannotOverrideNewerWorldEvent() {
  const harness = await createHarness({ playtime: 0 });
  try {
    harness.matchStateSnapshot.serverStatus.map = "Fallujah";
    harness.matchStateSnapshot.serverStatus.layer = "Fallujah_RAAS_v2";
    harness.eventBus.emitCoreEvent("round.world_bring_up", worldEvent({
      eventId: "world-new",
      logLineTime: "2026.08.16-01.20.00:000",
      serverPlayAt: "2026.08.16-01.20.00:000",
    }));
    assert.equal(harness.api.getState().state, MATCH_LIFECYCLE_STATE.MAP_READY);

    harness.eventBus.emitCoreEvent("round.match_winner", winnerEvent({
      eventId: "winner-old",
      isReplay: true,
      canTriggerActions: false,
      logLineTime: "2026.08.16-01.10.00:000",
    }));

    const lifecycle = harness.api.getState();
    assert.equal(lifecycle.state, MATCH_LIFECYCLE_STATE.MAP_READY);
    assert.equal(lifecycle.layer, "Fallujah_RAAS_v2");
  } finally {
    await harness.cleanup();
  }
}

async function testReplayAndNonActionableWinnerAreIgnored() {
  const harness = await createHarness({ playtime: 123 });
  try {
    harness.eventBus.emitCoreEvent("round.match_winner", winnerEvent({
      eventId: "winner-replay",
      isReplay: true,
      canTriggerActions: true,
      logLineTime: "2026.08.16-01.30.00:000",
    }));
    assert.equal(harness.api.getState().state, MATCH_LIFECYCLE_STATE.LIVE);

    harness.eventBus.emitCoreEvent("round.match_winner", winnerEvent({
      eventId: "winner-non-actionable",
      isReplay: false,
      canTriggerActions: false,
      logLineTime: "2026.08.16-01.31.00:000",
    }));
    assert.equal(harness.api.getState().state, MATCH_LIFECYCLE_STATE.LIVE);
    assert.equal(harness.api.getState().endedAt, "");
  } finally {
    await harness.cleanup();
  }
}

async function testFinishedTransitionsToWaitingForNextMatch() {
  const harness = await createHarness({ playtime: 123, nextMatchDelayMs: 0 });
  try {
    harness.eventBus.emitCoreEvent("round.match_winner", winnerEvent({ eventId: "winner-next" }));
    const lifecycle = harness.api.getState();
    assert.equal(lifecycle.state, MATCH_LIFECYCLE_STATE.NEXT_MATCH);
    assert.ok(lifecycle.history.some((item) => item.to === MATCH_LIFECYCLE_STATE.FINISHED));
    assert.ok(lifecycle.history.some((item) => item.to === MATCH_LIFECYCLE_STATE.NEXT_MATCH));
  } finally {
    await harness.cleanup();
  }
}

await testStartupRconReconcilesToLive();
await testRealRoundWinnerEndsMatch();
await testPositiveOldPlaytimeCannotResurrectFinishedMatch();
await testWorldBringUpMovesEndedMatchToMapReady();
await testRconMapChangeCreatesLoadingTransition();
await testStaleReplayWinnerCannotOverrideNewerWorldEvent();
await testReplayAndNonActionableWinnerAreIgnored();
await testFinishedTransitionsToWaitingForNextMatch();

console.log("Match lifecycle tests passed.");
