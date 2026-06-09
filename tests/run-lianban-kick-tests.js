import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPlugin } from "../plugins/lianban-kick.js";

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
}

async function createHarness({ files = {}, players = [], kickResults = [] } = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-lianban-kick-"));
  const ruleDir = path.join(tempDir, "联办");
  await fs.mkdir(ruleDir, { recursive: true });

  for (const [fileName, content] of Object.entries(files)) {
    await fs.writeFile(path.join(ruleDir, fileName), content, "utf8");
  }

  const moduleHandlers = new Map();
  const kicks = [];
  let kickIndex = 0;

  const plugin = createPlugin({
    core: {
      webStatus: {
        serverId: "BZSS_Main",
      },
      eventBus: {
        onModuleEvent(moduleId, eventName, handler) {
          moduleHandlers.set(`${moduleId}:${eventName}`, handler);
          return () => moduleHandlers.delete(`${moduleId}:${eventName}`);
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
          const result = kickResults[kickIndex] ?? { ok: true };
          kickIndex += 1;
          return result;
        },
      },
    },
    config: {
      get(pathText, fallback) {
        if (pathText === "plugins.lianbanKick") {
          return {
            enabled: true,
            directory: ruleDir,
            cacheMs: 0,
            retryCooldownMs: 60_000,
          };
        }
        return fallback;
      },
    },
    logger: createLogger(),
  });

  await plugin.start();

  return {
    plugin,
    kicks,
    async emitPlayersSnapshot(nextPlayers = players) {
      players.splice(0, players.length, ...nextPlayers);
      const handler = moduleHandlers.get("module.playerState:playersSnapshotUpdated");
      if (handler) {
        await handler({
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

async function testMatchBySteamEosAndName() {
  const harness = await createHarness({
    files: {
      "a.txt": "# comment\nsteam: 76561198000000001\n",
      "b.txt": "eos: EOS-ABC-123\nAlpha Player\n",
    },
    players: [
      { name: "Other", steamID: "76561198000000000", eosID: "EOS-OTHER" },
      { name: "Steam Hit", steamID: "76561198000000001", eosID: "EOS-X" },
      { name: "Eos Hit", steamID: "76561198000000002", eosID: "eos-abc-123" },
      { name: "Alpha Player", steamID: "76561198000000003", eosID: "EOS-Y" },
    ],
  });

  try {
    assert.equal(harness.kicks.length, 3);
    assert.deepEqual(
      harness.kicks.map((item) => ({ steamId: item.steamId, eosId: item.eosId, name: item.name, reason: item.reason })),
      [
        { steamId: "76561198000000001", eosId: "EOS-X", name: "Steam Hit", reason: "被联办" },
        { steamId: "76561198000000002", eosId: "eos-abc-123", name: "Eos Hit", reason: "被联办" },
        { steamId: "76561198000000003", eosId: "EOS-Y", name: "Alpha Player", reason: "被联办" },
      ],
    );
  } finally {
    await harness.stop();
  }
}

async function testSupportCurrentBansCfgSteamFormat() {
  const harness = await createHarness({
    files: {
      "bans.cfg": "76561199361849321:0\n76561199350480500:0\n",
    },
    players: [
      { name: "Hit One", steamID: "76561199361849321", eosID: "EOS-1" },
      { name: "Hit Two", steamID: "76561199350480500", eosID: "EOS-2" },
      { name: "Miss", steamID: "76561199300000000", eosID: "EOS-3" },
    ],
  });

  try {
    assert.equal(harness.kicks.length, 2);
    assert.deepEqual(
      harness.kicks.map((item) => item.steamId),
      ["76561199361849321", "76561199350480500"],
    );
  } finally {
    await harness.stop();
  }
}

async function testDeduplicateWhileOnlineAndRetryAfterLeave() {
  const harness = await createHarness({
    files: {
      "names.txt": "Repeat Guy\n",
    },
    players: [
      { name: "Repeat Guy", steamID: "76561198000000009", eosID: "EOS-9" },
    ],
  });

  try {
    assert.equal(harness.kicks.length, 1);

    await harness.emitPlayersSnapshot([
      { name: "Repeat Guy", steamID: "76561198000000009", eosID: "EOS-9" },
    ]);
    assert.equal(harness.kicks.length, 1);

    await harness.emitPlayersSnapshot([]);
    await harness.emitPlayersSnapshot([
      { name: "Repeat Guy", steamID: "76561198000000009", eosID: "EOS-9" },
    ]);
    assert.equal(harness.kicks.length, 2);
  } finally {
    await harness.stop();
  }
}

await testMatchBySteamEosAndName();
await testSupportCurrentBansCfgSteamFormat();
await testDeduplicateWhileOnlineAndRetryAfterLeave();

console.log("lianban kick tests passed");
