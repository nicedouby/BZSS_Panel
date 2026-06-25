import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { WebServer } from "../core/web-server.js";
import {
  createReserveSlotsModule,
  ensureReserveSlotStoreFile,
  parseReserveSlotsFromAdminFileContent,
  removeReserveSlotMembersFromAdminFileContent,
  syncReserveMemberNamesInAdminFileContent,
  upsertReserveSlotInAdminFileContent,
} from "../modules/reserve-slots/index.js";

function createConfig(initial = {}) {
  const state = structuredClone(initial);

  return {
    get(pathText, defaultValue) {
      if (!pathText) return state;
      const parts = String(pathText).split(".");
      let current = state;
      for (const part of parts) {
        if (current == null || typeof current !== "object" || !(part in current)) {
          return defaultValue;
        }
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

function createEventBus() {
  const listeners = new Map();
  return {
    onCoreEvent(name, handler) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
      return () => listeners.get(name)?.delete(handler);
    },
    emitCoreEvent(name, payload = {}) {
      for (const handler of listeners.get(name) ?? []) {
        handler(payload);
      }
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

function createTestHarness() {
  const warns = [];
  const broadcasts = [];
  const logger = {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
  const eventBus = createEventBus();
  const chatManager = createChatManagerHarness();

  return {
    warns,
    broadcasts,
    logger,
    eventBus,
    chatManager,
    core: {
      createLogger() {
        return logger;
      },
      logger,
      runtimeState: {
        getPlayers() {
          return { bySteamID: {} };
        },
      },
      eventBus,
      webStatus: {
        serverId: "BZSS_Main",
      },
    },
    modules: {
      chatManager: chatManager.api,
      playerDatabase: {
        async listPlayersBySteamIDs(steamIDs = []) {
          return steamIDs.map((steamID) => ({
            steam_id: steamID,
            current_name: steamID === "76561198377609640" ? "Alpha" : "Bravo",
            server_seconds: 7200,
          }));
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

async function testParserHandlesAdminBlock() {
  const content = [
    "random line",
    "// 预留位",
    "Group=BZSSVIP:reserve",
    "Admin=76561198377609640:BZSSVIP //2020-06-02 21:26:59  预留位",
    "Admin=76561198377609641:BZSSVIP //预留位",
  ].join("\n");

  const parsed = parseReserveSlotsFromAdminFileContent(content, {
    adminFilePath: "C:/Servers/Squad/Admins.cfg",
  });

  assert.equal(parsed.groups.length, 1);
  assert.equal(parsed.groups[0].name, "BZSSVIP");
  assert.equal(parsed.members.length, 2);
  assert.equal(parsed.members[0].steamId, "76561198377609640");
  assert.equal(parsed.members[0].name, "");
  assert.equal(parsed.members[0].expireAt, "2020-06-02 21:26:59");
  assert.equal(parsed.members[0].isExpired, true);
  assert.deepEqual(parsed.members[0].reasons, ["预留位"]);
  assert.equal(parsed.members[1].expireAt, null);
  assert.equal(parsed.members[1].isExpired, false);
  assert.deepEqual(parsed.members[1].reasons, ["预留位"]);
}

async function testEnsureReserveSlotStoreFileCreatesAndRepairs() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "reserve-slots-test-"));
  const storePath = path.join(tempDir, "data", "reserve-slots.json");

  await ensureReserveSlotStoreFile(storePath, "C:/Servers/Squad/Admins.cfg");
  const created = JSON.parse(await fs.readFile(storePath, "utf8"));
  assert.equal(created.version, 2);
  assert.equal(created.source.adminFilePath, "");
  assert.equal(created.groups.length, 0);
  assert.equal(created.members.length, 0);
  assert.deepEqual(created.cdkBatches, []);
  assert.deepEqual(created.cdkCodes, []);
  assert.deepEqual(created.cdkActivations, []);

  await fs.writeFile(storePath, "{broken", "utf8");
  await ensureReserveSlotStoreFile(storePath, "C:/Servers/Squad/Admins.cfg");
  const repaired = JSON.parse(await fs.readFile(storePath, "utf8"));
  assert.equal(repaired.version, 2);
  const backups = await fs.readdir(path.dirname(storePath));
  assert.equal(backups.some((file) => file.includes(".broken-")), true);

  await fs.rm(tempDir, { recursive: true, force: true });
}

async function testUpsertAdminFileContentAppendsMissingBlock() {
  const content = [
    "Admin=76561198000000000:Admin",
    "Group=Admin:admin",
  ].join("\r\n");

  const next = upsertReserveSlotInAdminFileContent(content, {
    steamId: "76561198377609640",
    group: "BZSSVIP",
    expireAt: "2026-06-02 21:26:59",
  });

  assert.match(next, /\r\n\/\/ 预留位\r\nGroup=BZSSVIP:reserve\r\nAdmin=76561198377609640:BZSSVIP \/\/2026-06-02 21:26:59\r\n$/);
  assert.match(next, /^Admin=76561198000000000:Admin\r\nGroup=Admin:admin\r\n\r\n\/\/ 预留位/m);
}

async function testUpsertAdminFileContentUpdatesExistingMember() {
  const content = [
    "header",
    "// 预留位",
    "Group=BZSSVIP:reserve",
    "Admin=76561198377609640:BZSSVIP //2026-06-02 21:26:59",
    "Admin=76561198992120471:BZSSVIP //2026-06-06 22:31:03",
    "footer",
  ].join("\n");

  const next = upsertReserveSlotInAdminFileContent(content, {
    steamId: "76561198377609640",
    group: "BZSSVIP",
    expireAt: "2026-07-02 21:26:59",
    name: "Alpha",
  });

  assert.equal((next.match(/Admin=76561198377609640/g) ?? []).length, 1);
  assert.match(next, /Admin=76561198377609640:BZSSVIP \/\/2026-07-02 21:26:59 名称:Alpha/);
  assert.match(next, /Admin=76561198992120471:BZSSVIP \/\/2026-06-06 22:31:03/);
  assert.match(next, /footer$/);
}

async function testUpsertAdminFileContentValidatesInput() {
  assert.throws(() => upsertReserveSlotInAdminFileContent("// 预留位", {
    steamId: "bad",
    group: "BZSSVIP",
    expireAt: "2026-06-02 21:26:59",
  }), /Steam64/);

  assert.throws(() => upsertReserveSlotInAdminFileContent("// 预留位", {
    steamId: "76561198377609640",
    group: "BZSSVIP",
    expireAt: "2026-06-02",
  }), /YYYY-MM-DD HH:mm:ss/);
}

async function testRemoveReserveSlotMembersFromAdminFileContent() {
  const content = [
    "header",
    "// 预留位",
    "Group=BZSSVIP:reserve",
    "Admin=76561198377609640:BZSSVIP //2020-06-02 21:26:59 名称:Alpha",
    "Admin=76561198992120471:BZSSVIP //2099-06-06 22:31:03 名称:Bravo",
    "footer",
  ].join("\n");

  const removedBySteamId = removeReserveSlotMembersFromAdminFileContent(content, {
    steamIds: ["76561198992120471"],
  });
  assert.equal(removedBySteamId.removedCount, 1);
  assert.doesNotMatch(removedBySteamId.content, /76561198992120471/);
  assert.match(removedBySteamId.content, /76561198377609640/);

  const removedExpired = removeReserveSlotMembersFromAdminFileContent(content, {
    removeExpiredOnly: true,
  });
  assert.equal(removedExpired.removedCount, 1);
  assert.doesNotMatch(removedExpired.content, /76561198377609640/);
  assert.match(removedExpired.content, /76561198992120471/);
}

async function testReserveSlotUniquenessDedupesExistingEntries() {
  const content = [
    "header",
    "// 预留位",
    "Group=BZSSVIP:reserve",
    "Admin=76561198377609640:BZSSVIP //2099-06-02 21:26:59 名称:Alpha",
    "Admin=76561198377609640:BZSSVIP //2099-07-02 21:26:59 名称:Alpha2",
    "footer",
  ].join("\n");

  const parsed = parseReserveSlotsFromAdminFileContent(content, {
    adminFilePath: "C:/Servers/Squad/Admins.cfg",
  });
  assert.equal(parsed.members.length, 1);
  assert.equal(parsed.members[0].steamId, "76561198377609640");

  const next = upsertReserveSlotInAdminFileContent(content, {
    steamId: "76561198377609640",
    group: "BZSSVIP",
    expireAt: "2099-08-02 21:26:59",
    name: "Alpha3",
  });
  assert.equal((next.match(/Admin=76561198377609640/g) ?? []).length, 1);
  assert.match(next, /Admin=76561198377609640:BZSSVIP \/\/2099-08-02 21:26:59 名称:Alpha3/);
}

async function testSyncReserveMemberNamesInAdminFileContentFillsMissingNames() {
  const seeded = upsertReserveSlotInAdminFileContent(["header", "footer"].join("\n"), {
    steamId: "76561198377609640",
    group: "BZSSVIP",
    expireAt: "2099-06-02 21:26:59",
  });
  const content = upsertReserveSlotInAdminFileContent(seeded, {
    steamId: "76561198992120471",
    group: "BZSSVIP",
    expireAt: "2099-06-06 22:31:03",
    name: "Bravo",
  });

  const result = syncReserveMemberNamesInAdminFileContent(content, [
    { steamId: "76561198377609640", name: "Alpha" },
    { steamId: "76561198992120471", name: "BravoNew" },
  ]);

  assert.equal(result.changed, true);
  assert.deepEqual(result.updatedSteamIds, ["76561198377609640"]);
  assert.match(result.content, /Admin=76561198377609640:BZSSVIP \/\/2099-06-02 21:26:59 名称:Alpha/);
  assert.match(result.content, /Admin=76561198992120471:BZSSVIP \/\/2099-06-06 22:31:03 名称:Bravo/);
}

async function testCdkBatchAndChatActivationFlow() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "reserve-slots-cdk-"));
  const adminFilePath = path.join(tempDir, "Admins.cfg");
  const localReservePath = path.join(tempDir, "data", "reserve-slots.json");
  await fs.writeFile(adminFilePath, [
    "header",
    "// 预留位",
    "Group=BZSSVIP:reserve",
  ].join("\n"), "utf8");

  const config = createConfig({
    reserveSystem: {
      enabled: true,
      adminFilePath,
      localReserveFilePath: path.relative(process.cwd(), localReservePath),
    },
  });

  const harness = createTestHarness();
  const reserveModule = createReserveSlotsModule({
    core: harness.core,
    modules: harness.modules,
    config,
    logger: harness.logger,
  });

  await reserveModule.init();
  await reserveModule.start();

  const created = await reserveModule.api.createCdkBatch({
    codeType: "VIP",
    quantity: 2,
    durationDays: 30,
    allowMultiActivation: false,
  }, {
    actor: { username: "admin" },
  });

  assert.equal(created.createdCodes.length, 2);
  assert.equal(created.batches.length, 1);
  assert.match(created.createdCodes[0], /^CDKVIP[A-Z0-9]{14}A$/);

  harness.chatManager.api.emit("message", {
    chatChannel: "all",
    playerName: "Alpha",
    steamId: "76561198377609640",
    message: created.createdCodes[0],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));

  const afterFirst = await reserveModule.api.getCdkState();
  assert.equal(afterFirst.summary.successCount, 1);
  assert.equal(afterFirst.summary.usedCodeCount, 1);
  assert.equal(afterFirst.activations[0].result, "success");
  assert.ok(harness.warns.some((item) => String(item.message).includes("激活成功")));
  assert.equal(harness.broadcasts.length >= 1, true);
  assert.ok(harness.warns.some((item) => String(item.message).includes("剩余")));
  assert.ok(harness.broadcasts.some((item) => String(item.message).includes("剩余")));

  harness.chatManager.api.emit("message", {
    chatChannel: "all",
    playerName: "Alpha",
    steamId: "76561198377609640",
    message: created.createdCodes[1],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));

  const afterSecond = await reserveModule.api.getCdkState();
  assert.equal(afterSecond.summary.failureCount >= 1, true);
  assert.equal(afterSecond.activations[0].result, "duplicate_player_restricted");
  assert.equal(harness.broadcasts.length, 1);

  await reserveModule.api.deactivateCdkBatch(created.createdBatchId, {
    actor: { username: "admin" },
  });
  const afterDeactivateFirstBatch = await reserveModule.api.getCdkState();
  assert.equal(afterDeactivateFirstBatch.batches.some((item) => item.id === created.createdBatchId), false);

  const createdTwo = await reserveModule.api.createCdkBatch({
    codeType: "VIP2",
    quantity: 1,
    durationDays: 15,
    allowMultiActivation: true,
  }, {
    actor: { username: "admin" },
  });
  await reserveModule.api.deactivateCdkBatch(createdTwo.createdBatchId, {
    actor: { username: "admin" },
  });

  harness.chatManager.api.emit("message", {
    chatChannel: "all",
    playerName: "Bravo",
    steamId: "76561198377609641",
    message: createdTwo.createdCodes[0],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));

  const afterDeactivate = await reserveModule.api.getCdkState();
  assert.equal(afterDeactivate.activations[0].result, "batch_deactivated");
  assert.equal(afterDeactivate.batches.some((item) => item.id === createdTwo.createdBatchId), false);

  const adminContent = await fs.readFile(adminFilePath, "utf8");
  assert.match(adminContent, /Admin=76561198377609640:BZSSVIP/);
  assert.doesNotMatch(adminContent, /CDK:VIP:/);

  await reserveModule.stop();
  await fs.rm(tempDir, { recursive: true, force: true });
}

async function testManualExtendAddsFromExistingExpiry() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "reserve-slots-manual-extend-"));
  const adminFilePath = path.join(tempDir, "Admins.cfg");
  const localReservePath = path.join(tempDir, "data", "reserve-slots.json");
  const firstExpireAt = "2099-06-02 21:26:59";

  await fs.writeFile(adminFilePath, [
    "header",
    "// 预留位",
    "Group=BZSSVIP:reserve",
    `Admin=76561198377609640:BZSSVIP //${firstExpireAt} 名称:Alpha`,
  ].join("\n"), "utf8");

  const config = createConfig({
    reserveSystem: {
      enabled: true,
      adminFilePath,
      localReserveFilePath: path.relative(process.cwd(), localReservePath),
    },
  });

  const harness = createTestHarness();
  const reserveModule = createReserveSlotsModule({
    core: harness.core,
    modules: harness.modules,
    config,
    logger: harness.logger,
  });

  await reserveModule.init();
  await reserveModule.api.importFromAdminFile();

  const updated = await reserveModule.api.upsertMember({
    steamId: "76561198377609640",
    group: "BZSSVIP",
    durationDays: 30,
    name: "Alpha",
    reason: "manual_extend_test",
  });

  const member = updated.members.find((item) => item.steamId === "76561198377609640");
  assert.ok(member);
  assert.equal(member.expireAt, "2099-07-02 21:26:59");

  const adminContent = await fs.readFile(adminFilePath, "utf8");
  assert.match(adminContent, /Admin=76561198377609640:BZSSVIP \/\/2099-07-02 21:26:59 名称:Alpha manual_extend_test/);

  await reserveModule.stop?.();
  await fs.rm(tempDir, { recursive: true, force: true });
}

async function testReserveSlotQueryChatFlow() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "reserve-slots-query-"));
  const adminFilePath = path.join(tempDir, "Admins.cfg");
  const localReservePath = path.join(tempDir, "data", "reserve-slots.json");

  await fs.writeFile(adminFilePath, [
    "header",
    "// 预留位",
    "Group=BZSSVIP:reserve",
    "Admin=76561198377609640:BZSSVIP //2099-06-02 21:26:59",
    "Admin=76561198377609641:BZSSVIP //预留位",
  ].join("\n"), "utf8");

  const config = createConfig({
    reserveSystem: {
      enabled: true,
      adminFilePath,
      localReserveFilePath: path.relative(process.cwd(), localReservePath),
    },
  });

  const harness = createTestHarness();
  const reserveModule = createReserveSlotsModule({
    core: harness.core,
    modules: harness.modules,
    config,
    logger: harness.logger,
  });

  await reserveModule.init();
  await reserveModule.start();
  await reserveModule.api.importFromAdminFile();

  harness.warns.length = 0;
  harness.chatManager.api.emit("message", {
    chatChannel: "all",
    playerName: "Alpha",
    steamId: "76561198377609640",
    message: "ylw",
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(harness.warns.length, 1);
  assert.equal(harness.warns[0].targetSteamId, "76561198377609640");
  assert.match(String(harness.warns[0].message), /你的预留位还剩 \d+ 天，到期时间 2099-06-02 21:26:59。/);

  harness.warns.length = 0;
  harness.chatManager.api.emit("message", {
    chatChannel: "all",
    playerName: "Bravo",
    steamId: "76561198377609641",
    message: "预留位",
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(harness.warns.length, 1);
  assert.equal(harness.warns[0].targetSteamId, "76561198377609641");
  assert.match(String(harness.warns[0].message), /永久预留位/);

  harness.warns.length = 0;
  harness.chatManager.api.emit("message", {
    chatChannel: "all",
    playerName: "Charlie",
    steamId: "76561198377609642",
    message: "ylw",
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(harness.warns.length, 1);
  assert.match(String(harness.warns[0].message), /未查询到预留位/);

  harness.warns.length = 0;
  harness.chatManager.api.emit("message", {
    chatChannel: "team",
    playerName: "Alpha",
    steamId: "76561198377609640",
    message: "ylw",
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(harness.warns.length, 0);

  await reserveModule.stop();
  await fs.rm(tempDir, { recursive: true, force: true });
}

async function testModuleAndRoutesWorkEndToEnd() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "reserve-slots-web-"));
  const adminFilePath = path.join(tempDir, "Admins.cfg");
  const localReservePath = path.join(tempDir, "data", "reserve-slots.json");

  await fs.writeFile(adminFilePath, [
    "header",
    "// 预留位",
    "Group=BZSSVIP:reserve",
    "Admin=76561198377609640:BZSSVIP //2020-06-02 21:26:59  预留位",
  ].join("\n"), "utf8");

  const config = createConfig({
    reserveSystem: {
      enabled: true,
      adminFilePath,
      localReserveFilePath: path.relative(process.cwd(), localReservePath),
    },
  });

  const harness = createTestHarness();
  const reserveModule = createReserveSlotsModule({
    core: harness.core,
    modules: harness.modules,
    config,
    logger: harness.logger,
  });
  await reserveModule.init();
  await reserveModule.start();

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
          if (req.headers.authorization === "user") {
            return { username: "viewer", role: "Operator" };
          }
          return null;
        },
        hasEverything(user) {
          return Boolean(user?.isSuperAdmin);
        },
      },
      config,
    },
    modules: {
      reserveSlots: reserveModule.api,
      chatManager: harness.modules.chatManager,
    },
  });

  const getRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/reserve-slots",
    headers: { host: "localhost", authorization: "user" },
    socket: {},
  }, getRecorder.res);

  assert.equal(getRecorder.state.status, 200);
  const getBody = JSON.parse(getRecorder.state.body);
  assert.equal(getBody.groups.length, 0);
  assert.equal(getBody.members.length, 0);

  const saveRecorder = createRecorder();
  const saveReq = Readable.from([JSON.stringify({
    enabled: true,
    adminFilePath,
    localReserveFilePath: path.relative(process.cwd(), localReservePath),
  })]);
  saveReq.method = "PUT";
  saveReq.url = "/api/settings/reserve-slots";
  saveReq.headers = { host: "localhost", authorization: "super" };
  saveReq.socket = {};
  await server.handleRequest(saveReq, saveRecorder.res);

  assert.equal(saveRecorder.state.status, 200);
  assert.equal(JSON.parse(saveRecorder.state.body).success, true);

  const importRecorder = createRecorder();
  const importReq = Readable.from([]);
  importReq.method = "POST";
  importReq.url = "/api/reserve-slots/import-from-admin";
  importReq.headers = { host: "localhost", authorization: "super" };
  importReq.socket = {};
  await server.handleRequest(importReq, importRecorder.res);

  assert.equal(importRecorder.state.status, 200);
  const importBody = JSON.parse(importRecorder.state.body);
  assert.equal(importBody.success, true);
  assert.equal(importBody.members.length, 1);
  assert.equal(importBody.members[0].steamId, "76561198377609640");
  assert.equal(importBody.members[0].name, "Alpha");
  assert.deepEqual(importBody.members[0].reasons, ["预留位"]);
  assert.equal(importBody.lastImportedAt != null, true);

  const createBatchRecorder = createRecorder();
  const createBatchReq = Readable.from([JSON.stringify({
    codeType: "VIP",
    quantity: 2,
    durationDays: 30,
    allowMultiActivation: true,
  })]);
  createBatchReq.method = "POST";
  createBatchReq.url = "/api/reserve-slots/cdk/batches";
  createBatchReq.headers = { host: "localhost", authorization: "super", "content-type": "application/json" };
  createBatchReq.socket = {};
  await server.handleRequest(createBatchReq, createBatchRecorder.res);
  assert.equal(createBatchRecorder.state.status, 200);
  const createBatchBody = JSON.parse(createBatchRecorder.state.body);
  assert.equal(createBatchBody.success, true);
  assert.equal(createBatchBody.createdCodes.length, 2);
  const batchId = createBatchBody.createdBatchId;

  const cdkStateRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/reserve-slots/cdk/state",
    headers: { host: "localhost", authorization: "super" },
    socket: {},
  }, cdkStateRecorder.res);
  assert.equal(cdkStateRecorder.state.status, 200);
  const cdkStateBody = JSON.parse(cdkStateRecorder.state.body);
  assert.equal(cdkStateBody.batches.length >= 1, true);

  const deactivateRecorder = createRecorder();
  const deactivateReq = Readable.from([]);
  deactivateReq.method = "POST";
  deactivateReq.url = `/api/reserve-slots/cdk/batches/${encodeURIComponent(batchId)}/deactivate`;
  deactivateReq.headers = { host: "localhost", authorization: "super" };
  deactivateReq.socket = {};
  await server.handleRequest(deactivateReq, deactivateRecorder.res);
  assert.equal(deactivateRecorder.state.status, 200);
  const deactivateBody = JSON.parse(deactivateRecorder.state.body);
  assert.equal(deactivateBody.success, true);

  const activationsRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: `/api/reserve-slots/cdk/batches/${encodeURIComponent(batchId)}/activations`,
    headers: { host: "localhost", authorization: "super" },
    socket: {},
  }, activationsRecorder.res);
  assert.equal(activationsRecorder.state.status, 200);
  const activationsBody = JSON.parse(activationsRecorder.state.body);
  assert.equal(Array.isArray(activationsBody.records), true);

  await reserveModule.stop();
  await fs.rm(tempDir, { recursive: true, force: true });
}

await testParserHandlesAdminBlock();
await testEnsureReserveSlotStoreFileCreatesAndRepairs();
await testUpsertAdminFileContentAppendsMissingBlock();
await testUpsertAdminFileContentUpdatesExistingMember();
await testUpsertAdminFileContentValidatesInput();
await testRemoveReserveSlotMembersFromAdminFileContent();
await testReserveSlotUniquenessDedupesExistingEntries();
await testSyncReserveMemberNamesInAdminFileContentFillsMissingNames();
await testCdkBatchAndChatActivationFlow();
await testManualExtendAddsFromExistingExpiry();
await testReserveSlotQueryChatFlow();
await testModuleAndRoutesWorkEndToEnd();

console.log("reserve slots tests passed");
