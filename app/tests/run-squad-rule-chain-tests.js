import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { classifySquadName } from "../domain/squad/squad_name_classifier.js";
import { createSquadNamePolicyGuardModule } from "../modules/squad-name-policy-guard/index.js";
import { createSquadRuleChainModule } from "../modules/squad-rule-chain/index.js";
import { normalizeRuleChainPassEvent, normalizeSquadRuleViolationEvent } from "../modules/squad-rule-chain/events.js";
import { createPlugin as createStepwisePlugin } from "../plugins/stepwise-squad-playtime-guard.js";
import { createPlugin as createFairPlugin } from "../plugins/fair-squad-guard.js";

function createEventBus() {
  const moduleListeners = new Map();
  const coreListeners = new Map();
  return {
    onCoreEvent(eventName, handler) {
      if (!coreListeners.has(eventName)) coreListeners.set(eventName, new Set());
      coreListeners.get(eventName).add(handler);
      return () => coreListeners.get(eventName)?.delete(handler);
    },
    emitCoreEvent(eventName, event) {
      for (const handler of coreListeners.get(eventName) ?? []) {
        handler(event);
      }
    },
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

function testClassificationFieldsNormalizeWithoutLoss() {
  const classification = {
    squadType: "vehicle",
    squadNature: "vehicle",
    squadTypeId: "ifv",
    squadTypeLabel: "步战车",
    squadRuleId: "rule:bmp",
    effectiveMaxPlayers: 4,
    maxPlayersSource: "type_default",
    assetPath: "/Game/BMP",
    classificationMetadata: { matchedKind: "canonical" },
    playtime: { known: true, gameSeconds: 3600000, hoursText: "1000h", source: "module.playtime" },
  };
  for (const event of [
    normalizeRuleChainPassEvent(classification),
    normalizeSquadRuleViolationEvent(classification),
  ]) {
    assert.equal(event.squadType, "vehicle");
    assert.equal(event.squadNature, "vehicle");
    assert.equal(event.squadTypeId, "ifv");
    assert.equal(event.squadTypeLabel, "步战车");
    assert.equal(event.squadRuleId, "rule:bmp");
    assert.equal(event.effectiveMaxPlayers, 4);
    assert.equal(event.maxPlayersSource, "type_default");
    assert.equal(event.assetPath, "/Game/BMP");
    assert.deepEqual(event.classificationMetadata, { matchedKind: "canonical" });
    assert.deepEqual(event.playtime, classification.playtime);
  }
}

async function createHarness(options = {}) {
  const createdTempDir = !options.tempDir;
  const tempDir = options.tempDir ?? await fs.mkdtemp(path.join(os.tmpdir(), "bzss-rule-chain-"));
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
        const hasMatchId = Object.prototype.hasOwnProperty.call(options, "matchId");
        return {
          serverId: "test-server",
          matchId: hasMatchId ? options.matchId : "match-1",
          isWarmup: false,
          logClockSeconds: options.logClockSeconds ?? 10,
          logClockHasAnchor: true,
          logClockAnchorLogTime: "2026-06-20T00:00:00.000Z",
          playerCount: options.playerCount ?? 60,
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
        return options.disbandResult ?? { ok: true };
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
        return {
          players: Array.from(
            { length: options.playerCount ?? 60 },
            (_, index) => ({ name: `P${index}` }),
          ),
        };
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
    matchCache: {
      getStatus() {
        return {
          currentMatch: options.matchCacheCurrentMatch ?? null,
          cachedMatch: options.matchCacheCachedMatch ?? options.matchCacheCurrentMatch ?? null,
        };
      },
    },
    pluginSubscriptions: {
      isSubscribed() { return true; },
      registerRuntimeItem() {},
    },
  };

  const config = {
    get(key, fallback) {
      if (key === "squadNamePolicy.path") return options.policyPath ?? path.join(process.cwd(), "config", "squad_name_policy.json");
      if (key === "modules.squadNamePolicyGuard") {
        return {
          enabled: true,
          detectLogCreated: true,
          action: "disband_then_warn",
          warningRepeatCount: 1,
        };
      }
      if (key === "modules.squadRuleChain") {
        return {
          directory: path.join(tempDir, "rule-chain"),
          finalPassFallbackDelayMs: options.finalPassFallbackDelayMs,
          enforcementPlayerThreshold: 50,
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
          enabled: options.fairEnabled !== false,
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
  modules.squadRuleChain = ruleChain.api;
  const nameGuard = createSquadNamePolicyGuardModule({ core, modules, config, logger: noopLogger() });
  const stepwise = createStepwisePlugin({ core, modules, config, logger: noopLogger() });
  const fair = createFairPlugin({ core, modules, config, logger: noopLogger() });

  await ruleChain.init?.();
  await ruleChain.start();
  await nameGuard.start();
  await stepwise.init?.();
  await stepwise.start();
  await fair.init?.();
  await fair.start();

  return {
    eventBus,
    ruleChain,
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
      if (createdTempDir) {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    },
  };
}

async function testNameViolationShortCircuits() {
  const harness = await createHarness();
  try {
    harness.eventBus.emitModuleEvent("module.squadLifecycle", "squadCreated", creation({ squadName: "BMP违规队", squadId: 11 }));
    await waitFor(() => harness.disbands.length === 1);
    assert.equal(harness.disbands.length, 1);
    assert.equal(harness.removes.length, 1);
    assert.equal(harness.warnings.length >= 1, true);
    assert.equal(
      harness.broadcasts.some((item) => item.reason === "squad_name_rule_broadcast"),
      true,
    );
    const stepwiseState = harness.stepwise.api.getStatus();
    assert.equal(stepwiseState.recentRecords.length, 0);
  } finally {
    await harness.stop();
  }
}

async function testNameViolationStillEnforcesBelowPopulationThreshold() {
  const harness = await createHarness({ playerCount: 5 });
  try {
    harness.eventBus.emitModuleEvent(
      "module.squadLifecycle",
      "squadCreated",
      creation({ squadName: "BMP违规队", squadId: 12 }),
    );
    await waitFor(() => harness.disbands.length === 1);
    assert.equal(harness.disbands.length, 1);
  } finally {
    await harness.stop();
  }
}

async function testPopulationThresholdSkipsHistoryWithoutPausingClock() {
  const options = { playerCount: 40, logClockSeconds: 10 };
  const harness = await createHarness(options);
  try {
    harness.eventBus.emitModuleEvent(
      "module.squadLifecycle",
      "squadCreated",
      creation({ squadName: "BMP违规队", squadId: 111 }),
    );
    await waitFor(() => harness.ruleChain.api.getState().stats.populationSkipped === 1);
    assert.equal(harness.disbands.length, 0);
    assert.equal(harness.removes.length, 0);
    assert.equal(harness.warnings.length, 0);
    let state = harness.ruleChain.api.getState();
    assert.equal(state.enforcement.active, false);
    assert.equal(state.enforcement.playerCount, 40);
    assert.equal(state.recent[0].status, "population_skipped");

    options.playerCount = 51;
    options.logClockSeconds = 25;
    await waitFor(() => harness.ruleChain.api.getState().enforcement.active === true);
    assert.equal(harness.disbands.length, 0, "low-population violations must never be replayed");

    harness.eventBus.emitModuleEvent(
      "module.squadLifecycle",
      "squadCreated",
      creation({ squadName: "BMP违规队", squadId: 112 }),
    );
    await waitFor(() => harness.disbands.length === 1);
    state = harness.ruleChain.api.getState();
    assert.equal(state.enforcement.playerCount, 51);
    assert.equal(state.stats.populationSkipped, 1);
    assert.equal(harness.disbands[0].squadId, 112);
    assert.equal(options.logClockSeconds, 25, "population gating must not reset the shared log clock");
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

async function testFinalPassBroadcastAssignsOrderAndReplacesPlayerRecord() {
  const playtimeRows = new Map([["steam-1", { game_seconds: 1000 * 3600 }]]);
  const harness = await createHarness({ playtimeRows, logClockSeconds: 60 });

  try {
    harness.broadcasts.length = 0;
    harness.eventBus.emitModuleEvent(
      "module.squadLifecycle",
      "squadCreated",
      creation({ squadName: "Squad 1", squadId: 31 }),
    );

    await waitFor(() => harness.broadcasts.some((item) => item.reason === "squad_rule_chain_final_pass_broadcast"));

    let state = harness.ruleChain.api.getState();
    assert.equal(state.finalPassRecords.length, 1);
    assert.equal(state.finalPassRecords[0].creationOrderCode, 1);
    assert.equal(state.finalPassRecords[0].event.squadId, 31);
    const squad1Nature = classifySquadName("Squad 1").label;
    const squad1Broadcast = harness.broadcasts.find((item) => item.reason === "squad_rule_chain_final_pass_broadcast").message;
    assert.equal(squad1Broadcast.includes("\u961F\u4F0D\u6027\u8D28"), true);
    assert.equal(squad1Broadcast.includes(squad1Nature), true);
    assert.equal(state.finalPassRecords[0].event.squadNature, "infantry");
    assert.equal(state.finalPassRecords[0].event.squadTypeId, "infantry");
    assert.equal(state.finalPassRecords[0].event.squadTypeLabel, "战斗步兵");

    harness.eventBus.emitModuleEvent(
      "module.squadLifecycle",
      "squadCreated",
      creation({ squadName: "Squad 2", squadId: 32, createdAt: new Date(Date.now() + 1000).toISOString() }),
    );

    await waitFor(() => harness.broadcasts.filter((item) => item.reason === "squad_rule_chain_final_pass_broadcast").length === 2);

    state = harness.ruleChain.api.getState();
    assert.equal(state.finalPassRecords.length, 1);
    assert.equal(state.finalPassRecords[0].creationOrderCode, 2);
    assert.equal(state.finalPassRecords[0].event.squadId, 32);
    assert.equal(Boolean(state.finalPassRecords[0].replacedRecordId), true);
  } finally {
    await harness.stop();
  }
}

async function testTieredPassFallbackBroadcastsWhenFairSkips() {
  const harness = await createHarness({
    fairEnabled: false,
    finalPassFallbackDelayMs: 10,
  });

  try {
    harness.broadcasts.length = 0;
    harness.eventBus.emitModuleEvent(
      "module.squadRuleChain",
      "tieredSquadTimePassed",
      creation({ squadName: "Fallback", squadId: 41 }),
    );

    await waitFor(() => harness.broadcasts.some((item) => item.reason === "squad_rule_chain_final_pass_broadcast"));
    const state = harness.ruleChain.api.getState();
    assert.equal(state.finalPassRecords.length, 1);
    assert.equal(state.finalPassRecords[0].event.squadId, 41);
    const fallbackNature = classifySquadName("Fallback").label;
    const fallbackBroadcast = harness.broadcasts[0].message;
    assert.equal(fallbackBroadcast.includes("\u961F\u4F0D\u6027\u8D28"), true);
    assert.equal(fallbackBroadcast.includes(fallbackNature), true);
  } finally {
    await harness.stop();
  }
}

async function testClassificationFieldsReachFinalPass() {
  const playtimeRows = new Map([["steam-1", { game_seconds: 1000 * 3600 }]]);
  const harness = await createHarness({ playtimeRows, logClockSeconds: 60 });
  try {
    harness.eventBus.emitModuleEvent("module.squadRuleChain", "squadNameRulePassed", creation({
      squadName: "BMP",
      squadId: 42,
      squadType: "vehicle",
      squadNature: "vehicle",
      squadTypeId: "ifv",
      squadTypeLabel: "步战车",
      squadRuleId: "rule:bmp",
      effectiveMaxPlayers: 4,
      maxPlayersSource: "type_default",
      assetPath: "/Game/BMP",
      classificationMetadata: { matchedKind: "canonical" },
    }));
    await waitFor(() => harness.ruleChain.api.getState().finalPassRecords.some((item) => item.event?.squadId === 42));
    const event = harness.ruleChain.api.getState().finalPassRecords.find((item) => item.event?.squadId === 42).event;
    assert.equal(event.squadType, "vehicle");
    assert.equal(event.squadNature, "vehicle");
    assert.equal(event.squadTypeId, "ifv");
    assert.equal(event.squadTypeLabel, "IFV / 步战车");
    assert.equal(event.squadRuleId, "rule:bmp");
    assert.equal(event.effectiveMaxPlayers, null);
    assert.equal(event.maxPlayersSource, "none");
    assert.equal(event.assetPath, "");
    assert.deepEqual(event.classificationMetadata, { matchedKind: "canonical" });
    assert.equal(event.playtime?.known, true);
    assert.equal(event.playtime?.hoursText, "1000h");
    const broadcast = harness.broadcasts.find((item) => item.reason === "squad_rule_chain_final_pass_broadcast");
    assert.equal(
      broadcast?.message,
      "Leader 建立了BMP小队，队伍性质：载具队，队伍类型：IFV / 步战车，游戏时长：1000h，建队码：1",
    );
  } finally {
    await harness.stop();
  }
}

async function testMatvBroadcastIncludesRequestedDetails() {
  const harness = await createHarness();
  try {
    harness.broadcasts.length = 0;
    harness.eventBus.emitModuleEvent(
      "module.squadRuleChain",
      "finalSquadRulePassed",
      creation({
        squadName: "TAPV",
        squadId: 43,
        squadType: "vehicle",
        squadNature: "vehicle",
        squadTypeId: "matv",
        squadTypeLabel: "MATV / 吉普车",
        playtime: {
          known: true,
          gameSeconds: 473.9 * 3600,
          hoursText: "473.9h",
          source: "module.playtime",
        },
      }),
    );

    await waitFor(() => harness.broadcasts.some((item) => item.reason === "squad_rule_chain_final_pass_broadcast"));
    assert.equal(
      harness.broadcasts[0].message,
      "Leader 建立了TAPV小队，队伍性质：载具队，队伍类型：MATV / 吉普车，游戏时长：473.9h，建队码：1",
    );
  } finally {
    await harness.stop();
  }
}

async function testFinalPassWarningMatchesSquadNature() {
  const harness = await createHarness();

  try {
    harness.broadcasts.length = 0;
    harness.warnings.length = 0;

    harness.eventBus.emitModuleEvent(
      "module.squadRuleChain",
      "finalSquadRulePassed",
      creation({
        squadName: "zcc 1",
        squadId: 61,
        creatorSteamId: "steam-1",
        leaderSteamId: "steam-1",
        classification: {
          valid: true,
          source: "policy_event",
          policyRevision: 5,
          typeId: "vehicle",
          typeLabel: "载具队",
          nature: "vehicle",
          natureLabel: "载具队",
          ruleId: "test:zcc",
        },
      }),
    );

    await waitFor(() => harness.broadcasts.some((item) => item.reason === "squad_rule_chain_final_pass_broadcast"));
    await waitFor(() => harness.warnings.length === 1);

    assert.equal(harness.warnings[0].message.includes("ZCC"), true);
    assert.equal(harness.warnings[0].message.includes("\u5355\u8F7D"), true);

    harness.broadcasts.length = 0;
    harness.warnings.length = 0;

    harness.eventBus.emitModuleEvent(
      "module.squadRuleChain",
      "finalSquadRulePassed",
      creation({
        squadName: "mortar 1",
        squadId: 62,
        creatorSteamId: "steam-2",
        leaderSteamId: "steam-2",
        classification: {
          valid: true,
          source: "policy_event",
          policyRevision: 5,
          typeId: "mortar",
          typeLabel: "迫击炮",
          nature: "support",
          natureLabel: "支援队",
          ruleId: "test:mortar",
        },
      }),
    );

    await waitFor(() => harness.broadcasts.some((item) => item.reason === "squad_rule_chain_final_pass_broadcast"));
    await waitFor(() => harness.warnings.length === 1);

    assert.equal(harness.warnings[0].message.includes("\u8FEB\u51FB\u70AE"), true);
  } finally {
    await harness.stop();
  }
}
async function testFinalPassCacheRestoresSameMatch() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-rule-chain-cache-"));
  try {
    const first = await createHarness({ tempDir });
    try {
      first.eventBus.emitModuleEvent(
        "module.squadRuleChain",
        "finalSquadRulePassed",
        creation({ squadName: "Cached", squadId: 51 }),
      );
      await waitFor(() => first.ruleChain.api.getState().finalPassRecords.length === 1);
    } finally {
      await first.stop();
    }

    const second = await createHarness({ tempDir });
    try {
      const restored = second.ruleChain.api.getState();
      assert.equal(restored.finalPassRecords.length, 1);
      assert.equal(restored.finalPassRecords[0].event.squadId, 51);
      assert.equal(restored.finalPassRecords[0].creationOrderCode, 1);

      second.eventBus.emitModuleEvent(
        "module.squadRuleChain",
        "finalSquadRulePassed",
        creation({ squadName: "Cached 2", squadId: 52, creatorSteamId: "steam-2", leaderSteamId: "steam-2" }),
      );
      await waitFor(() => second.ruleChain.api.getState().finalPassRecords.length === 2);
      const next = second.ruleChain.api.getState().finalPassRecords.find((record) => record.event.squadId === 52);
      assert.equal(next.creationOrderCode, 2);
    } finally {
      await second.stop();
    }

    const third = await createHarness({ tempDir, matchId: "match-2" });
    try {
      const differentMatch = third.ruleChain.api.getState();
      assert.equal(differentMatch.finalPassRecords.length, 0);
    } finally {
      await third.stop();
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testFinalPassCacheRestoresByMatchCacheAlias() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-rule-chain-cache-alias-"));
  const matchCacheCurrentMatch = {
    sessionId: "match-cache:test-server:map|layer|raas:1782478202657",
    fingerprint: "map|layer|raas|team-a|team-b",
    baseKey: "map|layer|raas",
    fullKey: "map|layer|raas|team-a|team-b",
  };

  try {
    const first = await createHarness({ tempDir, matchCacheCurrentMatch });
    try {
      first.eventBus.emitModuleEvent(
        "module.squadRuleChain",
        "finalSquadRulePassed",
        creation({ squadName: "Alias Cached", squadId: 61 }),
      );
      await waitFor(() => first.ruleChain.api.getState().finalPassRecords.length === 1);
    } finally {
      await first.stop();
    }

    const second = await createHarness({
      tempDir,
      matchId: "",
      matchCacheCurrentMatch: {
        ...matchCacheCurrentMatch,
        sessionId: "match-cache:test-server:map|layer|raas:1782478210000",
      },
    });
    try {
      const restored = second.ruleChain.api.getState();
      assert.equal(restored.finalPassRecords.length, 1);
      assert.equal(restored.finalPassRecords[0].event.squadId, 61);
    } finally {
      await second.stop();
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testLegacyFinalPassCacheRestoresBySessionTimestamp() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-rule-chain-cache-legacy-"));
  try {
    const cacheDir = path.join(tempDir, "rule-chain");
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(path.join(cacheDir, "final-pass-cache.json"), JSON.stringify({
      version: 1,
      cacheKey: "test-server|match:20260626_204850_abc",
      updatedAt: "2026-06-26T12:49:14.842Z",
      nextCreationOrderCode: 2,
      finalPassRecords: [{
        id: "legacy-final-pass",
        createdAt: "2026-06-26T12:49:14.778Z",
        updatedAt: "2026-06-26T12:49:14.842Z",
        event: creation({ squadName: "Legacy Cached", squadId: 71, matchId: "20260626_204850_abc" }),
        creationOrderCode: 1,
        actions: [],
        status: "handled",
      }],
    }, null, 2));

    const restoredHarness = await createHarness({
      tempDir,
      matchId: "",
      matchCacheCurrentMatch: {
        sessionId: "match-cache:test-server:map|layer|raas:1782478202657",
        fingerprint: "map|layer|raas",
        baseKey: "map|layer|raas",
      },
    });
    try {
      const restored = restoredHarness.ruleChain.api.getState();
      assert.equal(restored.finalPassRecords.length, 1);
      assert.equal(restored.finalPassRecords[0].event.squadId, 71);
    } finally {
      await restoredHarness.stop();
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testFinalPassCacheNormalizesDuplicateOrderCodes() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-rule-chain-cache-duplicates-"));
  try {
    const cacheDir = path.join(tempDir, "rule-chain");
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(path.join(cacheDir, "final-pass-cache.json"), JSON.stringify({
      version: 1,
      cacheKey: "test-server|match:match-1",
      updatedAt: "2026-06-26T12:55:22.454Z",
      nextCreationOrderCode: 3,
      finalPassRecords: [
        {
          id: "order-1",
          createdAt: "2026-06-26T12:50:43.267Z",
          event: creation({ squadName: "First", squadId: 81, createdAtMs: 1782478241755 }),
          creationOrderCode: 1,
        },
        {
          id: "order-2",
          createdAt: "2026-06-26T12:53:06.561Z",
          event: creation({ squadName: "Second", squadId: 82, createdAtMs: 1782478385051 }),
          creationOrderCode: 2,
        },
        {
          id: "order-duplicate",
          createdAt: "2026-06-26T12:55:22.345Z",
          event: creation({ squadName: "Third", squadId: 83, createdAtMs: 1782478520823 }),
          creationOrderCode: 1,
        },
      ],
    }, null, 2));

    const harness = await createHarness({ tempDir });
    try {
      const restored = harness.ruleChain.api.getState();
      const ordered = restored.finalPassRecords.slice().sort((left, right) => left.event.squadId - right.event.squadId);
      assert.deepEqual(ordered.map((record) => record.creationOrderCode), [1, 2, 3]);

      harness.eventBus.emitModuleEvent(
        "module.squadRuleChain",
        "finalSquadRulePassed",
        creation({ squadName: "Fourth", squadId: 84, creatorSteamId: "steam-4", leaderSteamId: "steam-4" }),
      );
      await waitFor(() => harness.ruleChain.api.getState().finalPassRecords.length === 4);
      const next = harness.ruleChain.api.getState().finalPassRecords.find((record) => record.event.squadId === 84);
      assert.equal(next.creationOrderCode, 4);
    } finally {
      await harness.stop();
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testManualClearCurrentRemovesFinalPassRecords() {
  const harness = await createHarness();
  try {
    harness.eventBus.emitModuleEvent(
      "module.squadRuleChain",
      "finalSquadRulePassed",
      creation({ squadName: "Clear Me", squadId: 91 }),
    );
    await waitFor(() => harness.ruleChain.api.getState().finalPassRecords.length === 1);

    const cleared = harness.ruleChain.api.clearCurrent();
    assert.equal(cleared.cleared, true);

    const state = harness.ruleChain.api.getState();
    assert.equal(state.finalPassRecords.length, 0);
    assert.equal(state.finalPassCache.cacheKey, "test-server|match:match-1");
  } finally {
    await harness.stop();
  }
}

async function testWorldBringUpClearsPreviousFinalPassRecords() {
  const harness = await createHarness();
  try {
    harness.eventBus.emitModuleEvent(
      "module.squadRuleChain",
      "finalSquadRulePassed",
      creation({ squadName: "Old Squad", squadId: 101 }),
    );
    await waitFor(() => harness.ruleChain.api.getState().finalPassRecords.length === 1);

    harness.eventBus.emitCoreEvent("round.world_bring_up", {
      eventName: "round.world_bring_up",
      serverId: "test-server",
      normalized: {
        roundWorldBringUp: {
          logLineTime: "2026.06.27-03.38.21:866",
          layerName: "Mutaha_RAAS_v2",
          mapName: "Mutaha",
          gameMode: "RAAS",
        },
      },
      logLineTime: "2026.06.27-03.38.21:866",
    });

    const state = harness.ruleChain.api.getState();
    assert.equal(state.finalPassRecords.length, 0);
    assert.equal(state.finalPassCache.cacheKey, "test-server|anchor:2026.06.27-03.38.21:866");

    harness.eventBus.emitModuleEvent(
      "module.squadRuleChain",
      "finalSquadRulePassed",
      creation({ squadName: "New Squad", squadId: 102, createdAt: new Date(Date.now() + 1000).toISOString() }),
    );
    await waitFor(() => harness.ruleChain.api.getState().finalPassRecords.length === 1);

    const nextState = harness.ruleChain.api.getState();
    assert.equal(nextState.finalPassRecords[0].creationOrderCode, 1);
    assert.equal(nextState.finalPassRecords[0].event.squadId, 102);
  } finally {
    await harness.stop();
  }
}


async function testRuntimePluginBroadcastHelpersUseModuleRegistry() {
  const harness = await createHarness({ logClockSeconds: 10 });
  try {
    await waitFor(() => harness.broadcasts.some(
      (item) => item.reason === "stepwise_squad_playtime_rule_reminder",
    ));

    harness.broadcasts.length = 0;
    harness.eventBus.emitCoreEvent("round.world_bring_up", {
      eventName: "round.world_bring_up",
      serverId: "test-server",
      eventId: "round-runtime-context",
      rawLog: "LogWorld: Bringing World /Game/Test up for play",
      logTime: "2026.07.26-13.00.00:000",
    });
    await waitFor(() => harness.broadcasts.some(
      (item) => item.reason === "fair_squad_guard_round_start",
    ));
  } finally {
    await harness.stop();
  }
}

async function testDisbandFailureIsNotReportedAsHandled() {
  const harness = await createHarness({
    disbandResult: { ok: false, error: "rcon_disband_failed" },
  });
  try {
    harness.eventBus.emitModuleEvent(
      "module.squadLifecycle",
      "squadCreated",
      creation({ squadName: "INVALID RUNTIME SQUAD", squadId: 113 }),
    );
    await waitFor(() => harness.ruleChain.api.getState().recent.length > 0);
    const record = harness.ruleChain.api.getState().recent[0];
    assert.equal(record.status, "error");
    assert.equal(record.error, "rcon_disband_failed");
    assert.equal(record.actions.some((action) => action.type === "disband_failed"), true);
  } finally {
    await harness.stop();
  }
}

testClassificationFieldsNormalizeWithoutLoss();
await testNameViolationShortCircuits();
await testNameViolationStillEnforcesBelowPopulationThreshold();
await testPopulationThresholdSkipsHistoryWithoutPausingClock();
await testStepwiseViolationShortCircuitsFair();
await testFairOnlyRunsAfterFirstTwoPass();
await testTrackingDoesNotTreatFairViolationAsAllowedCreation();
await testFinalPassBroadcastAssignsOrderAndReplacesPlayerRecord();
await testTieredPassFallbackBroadcastsWhenFairSkips();
await testClassificationFieldsReachFinalPass();
await testMatvBroadcastIncludesRequestedDetails();
await testFinalPassWarningMatchesSquadNature();
await testFinalPassCacheRestoresSameMatch();
await testFinalPassCacheRestoresByMatchCacheAlias();
await testLegacyFinalPassCacheRestoresBySessionTimestamp();
await testFinalPassCacheNormalizesDuplicateOrderCodes();
await testManualClearCurrentRemovesFinalPassRecords();
await testWorldBringUpClearsPreviousFinalPassRecords();
await testRuntimePluginBroadcastHelpersUseModuleRegistry();
await testDisbandFailureIsNotReportedAsHandled();
console.log("run-squad-rule-chain-tests: ok");
