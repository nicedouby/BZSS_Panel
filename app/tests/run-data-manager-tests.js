// -*- coding: utf-8 -*-

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { handleDataManagerRoutes } from "../modules/data-manager/routes.js";
import { DataManagerService } from "../modules/data-manager/service.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-data-manager-"));
const oldTime = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);

try {
  await writeFile("data/replay-spool/closed/segments/000001.rps", Buffer.alloc(2_048), oldTime);
  await writeFile("data/replay-spool/active.open/segments/000001.open.rps", Buffer.alloc(1_024), oldTime);
  await writeFile("data/server-stats/BZSS-2026-01-01.jsonl", Buffer.alloc(512), oldTime);
  await writeFile("data/player-session-records/history.jsonl", Buffer.alloc(128), oldTime);
  await writeFile("data/micepanel.db", Buffer.alloc(4_096), oldTime);
  await writeFile("data/plugins/panel-ban/bans.json", Buffer.alloc(256), oldTime);
  await writeFile("LogPost/dead-letter/2026-01-01.jsonl", Buffer.alloc(64), oldTime);

  const service = new DataManagerService({ rootDirectory: root });
  const overview = await service.getOverview();
  assert.equal(overview.ok, true);
  assert.ok(overview.summary.totalBytes >= 8_128);

  const replay = overview.categories.find((item) => item.relativePath === "data/replay-spool");
  const database = overview.categories.find((item) => item.relativePath === "data/micepanel.db");
  const panelBan = overview.categories.find((item) => item.relativePath === "data/plugins/panel-ban");
  const deadLetter = overview.categories.find((item) => item.relativePath === "LogPost/dead-letter");
  assert.equal(replay?.cleanable, true);
  assert.equal(replay?.activeFileCount, 1);
  assert.equal(database?.cleanable, false);
  assert.equal(panelBan?.cleanable, false);
  assert.equal(deadLetter?.cleanable, true);

  await assert.rejects(
    () => service.cleanup({ ids: [database.id] }),
    (error) => error?.code === "ProtectedDataCategory",
  );
  assert.ok(await exists("data/micepanel.db"));

  const retained = await service.cleanup({ ids: [replay.id], olderThanDays: 90 });
  assert.equal(retained.deletedFiles, 0);
  assert.ok(await exists("data/replay-spool/closed/segments/000001.rps"));

  const cleaned = await service.cleanup({ ids: [replay.id], olderThanDays: 30 });
  assert.equal(cleaned.deletedFiles, 1);
  assert.equal(cleaned.deletedBytes, 2_048);
  assert.equal(cleaned.skippedActiveFiles, 1);
  assert.equal(await exists("data/replay-spool/closed/segments/000001.rps"), false);
  assert.ok(await exists("data/replay-spool/active.open/segments/000001.open.rps"));

  const after = await service.getOverview();
  const replayAfter = after.categories.find((item) => item.relativePath === "data/replay-spool");
  assert.equal(replayAfter.fileCount, 1);

  await testRouteAuthorizationAndAudit();

  console.log("data manager tests passed");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function writeFile(relativePath, content, modifiedAt) {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
  await fs.utimes(filePath, modifiedAt, modifiedAt);
}

async function exists(relativePath) {
  return fs.access(path.join(root, relativePath)).then(() => true, () => false);
}

async function testRouteAuthorizationAndAudit() {
  let response = null;
  let auditContext = null;
  let cleanupPayload = null;
  const api = {
    async cleanup(payload) {
      cleanupPayload = payload;
      return { ok: true, deletedBytes: 64, deletedFiles: 1, failedFiles: 0 };
    },
  };
  const common = {
    core: { authManager: { hasEverything: (user) => Boolean(user?.isSuperAdmin) } },
    modules: { dataManager: api },
    url: new URL("http://localhost/api/data-manager/cleanup"),
    req: { method: "POST" },
    readJsonBody: async () => ({ ids: ["category-1"], olderThanDays: 30, confirmation: "CLEAN_DATA" }),
    json: (status, body) => { response = { status, body }; },
    executeAudited: async (context, executor) => {
      auditContext = context;
      return executor();
    },
  };

  assert.equal(await handleDataManagerRoutes({ ...common, user: null }), true);
  assert.equal(response?.status, 403);

  response = null;
  assert.equal(await handleDataManagerRoutes({ ...common, user: { id: "root", isSuperAdmin: true } }), true);
  assert.equal(response?.status, 200);
  assert.deepEqual(cleanupPayload, { ids: ["category-1"], olderThanDays: 30 });
  assert.equal(auditContext?.action, "data.cleanup");
  assert.equal(auditContext?.actor?.id, "root");
}
