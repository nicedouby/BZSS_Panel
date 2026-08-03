import assert from "node:assert/strict";

import {
  createSquadRestrictionMonitorModule,
  evaluateRestriction,
} from "../modules/squad-restriction-monitor/index.js";

function createHarness(moduleConfig = {}) {
  const listeners = new Map();
  const emitted = [];
  const core = {
    logger: makeLogger(),
    createLogger: makeLogger,
    eventBus: {
      onModuleEvent(moduleId, eventName, handler) {
        const key = `${moduleId}:${eventName}`;
        if (!listeners.has(key)) listeners.set(key, []);
        listeners.get(key).push(handler);
        return () => {
          const handlers = listeners.get(key) ?? [];
          const index = handlers.indexOf(handler);
          if (index >= 0) handlers.splice(index, 1);
        };
      },
      emitModuleEvent(moduleId, eventName, event) {
        emitted.push({ moduleId, eventName, event });
        for (const handler of listeners.get(`${moduleId}:${eventName}`) ?? []) handler(event);
      },
    },
  };
  const config = {
    get(path, fallback) {
      if (path === "modules.squadRestrictionMonitor") return { enabled: true, ...moduleConfig };
      return fallback;
    },
  };
  const module = createSquadRestrictionMonitorModule({ core, config, logger: makeLogger() });
  return { module, core, emitted };
}

function makeLogger() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

function squad(name, { size = 1, locked = true, teamID = 1, squadID = 1 } = {}) {
  return { teamID, squadID, squadName: name, name, size, locked };
}

function codes(result) {
  return result.squadRestriction.violations.map((item) => item.code);
}

async function testPureRestrictionRules() {
  const unlocked = evaluateRestriction({
    typeId: "ifv",
    typeLabel: "IFV / 步战车",
    locked: false,
    playerCount: 8,
    rule: { allowLock: true, allowSoloLock: false, maxPlayersWhenLocked: 3 },
  });
  assert.equal(unlocked.status, "compliant");
  assert.equal(unlocked.isViolation, false);

  const exempt = evaluateRestriction({
    supervisionExempt: true,
    typeId: "infantry",
    typeLabel: "战斗步兵",
    locked: true,
    playerCount: 9,
    rule: { allowLock: false },
  });
  assert.equal(exempt.status, "exempt");
  assert.equal(exempt.evaluated, false);
  assert.equal(exempt.isViolation, false);

  const forbidden = evaluateRestriction({
    typeId: "infantry",
    typeLabel: "战斗步兵",
    locked: true,
    playerCount: 9,
    rule: { allowLock: false },
  });
  assert.equal(forbidden.isViolation, true);
  assert.deepEqual(forbidden.violations.map((item) => item.code), ["lock_forbidden"]);
}

