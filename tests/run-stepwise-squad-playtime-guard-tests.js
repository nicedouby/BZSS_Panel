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
  const lastDisbandByKey = new Map();
  const deferredLookup = deferred();
  const webStatus = {
    serverId: "test-server",
    isWarmup: false,
    logClockSeconds: 10,
    ...(options.webStatus ?? {}),
  };

  const playtimeCache = new Map(options.playtimeRows ?? []);
  const playerCache = options.playerCache ?? null;

  let plugin = null;
  const pendingDisbandActions = [];

  const updateDisbandAction = (request, result) => {
    if (plugin && plugin.api && plugin.api._state) {
      const record = plugin.api._state.records.find(
        (r) => r.teamId === request.teamId && r.squadId === request.squadId
      );
      if (record) {
        const ok = result?.ok !== false;
        const type = ok ? "disbanded" : "disband_failed";
        if (!ok) {
          record.active = true;
          record.resolvedAt = "";
        }
        if (!record.actions.some((a) => a.type === type)) {
          record.actions.push({
            type,
            result,
          });
          const slotKey = [
            String(record.serverId ?? "").trim(),
            String(record.matchId ?? "").trim(),
            record.teamId == null ? "" : String(record.teamId),
            record.squadId == null ? "" : String(record.squadId),
            String(record.squadName ?? "").trim().replace(/\s+/g, " ").toLowerCase(),
          ].join("|");
          plugin.api._state.recordsBySlot.set(slotKey, { ...record });
        }
      }
    }
  };

  const applyPendingDisbandActions = () => {
    while (pendingDisbandActions.length > 0) {
      const { request, result } = pendingDisbandActions.shift();
      updateDisbandAction(request, result);
    }
  };

  const modules = {
    squadManagement: {
      requestDisband(request) {
        disbands.push(request);
        let result;
        if (typeof options.requestDisband === "function") {
          result = options.requestDisband(request);
        } else {
          result = { ok: true, command: `AdminDisbandSquad ${request.teamId} ${request.squadId}` };
        }
        if (result && typeof result.then === "function") {
          return result.then((res) => {
            pendingDisbandActions.push({ request, result: res });
            return res;
          });
        }
        pendingDisbandActions.push({ request, result });
        return Promise.resolve(result);
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
  };

  plugin = createPlugin({
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
        emitModuleEvent(moduleId, eventName, event) {
          if (moduleId === "module.squadRuleChain" && eventName === "squadRuleViolation") {
            const key = `${event.serverId}:${event.teamId}:${event.squadId}`;
            const existingDisband = lastDisbandByKey.get(key);
            const eventMs = Number(event.createdAtMs) || Date.parse(event.createdAt) || 0;

            let alreadyDisbanded = false;
            let lastDisbandFailed = false;
            if (plugin && plugin.api && plugin.api._state) {
              const record = plugin.api._state.records.find(
                (r) => r.teamId === event.teamId && r.squadId === event.squadId
              );
              if (record) {
                alreadyDisbanded = record.actions.some((a) => a.type === "disbanded");
                lastDisbandFailed = record.actions.some((a) => a.type === "disband_failed") &&
                  !record.actions.some((a) => a.type === "disbanded");
              }
            }

            if (alreadyDisbanded) {
              return;
            }
            if (existingDisband && eventMs <= existingDisband.timestamp && !lastDisbandFailed) {
              return;
            }

            const request = {
              serverId: event.serverId,
              matchId: event.matchId,
              teamId: event.teamId,
              squadId: event.squadId,
              squadName: event.squadName,
              creatorName: event.leaderName,
              creatorSteamId: event.leaderSteamId,
              creatorEosId: event.leaderEosId,
              reason: event.disbandReason || "Stepwise playtime guard disband",
              source: "module.squadRuleChain",
              operatorName: "module.squadRuleChain",
              system: true,
              allowUnverifiedTarget: true,
              allowRefresh: false,
              priority: "high",
              bypassRateLimit: true,
              rconChannel: "disband",
            };
            void modules.squadManagement.requestDisband(request);

            lastDisbandByKey.set(key, { timestamp: eventMs });

            if (event.broadcastMessage) {
              broadcasts.push({
                message: event.broadcastMessage,
              });
            }
            if (Array.isArray(event.warningMessages)) {
              for (const msg of event.warningMessages) {
                warnings.push({
                  targetName: event.leaderName,
                  message: msg,
                });
              }
            }
          }
        },
      },
      logger: noopLogger(),
    },
    modules,
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

  const originalSimulateCreation = plugin.api.simulateCreation;
  plugin.api.simulateCreation = async function(...args) {
    const res = await originalSimulateCreation.apply(this, args);
    applyPendingDisbandActions();
    if (res && plugin.api._state) {
      const updated = plugin.api._state.records.find((r) => r.id === res.id);
      if (updated) return { ...updated };
    }
    return res;
  };

  const originalSimulateSquadsUpdated = plugin.api.simulateSquadsUpdated;
  plugin.api.simulateSquadsUpdated = async function(...args) {
    const res = await originalSimulateSquadsUpdated.apply(this, args);
    applyPendingDisbandActions();
    return plugin.api.getStatus();
  };

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
    assert.equal(typeof harness.broadcasts[0].message, "string");
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
    assert.equal(harness.broadcasts.length, 0);
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
    assert.equal(typeof harness.broadcasts[0].message, "string");
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
    assert.equal(harness.broadcasts.length, 0);

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
    assert.equal(harness.broadcasts.length, 0);
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
    assert.equal(harness.broadcasts.length, 0);
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
    assert.equal(harness.broadcasts.length, 0);
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
    assert.equal(harness.broadcasts.length, 0);
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
    const now = Date.now();
    await harness.plugin.api.simulateSquadsUpdated({
      serverId: "test-server",
      matchId: "match-1",
      time: new Date(now).toISOString(),
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
      createdAt: new Date(now - 5000).toISOString(),
      createdAtMs: now - 5000,
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
    assert.equal(harness.broadcasts.length, 0);
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
await testTransientDisbandFailureRetries();

async function testTransientDisbandFailureRetries() {
  let callCount = 0;
  const harness = await createHarness({
    playtimeRows: [["steam-1", { game_seconds: 350 * 3600 }]],
    requestDisband: (request) => {
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

    assert.equal(harness.disbands.length, 2);
    const statusAfter = harness.plugin.api.getStatus();
    const recordAfter = statusAfter.recentRecords.find((r) => r.squadId === 40);
    assert.equal(recordAfter.actions.some((a) => a.type === "disbanded"), true);

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
    assert.equal(harness.disbands.length, 2);
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

