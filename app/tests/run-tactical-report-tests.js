import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPlugin } from "../plugins/tactical-report.js";

function createConfig(tempDir, overrides = {}) {
  return {
    get(pathText, fallback) {
      if (pathText !== "plugins.tacticalReport") return fallback;
      return {
        enabled: true,
        configFile: path.relative(process.cwd(), path.join(tempDir, "config", "tactical-report.json")),
        dataFile: path.relative(process.cwd(), path.join(tempDir, "data", "tactical-report", "user-codes.json")),
        ...overrides,
      };
    },
    set() {},
    save() {},
  };
}

async function createHarness({ players = [], configOverrides = {} } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-tactical-report-"));
  const warns = [];
  const broadcasts = [];
  const plugin = createPlugin({
    core: {
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      webStatus: { serverId: "test-server" },
      webRegistry: { registerPage() {} },
      eventBus: { onModuleEvent() { return () => {}; } },
    },
    modules: {
      chatManager: {
        on() {
          return () => {};
        },
      },
      playerState: {
        getPlayerList(serverId) {
          return serverId === "test-server" ? players : [];
        },
        getPlayerBySteamID(serverId, steamId) {
          return (serverId === "test-server" ? players : []).find((player) => String(player.steamID) === String(steamId)) ?? null;
        },
      },
      adminWarn: {
        async warnPlayer(payload) {
          warns.push(payload);
          return { success: true };
        },
        async broadcastMessage(payload) {
          broadcasts.push(payload);
          return { success: true };
        },
      },
    },
    config: createConfig(dir, configOverrides),
  });

  await plugin.init();
  await plugin.start();

  return {
    dir,
    plugin,
    warns,
    broadcasts,
    async stop() {
      await plugin.stop();
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

async function testConfigFileCreatedAndStateExposed() {
  const harness = await createHarness();
  try {
    const configPath = path.join(harness.dir, "config", "tactical-report.json");
    const stored = JSON.parse(await fs.readFile(configPath, "utf8"));
    assert.equal(stored.triggerText, "ZSBD");
    assert.equal(stored.rconPoolSize, 6);

    const state = harness.plugin.api.getState();
    assert.equal(state.config.rconPoolSize, 6);
    assert.equal(Array.isArray(state.logs), true);
    assert.equal(typeof harness.plugin.api.getLogs, "function");
    assert.equal(typeof harness.plugin.api.getUserCodes, "function");
    assert.equal(typeof harness.plugin.api.deleteUserCode, "function");
  } finally {
    await harness.stop();
  }
}

async function testLowercaseTriggerAndSuccessNotice() {
  const harness = await createHarness({
    players: [
      { name: "Alpha", steamID: "steam-1", teamID: 1 },
      { name: "Bravo", steamID: "steam-2", teamID: 1 },
      { name: "Enemy", steamID: "steam-3", teamID: 2 },
    ],
  });

  try {
    const result = await harness.plugin.api.simulateChatMessage({
      id: "evt-1",
      message: "zsbd 发现敌方坦克",
      steamID: "steam-1",
      playerName: "Alpha",
      channel: "all",
    });

    assert.equal(result.ok, true);
    assert.equal(harness.warns.length, 2);
    assert.equal(harness.warns[0].message.startsWith("[BZSS 战术报点 ]"), true);
    assert.equal(harness.warns[0].message.includes("zsbd /help可获取战术报点使用指南。"), true);
    assert.equal(harness.warns.at(-1).message, "已经触发。");
  } finally {
    await harness.stop();
  }
}

async function testHelpBroadcastIncludesCodeList() {
  const harness = await createHarness({
    players: [{ name: "Alpha", steamID: "steam-1", teamID: 1 }],
  });

  try {
    const result = await harness.plugin.api.simulateChatMessage({
      id: "evt-2",
      message: "zsbd /help",
      steamID: "steam-1",
      playerName: "Alpha",
      channel: "all",
    });

    assert.equal(result.ok, true);
    assert.equal(harness.broadcasts.length, 1);
    assert.match(harness.broadcasts[0].message, /zsbd \/0-\/9/);
    assert.match(harness.broadcasts[0].message, /\/0/);
    assert.match(harness.broadcasts[0].message, /\/9/);
  } finally {
    await harness.stop();
  }
}

async function testSetAndReloadPersonalCode() {
  const harness = await createHarness({
    players: [
      { name: "Alpha", steamID: "steam-1", teamID: 1 },
      { name: "Bravo", steamID: "steam-2", teamID: 1 },
    ],
  });

  try {
    const setResult = await harness.plugin.api.simulateChatMessage({
      id: "evt-3",
      message: "zsbd /set /10 敌方坦克在我标点附近",
      steamID: "steam-1",
      playerName: "Alpha",
      channel: "all",
    });
    assert.equal(setResult.ok, true);

    const filePath = path.join(harness.dir, "data", "tactical-report", "user-codes.json");
    const stored = JSON.parse(await fs.readFile(filePath, "utf8"));
    assert.equal(stored["steam-1"]["/10"], "敌方坦克在我标点附近");

    harness.warns.length = 0;
    const reportResult = await harness.plugin.api.simulateChatMessage({
      id: "evt-4",
      message: "zsbd /10",
      steamID: "steam-1",
      playerName: "Alpha",
      channel: "all",
    });
    assert.equal(reportResult.ok, true);
    assert.equal(harness.warns[0].message.includes("敌方坦克在我标点附近"), true);
  } finally {
    await harness.stop();
  }
}

async function testStateAndClearHistory() {
  const harness = await createHarness({
    players: [
      { name: "Alpha", steamID: "steam-1", teamID: 1 },
      { name: "Bravo", steamID: "steam-2", teamID: 1 },
    ],
  });

  try {
    await harness.plugin.api.simulateChatMessage({
      id: "evt-5",
      message: "zsbd 发现敌方步兵",
      steamID: "steam-1",
      playerName: "Alpha",
      channel: "all",
    });

    const state = harness.plugin.api.getState();
    assert.equal(state.triggerCount >= 1, true);
    assert.equal(state.recentRecords.length >= 1, true);

    const cleared = harness.plugin.api.clearHistory();
    assert.equal(cleared.history.length, 0);
    assert.equal(cleared.recentRecords.length, 0);
  } finally {
    await harness.stop();
  }
}

async function testDeleteUserCode() {
  const harness = await createHarness({
    players: [{ name: "Alpha", steamID: "steam-1", teamID: 1 }],
  });

  try {
    await harness.plugin.api.simulateChatMessage({
      id: "evt-6",
      message: "zsbd /set /10 敌方坦克",
      steamID: "steam-1",
      playerName: "Alpha",
      channel: "all",
    });

    const result = harness.plugin.api.deleteUserCode("steam-1", "/10");
    assert.equal(result.ok, true);
    const state = harness.plugin.api.getState();
    assert.equal(state.userCodes["steam-1"], undefined);
  } finally {
    await harness.stop();
  }
}

await testLowercaseTriggerAndSuccessNotice();
await testHelpBroadcastIncludesCodeList();
await testSetAndReloadPersonalCode();
await testStateAndClearHistory();
await testConfigFileCreatedAndStateExposed();
await testDeleteUserCode();

console.log("tactical report tests passed");
