import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { WebRegistry } from "../core/web-registry.js";
import { WebServer } from "../core/web-server.js";
import { classifySquadName } from "../core/squad-name-classifier.js";
import { GroupReportService } from "../plugins/group-report.service.js";
import { hasPermission as hasRconPermission } from "../web-client/src/shared/rcon-permissions.js";

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

async function testBzssCoreCreateVehicleAcceptsOptionalTeamId() {
  const server = createServer();

  assert.equal(
    server.normalizeBzssCoreDirective(
      "CreateVehicle",
      "Player,/Game/Vehicles/AUS_M1A1/BP_AUS_M1A1.BP_AUS_M1A1_C",
    ).command,
    "CreateVehicle:Player,/Game/Vehicles/AUS_M1A1/BP_AUS_M1A1.BP_AUS_M1A1_C",
  );
  assert.equal(
    server.normalizeBzssCoreDirective(
      "CreateVehicle",
      "Player,/Game/Vehicles/AUS_M1A1/BP_AUS_M1A1.BP_AUS_M1A1_C,0",
    ).command,
    "CreateVehicle:Player,/Game/Vehicles/AUS_M1A1/BP_AUS_M1A1.BP_AUS_M1A1_C,0",
  );
  assert.equal(
    server.normalizeBzssCoreDirective(
      "CreateVehicle",
      "Player,/Game/Vehicles/AUS_M1A1/BP_AUS_M1A1.BP_AUS_M1A1_C,2",
    ).command,
    "CreateVehicle:Player,/Game/Vehicles/AUS_M1A1/BP_AUS_M1A1.BP_AUS_M1A1_C,2",
  );

  const invalidDirective = server.normalizeBzssCoreDirective(
    "CreateVehicle",
    "Player,/Game/Vehicles/AUS_M1A1/BP_AUS_M1A1.BP_AUS_M1A1_C,3",
  );
  assert.equal(invalidDirective.ok, false);
  assert.equal(invalidDirective.error, "InvalidCreateVehicleTeamId");

  const invalidRaw = server.normalizeBzssCoreCommand({
    raw: true,
    command: "CreateVehicle:Player,/Game/Vehicles/AUS_M1A1/BP_AUS_M1A1.BP_AUS_M1A1_C,blue",
  });
  assert.equal(invalidRaw.ok, false);
  assert.equal(invalidRaw.error, "InvalidCreateVehicleTeamId");
}

async function testHealthEndpointDoesNotRequireAuth() {
  const server = createServer({
    config: {
      host: "127.0.0.1",
      port: 8899,
      staticDirectory: "./web-client/dist",
    },
    core: {
      authManager: {
        enabled: true,
      },
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

async function testAuthSessionAndLoginIncludeSteamAvatar() {
  const avatarUrl = "https://avatars.example/root.jpg";
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return {
            id: "user:root",
            username: "Root",
            role: "SuperAdmin",
            isSuperAdmin: true,
            steam64: "76561198194428818",
            viewerTeamAutoSwapEnabled: true,
            permissions: [],
          };
        },
        async login() {
          return {
            ok: true,
            cookie: "bzss_session=abc",
            user: {
              id: "user:root",
              username: "Root",
              role: "SuperAdmin",
              isSuperAdmin: true,
              steam64: "76561198194428818",
              viewerTeamAutoSwapEnabled: true,
              permissions: [],
            },
          };
        },
      },
    },
    modules: {
      playerDatabase: {
        async listPlayersBySteamIDs(steamIDs) {
          assert.deepEqual(steamIDs, ["76561198194428818"]);
          return [
            {
              steam_id: "76561198194428818",
              steam_avatar: avatarUrl,
            },
          ];
        },
      },
    },
  });

  const sessionRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/auth/session",
    headers: { host: "localhost" },
    socket: {},
  }, sessionRecorder.res);

  assert.equal(sessionRecorder.state.status, 200);
  const sessionBody = JSON.parse(sessionRecorder.state.body);
  assert.equal(sessionBody.user.steamAvatar, avatarUrl);

  const loginRecorder = createRecorder();
  const loginReq = Readable.from(['{"username":"Root","password":"Secret123"}']);
  loginReq.method = "POST";
  loginReq.url = "/api/auth/login";
  loginReq.headers = { host: "localhost", "content-type": "application/json" };
  loginReq.socket = {};
  await server.handleRequest(loginReq, loginRecorder.res);

  assert.equal(loginRecorder.state.status, 200);
  const loginBody = JSON.parse(loginRecorder.state.body);
  assert.equal(loginBody.user.steamAvatar, avatarUrl);
}

async function testWebPagesEndpointFiltersByPermissions() {
  const registry = new WebRegistry({
    config: {
      get() {
        return {};
      },
    },
    logger: {
      web() {},
    },
  });

  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest(req) {
          if (req.headers.authorization === "viewer") {
            return {
              username: "viewer",
              role: "Admin",
              authorizationMode: "transitional",
              permissions: ["match_state.view"],
            };
          }
          if (req.headers.authorization === "super") {
            return {
              username: "admin",
              role: "SuperAdmin",
              isSuperAdmin: true,
              permissions: [],
            };
          }
          return null;
        },
      },
      webRegistry: registry,
    },
  });

  const viewer = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/web/pages",
    headers: { host: "localhost", authorization: "viewer" },
    socket: {},
  }, viewer.res);

  assert.equal(viewer.state.status, 200);
  const viewerPages = JSON.parse(viewer.state.body).pages;
  const viewerRoutes = viewerPages.map((page) => page.route);
  assert.equal(viewerRoutes.includes("/match-status"), true);
  assert.equal(viewerRoutes.includes("/console"), false);

  const superAdmin = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/web/pages",
    headers: { host: "localhost", authorization: "super" },
    socket: {},
  }, superAdmin.res);

  assert.equal(superAdmin.state.status, 200);
  const adminPages = JSON.parse(superAdmin.state.body).pages;
  assert.equal(adminPages.length, registry.getAllPages().length);
}

async function testAdminUsersRouteReturnsOnceAndHidesPasswordHash() {
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return {
            id: "user:root",
            username: "Root",
            role: "SuperAdmin",
            isSuperAdmin: true,
          };
        },
        hasEverything(user) {
          return user?.role === "SuperAdmin";
        },
        userStore: {
          listUsers() {
            return [
              {
                id: "user:root",
                username: "Root",
                displayName: "Root User",
                role: "SuperAdmin",
                steam64: "76561198194428818",
                viewerTeamAutoSwapEnabled: true,
                enabled: true,
                note: "",
                permissionGroupId: null,
                passwordHash: "scrypt$secret",
                authVersion: 3,
                createdAt: 1,
                updatedAt: 2,
                passwordChangedAt: 3,
              },
            ];
          },
          listPermissionGroups() {
            return [];
          },
        },
      },
    },
    modules: {
      playerDatabase: {
        async listPlayersBySteamIDs(steamIDs) {
          assert.deepEqual(steamIDs, ["76561198194428818"]);
          return [
            {
              steamID: "76561198194428818",
              steamAvatar: "https://avatars.example/root.jpg",
            },
          ];
        },
      },
    },
  });

  const recorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/admin/users",
    headers: { host: "localhost" },
    socket: {},
  }, recorder.res);

  assert.equal(recorder.state.status, 200);
  const body = JSON.parse(recorder.state.body);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].username, "Root");
  assert.equal(body.items[0].steamAvatar, "https://avatars.example/root.jpg");
  assert.equal(Object.hasOwn(body.items[0], "passwordHash"), false);
  assert.equal(Object.hasOwn(body.items[0], "authVersion"), false);
  assert.deepEqual(body.permissionGroups, []);
}

