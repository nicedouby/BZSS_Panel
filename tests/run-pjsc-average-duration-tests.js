import assert from "node:assert/strict";

import { createPlugin as createPjscAverageDurationPlugin } from "../plugins/pjsc-average-duration.js";

function createHarness() {
  const registeredPages = [];
  const broadcasts = [];

  const playtimes = new Map([
    ["1", 10 * 3600],
    ["2", 20 * 3600],
    ["3", 30 * 3600],
    ["4", 40 * 3600],
    ["5", 12 * 3600],
    ["6", 18 * 3600],
  ]);

  const match = {
    teams: [
      {
        teamID: 1,
        teamName: "Team 1",
        squads: [
          {
            squadID: 1,
            members: [
              { name: "T1-Leader-A", steamID: "1", teamID: 1, squadID: 1, isLeader: true },
              { name: "T1-Member-A", steamID: "2", teamID: 1, squadID: 1, isLeader: false },
            ],
          },
          {
            squadID: 2,
            members: [
              { name: "T1-Leader-B", steamID: "3", teamID: 1, squadID: 2, isLeader: true },
            ],
          },
        ],
        unassignedPlayers: [
          { name: "T1-Rogue", steamID: "4", teamID: 1, squadID: null, isLeader: false },
        ],
      },
      {
        teamID: 2,
        teamName: "Team 2",
        squads: [
          {
            squadID: 3,
            members: [
              { name: "T2-Leader-A", steamID: "5", teamID: 2, squadID: 3, isLeader: true },
              { name: "T2-Member-A", steamID: "6", teamID: 2, squadID: 3, isLeader: false },
            ],
          },
        ],
        unassignedPlayers: [],
      },
    ],
    players: {
      active: [
        { name: "T1-Leader-A", steamID: "1", teamID: 1, squadID: 1, isLeader: true },
        { name: "T1-Member-A", steamID: "2", teamID: 1, squadID: 1, isLeader: false },
        { name: "T1-Leader-B", steamID: "3", teamID: 1, squadID: 2, isLeader: true },
        { name: "T1-Rogue", steamID: "4", teamID: 1, squadID: null, isLeader: false },
        { name: "T2-Leader-A", steamID: "5", teamID: 2, squadID: 3, isLeader: true },
        { name: "T2-Member-A", steamID: "6", teamID: 2, squadID: 3, isLeader: false },
      ],
    },
  };

  const plugin = createPjscAverageDurationPlugin({
    core: {
      logger: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } },
      runtimeState: {
        getMatch() {
          return match;
        },
      },
      webRegistry: {
        registerPage(page) {
          registeredPages.push(page);
        },
      },
    },
    modules: {
      playtime: {
        async enrichPlayers(players) {
          return players.map((player) => ({
            ...player,
            gameHours: (playtimes.get(String(player.steamID)) ?? 0) / 3600,
          }));
        },
      },
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
        on() {
          return () => {};
        },
      },
      matchState: {
        getOverview() {
          return { matchState: { ...match } };
        },
      },
    },
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

  return { plugin, registeredPages, broadcasts };
}

async function testTriggerBroadcastsExpectedSummary() {
  const { plugin, registeredPages, broadcasts } = createHarness();
  await plugin.start();

  assert.equal(registeredPages.length, 1);
  assert.equal(registeredPages[0].route, "/debug/pjsc-average-duration");

  const result = await plugin.api.simulateChatMessage({
    message: "pjsc",
    steamID: "999",
    playerName: "Tester",
    teamID: 1,
    squadID: 1,
  });

  assert.equal(result.matched, true);
  assert.equal(broadcasts.length, 2);
  assert.equal(broadcasts[0].message, "[PJSC] team1 平均时长 25.0h 小队长平均时长 20.0h");
  assert.equal(broadcasts[1].message, "[PJSC] team2 平均时长 15.0h 小队长平均时长 12.0h");

  const state = plugin.api.getState();
  assert.equal(state.triggerCount, 1);
  assert.equal(state.broadcastCount, 1);
  assert.equal(state.history[0].kind, "broadcast");
  assert.equal(state.history[1].kind, "trigger");
  assert.equal(state.lastSummary.teams[0].averageHours, 25);
  assert.equal(state.lastSummary.teams[0].leaderAverageHours, 20);
  assert.equal(state.lastSummary.teams[1].averageHours, 15);
  assert.equal(state.lastSummary.teams[1].leaderAverageHours, 12);
  assert.equal(state.lastBroadcastResult.results.length, 2);

  await plugin.stop();
}

await testTriggerBroadcastsExpectedSummary();

console.log("pjsc average duration tests passed");
