import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { WebServer } from "../core/web-server.js";
import { GroupReportService } from "../plugins/group-report.service.js";

function createServer(overrides = {}) {
  return new WebServer({
    config: {
      enabled: false,
      ...overrides.config,
    },
    logger: {
      info() {},
      warn() {},
      error() {},
      ...overrides.logger,
    },
    core: {
      pluginManager: {
        instances: [],
      },
      ...overrides.core,
    },
    modules: overrides.modules ?? {},
  });
}

function createRecorder() {
  const state = {
    status: null,
    headers: null,
    body: null,
  };

  return {
    state,
    res: {
      writeHead(status, headers) {
        state.status = status;
        state.headers = headers;
      },
      end(body) {
        state.body = Buffer.isBuffer(body) ? body.toString("utf8") : String(body ?? "");
      },
    },
  };
}

async function testReadJsonBodyParsesValidPayload() {
  const server = createServer();
  const body = await server.readJsonBody(Readable.from(['{"name":"BZSS","count":2}']));
  assert.deepEqual(body, { name: "BZSS", count: 2 });
}

async function testReadJsonBodyRejectsInvalidJson() {
  const server = createServer();

  await assert.rejects(
    () => server.readJsonBody(Readable.from(['{"name":"BZSS"'])),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, "InvalidJson");
      assert.equal(error.message, "Request body must be valid JSON.");
      return true;
    },
  );
}

async function testReadJsonBodyRejectsOversizedPayload() {
  const server = createServer();
  const tooLargeChunk = Buffer.alloc(1024 * 1024 + 1, "a");

  await assert.rejects(
    () => server.readJsonBody(Readable.from([tooLargeChunk])),
    (error) => {
      assert.equal(error.statusCode, 413);
      assert.equal(error.code, "RequestBodyTooLarge");
      assert.equal(error.message, "Request body too large.");
      return true;
    },
  );
}

async function testGetPluginApiReturnsMatchingPluginApi() {
  const targetApi = { getWeaponStats() { return []; } };
  const server = createServer({
    core: {
      pluginManager: {
        instances: [
          {
            manifest: { id: "plugin.other" },
            api: { noop() {} },
          },
          {
            manifest: { id: "plugin.weaponCollector" },
            api: targetApi,
          },
        ],
      },
    },
  });

  assert.equal(server.getPluginApi("plugin.weaponCollector"), targetApi);
  assert.equal(server.getPluginApi("plugin.missing"), null);
}

async function testHealthEndpointDoesNotRequireAuth() {
  const server = createServer({
    config: {
      host: "127.0.0.1",
      port: 7799,
      staticDirectory: "./web-client/dist",
    },
    core: {
      rconManager: {
        getStatus() {
          return { enabled: true, connected: false };
        },
      },
      runtimeState: {},
    },
  });

  const health = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/health",
    headers: { host: "localhost" },
    socket: {},
  }, health.res);

  assert.equal(health.state.status, 200);
  const body = JSON.parse(health.state.body);
  assert.equal(body.ok, true);
  assert.equal(body.service, "BZSS Panel WebServer");
  assert.equal(body.runtimeState, true);
  assert.equal(body.auth.enabled, true);
}

async function testCombatCleanRoutesDoNotForceCurrentServerFilter() {
  const calls = [];
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "viewer", role: "Operator" };
        },
        hasEverything() {
          return false;
        },
      },
      webStatus: {
        serverId: "CurrentServer",
      },
    },
    modules: {
      combatClean: {
        getEvents(args) {
          calls.push({ route: "events", args });
          return [{ id: "evt-1" }];
        },
        getOverview(serverId) {
          calls.push({ route: "overview", serverId });
          return { count: 1, serverId };
        },
      },
    },
  });

  const clean = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/combat-clean/events",
    headers: { host: "localhost" },
    socket: {},
  }, clean.res);
  assert.equal(clean.state.status, 200);
  const cleanBody = JSON.parse(clean.state.body);
  assert.equal(cleanBody.events[0].id, "evt-1");
  assert.equal(calls[0].args.serverId, "");
  assert.equal(calls[1].serverId, "");

  const query = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/query/combat-clean",
    headers: { host: "localhost" },
    socket: {},
  }, query.res);
  assert.equal(query.state.status, 200);
  const queryBody = JSON.parse(query.state.body);
  assert.equal(queryBody.events[0].id, "evt-1");
  assert.equal(calls[2].args.serverId, "");
  assert.equal(calls[3].serverId, "");
}

