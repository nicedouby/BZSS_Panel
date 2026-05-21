import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPlugin } from "../plugins/server-info-statistics.js";

async function withHarness(run) {
  const listeners = new Map();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-server-info-statistics-"));
  const previousCwd = process.cwd();
  process.chdir(tempDir);

  const serverState = {
    serverStatus: {
      playerCount: 12,
      queueCount: 3,
      tps: 29.7,
      tpsStatus: "good",
      maxPlayers: 100,
      map: "AlBasrah",
      layer: "AlBasrah_RAAS_v1",
      mode: "RAAS",
      lastUpdatedAt: "2026-05-20T10:00:00.000Z",
    },
    players: {
      count: 12,
    },
    updatedAt: "2026-05-20T10:00:00.000Z",
  };

  const core = {
    logger: {
      info() {},
      warn() {},
    },
    pluginSubscriptions: {
      isSubscribed() {
        return true;
      },
    },
    webStatus: {
      serverId: "BZSS_Main",
      getSnapshot() {
        return { serverId: "BZSS_Main" };
      },
    },
    eventBus: {
      onModuleEvent(moduleId, eventName, handler) {
        const key = `${moduleId}:${eventName}`;
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(handler);
        return () => listeners.get(key)?.delete(handler);
      },
    },
  };

  const plugin = createPlugin({
    core,
    modules: {
      pluginSubscriptions: {
        isSubscribed() {
          return true;
        },
      },
      matchState: {
        getState() {
          return {
            updatedAt: serverState.updatedAt,
            serverStatus: { ...serverState.serverStatus },
            players: { ...serverState.players },
          };
        },
        getOverview() {
          return {
            matchState: this.getState(),
            serverStatus: { ...serverState.serverStatus },
          };
        },
      },
    },
  });

  try {
    await plugin.start();
    await run({ plugin, listeners, tempDir, serverState });
  } finally {
    await plugin.stop().catch(() => {});
    process.chdir(previousCwd);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testCollectsAndPersistsDailySamples() {
  await withHarness(async ({ plugin, tempDir, serverState }) => {
    const today = "2026-05-20";
    const initialState = await plugin.api.getState({ serverId: "BZSS_Main", date: today });
    assert.equal(initialState.date, today);
    assert.ok(initialState.availableDates.includes(today));

    serverState.serverStatus = {
      ...serverState.serverStatus,
      playerCount: 18,
      queueCount: 6,
      tps: 28.9,
      tpsStatus: "good",
      lastUpdatedAt: "2026-05-20T10:05:00.000Z",
    };
    serverState.updatedAt = "2026-05-20T10:05:00.000Z";

    await plugin.api.captureSnapshot();

    const refreshed = await plugin.api.getState({ serverId: "BZSS_Main", date: today });
    assert.equal(refreshed.summary.sampleCount >= 2, true);
    assert.equal(refreshed.latest.playerCount, 18);
    assert.equal(refreshed.latest.queueCount, 6);
    assert.equal(refreshed.latest.tps, 28.9);

    await plugin.stop();
    const afterStop = await plugin.api.getState({ serverId: "BZSS_Main", date: today });
    assert.ok(afterStop.availableDates.includes(today));
  });
}

async function testServerStatusEventTriggersCapture() {
  await withHarness(async ({ plugin, listeners, serverState }) => {
    const handler = [...(listeners.get("module.matchState:serverStatusUpdated") ?? [])][0];
    assert.ok(handler, "serverStatusUpdated handler should be registered");

    serverState.serverStatus = {
      ...serverState.serverStatus,
      playerCount: 21,
      queueCount: 4,
      tps: 29.1,
      lastUpdatedAt: "2026-05-20T10:10:00.000Z",
    };
    serverState.updatedAt = "2026-05-20T10:10:00.000Z";

    await handler({
      serverStatus: { ...serverState.serverStatus },
    });

    const state = await plugin.api.getState({ serverId: "BZSS_Main", date: "2026-05-20" });
    assert.equal(state.latest.playerCount, 21);
    assert.equal(state.latest.queueCount, 4);
    assert.equal(state.latest.tps, 29.1);
  });
}

await testCollectsAndPersistsDailySamples();
await testServerStatusEventTriggersCapture();

console.log("server info statistics tests passed");