async function testAdminPermissionGroupsApiSupportsCrudAndInUseConflict() {
  const permissionGroups = [
    {
      id: "group:intern",
      name: "Intern",
      enabled: true,
      permissions: ["rcon.warn"],
      createdAt: 10,
      updatedAt: 11,
    },
  ];
  const users = [
    {
      id: "user:root",
      username: "Root",
      role: "SuperAdmin",
      enabled: true,
      permissionGroupId: null,
    },
    {
      id: "user:op",
      username: "Op",
      role: "Admin",
      enabled: true,
      permissionGroupId: "group:intern",
    },
  ];
  const calls = [];

  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return {
            id: "user:root",
            username: "Root",
            role: "SuperAdmin",
            isSuperAdmin: true,
          };
        },
        hasEverything(user) {
          return user?.isSuperAdmin === true;
        },
        hashPassword: async () => "hash",
        userStore: {
          listUsers() {
            return users;
          },
          listPermissionGroups() {
            return permissionGroups;
          },
          async createPermissionGroup(payload) {
            calls.push({ type: "create", payload });
            return {
              id: "group:new",
              name: payload.name,
              enabled: payload.enabled,
              permissions: payload.permissions,
              createdAt: 20,
              updatedAt: 20,
            };
          },
          async updatePermissionGroup(groupId, payload) {
            calls.push({ type: "update", groupId, payload });
            return {
              id: groupId,
              name: payload.name,
              enabled: payload.enabled,
              permissions: payload.permissions,
              createdAt: 10,
              updatedAt: 30,
            };
          },
          async deletePermissionGroup() {
            const error = new Error("Permission group is still assigned to user Op.");
            error.statusCode = 409;
            error.code = "PermissionGroupInUse";
            throw error;
          },
        },
      },
    },
  });

  const list = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/admin/permission-groups",
    headers: { host: "localhost" },
    socket: {},
  }, list.res);
  assert.equal(list.state.status, 200);
  const listBody = JSON.parse(list.state.body);
  assert.equal(listBody.items.length, 1);
  assert.equal(listBody.items[0].assignedUsers, 1);

  const createReq = Readable.from([JSON.stringify({ name: "Senior", enabled: true, permissions: ["rcon.tb", "rcon.kick", "match_state.view"] })]);
  createReq.method = "POST";
  createReq.url = "/api/admin/permission-groups";
  createReq.headers = { host: "localhost", "content-type": "application/json" };
  createReq.socket = {};
  const createRes = createRecorder();
  await server.handleRequest(createReq, createRes.res);
  assert.equal(createRes.state.status, 201);
  assert.equal(calls[0].type, "create");
  assert.deepEqual(calls[0].payload.permissions, ["rcon.tb", "rcon.kick", "match_state.view"]);

  const updateReq = Readable.from([JSON.stringify({ name: "Intern Updated", enabled: false, permissions: ["rcon.warn", "rcon.broadcast", "player_database.view"] })]);
  updateReq.method = "PATCH";
  updateReq.url = "/api/admin/permission-groups/group%3Aintern";
  updateReq.headers = { host: "localhost", "content-type": "application/json" };
  updateReq.socket = {};
  const updateRes = createRecorder();
  await server.handleRequest(updateReq, updateRes.res);
  assert.equal(updateRes.state.status, 200);
  assert.equal(calls[1].type, "update");
  assert.deepEqual(calls[1].payload.permissions, ["rcon.warn", "rcon.broadcast", "player_database.view"]);

  const deleteReq = {
    method: "DELETE",
    url: "/api/admin/permission-groups/group%3Aintern",
    headers: { host: "localhost" },
    socket: {},
  };
  const deleteRes = createRecorder();
  await server.handleRequest(deleteReq, deleteRes.res);
  assert.equal(deleteRes.state.status, 409);
  const deleteBody = JSON.parse(deleteRes.state.body);
  assert.equal(deleteBody.error, "PermissionGroupInUse");
}

async function testConsoleRecentEndpointUsesUnifiedConsoleBuffer() {
  const calls = [];
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "admin", role: "Operator" };
        },
        hasEverything() {
          return true;
        },
      },
      console: {
        getRecent(args) {
          calls.push(args);
          return [
            {
              id: "console-1",
              seq: 1,
              ts: 1_000,
              channel: "event",
              level: "info",
              source: "LogParser",
              message: "地图切换：Mutaha",
            },
          ];
        },
        getLegacyChannels() {
          return { streams: [], scopes: [], levels: [] };
        },
        getLegacyLines() {
          return [];
        },
        async executeRconCommand() {
          return { success: true, ok: true, response: "OK", status: "success", durationMs: 10 };
        },
      },
    },
  });

  const recorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/console/recent?limit=1&channel=event&keyword=%E5%9C%B0%E5%9B%BE",
    headers: { host: "localhost" },
    socket: {},
  }, recorder.res);

  assert.equal(recorder.state.status, 200);
  const body = JSON.parse(recorder.state.body);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].channel, "event");
  assert.equal(calls[0].channel, "event");
  assert.equal(calls[0].keyword, "地图");

  const rconRecorder = createRecorder();
  const rconReq = Readable.from([JSON.stringify({ command: "ListPlayers" })]);
  rconReq.method = "POST";
  rconReq.url = "/api/rcon/execute";
  rconReq.headers = { host: "localhost" };
  rconReq.socket = {};

  await server.handleRequest(rconReq, rconRecorder.res);
  assert.equal(rconRecorder.state.status, 200);
  const rconBody = JSON.parse(rconRecorder.state.body);
  assert.equal(rconBody.ok, true);
  assert.equal(rconBody.status, "success");
}