async function testWeaponCollectorApiRequiresGet() {
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return {
            username: "admin",
            role: "admin",
            permissions: ["plugins.manage"],
          };
        },
        hasEverything() {
          return true;
        },
      },
      webStatus: {
        serverId: "BZSS_Main",
      },
      pluginManager: {
        instances: [
          {
            manifest: { id: "plugin.weaponCollector" },
            api: {
              getWeaponStats() {
                return [{ damaged: 1, wounded: 2, died: 3 }];
              },
              getWeaponTypeMap() {
                return { C7A2: "C7A2" };
              },
            },
          },
        ],
      },
    },
  });

  const statsGet = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/weapon-collector/stats?serverId=BZSS_Main",
    headers: { host: "localhost" },
    socket: {},
  }, statsGet.res);
  assert.equal(statsGet.state.status, 200);
  assert.equal(JSON.parse(statsGet.state.body).totals.damaged, 1);

  const statsPost = createRecorder();
  await server.handleRequest({
    method: "POST",
    url: "/api/weapon-collector/stats?serverId=BZSS_Main",
    headers: { host: "localhost" },
    socket: {},
  }, statsPost.res);
  assert.equal(statsPost.state.status, 404);
  assert.equal(JSON.parse(statsPost.state.body).error, "ApiNotFound");

  const typeMapGet = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/weapon-collector/type-map",
    headers: { host: "localhost" },
    socket: {},
  }, typeMapGet.res);
  assert.equal(typeMapGet.state.status, 200);
  assert.equal(JSON.parse(typeMapGet.state.body).weaponTypeMap.C7A2, "C7A2");

  const typeMapPost = createRecorder();
  await server.handleRequest({
    method: "POST",
    url: "/api/weapon-collector/type-map",
    headers: { host: "localhost" },
    socket: {},
  }, typeMapPost.res);
  assert.equal(typeMapPost.state.status, 404);
  assert.equal(JSON.parse(typeMapPost.state.body).error, "ApiNotFound");
}

async function testGroupReportSnapshotRouteReturnsWrappedSnapshot() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-group-report-web-"));
  try {
    const service = new GroupReportService({ dataDir: tempDir });
    await service.init();
    const group = await service.createGroup({ name: "Test Group" });
    await service.addMember(group.id, {
      name: "Alice",
      eosId: "eos-123",
      steamId: "steam-123",
    });

    const server = createServer({
      core: {
        authManager: {
          getUserFromRequest() {
            return { username: "admin", role: "SuperAdmin" };
          },
          hasEverything() {
            return true;
          },
        },
        pluginManager: {
          instances: [
            {
              manifest: { id: "group-report" },
              api: {
                getSnapshot() {
                  return service.getSnapshot();
                },
                getGroups() {
                  return service.getGroups();
                },
                getGroup(groupId) {
                  return service.getGroup(groupId);
                },
                createGroup(input) {
                  return service.createGroup(input);
                },
                updateGroup(groupId, input) {
                  return service.updateGroup(groupId, input);
                },
                deleteGroup(groupId) {
                  return service.deleteGroup(groupId);
                },
                addMember(groupId, input) {
                  return service.addMember(groupId, input);
                },
                updateMember(groupId, playerKey, input) {
                  return service.updateMember(groupId, playerKey, input);
                },
                removeMember(groupId, playerKey) {
                  return service.removeMember(groupId, playerKey);
                },
              },
            },
          ],
        },
      },
    });

    const recorder = createRecorder();
    await server.handleRequest({
      method: "GET",
      url: "/api/plugins/group-report/snapshot",
      headers: { host: "localhost" },
      socket: {},
    }, recorder.res);

    assert.equal(recorder.state.status, 200);
    const body = JSON.parse(recorder.state.body);
    assert.equal(body.ok, true);
    assert.equal(body.data.plugin, "group-report");
    assert.equal(body.data.groups[0].members[0].playerKey, "eos:eos-123");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testSnapshotAllRequiresAuth() {
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return null;
        },
      },
    },
  });

  const recorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/snapshot/all",
    headers: { host: "localhost" },
    socket: {},
  }, recorder.res);

  assert.equal(recorder.state.status, 401);
  assert.equal(JSON.parse(recorder.state.body).error, "Unauthorized");
}

