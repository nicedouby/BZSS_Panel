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
          return { active: [], bySteamID: {} };
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

async function setupReserveModule({
  enabled = true,
  adminLines = [
    "header",
    "// 预留位",
    "Group=BZSSVIP:reserve",
  ],
  modulesOverrides = {},
} = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "reserve-slots-test-"));
  const adminFilePath = path.join(tempDir, "Admins.cfg");
  const localReservePath = path.join(tempDir, "data", "reserve-slots.json");
  await fs.writeFile(adminFilePath, adminLines.join("\n"), "utf8");

  const config = createConfig({
    reserveSystem: {
      enabled,
      adminFilePath,
      localReserveFilePath: path.relative(process.cwd(), localReservePath),
    },
  });

  const harness = createTestHarness();
  const modules = {
    ...harness.modules,
    ...modulesOverrides,
  };
  const reserveModule = createReserveSlotsModule({
    core: harness.core,
    modules,
    config,
    logger: harness.logger,
  });

  await reserveModule.init();
  return {
    tempDir,
    adminFilePath,
    localReservePath,
    harness,
    config,
    reserveModule,
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
  assert.equal(parsed.members[0].expireAt, "2020-06-02 21:26:59");
  assert.equal(parsed.members[0].isExpired, true);
  assert.deepEqual(parsed.members[0].reasons, ["预留位"]);
  assert.equal(parsed.members[1].expireAt, null);
}

async function testUpsertAndShortenUsesCurrentExpiry() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "reserve-slots-manual-"));
  const adminFilePath = path.join(tempDir, "Admins.cfg");
  const localReservePath = path.join(tempDir, "data", "reserve-slots.json");
  await fs.writeFile(adminFilePath, [
    "header",
    "// 预留位",
    "Group=BZSSVIP:reserve",
    "Admin=76561198377609640:BZSSVIP //2099-06-02 21:26:59 预留位",
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
    durationDays: -10,
    name: "Alpha",
    reason: "manual_shorten",
  });
  const member = updated.members.find((item) => item.steamId === "76561198377609640");
  assert.equal(member.expireAt, "2099-05-23 21:26:59");
  assert.equal(member.name, "Alpha");

  const adminContent = await fs.readFile(adminFilePath, "utf8");
  assert.match(adminContent, /manual_shorten/);

  await reserveModule.stop();
  await fs.rm(tempDir, { recursive: true, force: true });
}

async function testWarmupReasonUsesDatabaseNameWhenMissing() {
  const module = await setupReserveModule({
    adminLines: [
      "header",
      "// 预留位",
      "Group=BZSSVIP:reserve",
      "Admin=76561198377609640:BZSSVIP //2027-02-11 00:00:00 暖服自动赠送：累计暖服 120 分钟",
    ],
  });

  await module.reserveModule.api.importFromAdminFile();
  const importedAdminContent = await fs.readFile(module.adminFilePath, "utf8");
  assert.match(importedAdminContent, /名称:Alpha; 暖服自动赠送：累计暖服 120 分钟/);

  const imported = await module.reserveModule.api.getState();
  const legacyMember = imported.members.find((item) => item.steamId === "76561198377609640");
  assert.equal(legacyMember.name, "Alpha");
  assert.deepEqual(legacyMember.reasons, ["暖服自动赠送：累计暖服 120 分钟"]);

  const updated = await module.reserveModule.api.upsertMember({
    steamId: "76561198377609640",
    group: "BZSSVIP",
    durationDays: 1,
    name: "萌新 陌尘",
    reason: "暖服自动赠送：累计暖服 120 分钟",
  });
  const member = updated.members.find((item) => item.steamId === "76561198377609640");
  assert.equal(member.name, "萌新 陌尘");
  assert.deepEqual(member.reasons, ["暖服自动赠送：累计暖服 120 分钟"]);

  const adminContent = await fs.readFile(module.adminFilePath, "utf8");
  assert.match(adminContent, /名称:萌新 陌尘; 暖服自动赠送：累计暖服 120 分钟/);

  await module.reserveModule.stop();
  await fs.rm(module.tempDir, { recursive: true, force: true });
}

