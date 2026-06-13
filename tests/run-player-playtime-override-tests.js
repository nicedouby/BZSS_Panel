import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createDatabase } from "../core/database.js";
import { PlayerRepository } from "../repositories/player-repository.js";

async function createTempRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-playtime-override-"));
  const db = await createDatabase({ dir, filename: "test.db" });
  const repo = new PlayerRepository(db);
  await repo.hydrateCache();
  return { dir, db, repo };
}

async function testSteamDurationAndOverrideLifecycle() {
  const { dir, db, repo } = await createTempRepo();

  try {
    const createdAt = Date.now();
    const insert = await db.run(
      `INSERT INTO players (current_name, steam_id, eos_id, current_ip, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      "Alpha",
      "76561198000000001",
      "eos-1",
      "10.0.0.1",
      createdAt,
      createdAt,
    );
    const playerId = insert.lastID;

    let updated = await repo.updateGameDuration(playerId, 7200);
    assert.equal(updated.steam_game_seconds, 7200);
    assert.equal(updated.game_seconds, 7200);
    assert.equal(updated.game_seconds_override, null);

    updated = await repo.setGameDurationOverride(playerId, 10800);
    assert.equal(updated.steam_game_seconds, 7200);
    assert.equal(updated.game_seconds, 10800);
    assert.equal(updated.game_seconds_override, 10800);

    updated = await repo.updateGameDuration(playerId, 14400);
    assert.equal(updated.steam_game_seconds, 14400);
    assert.equal(updated.game_seconds, 10800);
    assert.equal(updated.game_seconds_override, 10800);

    updated = await repo.setGameDurationOverride(playerId, null);
    assert.equal(updated.steam_game_seconds, 14400);
    assert.equal(updated.game_seconds, 14400);
    assert.equal(updated.game_seconds_override, null);

    const detail = await repo.getPlayerDetail(playerId);
    assert.equal(detail.summary.gameSeconds, 14400);
    assert.equal(detail.summary.steamGameSeconds, 14400);
    assert.equal(detail.summary.gameSecondsOverride, null);
  } finally {
    await db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function testTimeStatsAssetsLifecycle() {
  const { dir, db, repo } = await createTempRepo();

  try {
    const createdAt = Date.now();
    const first = await db.run(
      `INSERT INTO players (current_name, steam_id, eos_id, current_ip, created_at, updated_at, assets_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      "Bravo",
      "76561198000000002",
      "eos-2",
      "10.0.0.2",
      createdAt,
      createdAt,
      "{\"reserve\":3}",
    );
    const second = await db.run(
      `INSERT INTO players (current_name, steam_id, eos_id, current_ip, created_at, updated_at, assets_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      "Charlie",
      "76561198000000003",
      "eos-3",
      "10.0.0.3",
      createdAt,
      createdAt,
      "not-json",
    );

    let updated = await repo.addTimeStats(first.lastID, {
      serverSeconds: 10,
      warmupSeconds: 10,
      warmupPoints: 10,
    });
    assert.equal(updated.server_seconds, 10);
    assert.equal(updated.warmup_seconds, 10);
    assert.equal(updated.warmupPoints, 10);
    assert.deepEqual(updated.assets, { reserve: 3, warmupPoints: 10 });

    updated = await repo.addTimeStats(first.lastID, {
      serverSeconds: 5,
      warmupSeconds: 5,
      warmupPoints: 2.5,
    });
    assert.equal(updated.server_seconds, 15);
    assert.equal(updated.warmup_seconds, 15);
    assert.equal(updated.warmupPoints, 12.5);
    assert.equal(updated.assets.reserve, 3);

    const repaired = await repo.addTimeStats(second.lastID, {
      serverSeconds: 7,
      warmupSeconds: 7,
      warmupPoints: 7,
    });
    assert.deepEqual(repaired.assets, { warmupPoints: 7 });

    const stats = await repo.getDatabaseStats();
    assert.equal(stats.overview.totalServerSeconds, 22);
    assert.equal(stats.overview.totalWarmupSeconds, 22);
    assert.equal(stats.overview.totalWarmupPoints, 19.5);
  } finally {
    await db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

await testSteamDurationAndOverrideLifecycle();
await testTimeStatsAssetsLifecycle();

console.log("player playtime override tests passed");
