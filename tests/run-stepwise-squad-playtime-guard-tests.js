import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPlugin } from "../plugins/stepwise-squad-playtime-guard.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function createHarness(options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-stepwise-playtime-guard-"));
  const moduleHandlers = new Map();
  const disbands = [];
  const kicks = [];
  const warnings = [];
  const broadcasts = [];
  const lookups = [];
  const deferredLookup = deferred();

  const webStatus = {
    serverId: "test-server",
    isWarmup: false,
    logClockSeconds: 10,
    ...(options.webStatus ?? {}),
  };

  const playtimeCache = new Map(options.playtimeRows ?? []);
  const playerCache = options.playerCache ?? null;

  const plugin = createPlugin({
    core: {
      webStatus: {
        serverId: "test-server",
        getSnapshot() {
          return { ...webStatus };
        },
      },
      eventBus: {
        onModuleEvent(moduleId, eventName, handler) {
          moduleHandlers.set(`${moduleId}:${eventName}`, handler);
          return () => moduleHandlers.delete(`${moduleId}:${eventName}`);
        },
      },
      logger: noopLogger(),
    },
    modules: {
      squadManagement: {
        async requestDisband(request) {
          disbands.push(request);
          if (typeof options.requestDisband === "function") return await options.requestDisband(request);
          return { ok: true, command: `AdminDisbandSquad ${request.teamId} ${request.squadId}` };
        },
        async requestKick(request) {
          kicks.push(request);
          return { ok: true, command: `AdminKick ${request.name || request.steamId || request.eosId || ""}` };
        },
      },
      adminWarn: {
        async sendAdminWarn(request) {
          warnings.push(request);
          return { success: true, commandText: `AdminWarn ${request.targetName}` };
        },
        async broadcastMessage(request) {
          broadcasts.push(request);
          return { success: true, commandText: `AdminBroadcast ${request.message}` };
        },
      },
      playtime: {
        async getBySteamID(steamID) {
          return playtimeCache.get(steamID) ?? null;
        },
        async lookupSteamID(steamID) {
          lookups.push(steamID);
          if (options.lookupPromise) return await options.lookupPromise.promise;
          return await deferredLookup.promise;
        },
      },
      playerDatabase: {
        async getCachedPlayer(identity) {
          if (typeof playerCache === "function") return await playerCache(identity);
          return playerCache;
        },
      },
    },
    config: {
      get(pathText, fallback) {
        if (pathText === "plugins.stepwiseSquadPlaytimeGuard") {
          return {
            enabled: true,
            directory: tempDir,
            broadcastOnApproved: true,
            warnOnMissingPlaytime: true,
            liveLookupWhenMissing: options.liveLookupWhenMissing ?? true,
            maxRecentRecords: 50,
            rules: options.rules,
          };
        }
        return fallback;
      },
    },
    logger: noopLogger(),
  });

  await plugin.init();
  await plugin.start();

  return {
    plugin,
    webStatus,
    disbands,
    kicks,
    warnings,
    broadcasts,
    lookups,
    deferredLookup,
    async stop() {
      await plugin.stop();
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}

function noopLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
}

function creation(overrides = {}) {
  return {
    serverId: "test-server",
    matchId: "match-1",
    teamId: 1,
    squadId: 1,
    squadName: "INF 1",
    creatorName: "Leader",
    creatorSteamId: "steam-1",
    creatorEosId: "eos-1",
    creationSource: "LOG",
    creationConfidence: "HIGH",
    ...overrides,
  };
}

async function testInfantryLowHoursDisbands() {
  const harness = await createHarness({
    playtimeRows: [["steam-1", { game_seconds: 350 * 3600 }]],
  });
  try {
    const result = await harness.plugin.api.simulateCreation(creation());
    assert.equal(result.violation, true);
    assert.equal(harness.disbands.length, 1);
    assert.equal(harness.kicks.length, 0);
    assert.equal(harness.warnings.length, 1);
    assert.equal(harness.broadcasts.length, 1);
    assert.equal(harness.broadcasts[0].message.includes("违规建队已拦截"), true);
  } finally {
    await harness.stop();
  }
}

