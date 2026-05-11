import assert from "node:assert/strict";
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

await testReadJsonBodyParsesValidPayload();
await testReadJsonBodyRejectsInvalidJson();
await testReadJsonBodyRejectsOversizedPayload();
await testGetPluginApiReturnsMatchingPluginApi();
await testHealthEndpointDoesNotRequireAuth();
await testWeaponCollectorApiRequiresGet();

console.log("web server tests passed");
