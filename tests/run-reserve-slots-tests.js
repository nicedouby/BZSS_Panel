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
  assert.equal(created.version, 1);
  assert.equal(created.source.adminFilePath, "");
  assert.equal(created.groups.length, 0);
  assert.equal(created.members.length, 0);

  await fs.writeFile(storePath, "{broken", "utf8");
  await ensureReserveSlotStoreFile(storePath, "C:/Servers/Squad/Admins.cfg");
  const repaired = JSON.parse(await fs.readFile(storePath, "utf8"));
  assert.equal(repaired.version, 1);
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

  const logger = {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };

  const reserveModule = createReserveSlotsModule({
    core: {
      createLogger() {
        return logger;
      },
      logger,
      runtimeState: null,
    },
    modules: {
      playerDatabase: {
        async listPlayersBySteamIDs(steamIDs = []) {
          return steamIDs.includes("76561198377609640")
            ? [{ steam_id: "76561198377609640", current_name: "Alpha" }]
            : [];
        },
      },
    },
    config,
    logger,
  });
  await reserveModule.init();

  const server = new WebServer({
    config: {
      enabled: false,
      host: "127.0.0.1",
      port: 8899,
      useVueClient: false,
    },
    logger,
    core: {
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
  const savedStore = JSON.parse(await fs.readFile(localReservePath, "utf8"));
  assert.equal(savedStore.source.adminFilePath, "");

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

  const importedStore = JSON.parse(await fs.readFile(localReservePath, "utf8"));
  assert.equal(importedStore.source.adminFilePath, adminFilePath);
  assert.equal(importedStore.members[0].isExpired, true);
  assert.equal(importedStore.members[0].name, "Alpha");
  assert.deepEqual(importedStore.members[0].reasons, ["预留位"]);

  const exportRecorder = createRecorder();
  await server.handleRequest({
    method: "GET",
    url: "/api/reserve-slots/export-csv",
    headers: { host: "localhost", authorization: "user" },
    socket: {},
  }, exportRecorder.res);
  assert.equal(exportRecorder.state.status, 200);
  const exportBody = JSON.parse(exportRecorder.state.body);
  assert.match(exportBody.csv, /steamId,name,group,expireAt,reasons,remark,isExpired/);
  assert.match(exportBody.csv, /Alpha/);

  const routeCsvRecorder = createRecorder();
  const routeCsvReq = Readable.from([
    "steamId,name,group,expireAt,reasons,remark,isExpired\n",
    '76561198377609641,Bravo,BZSSVIP,2026-06-02 21:26:59,"原因A | 原因B",手动导入,false\n',
  ]);
  routeCsvReq.method = "POST";
  routeCsvReq.url = "/api/reserve-slots/import-csv";
  routeCsvReq.headers = { host: "localhost", authorization: "super", "content-type": "text/csv; charset=utf-8" };
  routeCsvReq.socket = {};
  await server.handleRequest(routeCsvReq, routeCsvRecorder.res);
  assert.equal(routeCsvRecorder.state.status, 200);
  const routeCsvBody = JSON.parse(routeCsvRecorder.state.body);
  assert.equal(routeCsvBody.success, true);
  assert.equal(routeCsvBody.members[0].name, "Bravo");
  assert.deepEqual(routeCsvBody.members[0].reasons, ["原因A", "原因B"]);

  const exportedCsv = await reserveModule.api.exportCsv();
  assert.match(exportedCsv, /steamId,name,group,expireAt,reasons,remark,isExpired/);
  assert.match(exportedCsv, /Bravo/);

  const csvImported = await reserveModule.api.importFromCsv([
    "steamId,name,group,expireAt,reasons,remark,isExpired",
    '76561198377609641,Bravo,BZSSVIP,2026-06-02 21:26:59,"原因A | 原因B",手动导入,false',
  ].join("\n"));
  assert.equal(csvImported.members[0].name, "Bravo");
  assert.deepEqual(csvImported.members[0].reasons, ["原因A", "原因B"]);

  const forbiddenRecorder = createRecorder();
  const forbiddenReq = Readable.from([JSON.stringify({
    steamId: "76561199161919155",
    group: "BZSSVIP",
    expireAt: "2026-06-07 22:22:53",
  })]);
  forbiddenReq.method = "POST";
  forbiddenReq.url = "/api/reserve-slots/members";
  forbiddenReq.headers = { host: "localhost", authorization: "user", "content-type": "application/json" };
  forbiddenReq.socket = {};
  await server.handleRequest(forbiddenReq, forbiddenRecorder.res);
  assert.equal(forbiddenRecorder.state.status, 403);

  const memberRecorder = createRecorder();
  const memberReq = Readable.from([JSON.stringify({
    steamId: "76561198377609640",
    group: "BZSSVIP",
    expireAt: "2026-08-02 21:26:59",
    name: "Alpha",
    reason: "manual",
  })]);
  memberReq.method = "POST";
  memberReq.url = "/api/reserve-slots/members";
  memberReq.headers = { host: "localhost", authorization: "super", "content-type": "application/json" };
  memberReq.socket = {};
  await server.handleRequest(memberReq, memberRecorder.res);
  assert.equal(memberRecorder.state.status, 200);
  const memberBody = JSON.parse(memberRecorder.state.body);
  assert.equal(memberBody.success, true);
  assert.equal(memberBody.members.find((member) => member.steamId === "76561198377609640").expireAt, "2026-08-02 21:26:59");

  const adminFileAfterMemberUpsert = await fs.readFile(adminFilePath, "utf8");
  assert.equal((adminFileAfterMemberUpsert.match(/Admin=76561198377609640/g) ?? []).length, 1);
  assert.match(adminFileAfterMemberUpsert, /Admin=76561198377609640:BZSSVIP \/\/2026-08-02 21:26:59 名称:Alpha/);

  const deleteMemberRecorder = createRecorder();
  const deleteMemberReq = Readable.from([]);
  deleteMemberReq.method = "DELETE";
  deleteMemberReq.url = "/api/reserve-slots/members/76561198377609640";
  deleteMemberReq.headers = { host: "localhost", authorization: "super" };
  deleteMemberReq.socket = {};
  await server.handleRequest(deleteMemberReq, deleteMemberRecorder.res);
  assert.equal(deleteMemberRecorder.state.status, 200);
  const deleteMemberBody = JSON.parse(deleteMemberRecorder.state.body);
  assert.equal(deleteMemberBody.success, true);
  assert.equal(deleteMemberBody.members.some((member) => member.steamId === "76561198377609640"), false);

  await fs.writeFile(adminFilePath, [
    "header",
    "// 预留位",
    "Group=BZSSVIP:reserve",
    "Admin=76561198377609640:BZSSVIP //2020-06-02 21:26:59 名称:Expired",
    "Admin=76561198992120471:BZSSVIP //2099-06-06 22:31:03 名称:Active",
  ].join("\n"), "utf8");
  await reserveModule.api.importFromAdminFile();

  const deleteExpiredRecorder = createRecorder();
  const deleteExpiredReq = Readable.from([]);
  deleteExpiredReq.method = "POST";
  deleteExpiredReq.url = "/api/reserve-slots/delete-expired";
  deleteExpiredReq.headers = { host: "localhost", authorization: "super" };
  deleteExpiredReq.socket = {};
  await server.handleRequest(deleteExpiredReq, deleteExpiredRecorder.res);
  assert.equal(deleteExpiredRecorder.state.status, 200);
  const deleteExpiredBody = JSON.parse(deleteExpiredRecorder.state.body);
  assert.equal(deleteExpiredBody.success, true);
  assert.equal(deleteExpiredBody.members.some((member) => member.steamId === "76561198377609640"), false);
  assert.equal(deleteExpiredBody.members.some((member) => member.steamId === "76561198992120471"), true);

  await fs.rm(tempDir, { recursive: true, force: true });
}

await testParserHandlesAdminBlock();
await testEnsureReserveSlotStoreFileCreatesAndRepairs();
await testUpsertAdminFileContentAppendsMissingBlock();
await testUpsertAdminFileContentUpdatesExistingMember();
await testUpsertAdminFileContentValidatesInput();
await testRemoveReserveSlotMembersFromAdminFileContent();
await testModuleAndRoutesWorkEndToEnd();

console.log("reserve slots tests passed");
