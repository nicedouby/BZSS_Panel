import assert from "node:assert/strict";

import { WebServer } from "../core/web-server.js";

function createServer() {
  return new WebServer({
    config: { enabled: false },
    logger: { info() {}, warn() {}, error() {} },
    core: {
      pluginManager: { instances: [] },
    },
    modules: {
      bzssCoreMonitor: {
        getState() {
          return {
            configuredPath: "E:\\Epic Games\\PBI.sav",
            resolvedPath: "E:\\Epic Games\\PBI.sav",
            exists: true,
            status: "ready",
            revision: 3,
            updatedAt: "2026-06-19T00:00:00.000Z",
            lastReadAt: "2026-06-19T00:00:00.000Z",
            lastCompletedAt: "2026-06-19T00:00:00.000Z",
            markerSeen: true,
            fileSize: 1024,
            fileMtimeMs: 1,
            playerCount: 1,
            lastError: "",
          };
        },
        getPlayers() {
          return [{ playerName: "Donald", playerGuid: "abc" }];
        },
        findPlayer(query) {
          return query?.name ? { playerName: query.name, playerGuid: "abc" } : null;
        },
      },
    },
  });
}

function main() {
  const server = createServer();
  const one = server.getBzssCorePlayerInfo({ name: "Donald" });
  assert.equal(one.player?.playerName, "Donald");
  assert.equal(one.players, undefined);

  const all = server.getBzssCorePlayerInfo({ all: true });
  assert.equal(Array.isArray(all.players), true);
  assert.equal(all.players.length, 1);
  assert.equal(all.status, "ready");
  console.log("run-bzss-core-monitor-route-tests: ok");
}

main();
