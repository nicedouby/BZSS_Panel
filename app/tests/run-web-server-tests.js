import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { once } from "node:events";

import { WebRegistry } from "../core/web-registry.js";
import { WebServer } from "../core/web-server.js";
import { classifySquadName } from "../core/squad-name-classifier.js";
import { GroupReportService } from "../plugins/group-report.service.js";
import { hasPermission as hasRconPermission } from "../../web-client/src/shared/rcon-permissions.js";
import { createSquadRuleChainModule } from "../modules/squad-rule-chain/index.js";
import { createSquadNamePolicyGuardModule } from "../modules/squad-name-policy-guard/index.js";
import { createPlugin as createStepwisePlugin } from "../plugins/stepwise-squad-playtime-guard.js";
import { createPlugin as createFairPlugin } from "../plugins/fair-squad-guard.js";

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


function createWritableRecorder() {
  const state = { status: null, headers: null, body: "" };
  const res = new Writable({
    write(chunk, _encoding, callback) {
      state.body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk ?? "");
      callback();
    },
  });
  res.writeHead = (status, headers) => {
    state.status = status;
    state.headers = headers;
  };
  return {
    state,
    res,
    async waitForFinish() {
      if (!res.writableFinished) await once(res, "finish");
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

async function testDragCapturePointValidation() {
  const server = createServer();

  assert.equal(
    server.normalizeBzssCoreDirective("DragCapturePoint", "04-SouthSuburbs,150,25").command,
    "DragCapturePoint:04-SouthSuburbs,150,25",
  );
  assert.equal(
    server.normalizeBzssCoreDirective("DragCapturePoint", "Castleview Apartments,-150.5,25.25").command,
    "DragCapturePoint:Castleview Apartments,-150.5,25.25",
  );

  const invalidIndex = server.normalizeBzssCoreDirective("DragCapturePoint", "4,150,25");
  assert.equal(invalidIndex.ok, false);
  assert.equal(invalidIndex.error, "InvalidDragCapturePointName");

  const invalidCoordinates = server.normalizeBzssCoreDirective("DragCapturePoint", "04-SouthSuburbs,NaN,25");
  assert.equal(invalidCoordinates.ok, false);
  assert.equal(invalidCoordinates.error, "InvalidDragCapturePointCoordinates");

  const invalidRaw = server.normalizeBzssCoreCommand({
    raw: true,
    command: "DragCapturePoint:04-SouthSuburbs,Infinity,25",
  });
  assert.equal(invalidRaw.ok, false);
  assert.equal(invalidRaw.error, "InvalidDragCapturePointCoordinates");
}

async function testAutomaticHealUsesBinaryParameter() {
  const server = createServer();
  assert.equal(server.normalizeBzssCoreDirective("SetAutomaticHeal", "1").command, "SetAutomaticHeal:1");
  assert.equal(server.normalizeBzssCoreDirective("SetAutomaticHeal", "0").command, "SetAutomaticHeal:0");
  const invalid = server.normalizeBzssCoreDirective("SetAutomaticHeal", "false");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error, "InvalidAutomaticHealParameter");
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

async function testSquadNameTrackingStateRespectsChainAndWhitelistRules() {
  const eventBus = {
    handlers: new Map(),
    onModuleEvent(moduleId, eventName, handler) {
      const key = `${moduleId}:${eventName}`;
      this.handlers.set(key, handler);
      return () => this.handlers.delete(key);
    },
    emitModuleEvent(moduleId, eventName, event) {
      this.handlers.get(`${moduleId}:${eventName}`)?.(event);
    },
  };

  const core = {
    eventBus,
    webStatus: {
      serverId: "server-1",
      getSnapshot() {
        return { serverId: "server-1", isWarmup: false, logClockSeconds: 10, logClockHasAnchor: true, playerCount: 60 };
      },
    },
    webRegistry: { registerPage() {} },
    logger: { info() {}, warn() {}, error() {} },
    createLogger() { return { info() {}, warn() {}, error() {} }; },
    pluginSubscriptions: { isSubscribed() { return true; } },
  };

  const modules = {
    adminWarn: {
      async sendAdminWarn() { return { success: true }; },
      async broadcastMessage() { return { success: true }; },
    },
    squadManagement: {
      async requestDisband() { return { ok: true }; },
      async requestRemoveFromSquad() { return { ok: true }; },
    },
    playtime: {
      async getBySteamID() { return { game_seconds: 1000 * 3600 }; },
      async lookupSteamID() { return null; },
    },
    playerDatabase: {
      async getCachedPlayer() { return null; },
    },
  };

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-squad-name-tracking-"));
  const config = {
    get(key, fallback) {
      if (key === "modules.squadNamePolicyGuard") {
        return { enabled: true, detectLogCreated: true, action: "disband_then_warn", warningRepeatCount: 1 };
      }
      if (key === "plugins.stepwiseSquadPlaytimeGuard") {
        return {
          enabled: true,
          directory: path.join(tempDir, "stepwise"),
          broadcastOnApproved: false,
          warnOnMissingPlaytime: false,
          liveLookupWhenMissing: false,
          rules: [],
        };
      }
      if (key === "plugins.fairSquadGuard") {
        return {
          enabled: true,
          directory: path.join(tempDir, "fair"),
          enforcementPlayerThreshold: 50,
          noSquadCreationSeconds: 20,
          infantryOnlyUntilSeconds: 50,
          broadcastOnApproved: false,
          broadcastOnViolation: false,
        };
      }
      return fallback;
    },
  };

  const ruleChain = createSquadRuleChainModule({ core, modules, config, logger: { info() {}, warn() {}, error() {} } });
  const nameGuard = createSquadNamePolicyGuardModule({ core, modules, config, logger: { info() {}, warn() {}, error() {} } });
  const stepwise = createStepwisePlugin({ core, modules, config, logger: { info() {}, warn() {}, error() {} } });
  const fair = createFairPlugin({ core, modules, config, logger: { info() {}, warn() {}, error() {} } });

  await ruleChain.start();
  await nameGuard.start();
  await stepwise.init();
  await stepwise.start();
  await fair.init();
  await fair.start();

  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "admin", role: "SuperAdmin", isSuperAdmin: true };
        },
      },
      webStatus: core.webStatus,
      webRegistry: core.webRegistry,
      pluginManager: {
        instances: [
          {
            manifest: { id: "plugin.stepwiseSquadPlaytimeGuard" },
            api: stepwise.api,
          },
          {
            manifest: { id: "plugin.fairSquadGuard" },
            api: fair.api,
          },
        ],
      },
    },
    modules: {
      squadLifecycle: {
        getCurrent() {
          return {
            serverId: "server-1",
            matchId: "match-1",
            updatedAt: new Date().toISOString(),
            list: [
              {
                key: "k1",
                serverId: "server-1",
                matchId: "match-1",
                teamId: 2,
                squadId: 6,
                squadName: "Squad 6",
                creatorName: "Donald·DoubyBear",
                createdAtMs: Date.now(),
                creationSource: "LOG",
                sourceLabel: "日志确认",
                squadNature: "infantry",
                squadNatureLabel: "普通步兵",
              },
            ],
          };
        },
      },
      squadNamePolicyGuard: nameGuard.api,
      squadNamePolicyPatrol: {
        getState() {
          return { enabled: true, recent: [] };
        },
      },
      squadRuleChain: ruleChain.api,
    },
  });

  try {
    eventBus.emitModuleEvent("module.squadLifecycle", "squadCreated", {
      serverId: "server-1",
      matchId: "match-1",
      teamId: 2,
      squadId: 6,
      squadName: "Squad 6",
      creatorName: "Donald·DoubyBear",
      leaderName: "Donald·DoubyBear",
      leaderSteamId: "steam-1",
      createdAt: new Date().toISOString(),
    });

    await new Promise((resolve) => setTimeout(resolve, 80));

    const recorder = createRecorder();
    await server.handleRequest({
      method: "GET",
      url: "/api/squad-name-tracking/state",
      headers: { host: "localhost" },
      socket: {},
    }, recorder.res);

    assert.equal(recorder.state.status, 200);
    const body = JSON.parse(recorder.state.body);
    assert.equal(body.data.records.length >= 1, true);
    const nameRecord = body.data.records.find((item) => item.source === "squad_name_rule");
    assert.equal(Boolean(nameRecord), true);
    assert.equal(nameRecord.canWhitelist, true);

    const stepwiseRecord = body.data.records.find((item) => item.source === "tiered_squad_time");
    if (stepwiseRecord) {
      assert.equal(stepwiseRecord.canWhitelist, false);
    }
    const fairRecord = body.data.records.find((item) => item.source === "fair_squad_creation");
    if (fairRecord) {
      assert.equal(fairRecord.canWhitelist, false);
    }
  } finally {
    await fair.stop();
    await stepwise.stop();
    await nameGuard.stop();
    await ruleChain.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
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
  assert.equal(sessionBody.user.steam64, "76561198194428818");
  assert.equal(sessionBody.user.steamAvatar, undefined);

  const profileRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/auth/me/profile",
    headers: { host: "localhost" },
    socket: {},
  }, profileRecorder.res);

  assert.equal(profileRecorder.state.status, 200);
  const profileBody = JSON.parse(profileRecorder.state.body);
  assert.equal(profileBody.user.steamAvatar, avatarUrl);

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