async function testConsoleRconEndpointsUseLoggedInUser() {
  const calls = [];
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return {
            id: "user-1",
            username: "admin",
            role: "SuperAdmin",
            isSuperAdmin: true,
            permissions: [],
          };
        },
        hasEverything(user) {
          return user?.isSuperAdmin === true;
        },
      },
      console: {
        getRecent() {
          return [];
        },
        getLegacyChannels() {
          return { streams: [], scopes: [], levels: [] };
        },
        getLegacyLines() {
          return [];
        },
        async executeRconCommand(command, meta) {
          calls.push({ command, meta });
          return { success: true, ok: true, response: "OK", status: "success", durationMs: 10 };
        },
      },
    },
  });

  for (const pathName of ["/api/console/rcon", "/api/rcon-command"]) {
    const recorder = createRecorder();
    const req = Readable.from([JSON.stringify({ command: "AdminBroadcast Hello" })]);
    req.method = "POST";
    req.url = pathName;
    req.headers = { host: "localhost" };
    req.socket = {};

    await server.handleRequest(req, recorder.res);
    assert.equal(recorder.state.status, 200);
  }

  assert.equal(calls.length, 2);
  assert.equal(calls[0].meta.actor.username, "admin");
  assert.equal(calls[0].meta.system, false);
  assert.equal(calls[1].meta.actor.username, "admin");
  assert.equal(calls[1].meta.system, false);
}

async function testConsoleRconForbiddenMapsTo403() {
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return {
            id: "user-2",
            username: "viewer",
            role: "Admin",
            permissions: [],
          };
        },
        hasEverything() {
          return false;
        },
      },
      console: {
        getRecent() {
          return [];
        },
        getLegacyChannels() {
          return { streams: [], scopes: [], levels: [] };
        },
        getLegacyLines() {
          return [];
        },
        async executeRconCommand() {
          throw new Error("should not execute");
        },
      },
    },
  });

  for (const pathName of ["/api/console/recent", "/api/console/rcon", "/api/rcon-command"]) {
    const recorder = createRecorder();
    const req = pathName === "/api/console/recent"
      ? {
          method: "GET",
          url: pathName,
          headers: { host: "localhost" },
          socket: {},
        }
      : Readable.from([JSON.stringify({ command: "AdminBroadcast Hello" })]);

    if (pathName !== "/api/console/recent") {
      req.method = "POST";
      req.url = pathName;
      req.headers = { host: "localhost" };
      req.socket = {};
    }

    await server.handleRequest(req, recorder.res);
    assert.equal(recorder.state.status, 403);
    const body = JSON.parse(recorder.state.body);
    assert.equal(body.error, "Forbidden");
    assert.equal(body.message, "SuperAdmin role is required.");
  }
}

async function testConsoleWebSocketRequiresSuperAdmin() {
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return {
            username: "viewer",
            role: "Admin",
            isSuperAdmin: false,
          };
        },
        hasEverything() {
          return false;
        },
      },
    },
  });

  const writes = [];
  const socket = {
    end(buffer) {
      writes.push(Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer ?? ""));
    },
    write(buffer) {
      writes.push(Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer ?? ""));
    },
    destroy() {},
    on() {},
  };

  await server.handleUpgrade({
    url: "/ws/console",
    headers: {
      host: "localhost",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
    },
    socket,
  }, socket, Buffer.alloc(0));

  assert.equal(writes.some((entry) => entry.includes("403 Forbidden")), true);
}

async function testPlaytimeCacheReturnsEffectiveDuration() {
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "admin", role: "SuperAdmin", isSuperAdmin: true };
        },
        hasEverything() {
          return true;
        },
      },
    },
    modules: {
      playtime: {
        async getBySteamID(steamID) {
          assert.equal(steamID, "76561198000000001");
          return {
            steam_id: steamID,
            app_id: 393380,
            game_name: "Squad",
            steam_game_seconds: 7200,
            game_seconds_override: 10800,
            game_seconds: 10800,
            fetched_at: 123456,
            last_seen_name: "Alpha",
          };
        },
      },
    },
  });

  const recorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/query/playtime-cache?steamIDs=76561198000000001",
    headers: { host: "localhost" },
    socket: {},
  }, recorder.res);

  assert.equal(recorder.state.status, 200);
  const body = JSON.parse(recorder.state.body);
  assert.equal(body.items["76561198000000001"].gameSeconds, 10800);
  assert.equal(body.items["76561198000000001"].steamGameSeconds, 7200);
  assert.equal(body.items["76561198000000001"].gameSecondsOverride, 10800);
}

async function testPlayerPlaytimeOverrideRouteRequiresSuperAdmin() {
  const setCalls = [];
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "viewer", role: "Operator", permissions: [] };
        },
        hasEverything() {
          return false;
        },
      },
    },
    modules: {
      playerDatabase: {
        async setGameDurationOverride(playerId, gameSeconds) {
          setCalls.push({ playerId, gameSeconds });
          return { id: playerId };
        },
      },
    },
  });

  const recorder = createRecorder();
  const req = Readable.from([JSON.stringify({ gameHours: 12.5 })]);
  req.method = "PATCH";
  req.url = "/api/db/players/7/playtime";
  req.headers = { host: "localhost" };
  req.socket = {};

  await server.handleRequest(req, recorder.res);
  assert.equal(recorder.state.status, 403);
  assert.equal(setCalls.length, 0);
}

async function testPlayerPlaytimeOverrideRouteSetsHours() {
  const setCalls = [];
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "admin", role: "SuperAdmin", isSuperAdmin: true };
        },
        hasEverything() {
          return true;
        },
      },
    },
    modules: {
      playerDatabase: {
        async setGameDurationOverride(playerId, gameSeconds) {
          setCalls.push({ playerId, gameSeconds });
          return {
            player: {
              id: Number(playerId),
              game_seconds_override: gameSeconds,
              game_seconds: gameSeconds,
            },
            summary: {
              gameSeconds,
              gameSecondsOverride: gameSeconds,
              steamGameSeconds: 7200,
            },
          };
        },
      },
    },
  });

  const recorder = createRecorder();
  const req = Readable.from([JSON.stringify({ gameHours: 12.5 })]);
  req.method = "PATCH";
  req.url = "/api/db/players/7/playtime";
  req.headers = { host: "localhost" };
  req.socket = {};

  await server.handleRequest(req, recorder.res);
  assert.equal(recorder.state.status, 200);
  const body = JSON.parse(recorder.state.body);
  assert.equal(body.ok, true);
  assert.equal(setCalls.length, 1);
  assert.equal(setCalls[0].playerId, "7");
  assert.equal(setCalls[0].gameSeconds, 45000);
}

async function testSquadNameClassifierHelperCoversCoreRules() {
  assert.equal(classifySquadName("Squad 7").category, "infantry");
  assert.equal(classifySquadName("步兵队").category, "infantry");
  assert.equal(classifySquadName("装甲队").category, "vehicle");
  assert.equal(classifySquadName("后勤支援").category, "support");
  assert.equal(classifySquadName("Alpha").category, "other");
}

async function testSquadNameClassifierApiReturnsClassification() {
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "admin", role: "Operator" };
        },
      },
    },
  });

  const recorder = createRecorder();
  const req = Readable.from([JSON.stringify({ name: "步兵队" })]);
  req.method = "POST";
  req.url = "/api/squad-name/classify";
  req.headers = { host: "localhost" };
  req.socket = {};

  await server.handleRequest(req, recorder.res);

  assert.equal(recorder.state.status, 200);
  const body = JSON.parse(recorder.state.body);
  assert.equal(body.ok, true);
  assert.equal(body.category, "infantry");
  assert.equal(body.label, "步兵队");
  assert.equal(body.reason.includes("步兵队"), true);
}

