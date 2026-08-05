import assert from "node:assert/strict";
import { createPlugin, __test } from "../plugins/steam-playtime-publicity-reminder.js";

function createHarness() {
  const warnings = [];
  const broadcasts = [];
  const clock = { seconds: 0, key: "round-a" };
  const playtimes = new Map();
  const now = 1_000_000;

  const players = [
    { playerID: 1, name: "PrivateLeader", steamID: "1001", eosID: "e1", teamID: 1, squadID: 1, isLeader: true, online: true },
    { playerID: 2, name: "PrivateMember2", steamID: "1002", eosID: "e2", teamID: 1, squadID: 1, isLeader: false, online: true },
    { playerID: 3, name: "PublicLeader", steamID: "1003", eosID: "e3", teamID: 1, squadID: 2, isLeader: true, online: true },
    { playerID: 4, name: "NewLeader", steamID: "1004", eosID: "e4", teamID: 1, squadID: 3, isLeader: true, online: true },
    { playerID: 5, name: "UnrefreshedZeroLeader", steamID: "1005", eosID: "e5", teamID: 2, squadID: 1, isLeader: true, online: true },
    { playerID: 6, name: "PrivateMember6", steamID: "1006", eosID: "e6", teamID: 2, squadID: 1, isLeader: false, online: true },
    { playerID: 7, name: "PrivateMember7", steamID: "1007", eosID: "e7", teamID: 2, squadID: 2, isLeader: false, online: true },
    { playerID: 8, name: "PrivateMember8", steamID: "1008", eosID: "e8", teamID: 2, squadID: 2, isLeader: false, online: true },
    { playerID: 9, name: "PrivateMember9", steamID: "1009", eosID: "e9", teamID: 2, squadID: 3, isLeader: false, online: true },
    { playerID: 10, name: "PrivateMember10", steamID: "1010", eosID: "e10", teamID: 2, squadID: 3, isLeader: false, online: true },
  ];

  for (const player of players) {
    if ([1, 2, 6, 7, 8, 9, 10].includes(player.playerID)) {
      playtimes.set(player.steamID, { steam_game_seconds: 0, fetched_at: 123456 });
    }
  }
  playtimes.set("1003", { steam_game_seconds: 3600, fetched_at: 123456 });
  playtimes.set("1005", { steam_game_seconds: 0, fetched_at: null });

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
    logger: { info() {}, warn() {}, debug() {}, error() {} },
  };

  const matchState = {
    serverId: "test-server",
    round: { current: { dedupeKey: clock.key } },
    players: { list: players },
  };

  const modules = {
    pluginSubscriptions: { isSubscribed() { return true; } },
    matchState: {
      getState() { return matchState; },
      getRoundState() { return { current: { dedupeKey: clock.key } }; },
      getOverview() { return { status: core.webStatus.getSnapshot(), matchState, players }; },
    },
    playerState: { getPlayerList() { return players; } },
    playtime: {
      async getBySteamID(steamID) {
        return playtimes.get(steamID) ?? null;
      },
    },
    adminWarn: {
      async warnPlayer(request) {
        warnings.push({ ...request });
        return { success: true };
      },
      async sendAdminBroadcast(request) {
        broadcasts.push({ ...request });
        return { success: true };
      },
    },
  };

  const config = {
    get(key, fallback) {
      if (key === "plugins.steam-playtime-publicity-reminder") {
        return {
          enabled: true,
          startAfterSeconds: 300,
          pollIntervalMs: 30000,
          leaderWarningIntervalMs: 10000,
          broadcastBatchSize: 5,
          broadcastBatchIntervalMs: 120000,
          broadcastCycleCooldownMs: 600000,
        };
      }
      return fallback;
    },
  };

  return {
    plugin: createPlugin({ core, modules, config }),
    players,
    playtimes,
    clock,
    warnings,
    broadcasts,
    now,
  };
}

async function testPrivateDetectionRequiresCompletedRefresh() {
  assert.equal(__test.isConfirmedPrivatePlaytimeRow(null), false);
  assert.equal(__test.isConfirmedPrivatePlaytimeRow({ steam_game_seconds: 0 }), false);
  assert.equal(__test.isConfirmedPrivatePlaytimeRow({ steam_game_seconds: 0, fetched_at: 100 }), true);
  assert.equal(__test.isConfirmedPrivatePlaytimeRow({ steam_game_seconds: 1, fetched_at: 100 }), false);
}

async function testWarningAndBroadcastSchedule() {
  const h = createHarness();

  h.clock.seconds = 299;
  await h.plugin.api.evaluateNow(h.now);
  assert.equal(h.warnings.length, 0);
  assert.equal(h.broadcasts.length, 0);

  h.clock.seconds = 300;
  await h.plugin.api.evaluateNow(h.now);
  assert.equal(h.warnings.length, 1);
  assert.equal(h.warnings[0].targetName, "PrivateLeader");
  assert.equal(
    h.warnings[0].message,
    "你的steam个人资料尚未公开\n为了其他玩家的游戏体验，请公开你的steam个人资料",
  );
  assert.equal(h.broadcasts.length, 1);
  assert.equal(h.broadcasts[0].message, "当前未公开steam个人资料的玩家有\n1  2  6  7  8");

  await h.plugin.api.evaluateNow(h.now + 9_999);
  assert.equal(h.warnings.length, 1);
  assert.equal(h.broadcasts.length, 1);

  await h.plugin.api.evaluateNow(h.now + 10_000);
  assert.equal(h.warnings.length, 2);
  assert.equal(h.broadcasts.length, 1);

  await h.plugin.api.evaluateNow(h.now + 120_000);
  assert.equal(h.warnings.length, 3);
  assert.equal(h.broadcasts.length, 2);
  assert.equal(h.broadcasts[1].message, "当前未公开steam个人资料的玩家有\n9  10");

  // A complete cycle cools down for ten minutes from the final batch.
  await h.plugin.api.evaluateNow(h.now + 120_000 + 599_999);
  assert.equal(h.broadcasts.length, 2);
  await h.plugin.api.evaluateNow(h.now + 120_000 + 600_000);
  assert.equal(h.broadcasts.length, 3);
}

async function testWarningStopsWhenLocalCacheBecomesPublic() {
  const h = createHarness();
  h.clock.seconds = 300;
  await h.plugin.api.evaluateNow(h.now);
  assert.equal(h.warnings.length, 1);

  h.playtimes.set("1001", { steam_game_seconds: 7200, fetched_at: 200000 });
  await h.plugin.api.evaluateNow(h.now + 10_000);
  assert.equal(h.warnings.length, 1);
}

async function testNewRoundRestartsImmediateFiveMinuteEvaluation() {
  const h = createHarness();
  h.clock.seconds = 300;
  await h.plugin.api.evaluateNow(h.now);
  assert.equal(h.warnings.length, 1);
  assert.equal(h.broadcasts.length, 1);

  h.clock.key = "round-b";
  h.clock.seconds = 300;
  await h.plugin.api.evaluateNow(h.now + 1_000);
  assert.equal(h.warnings.length, 2);
  assert.equal(h.broadcasts.length, 2);
}

try {
  await testPrivateDetectionRequiresCompletedRefresh();
  await testWarningAndBroadcastSchedule();
  await testWarningStopsWhenLocalCacheBecomesPublic();
  await testNewRoundRestartsImmediateFiveMinuteEvaluation();
  console.log("Steam playtime publicity reminder tests passed successfully!");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
