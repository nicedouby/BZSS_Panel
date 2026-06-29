import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPlugin } from "../plugins/panel-ban.js";

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
}

async function createHarness({ players = [] } = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-panel-ban-"));
  const dataDir = path.join(tempDir, "data", "plugins", "panel-ban");
  await fs.mkdir(dataDir, { recursive: true });

  const moduleHandlers = new Map();
  const kicks = [];
  const initialPlayers = players.map((player) => ({ ...player }));
  const plugin = createPlugin({
    core: {
      webStatus: {
        serverId: "BZSS_Main",
      },
      webRegistry: {
        registerPage() {},
      },
      eventBus: {
        onModuleEvent(moduleId, eventName, handler) {
          moduleHandlers.set(`${moduleId}:${eventName}`, handler);
          return () => moduleHandlers.delete(`${moduleId}:${eventName}`);
        },
        onCoreEvent(eventName, handler) {
          moduleHandlers.set(`core:${eventName}`, handler);
          return () => moduleHandlers.delete(`core:${eventName}`);
        },
      },
    },
    modules: {
      playerState: {
        getPlayerList() {
          return players;
        },
      },
      squadManagement: {
        async requestKick(request) {
          kicks.push(request);
          return { ok: true };
        },
      },
    },
    config: {
      get(pathText, fallback) {
        if (pathText === "plugins.panelBan") {
          return {
            enabled: true,
            dataDir,
            cacheMs: 0,
            retryCooldownMs: 60_000,
            matchNameFallback: true,
          };
        }
        return fallback;
      },
    },
    logger: createLogger(),
  });

  await plugin.init?.();
  await plugin.start();

  return {
    plugin,
    kicks,
    dataDir,
    async emitPlayersSnapshot(nextPlayers = initialPlayers) {
      players.splice(0, players.length, ...nextPlayers);
      const moduleHandler = moduleHandlers.get("module.playerState:playersSnapshotUpdated");
      if (moduleHandler) {
        await moduleHandler({
          serverId: "BZSS_Main",
          players: nextPlayers,
        });
      }
    },
    async stop() {
      await plugin.stop();
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}

async function testMatchAndExpiryFlow() {
  const harness = await createHarness({
    players: [
      { name: "Steam Hit", steamID: "76561198000000001", eosID: "EOS-X" },
      { name: "Eos Hit", steamID: "76561198000000002", eosID: "EOS-ABC-123" },
      { name: "Name Hit", steamID: "76561198000000003", eosID: "EOS-Y" },
      { name: "Expired Hit", steamID: "76561198000000004", eosID: "EOS-Z" },
    ],
  });

  try {
    const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const steamEntry = await harness.plugin.api.createEntry({
      steamID: "76561198000000001",
      reason: "Steam ban",
      expiresAt: future,
    });
    const eosEntry = await harness.plugin.api.createEntry({
      eosID: "EOS-ABC-123",
      reason: "EOS ban",
      expiresAt: future,
    });
    const nameEntry = await harness.plugin.api.createEntry({
      name: "Name Hit",
      reason: "Name ban",
      expiresAt: future,
    });
    await harness.plugin.api.createEntry({
      steamID: "76561198000000004",
      reason: "Expired ban",
      expiresAt: past,
    });

    assert.equal(steamEntry.status, "active");
    assert.equal(eosEntry.status, "active");
    assert.equal(nameEntry.status, "active");

    await harness.emitPlayersSnapshot();
    assert.equal(harness.kicks.length, 3);
    assert.match(harness.kicks[0].reason, /Panel Ban/);
    assert.match(harness.kicks[0].reason, /Steam ban|EOS ban|Name ban/);

    const stateAfterKick = harness.plugin.api.getState();
    assert.equal(stateAfterKick.kickSuccess, 3);
    assert.equal(stateAfterKick.entries.find((entry) => entry.id === steamEntry.id)?.hitCount, 1);
    assert.equal(harness.plugin.api.findBanMatchByIdentity({ eosID: "EOS-ABC-123" })?.matchType, "eosID");

    await harness.emitPlayersSnapshot();
    assert.equal(harness.kicks.length, 3);

    await harness.emitPlayersSnapshot([]);
    await harness.emitPlayersSnapshot();
    assert.equal(harness.kicks.length, 6);

    const expiredMatch = harness.plugin.api.findBanMatchByIdentity({ steamID: "76561198000000004" });
    assert.equal(expiredMatch, null);
  } finally {
    await harness.stop();
  }
}

await testMatchAndExpiryFlow();

console.log("panel ban tests passed");
