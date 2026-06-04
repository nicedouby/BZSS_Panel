import assert from "node:assert/strict";

import { createKillManageModule } from "../modules/kill-manage/index.js";

function createHarness(overrides = {}) {
  const commands = [];
  const registeredPages = [];
  const core = {
    rconManager: {
      async dispatchCommand(request) {
        commands.push(request);
        return overrides.dispatchResult ?? {
          success: true,
          message: "OK",
        };
      },
    },
    webRegistry: {
      registerPage(page) {
        registeredPages.push(page);
      },
    },
    createLogger() {
      return logger;
    },
    logger,
  };
  const config = {
    get(path, defaultValue) {
      if (path === "modules.killManage") {
        return {
          enabled: overrides.enabled ?? true,
          maxRecords: 2,
        };
      }
      return defaultValue;
    },
  };
  const module = createKillManageModule({ core, modules: {}, config, logger });
  return { module, commands, registeredPages };
}

const logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

async function testKillPlayerDispatchesAdminKill() {
  const harness = createHarness();

  const result = await harness.module.api.killPlayer({
    targetName: "Player One",
    reason: "test",
    system: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.command, 'AdminKill "Player One"');
  assert.equal(harness.commands.length, 1);
  assert.equal(harness.commands[0].command, 'AdminKill "Player One"');
  assert.equal(harness.commands[0].requestedBy, "module.killManage");
  assert.equal(harness.commands[0].priority, "high");
}

async function testMissingTargetIsStoredAndSkipped() {
  const harness = createHarness();

  const result = await harness.module.api.killPlayer({ reason: "missing" });

  assert.equal(result.success, false);
  assert.equal(result.skipped, true);
  assert.equal(result.skipReason, "missing_target");
  assert.equal(harness.commands.length, 0);
  assert.equal(harness.module.api.getRecentKills("", 10).length, 1);
}

async function testStoreHonorsMaxRecords() {
  const harness = createHarness();

  await harness.module.api.killPlayer({ targetName: "A", system: true });
  await harness.module.api.killPlayer({ targetName: "B", system: true });
  await harness.module.api.killPlayer({ targetName: "C", system: true });

  const records = harness.module.api.getRecentKills("", 10);
  assert.equal(records.length, 2);
  assert.equal(records[0].targetName, "C");
  assert.equal(records[1].targetName, "B");
}

async function testStartRegistersHiddenPage() {
  const harness = createHarness();

  await harness.module.start();

  assert.equal(harness.registeredPages.length, 1);
  assert.equal(harness.registeredPages[0].id, "web.killManage");
}

await testKillPlayerDispatchesAdminKill();
await testMissingTargetIsStoredAndSkipped();
await testStoreHonorsMaxRecords();
await testStartRegistersHiddenPage();

console.log("kill manage tests passed");
