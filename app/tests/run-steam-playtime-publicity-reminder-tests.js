import assert from "node:assert/strict";
import { createPlugin, __test } from "../plugins/steam-playtime-publicity-reminder.js";

function createHarness() {
  const warnings = [];
  const broadcasts = [];
  const clock = { seconds: 0, key: "round-a" };
  const playtimes = new Map();
  const now = 1_000_000;
  let localCacheReads = 0;
  let steamApiLookups = 0;

  const runtimeConfig = {
    enabled: true,
    featureEnabled: true,
    startAfterSeconds: 300,
    pollIntervalMs: 1000,
    leaderWarningIntervalMs: 10000,
    broadcastBatchSize: 5,
    broadcastBatchIntervalMs: 120000,
    broadcastCycleCooldownMs: 600000,
  };

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
        localCacheReads += 1;
        return playtimes.get(steamID) ?? null;
      },
      async lookupSteamID() {
        steamApiLookups += 1;
        throw new Error("publicity reminder must not request Steam API");
      },
      async refreshPlayer() {
        steamApiLookups += 1;
        throw new Error("publicity reminder must not refresh Steam player");
      },
      async refreshOnline() {
        steamApiLookups += 1;
        throw new Error("publicity reminder must not refresh Steam online roster");
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
        return runtimeConfig;
      }
      return fallback;
    },
  };

  return {
    plugin: createPlugin({ core, modules, config }),
    players,
    playtimes,
    runtimeConfig,
    clock,
    warnings,
    broadcasts,
    now,
    getLocalCacheReads: () => localCacheReads,
    getSteamApiLookups: () => steamApiLookups,
  };
}

function broadcastNames(message) {
  const lines = String(message ?? "").split("\n");
  return String(lines[1] ?? "").split(/\s{2,}/u).map((value) => value.trim()).filter(Boolean);
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
  assert.equal(h.getSteamApiLookups(), 0);

  h.clock.seconds = 300;
  await h.plugin.api.evaluateNow(h.now);
  assert.equal(h.warnings.length, 1);
  assert.equal(h.warnings[0].targetName, "PrivateLeader");
  assert.equal(
    h.warnings[0].message,
    "你的steam个人资料尚未公开\n为了其他玩家的游戏体验，请公开你的steam个人资料",
  );
  assert.equal(h.broadcasts.length, 1);
  assert.match(h.broadcasts[0].message, /^当前未公开steam个人资料的玩家有\n/u);
  assert.equal(broadcastNames(h.broadcasts[0].message).length, 5);
  assert.equal(h.getSteamApiLookups(), 0);

  const readsAfterFirstTick = h.getLocalCacheReads();
  await h.plugin.api.evaluateNow(h.now + 9_999);
  assert.equal(h.warnings.length, 1);
  assert.equal(h.broadcasts.length, 1);
  assert.equal(h.getLocalCacheReads(), readsAfterFirstTick, "leader cache should not be reread every 1 second poll");
  assert.equal(h.getSteamApiLookups(), 0);

  await h.plugin.api.evaluateNow(h.now + 10_000);
  assert.equal(h.warnings.length, 2);
  assert.equal(h.broadcasts.length, 1);
  assert.equal(h.getSteamApiLookups(), 0);

  await h.plugin.api.evaluateNow(h.now + 120_000);
  assert.equal(h.warnings.length, 3);
  assert.equal(h.broadcasts.length, 2);
  assert.equal(broadcastNames(h.broadcasts[1].message).length, 2);

  const allBroadcastNames = [
    ...broadcastNames(h.broadcasts[0].message),
    ...broadcastNames(h.broadcasts[1].message),
  ].sort();
  assert.deepEqual(allBroadcastNames, [
    "PrivateLeader",
    "PrivateMember10",
    "PrivateMember2",
    "PrivateMember6",
    "PrivateMember7",
    "PrivateMember8",
    "PrivateMember9",
  ].sort());
  assert.equal(h.getSteamApiLookups(), 0);

  // A complete cycle cools down for ten minutes from the final batch.
  await h.plugin.api.evaluateNow(h.now + 120_000 + 599_999);
  assert.equal(h.broadcasts.length, 2);
  await h.plugin.api.evaluateNow(h.now + 120_000 + 600_000);
  assert.equal(h.broadcasts.length, 3);
  assert.equal(h.getSteamApiLookups(), 0);
}

async function testWarningStopsWhenLocalCacheBecomesPublic() {
  const h = createHarness();
  h.clock.seconds = 300;
  await h.plugin.api.evaluateNow(h.now);
  assert.equal(h.warnings.length, 1);

  h.playtimes.set("1001", { steam_game_seconds: 7200, fetched_at: 200000 });
  await h.plugin.api.evaluateNow(h.now + 10_000);
  assert.equal(h.warnings.length, 1);
  assert.equal(h.getSteamApiLookups(), 0);
}

async function testFeatureCanBeDisabledAndReenabledAtRuntime() {
  const h = createHarness();
  h.clock.seconds = 300;

  h.runtimeConfig.featureEnabled = false;
  await h.plugin.api.evaluateNow(h.now);
  assert.equal(h.warnings.length, 0);
  assert.equal(h.broadcasts.length, 0);
  assert.equal(h.getLocalCacheReads(), 0, "disabled feature must not scan local playtime cache");
  assert.equal(h.getSteamApiLookups(), 0);
  assert.equal(h.plugin.api.getState().active, false);

  h.runtimeConfig.featureEnabled = true;
  await h.plugin.api.evaluateNow(h.now + 1000);
  assert.equal(h.warnings.length, 1);
  assert.equal(h.broadcasts.length, 1);
  assert.equal(h.plugin.api.getState().active, true);
  assert.equal(h.getSteamApiLookups(), 0);
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
  assert.equal(h.getSteamApiLookups(), 0);
}

try {
  await testPrivateDetectionRequiresCompletedRefresh();
  await testWarningAndBroadcastSchedule();
  await testWarningStopsWhenLocalCacheBecomesPublic();
  await testFeatureCanBeDisabledAndReenabledAtRuntime();
  await testNewRoundRestartsImmediateFiveMinuteEvaluation();
  console.log("Steam playtime publicity reminder tests passed successfully!");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
