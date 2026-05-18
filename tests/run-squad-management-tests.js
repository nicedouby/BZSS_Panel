import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createSquadManagementModule } from "../modules/squad-management/index.js";
import { getPluginById, updatePluginConfig } from "../core/plugins/plugin.service.js";

function createHarness(overrides = {}) {
  const coreListeners = new Map();
  const moduleListeners = new Map();
  const commands = [];
  const auditRecords = [];
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), "bzss-squad-"));

  const clock = {
    serverId: "BZSS_Main",
    logClockSeconds: 60,
    logClockHasAnchor: true,
    logClockManual: false,
    logClockLastResetAt: "2026-05-13T20:00:00.000Z",
    logClockLastResetReason: "worldBringUp",
    isWarmup: false,
    ...overrides.clock,
  };

  const squads = overrides.squads ?? [];
  const records = overrides.records ?? [];

  const core = {
    logger: makeLogger(),
    createLogger: () => makeLogger(),
    webStatus: {
      serverId: "BZSS_Main",
      getSnapshot() {
        return {
          serverId: clock.serverId,
          logClockSeconds: clock.logClockSeconds,
          logClockHasAnchor: clock.logClockHasAnchor,
          logClockManual: clock.logClockManual,
          logClockLastResetAt: clock.logClockLastResetAt,
          logClockLastResetReason: clock.logClockLastResetReason,
          isWarmup: clock.isWarmup,
        };
      },
    },
    authManager: {
      hasEverything(user) {
        return Boolean(user?.isSuperAdmin);
      },
      hasPermission(user, permission) {
        if (!user) return false;
        if (user.isSuperAdmin) return true;
        const permissions = Array.isArray(user.permissions) ? user.permissions : [];
        return permissions.includes("*") || permissions.includes(permission);
      },
    },
    rconManager: {
      async dispatchCommand({ command }) {
        commands.push(command);
        return {
          success: true,
          message: "RCON command executed.",
          rconExecuted: true,
          rconResponse: "OK",
        };
      },
    },
    eventBus: {
      onCoreEvent(eventName, handler) {
        return subscribe(coreListeners, eventName, handler);
      },
      onModuleEvent(moduleId, eventName, handler) {
        return subscribe(moduleListeners, `${moduleId}:${eventName}`, handler);
      },
      emitCoreEvent(eventName, event) {
        emit(coreListeners, eventName, {
          ...event,
          eventName,
        });
      },
      emitModuleEvent(moduleId, eventName, event) {
        emit(moduleListeners, `${moduleId}:${eventName}`, {
          ...event,
          eventName,
          source: moduleId,
        });
      },
    },
  };

  const modules = {
    playerState: {
      getState() {
        return {
          count: Number(overrides.playerCount ?? 0),
          players: Array.isArray(overrides.players) ? overrides.players : [],
        };
      },
      getOnlinePlayers() {
        return Array.isArray(overrides.players) ? overrides.players : [];
      },
    },
    matchState: {
      getState() {
        return {
          squads: {
            list: squads,
          },
        };
      },
      getOverview() {
        return {
          squads,
        };
      },
    },
    squadState: {
      getSquads() {
        return squads;
      },
    },
    squadLifecycle: {
      getCurrentMatchId() {
        return String(overrides.matchId ?? "match-1");
      },
      getCurrent() {
        return {
          matchId: String(overrides.matchId ?? "match-1"),
          list: records,
        };
      },
      getAllRecords() {
        return records;
      },
    },
    audit: {
      async record(record) {
        auditRecords.push(record);
        return record;
      },
    },
  };

  const config = {
    get(path, defaultValue) {
      if (path === "database") {
        return {
          dir: tempDbDir,
          filename: "micepanel.db",
        };
      }
      if (path === "modules.squadManagement") {
        return {
          enabled: true,
          disbandPermission: "squad.disband",
          kickPermission: "squad.kick",
          kickThreshold: 10,
          noBuildUntilSeconds: 20,
          infantryOnlyUntilSeconds: 50,
          sweepIntervalMs: 15_000,
          allowedInfantryNames: ["\u840c\u65b0\u961f", "\u586b\u7ebf\u961f"],
          defaultSquadNamePattern: "^Squad\\s*\\d+$",
          ...overrides.moduleConfig,
        };
      }
      return defaultValue;
    },
  };

  const module = createSquadManagementModule({ core, modules, config, logger: core.logger });

  return {
    core,
    modules,
    module,
    clock,
    tempDbDir,
    squads,
    records,
    commands,
    auditRecords,
  };
}

function makeLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

function subscribe(map, key, handler) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(handler);
  return () => map.get(key)?.delete(handler);
}

function emit(map, key, event) {
  for (const handler of map.get(key) ?? []) {
    handler(event);
  }
}

function flushAsync() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function cleanupTempDbDir(dir) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 5 || (error?.code !== "EBUSY" && error?.code !== "EPERM")) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

function makeSquadRecord(index, overrides = {}) {
  const baseTime = Date.parse("2026-05-13T20:00:00.000Z");
  return {
    serverId: "BZSS_Main",
    matchId: "match-1",
    teamId: 1,
    squadId: index,
    squadName: `Squad ${index}`,
    creatorName: "Builder",
    creatorSteamId: "76561198000000001",
    creatorEosId: "eos-1",
    creationSource: "LOG",
    creationConfidence: "HIGH",
    createdAtMs: baseTime + index * 1000,
    ...overrides,
  };
}

async function testBootstrapAutoKicksFrequentCreators() {
  const records = Array.from({ length: 11 }, (_, index) => makeSquadRecord(index + 1, {
    creatorName: "AbusiveBuilder",
    creatorSteamId: "76561198000009999",
    creatorEosId: "eos-abuse",
    squadName: `Squad ${index + 1}`,
    squadId: index + 1,
    createdAtMs: Date.parse("2026-05-13T20:01:00.000Z") + index * 1000,
  }));

  const harness = createHarness({
    playerCount: 1,
    clock: {
      logClockSeconds: 75,
      logClockLastResetAt: "2026-05-13T20:00:00.000Z",
    },
    records,
    squads: records.map((record) => ({
      teamID: record.teamId,
      squadID: record.squadId,
      squadName: record.squadName,
      teamName: "USA",
      creatorName: record.creatorName,
      creatorSteamID: record.creatorSteamId,
      creatorEOSID: record.creatorEosId,
      raw: "",
    })),
  });

  try {
    await harness.module.start();
    await flushAsync();

    const state = harness.module.api.getState();
    assert.equal(state.creators[0].count, 11);
    assert.equal(harness.commands.some((command) => command.startsWith('AdminKick "76561198000009999"')), true);
  } finally {
    await harness.module.stop();
    await cleanupTempDbDir(harness.tempDbDir);
  }
}

async function testNoBuildEventDisbandsSquadAndManualPermissionsAreChecked() {
  const harness = createHarness({
    playerCount: 1,
    clock: {
      logClockSeconds: 10,
      logClockLastResetAt: "2026-05-13T20:00:00.000Z",
    },
  });

  try {
    await harness.module.start();
    await flushAsync();

    harness.core.eventBus.emitModuleEvent("module.squadLifecycle", "squadCreated", {
      serverId: "BZSS_Main",
      matchId: "match-1",
      teamId: 1,
      squadId: 9,
      squadName: "Squad 9",
      creatorName: "RuleBreaker",
      creatorSteamId: "76561198000001234",
      creatorEosId: "eos-rulebreaker",
      createdAtMs: Date.parse("2026-05-13T20:00:10.000Z"),
      creationSignature: "sig-rulebreaker",
      sourceEventId: "event-1",
    });
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 200));

    assert.equal(harness.commands.some((command) => command === "AdminDisbandSquad 1 9"), true);

    const records = await harness.module.api.getRecords({ limit: 20 });
    assert.equal(records.summary.created >= 1, true);
    assert.equal(records.summary.disbanded >= 1, true);
    assert.equal(records.records.some((record) => record.kind === "squad_created"), true);
    assert.equal(records.records.some((record) => record.kind === "disband"), true);

    const disbandDenied = await harness.module.api.disband({
      actor: {
        id: "user-1",
        username: "mod",
        role: "Moderator",
        permissions: [],
      },
      teamId: 1,
      squadId: 9,
    });
    assert.equal(disbandDenied.ok, false);
    assert.equal(disbandDenied.error, "Forbidden");

    const kickDenied = await harness.module.api.kick({
      actor: {
        id: "user-1",
        username: "mod",
        role: "Moderator",
        permissions: [],
      },
      anyId: "76561198000001234",
    });
    assert.equal(kickDenied.ok, false);
    assert.equal(kickDenied.error, "Forbidden");
  } finally {
    await harness.module.stop();
    await cleanupTempDbDir(harness.tempDbDir);
  }
}

