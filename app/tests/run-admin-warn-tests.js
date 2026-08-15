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
    message: "line1\r\nline2\n\"quoted\"",
    sourceModule: "damage_display",
    reason: "victim_damage",
    relatedEventId: "combat-1",
  });

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, `AdminWarn "PlayerA" "line1\nline2\n'quoted'"`);
  assert.equal(calls[0].priority, "high");
  assert.equal(calls[0].bypassRateLimit, undefined);

  const records = module.api.getRecent({ limit: 10 });
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, "warning");
  assert.equal(records[0].message, "line1\nline2\n'quoted'");
  assert.equal(records[0].sourceModule, "damage_display");
  assert.equal(records[0].relatedEventId, "combat-1");
  await module.stop();
}

async function testWarnByPlayerIdPreferred() {
  const calls = [];
  const { module } = createHarness({
    async dispatchCommand(request) {
      calls.push(request);
      return { success: true, message: "ok", rconExecuted: true, rconResponse: "" };
    },
  });

  await module.start();
  const result = await module.api.warnPlayer({
    targetName: "don",
    targetPlayerId: "123",
    message: "test message",
    sourceModule: "module.test",
    reason: "test_warning",
  });

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, `AdminWarnById 123 "test message"`);

  const records = module.api.getRecent({ targetPlayerId: "123" });
  assert.equal(records.length, 1);
  assert.equal(records[0].targetName, "don");
  assert.equal(records[0].targetPlayerId, "123");

  await module.stop();
}

async function testWarnByNameFallbackForLegacyCallers() {
  const calls = [];
  const { module } = createHarness({
    async dispatchCommand(request) {
      calls.push(request);
      return { success: true, message: "ok", rconExecuted: true, rconResponse: "" };
    },
  });

  await module.start();

  await module.api.warnPlayer({
    targetName: "LegacyPlayer",
    message: "legacy warn",
    sourceModule: "legacy.plugin",
    reason: "legacy_warn",
  });

  assert.equal(calls[0].command, `AdminWarn "LegacyPlayer" "legacy warn"`);

  await module.stop();
}

async function testRequirePlayerIdSkipsNameFallback() {
  const calls = [];
  const { module } = createHarness({
    async dispatchCommand(request) {
      calls.push(request);
      return { success: true, message: "ok", rconExecuted: true, rconResponse: "" };
    },
  });

  await module.start();

  const result = await module.api.warnPlayer({
    targetName: "don",
    message: "should not send by name",
    sourceModule: "module.test",
    reason: "test_warning",
    requireTargetPlayerId: true,
  });

  assert.equal(result.success, false);
  assert.equal(result.skipped, true);
  assert.equal(result.skipReason, "missing_target_player_id");
  assert.equal(calls.length, 0);

  await module.stop();
}

async function testBroadcastSuccessAndKindFilter() {
  const calls = [];
  const { module } = createHarness({
    async dispatchCommand(request) {
      calls.push(request);
      return { success: true, message: "ok", rconExecuted: true, rconResponse: "" };
    },
  });

  await module.start();
  const result = await module.api.broadcastMessage({
    message: 'line1\n"quoted"',
    sourceModule: "web.broadcastModule",
    reason: "manual_broadcast",
    relatedEventId: "broadcast-1",
  });

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "AdminBroadcast line1\n'quoted'");
  assert.equal(calls[0].priority, "high");
  assert.equal(calls[0].bypassRateLimit, undefined);

  const records = module.api.getRecent({ kind: "broadcast", limit: 10 });
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, "broadcast");
  assert.equal(records[0].message, "line1\n'quoted'");
  assert.equal(records[0].relatedEventId, "broadcast-1");
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

async function testTargetWarningsAreSingleCommands() {
  const calls = [];
  const { module } = createHarness({
    async dispatchCommand(request) {
      calls.push(request);
      return { success: true, message: "ok", rconExecuted: true, rconResponse: "" };
    },
  });
  await module.start();

  await module.api.warnPlayer({ targetScope: "all", message: "server notice", sourceModule: "web.matchStatus" });
  await module.api.warnPlayer({ targetScope: "team1", message: "team one notice", sourceModule: "web.matchStatus" });
  await module.api.warnPlayer({ targetScope: "team2", message: "team two notice", sourceModule: "web.matchStatus" });

  assert.deepEqual(calls.map((item) => item.command), [
    'AdminWarn all "server notice"',
    'AdminWarn team1 "team one notice"',
    'AdminWarn team2 "team two notice"',
  ]);
  assert.equal(module.api.getRecent({ limit: 10 }).length, 3);
  await module.stop();
}

async function testBatchWarningsCanSkipHistory() {
  const { module } = createHarness();
  await module.start();
  await module.api.warnPlayer({
    targetName: "PlayerA",
    message: "batch warning",
    sourceModule: "web.matchStatus.batch",
    record: false,
  });
  assert.equal(module.api.getRecent({ limit: 10 }).length, 0);
  await module.stop();
}

await testWarnSuccessAndSanitize();
await testWarnByPlayerIdPreferred();
await testWarnByNameFallbackForLegacyCallers();
await testRequirePlayerIdSkipsNameFallback();
await testBroadcastSuccessAndKindFilter();
await testWarnBackToBackStillSends();
await testWarnFailureIsRecorded();
await testTargetWarningsAreSingleCommands();
await testBatchWarningsCanSkipHistory();

console.log("broadcast module tests passed");
