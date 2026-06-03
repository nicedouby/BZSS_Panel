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
  assert.equal(commands[0].requiredPermission, "rcon.tb");
  assert.match(result.command, /76561198377609640/);
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
await testForceTeamChangeRejectsMissingSteamId();
await testHandleTbRoutesSupportsNewAndLegacyPaths();
await testHandleTbRoutesUnauthorizedAndForbidden();

console.log("team balance tests passed");