async function testSnapshotAllDoesNotTriggerSlowTasks() {
  let getAllCalls = 0;
  let slowTaskCalls = 0;
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "admin" };
        },
      },
      runtimeState: {
        getAll() {
          getAllCalls += 1;
          return { ok: true, players: { active: [] } };
        },
      },
    },
    modules: {
      playtime: {
        refreshOnline() {
          slowTaskCalls += 1;
        },
      },
    },
  });

  const recorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/snapshot/all",
    headers: { host: "localhost" },
    socket: {},
  }, recorder.res);

  assert.equal(recorder.state.status, 200);
  assert.equal(getAllCalls, 1);
  assert.equal(slowTaskCalls, 0);
  assert.equal(JSON.parse(recorder.state.body).ok, true);
}

async function testMatchRefreshRoutesDelegateToMatchState() {
  const refreshCalls = [];
  const matchState = {
    getState() {
      return {
        serverStatus: {
          map: "AlBasrah",
          lastUpdatedAt: "2026-05-12T00:00:00.000Z",
        },
        players: {
          list: [{ playerID: 1, name: "Alice" }],
          lastUpdatedAt: "2026-05-12T00:00:00.000Z",
        },
        squads: {
          list: [{ key: "1:2", teamID: 1, squadID: 2, squadName: "Alpha" }],
          lastUpdatedAt: "2026-05-12T00:00:00.000Z",
        },
        rconStatus: {
          status: "connected",
          lastError: "",
        },
        logAccess: {
          granted: true,
        },
      };
    },
    getOverview() {
      return {
        status: { rcon: "connected" },
        matchState: this.getState(),
      };
    },
    async refresh(type) {
      refreshCalls.push(type);
      return this.getState();
    },
  };

  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "admin", role: "SuperAdmin" };
        },
        hasEverything() {
          return true;
        },
      },
      rconManager: {
        refreshPlayers() {
          throw new Error("legacy refresh should not be called");
        },
        refreshSquads() {
          throw new Error("legacy refresh should not be called");
        },
      },
    },
    modules: {
      matchState,
    },
  });

  const response = createRecorder();
  const refreshReq = Readable.from([JSON.stringify({ type: "all" })]);
  refreshReq.method = "POST";
  refreshReq.url = "/api/match/refresh";
  refreshReq.headers = { host: "localhost" };
  refreshReq.socket = {};
  await server.handleRequest(refreshReq, response.res);

  assert.equal(response.state.status, 200);
  const body = JSON.parse(response.state.body);
  assert.equal(body.ok, true);
  assert.equal(body.source, "module.matchState");
  assert.equal(body.type, "all");
  assert.equal(body.matchState.serverStatus.map, "AlBasrah");
  assert.equal(refreshCalls[0], "all");

  const legacy = createRecorder();
  const legacyReq = Readable.from([JSON.stringify({ type: "players" })]);
  legacyReq.method = "POST";
  legacyReq.url = "/api/rcon/refresh?type=players";
  legacyReq.headers = { host: "localhost" };
  legacyReq.socket = {};
  await server.handleRequest(legacyReq, legacy.res);

  assert.equal(legacy.state.status, 200);
  const legacyBody = JSON.parse(legacy.state.body);
  assert.equal(legacyBody.source, "module.matchState");
  assert.equal(legacyBody.type, "players");
  assert.equal(refreshCalls[1], "players");
}

async function testSquadLifecycleRouteReturnsCurrentSnapshot() {
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "admin", role: "Operator" };
        },
      },
    },
    modules: {
      squadLifecycle: {
        getCurrent(serverId) {
          return {
            serverId,
            matchId: "session-1",
            updatedAt: "2026-05-13T12:31:42.000Z",
            list: [
              {
                key: "BZSS_Main:session-1:T1:S1",
                teamId: 1,
                squadId: 1,
                squadName: "Alpha",
                createdAt: "2026-05-13T12:31:42.000Z",
                createdAtMs: 1778675502000,
                createdAtLabel: "20:31:42",
                createdDisplayText: "\u521b\u5efa\u4e8e 20:31:42",
                creationSource: "LOG",
                creationConfidence: "HIGH",
                sourceLabel: "\u65e5\u5fd7\u786e\u8ba4",
              },
            ],
            byKey: {},
          };
        },
      },
    },
  });

  const recorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/squad-lifecycle/current?serverId=BZSS_Main",
    headers: { host: "localhost" },
    socket: {},
  }, recorder.res);

  assert.equal(recorder.state.status, 200);
  const body = JSON.parse(recorder.state.body);
  assert.equal(body.current.serverId, "BZSS_Main");
  assert.equal(body.current.list[0].creationSource, "LOG");
}

