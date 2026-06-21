import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createSquadNamePolicyGuardModule } from "../modules/squad-name-policy-guard/index.js";
import { createSquadRuleChainModule } from "../modules/squad-rule-chain/index.js";
import { createPlugin as createStepwisePlugin } from "../plugins/stepwise-squad-playtime-guard.js";
import { createPlugin as createFairPlugin } from "../plugins/fair-squad-guard.js";

function createEventBus() {
  const moduleListeners = new Map();
  return {
    onModuleEvent(moduleId, eventName, handler) {
      const key = `${moduleId}:${eventName}`;
      if (!moduleListeners.has(key)) moduleListeners.set(key, new Set());
      moduleListeners.get(key).add(handler);
      return () => moduleListeners.get(key)?.delete(handler);
    },
    emitModuleEvent(moduleId, eventName, event) {
      const key = `${moduleId}:${eventName}`;
      for (const handler of moduleListeners.get(key) ?? []) {
        handler(event);
      }
    },
  };
}

function noopLogger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

async function waitForQueue() {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

async function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function creation(overrides = {}) {
  return {
    serverId: "test-server",
    matchId: "match-1",
    teamId: 1,
    squadId: 1,
    squadName: "INF 1",
    creatorName: "Leader",
    creatorSteamId: "steam-1",
    creatorEosId: "eos-1",
    leaderName: "Leader",
    leaderSteamId: "steam-1",
    leaderEosId: "eos-1",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

async function createHarness(options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-rule-chain-"));
  const eventBus = createEventBus();
  const warnings = [];
  const broadcasts = [];
  const disbands = [];
  const removes = [];
  const kicks = [];

  const core = {
    eventBus,
    webStatus: {
      serverId: "test-server",
      getSnapshot() {
        return {
          serverId: "test-server",
          isWarmup: false,
          logClockSeconds: options.logClockSeconds ?? 10,
          logClockHasAnchor: true,
          logClockAnchorLogTime: "2026-06-20T00:00:00.000Z",
          playerCount: 60,
          logClockManual: false,
        };
      },
    },
    webRegistry: { registerPage() {} },
    logger: noopLogger(),
    createLogger() { return noopLogger(); },
    pluginSubscriptions: { isSubscribed() { return true; } },
  };

  const modules = {
    adminWarn: {
      async warnPlayer(request) {
        warnings.push(request);
        return { success: true };
      },
      async sendAdminWarn(request) {
        warnings.push(request);
        return { success: true };
      },
      async broadcastMessage(request) {
        broadcasts.push(request);
        return { success: true };
      },
      async sendAdminBroadcast(request) {
        broadcasts.push(request);
        return { success: true };
      },
    },
    squadManagement: {
      async requestDisband(request) {
        disbands.push(request);
        return { ok: true };
      },
      async requestRemoveFromSquad(request) {
        removes.push(request);
        return { ok: true };
      },
      async requestKick(request) {
        kicks.push(request);
        return { ok: true };
      },
      getState() {
        return { players: Array.from({ length: 60 }, (_, index) => ({ name: `P${index}` })) };
      },
    },
    playtime: {
      async getBySteamID(steamID) {
        return options.playtimeRows?.get(steamID) ?? null;
      },
      async lookupSteamID() {
        return null;
      },
    },
    playerDatabase: {
      async getCachedPlayer() {
        return null;
      },
    },
    pluginSubscriptions: {
      isSubscribed() { return true; },
      registerRuntimeItem() {},
    },
  };

  const config = {
    get(key, fallback) {
      if (key === "squadNamePolicy.path") return options.policyPath ?? `${process.cwd()}\\config\\squad_name_policy.json`;
      if (key === "modules.squadNamePolicyGuard") {
        return {
          enabled: true,
          detectLogCreated: true,
          action: "disband_then_warn",
          warningRepeatCount: 1,
        };
      }
      if (key === "plugins.stepwiseSquadPlaytimeGuard") {
        return {
          enabled: true,
          directory: path.join(tempDir, "stepwise"),
          broadcastOnApproved: false,
          broadcastOnViolation: false,
          warnOnMissingPlaytime: true,
          liveLookupWhenMissing: false,
          rules: options.stepwiseRules,
        };
      }
      if (key === "plugins.fairSquadGuard") {
        return {
          enabled: true,
          directory: path.join(tempDir, "fair"),
          enforcementPlayerThreshold: 50,
          noSquadCreationSeconds: 20,
          infantryOnlyUntilSeconds: 50,
          broadcastOnApproved: false,
          broadcastOnViolation: true,
        };
      }
      return fallback;
    },
  };

  const ruleChain = createSquadRuleChainModule({ core, modules, config, logger: noopLogger() });
  const nameGuard = createSquadNamePolicyGuardModule({ core, modules, config, logger: noopLogger() });
  const stepwise = createStepwisePlugin({ core, modules, config, logger: noopLogger() });
  const fair = createFairPlugin({ core, modules, config, logger: noopLogger() });

  await ruleChain.start();
  await nameGuard.start();
  await stepwise.init?.();
  await stepwise.start();
  await fair.init?.();
  await fair.start();

  return {
    eventBus,
    nameGuard,
    stepwise,
    fair,
    warnings,
    broadcasts,
    disbands,
    removes,
    kicks,
    async stop() {
      await fair.stop();
      await stepwise.stop();
      await nameGuard.stop();
      await ruleChain.stop();
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}

async function testNameViolationShortCircuits() {
  const harness = await createHarness();
  try {
    harness.eventBus.emitModuleEvent("module.squadLifecycle", "squadCreated", creation({ squadName: "BMP队", squadId: 11 }));
    await waitFor(() => harness.disbands.length === 1);
    assert.equal(harness.disbands.length, 1);
    assert.equal(harness.removes.length, 1);
    assert.equal(harness.warnings.length >= 1, true);
    const stepwiseState = harness.stepwise.api.getStatus();
    assert.equal(stepwiseState.recentRecords.length, 0);
  } finally {
    await harness.stop();
  }
}

async function testStepwiseViolationShortCircuitsFair() {
  const playtimeRows = new Map([["steam-1", { game_seconds: 100 * 3600 }]]);
  const harness = await createHarness({ playtimeRows });
  try {
    harness.eventBus.emitModuleEvent("module.squadLifecycle", "squadCreated", creation({ squadName: "Squad 1", squadId: 12 }));
    await waitFor(() => harness.disbands.length === 1);
    assert.equal(harness.disbands.length, 1);
    const fairState = harness.fair.api.getStatus();
    const matchedRecord = fairState.recentRecords.find((item) => item?.squadId === 12);
    assert.equal(Boolean(matchedRecord), false);
  } finally {
    await harness.stop();
  }
}

async function testFairOnlyRunsAfterFirstTwoPass() {
  const playtimeRows = new Map([["steam-1", { game_seconds: 1000 * 3600 }]]);
  const harness = await createHarness({ playtimeRows, logClockSeconds: 10 });
  try {
    harness.eventBus.emitModuleEvent("module.squadLifecycle", "squadCreated", creation({ squadName: "Squad 1", squadId: 13 }));
    await waitFor(() => {
      const fairState = harness.fair.api.getStatus();
      return fairState.recentRecords.some((item) => item?.squadId === 13);
    });
    const fairState = harness.fair.api.getStatus();
    const record = fairState.recentRecords.find((item) => item?.squadId === 13);
    assert.equal(Boolean(record), true);
    assert.equal(record.violation, true);
    assert.equal(harness.disbands.length, 1);
  } finally {
    await harness.stop();
  }
}

async function testTrackingDoesNotTreatFairViolationAsAllowedCreation() {
  const playtimeRows = new Map([["steam-1", { game_seconds: 1000 * 3600 }]]);
  const harness = await createHarness({ playtimeRows, logClockSeconds: 10 });

  try {
    harness.eventBus.emitModuleEvent(
      "module.squadLifecycle",
      "squadCreated",
      creation({ squadName: "Squad 1", squadId: 21 }),
    );

    await waitFor(() => {
      const fairState = harness.fair.api.getStatus();
      return fairState.recentRecords.some((item) => item?.squadId === 21);
    });

    const nameGuardState = harness.nameGuard.api.getState();
    const stepwiseState = harness.stepwise.api.getStatus();
    const fairState = harness.fair.api.getStatus();

    const nameAllowed = nameGuardState.recent.find((item) => item.event?.squadId === 21);
    const stepwiseRecord = stepwiseState.recentRecords.find((item) => item.squadId === 21);
    const fairRecord = fairState.recentRecords.find((item) => item.squadId === 21);

    assert.equal(nameAllowed.status, "allowed");
    assert.equal(stepwiseRecord.approved, true);
    assert.equal(fairRecord.violation, true);

    // 关键断言：
    // 追踪页不能把 nameGuard.allowed 当作最终合法建队。
    // 最终状态必须来自 fairRecord，而不是 nameGuard。
    assert.equal(fairRecord.approved, false);
  } finally {
    await harness.stop();
  }
}

await testNameViolationShortCircuits();
await testStepwiseViolationShortCircuitsFair();
await testFairOnlyRunsAfterFirstTwoPass();
await testTrackingDoesNotTreatFairViolationAsAllowedCreation();
console.log("run-squad-rule-chain-tests: ok");
