import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPlugin as createFairTeamBalancePlugin } from "../plugins/fair-team-balance.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, { timeoutMs = 2000, intervalMs = 20 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await check();
    if (result) return result;
    await sleep(intervalMs);
  }
  throw new Error("waitFor timeout");
}

function createMatchState({ players = [], squads = [] }) {
  const teamCounts = new Map([
    [1, 0],
    [2, 0],
  ]);

  for (const player of players) {
    const teamId = Number(player?.teamId ?? player?.teamID ?? 0);
    if (teamId === 1 || teamId === 2) {
      teamCounts.set(teamId, (teamCounts.get(teamId) || 0) + 1);
    }
  }

  return {
    serverId: "test-server",
    players: players.map((player) => ({
      name: String(player.name ?? ""),
      steamId: String(player.steamId ?? player.steamID ?? ""),
      eosId: String(player.eosId ?? player.eosID ?? ""),
      teamId: Number(player.teamId ?? player.teamID ?? 0) || 0,
      squadId: Number(player.squadId ?? player.squadID ?? 0) || 0,
    })),
    squads: squads.map((squad) => ({
      teamId: Number(squad.teamId ?? squad.teamID ?? 0) || 0,
      squadId: Number(squad.squadId ?? squad.squadID ?? 0) || 0,
      locked: Boolean(squad.locked),
    })),
    teams: [
      { teamId: 1, playerCount: teamCounts.get(1) || 0 },
      { teamId: 2, playerCount: teamCounts.get(2) || 0 },
    ],
  };
}

