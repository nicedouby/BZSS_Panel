import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPlugin } from "../plugins/lianban-kick.js";

function createConfig(tempDir, overrides = {}) {
  return {
    get(pathText, fallback) {
      if (pathText !== "plugins.lianbanKick" && pathText !== "plugins.lianban-kick") return fallback;
      return {
        enabled: true,
        banDir: path.relative(process.cwd(), path.join(tempDir, "Ban")),
        historyLimit: 100,
        ...overrides,
      };
    },
    set() {},
    save() {},
  };
}

async function createHarness({ configOverrides = {}, playerStatePlayers = [] } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-lianban-kick-"));
  await fs.mkdir(path.join(dir, "Ban"), { recursive: true });
  const plugin = createPlugin({
    core: {
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      webStatus: { serverId: "test-server" },
      webRegistry: { registerPage() {} },
      pluginSubscriptions: { isSubscribed() { return true; } },
      eventBus: { onCoreEvent() { return () => {}; } },
    },
    modules: {
      playerState: {
        getPlayerByName(serverId, name) {
          return playerStatePlayers.find((player) => serverId === "test-server" && player.name === name) ?? null;
        },
        getPlayerBySteamID(serverId, steamID) {
          return playerStatePlayers.find((player) => serverId === "test-server" && player.steamID === steamID) ?? null;
        },
        getPlayerByEOSID(serverId, eosID) {
          return playerStatePlayers.find((player) => serverId === "test-server" && player.eosID === eosID) ?? null;
        },
        findPlayer(serverId, query) {
          return playerStatePlayers.find((player) => serverId === "test-server" && (
            player.steamID === query?.steamId ||
            player.eosID === query?.eosId ||
            player.name === query?.name
          )) ?? null;
        },
      },
    },
    config: createConfig(dir, configOverrides),
  });

  return {
    dir,
    plugin,
    async writeBanFiles(files) {
      for (const [name, content] of Object.entries(files)) {
        await fs.writeFile(path.join(dir, "Ban", name), content, "utf8");
      }
    },
    async start() {
      await plugin.start();
    },
    async stop() {
      await plugin.stop();
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

async function testBanParsingAndMatchBySteamID() {
  const harness = await createHarness();
  try {
    await harness.writeBanFiles({
      "bans.cfg": [
        "76561111111111111:0//联办测试 A",
        "00000000000000000000000000000000//EOS 仅测试",
      ].join("\n"),
      "bans2.cfg": "76561112222222222:0//联办测试 B",
    });

    await harness.start();
    const state = harness.plugin.api.getState();
    assert.equal(state.totalFiles, 2);
    assert.equal(state.totalRecords, 3);

    const result = await harness.plugin.api.simulateJoin({
      playerName: "SteamHit",
      steamID: "76561111111111111",
    });

    assert.ok(result);
    assert.equal(result.matchKey, "steamID");
    assert.equal(result.fileName, "bans.cfg");
    assert.equal(harness.plugin.api.getState().matchedCount, 1);
  } finally {
    await harness.stop();
  }
}

async function testMatchByEOSIDAndPlayerStateFallback() {
  const harness = await createHarness({
    playerStatePlayers: [
      { name: "EosOnly", steamID: "76561113333333333", eosID: "00000000000000000000000000000001" },
    ],
  });
  try {
    await harness.writeBanFiles({
      "bans.cfg": "00000000000000000000000000000001//联办 EOS 命中",
    });
    await harness.start();

    const result = await harness.plugin.api.simulateJoin({
      playerName: "EosOnly",
    });
    assert.ok(result);
    assert.equal(result.matchKey, "eosID");

    const state = harness.plugin.api.getState();
    assert.equal(state.recentMatches.length, 1);
    assert.equal(state.recentMatches[0].eosID, "00000000000000000000000000000001");
  } finally {
    await harness.stop();
  }
}

async function testNoMatchAndMissingIdentity() {
  const harness = await createHarness();
  try {
    await harness.writeBanFiles({
      "bans.cfg": "76561114444444444:0//联办测试",
    });
    await harness.start();

    const result = await harness.plugin.api.simulateJoin({
      playerName: "Unknown",
      steamID: "76561119999999999",
      eosID: "00000000000000000000000000000002",
    });
    assert.equal(result, null);

    const missing = await harness.plugin.api.simulateJoin({
      playerName: "NoId",
    });
    assert.equal(missing, null);
    assert.equal(harness.plugin.api.getState().matchedCount, 0);
  } finally {
    await harness.stop();
  }
}

async function run() {
  await testBanParsingAndMatchBySteamID();
  await testMatchByEOSIDAndPlayerStateFallback();
  await testNoMatchAndMissingIdentity();
  console.log("lianban-kick tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
