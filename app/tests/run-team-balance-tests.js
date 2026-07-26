import assert from "node:assert/strict";

import { createTeamBalanceService } from "../modules/team-balance/service.js";
import { TeamBalanceBatchManager } from "../modules/team-balance/batch-manager.js";
import { handleTbRoutes } from "../modules/team-balance/tb-routes.js";

function createNoopLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
}

function createService(overrides = {}) {
  return createTeamBalanceService({
    modules: overrides.modules ?? {},
    core: {
      logger: createNoopLogger(),
      ...overrides.core,
    },
    config: overrides.config ?? {
      get() {
        return {
          enabled: true,
          switchPermission: "squad.switch",
        };
      },
    },
    logger: overrides.logger ?? createNoopLogger(),
  });
}

async function testForceTeamChangeSuccess() {
  const commands = [];
  const service = createService({
    core: {
      logger: createNoopLogger(),
      rconManager: {
        async dispatchCommand(payload) {
          commands.push(payload);
          return {
            success: true,
            rconExecuted: true,
            rconResponse: "OK",
            message: "OK",
          };
        },
      },
    },
  });

  const result = await service.api.forceTeamChange({
    steamId: "76561198377609640",
    playerName: "PlayerName",
    source: "match_state",
    reason: "match_state_button",
    operator: {
      id: "admin-1",
      name: "Admin",
      username: "Admin",
      isSuperAdmin: true,
      permissions: ["*"],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.rconExecuted, true);
  assert.equal(result.rconResponse, "OK");
  assert.equal(result.command, commands[0].command);
  assert.equal(commands[0].requiredPermission, "rcon.tb");
  assert.match(result.command, /76561198377609640/);

  const records = service.api.listForceTeamChangeRecords({ limit: 10 });
  assert.equal(records.length, 1);
  assert.equal(records[0].source, "match_state");
  assert.equal(records[0].executor, "Admin");
  assert.equal(records[0].steamId, "76561198377609640");
}

async function testForceTeamChangeAcceptsRconPermissionAlias() {
  const commands = [];
  const service = createService({
    core: {
      logger: createNoopLogger(),
      rconManager: {
        async dispatchCommand(payload) {
          commands.push(payload);
          return {
            success: true,
            rconExecuted: true,
            rconResponse: "OK",
            message: "OK",
          };
        },
      },
    },
  });

  const result = await service.api.forceTeamChange({
    steamId: "76561198377609641",
    playerName: "OperatorTarget",
    source: "match_state",
    reason: "match_state_button",
    operator: {
      id: "operator-1",
      name: "Operator",
      username: "Operator",
      isSuperAdmin: false,
      permissions: ["rcon.tb"],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].requiredPermission, "rcon.tb");
}

async function testForceTeamChangeRejectsMissingSteamId() {
  const service = createService();
  const result = await service.api.forceTeamChange({
    playerName: "PlayerName",
    operator: {
      id: "admin-1",
      name: "Admin",
      username: "Admin",
      isSuperAdmin: true,
      permissions: ["*"],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "MissingSteamId");
  assert.equal(result.message, "steamId is required.");
}

async function testCreatePlaytimeShufflePlanRecordsWithoutRcon() {
  let dispatchCalled = false;
  const service = createService({
    core: {
      logger: createNoopLogger(),
      rconManager: {
        async dispatchCommand() {
          dispatchCalled = true;
          return { success: true };
        },
      },
    },
  });

  const result = await service.api.createPlaytimeShufflePlan({
    source: "web.matchStatus.shufflePlan",
    reason: "match_status_playtime_shuffle_plan",
    operator: {
      id: "admin-1",
      name: "Admin",
      username: "Admin",
      isSuperAdmin: true,
      permissions: ["*"],
    },
    players: [
      { steamId: "steam-1", playerName: "Alpha", teamId: 1, playtimeSeconds: 36000 },
      { steamId: "steam-2", playerName: "Bravo", teamId: 1, playtimeSeconds: 7200 },
      { steamId: "steam-3", playerName: "Charlie", teamId: 2, playtimeSeconds: 32400 },
      { steamId: "steam-4", playerName: "Delta", teamId: 2, playtimeSeconds: 1800 },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, "playtime_shuffle_plan");
  assert.equal(result.rconExecuted, false);
  assert.equal(dispatchCalled, false);
  assert.equal(result.summary.plannedMoveCount, 2);
  assert.equal(result.plan.moves.length, 2);

  const records = service.api.listForceTeamChangeRecords({ limit: 10 });
  assert.equal(records.length, 1);
  assert.equal(records[0].action, "playtime_shuffle_plan");
  assert.equal(records[0].summary.plannedMoveCount, 2);
}

async function testHandleTbRoutesSupportsNewAndLegacyPaths() {
  const calls = [];
  const modules = {
    teamBalance: {
      async forceTeamChange(payload) {
        calls.push(payload);
        return {
          ok: true,
          error: "",
          message: "Team switch requested.",
          command: "generated-command",
          rconExecuted: true,
          rconResponse: "OK",
        };
      },
    },
  };

  for (const pathname of ["/api/tb/force-team-change", "/api/team-balance/switch"]) {
    const recorder = createRecorder();
    await handleTbRoutes({
      modules,
      url: new URL(`http://localhost${pathname}`),
      req: {
        method: "POST",
      },
      user: {
        id: "admin-1",
        username: "Admin",
        role: "SuperAdmin",
        isSuperAdmin: true,
        permissions: ["*"],
      },
      readJsonBody: async () => ({
        steamId: "76561198377609640",
        playerName: "PlayerName",
        source: "match_state",
        reason: "match_state_button",
      }),
      json(status, body) {
        recorder.status = status;
        recorder.body = body;
      },
    });

    assert.equal(recorder.status, 200);
    assert.equal(recorder.body.ok, true);
    assert.equal(calls.pop().steamId, "76561198377609640");
  }
}

async function testHandleTbRoutesReturnsRecords() {
  const modules = {
    teamBalance: {
      async listForceTeamChangeRecords() {
        return [{
          id: "record-1",
          timestamp: "2026-06-03T00:00:00.000Z",
          ok: true,
          steamId: "76561198377609640",
          playerName: "PlayerName",
          source: "web.tb",
          reason: "manual_tb_page",
          executor: "Admin",
          error: "",
          action: "force_team_change",
        }];
      },
    },
  };

  const recorder = createRecorder();
  await handleTbRoutes({
    modules,
    url: new URL("http://localhost/api/tb/records?limit=5"),
    req: { method: "GET" },
    user: {
      id: "admin-1",
      username: "Admin",
      role: "SuperAdmin",
      isSuperAdmin: true,
      permissions: ["*"],
    },
    readJsonBody: async () => ({}),
    json(status, body) {
      recorder.status = status;
      recorder.body = body;
    },
  });

  assert.equal(recorder.status, 200);
  assert.equal(recorder.body.ok, true);
  assert.equal(recorder.body.records[0].source, "web.tb");
  assert.equal(recorder.body.records[0].executor, "Admin");
}

async function testHandleTbRoutesCreatesShufflePlan() {
  const calls = [];
  const modules = {
    teamBalance: {
      async createPlaytimeShufflePlan(payload) {
        calls.push(payload);
        return {
          ok: true,
          type: "playtime_shuffle_plan",
          action: "playtime_shuffle_plan",
          error: "",
          message: "Playtime-balanced shuffle plan recorded. No team switch executed.",
          command: "",
          rconExecuted: false,
          rconResponse: "",
          summary: {
            totalPlayers: 4,
            plannedMoveCount: 2,
            knownPlaytimePlayers: 4,
            unknownPlaytimePlayers: 0,
            averageDeltaHours: 0.1,
          },
          plan: {
            generatedAt: "2026-06-10T00:00:00.000Z",
            mode: "playtime_balanced_shuffle",
            moves: [],
          },
        };
      },
    },
  };

  const recorder = createRecorder();
  await handleTbRoutes({
    modules,
    url: new URL("http://localhost/api/tb/shuffle-plan"),
    req: { method: "POST" },
    user: {
      id: "admin-1",
      username: "Admin",
      role: "SuperAdmin",
      isSuperAdmin: true,
      permissions: ["*"],
    },
    readJsonBody: async () => ({
      players: [
        { steamId: "steam-1", playerName: "Alpha", teamId: 1, playtimeSeconds: 36000 },
        { steamId: "steam-2", playerName: "Bravo", teamId: 2, playtimeSeconds: 32400 },
      ],
    }),
    json(status, body) {
      recorder.status = status;
      recorder.body = body;
    },
  });

  assert.equal(recorder.status, 200);
  assert.equal(recorder.body.action, "playtime_shuffle_plan");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].source, "web.matchStatus.shufflePlan");
}

async function testHandleTbRoutesUnauthorizedAndForbidden() {
  const modules = {
    teamBalance: {
      async forceTeamChange() {
        return {
          ok: false,
          error: "Forbidden",
          message: "Permission 'squad.switch' is required.",
          command: "",
          rconExecuted: false,
          rconResponse: "",
        };
      },
    },
  };

  const unauthorized = createRecorder();
  await handleTbRoutes({
    modules,
    url: new URL("http://localhost/api/tb/force-team-change"),
    req: { method: "POST" },
    user: null,
    readJsonBody: async () => ({}),
    json(status, body) {
      unauthorized.status = status;
      unauthorized.body = body;
    },
  });

  assert.equal(unauthorized.status, 401);

  const forbidden = createRecorder();
  await handleTbRoutes({
    modules,
    url: new URL("http://localhost/api/tb/force-team-change"),
    req: { method: "POST" },
    user: {
      id: "viewer-1",
      username: "viewer",
      role: "Operator",
      permissions: [],
    },
    readJsonBody: async () => ({
      steamId: "76561198377609640",
      playerName: "PlayerName",
    }),
    json(status, body) {
      forbidden.status = status;
      forbidden.body = body;
    },
  });

  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error, "Forbidden");
}

function createRecorder() {
  return {
    status: null,
    body: null,
  };
}

await testForceTeamChangeSuccess();
await testForceTeamChangeAcceptsRconPermissionAlias();
await testForceTeamChangeRejectsMissingSteamId();
await testCreatePlaytimeShufflePlanRecordsWithoutRcon();
await testHandleTbRoutesSupportsNewAndLegacyPaths();
await testHandleTbRoutesReturnsRecords();
await testHandleTbRoutesCreatesShufflePlan();
await testHandleTbRoutesUnauthorizedAndForbidden();


async function testBatchManagerSerializesItemsAndIsIdempotent() {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const manager = new TeamBalanceBatchManager({
    resolveCurrentPlayer: async (player) => ({ teamID: player.fromTeamId }),
    executeOnePlayer: async (player) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls.push(player.steamId);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return { ok: true, message: "OK", command: `AdminForceTeamChange "${player.steamId}"` };
    },
  });

  const request = {
    clientRequestId: "batch-test-idempotency",
    players: [
      { steamId: "steam-1", playerName: "One", fromTeamId: 1, targetTeamId: 2 },
      { steamId: "steam-2", playerName: "Two", fromTeamId: 1, targetTeamId: 2 },
      { steamId: "steam-2", playerName: "Two duplicate", fromTeamId: 1, targetTeamId: 2 },
    ],
  };
  const first = manager.create(request);
  const second = manager.create(request);

  assert.equal(first.ok, true);
  assert.equal(first.batch.total, 2);
  assert.equal(second.duplicate, true);
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(calls, ["steam-1", "steam-2"]);
  assert.equal(maxActive, 1);
  assert.equal(manager.get(first.batch.id).status, "completed");
}

async function testBatchManagerSkipsStateAndDoesNotRetryTimeout() {
  const calls = [];
  const manager = new TeamBalanceBatchManager({
    resolveCurrentPlayer: async (player) => {
      if (player.steamId === "offline") return null;
      if (player.steamId === "already") return { teamID: 2 };
      return { teamID: 1 };
    },
    executeOnePlayer: async (player) => {
      calls.push(player.steamId);
      return { ok: false, message: "RCON timeout", error: "ETIMEDOUT" };
    },
  });

  const created = manager.create({
    clientRequestId: "batch-timeout",
    players: [
      { steamId: "offline", fromTeamId: 1, targetTeamId: 2 },
      { steamId: "already", fromTeamId: 1, targetTeamId: 2 },
      { steamId: "timeout", fromTeamId: 1, targetTeamId: 2 },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const batch = manager.get(created.batch.id);
  assert.deepEqual(calls, ["timeout"]);
  assert.deepEqual(batch.results.map((result) => result.status), [
    "skipped_offline",
    "already_applied",
    "unknown_result",
  ]);
  assert.equal(batch.failed, 1);
}

async function testBatchManagerCancellationStopsRemainingItems() {
  const calls = [];
  const manager = new TeamBalanceBatchManager({
    resolveCurrentPlayer: async (player) => ({ teamID: player.fromTeamId }),
    executeOnePlayer: async (player) => {
      calls.push(player.steamId);
      await new Promise((resolve) => setImmediate(resolve));
      return { ok: true };
    },
  });
  const created = manager.create({
    clientRequestId: "batch-cancel",
    players: [
      { steamId: "cancel-1", fromTeamId: 1, targetTeamId: 2 },
      { steamId: "cancel-2", fromTeamId: 1, targetTeamId: 2 },
      { steamId: "cancel-3", fromTeamId: 1, targetTeamId: 2 },
    ],
  });
  manager.cancel(created.batch.id);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const batch = manager.get(created.batch.id);
  assert.equal(batch.status, "cancelled");
  assert.equal(calls.length, 0);
  assert.equal(batch.results.every((result) => result.status === "cancelled"), true);
}

async function testBatchRouteReturnsAcceptedBeforeExecution() {
  let created = 0;
  const modules = {
    teamBalance: {
      createForceTeamChangeBatch(payload) {
        created += 1;
        return {
          ok: true,
          batch: {
            id: "tb-batch-test",
            status: "queued",
            total: payload.players.length,
            completed: 0,
            succeeded: 0,
            failed: 0,
            skipped: 0,
          },
        };
      },
    },
  };
  const recorder = createRecorder();
  await handleTbRoutes({
    modules,
    url: new URL("http://localhost/api/tb/force-team-change-batch"),
    req: { method: "POST" },
    user: {
      id: "admin-1",
      username: "Admin",
      role: "SuperAdmin",
      isSuperAdmin: true,
      permissions: ["*"],
    },
    readJsonBody: async () => ({
      clientRequestId: "route-batch",
      players: Array.from({ length: 16 }, (_, index) => ({
        steamId: `steam-${index}`,
        fromTeamId: 1,
        targetTeamId: 2,
      })),
    }),
    json(status, body) {
      recorder.status = status;
      recorder.body = body;
    },
  });

  assert.equal(created, 1);
  assert.equal(recorder.status, 202);
  assert.equal(recorder.body.batch.total, 16);
  assert.equal(recorder.body.batch.completed, 0);
}

console.log("team balance tests passed");
