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
            playerCount: 1,
            rawTextLength: 512,
            sourceMode: "log",
            lastRawLineHash: "abc123",
            lastRawFields: ["PlayerBaseInfo", "PlayerScoreboard"],
            lastError: "",
          };
        },
        getPlayers() {
          return [{ playerName: "Donald", playerGuid: "abc", playerIndex: 0 }];
        },
        getRawSnapshot() {
          return {
            status: "ready",
            revision: 3,
            updatedAt: "2026-06-19T00:00:00.000Z",
            markerSeen: true,
            playerCount: 1,
            rawTextLength: 512,
            sourceMode: "log",
            lastRawLineHash: "abc123",
            lastRawFields: ["PlayerBaseInfo", "PlayerScoreboard"],
            lastError: "",
            rawText: "PlayerBaseInfo{0,abc,Donald,1,0}",
            captureZones: [{ name: "CP1", position: { x: 100, y: 200, z: 0 } }],
            fobs: [],
            mainZones: [],
          };
        },
        findPlayer(query) {
          return query?.name ? { playerName: query.name, playerGuid: "abc", playerIndex: 0 } : null;
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
  const one = server.getBzssCorePlayerInfo({ name: "Donald" });
  assert.equal(one.player?.playerName, "Donald");
  assert.equal(one.player?.playerIndex, 0);
  assert.equal(one.players, undefined);

  const all = server.getBzssCorePlayerInfo({ all: true });
  assert.equal(Array.isArray(all.players), true);
  assert.equal(all.players.length, 1);
  assert.equal(Array.isArray(all.captureZones), true);
  assert.equal(all.captureZones.length, 1);
  assert.equal(all.captureZones[0].name, "CP1");
  assert.equal(all.status, "ready");
  assert.equal(all.state.sourceMode, "log");

  const raw = server.getBzssCorePlayerInfoRaw();
  assert.equal(raw.rawText.includes("PlayerBaseInfo"), true);
  assert.equal(raw.rawTextLength, 512);
  assert.equal(raw.status, "ready");
  assert.equal(raw.sourceMode, "log");

  server.canViewTacticalMapReplay({ permissions: ["tactical_map_replay.view"] });
  server.canExportTacticalMapReplay({ permissions: ["tactical_map_replay.export"] });
  assert.equal(typeof server.modules.tacticalMapReplay.listExportTasks, "function");
  console.log("run-bzss-core-monitor-route-tests: ok");
}

main();
