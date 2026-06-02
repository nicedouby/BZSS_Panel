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
  assert.equal(parsed.members[0].expireAt, "2020-06-02 21:26:59");
  assert.equal(parsed.members[0].isExpired, true);
  assert.equal(parsed.members[1].expireAt, null);
  assert.equal(parsed.members[1].isExpired, false);
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

  const module = createReserveSlotsModule({
    core: {
      createLogger() {
        return logger;
      },
      logger,
    },
    config,
    logger,
  });
  await module.init();

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
      reserveSlots: module.api,
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
  assert.equal(importBody.lastImportedAt != null, true);

  const importedStore = JSON.parse(await fs.readFile(localReservePath, "utf8"));
  assert.equal(importedStore.source.adminFilePath, adminFilePath);
  assert.equal(importedStore.members[0].isExpired, true);

  await fs.rm(tempDir, { recursive: true, force: true });
}

await testParserHandlesAdminBlock();
await testEnsureReserveSlotStoreFileCreatesAndRepairs();
await testModuleAndRoutesWorkEndToEnd();

console.log("reserve slots tests passed");