async function testActivationThresholdBlocksAutomationUntilPopulationIsHighEnough() {
  const originalPluginConfig = getPluginById("fair-squad")?.config ?? {};
  updatePluginConfig("fair-squad", {
    ...originalPluginConfig,
    activationPlayerThreshold: 5,
  });

  const harness = createHarness({
    playerCount: 3,
    clock: {
      logClockSeconds: 10,
      logClockLastResetAt: "2026-05-13T20:00:00.000Z",
    },
  });

  try {
    await harness.module.start();
    await flushAsync();

    const state = harness.module.api.getState();
    assert.equal(state.activationPopulation, 3);
    assert.equal(state.activationPlayerThreshold, 5);
    assert.equal(state.activationEnabled, false);

    harness.core.eventBus.emitModuleEvent("module.squadLifecycle", "squadCreated", {
      serverId: "BZSS_Main",
      matchId: "match-1",
      teamId: 1,
      squadId: 11,
      squadName: "Squad 11",
      creatorName: "QuietBuilder",
      creatorSteamId: "76561198000005678",
      creatorEosId: "eos-quiet-builder",
      createdAtMs: Date.parse("2026-05-13T20:00:10.000Z"),
      creationSignature: "sig-quiet-builder",
      sourceEventId: "event-quiet",
    });
    await flushAsync();

    assert.equal(harness.commands.some((command) => command === "AdminDisbandSquad 1 11"), false);
    assert.equal(harness.commands.some((command) => command.startsWith("AdminKick ")), false);
  } finally {
    await harness.module.stop();
    updatePluginConfig("fair-squad", originalPluginConfig);
    await cleanupTempDbDir(harness.tempDbDir);
  }
}

async function testInfantrySweepHonorsWhitelist() {
  const records = [
    makeSquadRecord(1, {
      squadName: "Squad 1",
      creatorName: "AllowedLeader",
      creatorSteamId: "76561198000002001",
      creatorEosId: "eos-allowed-1",
      createdAtMs: Date.parse("2026-05-13T20:00:30.000Z"),
    }),
    makeSquadRecord(2, {
      squadName: "Bad Squad",
      creatorName: "BadLeader",
      creatorSteamId: "76561198000002002",
      creatorEosId: "eos-bad-2",
      createdAtMs: Date.parse("2026-05-13T20:00:35.000Z"),
    }),
    makeSquadRecord(3, {
      squadName: "\u840c\u65b0\u961f",
      creatorName: "NewbieLeader",
      creatorSteamId: "76561198000002003",
      creatorEosId: "eos-newbie-3",
      createdAtMs: Date.parse("2026-05-13T20:00:40.000Z"),
    }),
  ];

  const harness = createHarness({
    playerCount: 1,
    clock: {
      logClockSeconds: 35,
      logClockLastResetAt: "2026-05-13T20:00:00.000Z",
    },
    records,
    squads: records.map((record, index) => ({
      teamID: 1,
      squadID: index + 1,
      squadName: record.squadName,
      teamName: "USA",
      creatorName: record.creatorName,
      creatorSteamID: record.creatorSteamId,
      creatorEOSID: record.creatorEosId,
      raw: "",
    })),
  });

  try {
    await harness.module.start();
    await flushAsync();
    const state = harness.module.api.getState();

    assert.equal(state.squads.find((squad) => squad.squadName === "Bad Squad")?.shouldDisband, true);
    assert.equal(state.squads.find((squad) => squad.squadName === "Squad 1")?.shouldDisband, false);
    assert.equal(state.squads.find((squad) => squad.squadName === "\u840c\u65b0\u961f")?.shouldDisband, false);
    assert.equal(harness.commands.some((command) => command === "AdminDisbandSquad 1 2"), true);
    assert.equal(harness.commands.some((command) => command === "AdminDisbandSquad 1 1"), false);
    assert.equal(harness.commands.some((command) => command === "AdminDisbandSquad 1 3"), false);
  } finally {
    await harness.module.stop();
    await cleanupTempDbDir(harness.tempDbDir);
  }
}

async function main() {
  await testBootstrapAutoKicksFrequentCreators();
  await testNoBuildEventDisbandsSquadAndManualPermissionsAreChecked();
  await testActivationThresholdBlocksAutomationUntilPopulationIsHighEnough();
  await testInfantrySweepHonorsWhitelist();
  console.log("run-squad-management-tests.js: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
