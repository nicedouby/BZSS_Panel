import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createDatabase } from "../core/database.js";
import { PlayerRepository } from "../repositories/player-repository.js";

async function createTempRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-player-career-"));
  const db = await createDatabase({ dir, filename: "test.db" });
  const repo = new PlayerRepository(db);
  await repo.hydrateCache();
  return { dir, db, repo };
}

function snapshot(roundKey, snapshotId, winner = "Team 1") {
  return {
    roundKey,
    snapshotId,
    capturedAt: "2026-09-02T12:00:00.000Z",
    trigger: { winner },
    server: { serverId: "BZSS_Main" },
    match: { map: "Yehorivka", layer: "Yehorivka_RAAS_v2", mode: "RAAS", playtime: 3600 },
    players: [
      {
        name: "Alpha",
        steamID: "76561198000000001",
        eosID: "eos-alpha",
        teamID: 1,
        isLeader: true,
        bzssCore: {
          available: true,
          kills: 14,
          deaths: 4,
          downs: 18,
          wounds: 2,
          teamKills: 1,
          vehicleKills: 1,
          revives: 3,
          healPoints: 450,
          combatScore: 1200,
          objectiveScore: 300,
          teamworkScore: 800,
        },
      },
      {
        name: "Bravo",
        steamID: "76561198000000002",
        eosID: "eos-bravo",
        teamID: 2,
        bzssCore: {
          available: true,
          kills: 8,
          deaths: 9,
          downs: 11,
          wounds: 1,
          teamKills: 0,
        },
      },
      {
        name: "No Stable Identity",
        teamID: 1,
        bzssCore: { available: true, kills: 99 },
      },
    ],
  };
}

async function testPersistentIdempotentSettlement() {
  const { dir, db, repo } = await createTempRepo();
  try {
    const payload = snapshot("BZSS_Main:round-1", "snapshot-1");
    const first = await repo.settleMatchSnapshot(payload, { snapshotId: "snapshot-1" });
    assert.equal(first.settled, true);
    assert.equal(first.playerCount, 2);
    assert.equal(first.skippedPlayerCount, 1);

    const duplicate = await repo.settleMatchSnapshot(payload, { snapshotId: "snapshot-1" });
    assert.equal(duplicate.settled, false);
    assert.equal(duplicate.duplicate, true);

    const alpha = await repo.findByIdentity({ steamID: "76561198000000001" });
    const alphaCareer = await repo.getPlayerCareerStats(alpha.id);
    assert.deepEqual(
      {
        matches: alphaCareer.matches,
        wins: alphaCareer.wins,
        kills: alphaCareer.kills,
        deaths: alphaCareer.deaths,
        downs: alphaCareer.downs,
        teamKills: alphaCareer.teamKills,
      },
      { matches: 1, wins: 1, kills: 14, deaths: 4, downs: 18, teamKills: 1 },
    );
    assert.equal(alphaCareer.kd, 3.5);
    assert.equal(alphaCareer.winRate, 1);

    const alphaRow = await repo.getPlayerById(alpha.id);
    assert.equal(alphaRow.total_matches, 1);
    assert.equal(alphaRow.total_match_wins, 1);
    assert.equal(alphaRow.total_lead_matches, 1);
    assert.equal(alphaRow.total_lead_wins, 1);

    const detail = await repo.getPlayerDetail(alpha.id);
    assert.equal(detail.career.kills, 14);
    assert.equal(detail.summary.totalKills, 14);
    const matches = await repo.listPlayerContainer(alpha.id, "matches", { limit: 10 });
    assert.equal(matches.items.length, 1);
    assert.equal(matches.items[0].round_key, "BZSS_Main:round-1");
    assert.equal(matches.items[0].kills, 14);
    assert.equal(matches.items[0].won, 1);

    const second = await repo.settleMatchSnapshot(
      snapshot("BZSS_Main:round-2", "snapshot-2", "Team 2"),
      { snapshotId: "snapshot-2" },
    );
    assert.equal(second.settled, true);
    const accumulated = await repo.getPlayerCareerStats(alpha.id);
    assert.equal(accumulated.matches, 2);
    assert.equal(accumulated.wins, 1);
    assert.equal(accumulated.kills, 28);
    assert.equal(accumulated.deaths, 8);

    const snapshotCollision = await repo.settleMatchSnapshot(
      snapshot("BZSS_Main:round-3", "snapshot-2"),
      { snapshotId: "snapshot-2" },
    );
    assert.equal(snapshotCollision.duplicate, true);

    const settlements = await db.get("SELECT COUNT(*) AS count FROM match_career_settlements");
    const matchRecords = await db.get("SELECT COUNT(*) AS count FROM match_records");
    assert.equal(settlements.count, 2);
    assert.equal(matchRecords.count, 2);
  } finally {
    await db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function testStrongIdentityDoesNotMergeByName() {
  const { dir, db, repo } = await createTempRepo();
  try {
    const old = await repo.upsertFromPresence({ name: "Same Name", steamID: "76561198000000010" });
    const result = await repo.settleMatchSnapshot({
      ...snapshot("BZSS_Main:identity-round", "identity-snapshot"),
      players: [{
        name: "Same Name",
        steamID: "76561198000000011",
        teamID: 1,
        bzssCore: { available: true, kills: 2, deaths: 1, downs: 3, teamKills: 0 },
      }],
    }, { snapshotId: "identity-snapshot" });
    assert.equal(result.settled, true);
    const newer = await repo.findByIdentity({ steamID: "76561198000000011" });
    assert.notEqual(newer.id, old.id);
  } finally {
    await db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

await testPersistentIdempotentSettlement();
await testStrongIdentityDoesNotMergeByName();

console.log("player career stats tests passed");
