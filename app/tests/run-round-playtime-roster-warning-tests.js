import assert from "node:assert/strict";
import { createPlugin, __test } from "../plugins/round-playtime-roster-warning.js";

function createHarness() {
  const warnings = [];
  const clock = { seconds: 0, key: "round-a" };
  let worldBringUpHandler = null;
  const players = [
    { playerID: 1, name: "Alpha", steamID: "1001", eosID: "e1", teamID: 1, squadID: 1, isLeader: true, role: "BP_SquadLeader_C", online: true },
    { playerID: 2, name: "Bravo", steamID: "1002", eosID: "e2", teamID: 1, squadID: 1, isLeader: false, role: "BP_Rifleman_C", online: true },
    { playerID: 3, name: "Charlie", steamID: "1003", eosID: "e3", teamID: 1, squadID: 2, isLeader: true, role: "BP_Medic_C", online: true },
    { playerID: 4, name: "Delta", steamID: "1004", eosID: "e4", teamID: 2, squadID: 1, isLeader: true, role: "BP_SquadLeader_C", online: true },
  ];
  const corePlayers = [
    { playerID: 1, playerName: "Alpha", teamId: 1, squadId: 1, ftIndex: 0 },
    { playerID: 2, playerName: "Bravo", teamId: 1, squadId: 1, ftIndex: 1 },
    { playerID: 3, playerName: "Charlie", teamId: 1, squadId: 2, ftIndex: 2 },
    { playerID: 4, playerName: "Delta", teamId: 2, squadId: 1, ftIndex: 0 },
  ];
  const squads = [
    { teamID: 1, squadID: 1, squadName: "步兵队" },
    { teamID: 1, squadID: 2, squadName: "后勤队" },
    { teamID: 2, squadID: 1, squadName: "装甲队" },
  ];
  const playtimes = new Map([
    ["1001", { game_seconds: 100 * 3600 }],
    ["1002", { game_seconds: 200 * 3600 }],
    ["1003", { game_seconds: 300 * 3600 }],
    ["1004", { game_seconds: 400 * 3600 }],
  ]);

  const core = {
    webStatus: {
      serverId: "test-server",
      getSnapshot() {
        return {
          serverId: "test-server",
          logClockSeconds: clock.seconds,
          logClockHasAnchor: true,
          logClockManual: false,
          logClockAnchorLogTime: clock.key,
        };
      },
    },
    pluginSubscriptions: { isSubscribed() { return true; } },
    eventBus: {
      onCoreEvent(name, handler) {
        if (name === "round.world_bring_up") worldBringUpHandler = handler;
        return () => {};
      },
    },
    logger: { info() {}, warn() {}, debug() {}, error() {} },
  };
  const matchState = {
    serverId: "test-server",
    round: { current: { dedupeKey: clock.key } },
    players: { list: players },
    squads: { list: squads },
  };
  const modules = {
    pluginSubscriptions: { isSubscribed() { return true; } },
    matchState: {
      getState() { return matchState; },
      getRoundState() { return { current: { dedupeKey: clock.key } }; },
      getOverview() { return { status: core.webStatus.getSnapshot(), matchState, players, squads }; },
    },
    playerState: { getPlayerList() { return players; } },
    bzssCoreMonitor: { getPlayers() { return corePlayers; } },
    playtime: { async getBySteamID(id) { return playtimes.get(id) ?? null; } },
    adminWarn: {
      async warnPlayer(request) {
        warnings.push({ ...request });
        return { success: true };
      },
    },
  };
  const config = {
    get(key, fallback) {
      if (key === "plugins.round-playtime-roster-warning") {
        return { enabled: true, persistState: false, pollIntervalMs: 30000 };
      }
      return fallback;
    },
  };
  const plugin = createPlugin({ core, modules, config });
  return {
    plugin,
    clock,
    warnings,
    emitWorldBringUp() { worldBringUpHandler?.(); },
  };
}