async function testExpiredCleanupRemovesExpiredMembers() {
  const module = await setupReserveModule({
    adminLines: [
      "header",
      "// 预留位",
      "Group=BZSSVIP:reserve",
      "Admin=76561198377609640:BZSSVIP //2000-06-02 21:26:59 预留位",
      "Admin=76561198377609641:BZSSVIP //2099-06-02 21:26:59 预留位",
    ],
  });

  const result = await module.reserveModule.api.deleteExpiredMembers();
  assert.equal(result.removedCount, 1);
  assert.equal(result.members.some((item) => item.steamId === "76561198377609640"), false);
  assert.equal(result.members.some((item) => item.steamId === "76561198377609641"), true);

  const adminContent = await fs.readFile(module.adminFilePath, "utf8");
  assert.doesNotMatch(adminContent, /76561198377609640/);
  assert.match(adminContent, /76561198377609641/);

  await module.reserveModule.stop();
  await fs.rm(module.tempDir, { recursive: true, force: true });
}

async function testChatActivationRespectsEnabledFlag() {
  const module = await setupReserveModule({
    enabled: false,
  });
  await module.reserveModule.start();

  const created = await module.reserveModule.api.createCdkBatch({
    codeType: "VIP",
    quantity: 1,
    durationDays: 30,
    allowMultiActivation: false,
  }, {
    actor: { username: "admin" },
  });

  module.harness.chatManager.api.emit("message", {
    chatChannel: "all",
    playerName: "Alpha",
    steamId: "76561198377609640",
    message: created.createdCodes[0],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));

  const state = await module.reserveModule.api.getCdkState();
  assert.equal(state.summary.successCount, 0);
  assert.equal(state.summary.activationCount, 0);
  assert.equal(module.harness.warns.length, 0);

  await module.reserveModule.stop();
  await fs.rm(module.tempDir, { recursive: true, force: true });
}



async function testCdkBatchActivationScheduleAndAutoDeactivation() {
  const module = await setupReserveModule({ enabled: true });
  await module.reserveModule.start();

  const scheduledAt = new Date(Date.now() + 60_000).toISOString();
  const scheduled = await module.reserveModule.api.createCdkBatch({
    codeType: "VIP",
    quantity: 1,
    durationDays: 30,
    activateAt: scheduledAt,
    allowMultiActivation: false,
  }, {
    actor: { username: "admin" },
  });

  const scheduledBatch = scheduled.batches.find((item) => item.id === scheduled.createdBatchId);
  assert.equal(scheduledBatch.status, "scheduled");
  assert.equal(scheduled.summary.scheduledBatchCount, 1);

  module.harness.chatManager.api.emit("message", {
    chatChannel: "all",
    playerName: "Alpha",
    steamId: "76561198377609640",
    message: scheduled.createdCodes[0],
  });
  await new Promise((resolve) => setTimeout(resolve, 80));

  const earlyState = await module.reserveModule.api.getCdkState();
  const earlyActivation = earlyState.activations.find((item) => item.code === scheduled.createdCodes[0]);
  assert.equal(earlyActivation?.result, "batch_not_active");
  assert.equal(earlyState.summary.usedCodeCount, 0);

  const autoDeactivateAt = new Date(Date.now() + 250).toISOString();
  const expiring = await module.reserveModule.api.createCdkBatch({
    codeType: "AUTO",
    quantity: 1,
    durationDays: 30,
    autoDeactivateAt,
    allowMultiActivation: false,
  }, {
    actor: { username: "admin" },
  });
  const expiringCode = expiring.createdCodes[0];
  assert.equal(expiring.batches.find((item) => item.id === expiring.createdBatchId)?.status, "active");

  await new Promise((resolve) => setTimeout(resolve, 320));
  const expiredState = await module.reserveModule.api.getCdkState();
  assert.equal(expiredState.batches.some((item) => item.id === expiring.createdBatchId), false);

  module.harness.chatManager.api.emit("message", {
    chatChannel: "all",
    playerName: "Alpha",
    steamId: "76561198377609640",
    message: expiringCode,
  });
  await new Promise((resolve) => setTimeout(resolve, 80));

  const afterExpiredAttempt = await module.reserveModule.api.getCdkState();
  const expiredActivation = afterExpiredAttempt.activations.find((item) => item.code === expiringCode);
  assert.equal(expiredActivation?.result, "batch_deactivated");
  assert.match(expiredActivation?.failureReason ?? "", /自动报销/);

  await module.reserveModule.stop();
  await fs.rm(module.tempDir, { recursive: true, force: true });
}

