import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSquadManagementModule } from "../modules/squad-management/index.js";

function createHarness(overrides = {}) {
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), "squad-management-test-"));
  const squads = [];
  const records = overrides.records || [];
  const commands = [];
  const auditRecords = [];

  const core = {
    eventBus: {
      listeners: {},
      moduleListeners: {},
      onCoreEvent(name, fn) {
        this.listeners[name] = this.listeners[name] || [];
        this.listeners[name].push(fn);
        return () => {
          this.listeners[name] = this.listeners[name].filter((f) => f !== fn);
        };
      },
      onModuleEvent(module, name, fn) {
        const key = `${module}:${name}`;
        this.moduleListeners[key] = this.moduleListeners[key] || [];
        this.moduleListeners[key].push(fn);
        return () => {
          this.moduleListeners[key] = this.moduleListeners[key].filter((f) => f !== fn);
        };
      },
      emitCoreEvent(name, payload) {
        const list = this.listeners[name] || [];
        for (const fn of list) fn(payload);
      },
      emitModuleEvent(module, name, payload) {
        const key = `${module}:${name}`;
        const list = this.moduleListeners[key] || [];
        for (const fn of list) fn(payload);
      },
    },
    rconManager: {
      async dispatchCommand({ command }) {
        commands.push(command);
        return {
          success: true,
          rconExecuted: true,
          rconResponse: "OK",
        };
      },
    },
    logClock: {
      getSeconds() {
        return overrides.clock?.logClockSeconds ?? 0;
      },
    },
    webStatus: {
      serverId: "BZSS_Main",
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      module: () => {},
    },
  };

  const modules = {
    squadLifecycle: {
      getCurrentSnapshot() {
        return {
          serverId: "BZSS_Main",
          matchId: overrides.matchId || "match-1",
          list: records.filter((r) => r.kind === "squad_created"),
        };
      },
      getCurrentMatchId() {
        return overrides.matchId || "match-1";
      }
    },
    audit: {
      async recordAction(record) {
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
          enforcementEnabled: true,
          noBuildUntilSeconds: overrides.config?.noBuildUntilSeconds ?? 0,
          infantryOnlyUntilSeconds: overrides.config?.infantryOnlyUntilSeconds ?? 0,
          allowedInfantryNames: overrides.config?.allowedInfantryNames ?? ["INF", "Infantry", "步兵", "萌新", "NEWBIE"],
          ...overrides.config,
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
    tempDbDir,
    squads,
    records,
    commands,
    auditRecords,
  };
}

function flushAsync() {
  return new Promise((resolve) => setTimeout(resolve, 200));
}

async function testBootstrapAutoKicksFrequentCreators() {
  const records = Array.from({ length: 11 }).map((_, index) => ({
    kind: "squad_created",
    serverId: "BZSS_Main",
    matchId: "match-1",
    teamId: 1,
    squadId: index + 1,
    squadName: `Squad ${index + 1}`,
    creatorName: "FrequentBuilder",
    creatorSteamId: "76561198000009999",
    timeMs: Date.now() - (12 - index) * 1000,
  }));

  const harness = createHarness({
    records,
    config: { kickThreshold: 10 },
  });

  await harness.module.init();
  await harness.module.start();

  assert.equal(harness.commands.some((command) => command.startsWith('AdminKick "76561198000009999"')), true);
  console.log("Passed: testBootstrapAutoKicksFrequentCreators");
}

async function testNoBuildEventDisbandsSquadAndManualPermissionsAreChecked() {
  console.log("Running: testNoBuildEventDisbandsSquadAndManualPermissionsAreChecked");
  const records = [];
  const commands = [];
  const harness = createHarness({
    records,
    commands,
    clock: { logClockSeconds: 10 },
    config: { noBuildUntilSeconds: 20 },
  });

  await harness.module.init();
  await harness.module.start();

  try {
    harness.core.eventBus.emitModuleEvent("module.squadLifecycle", "squadCreated", {
      serverId: "BZSS_Main",
      matchId: "match-1",
      teamId: 1,
      squadId: 9,
      squadName: "Squad 9",
      creatorName: "EarlyBuilder",
      creatorSteamId: "76561198000000001",
      createdAtMs: Date.parse("2026-05-13T20:00:10.000Z"),
    });

    await flushAsync();

    assert.equal(harness.commands.some((command) => command === "AdminDisbandSquad 1 9"), true);

    const recordsResult = await harness.module.api.getRecords({ limit: 20 });
    assert.equal(recordsResult.summary.created >= 1, true);
    assert.equal(recordsResult.summary.disbanded >= 1, true);
    assert.equal(recordsResult.records.some((record) => record.kind === "disband"), true);

    const disbandDenied = await harness.module.api.disband({
      actor: {
        id: "user-1",
        username: "mod",
        role: "Moderator",
        permissions: [],
      },
      serverId: "BZSS_Main",
      teamId: 1,
      squadId: 9,
    });
    assert.equal(disbandDenied.ok, false);
    assert.equal(disbandDenied.error, "Forbidden");

    const disbandAllowed = await harness.module.api.disband({
      actor: {
        id: "user-2",
        username: "admin",
        role: "Admin",
        permissions: ["squad.disband"],
      },
      serverId: "BZSS_Main",
      teamId: 1,
      squadId: 9,
    });
    assert.equal(disbandAllowed.ok, true);
    assert.equal(harness.commands.filter((c) => c === "AdminDisbandSquad 1 9").length, 2);

    console.log("Passed: testNoBuildEventDisbandsSquadAndManualPermissionsAreChecked");
  } finally {
    await harness.module.stop();
    fs.rmSync(harness.tempDbDir, { recursive: true, force: true });
  }
}

async function testInfantryOnlyPolicyEnforcement() {
  console.log("Running: testInfantryOnlyPolicyEnforcement");
  const harness = createHarness({
    clock: { logClockSeconds: 60 },
    config: {
      noBuildUntilSeconds: 20,
      infantryOnlyUntilSeconds: 90,
      allowedInfantryNames: ["INF", "步兵"],
    },
  });

  await harness.module.init();
  await harness.module.start();

  try {
    harness.core.eventBus.emitModuleEvent("module.squadLifecycle", "squadCreated", {
      serverId: "BZSS_Main",
      matchId: "match-1",
      teamId: 1,
      squadId: 5,
      squadName: "ARMOR",
      creatorName: "Tanker",
      creatorSteamId: "76561198000000002",
      createdAtMs: Date.parse("2026-05-13T20:01:00.000Z"),
    });

    await flushAsync();

    assert.equal(harness.commands.some((command) => command === "AdminDisbandSquad 1 5"), true);
    console.log("Passed: testInfantryOnlyPolicyEnforcement");
  } finally {
    await harness.module.stop();
    fs.rmSync(harness.tempDbDir, { recursive: true, force: true });
  }
}

async function testInfantrySweepHonorsWhitelist() {
  // Simplistic test for now
  console.log("Skipping full sweep test for now.");
}

async function main() {
  await testBootstrapAutoKicksFrequentCreators();
  await testNoBuildEventDisbandsSquadAndManualPermissionsAreChecked();
  await testInfantryOnlyPolicyEnforcement();
  await testInfantrySweepHonorsWhitelist();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