async function testInfantryPassBroadcasts() {
  const harness = await createHarness({
    playtimeRows: [["steam-1", { game_seconds: 401 * 3600 }]],
  });
  try {
    const result = await harness.plugin.api.simulateCreation(creation());
    assert.equal(result.approved, true);
    assert.equal(harness.disbands.length, 0);
    assert.equal(harness.broadcasts.length, 1);
    assert.equal(harness.broadcasts[0].message.length > 0, true);
  } finally {
    await harness.stop();
  }
}

async function testLogTime10BroadcastsRuleReminder() {
  const harness = await createHarness({
    webStatus: {
      logClockSeconds: 10,
      logClockHasAnchor: true,
      logClockAnchorLogTime: "2026-06-05T12:00:00.000Z",
    },
  });
  try {
    await waitFor(() => harness.broadcasts.length >= 1, 2000);
    assert.equal(harness.broadcasts.length, 1);
    assert.equal(harness.broadcasts[0].message.includes("阶梯式建队时长检测"), true);
    assert.equal(harness.broadcasts[0].message.includes("0-25"), true);
  } finally {
    await harness.stop();
  }
}

async function testVehicleWindowUsesConfiguredThreshold() {
  const harness = await createHarness({
    webStatus: { logClockSeconds: 55 },
    playtimeRows: [["steam-1", { game_seconds: 700 * 3600 }]],
  });
  try {
    const result = await harness.plugin.api.simulateCreation(creation({
      squadId: 2,
      squadName: "Armor",
    }));
    assert.equal(result.violation, true);
    assert.equal(harness.disbands.length, 1);
    assert.equal(harness.kicks.length, 0);
  } finally {
    await harness.stop();
  }
}

async function testInfantrySecondWindowAndOpenWindow() {
  const harness = await createHarness({
    webStatus: { logClockSeconds: 30 },
    playtimeRows: [
      ["steam-1", { game_seconds: 250 * 3600 }],
      ["steam-2", { game_seconds: 150 * 3600 }],
    ],
  });
  try {
    const passed = await harness.plugin.api.simulateCreation(creation({
      squadId: 21,
      squadName: "INF 21",
    }));
    assert.equal(passed.approved, true);
    assert.equal(harness.broadcasts.length, 1);

    harness.webStatus.logClockSeconds = 30;
    const failed = await harness.plugin.api.simulateCreation(creation({
      squadId: 22,
      squadName: "INF 22",
      creatorSteamId: "steam-2",
    }));
    assert.equal(failed.violation, true);
    assert.equal(harness.disbands.length, 1);

    harness.webStatus.logClockSeconds = 45;
    const open = await harness.plugin.api.simulateCreation(creation({
      squadId: 23,
      squadName: "INF 23",
      creatorSteamId: "steam-open",
    }));
    assert.equal(open.approved, true);
    assert.equal(harness.broadcasts.length, 3);
  } finally {
    await harness.stop();
  }
}

async function testVehicleSecondThirdAndOpenWindows() {
  const harness = await createHarness({
    webStatus: { logClockSeconds: 65 },
    playtimeRows: [
      ["steam-1", { game_seconds: 650 * 3600 }],
      ["steam-2", { game_seconds: 450 * 3600 }],
      ["steam-3", { game_seconds: 500 * 3600 }],
    ],
  });
  try {
    const secondWindow = await harness.plugin.api.simulateCreation(creation({
      squadId: 31,
      squadName: "Armor 31",
    }));
    assert.equal(secondWindow.approved, true);

    const secondWindowFail = await harness.plugin.api.simulateCreation(creation({
      squadId: 32,
      squadName: "Armor 32",
      creatorSteamId: "steam-3",
    }));
    assert.equal(secondWindowFail.violation, true);

    harness.webStatus.logClockSeconds = 80;
    const thirdWindow = await harness.plugin.api.simulateCreation(creation({
      squadId: 33,
      squadName: "Armor 33",
      creatorSteamId: "steam-2",
    }));
    assert.equal(thirdWindow.approved, true);

    harness.webStatus.logClockSeconds = 95;
    const open = await harness.plugin.api.simulateCreation(creation({
      squadId: 34,
      squadName: "Armor 34",
      creatorSteamId: "steam-open-vehicle",
    }));
    assert.equal(open.approved, true);
    assert.equal(harness.broadcasts.length, 4);
    assert.equal(harness.disbands.length, 1);
  } finally {
    await harness.stop();
  }
}

