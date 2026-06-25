import assert from "node:assert/strict";

import { createTeamBalanceService } from "../modules/team-balance/service.js";
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
  assert.equal(result.command, 'AdminForceTeamChange "76561198377609640"');
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

async function testForceTeamChangeUsesPlayerIdWhenAvailable() {
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
    playerId: 42,
    steamId: "76561198377609641",
    playerName: "OperatorTarget",
    source: "match_state",
    reason: "match_state_button",
    operator: {
      id: "operator-1",
      name: "Operator",
      username: "Operator",
      isSuperAdmin: true,
      permissions: ["*"],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(commands[0].command, "AdminForceTeamChangeById 42");
}

async function testForceTeamChangePropagatesRconFailureMessage() {
  const commands = [];
  const service = createService({
    core: {
      logger: createNoopLogger(),
      rconManager: {
        async dispatchCommand(payload) {
          commands.push(payload);
          return {
            success: false,
            code: "RCON_FAILED",
            message: "Unknown command: AdminForceTeamChangeById",
            rconExecuted: false,
            rconResponse: "",
          };
        },
      },
    },
  });

  const result = await service.api.forceTeamChange({
    playerId: 42,
    steamId: "76561198377609641",
    playerName: "OperatorTarget",
    source: "fair_tb",
    reason: "fair_tb_chat",
    system: true,
    operator: {
      id: "system",
      name: "System",
      username: "System",
      isSuperAdmin: true,
      permissions: ["*"],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "RCON_FAILED");
  assert.equal(result.message, "Unknown command: AdminForceTeamChangeById");
  assert.equal(commands[0].system, true);
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
await testForceTeamChangeUsesPlayerIdWhenAvailable();
await testForceTeamChangePropagatesRconFailureMessage();
await testForceTeamChangeRejectsMissingSteamId();
await testHandleTbRoutesSupportsNewAndLegacyPaths();
await testHandleTbRoutesReturnsRecords();
await testHandleTbRoutesUnauthorizedAndForbidden();

console.log("team balance tests passed");
