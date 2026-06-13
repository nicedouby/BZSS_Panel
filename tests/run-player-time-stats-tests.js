import assert from "node:assert/strict";

import { createPlayerTimeStatsModule } from "../modules/player-time-stats/index.js";

function createHarness({ warmup = false, multiplier = 1, maxDeltaSeconds = 60 } = {}) {
  let players = [];
  const records = new Map();
  let nextId = 1;

  const core = {
    webStatus: {
      serverId: "BZSS_Main",
      getSnapshot() {
        return { isWarmup: warmup, serverId: "BZSS_Main" };
      },
    },
    logger: {
      info() {},
      error() {},
    },
    createLogger() {
      return this.logger;
    },
  };

  const modules = {
    playerState: {
      getOnlinePlayers() {
        return players;
      },
    },
    playerDatabase: {
      async upsertFromPresence(identity = {}) {
        const key = identity.steamID || identity.eosID || identity.name;
        if (!records.has(key)) {
          records.set(key, {
            id: nextId++,
            identity,
            serverSeconds: 0,
            warmupSeconds: 0,
            warmupPoints: 0,
          });
        }
        return records.get(key);
      },
      async addTimeStats(playerId, patch = {}) {
        const record = [...records.values()].find((item) => item.id === Number(playerId));
        if (!record) return null;
        record.serverSeconds += Number(patch.serverSeconds ?? 0);
        record.warmupSeconds += Number(patch.warmupSeconds ?? 0);
        record.warmupPoints += Number(patch.warmupPoints ?? 0);
        return record;
      },
    },
  };

  const config = {
    get(path, fallback) {
      if (path === "modules.playerTimeStats") {
        return {
          enabled: true,
          tickMs: 10000,
          maxDeltaSeconds,
          warmupPointsMultiplier: multiplier,
        };
      }
      return fallback;
    },
  };

  const module = createPlayerTimeStatsModule({ core, modules, config, logger: core.logger });
  return {
    module,
    records,
    setPlayers(nextPlayers) {
      players = nextPlayers;
    },
    setWarmup(value) {
      warmup = value;
    },
  };
}

async function testWarmupOffOnlyAddsServerSeconds() {
  const harness = createHarness({ warmup: false });
  harness.setPlayers([{ name: "Alpha", steamID: "76561198000000001" }]);

  await harness.module.api.tick(1000);
  await harness.module.api.tick(11_000);

  const record = harness.records.get("76561198000000001");
  assert.equal(record.serverSeconds, 10);
  assert.equal(record.warmupSeconds, 0);
  assert.equal(record.warmupPoints, 0);
}

async function testWarmupOnAddsWarmupSecondsAndPoints() {
  const harness = createHarness({ warmup: true });
  harness.setPlayers([{ name: "Alpha", steamID: "76561198000000001" }]);

  await harness.module.api.tick(1000);
  await harness.module.api.tick(16_000);

  const record = harness.records.get("76561198000000001");
  assert.equal(record.serverSeconds, 15);
  assert.equal(record.warmupSeconds, 15);
  assert.equal(record.warmupPoints, 15);
}

async function testWarmupMultiplier() {
  const harness = createHarness({ warmup: true, multiplier: 2 });
  harness.setPlayers([{ name: "Alpha", steamID: "76561198000000001" }]);

  await harness.module.api.tick(1000);
  await harness.module.api.tick(6000);

  const record = harness.records.get("76561198000000001");
  assert.equal(record.serverSeconds, 5);
  assert.equal(record.warmupSeconds, 5);
  assert.equal(record.warmupPoints, 10);
}

async function testMaxDeltaCap() {
  const harness = createHarness({ warmup: true, maxDeltaSeconds: 20 });
  harness.setPlayers([{ name: "Alpha", steamID: "76561198000000001" }]);

  await harness.module.api.tick(1000);
  await harness.module.api.tick(121_000);

  const record = harness.records.get("76561198000000001");
  assert.equal(record.serverSeconds, 20);
  assert.equal(record.warmupSeconds, 20);
  assert.equal(record.warmupPoints, 20);
}

async function testOfflineTimeIsNotBackfilled() {
  const harness = createHarness({ warmup: true });
  harness.setPlayers([{ name: "Alpha", steamID: "76561198000000001" }]);

  await harness.module.api.tick(1000);
  harness.setPlayers([]);
  await harness.module.api.tick(11_000);
  harness.setPlayers([{ name: "Alpha", steamID: "76561198000000001" }]);
  await harness.module.api.tick(61_000);
  await harness.module.api.tick(71_000);

  const record = harness.records.get("76561198000000001");
  assert.equal(record.serverSeconds, 10);
  assert.equal(record.warmupSeconds, 10);
  assert.equal(record.warmupPoints, 10);
}

await testWarmupOffOnlyAddsServerSeconds();
await testWarmupOnAddsWarmupSecondsAndPoints();
await testWarmupMultiplier();
await testMaxDeltaCap();
await testOfflineTimeIsNotBackfilled();

console.log("player time stats tests passed");
