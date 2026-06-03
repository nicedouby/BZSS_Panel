import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPlugin } from "../plugins/fair-squad-guard.js";

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
            disbandCommandNameSuffix: "x",
            allowedInfantryNamesText: "INF OK",
            allowedInfantryPatternsText: "",
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
    kicks,
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
    const defaultName = await harness.plugin.api.simulateCreation(logCreation({ squadId: 4, squadName: "Squad 4" }));
    assert.equal(defaultName.approved, true);

    const allowlisted = await harness.plugin.api.simulateCreation(logCreation({ squadId: 5, squadName: "INF OK" }));
    assert.equal(allowlisted.approved, true);

    const vehicle = await harness.plugin.api.simulateCreation(logCreation({ squadId: 6, squadName: "Tank" }));
    assert.equal(vehicle.violation, true);

    harness.webStatus.logClockSeconds = 60;
    const open = await harness.plugin.api.simulateCreation(logCreation({ squadId: 7, squadName: "Tank 2" }));
    assert.equal(open.approved, true);
  } finally {
    await harness.stop();
  }
}

async function testRconOnlyDisbandsButDoesNotPunishPlayer() {
  const harness = await createHarness();
  try {
    await harness.plugin.api.simulateSquadsUpdated({
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
    assert.equal(status.summary.violations, 1);
    assert.equal(harness.disbands.length, 1);
    assert.equal(harness.disbands[0].commandNameSuffix, "x");
    assert.equal(harness.warnings.length, 0);
    assert.equal(harness.kicks.length, 0);
    assert.equal(status.leaderboard.length, 0);
    assert.equal(status.currentViolatingSquads.length, 1);
    assert.equal(status.recentRecords[0].creationSource, "RCON_SNAPSHOT");
  } finally {
    await harness.stop();
  }
}

async function testCurrentViolatingSquadsFollowRconSnapshot() {
  const harness = await createHarness();
  try {
    await harness.plugin.api.simulateSquadsUpdated({
      serverId: "test-server",
      matchId: "match-1",
      squads: [{ teamId: 1, squadId: 10, squadName: "Tank" }],
    });
    assert.equal(harness.plugin.api.getStatus().currentViolatingSquads.length, 1);

    await harness.plugin.api.simulateSquadsUpdated({
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

async function testLogPromotesRconWithoutSecondDisband() {
  const harness = await createHarness();
  try {
    await harness.plugin.api.simulateSquadsUpdated({
      serverId: "test-server",
      matchId: "match-1",
      squads: [{ teamId: 1, squadId: 9, squadName: "Tank", leaderName: "Leader Now" }],
    });
    assert.equal(harness.disbands.length, 1);

    const promoted = await harness.plugin.api.simulateCreation(logCreation({
      teamId: null,
      squadId: 9,
      squadName: "Tank",
      creatorName: "Real Creator",
      creatorSteamId: "steam-real",
    }));

    assert.equal(promoted.creationSource, "RCON_PROMOTED_TO_LOG");
    assert.equal(harness.disbands.length, 1);
    assert.equal(harness.disbands[0].commandNameSuffix, "x");
    assert.equal(harness.warnings.length, 1);
    assert.equal(harness.plugin.api.getStatus().leaderboard[0].violations, 1);
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

await testLowPopulationIgnored();
await testMissingAnchorLocksRound();
await testManualClockLocksRoundAndUnlockAllowsExecution();
await testWindowRules();
await testRconOnlyDisbandsButDoesNotPunishPlayer();
await testCurrentViolatingSquadsFollowRconSnapshot();
await testLogPromotesRconWithoutSecondDisband();
await testSixteenthViolationKicks();

console.log("run-fair-squad-guard-tests.js passed");
