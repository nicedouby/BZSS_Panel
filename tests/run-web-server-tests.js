import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { WebServer } from "../core/web-server.js";

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
await testWeaponCollectorApiRequiresGet();
await testSnapshotAllRequiresAuth();
await testSnapshotAllDoesNotTriggerSlowTasks();
await testSettingsRoutesRequireAuthAndSuperAdmin();
await testVueRouteFallsBackToIndexHtml();

console.log("web server tests passed");