async function testSquadManagementRoutesExposeStateAndMutations() {
  const state = {
    disbandPermission: "squad.disband",
    kickPermission: "squad.kick",
    squads: [],
    creators: [],
    summary: {
      currentSquads: 0,
      violations: 0,
      creators: 0,
      trackedCreations: 0,
    },
  };
  const calls = [];

  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest(req) {
          if (req.headers.authorization === "super") {
            return {
              username: "admin",
              role: "SuperAdmin",
              isSuperAdmin: true,
              permissions: ["*"],
            };
          }
          if (req.headers.authorization === "user") {
            return {
              username: "viewer",
              role: "Operator",
              permissions: [],
            };
          }
          return null;
        },
        hasEverything(user) {
          return Boolean(user?.isSuperAdmin);
        },
        hasPermission(user, permission) {
          if (!user) return false;
          if (user.isSuperAdmin) return true;
          const permissions = Array.isArray(user.permissions) ? user.permissions : [];
          return permissions.includes("*") || permissions.includes(permission);
        },
      },
    },
    modules: {
      squadManagement: {
        getState() {
          return state;
        },
        async disband(input) {
          calls.push({ type: "disband", input });
          if (!input.actor?.isSuperAdmin && !Array.isArray(input.actor?.permissions)) {
            return {
              ok: false,
              error: "Forbidden",
              message: "Permission 'squad.disband' is required.",
            };
          }
          if (!input.actor?.isSuperAdmin && !input.actor.permissions.includes("squad.disband") && !input.actor.permissions.includes("*")) {
            return {
              ok: false,
              error: "Forbidden",
              message: "Permission 'squad.disband' is required.",
            };
          }
          return {
            ok: true,
            action: "manual-disband",
            source: "manual",
            system: false,
            target: {
              teamId: input.teamId,
              squadId: input.squadId,
            },
            reason: input.reason ?? "",
            time: "2026-05-13T20:00:00.000Z",
          };
        },
        async kick(input) {
          calls.push({ type: "kick", input });
          if (!input.actor?.isSuperAdmin && !Array.isArray(input.actor?.permissions)) {
            return {
              ok: false,
              error: "Forbidden",
              message: "Permission 'squad.kick' is required.",
            };
          }
          if (!input.actor?.isSuperAdmin && !input.actor.permissions.includes("squad.kick") && !input.actor.permissions.includes("*")) {
            return {
              ok: false,
              error: "Forbidden",
              message: "Permission 'squad.kick' is required.",
            };
          }
          return {
            ok: true,
            action: "manual-kick",
            source: "manual",
            system: false,
            target: {
              anyId: input.anyId,
              creatorKey: input.creatorKey,
            },
            reason: input.reason ?? "",
            time: "2026-05-13T20:00:00.000Z",
          };
        },
      },
    },
  });

  const unauthorizedState = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/squad-management/state",
    headers: { host: "localhost" },
    socket: {},
  }, unauthorizedState.res);
  assert.equal(unauthorizedState.state.status, 401);

  const stateRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/squad-management/state",
    headers: { host: "localhost", authorization: "user" },
    socket: {},
  }, stateRecorder.res);
  assert.equal(stateRecorder.state.status, 200);
  const stateBody = JSON.parse(stateRecorder.state.body);
  assert.equal(stateBody.ok, true);
  assert.equal(stateBody.viewer.canDisband, false);
  assert.equal(stateBody.viewer.canKick, false);

  const disbandRecorder = createRecorder();
  const disbandReq = Readable.from([JSON.stringify({ teamId: 1, squadId: 9, reason: "test" })]);
  disbandReq.method = "POST";
  disbandReq.url = "/api/squad-management/disband";
  disbandReq.headers = { host: "localhost", authorization: "super" };
  disbandReq.socket = {};
  await server.handleRequest(disbandReq, disbandRecorder.res);
  assert.equal(disbandRecorder.state.status, 200);
  assert.equal(JSON.parse(disbandRecorder.state.body).result.ok, true);

  const kickRecorder = createRecorder();
  const kickReq = Readable.from([JSON.stringify({ anyId: "76561198000001234", reason: "test" })]);
  kickReq.method = "POST";
  kickReq.url = "/api/squad-management/kick";
  kickReq.headers = { host: "localhost", authorization: "user" };
  kickReq.socket = {};
  await server.handleRequest(kickReq, kickRecorder.res);
  assert.equal(kickRecorder.state.status, 403);
  assert.equal(JSON.parse(kickRecorder.state.body).result.error, "Forbidden");

  assert.equal(calls[0].type, "disband");
  assert.equal(calls[1].type, "kick");
}

