import assert from "node:assert/strict";
import { createPlugin } from "../plugins/welcome-join-warning.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createHarness(options = {}) {
  const warnings = [];
  const lookups = [];
  const playtimeCache = new Map(options.playtimeRows ?? []);
  let lookupPromise = options.lookupPromise ?? null;

  const configMock = {
    get(pathText, fallback) {
      if (pathText === "plugins.welcome-join-warning" || pathText === "plugins.welcomeJoinWarning") {
        return {
          enabled: true,
          delayMs: options.delayMs ?? 10,
          message: "Welcome to our server!",
          historyLimit: 100,
        };
      }
      return fallback;
    },
    set() {},
    async save() {},
  };

  const coreMock = {
    webStatus: { serverId: "test-server" },
    webRegistry: { registerPage() {} },
    pluginSubscriptions: {
      isSubscribed() { return true; }
    },
    eventBus: {
      onCoreEvent() {
        return () => {};
      }
    },
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    }
  };

  const modulesMock = {
    adminWarn: {
      async warnPlayer(request) {
        warnings.push(request);
        return { success: true };
      }
    },
    playtime: {
      async getBySteamID(steamID) {
        return playtimeCache.get(steamID) ?? null;
      },
      async lookupSteamID(steamID) {
        lookups.push(steamID);
        if (lookupPromise) return await lookupPromise.promise;
        const def = deferred();
        def.resolve({ found: true, gameSeconds: 150 * 3600 });
        return await def.promise;
      },
      getStatus() {
        return { configured: true };
      }
    }
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
    lookupPromise,
  };
}

async function testWelcomeAndNewbieWarn() {
  const harness = createHarness({
    playtimeRows: [["steam-newbie", { game_seconds: 50 * 3600 }]],
  });

  await harness.plugin.start();
  await harness.plugin.api.simulateJoin({
    playerName: "NewbiePlayer",
    steamID: "steam-newbie",
  });

  await new Promise(resolve => setTimeout(resolve, 50));

  assert.equal(harness.warnings.length, 2);
  assert.equal(harness.warnings[0].targetName, "NewbiePlayer");
  assert.equal(harness.warnings[0].message, "Welcome to our server!");
  assert.equal(harness.warnings[1].targetName, "NewbiePlayer");
  assert.match(harness.warnings[1].message, /BZSS是一个注重萌新体验的游戏社区/);

  await harness.plugin.stop();
}

async function testWelcomeNoNewbieWarn() {
  const harness = createHarness({
    playtimeRows: [["steam-pro", { game_seconds: 300 * 3600 }]],
  });

  await harness.plugin.start();
  await harness.plugin.api.simulateJoin({
    playerName: "ProPlayer",
    steamID: "steam-pro",
  });

  await new Promise(resolve => setTimeout(resolve, 50));

  assert.equal(harness.warnings.length, 1);
  assert.equal(harness.warnings[0].targetName, "ProPlayer");
  assert.equal(harness.warnings[0].message, "Welcome to our server!");

  await harness.plugin.stop();
}

async function testWelcomeWithLookup() {
  const lookupPromise = deferred();
  const harness = createHarness({
    lookupPromise,
  });

  await harness.plugin.start();
  await harness.plugin.api.simulateJoin({
    playerName: "UnknownPlayer",
    steamID: "steam-unknown",
  });

  await new Promise(resolve => setTimeout(resolve, 20));
  
  // Resolve lookup as newbie
  lookupPromise.resolve({ found: true, gameSeconds: 100 * 3600 });

  await new Promise(resolve => setTimeout(resolve, 50));

  assert.deepEqual(harness.lookups, ["steam-unknown"]);
  assert.equal(harness.warnings.length, 2);
  assert.equal(harness.warnings[0].targetName, "UnknownPlayer");
  assert.equal(harness.warnings[1].targetName, "UnknownPlayer");
  assert.match(harness.warnings[1].message, /BZSS是一个注重萌新体验的游戏社区/);

  await harness.plugin.stop();
}

(async () => {
  try {
    await testWelcomeAndNewbieWarn();
    await testWelcomeNoNewbieWarn();
    await testWelcomeWithLookup();
    console.log("Welcome Join Warning playtime unit tests passed successfully!");
  } catch (error) {
    console.error("Test execution failed:", error);
    process.exit(1);
  }
})();