async function createHarness(options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-fair-tb-"));
  const keepTempDir = Boolean(options.keepTempDir);
  const coreEventHandlers = new Map();
  const teamBalanceCalls = [];
  const registeredPages = [];
  const broadcasts = [];
  const warnings = [];
  const webStatus = {
    isWarmup: false,
    logClockSeconds: 30,
    ...(options.webStatus ?? {}),
  };
  const matchState = {
    current: createMatchState(options.matchState ?? {}),
  };

  const plugin = createFairTeamBalancePlugin({
    core: {
      webStatus: {
        serverId: "test-server",
        getSnapshot() {
          return {
            ...webStatus,
            serverId: "test-server",
          };
        },
      },
      eventBus: {
        onCoreEvent(eventName, handler) {
          coreEventHandlers.set(eventName, handler);
          return () => coreEventHandlers.delete(eventName);
        },
      },
      webRegistry: {
        registerPage(page) {
          registeredPages.push(page);
        },
      },
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
    },
    modules: {
      teamBalance: {
        async forceTeamChange(payload) {
          teamBalanceCalls.push(payload);
          if (typeof options.forceTeamChange === "function") {
            return options.forceTeamChange(payload);
          }
          return {
            ok: true,
            error: "",
            message: "Team switch requested.",
            command: `AdminForceTeamChange "${payload.steamId}"`,
            rconExecuted: true,
            rconResponse: "OK",
          };
        },
      },
      squadManagement: {
        getState() {
          return matchState.current;
        },
      },
      chatManager: {
        on() {
          return () => {};
        },
      },
      adminWarn: {
        async sendAdminBroadcast(request) {
          broadcasts.push(request);
          return {
            success: true,
            skipped: false,
            commandText: `AdminBroadcast ${request.message}`,
          };
        },
        async sendAdminWarn(request) {
          warnings.push(request);
          return {
            success: true,
            skipped: false,
            commandText: `AdminWarn "${request.targetName}"`,
          };
        },
      },
    },
    config: {
      get(pathText, defaultValue) {
        if (pathText === "plugins.fairTeamBalance") {
          return {
            enabled: true,
            directory: tempDir,
            requestTtlMs: options.requestTtlMs ?? 120000,
          };
        }
        return defaultValue;
      },
    },
  });

  await plugin.init();
  await plugin.start();

  return {
    plugin,
    tempDir,
    teamBalanceCalls,
    registeredPages,
    broadcasts,
    warnings,
    webStatus,
    matchState,
    setMatchState(nextState) {
      matchState.current = createMatchState(nextState);
    },
    async emitCoreEvent(eventName, payload = {}) {
      const handler = coreEventHandlers.get(eventName);
      if (handler) handler(payload);
      await waitFor(() => plugin.api.getState().lastRoundResetAt || eventName !== "round.world_bring_up");
    },
    async stop() {
      await plugin.stop();
      if (!keepTempDir) {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    },
  };
}

async function testExactTriggersAndTbSuccess() {
  const harness = await createHarness({
    matchState: {
      players: [
        { name: "Alpha", steamId: "steam-alpha", teamId: 1, squadId: 0 },
        { name: "Bravo", steamId: "steam-bravo", teamId: 1, squadId: 0 },
        { name: "Charlie", steamId: "steam-charlie", teamId: 2, squadId: 0 },
      ],
    },
  });

  try {
    assert.equal(harness.registeredPages.length, 1);
    assert.equal(harness.registeredPages[0].route, "/plugins/fair-team-balance");

    const spaced = await harness.plugin.api.simulateChatMessage({
      message: "tb ",
      steamId: "steam-alpha",
      playerName: "Alpha",
    });
    assert.equal(spaced.matched, false);

    const shortClaim = await harness.plugin.api.simulateChatMessage({
      message: "认领1234",
      steamId: "steam-alpha",
      playerName: "Alpha",
    });
    assert.equal(shortClaim.matched, false);

    const result = await harness.plugin.api.simulateChatMessage({
      message: "tb",
      steamId: "steam-alpha",
      playerName: "Alpha",
    });

    assert.equal(result.matched, true);
    assert.equal(result.ok, true);
    assert.equal(harness.teamBalanceCalls.length, 1);
    assert.equal(harness.teamBalanceCalls[0].steamId, "steam-alpha");
    assert.equal(harness.plugin.api.getState().publicTbRemaining, 4);
    assert.equal(harness.plugin.api.getState().roundUsedCount, 1);
    assert.equal(harness.broadcasts.length, 1);
    assert.match(harness.broadcasts[0].message, /Alpha/);
    assert.match(harness.broadcasts[0].message, /4\/5/);
    assert.equal(harness.warnings.length, 1);
    assert.match(harness.warnings[0].message, /非暖服模式/);
  } finally {
    await harness.stop();
  }
}

async function testSqtbConsumesRoundUsageAndDirectApprovalOnlyConsumesApplicantPeriodQuota() {
  const harness = await createHarness({
    matchState: {
      players: [
        { name: "Alpha", steamId: "steam-alpha", teamId: 1, squadId: 0 },
        { name: "Bravo", steamId: "steam-bravo", teamId: 2, squadId: 0 },
      ],
    },
  });

  try {
    const created = await harness.plugin.api.simulateChatMessage({
      message: "sqtb",
      steamId: "steam-alpha",
      playerName: "Alpha",
    });

    assert.equal(created.ok, true);
    assert.match(created.claimMessage, /^认领\d{5}$/);
    assert.equal(harness.broadcasts.length, 1);
    assert.match(harness.broadcasts[0].message, /认领/);
    assert.match(harness.broadcasts[0].message, new RegExp(created.request.code));

    const tbAfterSqtb = await harness.plugin.api.simulateChatMessage({
      message: "tb",
      steamId: "steam-alpha",
      playerName: "Alpha",
    });
    assert.equal(tbAfterSqtb.ok, false);
    assert.equal(tbAfterSqtb.error, "RoundPlayerQuotaExhausted");

    const approved = await harness.plugin.api.approveRequest({
      requestId: created.request.id,
      direct: true,
      actor: {
        id: "admin-1",
        username: "Admin",
        name: "Admin",
        role: "SuperAdmin",
        isSuperAdmin: true,
        permissions: ["*"],
      },
    });

    assert.equal(approved.ok, true);
    assert.equal(harness.teamBalanceCalls.length, 1);
    assert.equal(harness.broadcasts.length, 2);
    assert.match(harness.broadcasts[1].message, /公共TB剩余 5\/5/);

    const state = harness.plugin.api.getState();
    assert.equal(state.activeRequestCount, 0);

    const logFiles = await fs.readdir(harness.tempDir);
    assert.equal(logFiles.length, 1);
    const logText = await fs.readFile(path.join(harness.tempDir, logFiles[0]), "utf8");
    assert.match(logText, /"type":"SQTB_APPROVED"/);
    assert.match(logText, /"directApproval":true/);
  } finally {
    await harness.stop();
  }
}

async function testClaimAutoExecutesAndConsumesBothPeriodQuotas() {
  const harness = await createHarness({
    matchState: {
      players: [
        { name: "Alpha", steamId: "steam-alpha", teamId: 1, squadId: 0 },
        { name: "Bravo", steamId: "steam-bravo", teamId: 2, squadId: 0 },
      ],
    },
  });

  try {
    const created = await harness.plugin.api.simulateChatMessage({
      message: "sqtb",
      steamId: "steam-alpha",
      playerName: "Alpha",
    });
    const code = created.request.code;

    const claimed = await harness.plugin.api.simulateChatMessage({
      message: `认领${code}`,
      steamId: "steam-bravo",
      playerName: "Bravo",
    });

    assert.equal(claimed.ok, true);
    assert.equal(claimed.request.status, "approved");
    assert.equal(claimed.request.directApproval, false);
    assert.equal(harness.broadcasts.length, 2);
    assert.match(harness.broadcasts[1].message, /认领完成/);
    assert.match(harness.broadcasts[1].message, /公共TB剩余 5\/5/);

    const claimantTb = await harness.plugin.api.simulateChatMessage({
      message: "tb",
      steamId: "steam-bravo",
      playerName: "Bravo",
    });
    assert.equal(claimantTb.ok, false);
    assert.equal(claimantTb.error, "RoundPlayerQuotaExhausted");
    assert.equal(harness.teamBalanceCalls.length, 1);
    assert.equal(harness.plugin.api.getState().activeRequestCount, 0);
  } finally {
    await harness.stop();
  }
}

async function testLockedSquadClaimIsRejected() {
  const harness = await createHarness({
    matchState: {
      players: [
        { name: "Alpha", steamId: "steam-alpha", teamId: 1, squadId: 0 },
        { name: "Bravo", steamId: "steam-bravo", teamId: 2, squadId: 3 },
      ],
      squads: [
        { teamId: 2, squadId: 3, locked: true },
      ],
    },
  });

  try {
    const created = await harness.plugin.api.simulateChatMessage({
      message: "sqtb",
      steamId: "steam-alpha",
      playerName: "Alpha",
    });
    const rejected = await harness.plugin.api.simulateChatMessage({
      message: `认领${created.request.code}`,
      steamId: "steam-bravo",
      playerName: "Bravo",
    });

    assert.equal(rejected.ok, false);
    assert.equal(rejected.error, "LockedSquadForbidden");
    assert.equal(harness.warnings.length, 1);
    assert.match(harness.warnings[0].message, /认领失败/);
  } finally {
    await harness.stop();
  }
}

async function testWarmupTbIsRejectedAndWarned() {
  const harness = await createHarness({
    webStatus: {
      isWarmup: true,
      logClockSeconds: 5,
    },
    matchState: {
      players: [
        { name: "Alpha", steamId: "steam-alpha", teamId: 1, squadId: 7 },
        { name: "Bravo", steamId: "steam-bravo", teamId: 1, squadId: 0 },
        { name: "Charlie", steamId: "steam-charlie", teamId: 1, squadId: 0 },
        { name: "Delta", steamId: "steam-delta", teamId: 1, squadId: 0 },
        { name: "Echo", steamId: "steam-echo", teamId: 2, squadId: 0 },
      ],
      squads: [
        { teamId: 1, squadId: 7, locked: true },
      ],
    },
  });

  try {
    const stateBefore = harness.plugin.api.getState();
    assert.equal(stateBefore.publicTbRemaining, 5);

    const result = await harness.plugin.api.simulateChatMessage({
      message: "tb",
      steamId: "steam-alpha",
      playerName: "Alpha",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "WarmupModeDisabled");
    assert.equal(harness.teamBalanceCalls.length, 0);
    assert.equal(harness.plugin.api.getState().publicTbRemaining, 5);
    assert.equal(harness.warnings.length, 1);
    assert.match(harness.warnings[0].message, /暖服模式/);
  } finally {
    await harness.stop();
  }
}

async function testPlayerQuotasResetAndRecoveryRoundTrip() {
  const harness = await createHarness({
    keepTempDir: true,
    matchState: {
      players: [
        { name: "Alpha", steamId: "steam-alpha", teamId: 1, squadId: 0 },
        { name: "Bravo", steamId: "steam-bravo", teamId: 2, squadId: 0 },
      ],
    },
  });

  try {
    const alphaTb = await harness.plugin.api.simulateChatMessage({
      message: "tb",
      steamId: "steam-alpha",
      playerName: "Alpha",
    });
    assert.equal(alphaTb.ok, true);

    const bravoTb = await harness.plugin.api.simulateChatMessage({
      message: "tb",
      steamId: "steam-bravo",
      playerName: "Bravo",
    });
    assert.equal(bravoTb.ok, true);

    const stateBeforeReset = harness.plugin.api.getState();
    assert.equal(stateBeforeReset.playerQuotas.length, 2);
    assert.equal(stateBeforeReset.roundUsedCount, 2);

    const alphaQuota = stateBeforeReset.playerQuotas.find((quota) => quota.playerName === "Alpha");
    const bravoQuota = stateBeforeReset.playerQuotas.find((quota) => quota.playerName === "Bravo");
    assert.equal(alphaQuota?.tbUsed, 1);
    assert.equal(alphaQuota?.hasRoundUse, true);
    assert.equal(bravoQuota?.tbUsed, 1);
    assert.equal(bravoQuota?.hasRoundUse, true);

    const periodReset = await harness.plugin.api.resetPeriodQuotas();
    assert.equal(periodReset.ok, true);
    assert.equal(periodReset.affectedCount, 2);

    const stateAfterPeriodReset = harness.plugin.api.getState();
    assert.equal(stateAfterPeriodReset.playerQuotas.length, 2);
    assert.equal(stateAfterPeriodReset.roundUsedCount, 2);
    assert.ok(stateAfterPeriodReset.playerQuotas.every((quota) => quota.tbUsed === 0 && quota.sqtbClaimUsed === 0));

    const roundReset = await harness.plugin.api.resetRound();
    assert.equal(roundReset.ok, true);
    assert.equal(harness.plugin.api.getState().publicTbRemaining, 5);
    assert.equal(harness.plugin.api.getState().roundUsedCount, 0);
  } finally {
    await harness.stop();
  }

  const recoveredPlugin = createFairTeamBalancePlugin({
    core: {
      webStatus: {
        serverId: "test-server",
        getSnapshot() {
          return {
            isWarmup: false,
            logClockSeconds: 30,
            serverId: "test-server",
          };
        },
      },
      eventBus: {
        onCoreEvent() {
          return () => {};
        },
      },
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
    },
    modules: {
      teamBalance: {
        async forceTeamChange() {
          return {
            ok: true,
            error: "",
            message: "Team switch requested.",
            command: "",
            rconExecuted: true,
            rconResponse: "OK",
          };
        },
      },
      squadManagement: {
        getState() {
          return createMatchState({
            players: [
              { name: "Alpha", steamId: "steam-alpha", teamId: 1, squadId: 0 },
              { name: "Bravo", steamId: "steam-bravo", teamId: 2, squadId: 0 },
            ],
          });
        },
      },
      chatManager: {
        on() {
          return () => {};
        },
      },
    },
    config: {
      get(pathText, defaultValue) {
        if (pathText === "plugins.fairTeamBalance") {
          return {
            enabled: true,
            directory: harness.tempDir,
            requestTtlMs: 120000,
          };
        }
        return defaultValue;
      },
    },
  });

  try {
    await recoveredPlugin.init();
    await recoveredPlugin.start();

    const recoveredState = recoveredPlugin.api.getState();
    assert.equal(recoveredState.publicTbRemaining, 5);
    assert.equal(recoveredState.roundUsedCount, 0);
    assert.equal(recoveredState.playerQuotas.length, 2);
    assert.ok(recoveredState.playerQuotas.every((quota) => quota.tbUsed === 0 && quota.sqtbClaimUsed === 0));
  } finally {
    await recoveredPlugin.stop();
    await fs.rm(harness.tempDir, { recursive: true, force: true });
  }
}

async function testRecoveryRestoresPendingRequestAndRoundQuotaAfterRoundReset() {
  const harness = await createHarness({
    matchState: {
      players: [
        { name: "Alpha", steamId: "steam-alpha", teamId: 1, squadId: 0 },
        { name: "Bravo", steamId: "steam-bravo", teamId: 1, squadId: 0 },
        { name: "Charlie", steamId: "steam-charlie", teamId: 2, squadId: 0 },
      ],
    },
  });

  const tempDir = harness.tempDir;
  try {
    await harness.emitCoreEvent("round.world_bring_up", { serverId: "test-server" });

    const tbResult = await harness.plugin.api.simulateChatMessage({
      message: "tb",
      steamId: "steam-alpha",
      playerName: "Alpha",
    });
    assert.equal(tbResult.ok, true);

    const sqtbResult = await harness.plugin.api.simulateChatMessage({
      message: "sqtb",
      steamId: "steam-charlie",
      playerName: "Charlie",
    });
    assert.equal(sqtbResult.ok, true);
  } finally {
    await harness.plugin.stop();
  }

  const recoveredHarness = await createHarness({
    matchState: {
      players: [
        { name: "Alpha", steamId: "steam-alpha", teamId: 1, squadId: 0 },
        { name: "Bravo", steamId: "steam-bravo", teamId: 1, squadId: 0 },
        { name: "Charlie", steamId: "steam-charlie", teamId: 2, squadId: 0 },
      ],
    },
  });

  try {
    // Repoint recovery to the first harness log directory.
    await recoveredHarness.plugin.stop();
  } finally {
    await recoveredHarness.stop();
  }

  const plugin = createFairTeamBalancePlugin({
    core: {
      webStatus: {
        serverId: "test-server",
        getSnapshot() {
          return {
            isWarmup: false,
            logClockSeconds: 30,
            serverId: "test-server",
          };
        },
      },
      eventBus: {
        onCoreEvent() {
          return () => {};
        },
      },
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
    },
    modules: {
      teamBalance: {
        async forceTeamChange() {
          return {
            ok: true,
            error: "",
            message: "Team switch requested.",
            command: "",
            rconExecuted: true,
            rconResponse: "OK",
          };
        },
      },
      squadManagement: {
        getState() {
          return createMatchState({
            players: [
              { name: "Alpha", steamId: "steam-alpha", teamId: 1, squadId: 0 },
              { name: "Bravo", steamId: "steam-bravo", teamId: 1, squadId: 0 },
              { name: "Charlie", steamId: "steam-charlie", teamId: 2, squadId: 0 },
            ],
          });
        },
      },
      chatManager: {
        on() {
          return () => {};
        },
      },
    },
    config: {
      get(pathText, defaultValue) {
        if (pathText === "plugins.fairTeamBalance") {
          return {
            enabled: true,
            directory: tempDir,
            requestTtlMs: 120000,
          };
        }
        return defaultValue;
      },
    },
  });

  try {
    await plugin.init();
    await plugin.start();

    const state = plugin.api.getState();
    assert.equal(state.publicTbRemaining, 4);
    assert.equal(state.roundUsedCount, 2);

    const requests = plugin.api.listRequests();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].applicant.playerName, "Charlie");
  } finally {
    await plugin.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testSqtbExpiresByTtl() {
  const harness = await createHarness({
    requestTtlMs: 1000,
    matchState: {
      players: [
        { name: "Alpha", steamId: "steam-alpha", teamId: 1, squadId: 0 },
        { name: "Bravo", steamId: "steam-bravo", teamId: 2, squadId: 0 },
      ],
    },
  });

  try {
    const created = await harness.plugin.api.simulateChatMessage({
      message: "sqtb",
      steamId: "steam-alpha",
      playerName: "Alpha",
    });
    assert.equal(created.ok, true);

    await waitFor(() => harness.plugin.api.listRequests().length === 0, { timeoutMs: 3000, intervalMs: 50 });
    assert.equal(harness.plugin.api.getState().activeRequestCount, 0);
  } finally {
    await harness.stop();
  }
}

await testExactTriggersAndTbSuccess();
await testSqtbConsumesRoundUsageAndDirectApprovalOnlyConsumesApplicantPeriodQuota();
await testClaimAutoExecutesAndConsumesBothPeriodQuotas();
await testLockedSquadClaimIsRejected();
await testWarmupTbIsRejectedAndWarned();
await testPlayerQuotasResetAndRecoveryRoundTrip();
await testRecoveryRestoresPendingRequestAndRoundQuotaAfterRoundReset();
await testSqtbExpiresByTtl();
await testWindowBroadcasts();

console.log("fair team balance tests passed");

async function testWindowBroadcasts() {
  console.log("testing window broadcasts...");
  const harness = await createHarness({
    webStatus: {
      logClockSeconds: 10,
    },
  });

  try {
    // Initially closed at 10s
    assert.equal(harness.broadcasts.length, 0);

    // Move to 25s (Open)
    harness.webStatus.logClockSeconds = 25;
    await sleep(1200); // Wait for expiryTimer (1000ms + margin)
    assert.equal(harness.broadcasts.length, 1);
    assert.match(harness.broadcasts[0].message, /窗口已打开/);

    // Stay at 30s (Still Open, no new broadcast)
    harness.webStatus.logClockSeconds = 30;
    await sleep(1200);
    assert.equal(harness.broadcasts.length, 1);

    // Move to 65s (Closed)
    harness.webStatus.logClockSeconds = 65;
    await sleep(1200);
    assert.equal(harness.broadcasts.length, 2);
    assert.match(harness.broadcasts[1].message, /窗口已关闭/);
  } finally {
    await harness.stop();
  }
}