async function testPlayerDatabaseFallbackProvidesPlaytime() {
  const harness = await createHarness({
    playerCache: {
      current_name: "Leader",
      steam_id: "steam-db",
      eos_id: "eos-db",
      game_seconds: 401 * 3600,
    },
  });
  try {
    const result = await harness.plugin.api.simulateCreation(creation({
      squadId: 41,
      creatorSteamId: "steam-db",
      creatorEosId: "eos-db",
    }));
    assert.equal(result.approved, true);
    assert.equal(result.playtime.source, "module.playerDatabase");
    assert.equal(harness.broadcasts.length, 1);
  } finally {
    await harness.stop();
  }
}

async function testWarmupSkipsRuleAndBroadcastsUnknownHours() {
  const harness = await createHarness({
    webStatus: { isWarmup: true, logClockSeconds: 5 },
  });
  try {
    const result = await harness.plugin.api.simulateCreation(creation({
      squadId: 3,
      creatorSteamId: "steam-missing",
    }));
    assert.equal(result.approved, true);
    assert.equal(harness.disbands.length, 0);
    assert.equal(harness.broadcasts.length, 1);
    assert.equal(typeof harness.broadcasts[0].message, "string");
    assert.deepEqual(harness.lookups, ["steam-missing"]);
  } finally {
    await harness.stop();
  }
}

async function testMissingPlaytimeDisbandsWarnsAndStartsLookup() {
  const harness = await createHarness({
    lookupPromise: deferred(),
  });
  try {
    const result = await harness.plugin.api.simulateCreation(creation({
      squadId: 4,
      creatorSteamId: "steam-missing",
    }));
    assert.equal(result.violation, true);
    assert.equal(harness.disbands.length, 1);
    assert.equal(harness.kicks.length, 0);
    assert.equal(harness.warnings.length, 1);
    assert.equal(harness.broadcasts.length, 1);
    assert.equal(typeof harness.warnings[0].message, "string");
    assert.deepEqual(harness.lookups, ["steam-missing"]);
  } finally {
    await harness.stop();
  }
}

async function testLogThenRconOnlyProcessesOnce() {
  const harness = await createHarness({
    playtimeRows: [["steam-1", { game_seconds: 401 * 3600 }]],
  });
  try {
    const first = await harness.plugin.api.simulateCreation(creation({
      squadId: 5,
      teamId: null,
    }));
    assert.equal(first, null);

    const status = await harness.plugin.api.simulateSquadsUpdated({
      serverId: "test-server",
      matchId: "match-1",
      time: new Date().toISOString(),
      squads: [{
        teamId: 1,
        squadId: 5,
        squadName: "INF 1",
        leaderName: "Leader",
        leaderSteamId: "steam-1",
      }],
    });
    assert.equal(status.summary.total, 1);
    assert.equal(harness.broadcasts.length, 1);
    assert.equal(harness.disbands.length, 0);
  } finally {
    await harness.stop();
  }
}

async function testRconThenLogPromotionDoesNotRepeatDisband() {
  const harness = await createHarness({
    webStatus: { logClockSeconds: 55 },
    playtimeRows: [["steam-1", { game_seconds: 700 * 3600 }]],
  });
  try {
    await harness.plugin.api.simulateSquadsUpdated({
      serverId: "test-server",
      matchId: "match-1",
      time: new Date().toISOString(),
      squads: [{
        teamId: 1,
        squadId: 6,
        squadName: "Armor",
        leaderName: "Leader",
        leaderSteamId: "steam-1",
      }],
    });
    assert.equal(harness.disbands.length, 1);

    await harness.plugin.api.simulateCreation(creation({
      squadId: 6,
      squadName: "Armor",
    }));
    assert.equal(harness.disbands.length, 1);
    assert.equal(harness.warnings.length, 1);
  } finally {
    await harness.stop();
  }
}

async function testLookupCompletionUpdatesRecordWithoutRollback() {
  const lookupPromise = deferred();
  const harness = await createHarness({
    lookupPromise,
  });
  try {
    await harness.plugin.api.simulateCreation(creation({
      squadId: 7,
      creatorSteamId: "steam-lookup",
    }));
    lookupPromise.resolve({ found: true, gameSeconds: 900 * 3600 });
    await waitFor(() => harness.plugin.api.getStatus().recentRecords[0]?.actions?.some((action) => action.type === "lookup_finished"));
    const record = harness.plugin.api.getStatus().recentRecords[0];
    assert.equal(record.lookupResult.gameSeconds, 900 * 3600);
    assert.equal(harness.disbands.length, 1);
    assert.equal(harness.broadcasts.length, 1);
  } finally {
    await harness.stop();
  }
}