async function testTacticalMapViewerPresenceTracksDistinctAccounts() {
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest(req) {
          return req.headers.authorization ? { id: req.headers.authorization } : null;
        },
      },
    },
  });

  async function request(method, authorization, sessionId) {
    const recorder = createRecorder();
    const request = Readable.from(method === "POST" ? [JSON.stringify({ sessionId })] : []);
    request.method = method;
    request.url = method === "DELETE"
      ? `/api/tactical-map/viewers?sessionId=${encodeURIComponent(sessionId)}`
      : "/api/tactical-map/viewers";
    request.headers = { host: "localhost", authorization };
    request.socket = {};
    await server.handleRequest(request, recorder.res);
    assert.equal(recorder.state.status, 200);
    return JSON.parse(recorder.state.body).viewerCount;
  }

  assert.equal(await request("POST", "alpha", "alpha_first"), 1);
  assert.equal(await request("POST", "alpha", "alpha_second"), 1);
  assert.equal(await request("POST", "bravo", "bravo_first"), 2);
  assert.equal(await request("DELETE", "alpha", "alpha_first"), 2);
  assert.equal(await request("DELETE", "alpha", "alpha_second"), 1);

  server.tacticalMapViewers.set("stale", new Map([["stale_session", Date.now() - 46 * 1000]]));
  assert.equal(await request("POST", "bravo", "bravo_first"), 1);
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
  assert.equal(classifySquadName("后勤支援").category, "logistics");
  assert.equal(classifySquadName("后勤队").category, "logistics");
  assert.equal(classifySquadName("Alpha").category, "other");
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
  const initialState = JSON.parse(stateRecorder.state.body);
  assert.equal(initialState.version, 2);
  assert.equal(initialState.stats.entries >= 2, true);

  const testRecorder = createRecorder();
  const testReq = Readable.from([JSON.stringify({ name: "BMP队" })]);
  testReq.method = "POST";
  testReq.url = "/api/squad-name-policy/test";
  testReq.headers = { host: "localhost", "content-type": "application/json" };
  testReq.socket = {};
  await viewerServer.handleRequest(testReq, testRecorder.res);
  assert.equal(testRecorder.state.status, 200);
  const testBody = JSON.parse(testRecorder.state.body);
  assert.equal(testBody.valid, true);
  assert.equal(testBody.classification.typeId, "ifv");
  assert.equal(testBody.matched.matchedKind, "suffix");

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
    version: 2,
    revision: initialState.revision,
    suggestionLimit: 3,
    types: initialState.types,
    entries: [
      {
        id: "tank",
        typeId: "tank",
        faction: "ADF",
        legacyVehicleType: "MBT",
        asset: "/Game/Vehicles/AUS_M1A1/BP_AUS_M1A1.BP_AUS_M1A1",
        name: "M1A1",
        aliases: ["Abrams"],
        keywords: ["TANK"],
        enabled: true,
        priority: 100,
        source: "manual",
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
  assert.equal(saveBody.revision, initialState.revision + 1);
  const savedRaw = JSON.parse(await fs.readFile(policyPath, "utf8"));
  assert.equal(savedRaw.entries[0].name, "M1A1");
  assert.equal(savedRaw.version, 2);
  assert.equal(Array.isArray(savedRaw.types), true);

  const staleRecorder = createRecorder();
  const staleReq = Readable.from([JSON.stringify({
    revision: initialState.revision,
    types: saveBody.types,
    entries: saveBody.entries,
  })]);
  staleReq.method = "POST";
  staleReq.url = "/api/squad-name-policy/state";
  staleReq.headers = { host: "localhost", "content-type": "application/json" };
  staleReq.socket = {};
  await adminServer.handleRequest(staleReq, staleRecorder.res);
  assert.equal(staleRecorder.state.status, 409);

  const validateRecorder = createRecorder();
  const validateReq = Readable.from([JSON.stringify({
    version: 2,
    revision: saveBody.revision,
    types: saveBody.types,
    entries: [{
      ...saveBody.entries[0],
      id: "invalid-infantry-asset",
      name: "Invalid Infantry",
      typeId: "infantry",
      asset: "/Game/Invalid",
    }],
  })]);
  validateReq.method = "POST";
  validateReq.url = "/api/squad-name-policy/validate";
  validateReq.headers = { host: "localhost", "content-type": "application/json" };
  validateReq.socket = {};
  await adminServer.handleRequest(validateReq, validateRecorder.res);
  assert.equal(validateRecorder.state.status, 422);
  assert.equal(JSON.parse(validateRecorder.state.body).errors.some((item) => item.code === "non_vehicle_asset"), true);

  const whitelistRecorder = createRecorder();
  const whitelistReq = Readable.from([JSON.stringify({
    name: "ZCC",
    nature: "vehicle",
    allowSquadSuffix: true,
  })]);
  whitelistReq.method = "POST";
  whitelistReq.url = "/api/squad-name-policy/whitelist";
  whitelistReq.headers = { host: "localhost", "content-type": "application/json" };
  whitelistReq.socket = {};
  await adminServer.handleRequest(whitelistReq, whitelistRecorder.res);
  assert.equal(whitelistRecorder.state.status, 200);
  const whitelistBody = JSON.parse(whitelistRecorder.state.body);
  assert.equal(whitelistBody.ok, true);
  assert.equal(whitelistBody.evaluation.valid, true);
  assert.equal(whitelistBody.evaluation.classification.nature, "vehicle");
  const whitelistRaw = JSON.parse(await fs.readFile(policyPath, "utf8"));
  assert.equal(whitelistRaw.entries.some((entry) => entry.name === "ZCC" && entry.source === "squad_name_tracking_whitelist"), true);
}

async function testSquadNamePolicyGuardRoutesExposeStateSimulateAndProtectedClear() {
  const simulateCalls = [];
  const clearCalls = [];
  const viewerServer = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "viewer", role: "Operator" };
        },
        hasEverything() {
          return false;
        },
      },
    },
    modules: {
      squadNamePolicyGuard: {
        getState() {
          return {
            enabled: true,
            detectLogCreated: true,
            action: "disband_then_warn",
            dedupeTtlMs: 300000,
            stats: {
              evaluated: 2,
              violations: 1,
              disbanded: 1,
              disbandFailed: 0,
              warningsSent: 2,
              warningsSkipped: 0,
              duplicatesSkipped: 0,
              errors: 0,
            },
            recent: [],
          };
        },
        async simulate(payload) {
          simulateCalls.push(payload);
          return {
            violation: true,
            action: "disband_then_warn",
            warningMessages: [
              "警告违规队名！\n本服对队名要求十分严格。",
              "警告你可能想建立 BMP-1 BMP-2 队。",
            ],
          };
        },
        clearRecent() {
          clearCalls.push(true);
          return { ok: true, cleared: 3 };
        },
      },
    },
  });

  const stateRecorder = createRecorder();
  await viewerServer.handleRequest({
    method: "GET",
    url: "/api/modules/squad-name-policy-guard/state",
    headers: { host: "localhost" },
    socket: {},
  }, stateRecorder.res);
  assert.equal(stateRecorder.state.status, 200);
  const stateBody = JSON.parse(stateRecorder.state.body);
  assert.equal(stateBody.ok, true);
  assert.equal(stateBody.data.stats.violations, 1);

  const simulateRecorder = createRecorder();
  const simulateReq = Readable.from([JSON.stringify({
    squadName: "BMP队",
    creatorName: "Leader",
    teamId: 1,
    squadId: 3,
  })]);
  simulateReq.method = "POST";
  simulateReq.url = "/api/modules/squad-name-policy-guard/simulate";
  simulateReq.headers = { host: "localhost", "content-type": "application/json" };
  simulateReq.socket = {};
  await viewerServer.handleRequest(simulateReq, simulateRecorder.res);
  assert.equal(simulateRecorder.state.status, 200);
  const simulateBody = JSON.parse(simulateRecorder.state.body);
  assert.equal(simulateBody.ok, true);
  assert.equal(simulateCalls.length, 1);
  assert.equal(simulateCalls[0].squadName, "BMP队");
  assert.equal(simulateBody.data.warningMessages[0], "警告违规队名！\n本服对队名要求十分严格。");

  const forbiddenRecorder = createRecorder();
  await viewerServer.handleRequest({
    method: "POST",
    url: "/api/modules/squad-name-policy-guard/clear",
    headers: { host: "localhost" },
    socket: {},
  }, forbiddenRecorder.res);
  assert.equal(forbiddenRecorder.state.status, 403);
  assert.equal(clearCalls.length, 0);

  const adminServer = createServer({
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
      squadNamePolicyGuard: {
        getState() {
          return { enabled: true, stats: {}, recent: [] };
        },
        async simulate(payload) {
          simulateCalls.push(payload);
          return { violation: false, action: "disband_then_warn", warningMessages: [] };
        },
        clearRecent() {
          clearCalls.push(true);
          return { ok: true, cleared: 3 };
        },
      },
    },
  });

  const clearRecorder = createRecorder();
  await adminServer.handleRequest({
    method: "POST",
    url: "/api/modules/squad-name-policy-guard/clear",
    headers: { host: "localhost" },
    socket: {},
  }, clearRecorder.res);
  assert.equal(clearRecorder.state.status, 200);
  const clearBody = JSON.parse(clearRecorder.state.body);
  assert.equal(clearBody.ok, true);
  assert.equal(clearBody.data.cleared, 3);
  assert.equal(clearCalls.length, 1);
}

