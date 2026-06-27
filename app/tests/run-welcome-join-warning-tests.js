import assert from "node:assert/strict";
import { createPlugin } from "../plugins/welcome-join-warning.js";

function createHarness(options = {}) {
  const warnings = [];
  const lookups = [];
  const savedConfigs = [];
  const playtimeCache = new Map(options.playtimeRows ?? []);
  let configValue = options.config ?? {
    enabled: true,
    delayMs: options.delayMs ?? 1,
    message: "Welcome to our server!",
    historyLimit: 100,
  };

  const configMock = {
    get(pathText, fallback) {
      if (pathText === "plugins.welcome-join-warning" || pathText === "plugins.welcomeJoinWarning") {
        return configValue;
      }
      return fallback;
    },
    set(pathText, value) {
      if (pathText === "plugins.welcome-join-warning") {
        configValue = value;
      }
    },
    async save() {
      savedConfigs.push(JSON.parse(JSON.stringify(configValue)));
    },
  };

  const coreMock = {
    webStatus: { serverId: "test-server" },
    webRegistry: { registerPage() {} },
    pluginSubscriptions: {
      isSubscribed() { return true; },
    },
    eventBus: {
      onCoreEvent() {
        return () => {};
      },
    },
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
  };

  const modulesMock = {
    adminWarn: {
      async warnPlayer(request) {
        warnings.push(request);
        return { success: true };
      },
    },
    playtime: {
      async getBySteamID(steamID) {
        return playtimeCache.get(steamID) ?? null;
      },
      async lookupSteamID(steamID) {
        lookups.push(steamID);
        const row = options.lookupRows?.get?.(steamID);
        if (row) return row;
        return null;
      },
    },
    playerState: {
      getPlayerByName(serverId, name) {
        return options.playersByName?.get?.(`${serverId}:${name}`) ?? options.playersByName?.get?.(name) ?? null;
      },
    },
  };

  const plugin = createPlugin({
    core: coreMock,
    modules: modulesMock,
    config: configMock,
  });

  return {
    plugin,
    warnings,
    lookups,
    savedConfigs,
    get configValue() {
      return configValue;
    },
  };
}

async function wait(ms = 30) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

function rulesConfig(overrides = {}) {
  return {
    enabled: true,
    historyLimit: 100,
    maxWarningsPerJoin: 5,
    defaultIntervalMs: 1,
    rules: [],
    ...overrides,
  };
}

async function testLegacyConfigMigratesToDefaultRules() {
  const harness = createHarness({
    delayMs: 1,
    playtimeRows: [["steam-newbie", { game_seconds: 50 * 3600 }]],
  });

  await harness.plugin.start();
  const state = harness.plugin.api.getState();

  assert.equal(state.rules.length, 2);
  assert.equal(state.rules[0].id, "default-welcome");
  assert.equal(state.rules[1].id, "newbie-playtime");

  await harness.plugin.api.simulateJoin({
    playerName: "NewbiePlayer",
    steamID: "steam-newbie",
  });
  await wait();

  assert.equal(harness.warnings.length, 2);
  assert.equal(harness.warnings[0].targetName, "NewbiePlayer");
  assert.equal(harness.warnings[0].message, "Welcome to our server!");
  assert.equal(harness.warnings[1].targetName, "NewbiePlayer");
  assert.match(harness.warnings[1].message, /BZSS 是一个注重萌新体验/);

  await harness.plugin.stop();
}

async function testMultiRulePriorityAndInterval() {
  const harness = createHarness({
    config: rulesConfig({
      maxWarningsPerJoin: 5,
      defaultIntervalMs: 1,
      rules: [
        {
          id: "second",
          name: "Second",
          priority: 20,
          initialDelayMs: 1,
          conditions: [{ type: "always" }],
          steps: [{ message: "B" }],
        },
        {
          id: "first",
          name: "First",
          priority: 10,
          initialDelayMs: 1,
          conditions: [{ type: "always" }],
          steps: [{ message: "A1" }, { message: "A2" }],
        },
      ],
    }),
  });

  await harness.plugin.start();
  const result = await harness.plugin.api.simulateJoin({ playerName: "PriorityPlayer" });
  await wait();

  assert.deepEqual(result.scheduled.map(item => item.message), ["A1", "A2", "B"]);
  assert.deepEqual(harness.warnings.map(item => item.message), ["A1", "A2", "B"]);

  await harness.plugin.stop();
}

