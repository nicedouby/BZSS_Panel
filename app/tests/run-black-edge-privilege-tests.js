import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { WebServer } from "../core/web-server.js";
import {
  createBlackEdgePrivilegeModule,
  ensureStoreFile,
} from "../modules/black-edge-privilege/index.js";

function createConfig(initial = {}) {
  const state = structuredClone(initial);
  return {
    get(pathText, defaultValue) {
      if (!pathText) return state;
      const parts = String(pathText).split(".");
      let current = state;
      for (const part of parts) {
        if (current == null || typeof current !== "object" || !(part in current)) return defaultValue;
        current = current[part];
      }
      return current;
    },
    set(pathText, value) {
      const parts = String(pathText).split(".");
      let current = state;
      for (let index = 0; index < parts.length - 1; index += 1) {
        const part = parts[index];
        if (current[part] == null || typeof current[part] !== "object" || Array.isArray(current[part])) {
          current[part] = {};
        }
        current = current[part];
      }
      current[parts[parts.length - 1]] = value;
    },
    async save() {},
    state,
  };
}

function createRecorder() {
  const state = { status: null, headers: null, body: null };
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

function createChatManagerHarness() {
  const listeners = new Map();
  return {
    api: {
      on(name, handler) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(handler);
        return () => listeners.get(name)?.delete(handler);
      },
      emit(name, payload) {
        for (const handler of listeners.get(name) ?? []) {
          handler(payload);
        }
      },
    },
  };
}

function createHarness() {
  const warns = [];
  const broadcasts = [];
  const assetGrants = [];
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const chatManager = createChatManagerHarness();

  return {
    warns,
    broadcasts,
    assetGrants,
    logger,
    chatManager,
    core: {
      createLogger() {
        return logger;
      },
      logger,
      webStatus: {
        serverId: "BZSS_Main",
      },
    },
    modules: {
      chatManager: chatManager.api,
      playerDatabase: {
        async addAssetByIdentity(identity = {}, assetKey, amount) {
          assetGrants.push({ identity, assetKey, amount });
          return {
            assets: { [assetKey]: amount },
            blackEdgeSwitchCount: amount,
          };
        },
      },
      adminWarn: {
        async warnPlayer(payload) {
          warns.push(payload);
          return { success: true };
        },
        async broadcastMessage(payload) {
          broadcasts.push(payload);
          return { success: true };
        },
      },
    },
  };
}

async function testEnsureStoreFileCreatesStore() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "black-edge-store-"));
  const storePath = path.join(tempDir, "data", "black-edge.json");
  await ensureStoreFile(storePath);
  const created = JSON.parse(await fs.readFile(storePath, "utf8"));
  assert.equal(created.version, 1);
  assert.deepEqual(created.cdkBatches, []);
  assert.deepEqual(created.cdkCodes, []);
  assert.deepEqual(created.cdkActivations, []);
  await fs.rm(tempDir, { recursive: true, force: true });
}

