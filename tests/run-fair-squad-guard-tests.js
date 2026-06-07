import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPlugin } from "../plugins/fair-squad-guard.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, { timeoutMs = 2000, intervalMs = 20 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await check();
    if (result) return result;
    await sleep(intervalMs);
  }
  throw new Error("waitFor timeout");
}

function makePlayers(count) {
  return Array.from({ length: count }, (_, index) => ({
    name: `Player ${index + 1}`,
    steamId: `steam-${index + 1}`,
    eosId: `eos-${index + 1}`,
    teamId: index % 2 === 0 ? 1 : 2,
  }));
}

async function createHarness(options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-fair-squad-guard-"));
  const moduleHandlers = new Map();
  const coreHandlers = new Map();
  const disbands = [];
  const warnings = [];
  const broadcasts = [];
  const kicks = [];
  const webStatus = {
    serverId: "test-server",
    playerCount: options.playerCount ?? 60,
    logClockSeconds: 30,
    logClockHasAnchor: true,
    logClockManual: false,
    logClockLastResetReason: "worldBringUp",
    ...(options.webStatus ?? {}),
  };
  const matchState = {
    players: makePlayers(options.playerCount ?? 60),
    squads: [],
  };

  const plugin = createPlugin({
    core: {
      webStatus: {
        serverId: "test-server",
        getSnapshot() {
          return { ...webStatus };
        },
      },
      webRegistry: { registerPage() {} },
      eventBus: {
        onModuleEvent(moduleId, eventName, handler) {
          moduleHandlers.set(`${moduleId}:${eventName}`, handler);
          return () => moduleHandlers.delete(`${moduleId}:${eventName}`);
        },
        onCoreEvent(eventName, handler) {
          coreHandlers.set(eventName, handler);
          return () => coreHandlers.delete(eventName);
        },
      },
      logger: noopLogger(),
    },
    modules: {
      squadManagement: {
        getState() {
          return matchState;
        },
        async requestDisband(request) {
          disbands.push(request);
          if (typeof options.requestDisband === "function") return await options.requestDisband(request);
          return { ok: true, command: `AdminDisbandSquad${request.commandNameSuffix ?? ""} ${request.teamId} ${request.squadId}` };
        },
        async requestKick(request) {
          kicks.push(request);
          return { ok: true, command: `AdminKick ${request.steamId || request.name}` };
        },
      },
      adminWarn: {
        async sendAdminWarn(request) {
          warnings.push(request);
          return { success: true, commandText: `AdminWarn ${request.targetName}` };
        },
        async sendAdminBroadcast(request) {
          broadcasts.push(request);
          return { success: true, commandText: `AdminBroadcast ${request.message}` };
        },
      },
    },
    config: {
      get(pathText, fallback) {
        if (pathText === "plugins.fairSquadGuard") {
          return {
            enabled: true,
            directory: tempDir,
            enforcementPlayerThreshold: options.threshold ?? 50,
            noSquadCreationSeconds: 20,
            infantryOnlyUntilSeconds: 50,
            maxViolationCountBeforeKick: 15,
            disbandCommandNameSuffix: "",
            allowedInfantryNamesText: "INF OK",
            allowedInfantryPatternsText: "",
            broadcastOnApproved: options.broadcastOnApproved !== false,
            broadcastOnViolation: options.broadcastOnViolation !== false,
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
    tempDir,
    webStatus,
    matchState,
    disbands,
    warnings,
    broadcasts,
    kicks,
    async emitCoreEvent(eventName, payload = {}) {
      const handler = coreHandlers.get(eventName);
      if (handler) {
        await handler(payload);
      }
    },
    async emitModuleEvent(moduleId, eventName, payload = {}) {
      const handler = moduleHandlers.get(`${moduleId}:${eventName}`);
      if (handler) {
        await handler(payload);
      }
    },
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

function logCreation(overrides = {}) {
  return {
    serverId: "test-server",
    matchId: "match-1",
    teamId: 1,
    squadId: 1,
    squadName: "Armor",
    creatorName: "Leader",
    creatorSteamId: "steam-leader",
    creatorEosId: "eos-leader",
    creationSource: "LOG",
    creationConfidence: "HIGH",
    ...overrides,
  };
}

async function testLowPopulationIgnored() {
  const harness = await createHarness({ playerCount: 49 });
  try {
    const result = await harness.plugin.api.simulateCreation(logCreation());
    assert.equal(result, null);
    assert.equal(harness.disbands.length, 0);
    assert.equal(harness.plugin.api.getStatus().summary.total, 0);
  } finally {
    await harness.stop();
  }
}

async function testMissingAnchorLocksRound() {
  const harness = await createHarness({
    webStatus: { logClockHasAnchor: false, logClockSeconds: 600 },
  });
  try {
    const result = await harness.plugin.api.simulateCreation(logCreation());
    assert.equal(result, null);
    assert.equal(harness.disbands.length, 0);
    assert.equal(harness.plugin.api.getStatus().session.midRoundLocked, true);
  } finally {
    await harness.stop();
  }
}

async function testManualClockLocksRoundAndUnlockAllowsExecution() {
  const harness = await createHarness({
    webStatus: { logClockManual: true, logClockHasAnchor: false, logClockSeconds: 10 },
  });
  try {
    assert.equal(harness.plugin.api.getStatus().session.midRoundLocked, true);
    assert.equal(await harness.plugin.api.simulateCreation(logCreation()), null);
    harness.plugin.api.unlockCurrentRound({ by: "test" });
    const result = await harness.plugin.api.simulateCreation(logCreation({ squadId: 2, squadName: "Armor 2" }));
    assert.equal(result.violation, true);
    assert.equal(harness.disbands.length, 1);
  } finally {
    await harness.stop();
  }
}

async function testWindowRules() {
  const harness = await createHarness();
  try {
    harness.webStatus.logClockSeconds = 10;
    const locked = await harness.plugin.api.simulateCreation(logCreation({ squadId: 3, squadName: "Squad 3" }));
    assert.equal(locked.violation, true);

    harness.webStatus.logClockSeconds = 30;
    const defaultName = await harness.plugin.api.simulateCreation(logCreation({
      squadId: 4,
      squadName: "Squad 4",
      creatorName: "Another Leader",
      creatorSteamId: "steam-another-leader",
      creatorEosId: "eos-another-leader",
    }));
    assert.equal(defaultName.approved, true);

    const allowlisted = await harness.plugin.api.simulateCreation(logCreation({
      squadId: 5,
      squadName: "INF OK",
      creatorName: "Third Leader",
      creatorSteamId: "steam-third-leader",
      creatorEosId: "eos-third-leader",
    }));
    assert.equal(allowlisted.approved, true);

    const vehicle = await harness.plugin.api.simulateCreation(logCreation({
      squadId: 6,
      squadName: "Tank",
      creatorName: "Fourth Leader",
      creatorSteamId: "steam-fourth-leader",
      creatorEosId: "eos-fourth-leader",
    }));
    assert.equal(vehicle.violation, true);

    harness.webStatus.logClockSeconds = 60;
    const open = await harness.plugin.api.simulateCreation(logCreation({
      squadId: 7,
      squadName: "Tank 2",
      creatorName: "Fifth Leader",
      creatorSteamId: "steam-fifth-leader",
      creatorEosId: "eos-fifth-leader",
    }));
    assert.equal(open.approved, true);
  } finally {
    await harness.stop();
  }
}

async function testPhaseAnnouncementsBroadcastAtRoundStartAndWindowTransitions() {
  const harness = await createHarness({
    webStatus: { logClockSeconds: 10 },
  });
  try {
    await harness.emitCoreEvent("round.world_bring_up", {
      eventName: "round.world_bring_up",
      serverId: "test-server",
    });
    await waitFor(() => harness.broadcasts.length >= 1);
    assert.match(harness.broadcasts[0].message, /公平建队机制已开启/);
    assert.match(harness.broadcasts[0].message, /20s/);

    harness.webStatus.logClockSeconds = 30;
    await waitFor(() => harness.broadcasts.length >= 2);
    assert.match(harness.broadcasts[1].message, /步兵队建队区间已开启/);
    assert.match(harness.broadcasts[1].message, /20-50s/);

    harness.webStatus.logClockSeconds = 60;
    await waitFor(() => harness.broadcasts.length >= 3);
    assert.match(harness.broadcasts[2].message, /步兵队建队已放开/);
  } finally {
    await harness.stop();
  }
}

async function testRconOnlySnapshotDoesNotCreateDecisionRecord() {
  const harness = await createHarness();
  try {
    await harness.emitModuleEvent("module.matchState", "squadsUpdated", {
      serverId: "test-server",
      matchId: "match-1",
      squads: [{
        teamId: 1,
        squadId: 8,
        squadName: "Tank",
        leaderName: "Current Leader",
        leaderSteamId: "steam-current",
      }],
    });
    const status = harness.plugin.api.getStatus();
    assert.equal(status.summary.violations, 0);
    assert.equal(harness.disbands.length, 0);
    assert.equal(harness.warnings.length, 0);
    assert.equal(harness.kicks.length, 0);
    assert.equal(status.leaderboard.length, 0);
    assert.equal(status.currentViolatingSquads.length, 0);
    assert.equal(status.recentRecords.length, 0);
  } finally {
    await harness.stop();
  }
}

async function testCurrentViolatingSquadsFollowRconSnapshotAfterLogDecision() {
  const harness = await createHarness();
  try {
    await harness.plugin.api.simulateCreation(logCreation({
      teamId: 1,
      squadId: 10,
      squadName: "Tank",
    }));
    assert.equal(harness.plugin.api.getStatus().currentViolatingSquads.length, 0);

    await harness.emitModuleEvent("module.matchState", "squadsUpdated", {
      serverId: "test-server",
      matchId: "match-1",
      squads: [{ teamId: 1, squadId: 10, squadName: "Tank" }],
    });
    assert.equal(harness.plugin.api.getStatus().currentViolatingSquads.length, 1);

    await harness.emitModuleEvent("module.matchState", "squadsUpdated", {
      serverId: "test-server",
      matchId: "match-1",
      squads: [],
    });
    const status = harness.plugin.api.getStatus();
    assert.equal(status.currentViolatingSquads.length, 0);
    assert.equal(status.recentRecords[0].active, false);
    assert.ok(status.recentRecords[0].resolvedAt);
  } finally {
    await harness.stop();
  }
}

async function testPendingLogWaitsForRconTeamIdAndStaysLogBacked() {
  const harness = await createHarness();
  try {
    await harness.emitModuleEvent("module.squadLifecycle", "squadCreated", logCreation({
      teamId: null,
      squadId: 9,
      squadName: "Tank",
      creatorName: "Real Creator",
      creatorSteamId: "steam-real",
    }));
    assert.equal(harness.plugin.api.getStatus().pendingLogCount, 1);

    await harness.emitModuleEvent("module.matchState", "squadsUpdated", {
      serverId: "test-server",
      matchId: "match-1",
      squads: [{ teamId: 1, squadId: 9, squadName: "Tank", leaderName: "Leader Now" }],
    });
    assert.equal(harness.disbands.length, 1);
    assert.equal(harness.disbands[0].commandNameSuffix, "");
    assert.equal(harness.warnings.length, 1);
    const status = harness.plugin.api.getStatus();
    assert.equal(status.pendingLogCount, 0);
    assert.equal(status.recentRecords.length, 1);
    assert.equal(status.leaderboard[0].violations, 1);
  } finally {
    await harness.stop();
  }
}

async function testRepeatedViolationsAreNotBlockedByCooldown() {
  const harness = await createHarness();
  try {
    await harness.plugin.api.simulateCreation(logCreation({
      teamId: 1,
      squadId: 20,
      squadName: "Tank A",
      creatorName: "Fast Creator",
      creatorSteamId: "steam-fast",
      creatorEosId: "eos-fast",
    }));
    await harness.plugin.api.simulateCreation(logCreation({
      teamId: 1,
      squadId: 21,
      squadName: "Tank B",
      creatorName: "Fast Creator",
      creatorSteamId: "steam-fast",
      creatorEosId: "eos-fast",
    }));

    const status = harness.plugin.api.getStatus();
    assert.equal(status.summary.violations, 2);
    assert.equal(status.leaderboard[0].violations, 2);
    assert.equal(harness.disbands.length, 2);
    assert.equal(harness.warnings.length, 2);
    assert.equal(harness.broadcasts.length >= 2, true);
    assert.equal(status.recentRecords.some((record) => record.phase === "kick_cooldown"), false);
  } finally {
    await harness.stop();
  }
}

async function testSixteenthViolationKicks() {
  const harness = await createHarness();
  try {
    for (let index = 0; index < 16; index += 1) {
      await harness.plugin.api.simulateCreation(logCreation({
        squadId: 100 + index,
        squadName: `Tank ${index}`,
        creatorName: "Repeat Offender",
        creatorSteamId: "steam-repeat",
      }));
    }
    assert.equal(harness.plugin.api.getStatus().leaderboard[0].violations, 16);
    assert.equal(harness.kicks.length, 1);
  } finally {
    await harness.stop();
  }
}

async function testBroadcastOnApprovedAndViolation() {
  const harness = await createHarness({
    broadcastOnApproved: true,
    broadcastOnViolation: true,
  });
  try {
    // 1. approved creation
    harness.webStatus.logClockSeconds = 60; // open phase
    await harness.plugin.api.simulateCreation(logCreation({
      squadId: 30,
      squadName: "Tank 3",
      creatorName: "Approved Creator",
    }));

    // Check that we got an approved broadcast
    assert.equal(harness.broadcasts.length >= 1, true);
    assert.match(harness.broadcasts[harness.broadcasts.length - 1].message, /判定通过/);

    // 2. violating creation
    harness.webStatus.logClockSeconds = 10; // locked phase
    await harness.plugin.api.simulateCreation(logCreation({
      squadId: 31,
      squadName: "Tank 4",
      creatorName: "Violating Creator",
    }));

    // Check that we got a violation broadcast
    assert.equal(harness.broadcasts.length >= 2, true);
    assert.match(harness.broadcasts[harness.broadcasts.length - 1].message, /违规建队已拦截/);

    const status = harness.plugin.api.getStatus();
    assert.equal(status.summary.broadcasts, 2);
  } finally {
    await harness.stop();
  }
}

await testLowPopulationIgnored();
await testMissingAnchorLocksRound();
await testManualClockLocksRoundAndUnlockAllowsExecution();
await testWindowRules();
await testPhaseAnnouncementsBroadcastAtRoundStartAndWindowTransitions();
await testRconOnlySnapshotDoesNotCreateDecisionRecord();
await testCurrentViolatingSquadsFollowRconSnapshotAfterLogDecision();
await testPendingLogWaitsForRconTeamIdAndStaysLogBacked();
await testRepeatedViolationsAreNotBlockedByCooldown();
await testSixteenthViolationKicks();
await testBroadcastOnApprovedAndViolation();
await testTransientDisbandFailureRetries();

async function testTransientDisbandFailureRetries() {
  let callCount = 0;
  const harness = await createHarness({
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
    const result = await harness.plugin.api.simulateCreation(logCreation({
      teamId: 1,
      squadId: 40,
      squadName: "Tank",
    }));
    assert.equal(result.violation, true);
    assert.equal(harness.disbands.length, 1);

    const statusBefore = harness.plugin.api.getStatus();
    const recordBefore = statusBefore.recentRecords.find((r) => r.squadId === 40);
    assert.equal(recordBefore.active, true);
    assert.equal(recordBefore.actions.some((a) => a.type === "disband_failed"), true);
    assert.equal(recordBefore.actions.some((a) => a.type === "disbanded"), false);

    harness.webStatus.logClockSeconds = 60; // Progress clock to open phase

    await harness.emitModuleEvent("module.matchState", "squadsUpdated", {
      serverId: "test-server",
      matchId: "match-1",
      squads: [{ teamId: 1, squadId: 40, squadName: "Tank" }],
    });

    assert.equal(harness.disbands.length, 2);
    const statusAfter = harness.plugin.api.getStatus();
    const recordAfter = statusAfter.recentRecords.find((r) => r.squadId === 40);
    assert.equal(recordAfter.actions.some((a) => a.type === "disbanded"), true);

    await harness.emitModuleEvent("module.matchState", "squadsUpdated", {
      serverId: "test-server",
      matchId: "match-1",
      squads: [{ teamId: 1, squadId: 40, squadName: "Tank" }],
    });
    assert.equal(harness.disbands.length, 2);
  } finally {
    await harness.stop();
  }
}

async function testRecreatedSquadIsDisbandedAgain() {
  const harness = await createHarness();
  try {
    harness.webStatus.logClockSeconds = 10;
    
    // 1. Create first squad (violating)
    await harness.plugin.api.simulateCreation(logCreation({
      teamId: 1,
      squadId: 42,
      squadName: "Tank",
      createdAt: "2026-06-06T11:00:00.000Z",
      createdAtMs: Date.parse("2026-06-06T11:00:00.000Z"),
    }));
    assert.equal(harness.disbands.length, 1);
    
    // RCON confirms squad, and then RCON confirms squad is disbanded (empty squads list)
    await harness.emitModuleEvent("module.matchState", "squadsUpdated", {
      serverId: "test-server",
      matchId: "match-1",
      squads: [{ teamId: 1, squadId: 42, squadName: "Tank" }],
      time: "2026-06-06T11:00:01.000Z",
    });
    await harness.emitModuleEvent("module.matchState", "squadsUpdated", {
      serverId: "test-server",
      matchId: "match-1",
      squads: [],
      time: "2026-06-06T11:00:02.000Z",
    });

    const statusBefore = harness.plugin.api.getStatus();
    const oldRecord = statusBefore.recentRecords.find((r) => r.squadId === 42);
    assert.equal(oldRecord.active, false);

    // 2. Recreate the squad again with same slot key (squadId 42, squadName Tank)
    await harness.plugin.api.simulateCreation(logCreation({
      teamId: 1,
      squadId: 42,
      squadName: "Tank",
      createdAt: "2026-06-06T11:00:05.000Z",
      createdAtMs: Date.parse("2026-06-06T11:00:05.000Z"),
    }));

    // Should disbanded again! Total disbands = 2
    assert.equal(harness.disbands.length, 2);

    const statusAfter = harness.plugin.api.getStatus();
    const records = statusAfter.recentRecords.filter((r) => r.squadId === 42);
    assert.equal(records.length, 2);
  } finally {
    await harness.stop();
  }
}

await testRecreatedSquadIsDisbandedAgain();

console.log("run-fair-squad-guard-tests.js passed");