async function testClockThresholdsAndOneShot() {
  const h = createHarness();
  await h.plugin.init();

  h.clock.seconds = 299;
  await h.plugin.api.evaluateNow();
  assert.equal(h.warnings.length, 0);

  h.clock.seconds = 300;
  await h.plugin.api.evaluateNow();
  assert.equal(h.warnings.length, 4);
  const alpha = h.warnings.find((item) => item.targetName === "Alpha");
  const bravo = h.warnings.find((item) => item.targetName === "Bravo");
  assert.ok(alpha);
  assert.equal(alpha.message, bravo.message);
  assert.match(alpha.message, /（A组）小队长 Alpha 游戏时长 100小时/);
  assert.match(alpha.message, /（B组）步枪兵 Bravo 游戏时长 200小时/);
  assert.equal(alpha.message.split("\n").length, 2);
  assert.ok(alpha.message.length <= 180);

  await h.plugin.api.evaluateNow();
  assert.equal(h.warnings.length, 4);

  h.clock.seconds = 450;
  await h.plugin.api.evaluateNow();
  assert.equal(h.warnings.length, 8);
  const team1LeaderSummary = h.warnings.slice(4).find((item) => item.targetName === "Bravo");
  assert.ok(team1LeaderSummary);
  assert.match(team1LeaderSummary.message, /步兵队 队长游戏时长 100小时/);
  assert.match(team1LeaderSummary.message, /后勤队 队长游戏时长 300小时/);
  assert.doesNotMatch(team1LeaderSummary.message, /(?:^|\n)\d+队/);
  assert.equal(team1LeaderSummary.message.split("\n").length, 2);

  await h.plugin.api.evaluateNow();
  assert.equal(h.warnings.length, 8);
}

async function testNewRoundResetsDispatch() {
  const h = createHarness();
  await h.plugin.init();
  h.clock.seconds = 300;
  await h.plugin.api.evaluateNow();
  assert.equal(h.warnings.length, 4);
  h.clock.key = "round-b";
  h.clock.seconds = 300;
  await h.plugin.api.evaluateNow();
  assert.equal(h.warnings.length, 8);
}

async function testRoundTransitionBlocksOldClock() {
  const h = createHarness();
  await h.plugin.init();
  await h.plugin.start();
  h.clock.seconds = 450;
  await h.plugin.api.evaluateNow();
  assert.equal(h.warnings.length, 8);

  h.emitWorldBringUp();
  await h.plugin.api.evaluateNow();
  assert.equal(h.warnings.length, 8);

  h.clock.key = "round-b";
  h.clock.seconds = 300;
  await h.plugin.api.evaluateNow();
  assert.equal(h.warnings.length, 12);
  await h.plugin.stop();
}

function testLongMessagePreservesLines() {
  const players = Array.from({ length: 9 }, (_, index) => ({
    fireTeam: ["A", "B", "C"][index % 3],
    role: "重型反坦克兵",
    roleShort: "重反",
    name: `玩家名称非常非常长${index}`,
    gameSeconds: (index + 1) * 123.4 * 3600,
  }));
  const message = __test.buildSquadRosterMessage(players, 180);
  assert.ok(message.length <= 180);
  assert.equal(message.split("\n").length, players.length);

  const leaders = Array.from({ length: 15 }, (_, index) => ({
    squadName: `这是一个非常非常长的小队名称${index}`,
    gameSeconds: (index + 1) * 100 * 3600,
  }));
  const leaderMessage = __test.buildLeaderRosterMessage(leaders, 180);
  assert.ok(leaderMessage.length <= 180);
  assert.equal(leaderMessage.split("\n").length, leaders.length);
}

try {
  await testClockThresholdsAndOneShot();
  await testNewRoundResetsDispatch();
  await testRoundTransitionBlocksOldClock();
  testLongMessagePreservesLines();
  console.log("Round playtime roster warning tests passed successfully!");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