async function testSettingsRoutesRequireAuthAndSuperAdmin() {
  const settingsResponse = {
    enabled: true,
    settings: [
      {
        path: "web.port",
        label: "Web Port",
        type: "number",
        min: 1,
        max: 65535,
        restartRequired: true,
        value: 7799,
      },
    ],
  };
  let updateCalls = 0;
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest(req) {
          if (req.headers.authorization === "super") {
            return { username: "admin", role: "SuperAdmin" };
          }
          if (req.headers.authorization === "user") {
            return { username: "viewer", role: "Operator" };
          }
          return null;
        },
        hasEverything(user) {
          return String(user?.role ?? "").toLowerCase().includes("superadmin");
        },
      },
      config: {
        getExposedSettings() {
          return settingsResponse;
        },
        async updateExposedSettings(changes) {
          updateCalls += 1;
          return {
            ...settingsResponse,
            settings: settingsResponse.settings.map((item) => (
              item.path in changes ? { ...item, value: changes[item.path] } : item
            )),
            restartRequired: true,
          };
        },
      },
    },
  });

  const unauthGet = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/settings/exposed",
    headers: { host: "localhost" },
    socket: {},
  }, unauthGet.res);
  assert.equal(unauthGet.state.status, 401);

  const authGet = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/settings/exposed",
    headers: { host: "localhost", authorization: "user" },
    socket: {},
  }, authGet.res);
  assert.equal(authGet.state.status, 200);
  assert.equal(JSON.parse(authGet.state.body).settings[0].path, "web.port");

  const forbiddenPatch = createRecorder();
  await server.handleRequest({
    method: "PATCH",
    url: "/api/settings/exposed",
    headers: { host: "localhost", authorization: "user" },
    socket: {},
  }, forbiddenPatch.res);
  assert.equal(forbiddenPatch.state.status, 403);

  const patchMissingBody = createRecorder();
  const emptyPatchReq = Readable.from([]);
  emptyPatchReq.method = "PATCH";
  emptyPatchReq.url = "/api/settings/exposed";
  emptyPatchReq.headers = { host: "localhost", authorization: "super" };
  emptyPatchReq.socket = {};
  await server.handleRequest(emptyPatchReq, patchMissingBody.res);
  assert.equal(patchMissingBody.state.status, 400);

  const successfulPatch = createRecorder();
  const patchReq = Readable.from([JSON.stringify({ changes: { "web.port": 7800 } })]);
  patchReq.method = "PATCH";
  patchReq.url = "/api/settings/exposed";
  patchReq.headers = { host: "localhost", authorization: "super" };
  patchReq.socket = {};
  await server.handleRequest(patchReq, successfulPatch.res);
  assert.equal(successfulPatch.state.status, 200);
  assert.equal(JSON.parse(successfulPatch.state.body).restartRequired, true);
  assert.equal(updateCalls, 1);
}