async function testSquadNameRulesApiReadsAndWritesExactMappings() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-squad-name-api-"));
  const rulesPath = path.join(tempDir, "rules.json");
  await fs.writeFile(rulesPath, JSON.stringify({
    version: 1,
    updatedAt: "2026-06-07T00:00:00.000Z",
    rules: {
      infantry: { exact: ["alpha"] },
      vehicle: { exact: ["bravo"] },
      support: { exact: ["logi"] },
    },
  }), "utf8");

  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "admin", role: "SuperAdmin", isSuperAdmin: true };
        },
        hasEverything() {
          return true;
        },
      },
      config: {
        get(pathText) {
          return pathText === "squadNameClassifier.rulesPath" ? rulesPath : undefined;
        },
      },
    },
  });

  const getRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/squad-name/rules",
    headers: { host: "localhost" },
    socket: {},
  }, getRecorder.res);
  assert.equal(getRecorder.state.status, 200);
  const getBody = JSON.parse(getRecorder.state.body);
  assert.deepEqual(getBody.exactRules, {
    infantry: ["alpha"],
    vehicle: ["bravo"],
    support: ["logi"],
  });

  const postRecorder = createRecorder();
  const postReq = Readable.from([JSON.stringify({
    exactRules: {
      infantry: ["alpha", "green"],
      vehicle: ["armor", "alpha"],
      support: ["logi"],
    },
  })]);
  postReq.method = "POST";
  postReq.url = "/api/squad-name/rules";
  postReq.headers = { host: "localhost", "content-type": "application/json" };
  postReq.socket = {};
  await server.handleRequest(postReq, postRecorder.res);
  assert.equal(postRecorder.state.status, 200);
  const postBody = JSON.parse(postRecorder.state.body);
  assert.deepEqual(postBody.exactRules, {
    infantry: ["green"],
    vehicle: ["alpha", "armor"],
    support: ["logi"],
  });

  const savedRaw = JSON.parse(await fs.readFile(rulesPath, "utf8"));
  assert.deepEqual(savedRaw.rules.infantry.exact, ["green"]);
  assert.deepEqual(savedRaw.rules.vehicle.exact, ["alpha", "armor"]);
  assert.deepEqual(savedRaw.rules.support.exact, ["logi"]);
}

async function testSquadNamePolicyRoutesExposeTestAndProtectedSave() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-squad-name-policy-api-"));
  const policyPath = path.join(tempDir, "policy.json");
  await fs.writeFile(policyPath, JSON.stringify({
    version: 1,
    suggestionLimit: 5,
    entries: [
      {
        id: "afu-ifv-bmp-1",
        faction: "AFU",
        vehicleType: "IFV",
        asset: "/Game/Vehicles/BMP1_AFU/BP_BMP1_AFU.BP_BMP1_AFU",
        name: "BMP-1",
        aliases: [],
        keywords: ["BMP"],
      },
      {
        id: "afu-ifv-bmp-2",
        faction: "AFU",
        vehicleType: "IFV",
        asset: "/Game/Vehicles/BMP2_AFU/BP_BMP2_AFU.BP_BMP2_AFU",
        name: "BMP-2",
        aliases: ["BMP 2"],
        keywords: ["BMP"],
      },
    ],
  }), "utf8");

  const baseCore = {
    config: {
      get(pathText) {
        return pathText === "squadNamePolicy.path" ? policyPath : undefined;
      },
    },
  };

  const viewerServer = createServer({
    core: {
      ...baseCore,
      authManager: {
        getUserFromRequest() {
          return { username: "viewer", role: "Operator" };
        },
        hasEverything() {
          return false;
        },
      },
    },
  });

  const stateRecorder = createRecorder();
  await viewerServer.handleRequest({
    method: "GET",
    url: "/api/squad-name-policy/state",
    headers: { host: "localhost" },
    socket: {},
  }, stateRecorder.res);
  assert.equal(stateRecorder.state.status, 200);
  assert.equal(JSON.parse(stateRecorder.state.body).stats.entries, 2);

  const testRecorder = createRecorder();
  const testReq = Readable.from([JSON.stringify({ name: "BMP队" })]);
  testReq.method = "POST";
  testReq.url = "/api/squad-name-policy/test";
  testReq.headers = { host: "localhost", "content-type": "application/json" };
  testReq.socket = {};
  await viewerServer.handleRequest(testReq, testRecorder.res);
  assert.equal(testRecorder.state.status, 200);
  const testBody = JSON.parse(testRecorder.state.body);
  assert.equal(testBody.valid, false);
  assert.deepEqual(testBody.keywordSuggestions.map((item) => item.name), ["BMP-1", "BMP-2"]);

  const forbiddenRecorder = createRecorder();
  const forbiddenReq = Readable.from([JSON.stringify({ suggestionLimit: 3, entries: [] })]);
  forbiddenReq.method = "POST";
  forbiddenReq.url = "/api/squad-name-policy/state";
  forbiddenReq.headers = { host: "localhost", "content-type": "application/json" };
  forbiddenReq.socket = {};
  await viewerServer.handleRequest(forbiddenReq, forbiddenRecorder.res);
  assert.equal(forbiddenRecorder.state.status, 403);

  const adminServer = createServer({
    core: {
      ...baseCore,
      authManager: {
        getUserFromRequest() {
          return { username: "admin", role: "SuperAdmin", isSuperAdmin: true };
        },
        hasEverything() {
          return true;
        },
      },
    },
  });

  const saveRecorder = createRecorder();
  const saveReq = Readable.from([JSON.stringify({
    suggestionLimit: 3,
    entries: [
      {
        id: "tank",
        faction: "ADF",
        vehicleType: "MBT",
        asset: "/Game/Vehicles/AUS_M1A1/BP_AUS_M1A1.BP_AUS_M1A1",
        name: "M1A1",
        aliases: ["Abrams"],
        keywords: ["TANK"],
      },
    ],
  })]);
  saveReq.method = "POST";
  saveReq.url = "/api/squad-name-policy/state";
  saveReq.headers = { host: "localhost", "content-type": "application/json" };
  saveReq.socket = {};
  await adminServer.handleRequest(saveReq, saveRecorder.res);
  assert.equal(saveRecorder.state.status, 200);
  const saveBody = JSON.parse(saveRecorder.state.body);
  assert.equal(saveBody.suggestionLimit, 3);
  assert.equal(saveBody.stats.entries, 1);
  const savedRaw = JSON.parse(await fs.readFile(policyPath, "utf8"));
  assert.equal(savedRaw.entries[0].name, "M1A1");
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

