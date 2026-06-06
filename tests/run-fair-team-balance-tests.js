import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPlugin as createFairTeamBalancePlugin } from "../plugins/fair-team-balance.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      name: String(player?.name ?? ""),
      steamId: String(player?.steamId ?? player?.steamID ?? ""),
      eosId: String(player?.eosId ?? player?.eosID ?? ""),
      teamId: Number(player?.teamId ?? player?.teamID ?? 0) || 0,
      squadId: Number(player?.squadId ?? player?.squadID ?? 0) || 0,
    })),
    squads: squads.map((squad) => ({
      teamId: Number(squad?.teamId ?? squad?.teamID ?? 0) || 0,
      squadId: Number(squad?.squadId ?? squad?.squadID ?? 0) || 0,
      locked: Boolean(squad?.locked),
    })),
    teams: [
      { teamId: 1, playerCount: teamCounts.get(1) || 0 },
      { teamId: 2, playerCount: teamCounts.get(2) || 0 },
    ],
  };
}

async function createHarness(options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-fair-tb-"));
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
      await sleep(10);
    },
    async stop() {
      await plugin.stop();
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}

async function testTbSucceedsOnlyWhenOwnTeamIsAheadByThree() {
  const harness = await createHarness({
    matchState: {
      players: [
        { name: "Alpha", steamId: "steam-alpha", teamId: 1, squadId: 0 },
        { name: "Bravo", steamId: "steam-bravo", teamId: 1, squadId: 0 },
        { name: "Charlie", steamId: "steam-charlie", teamId: 1, squadId: 0 },
        { name: "Echo", steamId: "steam-echo", teamId: 1, squadId: 0 },
        { name: "Delta", steamId: "steam-delta", teamId: 2, squadId: 0 },
      ],
    },
  });

  try {
    const result = await harness.plugin.api.simulateChatMessage({
      message: "tb",
      steamId: "steam-alpha",
      playerName: "Alpha",
    });

    assert.equal(result.matched, true);
    assert.equal(result.ok, true);
    assert.equal(harness.teamBalanceCalls.length, 1);
    assert.equal(harness.plugin.api.getState().publicTbRemaining, 4);
    assert.equal(harness.plugin.api.getState().roundUsedCount, 1);
    assert.equal(harness.plugin.api.listRequests().length, 0);
  } finally {
    await harness.stop();
  }
}

async function testTbRejectsWhenOwnTeamLeadIsBelowThree() {
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
    const result = await harness.plugin.api.simulateChatMessage({
      message: "tb",
      steamId: "steam-alpha",
      playerName: "Alpha",
    });

    assert.equal(result.matched, true);
    assert.equal(result.ok, false);
    assert.equal(result.error, "TeamDeltaNotAllowed");
    assert.equal(harness.teamBalanceCalls.length, 0);
    assert.equal(harness.plugin.api.getState().publicTbRemaining, 5);
    assert.equal(harness.plugin.api.getState().roundUsedCount, 0);
  } finally {
    await harness.stop();
  }
}

async function testSqtbCreatesRequestAndClaimExecutes() {
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
    assert.equal(harness.plugin.api.listRequests().length, 1);
    assert.equal(harness.teamBalanceCalls.length, 0);

    const claimed = await harness.plugin.api.simulateChatMessage({
      message: created.claimMessage,
      steamId: "steam-bravo",
      playerName: "Bravo",
    });

    assert.equal(claimed.ok, true);
    assert.equal(claimed.request.status, "approved");
    assert.equal(harness.teamBalanceCalls.length, 1);
    assert.equal(harness.plugin.api.listRequests().length, 0);
    assert.equal(harness.broadcasts.length >= 2, true);
  } finally {
    await harness.stop();
  }
}

async function testSqtbDirectApproveStillWorks() {
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
    assert.equal(harness.plugin.api.listRequests().length, 0);
  } finally {
    await harness.stop();
  }
}

async function testApproveRequestRejectsConcurrentDuplicates() {
  let releaseFirstApproval = null;
  let firstApprovalStarted = false;
  const harness = await createHarness({
    matchState: {
      players: [
        { name: "Alpha", steamId: "steam-alpha", teamId: 1, squadId: 0 },
        { name: "Bravo", steamId: "steam-bravo", teamId: 2, squadId: 0 },
      ],
    },
    forceTeamChange: async () => {
      if (!firstApprovalStarted) {
        firstApprovalStarted = true;
        await new Promise((resolve) => {
          releaseFirstApproval = resolve;
        });
      }
      return {
        ok: true,
        error: "",
        message: "Team switch requested.",
        command: "AdminForceTeamChange",
        rconExecuted: true,
        rconResponse: "OK",
      };
    },
  });

  try {
    const created = await harness.plugin.api.simulateChatMessage({
      message: "sqtb",
      steamId: "steam-alpha",
      playerName: "Alpha",
    });

    const firstApprovalPromise = harness.plugin.api.approveRequest({
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

    for (let index = 0; index < 50 && !firstApprovalStarted; index += 1) {
      await sleep(10);
    }

    assert.equal(firstApprovalStarted, true);

    const secondApproval = await harness.plugin.api.approveRequest({
      requestId: created.request.id,
      direct: true,
      actor: {
        id: "admin-2",
        username: "Admin2",
        name: "Admin2",
        role: "SuperAdmin",
        isSuperAdmin: true,
        permissions: ["*"],
      },
    });

    assert.equal(secondApproval.ok, false);
    assert.equal(secondApproval.error, "RequestProcessing");
    assert.equal(harness.teamBalanceCalls.length, 1);

    releaseFirstApproval?.();
    const firstApproval = await firstApprovalPromise;

    assert.equal(firstApproval.ok, true);
    assert.equal(harness.teamBalanceCalls.length, 1);
    assert.equal(harness.plugin.api.listRequests().length, 0);
  } finally {
    releaseFirstApproval?.();
    await harness.stop();
  }
}

async function testClaimCodeIsStillHandled() {
  const harness = await createHarness({
    matchState: {
      players: [
        { name: "Alpha", steamId: "steam-alpha", teamId: 1, squadId: 0 },
        { name: "Bravo", steamId: "steam-bravo", teamId: 2, squadId: 0 },
      ],
    },
  });

  try {
    const result = await harness.plugin.api.simulateChatMessage({
      message: "认领12345",
      steamId: "steam-alpha",
      playerName: "Alpha",
    });

    assert.equal(result.matched, true);
    assert.equal(result.ok, false);
    assert.equal(result.error, "RequestNotFound");
  } finally {
    await harness.stop();
  }
}

await testTbSucceedsOnlyWhenOwnTeamIsAheadByThree();
await testTbRejectsWhenOwnTeamLeadIsBelowThree();
await testSqtbCreatesRequestAndClaimExecutes();
await testSqtbDirectApproveStillWorks();
await testApproveRequestRejectsConcurrentDuplicates();
await testClaimCodeIsStillHandled();

console.log("fair team balance tests passed");
