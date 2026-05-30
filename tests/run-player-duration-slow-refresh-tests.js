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

async function testSequentialRefresh() {
  const logs = [];
  const updates = [];
  const lookups = [];
  let activeLookups = 0;
  let sleepCalls = 0;
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
    async updateGameDuration(playerId, seconds) {
      updates.push({ playerId, seconds });
      return { id: playerId, game_seconds: seconds };
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

  const sleep = async () => {
    sleepCalls += 1;
    if (sleepCalls === 2) {
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

  await waitFor(() => lookups.length === 1);
  assert.equal(activeLookups, 1);
  assert.equal(updates.length, 0);

  first.resolve({ gameSeconds: 3661 });
  await waitFor(() => updates.length === 1);
  assert.equal(updates[0].playerId, 1);
  assert.equal(updates[0].seconds, 3661);

  await waitFor(() => lookups.length === 2);
  assert.equal(activeLookups, 1);

  second.resolve({ gameSeconds: 7200 });
  await waitFor(() => !plugin.getState().running);

  const state = plugin.getState();
  assert.equal(state.round, 1);
  assert.deepEqual(state.refreshedThisRound, [1, 2]);
  assert.equal(state.totalSuccess, 2);
  assert.equal(state.totalFailed, 0);
  assert.equal(state.currentPlayerId, null);
  assert.equal(state.currentSteamID, null);
  assert.equal(logs.some((entry) => entry.message.includes("玩家时长慢速刷新插件已启动")), true);
  assert.equal(logs.some((entry) => entry.message.includes("开始第 1 轮玩家时长刷新")), true);
  assert.equal(logs.some((entry) => entry.message.includes("玩家时长刷新成功：Alpha steam=111 seconds=3661 hours=1.0")), true);
  assert.equal(logs.some((entry) => entry.message.includes("第 1 轮玩家时长刷新结束，完成=2/2")), true);
  assert.equal(logs.some((entry) => entry.message.includes("玩家时长慢速刷新插件已停止")), true);
}

async function testSkipNoSteamID() {
  const logs = [];
  const updates = [];
  let sleepCalls = 0;
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
    async lookupSteamID() {
      return { gameSeconds: 1234 };
    },
  };

  const sleep = async () => {
    sleepCalls += 1;
    if (sleepCalls === 2) {
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
  assert.equal(logs.some((entry) => entry.message.includes("玩家无 SteamID 跳过：Ghost")), true);
}

await testSequentialRefresh();
await testSkipNoSteamID();

console.log("player duration slow refresh tests passed");
