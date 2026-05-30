import assert from "node:assert/strict";

import { createAdminWarnModule } from "../modules/admin-warn/index.js";

function createHarness({ dispatchCommand, moduleConfig } = {}) {
  const module = createAdminWarnModule({
    core: {
      logger: { info() {}, warn() {}, error() {} },
      webRegistry: { registerPage() {} },
      rconManager: {
        async dispatchCommand(request) {
          if (typeof dispatchCommand === "function") {
            return dispatchCommand(request);
          }
          return { success: true, message: "ok", rconExecuted: true, rconResponse: "" };
        },
      },
    },
    config: {
      get(pathText, defaultValue) {
        if (pathText === "modules.adminWarn") {
          return {
            enabled: true,
            maxRecords: 10,
            ttlMs: 1800000,
            ...(moduleConfig ?? {}),
          };
        }
        return defaultValue;
      },
    },
  });
  return { module };
}

async function testWarnSuccessAndSanitize() {
  const calls = [];
  const { module } = createHarness({
    async dispatchCommand(request) {
      calls.push(request);
      return { success: true, message: "ok", rconExecuted: true, rconResponse: "" };
    },
  });

  await module.start();
  const result = await module.api.warnPlayer({
    targetName: "PlayerA",
    targetEosId: "eos-a",
    message: "line1\n\"quoted\"",
    sourceModule: "damage_display",
    reason: "victim_damage",
    relatedEventId: "combat-1",
  });

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, `AdminWarn "PlayerA" "[BZSS] line1 'quoted'"`);
  assert.equal(calls[0].priority, "high");

  const records = module.api.getRecent({ limit: 10 });
  assert.equal(records.length, 1);
  assert.equal(records[0].message, "[BZSS] line1 'quoted'");
  assert.equal(records[0].sourceModule, "damage_display");
  assert.equal(records[0].relatedEventId, "combat-1");
  await module.stop();
}

async function testWarnBackToBackStillSends() {
  const { module } = createHarness();
  await module.start();

  const first = await module.api.warnPlayer({
    targetName: "PlayerA",
    message: "hello",
    sourceModule: "damage_display",
    reason: "victim_damage",
  });
  const second = await module.api.warnPlayer({
    targetName: "PlayerA",
    message: "hello again",
    sourceModule: "damage_display",
    reason: "victim_damage",
  });

  assert.equal(first.success, true);
  assert.equal(second.success, true);

  const records = module.api.getRecent({ targetName: "PlayerA" });
  assert.equal(records.length, 2);
  assert.equal(records[0].skipReason, undefined);
  assert.equal(records[1].skipReason, undefined);
  await module.stop();
}

async function testWarnFailureIsRecorded() {
  const { module } = createHarness({
    async dispatchCommand() {
      return { success: false, message: "socket closed", rconExecuted: false, rconResponse: "" };
    },
  });
  await module.start();

  const result = await module.api.warnPlayer({
    targetName: "PlayerB",
    message: "test",
    sourceModule: "damage_display",
    reason: "attacker_kill",
  });

  assert.equal(result.success, false);
  assert.equal(result.errorMessage, "socket closed");

  const failed = module.api.getRecent({ success: false, skipped: false });
  assert.equal(failed.length, 1);
  assert.equal(failed[0].errorMessage, "socket closed");
  await module.stop();
}

await testWarnSuccessAndSanitize();
await testWarnBackToBackStillSends();
await testWarnFailureIsRecorded();

console.log("admin warn tests passed");