async function testMaxWarningsPerJoinSuppressesExtraSteps() {
  const harness = createHarness({
    config: rulesConfig({
      maxWarningsPerJoin: 2,
      defaultIntervalMs: 1,
      rules: [
        {
          id: "many",
          name: "Many",
          priority: 10,
          initialDelayMs: 1,
          conditions: [{ type: "always" }],
          steps: [{ message: "one" }, { message: "two" }, { message: "three" }],
        },
      ],
    }),
  });

  await harness.plugin.start();
  const result = await harness.plugin.api.simulateJoin({ playerName: "LimitedPlayer" });
  await wait();

  assert.deepEqual(harness.warnings.map(item => item.message), ["one", "two"]);
  assert.equal(result.suppressed.some(item => item.reason === "max_warnings_per_join"), true);
  assert.equal(harness.plugin.api.getState().suppressedCount, 1);

  await harness.plugin.stop();
}

async function testCooldownSkipsRepeatedPlayer() {
  const harness = createHarness({
    config: rulesConfig({
      defaultIntervalMs: 1,
      rules: [
        {
          id: "cool",
          name: "Cooldown",
          priority: 10,
          cooldownMs: 60_000,
          initialDelayMs: 1,
          conditions: [{ type: "always" }],
          steps: [{ message: "cooldown warning" }],
        },
      ],
    }),
  });

  await harness.plugin.start();
  await harness.plugin.api.simulateJoin({ playerName: "RepeatPlayer", eventId: "event-1" });
  await wait();
  const second = await harness.plugin.api.simulateJoin({ playerName: "RepeatPlayer", eventId: "event-2" });
  await wait();

  assert.equal(harness.warnings.length, 1);
  assert.equal(second.suppressed.some(item => item.reason === "cooldown"), true);

  await harness.plugin.stop();
}

async function testSteamIdTriggersPlaytimeRule() {
  const harness = createHarness({
    config: rulesConfig({
      defaultIntervalMs: 1,
      rules: [
        {
          id: "newbie",
          name: "Newbie",
          priority: 10,
          initialDelayMs: 1,
          conditions: [{ type: "playtimeHours", minHours: 0, maxHours: 200 }],
          steps: [{ message: "newbie message" }],
        },
      ],
    }),
    playtimeRows: [["steam-newbie", { game_seconds: 100 * 3600 }]],
  });

  await harness.plugin.start();
  const result = await harness.plugin.api.simulateJoin({
    playerName: "SteamPlayer",
    steamID: "steam-newbie",
  });
  await wait();

  assert.equal(result.matchedRules[0].id, "newbie");
  assert.deepEqual(harness.warnings.map(item => item.message), ["newbie message"]);

  await harness.plugin.stop();
}

async function testUnknownPlaytimeRule() {
  const harness = createHarness({
    config: rulesConfig({
      defaultIntervalMs: 1,
      rules: [
        {
          id: "unknown",
          name: "Unknown",
          priority: 10,
          initialDelayMs: 1,
          conditions: [{ type: "playtimeUnknown" }],
          steps: [{ message: "unknown playtime" }],
        },
      ],
    }),
  });

  await harness.plugin.start();
  const result = await harness.plugin.api.simulateJoin({
    playerName: "UnknownPlayer",
    steamID: "steam-unknown",
  });
  await wait();

  assert.equal(result.matchedRules[0].id, "unknown");
  assert.deepEqual(harness.lookups, ["steam-unknown"]);
  assert.deepEqual(harness.warnings.map(item => item.message), ["unknown playtime"]);

  await harness.plugin.stop();
}

(async () => {
  try {
    await testLegacyConfigMigratesToDefaultRules();
    await testMultiRulePriorityAndInterval();
    await testMaxWarningsPerJoinSuppressesExtraSteps();
    await testCooldownSkipsRepeatedPlayer();
    await testSteamIdTriggersPlaytimeRule();
    await testUnknownPlaytimeRule();
    console.log("Welcome Join Warning rule tests passed successfully!");
  } catch (error) {
    console.error("Test execution failed:", error);
    process.exit(1);
  }
})();
