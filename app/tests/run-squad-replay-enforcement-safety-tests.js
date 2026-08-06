import assert from "node:assert/strict";

import { createSquadLifecycleModule } from "../modules/squad-lifecycle/index.js";
import { createSquadNamePolicyGuardModule } from "../modules/squad-name-policy-guard/index.js";
import { classifySquadName } from "../domain/squad/squad_name_classifier.js";
import { clearTeamFactionMappings } from "../core/team-faction-cache.js";

function createEventBus() {
  const coreListeners = new Map();
  const moduleListeners = new Map();

  const subscribe = (map, key, handler) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(handler);
    return () => map.get(key)?.delete(handler);
  };

  const emit = (map, key, event) => {
    for (const handler of map.get(key) ?? []) handler(event);
  };

  return {
    onCoreEvent(eventName, handler) {
      return subscribe(coreListeners, eventName, handler);
    },
    onModuleEvent(moduleId, eventName, handler) {
      return subscribe(moduleListeners, `${moduleId}:${eventName}`, handler);
    },
    emitCoreEvent(eventName, event) {
      emit(coreListeners, eventName, { ...event, eventName });
    },
    emitModuleEvent(moduleId, eventName, event) {
      emit(moduleListeners, `${moduleId}:${eventName}`, {
        ...event,
        eventName,
        source: moduleId,
      });
    },
  };
}

function createLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
    module() {},
  };
}

function createLifecycleHarness() {
  clearTeamFactionMappings("BZSS_Main");
  const eventBus = createEventBus();
  const logger = createLogger();
  const core = {
    logger,
    createLogger: () => logger,
    webStatus: {
      serverId: "BZSS_Main",
      getSnapshot: () => ({ serverId: "BZSS_Main" }),
    },
    eventBus,
  };
  const config = {
    get(path, fallback) {
      if (path === "modules.squadLifecycle") return { enabled: true, debug: false };
      return fallback;
    },
  };
  return {
    core,
    module: createSquadLifecycleModule({ core, config, logger }),
  };
}

async function testReplayPendingFlushKeepsOriginalNameAndSafetyFlags() {
  const harness = createLifecycleHarness();
  const emitted = [];
  await harness.module.start();
  const unsubscribe = harness.core.eventBus.onModuleEvent("module.squadLifecycle", "squadCreated", (event) => {
    emitted.push(event);
  });

  const rawLog = "[2026.08.05-01.00.00:000][100]LogSquad: Historical Leader (Online IDs: EOS: eos-historical steam: 76561198000000111) has created Squad 3 (Squad Name: Original Infantry) on United States Army";

  harness.core.eventBus.emitCoreEvent("On_RawLogLine", {
    serverId: "BZSS_Main",
    sessionId: "session-replay",
    eventId: "replay:100",
    sourceMode: "replay",
    canTriggerActions: false,
    rawLog,
    rawEvent: {
      Raw: rawLog,
      SourceMode: "replay",
      CanTriggerActions: false,
    },
  });

  harness.core.eventBus.emitModuleEvent("module.matchState", "squadsUpdated", {
    serverId: "BZSS_Main",
    sessionId: "session-replay",
    time: "2026-08-05T01:30:00.000Z",
    squads: [
      {
        teamID: 1,
        squadID: 3,
        squadName: "Command Squad",
        teamName: "United States Army",
        creatorName: "Historical Leader",
      },
    ],
  });

  const flushed = emitted.find((event) => event.teamId === 1 && event.squadId === 3);
  assert.ok(flushed, "expected pending create to flush after RCON TeamID resolution");
  assert.equal(flushed.squadName, "Original Infantry");
  assert.equal(flushed.originalSquadName, "Original Infantry");
  assert.equal(flushed.currentSquadName, "Command Squad");
  assert.equal(flushed.sourceMode, "replay");
  assert.equal(flushed.canTriggerActions, false);

  unsubscribe();
  await harness.module.stop();
}

async function testPolicyGuardNeverSubmitsReplayViolation() {
  const eventBus = createEventBus();
  const logger = createLogger();
  let violationCalls = 0;
  const core = {
    logger,
    createLogger: () => logger,
    webStatus: { serverId: "BZSS_Main" },
    eventBus,
  };
  const config = {
    get(path, fallback) {
      if (path === "modules.squadNamePolicyGuard") {
        return { enabled: true, detectLogCreated: true, action: "disband_then_warn" };
      }
      return fallback;
    },
  };
  const modules = {
    squadRuleChain: {
      api: {
        async submitViolation() {
          violationCalls += 1;
          return { status: "handled", actions: [{ type: "disbanded" }] };
        },
      },
    },
  };
  const guard = createSquadNamePolicyGuardModule({ core, modules, config, logger });
  await guard.start();

  eventBus.emitModuleEvent("module.squadLifecycle", "squadCreated", {
    serverId: "BZSS_Main",
    matchId: "session-replay",
    teamId: 1,
    squadId: 3,
    squadName: "definitely invalid historical name",
    originalSquadName: "definitely invalid historical name",
    currentSquadName: "Command Squad",
    creatorName: "Historical Leader",
    sourceMode: "replay",
    canTriggerActions: false,
    createdAt: "2026-08-05T01:00:00.000Z",
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(violationCalls, 0);
  assert.equal(guard.api.getState().stats.auditOnlySkipped, 1);

  await guard.stop();
}

function testCommandSquadIsInfantryNature() {
  const classification = classifySquadName("Command Squad");
  assert.equal(classification.nature, "infantry");
  assert.equal(classification.normalizedName, "command squad");
}

await testReplayPendingFlushKeepsOriginalNameAndSafetyFlags();
await testPolicyGuardNeverSubmitsReplayViolation();
testCommandSquadIsInfantryNature();

console.log("squad replay enforcement safety tests passed");
