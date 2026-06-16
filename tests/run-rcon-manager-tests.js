import assert from "node:assert/strict";

import { RconManager } from "../core/rcon-manager.js";
import { createTeamBalanceService } from "../modules/team-balance/service.js";
import { resolveRconPermission } from "../web-client/src/shared/rcon-permissions.js";

function createHarness(overrides = {}) {
  const executedCommands = [];
  const statusUpdates = [];
  const webStatusSnapshot = {
    logClockSeconds: 0,
    logClockHasAnchor: false,
    logClockManual: false,
    ...(overrides.webStatusSnapshot ?? {}),
  };

  const manager = new RconManager({
    config: {
      enabled: true,
      polling: {
        enabled: Boolean(overrides.pollingEnabled ?? false),
        dynamic: {
          enabled: true,
          fastUntilSeconds: 90,
          mediumUntilSeconds: 180,
          fastPlayersIntervalMs: 1000,
          fastSquadsIntervalMs: 1500,
          mediumPlayersIntervalMs: 2500,
          mediumSquadsIntervalMs: 3500,
        },
      },
      matchStatePolling: {
        playersIntervalMs: 5000,
        squadsIntervalMs: 10000,
      },
      rateLimit: {
        minIntervalMs: 0,
        priorityMinIntervalMs: 0,
        maxQueueSize: 10,
        ...(overrides.rateLimit ?? {}),
      },
    },
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
    eventBus: {
      emitCoreEvent() {},
    },
    webStatus: {
      serverId: "BZSS_Main",
      getSnapshot() {
        return { ...webStatusSnapshot };
      },
      set(key, value) {
        statusUpdates.push({ key, value });
      },
    },
  });

  manager.squadRcon = {
    connected: true,
    loggedIn: true,
    async connect() {
      this.connected = true;
      this.loggedIn = true;
    },
    async execute(command) {
      executedCommands.push(command);
      return "OK";
    },
    async getListPlayers() {
      executedCommands.push("ListPlayers");
      return [];
    },
    async getSquads() {
      executedCommands.push("ListSquads");
      return [];
    },
  };
  manager.disbandRcon = overrides.disbandRcon ?? null;

  return { manager, executedCommands, statusUpdates, webStatusSnapshot };
}

async function testResolveRconPermissionAliases() {
  assert.equal(resolveRconPermission("tb"), "rcon.tb");
  assert.equal(resolveRconPermission("AdminBroadcast Hello"), "rcon.broadcast");
  assert.equal(resolveRconPermission("AdminDisbandSquad 1 2"), "rcon.disband");
  assert.equal(resolveRconPermission("AdminKickFromSquad 1 2 3"), "rcon.remove");
  assert.equal(resolveRconPermission("ListPlayers"), "");
}

