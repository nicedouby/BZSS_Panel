// -*- coding: utf-8 -*-

import fs from "node:fs";
import path from "node:path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

export async function createSteamPlaytimeDatabase(config = {}) {
  const dbDir = path.resolve(process.cwd(), config.dir ?? "./data");
  const dbFile = path.resolve(dbDir, config.filename ?? "steam_playtime.db");
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });

  const db = await open({
    filename: dbFile,
    driver: sqlite3.Database,
  });

  await db.exec("PRAGMA journal_mode = WAL;");
  await db.exec("PRAGMA foreign_keys = ON;");
  await db.exec("PRAGMA busy_timeout = 5000;");
  await ensureSchema(db);
  await migrateLegacySteamPlaytime(db, config.legacyPath ?? "./MicePanel/data/steam_playtime.db", dbFile);

  return db;
}

async function ensureSchema(db) {
  await db.exec(`
CREATE TABLE IF NOT EXISTS steam_playtimes (
    steam_id TEXT PRIMARY KEY,
    app_id INTEGER NOT NULL,
    game_name TEXT NOT NULL,
    game_seconds INTEGER NOT NULL,
    fetched_at INTEGER NOT NULL,
    last_seen_name TEXT
);
CREATE INDEX IF NOT EXISTS idx_steam_playtimes_fetched_at ON steam_playtimes(fetched_at);

CREATE TABLE IF NOT EXISTS steam_playtime_refresh_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT,
    job_type TEXT NOT NULL,
    steam_id TEXT,
    player_id INTEGER,
    player_name TEXT,
    status TEXT NOT NULL,
    message TEXT,
    game_seconds INTEGER,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_steam_playtime_refresh_logs_created ON steam_playtime_refresh_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_steam_playtime_refresh_logs_steam ON steam_playtime_refresh_logs(steam_id);

CREATE TABLE IF NOT EXISTS steam_playtime_migrations (
    key TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
);
  `);
}

async function migrateLegacySteamPlaytime(db, legacyPath, currentDbFile) {
  const source = path.resolve(process.cwd(), String(legacyPath || "").trim());
  if (!source || source === path.resolve(currentDbFile) || !fs.existsSync(source)) return;

  const migrationKey = `legacy:${source}`;
  const existing = await db.get("SELECT key FROM steam_playtime_migrations WHERE key = ?", migrationKey);
  if (existing) return;

  const legacyDb = await open({
    filename: source,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READONLY,
  });

  await db.exec("BEGIN");
  try {
    const legacyTable = await legacyDb.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'steam_playtimes'");

    if (legacyTable) {
      const rows = await legacyDb.all(`
        SELECT steam_id, app_id, game_name, game_seconds, fetched_at, last_seen_name
        FROM steam_playtimes
        WHERE steam_id IS NOT NULL AND TRIM(steam_id) <> ''
      `);

      for (const row of rows) {
        await db.run(`
INSERT INTO steam_playtimes (steam_id, app_id, game_name, game_seconds, fetched_at, last_seen_name)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(steam_id) DO UPDATE SET
    app_id = excluded.app_id,
    game_name = excluded.game_name,
    game_seconds = MAX(steam_playtimes.game_seconds, excluded.game_seconds),
    fetched_at = MAX(steam_playtimes.fetched_at, excluded.fetched_at),
    last_seen_name = COALESCE(excluded.last_seen_name, steam_playtimes.last_seen_name)
        `, row.steam_id, row.app_id, row.game_name, row.game_seconds, row.fetched_at, row.last_seen_name);
      }
    }

    await db.run(
      "INSERT OR REPLACE INTO steam_playtime_migrations (key, applied_at) VALUES (?, ?)",
      migrationKey,
      Date.now(),
    );
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  } finally {
    await legacyDb.close();
  }
}
