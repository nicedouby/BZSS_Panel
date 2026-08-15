import assert from "node:assert/strict";

import { createPlugin } from "../plugins/player_duration_slow_refresh.js";

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

async function waitFor(predicate, timeoutMs = 2000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function createLogger(logs = []) {
  return {
    child() {
      return this;
    },
    info(message) {
      logs.push({ level: "info", message: String(message) });
    },
    warn(message) {
      logs.push({ level: "warn", message: String(message) });
    },
    error(message) {
      logs.push({ level: "error", message: String(message) });
    },
  };
}

function createMatchState(players = []) {
  return {
    getOverview() {
      return {
        matchState: {
          revision: 1,
          updatedAt: "2026-08-16T00:00:00Z",
          players,
        },
        players,
      };
    },
  };
}

async function runOneIterationPlugin({
  players = [],
  repo,
  service,
  expectedSleepMs = null,
} = {}) {
  const logs = [];
  const sleeps = [];
  let plugin = null;

  const sleep = async (ms) => {
    sleeps.push(ms);
    await plugin.stop();
  };

  plugin = createPlugin({
    modules: { matchState: createMatchState(players) },
    playerRepository: repo,
    steamGameDurationService: service,
    logger: createLogger(logs),
    sleep,
  });

  await plugin.start();
  await waitFor(() => !plugin.getState().running);

  if (expectedSleepMs != null) {
    assert.equal(sleeps[0], expectedSleepMs);
  }
  return { plugin, state: plugin.getState(), logs, sleeps };
}

async function testFreshPlaytimeIsNotRefreshed() {
  const steamID = "76561198000000101";
  const now = Date.now();
  let lookupCount = 0;
  let fullRefreshCount = 0;

  const repo = {
    async listPlayersWithSteamID(options = {}) {
      assert.deepEqual(options, { order: "DESC" });
      return [];
    },
    async findByIdentity() {
      return { id: 101, current_name: "Fresh", steam_id: steamID };
    },
    async updateGameDuration() {
      throw new Error("fresh playtime must not write duration");
    },
  };

  const service = {
    async getBySteamID(id) {
      assert.equal(id, steamID);
      return { steamID: id, gameSeconds: 3600, fetchedAt: now - HOUR_MS };
    },
    async lookupSteamID() {
      lookupCount += 1;
      throw new Error("fresh playtime must not hit Steam");
    },
    async refreshPlayer() {
      fullRefreshCount += 1;
      throw new Error("fresh playtime must not run full refresh");
    },
  };

  const { state } = await runOneIterationPlugin({
    players: [{ name: "Fresh", steamID, eosID: "eos-fresh" }],
    repo,
    service,
    expectedSleepMs: 300_000,
  });

  assert.equal(lookupCount, 0);
  assert.equal(fullRefreshCount, 0);
  assert.equal(state.totalSuccess, 0);
  assert.equal(state.totalSkippedFreshPlaytime >= 1, true);
  assert.equal(state.policy.playtimeRefreshCooldownMs, 10 * HOUR_MS);
  assert.equal(state.policy.profileRefreshCooldownMs, 24 * HOUR_MS);
  assert.equal(state.policy.databasePlayerInactiveCutoffMs, 15 * DAY_MS);
}

async function testStalePlaytimeWithFreshProfileUsesPlaytimeOnly() {
  const steamID = "76561198000000102";
  const now = Date.now();
  let fetchedAt = now - 11 * HOUR_MS;
  let lookupCount = 0;
  let fullRefreshCount = 0;
  const updates = [];

  const repo = {
    async findByIdentity() {
      return { id: 102, current_name: "PlaytimeOnly", steam_id: steamID };
    },
    async getPlayerDetail(playerId) {
      assert.equal(playerId, 102);
      return {
        steamProfile: {
          profile_state: "ready",
          last_success_at: now - HOUR_MS,
        },
      };
    },
    async updateGameDuration(playerId, seconds) {
      updates.push({ playerId, seconds });
      return { id: playerId, game_seconds: seconds };
    },
    async listPlayersWithSteamID() {
      throw new Error("database fallback should not run before the current player refresh completes");
    },
  };

  const service = {
    async getBySteamID(id) {
      assert.equal(id, steamID);
      return { steamID: id, gameSeconds: 3600, fetchedAt };
    },
    async lookupSteamID(id) {
      assert.equal(id, steamID);
      lookupCount += 1;
      fetchedAt = Date.now();
      return { steamID: id, gameSeconds: 7200, fetchedAt };
    },
    async refreshPlayer() {
      fullRefreshCount += 1;
      throw new Error("fresh Steam profile must not run full refresh");
    },
  };

  const { state } = await runOneIterationPlugin({
    players: [{ name: "PlaytimeOnly", steamID, eosID: "eos-playtime" }],
    repo,
    service,
    expectedSleepMs: 15_000,
  });

  assert.equal(lookupCount, 1);
  assert.equal(fullRefreshCount, 0);
  assert.deepEqual(updates, [{ playerId: 102, seconds: 7200 }]);
  assert.equal(state.totalSuccess, 1);
  assert.equal(state.totalProfileRefreshes, 0);
}

async function testStaleProfileUsesFullRefresh() {
  const steamID = "76561198000000103";
  const now = Date.now();
  let refreshed = false;
  let lookupCount = 0;
  let fullRefreshCount = 0;

  const repo = {
    async findByIdentity() {
      return { id: 103, current_name: "FullRefresh", steam_id: steamID };
    },
    async getPlayerDetail(playerId) {
      assert.equal(playerId, 103);
      return {
        steamProfile: {
          profile_state: "ready",
          last_success_at: now - 25 * HOUR_MS,
        },
      };
    },
    async updateGameDuration() {
      throw new Error("full refresh owns the duration write");
    },
    async listPlayersWithSteamID() {
      throw new Error("database fallback should not run before the current player refresh completes");
    },
  };

  const completedJob = {
    id: "job-full-refresh",
    status: "completed",
    result: { lookup: { steamID, gameSeconds: 9000 } },
  };

  const service = {
    async getBySteamID(id) {
      assert.equal(id, steamID);
      return refreshed
        ? { steamID: id, gameSeconds: 9000, fetchedAt: Date.now() }
        : { steamID: id, gameSeconds: 3600, fetchedAt: now - 11 * HOUR_MS };
    },
    async lookupSteamID() {
      lookupCount += 1;
      throw new Error("stale profile should use the full refresh path");
    },
    async refreshPlayer(payload) {
      assert.equal(payload.steamID, steamID);
      fullRefreshCount += 1;
      refreshed = true;
      return completedJob;
    },
    async waitForJob(jobId) {
      assert.equal(jobId, completedJob.id);
      return completedJob;
    },
  };

  const { state } = await runOneIterationPlugin({
    players: [{ name: "FullRefresh", steamID, eosID: "eos-full" }],
    repo,
    service,
    expectedSleepMs: 15_000,
  });

  assert.equal(lookupCount, 0);
  assert.equal(fullRefreshCount, 1);
  assert.equal(state.totalSuccess, 1);
  assert.equal(state.totalProfileRefreshes, 1);
  assert.equal(state.lastGameSeconds, 9000);
}

async function testInactiveDatabasePlayerIsSkippedBySessionHistory() {
  const steamID = "76561198000000104";
  const now = Date.now();
  let lookupCount = 0;
  let aliasReadCount = 0;

  const repo = {
    async listPlayersWithSteamID(options = {}) {
      assert.deepEqual(options, { order: "DESC" });
      return [{
        id: 104,
        current_name: "OldPlayer",
        steam_id: steamID,
        // Deliberately recent: non-presence writes must not keep the player alive.
        updated_at: now,
      }];
    },
    async listPlayerSessionHistory(playerId, options = {}) {
      assert.equal(playerId, 104);
      assert.deepEqual(options, { limit: 1, offset: 0 });
      return [{ joined_at: now - 16 * DAY_MS }];
    },
    async listPlayerAliases() {
      aliasReadCount += 1;
      return [{ seen_at: now }];
    },
    async updateGameDuration() {
      throw new Error("inactive player must not be refreshed");
    },
  };

  const service = {
    async getBySteamID(id) {
      assert.equal(id, steamID);
      return { steamID: id, gameSeconds: 100, fetchedAt: now - 20 * DAY_MS };
    },
    async lookupSteamID() {
      lookupCount += 1;
      throw new Error("inactive player must not hit Steam");
    },
  };

  const { state } = await runOneIterationPlugin({
    players: [],
    repo,
    service,
    expectedSleepMs: 300_000,
  });

  assert.equal(lookupCount, 0);
  assert.equal(aliasReadCount, 0, "session history must take precedence over alias timestamps");
  assert.equal(state.totalSkippedInactive, 1);
  assert.deepEqual(state.inactiveDatabaseSteamIDs, [steamID]);
}

async function testRecentDatabasePlayerCanRefresh() {
  const steamID = "76561198000000105";
  const now = Date.now();
  let fetchedAt = now - 20 * HOUR_MS;
  const updates = [];

  const repo = {
    async listPlayersWithSteamID(options = {}) {
      assert.deepEqual(options, { order: "DESC" });
      return [{ id: 105, current_name: "RecentPlayer", steam_id: steamID }];
    },
    async listPlayerSessionHistory() {
      return [{ joined_at: now - 2 * DAY_MS }];
    },
    async getPlayerDetail() {
      return {
        steamProfile: {
          profile_state: "ready",
          last_success_at: now - 2 * HOUR_MS,
        },
      };
    },
    async updateGameDuration(playerId, seconds) {
      updates.push({ playerId, seconds });
      return { id: playerId, game_seconds: seconds };
    },
  };

  const service = {
    async getBySteamID() {
      return { steamID, gameSeconds: 100, fetchedAt };
    },
    async lookupSteamID() {
      fetchedAt = Date.now();
      return { steamID, gameSeconds: 5000, fetchedAt };
    },
  };

  const { state } = await runOneIterationPlugin({
    players: [],
    repo,
    service,
    expectedSleepMs: 120_000,
  });

  assert.deepEqual(updates, [{ playerId: 105, seconds: 5000 }]);
  assert.equal(state.totalSuccess, 1);
  assert.equal(state.totalSkippedInactive, 0);
  assert.equal(state.refreshTaggedAtBySteamID[steamID] > 0, true);
}

await testFreshPlaytimeIsNotRefreshed();
await testStalePlaytimeWithFreshProfileUsesPlaytimeOnly();
await testStaleProfileUsesFullRefresh();
await testInactiveDatabasePlayerIsSkippedBySessionHistory();
await testRecentDatabasePlayerCanRefresh();

console.log("player duration slow refresh cache-policy tests passed");
