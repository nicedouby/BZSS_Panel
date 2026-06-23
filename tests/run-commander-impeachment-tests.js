import assert from "node:assert/strict";

import { createPlugin as createCommanderImpeachmentPlugin } from "../plugins/commander-impeachment.js";

function noopLogger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

function createHarness() {
  const broadcasts = [];
  const warns = [];
  const commands = [];

  const state = {
    serverId: "test-server",
    match: {
      logClockSeconds: 7200,
    },
    teams: [
      { teamId: 1, teamName: "蓝方" },
      { teamId: 2, teamName: "红方" },
    ],
    squads: [
      { teamId: 1, squadId: 10, squadName: "Command Squad", leaderName: "Commander" },
      { teamId: 1, squadId: 1, squadName: "Alpha", leaderName: "LeaderA" },
      { teamId: 1, squadId: 2, squadName: "Bravo", leaderName: "LeaderB" },
      { teamId: 2, squadId: 1, squadName: "Enemy", leaderName: "EnemyLeader" },
    ],
    players: [
      { playerKey: "cmd", name: "Commander", steamId: "cmd-steam", eosId: "cmd-eos", teamId: 1, squadId: 10, squadName: "Command Squad", isLeader: true, role: "Commander" },
      { playerKey: "a-leader", name: "LeaderA", steamId: "a-steam", eosId: "a-eos", teamId: 1, squadId: 1, squadName: "Alpha", isLeader: true, role: "Rifleman" },
      { playerKey: "a-1", name: "Alpha1", steamId: "a1-steam", eosId: "a1-eos", teamId: 1, squadId: 1, squadName: "Alpha", isLeader: false, role: "Medic" },
      { playerKey: "a-2", name: "Alpha2", steamId: "a2-steam", eosId: "a2-eos", teamId: 1, squadId: 1, squadName: "Alpha", isLeader: false, role: "AT" },
      { playerKey: "b-leader", name: "LeaderB", steamId: "b-steam", eosId: "b-eos", teamId: 1, squadId: 2, squadName: "Bravo", isLeader: true, role: "Rifleman" },
      { playerKey: "b-1", name: "Bravo1", steamId: "b1-steam", eosId: "b1-eos", teamId: 1, squadId: 2, squadName: "Bravo", isLeader: false, role: "Medic" },
      { playerKey: "b-2", name: "Bravo2", steamId: "b2-steam", eosId: "b2-eos", teamId: 1, squadId: 2, squadName: "Bravo", isLeader: false, role: "AT" },
      { playerKey: "enemy", name: "EnemyLeader", steamId: "e-steam", eosId: "e-eos", teamId: 2, squadId: 1, squadName: "Enemy", isLeader: true, role: "Rifleman" },
    ],
  };

  const core = {
    logger: noopLogger(),
    createLogger() { return noopLogger(); },
    webStatus: {
      serverId: "test-server",
      getSnapshot() {
        return {
          logClockSeconds: state.match.logClockSeconds,
        };
      },
    },
    pluginSubscriptions: {
      isSubscribed() { return true; },
    },
    rconManager: {
      async dispatchCommand(request) {
        commands.push(request);
        return { success: true, ok: true, command: request.command };
      },
    },
  };

  const modules = {
    adminWarn: {
      async sendAdminBroadcast(request) {
        broadcasts.push(request);
        return { success: true, commandText: `AdminBroadcast ${request.message}` };
      },
      async sendAdminWarn(request) {
        warns.push(request);
        return { success: true, commandText: `AdminWarn "${request.targetName}" "${request.message}"` };
      },
    },
    squadManagement: {
      getState() {
        return state;
      },
    },
    pluginSubscriptions: {
      isSubscribed() { return true; },
    },
  };

  const config = {
    get(key, fallback) {
      if (key === "plugins.commanderImpeachment") return { enabled: true };
      return fallback;
    },
  };

  const plugin = createCommanderImpeachmentPlugin({ core, modules, config, logger: noopLogger() });

  return {
    plugin,
    state,
    broadcasts,
    warns,
    commands,
    async start() {
      await plugin.start();
    },
    async stop() {
      await plugin.stop();
    },
  };
}

function getProcess(plugin, serverId = "test-server") {
  const state = plugin.api.getState(serverId);
  return state.processes.find((process) => process.status === "active" || process.status === "succeeded" || process.status === "failed") ?? null;
}