async function testDefaultCategoryMatrix() {
  const harness = createHarness();
  await harness.module.start();
  const api = harness.module.api;

  const unlockedIfv = api.evaluateSquad(squad("BMP", { size: 8, locked: false }));
  assert.equal(unlockedIfv.squadTypeId, "ifv");
  assert.equal(unlockedIfv.squadRestriction.isViolation, false);

  const soloIfv = api.evaluateSquad(squad("BMP", { size: 1, locked: true }));
  assert.equal(soloIfv.squadRestriction.isViolation, true);
  assert.deepEqual(codes(soloIfv), ["solo_lock_forbidden"]);

  const crowdedIfv = api.evaluateSquad(squad("BMP", { size: 4, locked: true }));
  assert.deepEqual(codes(crowdedIfv), ["locked_player_limit_exceeded"]);

  const vehicleMatrix = [
    ["悍马车", "matv", false],
    ["BMP", "ifv", false],
    ["LAV C6", "apc", false],
    ["M1A1", "tank", false],
    ["M-ATV TOW", "atgm_matv", true],
    ["BM21", "artillery_vehicle", true],
    ["Mi-8", "helicopter", true],
    ["CH-146 CAS", "attack_helicopter", true],
  ];
  for (const [name, typeId, allowSoloLock] of vehicleMatrix) {
    const solo = api.evaluateSquad(squad(name, { size: 1, locked: true }));
    assert.equal(solo.squadTypeId, typeId, `${name} should resolve to ${typeId}`);
    assert.equal(solo.squadRestriction.isViolation, !allowSoloLock, `${name} solo-lock result`);
    const crowded = api.evaluateSquad(squad(name, { size: 4, locked: true }));
    assert.deepEqual(codes(crowded), ["locked_player_limit_exceeded"], `${name} locked size limit`);
  }

  const lockedInfantry = api.evaluateSquad(squad("步兵队", { size: 9, locked: true }));
  assert.equal(lockedInfantry.squadTypeId, "infantry");
  assert.deepEqual(codes(lockedInfantry), ["lock_forbidden"]);

  const logisticsSix = api.evaluateSquad(squad("后勤队", { size: 6, locked: true }));
  assert.equal(logisticsSix.squadTypeId, "logistics");
  assert.equal(logisticsSix.squadRestriction.isViolation, false);
  const logisticsSeven = api.evaluateSquad(squad("后勤队", { size: 7, locked: true }));
  assert.deepEqual(codes(logisticsSeven), ["locked_player_limit_exceeded"]);

  const mortarFour = api.evaluateSquad(squad("迫击炮队", { size: 4, locked: true }));
  assert.equal(mortarFour.squadTypeId, "mortar");
  assert.equal(mortarFour.squadRestriction.isViolation, false);
  const mortarFive = api.evaluateSquad(squad("迫击炮队", { size: 5, locked: true }));
  assert.deepEqual(codes(mortarFive), ["locked_player_limit_exceeded"]);

  const supervision = api.evaluateSquad(squad("OPOP 督战队", { size: 9, locked: true }));
  assert.equal(supervision.squadTypeId, "supervision");
  assert.equal(supervision.squadRestriction.status, "exempt");
  assert.equal(supervision.squadRestriction.isViolation, false);

  const unknown = api.evaluateSquad(squad("完全未知的队名", { size: 9, locked: true }));
  assert.equal(unknown.squadRestriction.status, "not_applicable");
  assert.equal(unknown.squadRestriction.isViolation, false);

  await harness.module.stop();
}

async function testStateTracksViolationsWithoutEnforcement() {
  const harness = createHarness();
  await harness.module.start();
  const evaluated = harness.module.api.evaluateSquads([
    squad("BMP", { squadID: 1, size: 1, locked: true }),
    squad("M-ATV TOW", { squadID: 2, size: 1, locked: true }),
    squad("步兵队", { squadID: 3, size: 7, locked: false }),
  ]);
  harness.core.eventBus.emitModuleEvent("module.matchState", "squadsUpdated", {
    serverId: "test-server",
    squads: evaluated,
  });

  const state = harness.module.api.getState();
  assert.equal(state.squadCount, 3);
  assert.equal(state.evaluatedCount, 3);
  assert.equal(state.violationCount, 1);
  assert.equal(state.violations[0].squadTypeId, "ifv");
  assert.deepEqual(state.violations[0].violationCodes, ["solo_lock_forbidden"]);
  assert.equal(state.violations[0].restrictionReasons.length, 1);
  assert.deepEqual(state.violations[0].ruleSnapshot, {
    allowLock: true,
    allowSoloLock: false,
    maxPlayersWhenLocked: 3,
  });
  assert.equal(state.enforcementEnabled, false);
  assert.equal(harness.emitted.some((item) => item.moduleId === "module.squadRestrictionMonitor" && item.eventName === "updated"), true);
  await harness.module.stop();
}

async function testConfigOverride() {
  const harness = createHarness({
    typeRules: {
      ifv: { allowSoloLock: true, maxPlayersWhenLocked: 2 },
    },
  });
  const one = harness.module.api.evaluateSquad(squad("BMP", { size: 1, locked: true }));
  assert.equal(one.squadRestriction.isViolation, false);
  const three = harness.module.api.evaluateSquad(squad("BMP", { size: 3, locked: true }));
  assert.deepEqual(codes(three), ["locked_player_limit_exceeded"]);
}

await testPureRestrictionRules();
await testDefaultCategoryMatrix();
await testStateTracksViolationsWithoutEnforcement();
await testConfigOverride();

console.log("run-squad-restriction-monitor-tests: ok");