async function testCombatLogRoutesExposeLogsAndMetadata() {
  const calls = [];
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return {
            username: "viewer",
            role: "Operator",
            permissions: ["combat_manager.view"],
          };
        },
      },
    },
    modules: {
      combatLog: {
        getStatus() {
          return {
            ok: true,
            currentRelativePath: "data/combat-logs/2026-06/2026-06-02.log",
            currentMonth: "2026-06",
            currentDate: "2026-06-02",
            lastWrittenAt: "2026-06-02T12:00:00.000Z",
            writeCount: 2,
          };
        },
        async listMonths() {
          calls.push("months");
          return [{ month: "2026-06", fileCount: 1, latestDate: "2026-06-02" }];
        },
        async listFiles(month) {
          calls.push(month);
          return [{
            date: "2026-06-02",
            fileName: "2026-06-02.log",
            filePath: "/tmp/data/combat-logs/2026-06/2026-06-02.log",
            relativePath: "data/combat-logs/2026-06/2026-06-02.log",
            size: 42,
            mtime: "2026-06-02T12:00:00.000Z",
          }];
        },
        async readLog(filter) {
          calls.push(filter);
          return {
            ok: true,
            month: filter.month,
            date: filter.date,
            filePath: "/tmp/data/combat-logs/2026-06/2026-06-02.log",
            relativePath: "data/combat-logs/2026-06/2026-06-02.log",
            total: 1,
            offset: Number(filter.offset ?? 0),
            limit: Number(filter.limit ?? 300),
            hasMoreOlder: false,
            hasMoreNewer: false,
            lines: [{
              lineNumber: 1,
              time: "12:00:00",
              type: "damage",
              mark: "友军伤害",
              attacker: "Attacker",
              victim: "Victim",
              damage: "37.5",
              weapon: "BP_Rifle_C",
              raw: "12:00:00\tdamage\t友军伤害\tAttacker\tVictim\t37.5\tBP_Rifle_C",
            }],
          };
        },
      },
    },
  });

  const statusRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/combat-logs/status",
    headers: { host: "localhost" },
    socket: {},
  }, statusRecorder.res);

  assert.equal(statusRecorder.state.status, 200);
  assert.equal(JSON.parse(statusRecorder.state.body).currentMonth, "2026-06");

  const monthsRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/combat-logs/months",
    headers: { host: "localhost" },
    socket: {},
  }, monthsRecorder.res);

  assert.equal(monthsRecorder.state.status, 200);
  const monthsBody = JSON.parse(monthsRecorder.state.body);
  assert.equal(monthsBody.months[0].month, "2026-06");

  const filesRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/combat-logs/files?month=2026-06",
    headers: { host: "localhost" },
    socket: {},
  }, filesRecorder.res);

  assert.equal(filesRecorder.state.status, 200);
  const filesBody = JSON.parse(filesRecorder.state.body);
  assert.equal(filesBody.files[0].date, "2026-06-02");

  const readRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/combat-logs/read?month=2026-06&date=2026-06-02&q=Attacker&limit=50&offset=0",
    headers: { host: "localhost" },
    socket: {},
  }, readRecorder.res);

  assert.equal(readRecorder.state.status, 200);
  const readBody = JSON.parse(readRecorder.state.body);
  assert.equal(readBody.lines[0].attacker, "Attacker");
  assert.equal(calls[0], "months");
  assert.equal(calls[1], "2026-06");
  assert.equal(calls[2].date, "2026-06-02");
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

async function testMatchSnapshotRouteReusesPrebuiltSnapshot() {
  const snapshot = {
    serverStatus: {
      map: "AlBasrah",
      layer: "AlBasrah_RAAS_v1",
      lastUpdatedAt: "2026-06-01T00:00:00.000Z",
    },
    match: {
      map: "AlBasrah",
      layer: "AlBasrah_RAAS_v1",
      phase: "in_progress",
      lastUpdatedAt: "2026-06-01T00:00:00.000Z",
    },
    players: {
      list: [{ playerID: 1, name: "Alice" }],
      lastUpdatedAt: "2026-06-01T00:00:00.000Z",
    },
    squads: {
      list: [{ key: "1:2", teamID: 1, squadID: 2, squadName: "Alpha" }],
      lastUpdatedAt: "2026-06-01T00:00:00.000Z",
    },
    rconStatus: {
      connected: true,
      lastUpdatedAt: "2026-06-01T00:00:00.000Z",
    },
    rconPolling: {
      enabled: true,
      lastUpdatedAt: "2026-06-01T00:00:00.000Z",
    },
    logAccess: {
      granted: true,
      lastUpdatedAt: "2026-06-01T00:00:00.000Z",
    },
  };

  let getStateCalls = 0;
  let getOverviewCalls = 0;
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "admin", role: "SuperAdmin" };
        },
      },
      webStatus: {
        getSnapshot() {
          return { updatedAt: "2026-06-01T00:00:00.000Z", rcon: "connected" };
        },
      },
    },
    modules: {
      remoteTelemetry: {
        getState() {
          return {
            listening: true,
            currentSample: {
              tickets: {
                team1: 320,
                team2: 287,
              },
            },
          };
        },
      },
      matchState: {
        getState() {
          getStateCalls += 1;
          return snapshot;
        },
        getOverview(matchState) {
          getOverviewCalls += 1;
          assert.strictEqual(matchState, snapshot);
          return {
            status: { updatedAt: "2026-06-01T00:00:00.000Z", rcon: "connected" },
            matchState,
            serverStatus: matchState.serverStatus,
            match: matchState.match,
            players: matchState.players.list,
            squads: matchState.squads.list,
            round: { current: null, history: [] },
            rconStatus: matchState.rconStatus,
            rconPolling: matchState.rconPolling,
            logAccess: matchState.logAccess,
          };
        },
      },
    },
  });

  const recorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/match/snapshot",
    headers: { host: "localhost" },
    socket: {},
  }, recorder.res);

  assert.equal(recorder.state.status, 200);
  const body = JSON.parse(recorder.state.body);
  assert.equal(body.matchState.serverStatus.map, "AlBasrah");
  assert.equal(body.remoteTelemetry.currentSample.tickets.team1, 320);
  assert.equal(getStateCalls, 1);
  assert.equal(getOverviewCalls, 1);
}

async function testRemoteTelemetryStateRouteUsesModuleState() {
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "admin", role: "SuperAdmin" };
        },
      },
    },
    modules: {
      remoteTelemetry: {
        getState() {
          return {
            listening: true,
            currentSample: {
              tickets: { team1: 111, team2: 99 },
            },
            sourceCount: 1,
          };
        },
      },
    },
  });

  const recorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/remote-telemetry/state",
    headers: { host: "localhost" },
    socket: {},
  }, recorder.res);

  assert.equal(recorder.state.status, 200);
  const body = JSON.parse(recorder.state.body);
  assert.equal(body.ok, true);
  assert.equal(body.source, "module.remoteTelemetry");
  assert.equal(body.remoteTelemetry.currentSample.tickets.team2, 99);
}