async function testStartAndSuccess() {
  const harness = createHarness();
  try {
    await harness.start();

    const startResult = await harness.plugin.api.simulateChatMessage({
      serverId: "test-server",
      playerName: "LeaderA",
      steamId: "a-steam",
      teamId: 1,
      squadId: 1,
      message: "罢免指挥官",
    });

    assert.equal(startResult.success, true);
    assert.equal(harness.broadcasts[0].message, "蓝方 阵营正在进行罢免指挥官流程。");
    assert.equal(harness.warns.some((item) => item.targetName === "Commander" && item.message === "你正在被罢免。请等待投票结果。"), true);

    const voteA = await harness.plugin.api.simulateChatMessage({
      serverId: "test-server",
      playerName: "LeaderA",
      steamId: "a-steam",
      teamId: 1,
      squadId: 1,
      message: "1",
    });
    assert.equal(voteA.success, false);
    assert.equal(getProcess(harness.plugin).votesBySquadId.get(1).weight, 3);
    assert.equal(getProcess(harness.plugin).votesBySquadId.get(1).vote, "yes");

    const voteB = await harness.plugin.api.simulateChatMessage({
      serverId: "test-server",
      playerName: "LeaderB",
      steamId: "b-steam",
      teamId: 1,
      squadId: 2,
      message: "1",
    });

    assert.equal(voteB.success, true);
    assert.equal(harness.commands[0].command, "AdminDemoteCommander");
    assert.equal(harness.broadcasts[1].message, "Commander 已被罢免，游戏时长 2.0 小时。");
    assert.equal(harness.warns.some((item) => item.targetName === "Commander" && item.message === "你已被罢免。"), true);

    const finalProcess = getProcess(harness.plugin);
    assert.equal(finalProcess.status, "succeeded");
    assert.equal(finalProcess.yesCount, 6);
    assert.equal(finalProcess.totalCount, 7);
  } finally {
    await harness.stop();
  }
}

async function testRepeatVoteOverwritesSameSquad() {
  const harness = createHarness();
  try {
    await harness.start();

    await harness.plugin.api.simulateChatMessage({
      serverId: "test-server",
      playerName: "LeaderA",
      steamId: "a-steam",
      teamId: 1,
      squadId: 1,
      message: "罢免指挥官",
    });

    await harness.plugin.api.simulateChatMessage({
      serverId: "test-server",
      playerName: "LeaderA",
      steamId: "a-steam",
      teamId: 1,
      squadId: 1,
      message: "1",
    });

    await harness.plugin.api.simulateChatMessage({
      serverId: "test-server",
      playerName: "LeaderA",
      steamId: "a-steam",
      teamId: 1,
      squadId: 1,
      message: "0",
    });

    const process = getProcess(harness.plugin);
    const voteRecord = process.votesBySquadId.get(1);
    assert.equal(voteRecord.weight, 3);
    assert.equal(voteRecord.vote, "no");
    assert.equal(voteRecord.memberKeys.length, 3);
    assert.equal(process.votedPlayerKeys.has("steam:a1-steam"), true);
    assert.equal(process.votedPlayerKeys.has("steam:a2-steam"), true);
  } finally {
    await harness.stop();
  }
}

async function testNonLeaderCannotVote() {
  const harness = createHarness();
  try {
    await harness.start();

    await harness.plugin.api.simulateChatMessage({
      serverId: "test-server",
      playerName: "LeaderA",
      steamId: "a-steam",
      teamId: 1,
      squadId: 1,
      message: "罢免指挥官",
    });

    const result = await harness.plugin.api.simulateChatMessage({
      serverId: "test-server",
      playerName: "Alpha1",
      steamId: "a1-steam",
      teamId: 1,
      squadId: 1,
      message: "1",
    });

    assert.equal(result.success, false);
    assert.equal(harness.warns.some((item) => item.targetName === "Alpha1" && item.message === "只有小队长可以参与本次罢免投票。"), true);
    const process = getProcess(harness.plugin);
    assert.equal(process.votesBySquadId.size, 0);
    assert.equal(process.votedPlayerKeys.size, 0);
  } finally {
    await harness.stop();
  }
}

async function testFailureBroadcastWhenVoteBecomesImpossible() {
  const harness = createHarness();
  try {
    await harness.start();

    await harness.plugin.api.simulateChatMessage({
      serverId: "test-server",
      playerName: "LeaderA",
      steamId: "a-steam",
      teamId: 1,
      squadId: 1,
      message: "罢免指挥官",
    });

    await harness.plugin.api.simulateChatMessage({
      serverId: "test-server",
      playerName: "LeaderA",
      steamId: "a-steam",
      teamId: 1,
      squadId: 1,
      message: "0",
    });

    const result = await harness.plugin.api.simulateChatMessage({
      serverId: "test-server",
      playerName: "LeaderB",
      steamId: "b-steam",
      teamId: 1,
      squadId: 2,
      message: "0",
    });

    assert.equal(result.success, false);
    assert.equal(harness.commands.length, 0);
    assert.equal(harness.broadcasts.some((item) => item.message === "蓝方 阵营未能完成罢免指挥官流程。"), true);
    const process = getProcess(harness.plugin);
    assert.equal(process.status, "failed");
  } finally {
    await harness.stop();
  }
}

await testStartAndSuccess();
await testRepeatVoteOverwritesSameSquad();
await testNonLeaderCannotVote();
await testFailureBroadcastWhenVoteBecomesImpossible();
console.log("run-commander-impeachment-tests: ok");
