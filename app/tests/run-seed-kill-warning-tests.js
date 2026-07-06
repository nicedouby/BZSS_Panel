import assert from "node:assert/strict";

import { createPlugin } from "../plugins/seed-kill-warning.js";

function noopLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
}

async function createHarness({ mode = "seed", tacticalPlayers = [], playerStatePlayers = [] } = {}) {
  const warnings = [];
  const delays = [];

  const core = {
    logger: noopLogger(),
    createLogger() {
      return noopLogger();
    },
    webStatus: {
      serverId: "BZSS_Main",
      getSnapshot() {
        return {
          serverId: "BZSS_Main",
          gameMode: mode,
          layer: mode === "seed" ? "AlBasrah_RAAS_v1_seed" : "AlBasrah_RAAS_v1",
          currentLayer: mode === "seed" ? "AlBasrah_RAAS_v1_seed" : "AlBasrah_RAAS_v1",
        };
      },
    },
    pluginSubscriptions: {
      isSubscribed() {
        return true;
      },
    },
  };

  const modules = {
    playerState: {
      getPlayerList() {
        return playerStatePlayers;
      },
    },
    tacticalState: {
      async getPlayers() {
        return tacticalPlayers;
      },
    },
    adminWarn: {
      async sendAdminWarn(payload) {
        warnings.push(payload);
        return { success: true, commandText: `AdminWarn ${payload.targetName}` };
      },
    },
  };

  const config = {
    get(pathText, fallback) {
      if (pathText === "plugins.seed-kill-warning") {
        return {
          enabled: true,
          title: "火力侦察自动战绩查询",
          intervalMinutes: 3,
          messageTemplate: "【${title}】你的击杀数为 ${kills}，感激参与暖服",
        };
      }
      return fallback;
    },
  };

  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  globalThis.setTimeout = (handler, delayMs) => {
    delays.push(delayMs);
    return { handler, delayMs };
  };
  globalThis.clearTimeout = () => {};

  const plugin = createPlugin({ core, modules, config, logger: core.logger });

  return {
    plugin,
    warnings,
    delays,
    restoreTimers() {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    },
  };
}

async function testStartsWithThreeMinuteSchedule() {
  const harness = await createHarness();
  try {
    await harness.plugin.start();
    assert.equal(harness.delays[0], 180000);
    const state = harness.plugin.api.getState();
    assert.equal(state.timerActive, true);
    assert.equal(state.nextDelayMs, 180000);
  } finally {
    await harness.plugin.stop();
    harness.restoreTimers();
  }
}

async function testSeedModeWarningsUseKillsAndTitle() {
  const harness = await createHarness({
    mode: "seed",
    tacticalPlayers: [
      {
        name: "Alpha",
        steamID: "76561198000000001",
        combat: { kills: 7 },
      },
      {
        name: "Alpha Duplicate",
        steamID: "76561198000000001",
        combat: { kills: 99 },
      },
      {
        name: "Bravo",
        steamID: "76561198000000002",
        kills: 3,
      },
    ],
    playerStatePlayers: [
      {
        name: "Alpha",
        steamID: "76561198000000001",
        kills: 15,
      },
    ],
  });

  try {
    await harness.plugin.start();
    const result = await harness.plugin.api.runNow();

    assert.equal(result.successCount, 2);
    assert.equal(harness.warnings.length, 2);
    assert.equal(harness.warnings[0].title, "火力侦察自动战绩查询");
    assert.equal(harness.warnings[0].message, "【火力侦察自动战绩查询】你的击杀数为 7，感激参与暖服");
    assert.equal(harness.warnings[1].message, "【火力侦察自动战绩查询】你的击杀数为 3，感激参与暖服");
    assert.equal(harness.warnings[0].reason, "seed_kill_warning");
  } finally {
    await harness.plugin.stop();
    harness.restoreTimers();
  }
}

async function testNonSeedSkipsWarnings() {
  const harness = await createHarness({
    mode: "pvp",
    tacticalPlayers: [
      {
        name: "Alpha",
        steamID: "76561198000000001",
        combat: { kills: 7 },
      },
    ],
  });

  try {
    await harness.plugin.start();
    const result = await harness.plugin.api.runNow();

    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, "not_seed_mode");
    assert.equal(harness.warnings.length, 0);
  } finally {
    await harness.plugin.stop();
    harness.restoreTimers();
  }
}

await testStartsWithThreeMinuteSchedule();
await testSeedModeWarningsUseKillsAndTitle();
await testNonSeedSkipsWarnings();

console.log("seed kill warning tests passed");