async function testRemoteTelemetryWriteTicketsRouteDelegatesToModule() {
  let receivedPayload = null;
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
      remoteTelemetry: {
        async writeTickets(payload) {
          receivedPayload = payload;
          return {
            ok: true,
            target: { host: "127.0.0.1", port: 12765 },
            request: { action: "set_tickets", t1: 300, t2: 250 },
            response: { ok: true, type: "ticket_write", pid: 2952, t1: 300, t2: 250 },
          };
        },
      },
    },
  });

  const recorder = createRecorder();
  const req = Readable.from([JSON.stringify({ t1: 300, t2: 250 })]);
  req.method = "POST";
  req.url = "/api/remote-telemetry/write-tickets";
  req.headers = { host: "localhost" };
  req.socket = {};
  await server.handleRequest(req, recorder.res);

  assert.equal(recorder.state.status, 200);
  const body = JSON.parse(recorder.state.body);
  assert.deepEqual(receivedPayload, { t1: 300, t2: 250 });
  assert.equal(body.ok, true);
  assert.equal(body.response.t2, 250);
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
          if (req.headers.authorization === "rcon-kick") {
            return {
              username: "kick-operator",
              role: "Operator",
              permissions: ["rcon.kick"],
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
          return hasRconPermission(permissions, permission);
        },
      },
    },
    modules: {
      squadManagement: {
        getState() {
          return state;
        },
        async executeAction(input) {
          if (input.type === "disband_squad") {
            return this.disband(input);
          }
          if (input.type === "kick_player") {
            return this.kick(input);
          }
          if (input.type === "remove_from_squad") {
            return this.remove(input);
          }
          return {
            ok: false,
            error: "UnsupportedAction",
            message: "Unsupported action type.",
          };
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
          if (!input.actor?.isSuperAdmin && !hasRconPermission(input.actor.permissions, "squad.disband")) {
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
          if (!input.actor?.isSuperAdmin && !hasRconPermission(input.actor.permissions, "squad.kick")) {
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
        async remove(input) {
          calls.push({ type: "remove", input });
          return {
            ok: true,
            action: "manual-remove",
            source: "manual",
            system: false,
            target: {
              playerId: input.playerId,
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

  const actionKickRecorder = createRecorder();
  const actionKickReq = Readable.from([JSON.stringify({
    type: "kick_player",
    anyId: "76561198000005678",
    reason: "test",
  })]);
  actionKickReq.method = "POST";
  actionKickReq.url = "/api/squad-management/actions";
  actionKickReq.headers = { host: "localhost", authorization: "rcon-kick" };
  actionKickReq.socket = {};
  await server.handleRequest(actionKickReq, actionKickRecorder.res);
  assert.equal(actionKickRecorder.state.status, 200);
  assert.equal(JSON.parse(actionKickRecorder.state.body).ok, true);

  assert.equal(calls[0].type, "disband");
  assert.equal(calls[1].type, "kick");
  assert.equal(calls[2].type, "kick");
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
        value: 8899,
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
            return { username: "viewer", role: "Operator", permissions: ["settings.manage"] };
          }
          if (req.headers.authorization === "limited") {
            return { username: "limited", role: "Operator", permissions: [] };
          }
          return null;
        },
        hasEverything(user) {
          return String(user?.role ?? "").toLowerCase().includes("superadmin");
        },
        hasPermission(user, permission) {
          return Array.isArray(user?.permissions) && user.permissions.includes(permission);
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
    headers: { host: "localhost", authorization: "limited" },
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

async function testAdminWarnBroadcastRouteReturnsMemoryRecords() {
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
        async broadcastMessage(body) {
          assert.equal(body.message, "server restart soon");
          return { success: true, skipped: false, commandText: "AdminBroadcast server restart soon" };
        },
        getRecent(filter) {
          assert.equal(filter.kind, "broadcast");
          return [{
            id: "broadcast-1",
            kind: "broadcast",
            createdAt: 1710000000000,
            sourceModule: "web.broadcastModule",
            reason: "manual_broadcast",
            message: "server restart soon",
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
  const bodyStream = Readable.from([JSON.stringify({
    message: "server restart soon",
    sourceModule: "web.broadcastModule",
    reason: "manual_broadcast",
  })]);
  bodyStream.method = "POST";
  bodyStream.url = "/api/admin-warns/broadcast";
  bodyStream.headers = { host: "localhost" };
  bodyStream.socket = {};
  await server.handleRequest(bodyStream, recorder.res);

  assert.equal(recorder.state.status, 200);
  const body = JSON.parse(recorder.state.body);
  assert.equal(body.success, true);

  const recentRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/admin-warns/recent?kind=broadcast&limit=10",
    headers: { host: "localhost" },
    socket: {},
  }, recentRecorder.res);

  assert.equal(recentRecorder.state.status, 200);
  const recentBody = JSON.parse(recentRecorder.state.body);
  assert.equal(recentBody.records.length, 1);
  assert.equal(recentBody.records[0].kind, "broadcast");
}

async function testPjscAverageDurationRouteReturnsPluginState() {
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
            manifest: { id: "plugin.pjscAverageDuration" },
            api: {
              getState() {
                return {
                  enabled: true,
                  triggerCount: 1,
                  history: [],
                };
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
    url: "/api/plugins/pjsc-average-duration/state",
    headers: { host: "localhost" },
    socket: {},
  }, recorder.res);

  assert.equal(recorder.state.status, 200);
  const body = JSON.parse(recorder.state.body);
  assert.equal(body.ok, true);
  assert.equal(body.data.triggerCount, 1);
}

async function testFairTeamBalanceRoutesReturnPluginStateAndRequests() {
  const approveCalls = [];
  const rejectCalls = [];
  const periodResetCalls = [];
  const roundResetCalls = [];
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return {
            username: "admin",
            name: "Admin",
            role: "SuperAdmin",
            isSuperAdmin: true,
          };
        },
        hasEverything() {
          return true;
        },
      },
      pluginManager: {
        instances: [
          {
            manifest: { id: "plugin.fairTeamBalance" },
            api: {
              getState() {
                return {
                  enabled: true,
                  publicTbRemaining: 4,
                };
              },
              listRequests() {
                return [
                  { id: "req-1", code: "12345", status: "pending_claim" },
                ];
              },
              async approveRequest(payload) {
                approveCalls.push(payload);
                return { ok: true };
              },
              async rejectRequest(payload) {
                rejectCalls.push(payload);
                return { ok: true };
              },
              async resetPeriodQuotas(reason, meta) {
                periodResetCalls.push({ reason, meta });
                return { ok: true, affectedCount: 2 };
              },
              async resetRound(reason, meta) {
                roundResetCalls.push({ reason, meta });
                return { ok: true, publicTbRemaining: 5 };
              },
            },
          },
        ],
      },
    },
  });

  const stateRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/plugins/fair-team-balance/state",
    headers: { host: "localhost" },
    socket: {},
  }, stateRecorder.res);
  assert.equal(stateRecorder.state.status, 200);
  assert.equal(JSON.parse(stateRecorder.state.body).data.publicTbRemaining, 4);

  const requestsRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/plugins/fair-team-balance/requests",
    headers: { host: "localhost" },
    socket: {},
  }, requestsRecorder.res);
  assert.equal(requestsRecorder.state.status, 200);
  assert.equal(JSON.parse(requestsRecorder.state.body).data.requests[0].code, "12345");

  const approveRecorder = createRecorder();
  const approveBody = Readable.from([JSON.stringify({ requestId: "req-1", direct: true })]);
  approveBody.method = "POST";
  approveBody.url = "/api/plugins/fair-team-balance/approve";
  approveBody.headers = { host: "localhost" };
  approveBody.socket = {};
  await server.handleRequest(approveBody, approveRecorder.res);
  assert.equal(approveRecorder.state.status, 200);
  assert.equal(approveCalls.length, 1);
  assert.equal(approveCalls[0].requestId, "req-1");
  assert.equal(approveCalls[0].direct, true);
  assert.equal(approveCalls[0].actor.username, "admin");

  const rejectRecorder = createRecorder();
  const rejectBody = Readable.from([JSON.stringify({ requestId: "req-1", reason: "manual_reject" })]);
  rejectBody.method = "POST";
  rejectBody.url = "/api/plugins/fair-team-balance/reject";
  rejectBody.headers = { host: "localhost" };
  rejectBody.socket = {};
  await server.handleRequest(rejectBody, rejectRecorder.res);
  assert.equal(rejectRecorder.state.status, 200);
  assert.equal(rejectCalls.length, 1);
  assert.equal(rejectCalls[0].reason, "manual_reject");

  const resetPeriodRecorder = createRecorder();
  const resetPeriodBody = Readable.from(["{}"]);
  resetPeriodBody.method = "POST";
  resetPeriodBody.url = "/api/plugins/fair-team-balance/reset-period-quotas";
  resetPeriodBody.headers = { host: "localhost" };
  resetPeriodBody.socket = {};
  await server.handleRequest(resetPeriodBody, resetPeriodRecorder.res);
  assert.equal(resetPeriodRecorder.state.status, 200);
  assert.equal(periodResetCalls.length, 1);
  assert.equal(periodResetCalls[0].reason, "manual_period_reset");
  assert.equal(periodResetCalls[0].meta.by, "admin");

  const resetRoundRecorder = createRecorder();
  const resetRoundBody = Readable.from(["{}"]);
  resetRoundBody.method = "POST";
  resetRoundBody.url = "/api/plugins/fair-team-balance/reset-round";
  resetRoundBody.headers = { host: "localhost" };
  resetRoundBody.socket = {};
  await server.handleRequest(resetRoundBody, resetRoundRecorder.res);
  assert.equal(resetRoundRecorder.state.status, 200);
  assert.equal(roundResetCalls.length, 1);
  assert.equal(roundResetCalls[0].reason, "manual_round_reset");
  assert.equal(roundResetCalls[0].meta.by, "admin");
}

