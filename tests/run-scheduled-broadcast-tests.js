import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createScheduledBroadcastModule } from "../modules/scheduled-broadcast/index.js";

function createHarness({ dispatchCommand, moduleConfig } = {}) {
  const calls = [];
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
            return dispatchCommand(request);
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
            dataFile: path.join(os.tmpdir(), `scheduled-broadcast-test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`),
            ...(moduleConfig ?? {}),
          };
        }
        return defaultValue;
      },
    },
  });

  return { module, calls };
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
  const dataFile = path.join(os.tmpdir(), `scheduled-broadcast-test-persist-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const { module } = createHarness({
    moduleConfig: { dataFile },
  });

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
}

await testScheduledBroadcastKeepsNewlines();
await testScheduledBroadcastPersistedMessage();

console.log("scheduled broadcast tests passed");
