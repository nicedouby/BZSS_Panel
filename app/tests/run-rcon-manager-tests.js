import assert from "node:assert/strict";

import { RconManager } from "../core/rcon-manager.js";
import { createTeamBalanceService } from "../modules/team-balance/service.js";
import { resolveRconPermission } from "../../web-client/src/shared/rcon-permissions.js";

function createFakeClient({ id = "default", executedCommands, response = "OK", delayMs = 0, failCommands = new Set(), blockCommands = new Set() } = {}) {
  return {
    id,
    connected: true,
    loggedIn: true,
    async connect() {
      this.connected = true;
      this.loggedIn = true;
    },
    async execute(command) {
      executedCommands.push({ lane: id, command });
      if (blockCommands.has(command)) {
        return await new Promise(() => {});
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      if (failCommands.has(command)) {
        throw new Error(`boom:${command}`);
      }
      return typeof response === "function" ? response(command) : response;
    },
    async getListPlayers() {
      return [];
    },
    async getSquads() {
      return [];
    },
  };
}

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
      allowMultipleConnections: Boolean(overrides.allowMultipleConnections ?? false),
      ...(overrides.rconConfig ?? {}),
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

  manager.squadRcon = createFakeClient({ id: "default", executedCommands });
  manager.disbandRcon = overrides.disbandRcon ?? null;
  if (Array.isArray(overrides.commandLanes)) {
    manager.commandPool.lanes = overrides.commandLanes;
    manager.rconWorkers = manager.commandPool.lanes;
  }
  if (Array.isArray(overrides.queryLanes)) {
    manager.queryPool.lanes = overrides.queryLanes;
  }
  if (Array.isArray(overrides.notificationLanes)) {
    manager.notificationPool.lanes = overrides.notificationLanes;
  }
  if (Array.isArray(overrides.enforcementLanes)) {
    manager.enforcementPool.lanes = overrides.enforcementLanes;
  }
  if (Array.isArray(overrides.disbandLanes)) {
    manager.disbandPool.lanes = overrides.disbandLanes;
    manager.disbandQueue = manager.disbandPool.priorityQueue;
  }

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
  assert.deepEqual(executedCommands.map((item) => item.command), [command]);
}

