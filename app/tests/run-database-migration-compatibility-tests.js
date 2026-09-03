import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { createDatabase } from "../core/database.js";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-database-migration-"));
const dbFile = path.join(tempDir, "micepanel.db");

try {
  const legacyDb = await open({
    filename: dbFile,
    driver: sqlite3.Database,
  });

  await legacyDb.exec(`
    CREATE TABLE match_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      map_name TEXT,
      layer_name TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      winner_team INTEGER,
      source TEXT
    );
  `);
  await legacyDb.run(
    "INSERT INTO match_records (map_name, layer_name, started_at, source) VALUES (?, ?, ?, ?)",
    "Mutaha",
    "Mutaha_RAAS_v1",
    1234567890,
    "legacy-test",
  );
  await legacyDb.close();

  const db = await createDatabase({ dir: tempDir, filename: "micepanel.db" });

  const columns = await db.all("PRAGMA table_info(match_records)");
  const columnNames = new Set(columns.map((column) => column.name));
  for (const column of [
    "round_key",
    "snapshot_id",
    "server_id",
    "mode",
  ]) {
    assert.equal(columnNames.has(column), true, `missing migrated column: ${column}`);
  }

  const preservedRow = await db.get(
    "SELECT map_name, layer_name, started_at, source FROM match_records WHERE id = 1",
  );
  assert.deepEqual(preservedRow, {
    map_name: "Mutaha",
    layer_name: "Mutaha_RAAS_v1",
    started_at: 1234567890,
    source: "legacy-test",
  });

  const indexes = await db.all("PRAGMA index_list(match_records)");
  assert.equal(
    indexes.some((index) => index.name === "idx_match_records_round_key"),
    true,
    "missing idx_match_records_round_key",
  );

  await db.close();
  console.log("database migration compatibility test passed");
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