await testInfantryLowHoursDisbands();
await testInfantryPassBroadcasts();
await testLogTime10BroadcastsRuleReminder();
await testVehicleWindowUsesConfiguredThreshold();
await testInfantrySecondWindowAndOpenWindow();
await testVehicleSecondThirdAndOpenWindows();
await testPlayerDatabaseFallbackProvidesPlaytime();
await testWarmupSkipsRuleAndBroadcastsUnknownHours();
await testMissingPlaytimeDisbandsWarnsAndStartsLookup();
await testLogThenRconOnlyProcessesOnce();
await testRconThenLogPromotionDoesNotRepeatDisband();
await testLookupCompletionUpdatesRecordWithoutRollback();
await testTransientDisbandFailureStopsAfterOpenWindow();

async function testTransientDisbandFailureStopsAfterOpenWindow() {
  let callCount = 0;
  const harness = await createHarness({
    playtimeRows: [["steam-1", { game_seconds: 350 * 3600 }]],
    requestDisband: async (request) => {
      callCount += 1;
      if (callCount === 1) {
        return { ok: false, error: "TargetNotFound" };
      }
      return { ok: true, command: "AdminDisbandSquad" };
    },
  });
  try {
    harness.webStatus.logClockSeconds = 10;
    const result = await harness.plugin.api.simulateCreation(creation({
      teamId: 1,
      squadId: 40,
      squadName: "INF 40",
      creatorSteamId: "steam-1",
    }));
    assert.equal(result.violation, true);
    assert.equal(harness.disbands.length, 1);

    const statusBefore = harness.plugin.api.getStatus();
    const recordBefore = statusBefore.recentRecords.find((r) => r.squadId === 40);
    assert.equal(recordBefore.active, true);
    assert.equal(recordBefore.actions.some((a) => a.type === "disband_failed"), true);
    assert.equal(recordBefore.actions.some((a) => a.type === "disbanded"), false);

    harness.webStatus.logClockSeconds = 95; // Progress clock to open phase

    await harness.plugin.api.simulateSquadsUpdated({
      serverId: "test-server",
      matchId: "match-1",
      time: new Date().toISOString(),
      squads: [{
        teamId: 1,
        squadId: 40,
        squadName: "INF 40",
        leaderName: "Leader",
        leaderSteamId: "steam-1",
      }],
    });

    assert.equal(harness.disbands.length, 1);
    const statusAfter = harness.plugin.api.getStatus();
    const recordAfter = statusAfter.recentRecords.find((r) => r.squadId === 40);
    assert.equal(recordAfter.decision, "open");
    assert.equal(recordAfter.actions.some((a) => a.type === "disbanded"), false);

    await harness.plugin.api.simulateSquadsUpdated({
      serverId: "test-server",
      matchId: "match-1",
      time: new Date().toISOString(),
      squads: [{
        teamId: 1,
        squadId: 40,
        squadName: "INF 40",
        leaderName: "Leader",
        leaderSteamId: "steam-1",
      }],
    });
    assert.equal(harness.disbands.length, 1);
  } finally {
    await harness.stop();
  }
}

async function testVehicleStartingFromZero() {
  const harness = await createHarness({
    rules: {
      infantry: [
        { startSeconds: 0, endSeconds: 25, minHoursExclusive: 400 }
      ],
      vehicle: [
        { startSeconds: 0, endSeconds: 60, minHoursExclusive: 800 }
      ]
    },
    webStatus: { logClockSeconds: 10 },
    playtimeRows: [["steam-1", { game_seconds: 700 * 3600 }]],
  });
  try {
    const result = await harness.plugin.api.simulateCreation(creation({
      squadId: 2,
      squadName: "Armor",
      creatorSteamId: "steam-1",
    }));
    assert.equal(result.violation, true);
    assert.equal(harness.disbands.length, 1);
  } finally {
    await harness.stop();
  }
}

await testVehicleStartingFromZero();

console.log("run-stepwise-squad-playtime-guard-tests.js passed");

