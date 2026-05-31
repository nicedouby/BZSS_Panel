import assert from "node:assert/strict";

import { createPlugin } from "../plugins/player_duration_slow_refresh.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function createLogger(logs) {
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

async function testCurrentMatchPriorityAndCooldown() {
  const logs = [];
  const updates = [];
  const lookups = [];
  const sleepIntervals = [];
  let activeLookups = 0;
  let plugin = null;

  const first = deferred();
  const second = deferred();

  const repo = {
    async listPlayersWithSteamID() {
      return [
        { id: 1, current_name: "Alpha", steam_id: "111" },
        { id: 2, current_name: "Bravo", steam_id: "222" },
      ];
    },
    async upsertFromPresence({ name, steamID, eosID }) {
      return {
        id: steamID === "111" ? 1 : 2,
        current_name: name,
        steam_id: steamID,
        eos_id: eosID,
      };
    },
    async updateGameDuration(playerId, seconds) {
      updates.push({ playerId, seconds });
      return { id: playerId, game_seconds: seconds };
    },
  };

  const matchState = {
    getOverview() {
      return {
        players: [{ name: "Alpha", steamID: "111", eosID: "eos-111" }],
      };
    },
  };

  const service = {
    async lookupSteamID(steamID) {
      lookups.push(steamID);
      activeLookups += 1;
      assert.equal(activeLookups, 1);
      try {
        if (steamID === "111") return await first.promise;
        if (steamID === "222") return await second.promise;
        throw new Error(`Unexpected steamID: ${steamID}`);
      } finally {
        activeLookups -= 1;
      }
    },
  };

  const sleep = async (ms) => {
    sleepIntervals.push(ms);
    if (sleepIntervals.length === 2) {
      await plugin.stop();
    }
  };

  plugin = createPlugin({
    modules: { matchState },
    playerRepository: repo,
    steamGameDurationService: service,
    logger: createLogger(logs),
    sleep,
  });

  await plugin.start();

  await waitFor(() => lookups.length === 1);
  assert.equal(activeLookups, 1);
  assert.equal(lookups[0], "111");

  first.resolve({ gameSeconds: 3661 });
  await waitFor(() => updates.length === 1);
  assert.equal(updates[0].playerId, 1);
  assert.equal(updates[0].seconds, 3661);

  await waitFor(() => lookups.length === 2);
  assert.equal(lookups[1], "222");
  assert.equal(activeLookups, 1);

  second.resolve({ gameSeconds: 7200 });
  await waitFor(() => !plugin.getState().running);

  const state = plugin.getState();
  assert.equal(state.round, 2);
  assert.deepEqual(state.refreshedThisRound, [1, 2]);
  assert.equal(state.totalSuccess, 2);
  assert.equal(state.totalFailed, 0);
  assert.equal(state.currentPlayerId, null);
  assert.equal(state.currentSteamID, null);
  assert.equal(state.currentSource, null);
  assert.equal(state.lastSelectedSource, "database");
  assert.equal(state.lastDelayMs, 60_000);
  assert.deepEqual(sleepIntervals, [10_000, 60_000]);
  assert.equal(state.refreshTaggedAtBySteamID["111"] > 0, true);
  assert.equal(state.refreshTaggedAtBySteamID["222"] > 0, true);
  assert.equal(logs.some((entry) => entry.message.includes("玩家时长慢速刷新插件已启动")), true);
  assert.equal(logs.some((entry) => entry.message.includes("当前对局玩家时长")), true);
  assert.equal(logs.some((entry) => entry.message.includes("source=current-match")), true);
  assert.equal(logs.some((entry) => entry.message.includes("source=database")), true);
  assert.equal(logs.some((entry) => entry.message.includes("玩家时长慢速刷新插件已停止")), true);
}

async function testSkipNoSteamID() {
  const logs = [];
  const updates = [];
  const lookups = [];
  const sleepIntervals = [];
  let plugin = null;

  const repo = {
    async listPlayersWithSteamID() {
      return [
        { id: 11, current_name: "Ghost", steam_id: "" },
        { id: 12, current_name: "Delta", steam_id: "333" },
      ];
    },
    async updateGameDuration(playerId, seconds) {
      updates.push({ playerId, seconds });
      return { id: playerId, game_seconds: seconds };
    },
  };

  const service = {
    async lookupSteamID(steamID) {
      lookups.push(steamID);
      return { gameSeconds: 1234 };
    },
  };

  const sleep = async (ms) => {
    sleepIntervals.push(ms);
    if (sleepIntervals.length === 2) {
      await plugin.stop();
    }
  };

  plugin = createPlugin({
    playerRepository: repo,
    steamGameDurationService: service,
    logger: createLogger(logs),
    sleep,
  });

  await plugin.start();
  await waitFor(() => !plugin.getState().running);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].playerId, 12);
  assert.equal(updates[0].seconds, 1234);
  assert.deepEqual(lookups, ["333"]);
  assert.deepEqual(sleepIntervals, [60_000, 60_000]);
  assert.equal(logs.some((entry) => entry.message.includes("第 2 轮没有可刷新的玩家")), true);
}

await testCurrentMatchPriorityAndCooldown();
await testSkipNoSteamID();

console.log("player duration slow refresh tests passed");
