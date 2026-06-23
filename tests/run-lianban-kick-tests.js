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

async function createHarness({ files = {}, kickResults = [] } = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-lianban-kick-"));
  const ruleDir = path.join(tempDir, "联办");
  await fs.mkdir(ruleDir, { recursive: true });

  for (const [fileName, content] of Object.entries(files)) {
    await fs.writeFile(path.join(ruleDir, fileName), content, "utf8");
  }

  const coreHandlers = new Map();
  const kicks = [];
  let kickIndex = 0;

  const plugin = createPlugin({
    core: {
      webStatus: {
        serverId: "BZSS_Main",
      },
      webRegistry: {
        registerPage() {},
      },
      eventBus: {
        onCoreEvent(eventName, handler) {
          coreHandlers.set(eventName, handler);
          return () => coreHandlers.delete(eventName);
        },
      },
    },
    modules: {
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
    async emitJoin(event) {
      const handler = coreHandlers.get("On_PlayerConnected");
      if (handler) {
        await handler({
          serverId: "BZSS_Main",
          eventName: "On_PlayerConnected",
          time: "2026-05-12T00:00:00.000Z",
          ...event,
        });
      }
    },
    async stop() {
      await plugin.stop();
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}

async function testKickEveryJoinEvent() {
  const harness = await createHarness();

  try {
    await harness.emitJoin({
      playerName: "Steam Hit",
      steamID: "76561198000000001",
      eosID: "EOS-X",
    });
    await harness.emitJoin({
      playerName: "Alpha Player",
      steamID: "76561198000000002",
      eosID: "EOS-Y",
    });

    assert.equal(harness.kicks.length, 2);
    assert.deepEqual(
      harness.kicks.map((item) => ({
        steamId: item.steamId,
        eosId: item.eosId,
        name: item.name,
        source: item.source,
      })),
      [
        {
          steamId: "76561198000000001",
          eosId: "EOS-X",
          name: "Steam Hit",
          source: "plugin.lianbanKick",
        },
        {
          steamId: "76561198000000002",
          eosId: "EOS-Y",
          name: "Alpha Player",
          source: "plugin.lianbanKick",
        },
      ],
    );
    assert.equal(harness.plugin.api.getState().kickSuccess, 2);
    assert.equal(harness.plugin.api.getState().lastMatch?.matchType, "join_event");
  } finally {
    await harness.stop();
  }
}

async function testKickSamePlayerOnRepeatedJoins() {
  const harness = await createHarness();

  try {
    await harness.emitJoin({
      playerName: "Repeat Guy",
      steamID: "76561198000000009",
      eosID: "EOS-9",
    });
    await harness.emitJoin({
      playerName: "Repeat Guy",
      steamID: "76561198000000009",
      eosID: "EOS-9",
    });

    assert.equal(harness.kicks.length, 2);
    assert.deepEqual(
      harness.kicks.map((item) => item.steamId),
      ["76561198000000009", "76561198000000009"],
    );
  } finally {
    await harness.stop();
  }
}

await testKickEveryJoinEvent();
await testKickSamePlayerOnRepeatedJoins();

console.log("lianban kick tests passed");
