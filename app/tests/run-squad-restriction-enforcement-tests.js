import assert from "node:assert/strict";

import { createSquadRestrictionEnforcementModule } from "../modules/squad-restriction-enforcement/index.js";

const START_MS = Date.UTC(2026, 6, 31, 0, 0, 0);

function makeSquad(overrides = {}) {
  return {
    serverId: "server-1",
    matchId: "round-1",
    teamId: 1,
    squadId: 4,
    squadName: "步兵队",
    creatorName: "Creator",
    creatorSteamId: "76561198000000001",
    creatorEosId: "eos-creator",
    generation: 1,
    locked: true,
    size: 9,
    ...overrides,
  };
}

async function createHarness(options = {}) {
  let now = START_MS;
  let squads = (options.squads ?? [makeSquad()]).map((item) => ({ ...item }));
  let players = options.players ?? [{
    playerID: 11,
    name: "Leader One",
    steamID: "76561198000000011",
    eosID: "eos-leader-1",
    teamID: 1,
    squadID: 4,
    isLeader: true,
  }];
  let roundId = options.roundId ?? "round-1";
  const status = {
    serverId: "server-1",
    logClockSeconds: options.logClockSeconds ?? 300,
    logClockHasAnchor: options.logClockHasAnchor ?? true,
    logClockManual: options.logClockManual ?? false,
  };
  const warnings = [];
  const disbands = [];
  const emitted = [];
  const listeners = new Map();
  const disbandResults = [...(options.disbandResults ?? [])];
  const configValue = {
    enabled: true,
    enforcementMode: options.mode ?? "enforce",
    startAfterSeconds: 300,
    firstWarningDelaySeconds: 30,
    secondWarningDelaySeconds: 60,
    disbandDelaySeconds: 90,
    resolutionConfirmSeconds: 10,
    schedulerIntervalMs: 600_000,
    requireTrustedRoundClock: true,
    targetCurrentLeader: true,
    refreshBeforeDisband: true,
    recordDirectory: false,
    maxDisbandRetries: options.maxDisbandRetries ?? 3,
    disbandRetryDelaySeconds: 5,
    ...options.config,
  };

  const core = {
    webStatus: {
      serverId: "server-1",
      getSnapshot() {
        return { ...status };
      },
    },
    eventBus: {
      onModuleEvent(moduleId, eventName, handler) {
        return addListener(`module:${moduleId}:${eventName}`, handler);
      },
      onCoreEvent(eventName, handler) {
        return addListener(`core:${eventName}`, handler);
      },
      emitModuleEvent(moduleId, eventName, event) {
        emitted.push({ moduleId, eventName, event });
      },
    },
  };

  const modules = {
    squadRestrictionMonitor: {
      evaluateSquad(squad = {}) {
        if (squad.classificationMissing) {
          return {
            ...squad,
            squadRestriction: {
              evaluated: false,
              isViolation: false,
              status: "not_applicable",
              violations: [],
              violationCodes: [],
              reasons: [],
              ruleSnapshot: null,
            },
          };
        }
        const isViolation = Boolean(squad.locked);
        return {
          ...squad,
          squadRestriction: {
            evaluated: true,
            isViolation,
            status: isViolation ? "violation" : "compliant",
            violations: isViolation ? [{ code: "lock_forbidden", message: "战斗步兵不允许锁队。" }] : [],
            violationCodes: isViolation ? ["lock_forbidden"] : [],
            reasons: isViolation ? ["战斗步兵不允许锁队。"] : [],
            ruleSnapshot: { allowLock: false, allowSoloLock: false, maxPlayersWhenLocked: null },
          },
        };
      },
    },
    squadManagement: {
      getState() {
        return {
          serverId: "server-1",
          matchId: roundId,
          currentMatchId: roundId,
          roundKey: `server-1:${roundId}`,
          squads,
          snapshotOnlySquads: [],
        };
      },
      getSquad(_serverId, teamId, squadId) {
        return squads.find((item) => item.teamId === teamId && item.squadId === squadId) ?? null;
      },
      async requestDisband(request) {
        disbands.push(request);
        const next = disbandResults.length > 0 ? disbandResults.shift() : { ok: true, command: "AdminDisbandSquad 1 4" };
        return typeof next === "function" ? next(request) : next;
      },
    },
    matchState: {
      getState() {
        return {
          players: { list: players },
          squads: { list: squads },
          round: { current: { sessionId: roundId } },
          rconPolling: {
            logClockSeconds: status.logClockSeconds,
            logClockHasAnchor: status.logClockHasAnchor,
            logClockManual: status.logClockManual,
          },
        };
      },
      async refresh(type) {
        if (typeof options.onRefresh === "function") {
          await options.onRefresh({ type, setSquads, status });
        }
        return { ok: true };
      },
    },
    adminWarn: {
      async sendAdminWarn(request) {
        warnings.push(request);
        return { success: true, commandText: `AdminWarnById ${request.targetPlayerId}` };
      },
    },
  };

  const config = {
    get(key, fallback) {
      if (key === "modules.squadRestrictionEnforcement") return configValue;
      return fallback;
    },
  };
  const clock = { now: () => now };
  const module = createSquadRestrictionEnforcementModule({
    core,
    modules,
    config,
    logger: makeLogger(),
    clock,
  });
  await module.start();

  function addListener(key, handler) {
    if (!listeners.has(key)) listeners.set(key, []);
    listeners.get(key).push(handler);
    return () => {
      const list = listeners.get(key) ?? [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    };
  }

  function setSquads(next) {
    squads = next.map((item) => ({ ...item }));
  }

  function setPlayers(next) {
    players = next.map((item) => ({ ...item }));
  }

  function setRound(next) {
    roundId = next;
  }

  function advance(seconds) {
    now += seconds * 1000;
    status.logClockSeconds += seconds;
  }

  async function ingest() {
    return module.api.ingestMonitorSnapshot({
      serverId: "server-1",
      matchId: roundId,
      squads,
    });
  }

  return {
    module,
    status,
    warnings,
    disbands,
    emitted,
    configValue,
    advance,
    ingest,
    setSquads,
    setPlayers,
    setRound,
    getSquads: () => squads,
    async tick() {
      return module.api.tick();
    },
    async close() {
      await module.stop();
    },
  };
}

function makeLogger() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

async function testOpeningWindowAndTimeline() {
  const h = await createHarness({ logClockSeconds: 299 });
  await h.ingest();
  assert.equal(h.module.api.getState().activeCaseCount, 0, "299 seconds must not create a case");

  h.advance(1);
  await h.tick();
  assert.equal(h.module.api.getState().activeCaseCount, 1, "300 seconds must create a case");

  h.advance(29);
  await h.tick();
  assert.equal(h.warnings.length, 0, "T+29 must not warn");

  h.advance(1);
  await h.tick();
  assert.equal(h.warnings.length, 1, "T+30 must send warning one");

  h.advance(30);
  await h.tick();
  assert.equal(h.warnings.length, 2, "T+60 must send warning two");

  h.advance(30);
  await h.tick();
  assert.equal(h.disbands.length, 1, "T+90 must disband after revalidation");
  assert.equal(h.module.api.getHistory()[0].status, "disbanded");
  await h.close();
}

async function testRemediationAtEachStage() {
  {
    const h = await createHarness();
    await h.ingest();
    h.advance(20);
    h.setSquads([makeSquad({ locked: false })]);
    await h.ingest();
    h.advance(20);
    await h.tick();
    assert.equal(h.warnings.length, 0, "remediation before warning one must suppress it");
    await h.close();
  }

  {
    const h = await createHarness();
    await h.ingest();
    h.advance(30);
    await h.tick();
    h.setSquads([makeSquad({ locked: false })]);
    await h.ingest();
    h.advance(30);
    await h.tick();
    assert.equal(h.warnings.length, 1, "remediation after warning one must suppress warning two");
    await h.close();
  }

  {
    const h = await createHarness();
    await h.ingest();
    h.advance(30);
    await h.tick();
    h.advance(30);
    await h.tick();
    h.setSquads([makeSquad({ locked: false })]);
    await h.ingest();
    h.advance(30);
    await h.tick();
    assert.equal(h.disbands.length, 0, "remediation after warning two must suppress disband");
    await h.close();
  }
}

async function testShortUnlockDoesNotResetAndResolvedReoffenseIsNew() {
  const h = await createHarness();
  await h.ingest();
  const firstKey = h.module.api.getCases()[0].caseKey;
  h.advance(30);
  await h.tick();

  h.advance(20);
  h.setSquads([makeSquad({ locked: false })]);
  await h.ingest();
  h.advance(5);
  h.setSquads([makeSquad({ locked: true })]);
  await h.ingest();
  h.advance(5);
  await h.tick();
  assert.equal(h.warnings.length, 2, "short unlock must preserve the original second-warning deadline");
  assert.equal(h.module.api.getCases()[0].caseKey, firstKey);

  h.setSquads([makeSquad({ locked: false })]);
  await h.ingest();
  h.advance(10);
  await h.tick();
  assert.equal(h.module.api.getState().activeCaseCount, 0);
  h.setSquads([makeSquad({ locked: true })]);
  await h.ingest();
  const secondKey = h.module.api.getCases()[0].caseKey;
  assert.notEqual(secondKey, firstKey, "a new incident must receive a new case key");
  await h.close();
}

async function testLeaderChangeAndDuplicateSnapshots() {
  const h = await createHarness();
  await h.ingest();
  h.advance(30);
  await h.tick();
  assert.equal(h.warnings[0].targetPlayerId, "11");

  h.setPlayers([{
    playerID: 22,
    name: "Leader Two",
    steamID: "76561198000000022",
    eosID: "eos-leader-2",
    teamID: 1,
    squadID: 4,
    isLeader: true,
  }]);
  await h.ingest();
  await h.ingest();
  assert.equal(h.warnings.length, 1, "duplicate snapshots must not repeat a completed warning stage");

  h.advance(30);
  await h.tick();
  assert.equal(h.warnings[1].targetPlayerId, "22", "warning two must target the current leader");
  await h.close();
}

async function testIdentityAndRoundSafety() {
  {
    const h = await createHarness();
    await h.ingest();
    h.setSquads([]);
    await h.ingest();
    h.advance(100);
    await h.tick();
    assert.equal(h.warnings.length, 0);
    assert.equal(h.disbands.length, 0, "a disappeared squad must not receive old actions");
    assert.equal(h.module.api.getHistory()[0].resolutionReason, "squad_missing");
    await h.close();
  }

  {
    const h = await createHarness();
    await h.ingest();
    h.advance(60);
    await h.tick();
    await h.tick();
    h.setSquads([makeSquad({
      creatorName: "New Creator",
      creatorSteamId: "76561198000000999",
      creatorEosId: "eos-new",
      generation: 2,
    })]);
    await h.ingest();
    h.advance(40);
    await h.tick();
    assert.equal(h.disbands.length, 0, "a reused squad number must not be targeted by the old case");
    assert.equal(
      h.module.api.getHistory().some((item) => item.resolutionReason === "squad_identity_changed"),
      true,
    );
    await h.close();
  }

  {
    const h = await createHarness();
    await h.ingest();
    h.setRound("round-2");
    h.setSquads([makeSquad({ matchId: "round-2" })]);
    await h.ingest();
    assert.equal(
      h.module.api.getHistory().some((item) => item.resolutionReason.startsWith("round_changed")),
      true,
      "round changes must close old cases",
    );
    await h.close();
  }
}

async function testClockAndClassificationGuards() {
  {
    const h = await createHarness({ logClockHasAnchor: false });
    await h.ingest();
    assert.equal(h.module.api.getState().activeCaseCount, 0, "unanchored clocks must block enforcement");
    await h.close();
  }

  {
    const h = await createHarness({ logClockManual: true });
    await h.ingest();
    assert.equal(h.module.api.getState().activeCaseCount, 0, "manual clocks must block enforcement");
    await h.close();
  }

  {
    const h = await createHarness({ squads: [makeSquad({ classificationMissing: true })] });
    await h.ingest();
    assert.equal(h.module.api.getState().activeCaseCount, 0, "unclassified squads must not create cases");
    await h.close();
  }
}

async function testRefreshBeforeDisbandAndRetries() {
  {
    let h;
    h = await createHarness({
      onRefresh({ setSquads }) {
        setSquads([makeSquad({ locked: false })]);
      },
    });
    await h.ingest();
    h.advance(30);
    await h.tick();
    h.advance(30);
    await h.tick();
    h.advance(30);
    await h.tick();
    assert.equal(h.disbands.length, 0, "final refresh remediation must prevent disband");
    assert.equal(h.module.api.getCases()[0].status, "pending_resolution");
    await h.close();
  }

  {
    const h = await createHarness({
      disbandResults: [
        { ok: false, error: "RCON timeout" },
        { ok: true, command: "AdminDisbandSquad 1 4" },
      ],
    });
    await h.ingest();
    h.advance(30);
    await h.tick();
    h.advance(30);
    await h.tick();
    h.advance(30);
    await h.tick();
    assert.equal(h.disbands.length, 1);
    assert.equal(h.module.api.getCases()[0].status, "error");
    h.advance(5);
    await h.tick();
    assert.equal(h.disbands.length, 2, "failed RCON disband must retry");
    assert.equal(h.module.api.getHistory()[0].status, "disbanded");
    await h.close();
  }
}

async function testDryRunAndWarnOnlyModes() {
  {
    const h = await createHarness({ mode: "dry_run" });
    await h.ingest();
    h.advance(30);
    await h.tick();
    h.advance(30);
    await h.tick();
    h.advance(30);
    await h.tick();
    assert.equal(h.warnings.length, 0);
    assert.equal(h.disbands.length, 0);
    assert.equal(h.module.api.getHistory()[0].resolutionReason, "dry_run_complete");
    await h.close();
  }

  {
    const h = await createHarness({ mode: "warn_only" });
    await h.ingest();
    h.advance(30);
    await h.tick();
    h.advance(30);
    await h.tick();
    h.advance(30);
    await h.tick();
    assert.equal(h.warnings.length, 2);
    assert.equal(h.disbands.length, 0);
    assert.equal(h.module.api.getHistory()[0].resolutionReason, "warn_only_complete");
    await h.close();
  }
}

async function testOffModeAndAdministratorExemption() {
  {
    const h = await createHarness({ mode: "off" });
    await h.ingest();
    h.advance(120);
    await h.tick();
    assert.equal(h.module.api.getState().activeCaseCount, 0);
    assert.equal(h.warnings.length, 0);
    assert.equal(h.disbands.length, 0);
    await h.close();
  }

  {
    const h = await createHarness();
    await h.ingest();
    const caseKey = h.module.api.getCases()[0].caseKey;
    const result = await h.module.api.setExemption(caseKey, { seconds: 300, reason: "manual review" });
    assert.equal(result.ok, true);
    h.advance(120);
    await h.ingest();
    assert.equal(h.module.api.getState().activeCaseCount, 0, "an active exemption must suppress a replacement case");
    assert.equal(h.warnings.length, 0);
    assert.equal(h.disbands.length, 0);
    await h.close();
  }
}

async function testDiagnosticsExplainInactiveBehavior() {
  {
    const h = await createHarness({ mode: "dry_run", logClockSeconds: 299 });
    await h.ingest();
    const state = h.module.api.getState();
    assert.equal(state.logClockHasAnchor, true);
    assert.equal(state.logClockManual, false);
    assert.equal(state.diagnostics.status, "blocked");
    assert.equal(state.diagnostics.caseCreationReady, false);
    assert.equal(state.diagnostics.latestSquadCount, 1);
    assert.equal(state.diagnostics.violationCount, 1);
    assert.equal(state.diagnostics.eligibleViolationCount, 1);
    assert.equal(state.diagnostics.protectionRemainingSeconds, 1);
    assert.equal(state.diagnostics.blockers.some((item) => item.code === "dry_run"), true);
    assert.equal(state.diagnostics.blockers.some((item) => item.code === "opening_protection"), true);
    assert.equal(state.latestSquads[0].identityComplete, true);
    assert.equal(Object.hasOwn(state.latestSquads[0], "raw"), false);
    await h.close();
  }

  {
    const h = await createHarness({
      logClockHasAnchor: false,
      squads: [makeSquad({ classificationMissing: true })],
    });
    await h.ingest();
    const diagnostics = h.module.api.getState().diagnostics;
    assert.equal(diagnostics.status, "blocked");
    assert.equal(diagnostics.classificationMissingCount, 1);
    assert.equal(diagnostics.blockers.some((item) => item.code === "clock_anchor_missing"), true);
    assert.equal(diagnostics.blockers.some((item) => item.code === "classification_missing"), true);
    await h.close();
  }
}

await testOpeningWindowAndTimeline();
await testRemediationAtEachStage();
await testShortUnlockDoesNotResetAndResolvedReoffenseIsNew();
await testLeaderChangeAndDuplicateSnapshots();
await testIdentityAndRoundSafety();
await testClockAndClassificationGuards();
await testRefreshBeforeDisbandAndRetries();
await testDryRunAndWarnOnlyModes();
await testOffModeAndAdministratorExemption();
await testDiagnosticsExplainInactiveBehavior();

console.log("run-squad-restriction-enforcement-tests: ok");