async function testWarmupRoutesExposeStateAndValidateInput() {
  let updateCalls = 0;
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest(req) {
          if (req.headers.authorization === "user") {
            return { username: "viewer", role: "Operator" };
          }
          if (req.headers.authorization === "super") {
            return { username: "admin", role: "SuperAdmin" };
          }
          return null;
        },
        hasEverything(user) {
          return String(user?.role ?? "").toLowerCase().includes("superadmin");
        },
      },
      webStatus: {
        getWarmupState() {
          return {
            isWarmup: false,
            updatedAt: null,
            updatedBy: null,
          };
        },
        async setWarmup(isWarmup) {
          updateCalls += 1;
          return {
            isWarmup,
            updatedAt: "2026-05-16T06:20:00.000Z",
            updatedBy: null,
          };
        },
      },
    },
  });

  const unauthorizedGet = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/server/warmup",
    headers: { host: "localhost" },
    socket: {},
  }, unauthorizedGet.res);
  assert.equal(unauthorizedGet.state.status, 401);

  const authGet = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/server/warmup",
    headers: { host: "localhost", authorization: "user" },
    socket: {},
  }, authGet.res);
  assert.equal(authGet.state.status, 200);
  assert.equal(JSON.parse(authGet.state.body).isWarmup, false);

  const invalidPatch = createRecorder();
  const invalidReq = Readable.from([JSON.stringify({ isWarmup: "true" })]);
  invalidReq.method = "POST";
  invalidReq.url = "/api/server/warmup";
  invalidReq.headers = { host: "localhost", authorization: "super" };
  invalidReq.socket = {};
  await server.handleRequest(invalidReq, invalidPatch.res);
  assert.equal(invalidPatch.state.status, 400);

  const patchRecorder = createRecorder();
  const patchReq = Readable.from([JSON.stringify({ isWarmup: true })]);
  patchReq.method = "POST";
  patchReq.url = "/api/server/warmup";
  patchReq.headers = { host: "localhost", authorization: "super" };
  patchReq.socket = {};
  await server.handleRequest(patchReq, patchRecorder.res);
  assert.equal(patchRecorder.state.status, 200);
  const body = JSON.parse(patchRecorder.state.body);
  assert.equal(body.isWarmup, true);
  assert.equal(body.updatedAt, "2026-05-16T06:20:00.000Z");
  assert.equal(updateCalls, 1);
}

async function testAdminWarnRecentRouteReturnsMemoryRecords() {
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "admin", role: "SuperAdmin" };
        },
        hasEverything() {
          return true;
        },
      },
    },
    modules: {
      adminWarn: {
        getRecent(filter) {
          assert.equal(filter.sourceModule, "damage_display");
          return [{
            id: "warn-1",
            createdAt: 1710000000000,
            sourceModule: "damage_display",
            reason: "victim_damage",
            targetName: "PlayerB",
            message: "hello",
            success: true,
            skipped: false,
          }];
        },
        getConfig() {
          return { maxRecords: 3000, ttlMs: 1800000 };
        },
      },
    },
  });

  const recorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/admin-warns/recent?sourceModule=damage_display&limit=10",
    headers: { host: "localhost" },
    socket: {},
  }, recorder.res);

  assert.equal(recorder.state.status, 200);
  const body = JSON.parse(recorder.state.body);
  assert.equal(body.records.length, 1);
  assert.equal(body.records[0].targetName, "PlayerB");
  assert.equal(body.config.maxRecords, 3000);
}

async function testVueRouteFallsBackToIndexHtml() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-web-"));
  await fs.writeFile(path.join(tempDir, "index.html"), "<html><body>vue-app</body></html>", "utf8");
  await fs.writeFile(path.join(tempDir, "assets.txt"), "asset", "utf8");

  const server = createServer({
    config: {
      useVueClient: true,
    },
  });
  server.staticDirectory = tempDir;

  const routeRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/match-status",
    headers: { host: "localhost" },
    socket: {},
  }, routeRecorder.res);

  assert.equal(routeRecorder.state.status, 200);
  assert.match(routeRecorder.state.body, /vue-app/);

  const assetRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/assets.txt",
    headers: { host: "localhost" },
    socket: {},
  }, assetRecorder.res);

  assert.equal(assetRecorder.state.status, 200);
  assert.equal(assetRecorder.state.body, "asset");

  await fs.rm(tempDir, { recursive: true, force: true });
}

await testReadJsonBodyParsesValidPayload();
await testReadJsonBodyRejectsInvalidJson();
await testReadJsonBodyRejectsOversizedPayload();
await testGetPluginApiReturnsMatchingPluginApi();
await testHealthEndpointDoesNotRequireAuth();
await testCombatCleanRoutesDoNotForceCurrentServerFilter();
await testWeaponCollectorApiRequiresGet();
await testGroupReportSnapshotRouteReturnsWrappedSnapshot();
await testSnapshotAllRequiresAuth();
await testSnapshotAllDoesNotTriggerSlowTasks();
await testMatchRefreshRoutesDelegateToMatchState();
await testSquadLifecycleRouteReturnsCurrentSnapshot();
await testSquadManagementRoutesExposeStateAndMutations();
await testSettingsRoutesRequireAuthAndSuperAdmin();
await testWarmupRoutesExposeStateAndValidateInput();
await testAdminWarnRecentRouteReturnsMemoryRecords();
await testVueRouteFallsBackToIndexHtml();

console.log("web server tests passed");