async function testSquadNamePolicyPatrolRoutesExposeStateSimulateAndProtectedClear() {
  const simulateCalls = [];
  const clearCalls = [];
  const viewerServer = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "viewer", role: "Operator" };
        },
        hasEverything() {
          return false;
        },
      },
    },
    modules: {
      squadNamePolicyPatrol: {
        getState() {
          return {
            enabled: true,
            intervalMs: 15000,
            dedupeTtlMs: 60000,
            stats: {
              evaluated: 2,
              violations: 1,
              allowed: 1,
              duplicatesSkipped: 0,
              errors: 0,
            },
            recent: [],
          };
        },
        async simulate(payload) {
          simulateCalls.push(payload);
          return {
            violation: true,
            disposition: "flag_only",
            evaluation: { valid: false },
          };
        },
        clearRecent() {
          clearCalls.push(true);
          return { ok: true, cleared: 2 };
        },
      },
    },
  });

  const stateRecorder = createRecorder();
  await viewerServer.handleRequest({
    method: "GET",
    url: "/api/modules/squad-name-policy-patrol/state",
    headers: { host: "localhost" },
    socket: {},
  }, stateRecorder.res);
  assert.equal(stateRecorder.state.status, 200);
  const stateBody = JSON.parse(stateRecorder.state.body);
  assert.equal(stateBody.ok, true);
  assert.equal(stateBody.data.stats.violations, 1);
  assert.equal(stateBody.data.intervalMs, 15000);

  const simulateRecorder = createRecorder();
  const simulateReq = Readable.from([JSON.stringify({
    squadName: "BMP队",
    creatorName: "Leader",
    teamId: 1,
    squadId: 3,
  })]);
  simulateReq.method = "POST";
  simulateReq.url = "/api/modules/squad-name-policy-patrol/simulate";
  simulateReq.headers = { host: "localhost", "content-type": "application/json" };
  simulateReq.socket = {};
  await viewerServer.handleRequest(simulateReq, simulateRecorder.res);
  assert.equal(simulateRecorder.state.status, 200);
  const simulateBody = JSON.parse(simulateRecorder.state.body);
  assert.equal(simulateBody.ok, true);
  assert.equal(simulateCalls.length, 1);
  assert.equal(simulateCalls[0].squadName, "BMP队");
  assert.equal(simulateBody.data.disposition, "flag_only");

  const forbiddenRecorder = createRecorder();
  await viewerServer.handleRequest({
    method: "POST",
    url: "/api/modules/squad-name-policy-patrol/clear",
    headers: { host: "localhost" },
    socket: {},
  }, forbiddenRecorder.res);
  assert.equal(forbiddenRecorder.state.status, 403);
  assert.equal(clearCalls.length, 0);

  const adminServer = createServer({
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
      squadNamePolicyPatrol: {
        getState() {
          return { enabled: true, stats: {}, recent: [] };
        },
        async simulate(payload) {
          simulateCalls.push(payload);
          return { violation: false, disposition: "allow" };
        },
        clearRecent() {
          clearCalls.push(true);
          return { ok: true, cleared: 2 };
        },
      },
    },
  });

  const clearRecorder = createRecorder();
  await adminServer.handleRequest({
    method: "POST",
    url: "/api/modules/squad-name-policy-patrol/clear",
    headers: { host: "localhost" },
    socket: {},
  }, clearRecorder.res);
  assert.equal(clearRecorder.state.status, 200);
  const clearBody = JSON.parse(clearRecorder.state.body);
  assert.equal(clearBody.ok, true);
  assert.equal(clearBody.data.cleared, 2);
  assert.equal(clearCalls.length, 1);
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