async function testBatchAndChatActivationFlow() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "black-edge-cdk-"));
  const storePath = path.join(tempDir, "data", "black-edge.json");
  const config = createConfig({
    blackEdgePrivilege: {
      enabled: true,
      storeFilePath: path.relative(process.cwd(), storePath),
    },
  });

  const harness = createHarness();
  const module = createBlackEdgePrivilegeModule({
    core: harness.core,
    modules: harness.modules,
    config,
    logger: harness.logger,
  });

  await module.init();
  await module.start();

  const created = await module.api.createCdkBatch({
    codeType: "HN",
    quantity: 2,
    grantCount: 3,
    allowMultiActivation: false,
  }, {
    actor: { username: "admin" },
  });

  assert.equal(created.createdCodes.length, 2);
  assert.match(created.createdCodes[0], /^CDKHN[A-Z0-9]{14}$/);

  harness.chatManager.api.emit("message", {
    chatChannel: "all",
    playerName: "Alpha",
    steamId: "76561198377609640",
    message: created.createdCodes[0],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));

  const afterFirst = await module.api.getCdkState();
  assert.equal(afterFirst.summary.successCount, 1);
  assert.equal(afterFirst.summary.usedCodeCount, 1);
  assert.equal(harness.assetGrants[0].assetKey, "blackEdgeSwitchCount");
  assert.equal(harness.assetGrants[0].amount, 3);
  assert.ok(harness.warns.some((item) => String(item.message).includes("激活成功")));
  assert.ok(harness.broadcasts.some((item) => String(item.message).includes("黑奴跳边")));

  harness.chatManager.api.emit("message", {
    chatChannel: "all",
    playerName: "Alpha",
    steamId: "76561198377609640",
    message: created.createdCodes[1],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));

  const afterSecond = await module.api.getCdkState();
  assert.equal(afterSecond.activations[0].result, "duplicate_player_restricted");

  await module.stop();
  await fs.rm(tempDir, { recursive: true, force: true });
}

async function testRoutesWork() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "black-edge-web-"));
  const storePath = path.join(tempDir, "data", "black-edge.json");
  const config = createConfig({
    blackEdgePrivilege: {
      enabled: true,
      storeFilePath: path.relative(process.cwd(), storePath),
    },
  });

  const harness = createHarness();
  const module = createBlackEdgePrivilegeModule({
    core: harness.core,
    modules: harness.modules,
    config,
    logger: harness.logger,
  });
  await module.init();
  await module.start();

  const server = new WebServer({
    config: {
      enabled: false,
      host: "127.0.0.1",
      port: 8899,
      useVueClient: false,
    },
    logger: harness.logger,
    core: {
      ...harness.core,
      authManager: {
        getUserFromRequest(req) {
          if (req.headers.authorization === "super") {
            return { username: "admin", role: "SuperAdmin", isSuperAdmin: true };
          }
          return { username: "viewer", role: "Operator" };
        },
        hasEverything(user) {
          return Boolean(user?.isSuperAdmin);
        },
      },
      config,
    },
    modules: {
      blackEdgePrivilege: module.api,
    },
  });

  const createRecorderState = createRecorder();
  const createReq = Readable.from([JSON.stringify({
    codeType: "HN",
    quantity: 1,
    grantCount: 2,
    allowMultiActivation: true,
  })]);
  createReq.method = "POST";
  createReq.url = "/api/black-edge-privilege/cdk/batches";
  createReq.headers = { host: "localhost", authorization: "super", "content-type": "application/json" };
  createReq.socket = {};
  await server.handleRequest(createReq, createRecorderState.res);
  assert.equal(createRecorderState.state.status, 200);
  const createBody = JSON.parse(createRecorderState.state.body);
  assert.equal(createBody.success, true);

  const stateRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/black-edge-privilege/cdk/state",
    headers: { host: "localhost", authorization: "super" },
    socket: {},
  }, stateRecorder.res);
  assert.equal(stateRecorder.state.status, 200);
  const stateBody = JSON.parse(stateRecorder.state.body);
  assert.equal(stateBody.batches.length, 1);

  const batchId = stateBody.batches[0].id;
  const deactivateRecorder = createRecorder();
  const deactivateReq = Readable.from([]);
  deactivateReq.method = "POST";
  deactivateReq.url = `/api/black-edge-privilege/cdk/batches/${encodeURIComponent(batchId)}/deactivate`;
  deactivateReq.headers = { host: "localhost", authorization: "super" };
  deactivateReq.socket = {};
  await server.handleRequest(deactivateReq, deactivateRecorder.res);
  assert.equal(deactivateRecorder.state.status, 200);

  await module.stop();
  await fs.rm(tempDir, { recursive: true, force: true });
}

await testEnsureStoreFileCreatesStore();
await testBatchAndChatActivationFlow();
await testRoutesWork();

console.log("black edge privilege tests passed");
