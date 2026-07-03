import assert from "node:assert/strict";

import { WebServer } from "../core/web-server.js";

function createServer() {
  return new WebServer({
    config: { enabled: false },
    logger: { info() {}, warn() {}, error() {} },
    core: {
      pluginManager: { instances: [] },
      authManager: {
        hasEverything() { return false; },
        hasPermission(_user, permission) {
          return ["bzss_core.use", "tactical_map_replay.view", "tactical_map_replay.export"].includes(permission);
        },
      },
    },
    modules: {
      bzssCoreMonitor: {
        getState() {
          return {
            status: "ready",
            revision: 3,
            updatedAt: "2026-06-19T00:00:00.000Z",
            markerSeen: true,
            runtimePlayerCount: 1,
            scoreboardPlayerCount: 1,
            mainZoneCount: 1,
            rawLineHash: "abc123",
            rawFields: ["PlayerBaseInfo", "PlayerScoreboard"],
            lastError: "",
          };
        },
        getRuntimePlayers() {
          return [{ playerName: "Donald", playerGuid: "abc", playerIndex: 0, yaw: 90 }];
        },
        getScoreboardPlayers() {
          return [{ playerIndex: 0, playerId: 0, teamId: 1, squadId: -1, playerScoreboard: { stats: { combatScore: 1 }, numericValues: [] } }];
        },
        getPlayers() {
          return [{
            playerIndex: 0,
            playerId: 0,
            playerName: "Donald",
            playerGuid: "abc",
            telemetry: { position: { x: 1, y: 2, z: 3 }, yaw: 90, combatInfo: "" },
            presence: { state: "active" },
            playerScoreboard: { stats: { combatScore: 1 }, numericValues: [] },
          }];
        },
        getRawSnapshot() {
          return {
            status: "ready",
            revision: 3,
            updatedAt: "2026-06-19T00:00:00.000Z",
            markerSeen: true,
            runtimePlayerCount: 1,
            scoreboardPlayerCount: 1,
            mainZoneCount: 1,
            rawLineHash: "abc123",
            rawFields: ["PlayerBaseInfo", "PlayerScoreboard"],
            lastError: "",
            runtimePlayers: [{ playerName: "Donald", playerGuid: "abc", playerIndex: 0, playerId: 0, yaw: 90 }],
            scoreboardPlayers: [{ playerIndex: 0, playerId: 0, teamId: 1, squadId: -1, playerScoreboard: { stats: { combatScore: 1 }, numericValues: [] } }],
            players: [{ playerIndex: 0, playerId: 0, playerName: "Donald" }],
            captureZones: [{ name: "CP1", position: { x: 100, y: 200, z: 0 } }],
            fobs: [],
            mainZones: [],
          };
        },
      },
      tacticalMapReplay: {
        async listSegments() {
          return { ok: true, items: [{ id: "seg-1", frameCount: 3 }] };
        },
        async getSegment() {
          return { ok: true, segment: { id: "seg-1" }, frames: [{ frameId: "f1" }], frameCount: 1, query: {} };
        },
        async createExportTask() {
          return { ok: true, task: { id: "task-1", status: "queued" } };
        },
        listExportTasks() {
          return { ok: true, items: [{ id: "task-1", status: "completed" }] };
        },
        getExportFile() {
          return null;
        },
      },
    },
  });
}

function main() {
  const server = createServer();
  const one = server.getBzssCorePlayerInfo({ all: 0 });
  assert.equal(one.runtimePlayers, undefined);
  assert.equal(one.scoreboardPlayers, undefined);

  const all = server.getBzssCorePlayerInfo({ all: true });
  assert.equal(Array.isArray(all.runtimePlayers), true);
  assert.equal(all.runtimePlayers.length, 1);
  assert.equal(Array.isArray(all.scoreboardPlayers), true);
  assert.equal(all.scoreboardPlayers.length, 1);
  assert.equal(Array.isArray(all.players), true);
  assert.equal(all.players.length, 1);
  assert.equal(Array.isArray(all.captureZones), true);
  assert.equal(all.captureZones.length, 1);
  assert.equal(all.captureZones[0].name, "CP1");
  assert.equal(all.status, "ready");
  assert.equal(all.state.runtimePlayerCount, 1);
  assert.equal(all.state.scoreboardPlayerCount, 1);

  const raw = server.getBzssCorePlayerInfoRaw();
  assert.equal(raw.runtimePlayers.length, 1);
  assert.equal(raw.scoreboardPlayers.length, 1);
  assert.equal(raw.players.length, 1);
  assert.equal(raw.status, "ready");
  assert.equal(raw.rawLineHash, "abc123");

  server.canViewTacticalMapReplay({ permissions: ["tactical_map_replay.view"] });
  server.canExportTacticalMapReplay({ permissions: ["tactical_map_replay.export"] });
  assert.equal(typeof server.modules.tacticalMapReplay.listExportTasks, "function");
  console.log("run-bzss-core-monitor-route-tests: ok");
}

main();