async function testStepwiseSquadPlaytimeGuardRoutesReturnPluginStateAndSimulate() {
  const simulateCalls = [];
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "admin", role: "SuperAdmin", isSuperAdmin: true };
        },
        hasEverything() {
          return true;
        },
      },
      pluginManager: {
        instances: [
          {
            manifest: { id: "plugin.stepwiseSquadPlaytimeGuard" },
            api: {
              getState() {
                return {
                  enabled: true,
                  subscribed: true,
                  active: true,
                  settings: {
                    broadcastOnApproved: true,
                    broadcastOnViolation: true,
                    warnOnMissingPlaytime: true,
                    liveLookupWhenMissing: true,
                    maxRecentRecords: 10,
                    rules: {
                      infantry: [{ startSeconds: 0, endSeconds: 25, minHoursExclusive: 400 }],
                      vehicle: [{ startSeconds: 50, endSeconds: 60, minHoursExclusive: 800 }],
                    },
                  },
                  pendingLogCount: 0,
                  summary: {
                    total: 2,
                    approved: 1,
                    violations: 1,
                    broadcasts: 2,
                    disbands: 1,
                    warns: 1,
                    pendingLookups: 0,
                  },
                  recentRecords: [],
                };
              },
              async simulateCreation(payload) {
                simulateCalls.push(payload);
                return { id: "rec-1", approved: true, actions: [{ type: "broadcasted" }] };
              },
            },
          },
        ],
      },
    },
  });

  const stateRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/plugins/stepwise-squad-playtime-guard/state",
    headers: { host: "localhost" },
    socket: {},
  }, stateRecorder.res);
  assert.equal(stateRecorder.state.status, 200);
  const stateBody = JSON.parse(stateRecorder.state.body);
  assert.equal(stateBody.ok, true);
  assert.equal(stateBody.data.settings.broadcastOnViolation, true);
  assert.equal(stateBody.data.summary.broadcasts, 2);

  const simulateRecorder = createRecorder();
  const simulateBody = Readable.from([JSON.stringify({
    creatorName: "Leader",
    squadName: "INF 1",
    teamId: 1,
    squadId: 1,
    creationSource: "LOG",
  })]);
  simulateBody.method = "POST";
  simulateBody.url = "/api/plugins/stepwise-squad-playtime-guard/simulate";
  simulateBody.headers = { host: "localhost" };
  simulateBody.socket = {};
  await server.handleRequest(simulateBody, simulateRecorder.res);
  assert.equal(simulateRecorder.state.status, 200);
  assert.equal(simulateCalls.length, 1);
  assert.equal(simulateCalls[0].squadName, "INF 1");
}

async function testFairSquadGuardRoutesReturnPluginStateAndActions() {
  const unlockCalls = [];
  const resetCalls = [];
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "admin", role: "superadmin" };
        },
        hasEverything() {
          return true;
        },
      },
      pluginManager: {
        instances: [
          {
            manifest: { id: "plugin.fairSquadGuard" },
            api: {
              getStatus() {
                return { active: true, summary: { total: 1 } };
              },
              listRecords(query) {
                return { total: 1, limit: Number(query.limit), offset: Number(query.offset), records: [{ id: "rec-1" }] };
              },
              unlockCurrentRound(payload) {
                unlockCalls.push(payload);
                return { unlocked: true };
              },
              resetSession(reason) {
                resetCalls.push(reason);
                return { reset: true };
              },
            },
          },
        ],
      },
    },
  });

  const statusRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/plugins/fair-squad-guard/status",
    headers: { host: "localhost" },
    socket: {},
  }, statusRecorder.res);
  assert.equal(statusRecorder.state.status, 200);
  assert.equal(JSON.parse(statusRecorder.state.body).data.summary.total, 1);

  const recordsRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/plugins/fair-squad-guard/records?limit=20&offset=2",
    headers: { host: "localhost" },
    socket: {},
  }, recordsRecorder.res);
  assert.equal(recordsRecorder.state.status, 200);
  assert.equal(JSON.parse(recordsRecorder.state.body).data.limit, 20);
  assert.equal(JSON.parse(recordsRecorder.state.body).data.offset, 2);

  const unlockRecorder = createRecorder();
  const unlockBody = Readable.from(["{}"]);
  unlockBody.method = "POST";
  unlockBody.url = "/api/plugins/fair-squad-guard/unlock-current-round";
  unlockBody.headers = { host: "localhost" };
  unlockBody.socket = {};
  await server.handleRequest(unlockBody, unlockRecorder.res);
  assert.equal(unlockRecorder.state.status, 200);
  assert.equal(unlockCalls.length, 1);
  assert.equal(unlockCalls[0].by, "admin");

  const resetRecorder = createRecorder();
  const resetBody = Readable.from([JSON.stringify({ reason: "test_reset" })]);
  resetBody.method = "POST";
  resetBody.url = "/api/plugins/fair-squad-guard/reset-session";
  resetBody.headers = { host: "localhost" };
  resetBody.socket = {};
  await server.handleRequest(resetBody, resetRecorder.res);
  assert.equal(resetRecorder.state.status, 200);
  assert.deepEqual(resetCalls, ["test_reset"]);
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

