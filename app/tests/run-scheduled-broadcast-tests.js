import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createScheduledBroadcastModule } from "../modules/scheduled-broadcast/index.js";

function createHarness({ dispatchCommand, moduleConfig } = {}) {
  const calls = [];
  const dataFile = path.join(os.tmpdir(), `scheduled-broadcast-test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const module = createScheduledBroadcastModule({
    core: {
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      createLogger() {
        return { info() {}, warn() {}, error() {}, debug() {} };
      },
      webRegistry: { registerPage() {} },
      rconManager: {
        async dispatchCommand(request) {
          calls.push(request);
          if (typeof dispatchCommand === "function") {
            return dispatchCommand(request, calls.length - 1);
          }
          return { success: true, message: "ok", rconExecuted: true, rconResponse: "" };
        },
      },
    },
    modules: {},
    config: {
      get(pathText, defaultValue) {
        if (pathText === "modules.scheduledBroadcast") {
          return {
            enabled: true,
            tickMs: 1000,
            dataFile,
            ...(moduleConfig ?? {}),
          };
        }
        return defaultValue;
      },
    },
  });

  return { module, calls, dataFile };
}

async function addBroadcasts(module, items) {
  const created = [];
  for (const item of items) {
    created.push(await module.api.addItem(item));
  }
  return created;
}

function getCurrentOrder(state) {
  return state.items.findIndex((item) => item.isCurrent) + 1;
}

async function testScheduledBroadcastKeepsNewlines() {
  const { module, calls } = createHarness();
  await module.init();

  const item = await module.api.addItem({
    message: "line1\r\nline2\n\"quoted\"",
    intervalSeconds: 30,
    enabled: false,
  });

  assert.equal(item.message, "line1\nline2\n'quoted'");

  const result = await module.api.runNow(item.id, "manual_run");
  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "AdminBroadcast line1\nline2\n'quoted'");

  const state = module.api.getState();
  assert.equal(state.items[0].message, "line1\nline2\n'quoted'");
  await module.stop();
}

async function testScheduledBroadcastPersistedMessage() {
  const { module, dataFile } = createHarness();

  await module.init();
  const created = await module.api.addItem({
    message: "first\r\nsecond",
    intervalSeconds: 30,
    enabled: false,
  });
  await module.stop();

  const stored = JSON.parse(await fs.readFile(dataFile, "utf8"));
  assert.equal(stored.items[0].message, "first\nsecond");
  assert.equal(created.message, "first\nsecond");
  assert.equal(stored.version, 2);
  assert.equal(typeof stored.schedule, "object");
}

async function testScheduledBroadcastStrictRotation() {
  const { module, calls } = createHarness();
  await module.init();
  await addBroadcasts(module, [
    { message: "A", intervalSeconds: 10, delaySeconds: 5, enabled: true },
    { message: "B", intervalSeconds: 20, delaySeconds: 5, enabled: true },
    { message: "C", intervalSeconds: 30, delaySeconds: 5, enabled: true },
  ]);

  let state = module.api.getState();
  assert.equal(getCurrentOrder(state), 1);
  assert.equal(state.status.schedule.nextRunAt, state.items[0].createdAt + 5000);

  await module.api.tick(state.status.schedule.nextRunAt);
  assert.deepEqual(calls.map((entry) => entry.command), ["AdminBroadcast A"]);
  state = module.api.getState();
  assert.equal(getCurrentOrder(state), 2);
  assert.equal(state.status.schedule.nextRunAt, state.items[0].createdAt + 5000 + 20_000);

  await module.api.tick(state.status.schedule.nextRunAt);
  await module.api.tick(module.api.getState().status.schedule.nextRunAt);
  await module.api.tick(module.api.getState().status.schedule.nextRunAt);
  await module.api.tick(module.api.getState().status.schedule.nextRunAt);
  await module.api.tick(module.api.getState().status.schedule.nextRunAt);

  assert.deepEqual(
    calls.map((entry) => entry.command),
    [
      "AdminBroadcast A",
      "AdminBroadcast B",
      "AdminBroadcast C",
      "AdminBroadcast A",
      "AdminBroadcast B",
      "AdminBroadcast C",
    ],
  );
  await module.stop();
}

async function testScheduledBroadcastFailureStillAdvances() {
  const { module, calls } = createHarness({
    dispatchCommand(request, index) {
      if (index === 0) {
        return { success: false, message: "boom" };
      }
      return { success: true, message: "ok" };
    },
  });
  await module.init();
  await addBroadcasts(module, [
    { message: "A", intervalSeconds: 10, delaySeconds: 5, enabled: true },
    { message: "B", intervalSeconds: 20, delaySeconds: 5, enabled: true },
  ]);

  const firstRunAt = module.api.getState().status.schedule.nextRunAt;
  await module.api.tick(firstRunAt);

  let state = module.api.getState();
  assert.equal(state.items[0].lastResult, "failed");
  assert.equal(state.items[0].errorCount, 1);
  assert.equal(getCurrentOrder(state), 2);

  await module.api.tick(state.status.schedule.nextRunAt);
  state = module.api.getState();
  assert.deepEqual(calls.map((entry) => entry.command), ["AdminBroadcast A", "AdminBroadcast B"]);
  assert.equal(state.items[1].lastResult, "success");
  assert.equal(getCurrentOrder(state), 1);
  await module.stop();
}

async function testScheduledBroadcastMutationsKeepCursorCorrect() {
  const { module } = createHarness();
  await module.init();
  const [a, b, c] = await addBroadcasts(module, [
    { message: "A", intervalSeconds: 10, delaySeconds: 5, enabled: true },
    { message: "B", intervalSeconds: 20, delaySeconds: 5, enabled: true },
    { message: "C", intervalSeconds: 30, delaySeconds: 5, enabled: true },
  ]);

  let state = module.api.getState();
  assert.equal(getCurrentOrder(state), 1);

  await module.api.updateItem(a.id, { enabled: false, resetSchedule: true });
  state = module.api.getState();
  assert.equal(getCurrentOrder(state), 2);

  await module.api.reorder([c.id, b.id, a.id]);
  state = module.api.getState();
  assert.equal(state.items[0].id, c.id);
  assert.equal(getCurrentOrder(state), 2);

  await module.api.removeItem(b.id);
  state = module.api.getState();
  assert.equal(getCurrentOrder(state), 1);
  assert.equal(state.items[0].id, c.id);
  await module.stop();
}

async function testScheduledBroadcastSingleItemLoopsAndNoCatchUpBurst() {
  const { module, calls } = createHarness();
  await module.init();
  await addBroadcasts(module, [
    { message: "Solo", intervalSeconds: 12, delaySeconds: 5, enabled: true },
  ]);

  let state = module.api.getState();
  const firstRunAt = state.status.schedule.nextRunAt;
  await module.api.tick(firstRunAt + 60_000);

  assert.equal(calls.length, 1);
  state = module.api.getState();
  assert.equal(getCurrentOrder(state), 1);
  assert.equal(state.status.schedule.nextRunAt, firstRunAt + 60_000 + 12_000);

  await module.api.tick(firstRunAt + 60_001);
  assert.equal(calls.length, 1);

  await module.api.tick(state.status.schedule.nextRunAt);
  assert.equal(calls.length, 2);
  await module.stop();
}

await testScheduledBroadcastKeepsNewlines();
await testScheduledBroadcastPersistedMessage();
await testScheduledBroadcastStrictRotation();
await testScheduledBroadcastFailureStillAdvances();
await testScheduledBroadcastMutationsKeepCursorCorrect();
await testScheduledBroadcastSingleItemLoopsAndNoCatchUpBurst();

console.log("scheduled broadcast tests passed");