async function testCombatRecordsRouteReadsCollectorWithTraceFilters() {
  const calls = [];
  const overview = {
    count: 3,
    damage: 1,
    wound: 1,
    death: 1,
    nullptrActors: 1,
    nullptrWeapons: 1,
    replay: { status: "completed", progress: 100 },
  };
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() { return { username: "viewer", role: "Operator" }; },
      },
    },
    modules: {
      combatCollector: {
        getRecords(filter) {
          calls.push(filter);
          return {
            total: 1,
            records: [{
              id: "combat:death:file:42",
              type: "death",
              attacker: { name: null, nameState: "nullptr" },
              victim: { name: "Victim", nameState: "present" },
              weapon: null,
              weaponState: "nullptr",
              sourceFile: "SquadGame.log",
              sourceOffset: 42,
            }],
          };
        },
        getOverview() { return overview; },
      },
    },
  });

  const recorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/combat-records?type=death&sourceMode=replay&search=nullptr&offset=10&limit=25",
    headers: { host: "localhost" },
    socket: {},
  }, recorder.res);

  assert.equal(recorder.state.status, 200);
  const body = JSON.parse(recorder.state.body);
  assert.equal(body.ok, true);
  assert.equal(body.total, 1);
  assert.equal(body.records[0].attacker.nameState, "nullptr");
  assert.equal(body.records[0].sourceOffset, 42);
  assert.deepEqual(body.overview, overview);
  assert.deepEqual(calls, [{
    serverId: "",
    sourceMode: "replay",
    type: "death",
    search: "nullptr",
    offset: "10",
    limit: "25",
  }]);
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