async function testMatchSnapshotRoutesExposeArtifacts() {
  const calls = [];
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "admin" };
        },
        hasEverything() {
          return true;
        },
      },
      pluginManager: {
        instances: [
          {
            manifest: { id: "match-snapshot" },
            api: {
              async listSnapshots() {
                return [{ id: "Match-Test", artifacts: [{ format: "image", fileName: "Match-Test.png" }] }];
              },
              async takeManualSnapshot(options) {
                calls.push(`capture:${JSON.stringify(options ?? {})}`);
                return { id: "Match-Test", files: { image: "Match-Test.png" } };
              },
              async readSnapshotArtifact(id, format) {
                calls.push(`read:${id}:${format}`);
                return {
                  fileName: "Match-Test.png",
                  format: "image",
                  contentType: "image/png",
                  content: Buffer.from("PNGDATA", "utf8"),
                };
              },
              async deleteSnapshot(id) {
                calls.push(`delete:${id}`);
                return { id, removed: true, removedFiles: [`${id}.json`, `${id}.png`, `${id}.csv`, `${id}.md`] };
              },
            },
          },
        ],
      },
    },
  });

  const listRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/match-snapshot/list",
    headers: { host: "localhost" },
    socket: {},
  }, listRecorder.res);
  assert.equal(listRecorder.state.status, 200);
  assert.equal(JSON.parse(listRecorder.state.body)[0].id, "Match-Test");

  const captureRecorder = createRecorder();
  const captureReq = Readable.from([JSON.stringify({ includeSteamID: false, includeEOSID: true })]);
  captureReq.method = "POST";
  captureReq.url = "/api/match-snapshot/capture";
  captureReq.headers = { host: "localhost", "content-type": "application/json" };
  captureReq.socket = {};
  await server.handleRequest(captureReq, captureRecorder.res);
  assert.equal(captureRecorder.state.status, 200);
  assert.equal(JSON.parse(captureRecorder.state.body).snapshot.id, "Match-Test");
  assert.ok(calls.includes('capture:{"includeSteamID":false,"includeEOSID":true}'));

  const imageRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/match-snapshot/view?id=Match-Test&format=image",
    headers: { host: "localhost" },
    socket: {},
  }, imageRecorder.res);
  assert.equal(imageRecorder.state.status, 200);
  assert.equal(imageRecorder.state.headers["Content-Type"], "image/png");
  assert.equal(imageRecorder.state.body, "PNGDATA");
  assert.ok(calls.includes("read:Match-Test:image"));

  const deleteRecorder = createRecorder();
  await server.handleRequest({
    method: "DELETE",
    url: "/api/match-snapshot/delete?id=Match-Test",
    headers: { host: "localhost" },
    socket: {} ,
  }, deleteRecorder.res);
  assert.equal(deleteRecorder.state.status, 200);
  assert.equal(JSON.parse(deleteRecorder.state.body).snapshot.id, "Match-Test");
  assert.ok(calls.includes("delete:Match-Test"));
}

await testReadJsonBodyParsesValidPayload();
await testReadJsonBodyRejectsInvalidJson();
await testReadJsonBodyRejectsOversizedPayload();
await testGetPluginApiReturnsMatchingPluginApi();
await testBzssCoreCreateVehicleAcceptsOptionalTeamId();
await testHealthEndpointDoesNotRequireAuth();
await testAuthSessionAndLoginIncludeSteamAvatar();
await testWebPagesEndpointFiltersByPermissions();
await testAdminUsersRouteReturnsOnceAndHidesPasswordHash();
await testAdminPermissionGroupsApiSupportsCrudAndInUseConflict();
await testConsoleRecentEndpointUsesUnifiedConsoleBuffer();
await testConsoleRconEndpointsUseLoggedInUser();
await testConsoleRconForbiddenMapsTo403();
await testConsoleWebSocketRequiresSuperAdmin();
await testPlaytimeCacheReturnsEffectiveDuration();
await testPlayerPlaytimeOverrideRouteRequiresSuperAdmin();
await testPlayerPlaytimeOverrideRouteSetsHours();
await testSquadNameClassifierHelperCoversCoreRules();
await testSquadNameClassifierApiReturnsClassification();
await testSquadNameRulesApiReadsAndWritesExactMappings();
await testSquadNamePolicyRoutesExposeTestAndProtectedSave();
await testCombatCleanRoutesDoNotForceCurrentServerFilter();
await testWeaponCollectorApiRequiresGet();
await testGroupReportSnapshotRouteReturnsWrappedSnapshot();
await testSnapshotAllRequiresAuth();
await testSnapshotAllDoesNotTriggerSlowTasks();
await testMatchSnapshotRouteReusesPrebuiltSnapshot();
await testRemoteTelemetryStateRouteUsesModuleState();
await testRemoteTelemetryWriteTicketsRouteDelegatesToModule();
await testMatchRefreshRoutesDelegateToMatchState();
await testSquadLifecycleRouteReturnsCurrentSnapshot();
await testSquadManagementRoutesExposeStateAndMutations();
await testSettingsRoutesRequireAuthAndSuperAdmin();
await testWarmupRoutesExposeStateAndValidateInput();
await testAdminWarnRecentRouteReturnsMemoryRecords();
await testAdminWarnBroadcastRouteReturnsMemoryRecords();
await testCombatLogRoutesExposeLogsAndMetadata();
await testFairTeamBalanceRoutesReturnPluginStateAndRequests();
await testStepwiseSquadPlaytimeGuardRoutesReturnPluginStateAndSimulate();
await testFairSquadGuardRoutesReturnPluginStateAndActions();
await testPjscAverageDurationRouteReturnsPluginState();
await testMatchSnapshotRoutesExposeArtifacts();
await testVueRouteFallsBackToIndexHtml();

console.log("web server tests passed");