async function testCsvImportSyncsAdminFile() {
  const module = await setupReserveModule();
  const csvText = [
    "steamId,name,group,expireAt,reasons,remark",
    "76561198377609640,Alpha,BZSSVIP,2026-06-02 21:26:59,manual_import,manual_import",
  ].join("\n");

  const result = await module.reserveModule.api.importFromCsv(csvText);
  assert.equal(result.members.length, 1);

  const adminContent = await fs.readFile(module.adminFilePath, "utf8");
  assert.match(adminContent, /Admin=76561198377609640:BZSSVIP \/\/2026-06-02 21:26:59/);
  assert.match(adminContent, /名称:Alpha/);

  await module.reserveModule.stop();
  await fs.rm(module.tempDir, { recursive: true, force: true });
}

async function testRoutePermissions() {
  const module = await setupReserveModule();
  await module.reserveModule.start();

  const server = new WebServer({
    config: {
      enabled: false,
      host: "127.0.0.1",
      port: 8899,
      useVueClient: false,
    },
    logger: module.harness.logger,
    core: {
      ...module.harness.core,
      authManager: {
        getUserFromRequest(req) {
          if (req.headers.authorization === "super") {
            return { username: "admin", role: "SuperAdmin", isSuperAdmin: true };
          }
          if (req.headers.authorization === "user") {
            return { username: "viewer", role: "Operator", permissions: [] };
          }
          if (req.headers.authorization === "manager") {
            return { username: "manager", role: "Operator", permissions: ["reserve_slots.view", "reserve_slots.manage"] };
          }
          return null;
        },
        hasEverything(user) {
          return Boolean(user?.isSuperAdmin);
        },
        hasPermission(user, permission) {
          return Boolean(user?.isSuperAdmin) || Boolean(user?.permissions?.includes(permission));
        },
      },
      config: module.config,
    },
    modules: {
      reserveSlots: module.reserveModule.api,
      chatManager: module.harness.modules.chatManager,
    },
  });

  const forbidden = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/reserve-slots",
    headers: { host: "localhost", authorization: "user" },
    socket: {},
  }, forbidden.res);
  assert.equal(forbidden.state.status, 403);

  const allowed = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/reserve-slots",
    headers: { host: "localhost", authorization: "super" },
    socket: {},
  }, allowed.res);
  assert.equal(allowed.state.status, 200);

  const managerView = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/reserve-slots",
    headers: { host: "localhost", authorization: "manager" },
    socket: {},
  }, managerView.res);
  assert.equal(managerView.state.status, 200);

  const managerMemberUpdate = createRecorder();
  await server.handleRequest({
    method: "POST",
    url: "/api/reserve-slots/members",
    headers: { host: "localhost", authorization: "manager", "content-type": "application/json" },
    socket: {},
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(JSON.stringify({
        steamId: "76561198377609640",
        group: "BZSSVIP",
        durationDays: 1,
      }));
    },
  }, managerMemberUpdate.res);
  assert.equal(managerMemberUpdate.state.status, 200);

  const exportForbidden = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/reserve-slots/export-csv",
    headers: { host: "localhost", authorization: "manager" },
    socket: {},
  }, exportForbidden.res);
  assert.equal(exportForbidden.state.status, 403);

  await module.reserveModule.stop();
  await fs.rm(module.tempDir, { recursive: true, force: true });
}

async function testStoreFileRepair() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "reserve-slots-store-"));
  const storePath = path.join(tempDir, "data", "reserve-slots.json");
  await ensureReserveSlotStoreFile(storePath, "C:/Servers/Squad/Admins.cfg");
  const created = JSON.parse(await fs.readFile(storePath, "utf8"));
  assert.equal(created.version, 2);
  assert.deepEqual(created.members, []);

  await fs.writeFile(storePath, "{broken", "utf8");
  await ensureReserveSlotStoreFile(storePath, "C:/Servers/Squad/Admins.cfg");
  const repaired = JSON.parse(await fs.readFile(storePath, "utf8"));
  assert.equal(repaired.version, 2);

  await fs.rm(tempDir, { recursive: true, force: true });
}

async function main() {
  await testParserHandlesAdminBlock();
  await testStoreFileRepair();
  await testUpsertAndShortenUsesCurrentExpiry();
  await testWarmupReasonUsesDatabaseNameWhenMissing();
  await testExpiredCleanupRemovesExpiredMembers();
  await testChatActivationRespectsEnabledFlag();
  await testCdkBatchActivationScheduleAndAutoDeactivation();
  await testCsvImportSyncsAdminFile();
  await testRoutePermissions();
  console.log("reserve slots tests passed");
}

await main();