async function testRemoteTelemetryWriteTicketsRouteEnforcesPermission() {
  let receivedPayload = null;
  const createTestServer = (permissions = [], isSuperAdmin = false) => {
    return createServer({
      core: {
        authManager: {
          getUserFromRequest() {
            return { username: "operator", role: isSuperAdmin ? "SuperAdmin" : "Admin", permissions };
          },
          hasEverything(user) {
            return Boolean(user?.role === "SuperAdmin");
          },
          hasPermission(user, permission) {
            if (!user) return false;
            if (user.role === "SuperAdmin") return true;
            return (user.permissions || []).includes(permission);
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
  };

  // Case 1: user has rcon.settickets permission but not SuperAdmin -> 200
  {
    const server = createTestServer(["rcon.settickets"]);
    const recorder = createRecorder();
    const req = Readable.from([JSON.stringify({ t1: 300, t2: 250 })]);
    req.method = "POST";
    req.url = "/api/remote-telemetry/write-tickets";
    req.headers = { host: "localhost" };
    req.socket = {};
    await server.handleRequest(req, recorder.res);

    assert.equal(recorder.state.status, 200);
    const body = JSON.parse(recorder.state.body);
    assert.equal(body.ok, true);
  }

  // Case 2: user lacks rcon.settickets permission -> 403
  {
    const server = createTestServer(["rcon.kick"]);
    const recorder = createRecorder();
    const req = Readable.from([JSON.stringify({ t1: 300, t2: 250 })]);
    req.method = "POST";
    req.url = "/api/remote-telemetry/write-tickets";
    req.headers = { host: "localhost" };
    req.socket = {};
    await server.handleRequest(req, recorder.res);

    assert.equal(recorder.state.status, 403);
    const body = JSON.parse(recorder.state.body);
    assert.equal(body.error, "Forbidden");
  }
}

async function testLogPostEndpointsExposeTailerStateAndQueries() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-logpost-web-"));
  const outputDir = path.join(tempDir, "LogPost");
  await fs.mkdir(path.join(outputDir, ".state"), { recursive: true });
  await fs.mkdir(path.join(outputDir, "Raw", "2026-06-22"), { recursive: true });
  await fs.mkdir(path.join(outputDir, "2026-06-22"), { recursive: true });
  await fs.writeFile(
    path.join(outputDir, ".state", "tailer-state.json"),
    JSON.stringify({ sourcePath: "SquadGame.log", fileId: "f1", offset: 128, seq: 7, updatedAt: "2026-06-22 10:00:00.000" }),
  );
  await fs.writeFile(
    path.join(outputDir, "Raw", "2026-06-22", "all.jsonl"),
    `${JSON.stringify({
      seq: 7,
      offset: 128,
      readAt: "2026-06-22T10:00:00.000Z",
      logTime: "2026.06.22-10.00.00:000",
      rawLine: "[2026.06.22-10.00.00:000]LogTest: raw",
      rawLineHash: "abc123",
      sourcePath: "SquadGame.log",
    })}\n`,
  );
  await fs.writeFile(
    path.join(outputDir, "2026-06-22", "All.jsonl"),
    `${JSON.stringify({
      Version: "1",
      Event: "On_TestEvent",
      Time: "2026-06-22T10:00:01.000Z",
      SourceSeq: "7",
      SourceOffset: "128",
      RawLineHash: "abc123",
      Raw: "raw",
    })}\n`,
  );

  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "admin", role: "SuperAdmin", isSuperAdmin: true };
        },
        hasEverything(user) {
          return user?.isSuperAdmin === true;
        },
      },
      config: {
        get(key, fallback) {
          if (key === "pythonLogParser") {
            return {
              workingDirectory: tempDir,
            };
          }
          return fallback;
        },
      },
      logPostMonitor: {
        getState() {
          return {
            lastSourceSeq: 9,
            lastEventId: "evt-9",
            recentGaps: [
              {
                eventName: "LOGPOST_GAP_DETECTED",
                time: "2026-06-22T10:05:00.000Z",
                payload: { expectedSourceSeq: 8, actualSourceSeq: 9, previousEventId: "evt-7", currentEventId: "evt-9" },
              },
            ],
          };
        },
      },
    },
  });

  try {
    const stateRecorder = createRecorder();
    await server.handleRequest({
      method: "GET",
      url: "/api/logpost/state",
      headers: { host: "localhost" },
      socket: {},
    }, stateRecorder.res);
    assert.equal(stateRecorder.state.status, 200);
    const stateBody = JSON.parse(stateRecorder.state.body);
    assert.equal(stateBody.tailerState.seq, 7);
    assert.equal(stateBody.gapState.lastSourceSeq, 9);

    const rawRecorder = createRecorder();
    await server.handleRequest({
      method: "GET",
      url: "/api/logpost/raw?date=2026-06-22&q=abc123",
      headers: { host: "localhost" },
      socket: {},
    }, rawRecorder.res);
    assert.equal(rawRecorder.state.status, 200);
    const rawBody = JSON.parse(rawRecorder.state.body);
    assert.equal(rawBody.items.length, 1);
    assert.equal(rawBody.items[0].seq, 7);

    const eventRecorder = createRecorder();
    await server.handleRequest({
      method: "GET",
      url: "/api/logpost/events?date=2026-06-22&event=On_TestEvent",
      headers: { host: "localhost" },
      socket: {},
    }, eventRecorder.res);
    assert.equal(eventRecorder.state.status, 200);
    const eventBody = JSON.parse(eventRecorder.state.body);
    assert.equal(eventBody.items.length, 1);
    assert.equal(eventBody.items[0].Event, "On_TestEvent");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testRemoteTelemetryAdjustTicketsRouteEnforcesPermission() {
  let receivedPayload = null;
  const createTestServer = (permissions = [], isSuperAdmin = false) => {
    return createServer({
      core: {
        authManager: {
          getUserFromRequest() {
            return { username: "operator", role: isSuperAdmin ? "SuperAdmin" : "Admin", permissions };
          },
          hasEverything(user) {
            return Boolean(user?.role === "SuperAdmin");
          },
          hasPermission(user, permission) {
            if (!user) return false;
            if (user.role === "SuperAdmin") return true;
            return (user.permissions || []).includes(permission);
          },
        },
      },
      modules: {
        remoteTelemetry: {
          async adjustTickets(payload) {
            receivedPayload = payload;
            return {
              ok: true,
              pid: 2952,
              mode: "adjust",
              before: { t1: 20, t2: 30 },
              delta: { t1: 50, t2: 0 },
              after: { t1: 70, t2: 30 },
            };
          },
        },
      },
    });
  };

  {
    const server = createTestServer(["rcon.settickets"]);
    const recorder = createRecorder();
    const req = Readable.from([JSON.stringify({ addT1: 50 })]);
    req.method = "POST";
    req.url = "/api/remote-telemetry/adjust-tickets";
    req.headers = { host: "localhost" };
    req.socket = {};
    await server.handleRequest(req, recorder.res);

    assert.equal(recorder.state.status, 200);
    const body = JSON.parse(recorder.state.body);
    assert.deepEqual(receivedPayload, { addT1: 50 });
    assert.equal(body.ok, true);
    assert.equal(body.after.t1, 70);
  }

  {
    const server = createTestServer(["rcon.kick"]);
    const recorder = createRecorder();
    const req = Readable.from([JSON.stringify({ addT1: 50 })]);
    req.method = "POST";
    req.url = "/api/remote-telemetry/adjust-tickets";
    req.headers = { host: "localhost" };
    req.socket = {};
    await server.handleRequest(req, recorder.res);

    assert.equal(recorder.state.status, 403);
    const body = JSON.parse(recorder.state.body);
    assert.equal(body.error, "Forbidden");
  }
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

async function testPanelBanRoutesReturnPluginStateAndCrud() {
  const calls = [];
  const statePayload = {
    enabled: true,
    entries: [{ id: "ban-1", steamID: "76561198000000001" }],
    recentHits: [],
    recentEvents: [],
    totalEntries: 1,
    activeEntries: 1,
    disabledEntries: 0,
    expiredEntries: 0,
    kickAttempts: 0,
    kickSuccess: 0,
    kickFailed: 0,
  };
  const server = createServer({
    core: {
      webStatus: { serverId: "BZSS_Main" },
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
            manifest: { id: "plugin.panelBan" },
            api: {
              getState() {
                calls.push("getState");
                return statePayload;
              },
              listEntries(filter) {
                calls.push(`listEntries:${JSON.stringify(filter)}`);
                return statePayload.entries;
              },
              async createEntry(payload) {
                calls.push(`createEntry:${JSON.stringify(payload)}`);
                return { id: "ban-2", ...payload };
              },
              async updateEntry(id, payload) {
                calls.push(`updateEntry:${id}:${JSON.stringify(payload)}`);
                return { id, ...payload };
              },
              async deleteEntry(id, payload) {
                calls.push(`deleteEntry:${id}:${JSON.stringify(payload)}`);
                return { id, deleted: true, ...payload };
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
    url: "/api/plugins/panel-ban/state",
    headers: { host: "localhost" },
    socket: {},
  }, stateRecorder.res);
  assert.equal(stateRecorder.state.status, 200);
  assert.equal(JSON.parse(stateRecorder.state.body).data.totalEntries, 1);

  const listRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/plugins/panel-ban/entries?status=active&search=steam",
    headers: { host: "localhost" },
    socket: {},
  }, listRecorder.res);
  assert.equal(listRecorder.state.status, 200);
  assert.equal(JSON.parse(listRecorder.state.body).data[0].id, "ban-1");
  assert.ok(calls.some((value) => value.includes("\"status\":\"active\"")));

  const createRecorderRef = createRecorder();
  const createReq = Readable.from([JSON.stringify({
    steamID: "76561198000000002",
    reason: "test reason",
    expiresAt: "2026-07-01T00:00:00.000Z",
  })]);
  createReq.method = "POST";
  createReq.url = "/api/plugins/panel-ban/entries";
  createReq.headers = { host: "localhost", "content-type": "application/json" };
  createReq.socket = {};
  await server.handleRequest(createReq, createRecorderRef.res);
  assert.equal(createRecorderRef.state.status, 200);
  assert.ok(calls.some((value) => value.includes("createEntry:")));
  assert.ok(calls.some((value) => value.includes("\"createdBy\":\"admin\"")));

  const patchRecorder = createRecorder();
  const patchReq = Readable.from([JSON.stringify({
    status: "disabled",
    expiresAt: "2026-07-01T00:00:00.000Z",
  })]);
  patchReq.method = "PATCH";
  patchReq.url = "/api/plugins/panel-ban/entries/ban-1";
  patchReq.headers = { host: "localhost", "content-type": "application/json" };
  patchReq.socket = {};
  await server.handleRequest(patchReq, patchRecorder.res);
  assert.equal(patchRecorder.state.status, 200);
  assert.ok(calls.some((value) => value.startsWith("updateEntry:ban-1:")));

  const deleteRecorderRef = createRecorder();
  await server.handleRequest({
    method: "DELETE",
    url: "/api/plugins/panel-ban/entries/ban-1",
    headers: { host: "localhost" },
    socket: {},
  }, deleteRecorderRef.res);
  assert.equal(deleteRecorderRef.state.status, 200);
  assert.ok(calls.some((value) => value.startsWith("deleteEntry:ban-1:")));
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

async function testMatchEndSnapshotRoutesStaySeparateFromImageSnapshots() {
  const calls = [];
  const server = createServer({
    core: {
      authManager: {
        getUserFromRequest() {
          return { username: "admin", isSuperAdmin: true };
        },
        hasEverything() {
          return true;
        },
      },
      pluginManager: {
        instances: [
          {
            manifest: { id: "match-end-snapshot" },
            api: {
              async listSnapshots() {
                return [{ id: "End-Test", map: "Tallil", nextMap: "Fallujah", playerCount: 12, queueCount: 3 }];
              },
              async takeManualSnapshot(options) {
                calls.push("capture:" + JSON.stringify(options ?? {}));
                return { id: "End-Test" };
              },
              async readSnapshot(id) {
                calls.push("read:" + id);
                return { snapshotType: "match-end-data", players: [{ name: "Alpha" }] };
              },
              async readSnapshotImage(id) {
                calls.push("image:" + id);
                return {
                  id,
                  fileName: id + ".png",
                  contentType: "image/png",
                  content: Buffer.from([137, 80, 78, 71]),
                };
              },
              async readSnapshotThumbnail(id) {
                calls.push("thumbnail:" + id);
                return {
                  id,
                  fileName: id + "-thumb.png",
                  contentType: "image/png",
                  content: Buffer.from([137, 80, 78, 71]),
                };
              },
              async getStatistics() {
                return { total: 1, size: 1024, thisMonth: 1, averageSize: 1024, earliest: "2026-07-30T00:00:00.000Z" };
              },
              async deleteSnapshots(records) {
                calls.push("delete-batch:" + records.map((item) => item.id).join(","));
                return { requested: records.length, removed: records.length, results: [] };
              },
              async deleteSnapshot(id) {
                calls.push("delete:" + id);
                return { id, removed: true };
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
    url: "/api/match-end-snapshot/list",
    headers: { host: "localhost" },
    socket: {},
  }, listRecorder.res);
  assert.equal(listRecorder.state.status, 200);
  assert.equal(JSON.parse(listRecorder.state.body)[0].id, "End-Test");

  const viewRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/match-end-snapshot/view?id=End-Test",
    headers: { host: "localhost" },
    socket: {},
  }, viewRecorder.res);
  assert.equal(viewRecorder.state.status, 200);
  assert.equal(JSON.parse(viewRecorder.state.body).snapshotType, "match-end-data");
  assert.ok(calls.includes("read:End-Test"));

  const imageRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/match-end-snapshot/image?id=End-Test",
    headers: { host: "localhost" },
    socket: {},
  }, imageRecorder.res);
  assert.equal(imageRecorder.state.status, 200);
  assert.equal(imageRecorder.state.headers["Content-Type"], "image/png");
  assert.ok(calls.includes("image:End-Test"));

  const thumbnailRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/match-end-snapshot/thumbnail?id=End-Test&scope=debug",
    headers: { host: "localhost" },
    socket: {},
  }, thumbnailRecorder.res);
  assert.equal(thumbnailRecorder.state.status, 200);
  assert.ok(calls.includes("thumbnail:End-Test"));

  const statisticsRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/match-end-snapshot/statistics?scope=all",
    headers: { host: "localhost" },
    socket: {},
  }, statisticsRecorder.res);
  assert.equal(statisticsRecorder.state.status, 200);
  assert.equal(JSON.parse(statisticsRecorder.state.body).total, 1);

  const captureRecorder = createRecorder();
  const captureReq = Readable.from([JSON.stringify({ overview: { serverId: "server-1" } })]);
  captureReq.method = "POST";
  captureReq.url = "/api/match-end-snapshot/capture";
  captureReq.headers = { host: "localhost", "content-type": "application/json" };
  captureReq.socket = {};
  await server.handleRequest(captureReq, captureRecorder.res);
  assert.equal(captureRecorder.state.status, 200);
  assert.equal(JSON.parse(captureRecorder.state.body).snapshot.id, "End-Test");
  assert.ok(calls.some((item) => item.startsWith("capture:")));

  const batchRecorder = createRecorder();
  const batchReq = Readable.from([JSON.stringify({ records: [{ id: "End-Test", scope: "official" }] })]);
  batchReq.method = "POST";
  batchReq.url = "/api/match-end-snapshot/delete-batch";
  batchReq.headers = { host: "localhost", "content-type": "application/json" };
  batchReq.socket = {};
  await server.handleRequest(batchReq, batchRecorder.res);
  assert.equal(batchRecorder.state.status, 200);
  assert.ok(calls.includes("delete-batch:End-Test"));

  const deleteRecorder = createRecorder();
  await server.handleRequest({
    method: "DELETE",
    url: "/api/match-end-snapshot/delete?id=End-Test",
    headers: { host: "localhost" },
    socket: {},
  }, deleteRecorder.res);
  assert.equal(deleteRecorder.state.status, 200);
  assert.ok(calls.includes("delete:End-Test"));
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

  const assetRecorder = createWritableRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/assets.txt",
    headers: { host: "localhost" },
    socket: {},
  }, assetRecorder.res);
  await assetRecorder.waitForFinish();

  assert.equal(assetRecorder.state.status, 200);
  assert.equal(assetRecorder.state.body, "asset");
  assert.equal(assetRecorder.state.headers["Accept-Ranges"], undefined);

  const headRecorder = createRecorder();
  await server.handleRequest({
    method: "HEAD",
    url: "/assets.txt",
    headers: { host: "localhost" },
    socket: {},
  }, headRecorder.res);
  assert.equal(headRecorder.state.status, 200);
  assert.equal(headRecorder.state.body, "");
  assert.equal(headRecorder.state.headers["Content-Length"], 5);
  assert.ok(headRecorder.state.headers.ETag);

  const cachedRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/assets.txt",
    headers: { host: "localhost", "if-none-match": headRecorder.state.headers.ETag },
    socket: {},
  }, cachedRecorder.res);
  assert.equal(cachedRecorder.state.status, 304);
  assert.equal(cachedRecorder.state.body, "");

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
  const captureReq = Readable.from([JSON.stringify({
    includeSteamID: false,
    includeEOSID: true,
    overview: {
      status: { serverId: "server-1", queueCount: 4 },
      matchState: {
        serverStatus: { serverId: "server-1", playerCount: 12, queueCount: 4 },
        match: { map: "Test", layer: "Test_RAAS_v1" },
        players: { list: [] },
        squads: { list: [] },
      },
      match: { map: "Test", layer: "Test_RAAS_v1" },
      players: [],
      squads: [],
      serverId: "server-1",
    },
  })]);
  captureReq.method = "POST";
  captureReq.url = "/api/match-snapshot/capture";
  captureReq.headers = { host: "localhost", "content-type": "application/json" };
  captureReq.socket = {};
  await server.handleRequest(captureReq, captureRecorder.res);
  assert.equal(captureRecorder.state.status, 200);
  assert.equal(JSON.parse(captureRecorder.state.body).snapshot.id, "Match-Test");
  const captureCall = calls.find((item) => item.startsWith("capture:"));
  assert.ok(captureCall?.includes('"overview"'));
  assert.ok(captureCall?.includes('"includeSteamID":false'));

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
await testDragCapturePointValidation();
await testAutomaticHealUsesBinaryParameter();
await testHealthEndpointDoesNotRequireAuth();
await testAuthSessionAndLoginIncludeSteamAvatar();
await testWebPagesEndpointFiltersByPermissions();
await testTacticalMapViewerPresenceTracksDistinctAccounts();
await testAdminUsersRouteReturnsOnceAndHidesPasswordHash();
await testAdminPermissionGroupsApiSupportsCrudAndInUseConflict();
await testConsoleRecentEndpointUsesUnifiedConsoleBuffer();
await testConsoleRconEndpointsUseLoggedInUser();
await testConsoleRconForbiddenMapsTo403();
await testLogPostEndpointsExposeTailerStateAndQueries();
await testConsoleWebSocketRequiresSuperAdmin();
await testPlaytimeCacheReturnsEffectiveDuration();
await testPlayerPlaytimeOverrideRouteRequiresSuperAdmin();
await testPlayerPlaytimeOverrideRouteSetsHours();
await testSquadNameClassifierHelperCoversCoreRules();
await testSquadNamePolicyRoutesExposeTestAndProtectedSave();
await testSquadNamePolicyGuardRoutesExposeStateSimulateAndProtectedClear();
await testSquadNamePolicyPatrolRoutesExposeStateSimulateAndProtectedClear();
await testCombatCleanRoutesDoNotForceCurrentServerFilter();
await testCombatRecordsRouteReadsCollectorWithTraceFilters();
await testWeaponCollectorApiRequiresGet();
await testGroupReportSnapshotRouteReturnsWrappedSnapshot();
await testSnapshotAllRequiresAuth();
await testSnapshotAllDoesNotTriggerSlowTasks();
await testMatchSnapshotRouteReusesPrebuiltSnapshot();
await testRemoteTelemetryStateRouteUsesModuleState();
await testRemoteTelemetryWriteTicketsRouteDelegatesToModule();
await testRemoteTelemetryWriteTicketsRouteEnforcesPermission();
await testMatchRefreshRoutesDelegateToMatchState();
await testSquadLifecycleRouteReturnsCurrentSnapshot();
await testSquadManagementRoutesExposeStateAndMutations();
await testSettingsRoutesRequireAuthAndSuperAdmin();
await testWarmupRoutesExposeStateAndValidateInput();
await testAdminWarnRecentRouteReturnsMemoryRecords();
await testAdminWarnBroadcastRouteReturnsMemoryRecords();
await testCombatLogRoutesExposeLogsAndMetadata();
await testPanelBanRoutesReturnPluginStateAndCrud();
await testFairTeamBalanceRoutesReturnPluginStateAndRequests();
await testStepwiseSquadPlaytimeGuardRoutesReturnPluginStateAndSimulate();
await testFairSquadGuardRoutesReturnPluginStateAndActions();
await testPjscAverageDurationRouteReturnsPluginState();
await testMatchSnapshotRoutesExposeArtifacts();
await testMatchEndSnapshotRoutesStaySeparateFromImageSnapshots();
await testVueRouteFallsBackToIndexHtml();

console.log("web server tests passed");
