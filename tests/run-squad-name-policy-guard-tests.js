import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createSquadNamePolicyGuardModule } from "../modules/squad-name-policy-guard/index.js";

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
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-squad-name-policy-guard-"));
  const policyPath = path.join(tempDir, "policy.json");
  await fs.writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");

  const moduleListeners = new Map();
  const calls = [];
  const modules = {
    squadManagement: {
      async requestDisband(request) {
        calls.push({ type: "disband", request });
        return { ok: true, command: `AdminDisbandSquad ${request.teamId} ${request.squadId}`, rconExecuted: true };
      },
    },
    adminWarn: {
      async warnPlayer(request) {
        calls.push({ type: "warn", request, at: Date.now() });
        return { success: true, commandText: `AdminWarn "${request.targetName}" "${request.message}"` };
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
      if (name === "modules.squadNamePolicyGuard") {
        return {
          enabled: true,
          detectLogCreated: true,
          action: "disband_then_warn",
          dedupeTtlMs: 300000,
          warningRepeatDelayMs: 5,
          warningRepeatCount: 2,
          rconPatrol: { enabled: false, intervalMs: 15000 },
          ...configOverride,
        };
      }
      return defaultValue;
    },
  };
  const instance = createSquadNamePolicyGuardModule({ core, modules, config, logger: core.logger });

  return {
    calls,
    instance,
    emit(moduleId, eventName, event) {
      emit(moduleListeners, `${moduleId}:${eventName}`, event);
    },
  };
}

async function testLogViolationDisbandsThenWarns() {
  const harness = await createHarness();
  await harness.instance.start();
  harness.emit("module.squadLifecycle", "squadCreated", createEvent({ squadName: "BMP队" }));
  await waitForHandlers();

  assert.equal(harness.calls.length, 5);
  assert.equal(harness.calls[0].type, "disband");
  assert.equal(harness.calls[0].request.system, true);
  assert.equal(harness.calls[0].request.allowUnverifiedTarget, true);
  assert.equal(harness.calls[1].type, "warn");
  assert.equal(harness.calls[1].request.message, "警告违规队名！\n本服对队名要求十分严格。");
  assert.equal(harness.calls[2].type, "warn");
  assert.equal(harness.calls[2].request.message, "警告你可能想建立\nBMP-1 BMP-2\nBMP-2M 队。");
  assert.equal(harness.calls[3].type, "warn");
  assert.equal(harness.calls[3].request.message, "警告违规队名！\n本服对队名要求十分严格。");
  assert.equal(harness.calls[4].type, "warn");
  assert.equal(harness.calls[4].request.message, "警告你可能想建立\nBMP-1 BMP-2\nBMP-2M 队。");
  assert.ok(harness.calls[3].at - harness.calls[2].at >= 4);

  const state = harness.instance.api.getState();
  assert.equal(state.stats.violations, 1);
  assert.equal(state.stats.disbanded, 1);
  assert.equal(state.stats.warningsSent, 4);
  await harness.instance.stop();
}

async function testAllowedNameDoesNothing() {
  const harness = await createHarness();
  await harness.instance.start();
  harness.emit("module.squadLifecycle", "squadCreated", createEvent({ squadName: "BMP-1" }));
  await waitForHandlers();

  assert.equal(harness.calls.length, 0);
  assert.equal(harness.instance.api.getState().recent[0].status, "allowed");
  await harness.instance.stop();
}

async function testNonChineseWeirdNameDoesNothing() {
  const harness = await createHarness();
  await harness.instance.start();
  harness.emit("module.squadLifecycle", "squadCreated", createEvent({ squadName: "hello" }));
  await waitForHandlers();

  assert.equal(harness.calls.length, 0);
  assert.equal(harness.instance.api.getState().recent[0].status, "allowed");
  await harness.instance.stop();
}

async function testDuplicateHandledOnce() {
  const harness = await createHarness();
  await harness.instance.start();
  const event = createEvent({ squadName: "BMP队" });
  harness.emit("module.squadLifecycle", "squadCreated", event);
  harness.emit("module.squadLifecycle", "squadCreated", event);
  await waitForHandlers();

  assert.equal(harness.calls.length, 5);
  assert.equal(harness.instance.api.getState().stats.duplicatesSkipped, 1);
  await harness.instance.stop();
}

async function testRconPatrolDefaultOffAndEnabled() {
  const disabledHarness = await createHarness();
  await disabledHarness.instance.start();
  disabledHarness.emit("module.matchState", "squadsUpdated", {
    serverId: "BZSS_Main",
    matchId: "match-1",
    squads: [createEvent({ squadName: "BMP队" })],
  });
  await waitForHandlers();
  assert.equal(disabledHarness.calls.length, 0);
  await disabledHarness.instance.stop();

  const enabledHarness = await createHarness({
    rconPatrol: { enabled: true, intervalMs: 1 },
  });
  await enabledHarness.instance.start();
  enabledHarness.emit("module.matchState", "squadsUpdated", {
    serverId: "BZSS_Main",
    matchId: "match-1",
    squads: [createEvent({ squadName: "BMP队" })],
  });
  await waitForHandlers();
  assert.equal(enabledHarness.calls.length, 5);
  await enabledHarness.instance.stop();
}

function createEvent(override = {}) {
  return {
    serverId: "BZSS_Main",
    matchId: "match-1",
    teamId: 1,
    squadId: 3,
    squadName: "BMP队",
    creatorName: "Creator",
    creatorSteamId: "76561198000000000",
    creatorEosId: "eos-creator",
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

async function waitForHandlers() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 12));
}

await testLogViolationDisbandsThenWarns();
await testAllowedNameDoesNothing();
await testNonChineseWeirdNameDoesNothing();
await testDuplicateHandledOnce();
await testRconPatrolDefaultOffAndEnabled();

console.log("run-squad-name-policy-guard-tests.js passed");
