import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createTacticalMapReplayModule } from "../modules/tactical-map-replay/index.js";

function createHarness(options = {}) {
  const subscribers = new Set();
  let players = options.players ?? [];
  const tempDir = options.tempDir;

  const configValues = {
    tacticalMapReplay: {
      enabled: true,
      dataDir: path.join(tempDir, "replay-data"),
      exportTempDir: path.join(tempDir, "replay-temp"),
      recordingMinPlayerCount: 50,
      keepAliveKeyframeMs: 2000,
      positionThreshold: 300,
      yawThreshold: 8,
      ffmpegPath: "",
    },
  };

  const core = {
    webStatus: {
      serverId: "server-1",
      getSnapshot() {
        return {
          serverId: "server-1",
          mapName: "Mutaha",
          map: "Mutaha",
          layer: "Mutaha_RAAS_v1",
          playerCount: players.length,
        };
      },
    },
    runtimeState: {
      getAll() {
        return {
          server: {
            mapName: "Mutaha",
            layer: "Mutaha_RAAS_v1",
          },
        };
      },
    },
    config: {
      get(key, fallback) {
        return key in configValues ? configValues[key] : fallback;
      },
    },
    logger: { info() {}, warn() {}, error() {} },
    createLogger() { return { info() {}, warn() {}, error() {} }; },
  };

  const modules = {
    bzssCoreMonitor: {
      subscribe(listener) {
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      },
      getPlayers() {
        return players;
      },
    },
  };

  const module = createTacticalMapReplayModule({
    core,
    modules,
    config: core.config,
    logger: core.logger,
  });

  return {
    module,
    setPlayers(nextPlayers) {
      players = nextPlayers;
    },
    async publish() {
      for (const listener of subscribers) {
        await listener();
      }
    },
    dataDir: path.join(tempDir, "replay-data"),
  };
}

function buildPlayer(index, overrides = {}) {
  return {
    playerGuid: `guid-${index}`,
    playerName: `Player ${index}`,
    teamId: index % 2 ? 1 : 2,
    squadId: Math.floor(index / 5) + 1,
    soldierInfo: {
      health: 100,
      soldierClass: "BP_Rifleman",
      position: { x: index * 1000 + 50, y: index * 1000 + 100, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    vehicleInfo: null,
    ...overrides,
  };
}

async function testDoesNotRecordAtOrBelowThreshold() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-tmr-"));
  const harness = createHarness({ tempDir, players: Array.from({ length: 50 }, (_, index) => buildPlayer(index)) });
  await harness.module.init();
  await harness.publish();
  const response = await harness.module.api.listSegments();
  assert.equal(response.items.length, 0);
  await harness.module.stop();
}

async function testRecordsAboveThresholdAndFiltersByPlayerNames() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-tmr-"));
  const players = Array.from({ length: 51 }, (_, index) => buildPlayer(index));
  const harness = createHarness({ tempDir, players });
  await harness.module.init();
  await harness.publish();

  const segments = await harness.module.api.listSegments();
  assert.equal(segments.items.length, 1);
  assert.equal(segments.items[0].frameCount, 1);

  const segment = await harness.module.api.getSegment({
    id: segments.items[0].id,
    players: "Player 1,Player 2",
  });
  assert.equal(segment.ok, true);
  assert.equal(segment.frames.length, 1);
  assert.deepEqual(segment.frames[0].players.map((item) => item.playerName).sort(), ["Player 1", "Player 2"]);
  await harness.module.stop();
}

async function testSkipsUnchangedFrameButKeepsChangedMovement() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-tmr-"));
  const players = Array.from({ length: 51 }, (_, index) => buildPlayer(index));
  const harness = createHarness({ tempDir, players });
  await harness.module.init();
  await harness.publish();
  await harness.publish();

  const movedPlayers = players.map((player, index) => {
    if (index !== 0) return player;
    return buildPlayer(index, {
      playerGuid: player.playerGuid,
      playerName: player.playerName,
      soldierInfo: {
        ...player.soldierInfo,
        position: { x: 1200, y: 1700, z: 0 },
        rotation: { x: 0, y: 0, z: 25 },
      },
    });
  });
  harness.setPlayers(movedPlayers);
  await harness.publish();

  const segments = await harness.module.api.listSegments();
  assert.equal(segments.items.length, 1);
  assert.equal(segments.items[0].frameCount, 2);
  await harness.module.stop();
}

async function testExportFailsWithoutFfmpegPath() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-tmr-"));
  const players = Array.from({ length: 51 }, (_, index) => buildPlayer(index));
  const harness = createHarness({ tempDir, players });
  await harness.module.init();
  await harness.publish();
  const segments = await harness.module.api.listSegments();
  const result = await harness.module.api.createExportTask({
    segmentId: segments.items[0].id,
    speed: 1,
  });
  assert.equal(result.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const tasks = harness.module.api.listExportTasks({ segmentId: segments.items[0].id });
  assert.equal(tasks.items.length, 1);
  assert.equal(tasks.items[0].status, "failed");
  assert.match(tasks.items[0].error, /ffmpegPath/i);
  await harness.module.stop();
}

async function main() {
  await testDoesNotRecordAtOrBelowThreshold();
  await testRecordsAboveThresholdAndFiltersByPlayerNames();
  await testSkipsUnchangedFrameButKeepsChangedMovement();
  await testExportFailsWithoutFfmpegPath();
  console.log("run-tactical-map-replay-tests: ok");
}

main();
