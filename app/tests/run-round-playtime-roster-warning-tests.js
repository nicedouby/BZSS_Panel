import assert from "node:assert/strict";
import { createPlugin, __test } from "../plugins/round-playtime-roster-warning.js";

function createHarness(options = {}) {
  const warnings = [];
  const clock = { seconds: 0, key: "round-a" };
  const configValue = {
    enabled: true,
    persistState: false,
    pollIntervalMs: 30000,
    lineBreakMode: "escaped",
    maxWarningChars: 180,
    manualSquadTriggerNonce: "",
    manualLeaderTriggerNonce: "",
    ...(options.config ?? {}),
  };
  const players = options.players ?? [
    { playerID: 1, name: "Alpha", steamID: "1001", eosID: "e1", teamID: 1, squadID: 1, isLeader: true, role: "BP_SquadLeader_C", online: true },
    { playerID: 2, name: "Bravo", steamID: "1002", eosID: "e2", teamID: 1, squadID: 1, isLeader: false, role: "BP_Rifleman_C", online: true },
    { playerID: 3, name: "Charlie", steamID: "1003", eosID: "e3", teamID: 1, squadID: 2, isLeader: true, role: "BP_Medic_C", online: true },
    { playerID: 4, name: "Delta", steamID: "1004", eosID: "e4", teamID: 2, squadID: 1, isLeader: true, role: "BP_SquadLeader_C", online: true },
  ];
  const corePlayers = options.corePlayers ?? [
    { playerID: 1, playerName: "Alpha", teamId: 1, squadId: 1, ftIndex: 0, stale: true },
    { playerID: 2, playerName: "Bravo", teamId: 1, squadId: 1, playerScoreboard: { fireTeamIndex: 1 }, stale: true },
    { playerID: 3, playerName: "Charlie", teamId: 1, squadId: 2, fireTeamIndex: 2, stale: true },
    { playerID: 4, playerName: "Delta", teamId: 2, squadId: 1, ftIndex: 0, stale: true },
  ];
  const squads = options.squads ?? [
    { teamID: 1, squadID: 1, squadName: "步兵队" },
    { teamID: 1, squadID: 2, squadName: "后勤队" },
    { teamID: 2, squadID: 1, squadName: "装甲队" },
  ];
  const playtimes = options.playtimes ?? new Map([
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
    eventBus: { onCoreEvent() { return () => {}; } },
    webRegistry: { registerPage() {} },
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
      if (key === "plugins.round-playtime-roster-warning") return configValue;
      return fallback;
    },
  };
  const plugin = createPlugin({ core, modules, config });
  return { plugin, clock, warnings, configValue };
}

async function testClockThresholdsAndEscapedNewlines() {
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
  assert.equal(alpha.message.includes("\n"), false, "RCON payload must not contain a raw newline");
  assert.equal(alpha.message.split("\\n").length, 2, "RCON payload should use literal \\n separators");
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
  assert.equal(team1LeaderSummary.message.split("\\n").length, 2);
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

async function testManualNonceTriggersOnlyOnce() {
  const h = createHarness();
  await h.plugin.init();
  h.configValue.manualSquadTriggerNonce = "manual-squad-1";
  await h.plugin.api.evaluateNow();
  assert.equal(h.warnings.length, 4);
  await h.plugin.api.evaluateNow();
  assert.equal(h.warnings.length, 4);
  assert.equal(h.plugin.api.getState().lastManualSquadNonce, "manual-squad-1");

  h.configValue.manualLeaderTriggerNonce = "manual-leader-1";
  await h.plugin.api.evaluateNow();
  assert.equal(h.warnings.length, 8);
  await h.plugin.api.evaluateNow();
  assert.equal(h.warnings.length, 8);
}

function testFireTeamEvidenceAndOnlineMerge() {
  const merged = __test.mergePlayerSources([
    { source: "playerState", players: [{ playerID: 9, name: "Online", steamID: "9001", teamID: 1, squadID: 3, online: true }] },
    { source: "bzssCore", players: [{ playerID: 9, playerName: "Online", steamID: "9001", stale: true, playerScoreboard: { fireTeamIndex: 2 } }] },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].stale, false, "online RCON evidence must win over scoreboard stale flag");
  assert.equal(merged[0].fireTeam, "C");
  assert.match(merged[0].fireTeamSource, /playerScoreboard\.fireTeamIndex/);

  const conflict = __test.mergePlayerSources([
    { source: "playerState", players: [{ name: "Conflict", steamID: "9002", online: true, fireTeamName: "A" }] },
    { source: "bzssCore", players: [{ playerName: "Conflict", steamID: "9002", ftIndex: 1 }] },
  ])[0];
  assert.equal(conflict.fireTeam, "A", "explicit fireteam label should beat numeric index");
  assert.equal(conflict.fireTeamConflict, true);
}

function testLongMessagePreservesEncodedLines() {
  const players = Array.from({ length: 9 }, (_, index) => ({
    fireTeam: ["A", "B", "C"][index % 3],
    role: "重型反坦克兵",
    roleShort: "重反",
    name: `玩家名称非常非常长${index}`,
    gameSeconds: (index + 1) * 123.4 * 3600,
  }));
  const message = __test.buildSquadRosterMessage(players, 180, "escaped");
  assert.ok(message.length <= 180);
  assert.equal(message.split("\\n").length, players.length);
  assert.equal(message.includes("\n"), false);

  const actual = __test.buildSquadRosterMessage(players.slice(0, 2), 180, "actual");
  assert.equal(actual.split("\n").length, 2);
}

try {
  await testClockThresholdsAndEscapedNewlines();
  await testNewRoundResetsDispatch();
  await testManualNonceTriggersOnlyOnce();
  testFireTeamEvidenceAndOnlineMerge();
  testLongMessagePreservesEncodedLines();
  console.log("Round playtime roster warning tests passed successfully!");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
