import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPlugin as createFairTeamBalancePlugin } from "../plugins/fair-team-balance.js";

function createMatchState({ players = [] } = {}) {
  const team1 = players.filter((player) => Number(player?.teamId ?? player?.teamID ?? 0) === 1).length;
  const team2 = players.filter((player) => Number(player?.teamId ?? player?.teamID ?? 0) === 2).length;

  return {
    serverId: "test-server",
    players: players.map((player) => ({
      name: String(player?.name ?? ""),
      steamId: String(player?.steamId ?? player?.steamID ?? ""),
      eosId: String(player?.eosId ?? player?.eosID ?? ""),
      teamId: Number(player?.teamId ?? player?.teamID ?? 0) || 0,
      squadId: Number(player?.squadId ?? player?.squadID ?? 0) || 0,
    })),
    teams: [
      { teamId: 1, playerCount: team1 },
      { teamId: 2, playerCount: team2 },
    ],
    squads: [],
  };
}

async function createHarness({ matchState, webStatus } = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-fair-tb-"));
  const broadcasts = [];
  const warnings = [];
  const teamBalanceCalls = [];
  const plugin = createFairTeamBalancePlugin({
    core: {
      webStatus: {
        serverId: "test-server",
        getSnapshot() {
          return {
            serverId: "test-server",
            isWarmup: false,
            logClockSeconds: 30,
            ...(webStatus ?? {}),
          };
        },
      },
      webRegistry: {
        registerPage() {},
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
          return match.current;
        },
      },
      chatManager: {
        on() {
          return () => {};
        },
      },
      adminWarn: {
        async sendAdminBroadcast(payload) {
          broadcasts.push(payload);
          return { success: true };
        },
        async sendAdminWarn(payload) {
          warnings.push(payload);
          return { success: true };
        },
      },
    },
    config: {
      get(key, defaultValue) {
        if (key === "plugins.fairTeamBalance") {
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

  const match = {
    current: createMatchState(matchState),
  };

  await plugin.init();
  await plugin.start();

  return {
    plugin,
    tempDir,
    broadcasts,
    warnings,
    teamBalanceCalls,
    setMatchState(nextState) {
      match.current = createMatchState(nextState);
    },
    async stop() {
      await plugin.stop();
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}

async function testTbSucceedsOnlyWhenOwnTeamIsLarger() {
  const harness = await createHarness({
    matchState: {
      players: [
        { name: "Alpha", steamId: "steam-alpha", teamId: 1 },
        { name: "Bravo", steamId: "steam-bravo", teamId: 1 },
        { name: "Charlie", steamId: "steam-charlie", teamId: 2 },
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
    assert.equal(result.mode, "normal");
    assert.equal(harness.teamBalanceCalls.length, 1);
    assert.equal(harness.plugin.api.getState().publicTbRemaining, 4);
    assert.equal(harness.plugin.api.getState().roundUsedCount, 1);
    assert.equal(harness.plugin.api.getState().playerQuotas.find((quota) => quota.playerName === "Alpha")?.tbUsed, 1);
    assert.equal(harness.plugin.api.listRequests().length, 0);
    assert.equal(harness.broadcasts.some((item) => /窗口已打开|窗口已关闭/.test(String(item?.message ?? ""))), false);
  } finally {
    await harness.stop();
  }
}

async function testTbRejectsWhenOwnTeamIsNotLarger() {
  const harness = await createHarness({
    matchState: {
      players: [
        { name: "Alpha", steamId: "steam-alpha", teamId: 1 },
        { name: "Bravo", steamId: "steam-bravo", teamId: 2 },
        { name: "Charlie", steamId: "steam-charlie", teamId: 2 },
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
    assert.equal(harness.plugin.api.listRequests().length, 0);
  } finally {
    await harness.stop();
  }
}

async function testSqtbSucceedsDirectlyAndConsumesItsOwnQuota() {
  const harness = await createHarness({
    matchState: {
      players: [
        { name: "Alpha", steamId: "steam-alpha", teamId: 2 },
        { name: "Bravo", steamId: "steam-bravo", teamId: 2 },
        { name: "Charlie", steamId: "steam-charlie", teamId: 1 },
      ],
    },
  });

  try {
    const result = await harness.plugin.api.simulateChatMessage({
      message: "sqtb",
      steamId: "steam-alpha",
      playerName: "Alpha",
    });

    assert.equal(result.matched, true);
    assert.equal(result.ok, true);
    assert.equal(result.mode, "direct");
    assert.equal(harness.teamBalanceCalls.length, 1);
    assert.equal(harness.plugin.api.getState().publicTbRemaining, 5);
    assert.equal(harness.plugin.api.getState().roundUsedCount, 1);
    assert.equal(harness.plugin.api.getState().playerQuotas.find((quota) => quota.playerName === "Alpha")?.sqtbClaimUsed, 1);
    assert.equal(harness.plugin.api.listRequests().length, 0);
    assert.equal(harness.broadcasts.some((item) => /窗口已打开|窗口已关闭/.test(String(item?.message ?? ""))), false);
  } finally {
    await harness.stop();
  }
}

async function testSqtbRejectsWhenTeamsAreBalanced() {
  const harness = await createHarness({
    matchState: {
      players: [
        { name: "Alpha", steamId: "steam-alpha", teamId: 1 },
        { name: "Bravo", steamId: "steam-bravo", teamId: 2 },
      ],
    },
  });

  try {
    const result = await harness.plugin.api.simulateChatMessage({
      message: "sqtb",
      steamId: "steam-alpha",
      playerName: "Alpha",
    });

    assert.equal(result.matched, true);
    assert.equal(result.ok, false);
    assert.equal(result.error, "TeamDeltaNotAllowed");
    assert.equal(harness.teamBalanceCalls.length, 0);
    assert.equal(harness.plugin.api.getState().roundUsedCount, 0);
    assert.equal(harness.plugin.api.listRequests().length, 0);
  } finally {
    await harness.stop();
  }
}

async function testClaimCodeNoLongerTriggersAnything() {
  const harness = await createHarness({
    matchState: {
      players: [
        { name: "Alpha", steamId: "steam-alpha", teamId: 1 },
        { name: "Bravo", steamId: "steam-bravo", teamId: 2 },
      ],
    },
  });

  try {
    const result = await harness.plugin.api.simulateChatMessage({
      message: "璁ら12345",
      steamId: "steam-alpha",
      playerName: "Alpha",
    });

    assert.equal(result.matched, false);
    assert.equal(harness.teamBalanceCalls.length, 0);
    assert.equal(harness.plugin.api.listRequests().length, 0);
  } finally {
    await harness.stop();
  }
}

await testTbSucceedsOnlyWhenOwnTeamIsLarger();
await testTbRejectsWhenOwnTeamIsNotLarger();
await testSqtbSucceedsDirectlyAndConsumesItsOwnQuota();
await testSqtbRejectsWhenTeamsAreBalanced();
await testClaimCodeNoLongerTriggersAnything();

console.log("fair team balance tests passed");