async function generateForceTeamChangeCommand() {
  const executedCommands = [];
  const service = createTeamBalanceService({
    core: {
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      rcon: {
        async execute(command) {
          executedCommands.push(command);
          return "OK";
        },
      },
    },
    config: {
      get() {
        return {
          enabled: true,
          switchPermission: "squad.switch",
        };
      },
    },
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
  });

  const result = await service.api.forceTeamChange({
    steamId: "76561198377609640",
    playerName: "PlayerName",
    source: "test",
    reason: "test",
    operator: {
      isSuperAdmin: true,
      permissions: ["*"],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(executedCommands.length, 1);
  return executedCommands[0];
}

async function testDispatchCommandRejectsMissingPermission() {
  const { manager, executedCommands } = createHarness();
  const result = await manager.dispatchCommand({
    command: "AdminBroadcast Hello",
    actor: {
      username: "viewer",
      permissions: ["rcon.warn"],
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.code, "Forbidden");
  assert.equal(result.requiredPermission, "rcon.broadcast");
  assert.equal(executedCommands.length, 0);
}

async function testDispatchCommandAllowsMatchingPermission() {
  const { manager, executedCommands } = createHarness();
  const command = await generateForceTeamChangeCommand();
  const result = await manager.dispatchCommand({
    command,
    actor: {
      username: "operator",
      permissions: ["rcon.tb"],
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.rconExecuted, true);
  assert.equal(result.rconResponse, "OK");
  assert.deepEqual(executedCommands, [command]);
}

async function testDispatchCommandAllowsSystemBypass() {
  const { manager, executedCommands } = createHarness();
  const result = await manager.dispatchCommand({
    command: "ListPlayers",
    system: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.rconExecuted, true);
  assert.deepEqual(executedCommands, ["ListPlayers"]);
}

async function testDispatchCommandRejectsUnknownManualCommandForAdmin() {
  const { manager, executedCommands } = createHarness();
  const result = await manager.dispatchCommand({
    command: "ListPlayers",
    actor: {
      username: "operator",
      permissions: ["rcon.tb", "rcon.warn", "rcon.broadcast", "rcon.kick", "rcon.disband", "rcon.remove"],
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.code, "Forbidden");
  assert.equal(result.requiredPermission, "");
  assert.equal(executedCommands.length, 0);
}

async function testBypassRateLimitSkipsInterval() {
  const { manager, executedCommands } = createHarness({
    rateLimit: {
      minIntervalMs: 50,
      priorityMinIntervalMs: 50,
    },
  });
  const originalSetTimeout = globalThis.setTimeout;
  const originalDateNow = Date.now;
  const delays = [];

  globalThis.setTimeout = (handler, delayMs) => {
    delays.push(delayMs);
    return originalSetTimeout(handler, 0);
  };

  const fixedNow = 1700000000000;
  Date.now = () => fixedNow;

  try {
    manager.lastCommandTime = Date.now();

    const bypassResult = await manager.dispatchCommand({
      command: "AdminWarn \"PlayerA\" \"Hello\"",
      system: true,
      bypassRateLimit: true,
    });
    assert.equal(bypassResult.success, true);

    const normalResult = await manager.dispatchCommand({
      command: "AdminBroadcast Hello",
      system: true,
    });
    assert.equal(normalResult.success, true);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    Date.now = originalDateNow;
  }

  assert.deepEqual(executedCommands, [
    "AdminWarn \"PlayerA\" \"Hello\"",
    "AdminBroadcast Hello",
  ]);
  assert.deepEqual(delays, [50]);
}

async function testDynamicPollingIntervalsFollowLogClock() {
  const { manager, webStatusSnapshot } = createHarness({
    pollingEnabled: true,
    webStatusSnapshot: {
      logClockSeconds: 30,
      logClockHasAnchor: true,
      logClockManual: false,
    },
  });

  assert.equal(manager.resolvePollingInterval("players"), 1000);
  assert.equal(manager.resolvePollingInterval("squads"), 1500);

  webStatusSnapshot.logClockSeconds = 120;
  assert.equal(manager.resolvePollingInterval("players"), 2500);
  assert.equal(manager.resolvePollingInterval("squads"), 3500);

  webStatusSnapshot.logClockSeconds = 240;
  assert.equal(manager.resolvePollingInterval("players"), 5000);
  assert.equal(manager.resolvePollingInterval("squads"), 10000);
}

async function testSchedulePollingRecomputesNextDelay() {
  const { manager, webStatusSnapshot } = createHarness({
    pollingEnabled: true,
    webStatusSnapshot: {
      logClockSeconds: 30,
      logClockHasAnchor: true,
      logClockManual: false,
    },
  });
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduledDelays = [];

  globalThis.setTimeout = (handler, delayMs) => {
    scheduledDelays.push(delayMs);
    return { handler, delayMs };
  };
  globalThis.clearTimeout = () => {};

  try {
    manager.schedulePolling("players");
    webStatusSnapshot.logClockSeconds = 120;
    manager.schedulePolling("players");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    manager.pollingTimers.players = null;
  }

  assert.deepEqual(scheduledDelays, [1000, 2500]);
}

async function testRefreshPlayersSkipsWhenAlreadyInFlight() {
  const { manager, executedCommands } = createHarness();
  manager.refreshInFlight.players = true;

  const result = await manager.refreshPlayers();

  assert.deepEqual(result, []);
  assert.deepEqual(executedCommands, []);
  manager.refreshInFlight.players = false;
}

async function testDisbandLaneDoesNotWaitForBlockedDefaultCommand() {
  let releaseDefault;
  const defaultStarted = new Promise((resolve) => {
    releaseDefault = resolve;
  });
  const defaultFinished = new Promise(() => {});
  const disbandCommands = [];
  const { manager } = createHarness({
    disbandRcon: {
      connected: true,
      loggedIn: true,
      async connect() {
        this.connected = true;
        this.loggedIn = true;
      },
      async execute(command) {
        disbandCommands.push(command);
        return "DISBANDED";
      },
    },
  });
  manager.squadRcon.execute = async () => {
    releaseDefault();
    return defaultFinished;
  };

  const normalPromise = manager.dispatchCommand({
    command: "AdminBroadcast Slow",
    system: true,
  });
  await defaultStarted;

  const disbandResult = await manager.dispatchCommand({
    command: "AdminDisbandSquad 1 2",
    system: true,
  });

  assert.equal(disbandResult.success, true);
  assert.equal(disbandResult.rconResponse, "DISBANDED");
  assert.equal(disbandResult.queueLane, "disband");
  assert.deepEqual(disbandCommands, ["AdminDisbandSquad 1 2"]);

  normalPromise.catch(() => {});
}

await testResolveRconPermissionAliases();
await testDispatchCommandRejectsMissingPermission();
await testDispatchCommandAllowsMatchingPermission();
await testDispatchCommandAllowsSystemBypass();
await testDispatchCommandRejectsUnknownManualCommandForAdmin();
await testBypassRateLimitSkipsInterval();
await testDynamicPollingIntervalsFollowLogClock();
await testSchedulePollingRecomputesNextDelay();
await testRefreshPlayersSkipsWhenAlreadyInFlight();
await testDisbandLaneDoesNotWaitForBlockedDefaultCommand();

console.log("rcon manager tests passed");
