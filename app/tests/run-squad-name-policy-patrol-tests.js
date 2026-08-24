import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createSquadNamePolicyPatrolModule } from "../modules/squad-name-policy-patrol/index.js";

const policy = {
  version: 1,
  suggestionLimit: 3,
  defaultNamePatterns: ["^squad\\s*\\d+$"],
  infantryNames: ["步兵"],
  specialInfantryNames: [],
  entries: [
    {
      faction: "AFU",
      vehicleType: "IFV",
      asset: "/Game/BMP1",
      name: "BMP-1",
      aliases: [],
      keywords: ["BMP"],
    },
    {
      faction: "AFU",
      vehicleType: "IFV",
      asset: "/Game/BMP2",
      name: "BMP-2",
      aliases: [],
      keywords: ["BMP"],
    },
    {
      faction: "AFU",
      vehicleType: "IFV",
      asset: "/Game/BMP2M",
      name: "BMP-2M",
      aliases: [],
      keywords: ["BMP"],
    },
  ],
};

async function createHarness(configOverride = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-squad-name-policy-patrol-"));
  const policyPath = path.join(tempDir, "policy.json");
  await fs.writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");

  const moduleListeners = new Map();
  const submittedViolations = [];
  const modules = {
    squadRuleChain: {
      async submitViolation(event) {
        submittedViolations.push(event);
        return { status: "handled", event };
      },
    },
  };
  const core = {
    logger: makeLogger(),
    createLogger: makeLogger,
    webStatus: { serverId: "BZSS_Main" },
    eventBus: {
      onModuleEvent(moduleId, eventName, handler) {
        return subscribe(moduleListeners, `${moduleId}:${eventName}`, handler);
      },
    },
  };
  const config = {
    get(name, defaultValue) {
      if (name === "squadNamePolicy.path") return policyPath;
      if (name === "modules.squadNamePolicyPatrol") {
        return {
          enabled: true,
          intervalMs: 1,
          dedupeTtlMs: 300000,
          ...configOverride,
        };
      }
      return defaultValue;
    },
  };
  const instance = createSquadNamePolicyPatrolModule({ core, modules, config, logger: core.logger });

  return {
    instance,
    submittedViolations,
    emit(moduleId, eventName, event) {
      emit(moduleListeners, `${moduleId}:${eventName}`, event);
    },
  };
}

async function testStartupExistingViolationIsGrandfathered() {
  const harness = await createHarness();
  await harness.instance.start();
  const existing = createEvent({ squadName: "BMP违规队", creationSignature: "startup-existing" });

  await primeStartupBaseline(harness, [existing]);
  harness.emit("module.matchState", "squadsUpdated", {
    serverId: "BZSS_Main",
    matchId: "match-1",
    squads: [existing],
  });
  await waitForHandlers();

  const state = harness.instance.api.getState();
  assert.equal(state.stats.startupExistingSkipped, 1);
  assert.equal(state.stats.evaluated, 0);
  assert.equal(harness.submittedViolations.length, 0);
  await harness.instance.stop();
}

async function testViolationIsEnforcedThroughRuleChain() {
  const harness = await createHarness();
  await harness.instance.start();
  await primeStartupBaseline(harness);
  harness.emit("module.matchState", "squadsUpdated", {
    serverId: "BZSS_Main",
    matchId: "match-1",
    squads: [createEvent({ squadName: "BMP违规队", creationSignature: "patrol-1" })],
  });
  await waitForHandlers();

  const state = harness.instance.api.getState();
  assert.equal(state.stats.evaluated, 1);
  assert.equal(state.stats.violations, 1);
  assert.equal(state.stats.enforced, 1);
  assert.equal(state.recent[0].status, "handled");
  assert.equal(state.recent[0].disposition, "enforce");
  assert.equal(harness.submittedViolations.length, 1);
  assert.equal(harness.submittedViolations[0].sourceMode, "live");
  assert.equal(harness.submittedViolations[0].canTriggerActions, true);
  assert.equal(harness.submittedViolations[0].squadName, "BMP违规队");
  await harness.instance.stop();
}

async function testAllowedNameStaysAllowed() {
  const harness = await createHarness();
  await harness.instance.start();
  await primeStartupBaseline(harness);
  harness.emit("module.matchState", "squadsUpdated", {
    serverId: "BZSS_Main",
    matchId: "match-1",
    squads: [createEvent({ squadName: "BMP-1", creationSignature: "patrol-2" })],
  });
  await waitForHandlers();

  const state = harness.instance.api.getState();
  assert.equal(state.stats.allowed, 1);
  assert.equal(state.recent[0].status, "allowed");
  await harness.instance.stop();
}

async function testPlainLetterNameIsFlagged() {
  const harness = await createHarness();
  await harness.instance.start();
  await primeStartupBaseline(harness);
  harness.emit("module.matchState", "squadsUpdated", {
    serverId: "BZSS_Main",
    matchId: "match-1",
    squads: [createEvent({ squadName: "hello", creationSignature: "patrol-hello" })],
  });
  await waitForHandlers();

  const state = harness.instance.api.getState();
  assert.equal(state.stats.violations, 1);
  assert.equal(state.recent[0].status, "handled");
  assert.equal(harness.submittedViolations.length, 1);
  await harness.instance.stop();
}

async function testDuplicateSnapshotIsSkipped() {
  const harness = await createHarness();
  await harness.instance.start();
  const squad = createEvent({ squadName: "BMP违规队", creationSignature: "patrol-3" });
  harness.emit("module.matchState", "squadsUpdated", {
    serverId: "BZSS_Main",
    matchId: "match-1",
    squads: [squad],
  });
  await waitForHandlers();
  harness.emit("module.matchState", "squadsUpdated", {
    serverId: "BZSS_Main",
    matchId: "match-1",
    squads: [squad],
  });
  await waitForHandlers();

  const state = harness.instance.api.getState();
  assert.equal(state.stats.evaluated, 1);
  assert.equal(state.stats.duplicatesSkipped, 1);
  await harness.instance.stop();
}

function createEvent(override = {}) {
  return {
    serverId: "BZSS_Main",
    matchId: "match-1",
    teamId: 1,
    squadId: 3,
    squadName: "BMP违规队",
    creatorName: "Creator",
    ...override,
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

function makeLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

async function primeStartupBaseline(harness, squads = []) {
  harness.emit("module.matchState", "squadsUpdated", {
    serverId: "BZSS_Main",
    matchId: "match-1",
    squads,
  });
  await waitForHandlers();
}

async function waitForHandlers() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 10));
}

await testStartupExistingViolationIsGrandfathered();
await testViolationIsEnforcedThroughRuleChain();
await testAllowedNameStaysAllowed();
await testPlainLetterNameIsFlagged();
await testDuplicateSnapshotIsSkipped();

console.log("run-squad-name-policy-patrol-tests.js passed");
