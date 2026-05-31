import assert from "node:assert/strict";

import { createPlugin as createPjscAverageDurationPlugin } from "../plugins/pjsc-average-duration.js";

function createHarness({ onlinePlayers, playerRows }) {
  const registeredPages = [];
  const broadcasts = [];
  const subscribedTypes = [];

  const rowMap = new Map(
    (playerRows ?? []).map((row) => [String(row.steam_id ?? row.steamID ?? row.steamId), row]),
  );

  const playerRepository = {
    async listPlayersByIdentities({ steamIDs = [] } = {}) {
      return steamIDs
        .map((steamID) => rowMap.get(String(steamID)))
        .filter(Boolean);
    },

    async listPlayersBySteamIDs(steamIDs = []) {
      return steamIDs
        .map((steamID) => rowMap.get(String(steamID)))
        .filter(Boolean);
    },
  };

  const plugin = createPjscAverageDurationPlugin({
    core: {
      logger: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } },
      runtimeState: {
        getMatch() {
          return {
            teams: [
              { teamID: 1, teamName: "49th Combined Arms Army" },
              { teamID: 2, teamName: "1st Marine Division" },
            ],
          };
        },
      },
      webRegistry: {
        registerPage(page) {
          registeredPages.push(page);
        },
      },
    },
    modules: {
      adminWarn: {
        async sendAdminBroadcast(request) {
          broadcasts.push(request);
          return {
            success: true,
            skipped: false,
            commandText: `AdminBroadcast ${request.message}`,
          };
        },
      },
      chatManager: {
        on(type) {
          subscribedTypes.push(type);
          return () => {};
        },
      },
      matchState: {
        getOverview() {
          return { matchState: { players: { list: onlinePlayers } } };
        },
      },
    },
    playerRepository,
    config: {
      get(pathText, defaultValue) {
        if (pathText === "plugins.pjscAverageDuration") {
          return {
            enabled: true,
            triggerKeyword: "pjsc",
            historyLimit: 20,
          };
        }
        return defaultValue;
      },
    },
  });

  return { plugin, registeredPages, broadcasts, subscribedTypes };
}

async function testBroadcastIncludesOverallAndTeamSummaries() {
  const { plugin, registeredPages, broadcasts, subscribedTypes } = createHarness({
    onlinePlayers: [
      { name: "Alpha", steamID: "1", eosID: "eos-1", teamID: 1, isLeader: true },
      { name: "Bravo", steamID: "2", eosID: "eos-2", teamID: 1, isLeader: false },
      { name: "Charlie", steamID: "3", eosID: "eos-3", teamID: 2, isLeader: true },
      { name: "Delta", steamID: "4", eosID: "eos-4", teamID: 2, isLeader: false },
      { name: "Echo", steamID: "5", eosID: "eos-5", teamID: 2, isLeader: false },
    ],
    playerRows: [
      { current_name: "Alpha", steam_id: "1", eos_id: "eos-1", game_seconds: 10 * 3600, updated_at: 1 },
      { current_name: "Bravo", steam_id: "2", eos_id: "eos-2", game_seconds: 20 * 3600, updated_at: 1 },
      { current_name: "Charlie", steam_id: "3", eos_id: "eos-3", game_seconds: 30 * 3600, updated_at: 1 },
      { current_name: "Delta", steam_id: "4", eos_id: "eos-4", game_seconds: 0, updated_at: 1 },
      { current_name: "Echo", steam_id: "5", eos_id: "eos-5", game_seconds: 40 * 3600, updated_at: 1 },
    ],
  });

  await plugin.start();

  assert.equal(registeredPages.length, 1);
  assert.equal(registeredPages[0].route, "/debug/pjsc-average-duration");
  assert.deepEqual(subscribedTypes, ["message", "command"]);

  const result = await plugin.api.simulateChatMessage({
    message: "pjsc",
    steamID: "999",
    playerName: "Tester",
    teamID: 1,
    squadID: 1,
  });

  assert.equal(result.matched, true);
  assert.equal(broadcasts.length, 3);
  assert.equal(
    broadcasts[0].message,
    "当前在线 5 人，公开时长 4 人，未公开 1 人，平均时长 25.0 小时",
  );
  assert.equal(
    broadcasts[1].message,
    "Team1 49th Combined Arms Army 平均时长 15.0 小时，队长平均时长 10.0 小时",
  );
  assert.equal(
    broadcasts[2].message,
    "Team2 1st Marine Division 平均时长 35.0 小时，队长平均时长 30.0 小时",
  );

  const state = plugin.api.getState();
  assert.equal(state.triggerCount, 1);
  assert.equal(state.broadcastCount, 1);
  assert.equal(state.history[0].kind, "broadcast");
  assert.equal(state.history[1].kind, "trigger");
  assert.equal(state.lastSummary.totalOnline, 5);
  assert.equal(state.lastSummary.publicCount, 4);
  assert.equal(state.lastSummary.privateCount, 1);
  assert.equal(state.lastSummary.averageHours, 25);
  assert.equal(state.lastSummary.teams[0].teamName, "49th Combined Arms Army");
  assert.equal(state.lastSummary.teams[0].averageHours, 15);
  assert.equal(state.lastSummary.teams[0].leaderAverageHours, 10);
  assert.equal(state.lastSummary.teams[1].teamName, "1st Marine Division");
  assert.equal(state.lastSummary.teams[1].averageHours, 35);
  assert.equal(state.lastSummary.teams[1].leaderAverageHours, 30);
  assert.equal(state.lastSummary.teams[1].leaderCount, 1);
  assert.equal(state.lastSummary.items[3].hasPublicPlaytime, false);
  assert.equal(state.lastBroadcastResult.results.length, 3);

  await plugin.stop();
}

async function testNoPublicPlaytimeDoesNotPretendZeroHours() {
  const { plugin, broadcasts } = createHarness({
    onlinePlayers: [
      { name: "Delta", steamID: "4", eosID: "eos-4", teamID: 1, isLeader: true },
      { name: "Echo", steamID: "5", eosID: "eos-5", teamID: 2, isLeader: true },
    ],
    playerRows: [
      { current_name: "Delta", steam_id: "4", eos_id: "eos-4", game_seconds: 0, updated_at: 1 },
    ],
  });

  await plugin.start();

  const result = await plugin.api.simulateChatMessage({
    message: "avg",
    steamID: "999",
    playerName: "Tester",
  });

  assert.equal(result.matched, true);
  assert.equal(broadcasts.length, 3);
  assert.equal(
    broadcasts[0].message,
    "当前在线 2 人，公开时长 0 人，未公开 2 人，无法计算平均时长",
  );
  assert.equal(
    broadcasts[1].message,
    "Team1 49th Combined Arms Army 平均时长 0.0 小时，队长平均时长 0.0 小时",
  );
  assert.equal(
    broadcasts[2].message,
    "Team2 1st Marine Division 平均时长 0.0 小时，队长平均时长 0.0 小时",
  );

  const state = plugin.api.getState();
  assert.equal(state.lastSummary.publicCount, 0);
  assert.equal(state.lastSummary.privateCount, 2);
  assert.equal(state.lastSummary.averageHours, null);
  assert.equal(state.lastSummary.averageSeconds, null);
  assert.equal(state.lastSummary.teams[0].averageHours, null);
  assert.equal(state.lastSummary.teams[1].leaderAverageHours, null);
  assert.equal(broadcasts[0].message.includes("0.0 小时"), false);

  await plugin.stop();
}

await testBroadcastIncludesOverallAndTeamSummaries();
await testNoPublicPlaytimeDoesNotPretendZeroHours();

console.log("pjsc average duration tests passed");