async function testDispatchCommandAllowsSystemBypass() {
  const { manager, executedCommands } = createHarness();
  const result = await manager.dispatchCommand({
    command: "ListPlayers",
    system: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.rconExecuted, true);
  assert.deepEqual(executedCommands.map((item) => item.command), ["ListPlayers"]);
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

  assert.deepEqual(executedCommands.map((item) => item.command), [
    "AdminWarn \"PlayerA\" \"Hello\"",
    "AdminBroadcast Hello",
  ]);
  assert.deepEqual(delays, []);
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

async function testStartPollingIsIdempotent() {
  const { manager } = createHarness({ pollingEnabled: true });
  const messages = [];
  manager.logger.info = (message) => messages.push(String(message));
  manager.pollingKickPending.players = false;
  manager.pollingKickPending.squads = false;
  manager.startPolling();
  const playersTimer = manager.pollingTimers.players;
  const squadsTimer = manager.pollingTimers.squads;
  manager.startPolling();
  manager.startPolling();
  assert.equal(manager.pollingTimers.players, playersTimer);
  assert.equal(manager.pollingTimers.squads, squadsTimer);
  assert.equal(messages.filter((message) => message.includes("RCON polling started.")).length, 1);
  manager.clearPollingTimer("players");
  manager.clearPollingTimer("squads");
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
        disbandCommands.push({ lane: "disband", command });
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
  assert.deepEqual(disbandCommands.map((item) => item.command), ["AdminDisbandSquad 1 2"]);

  normalPromise.catch(() => {});
}

async function testDefaultUsesSinglePhysicalConnection() {
  const { manager } = createHarness();
  assert.equal(manager.allowMultipleConnections, false);
  assert.equal(manager.commandPoolSize, 1);
  assert.equal(manager.queryPoolSize, 1);
  assert.equal(manager.notificationPoolSize, 1);
  assert.equal(manager.enforcementPoolSize, 1);
}

async function testMultipleConnectionOptInUsesConfiguredPoolSize() {
  const { manager } = createHarness({
    allowMultipleConnections: true,
    rconConfig: {
      commandPoolSize: 4,
      queryPoolSize: 2,
      notificationPoolSize: 3,
      enforcementPoolSize: 2,
    },
  });
  assert.equal(manager.allowMultipleConnections, true);
  assert.equal(manager.commandPoolSize, 4);
  assert.equal(manager.queryPoolSize, 2);
  assert.equal(manager.notificationPoolSize, 3);
  assert.equal(manager.enforcementPoolSize, 2);
}

async function testMultipleConnectionDefaultsToEightEnforcementWorkers() {
  const { manager } = createHarness({ allowMultipleConnections: true });
  assert.equal(manager.enforcementPoolSize, 8);
}

async function testEnforcementLaneDoesNotWaitForBlockedNotification() {
  let markNotificationStarted;
  const notificationStarted = new Promise((resolve) => {
    markNotificationStarted = resolve;
  });
  const notificationNeverFinishes = new Promise(() => {});
  const notificationCommands = [];
  const enforcementCommands = [];
  const { manager } = createHarness({
    allowMultipleConnections: true,
    notificationLanes: [{
      id: "notification-1",
      client: {
        connected: true,
        loggedIn: true,
        async connect() {},
        async execute(command) {
          notificationCommands.push(command);
          markNotificationStarted();
          return notificationNeverFinishes;
        },
      },
      busy: false, lastCommandTime: 0, lastUsedAt: 0, cooldownUntil: 0, failureCount: 0, lastError: "",
    }],
    enforcementLanes: [{
      id: "enforcement-1",
      client: createFakeClient({ id: "enforcement-1", executedCommands: enforcementCommands }),
      busy: false, lastCommandTime: 0, lastUsedAt: 0, cooldownUntil: 0, failureCount: 0, lastError: "",
    }],
  });

  const notificationPromise = manager.dispatchCommand({
    command: "AdminWarnById 41 \"Slow warning\"",
    system: true,
  });
  await notificationStarted;

  const enforcementResult = await manager.dispatchCommand({
    command: "AdminForceTeamChange 76561198377609640",
    system: true,
    priority: "interactive",
  });

  assert.equal(enforcementResult.success, true);
  assert.equal(enforcementResult.queueLane, "enforcement-1");
  assert.deepEqual(notificationCommands, ["AdminWarnById 41 \"Slow warning\""]);
  assert.deepEqual(enforcementCommands.map((item) => item.command), ["AdminForceTeamChange 76561198377609640"]);
  notificationPromise.catch(() => {});
}

async function testCommandPoolUsesMultipleReadyLanes() {
  const executedCommands = [];
  const lanes = ["command-1", "command-2", "command-3", "command-4"]
    .map((id) => ({
      id,
      client: createFakeClient({ id, executedCommands, delayMs: 5 }),
      busy: false,
      lastCommandTime: 0,
      lastUsedAt: 0,
      cooldownUntil: 0,
      failureCount: 0,
      lastError: "",
    }));
  const { manager } = createHarness({ commandLanes: lanes });

  const results = await Promise.all([
    manager.dispatchCommand({ command: "AdminBroadcast A", system: true }),
    manager.dispatchCommand({ command: "AdminBroadcast B", system: true }),
    manager.dispatchCommand({ command: "AdminBroadcast C", system: true }),
    manager.dispatchCommand({ command: "AdminBroadcast D", system: true }),
  ]);

  assert.equal(results.every((item) => item.success), true);
  assert.deepEqual(new Set(executedCommands.map((item) => item.lane)), new Set(["command-1", "command-2", "command-3", "command-4"]));
}

async function testLowVolumeRotatesAwayFromRecentlyUsedLane() {
  const executedCommands = [];
  const lanes = ["command-1", "command-2"]
    .map((id) => ({
      id,
      client: createFakeClient({ id, executedCommands }),
      busy: false,
      lastCommandTime: 0,
      lastUsedAt: 0,
      cooldownUntil: 0,
      failureCount: 0,
      lastError: "",
    }));
  const { manager } = createHarness({
    commandLanes: lanes,
    rateLimit: { minIntervalMs: 0 },
  });

  const first = await manager.dispatchCommand({ command: "AdminBroadcast A", system: true });
  const second = await manager.dispatchCommand({ command: "AdminBroadcast B", system: true });

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.deepEqual(executedCommands.map((item) => item.lane), ["command-1", "command-2"]);
}

async function testAllLanesCoolingWaitsForShortestDelay() {
  const executedCommands = [];
  const now = 1700000000000;
  const lanes = [
    {
      id: "command-1",
      client: createFakeClient({ id: "command-1", executedCommands }),
      busy: false,
      lastCommandTime: now,
      lastUsedAt: now,
      cooldownUntil: now + 100,
      failureCount: 0,
      lastError: "",
    },
    {
      id: "command-2",
      client: createFakeClient({ id: "command-2", executedCommands }),
      busy: false,
      lastCommandTime: now,
      lastUsedAt: now - 1,
      cooldownUntil: now + 40,
      failureCount: 0,
      lastError: "",
    },
  ];
  const { manager } = createHarness({ commandLanes: lanes });
  const originalDateNow = Date.now;
  const originalSetTimeout = globalThis.setTimeout;
  const delays = [];
  Date.now = () => now;
  globalThis.setTimeout = (handler, delayMs) => {
    delays.push(delayMs);
    return originalSetTimeout(() => {
      Date.now = () => now + 40;
      handler();
    }, 0);
  };

  try {
    const result = await manager.dispatchCommand({ command: "AdminBroadcast Cooled", system: true });
    assert.equal(result.success, true);
  } finally {
    Date.now = originalDateNow;
    globalThis.setTimeout = originalSetTimeout;
  }

  assert.deepEqual(delays, [40]);
  assert.deepEqual(executedCommands.map((item) => item.lane), ["command-2"]);
}

async function testPriorityRunsBeforeNormalButUsesCooldown() {
  const executedCommands = [];
  let release;
  const blockFirst = new Promise((resolve) => { release = resolve; });
  let callCount = 0;
  const lane = {
    id: "command-1",
    client: {
      connected: true,
      loggedIn: true,
      async connect() {},
      async execute(command) {
        executedCommands.push({ lane: "command-1", command });
        callCount += 1;
        if (callCount === 1) await blockFirst;
        return "OK";
      },
    },
    busy: false,
    lastCommandTime: 0,
    lastUsedAt: 0,
    cooldownUntil: 0,
    failureCount: 0,
    lastError: "",
  };
  const { manager } = createHarness({
    commandLanes: [lane],
    rateLimit: { minIntervalMs: 0, priorityMinIntervalMs: 25 },
  });
  const originalDateNow = Date.now;
  const originalSetTimeout = globalThis.setTimeout;
  const delays = [];
  let now = 1700000000000;
  Date.now = () => now;
  globalThis.setTimeout = (handler, delayMs) => {
    delays.push(delayMs);
    return originalSetTimeout(() => {
      now += delayMs;
      handler();
    }, 0);
  };

  try {
    const firstPromise = manager.dispatchCommand({ command: "AdminBroadcast First", system: true });
    await new Promise((resolve) => originalSetTimeout(resolve, 0));
    const normalPromise = manager.dispatchCommand({ command: "AdminBroadcast Normal", system: true });
    const priorityPromise = manager.dispatchCommand({ command: "AdminWarn \"P\" \"High\"", system: true, priority: "high" });
    release();
    const results = await Promise.all([firstPromise, priorityPromise, normalPromise]);
    assert.equal(results.every((item) => item.success), true);
  } finally {
    Date.now = originalDateNow;
    globalThis.setTimeout = originalSetTimeout;
  }

  assert.deepEqual(executedCommands.map((item) => item.command), [
    "AdminBroadcast First",
    "AdminWarn \"P\" \"High\"",
    "AdminBroadcast Normal",
  ]);
  assert.deepEqual(delays, [25]);
}

async function testInteractivePriorityAndExpiredQueueItemsNeverExecute() {
  const executedCommands = [];
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const lane = {
    id: "command-1",
    client: {
      connected: true,
      loggedIn: true,
      async connect() {},
      async execute(command) {
        executedCommands.push(command);
        if (command === "AdminBroadcast Block") await blocked;
        return "OK";
      },
    },
    busy: false, lastCommandTime: 0, lastUsedAt: 0, cooldownUntil: 0, failureCount: 0, lastError: "",
  };
  const { manager } = createHarness({ commandLanes: [lane] });
  const first = manager.dispatchCommand({ command: "AdminBroadcast Block", system: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const expired = await manager.dispatchCommand({ command: "AdminForceTeamChange Expired", system: true, priority: "interactive", maxQueueWaitMs: 20 });
  assert.equal(expired.success, false);
  assert.equal(expired.code, "RconQueueTimeout");
  release();
  await first;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(executedCommands.includes("AdminForceTeamChange Expired"), false);
}

async function testQueryCommandsUseQueryPool() {
  const commandExecuted = [];
  const queryExecuted = [];
  const { manager } = createHarness({
    commandLanes: [{
      id: "command-1",
      client: createFakeClient({ id: "command-1", executedCommands: commandExecuted }),
      busy: false,
      lastCommandTime: 0,
      lastUsedAt: 0,
      cooldownUntil: 0,
      failureCount: 0,
      lastError: "",
    }],
    queryLanes: [{
      id: "query-1",
      client: createFakeClient({ id: "query-1", executedCommands: queryExecuted }),
      busy: false,
      lastCommandTime: 0,
      lastUsedAt: 0,
      cooldownUntil: 0,
      failureCount: 0,
      lastError: "",
    }],
  });

  const result = await manager.dispatchCommand({ command: "ListPlayers", system: true });

  assert.equal(result.success, true);
  assert.equal(result.queueLane, "query-1");
  assert.deepEqual(queryExecuted.map((item) => item.command), ["ListPlayers"]);
  assert.deepEqual(commandExecuted, []);
}

async function testSharedClientDoesNotRunPoolsConcurrently() {
  const executedCommands = [];
  let releaseCommand;
  const commandBlocked = new Promise((resolve) => { releaseCommand = resolve; });
  const sharedClient = {
    connected: true,
    loggedIn: true,
    async connect() {},
    async execute(command) {
      executedCommands.push({ lane: "shared", command });
      if (command === "AdminBroadcast Slow") {
        await commandBlocked;
      }
      return "OK";
    },
  };
  const { manager } = createHarness();
  manager.squadRcon = sharedClient;
  manager.commandPool.lanes = [{
    id: "command-1",
    client: sharedClient,
    busy: false,
    lastCommandTime: 0,
    lastUsedAt: 0,
    cooldownUntil: 0,
    failureCount: 0,
    lastError: "",
  }];
  manager.queryPool.lanes = [{
    id: "query-1",
    client: sharedClient,
    busy: false,
    lastCommandTime: 0,
    lastUsedAt: 0,
    cooldownUntil: 0,
    failureCount: 0,
    lastError: "",
  }];

  const commandPromise = manager.dispatchCommand({ command: "AdminBroadcast Slow", system: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const queryPromise = manager.dispatchCommand({ command: "ListPlayers", system: true });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(executedCommands.map((item) => item.command), ["AdminBroadcast Slow"]);
  releaseCommand();
  const results = await Promise.all([commandPromise, queryPromise]);

  assert.equal(results.every((item) => item.success), true);
  assert.deepEqual(executedCommands.map((item) => item.command), ["AdminBroadcast Slow", "ListPlayers"]);
}

async function testLaneFailureDoesNotBlockOtherLane() {
  const executedCommands = [];
  const failingLane = {
    id: "command-1",
    client: createFakeClient({ id: "command-1", executedCommands, failCommands: new Set(["AdminBroadcast Fail"]) }),
    busy: false,
    lastCommandTime: 0,
    lastUsedAt: 0,
    cooldownUntil: 0,
    failureCount: 0,
    lastError: "",
  };
  const okLane = {
    id: "command-2",
    client: createFakeClient({ id: "command-2", executedCommands }),
    busy: false,
    lastCommandTime: 0,
    lastUsedAt: 0,
    cooldownUntil: 0,
    failureCount: 0,
    lastError: "",
  };
  const { manager } = createHarness({ commandLanes: [failingLane, okLane] });

  const [failed, ok] = await Promise.all([
    manager.dispatchCommand({ command: "AdminBroadcast Fail", system: true }),
    manager.dispatchCommand({ command: "AdminBroadcast OK", system: true }),
  ]);

  assert.equal(failed.success, false);
  assert.equal(ok.success, true);
  assert.equal(failingLane.failureCount, 1);
  assert.deepEqual(executedCommands.map((item) => item.lane), ["command-1", "command-2"]);
}

await testResolveRconPermissionAliases();
await testDefaultUsesSinglePhysicalConnection();
await testMultipleConnectionOptInUsesConfiguredPoolSize();
await testMultipleConnectionDefaultsToEightEnforcementWorkers();
await testEnforcementLaneDoesNotWaitForBlockedNotification();
await testDispatchCommandRejectsMissingPermission();
await testDispatchCommandAllowsMatchingPermission();
await testDispatchCommandAllowsSystemBypass();
await testDispatchCommandRejectsUnknownManualCommandForAdmin();
await testBypassRateLimitSkipsInterval();
await testCommandPoolUsesMultipleReadyLanes();
await testLowVolumeRotatesAwayFromRecentlyUsedLane();
await testAllLanesCoolingWaitsForShortestDelay();
await testPriorityRunsBeforeNormalButUsesCooldown();
await testInteractivePriorityAndExpiredQueueItemsNeverExecute();
await testQueryCommandsUseQueryPool();
await testSharedClientDoesNotRunPoolsConcurrently();
await testLaneFailureDoesNotBlockOtherLane();
await testDynamicPollingIntervalsFollowLogClock();
await testSchedulePollingRecomputesNextDelay();
await testRefreshPlayersSkipsWhenAlreadyInFlight();
await testStartPollingIsIdempotent();
await testDisbandLaneDoesNotWaitForBlockedDefaultCommand();

console.log("rcon manager tests passed");
