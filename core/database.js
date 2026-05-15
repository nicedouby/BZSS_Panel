// -*- coding: utf-8 -*-

import fs from "node:fs";
import path from "node:path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

export async function createDatabase(config = {}) {
  const dbDir = path.resolve(process.cwd(), config.dir ?? "./data");
  const dbFile = path.resolve(dbDir, config.filename ?? "micepanel.db");
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });

  const db = await open({
    filename: dbFile,
    driver: sqlite3.Database,
  });

  await db.exec("PRAGMA journal_mode = WAL;");
  await db.exec("PRAGMA foreign_keys = ON;");
  await ensureMicePanelSchema(db);
  await runMigrations(db);
  await ensureCompatibleColumns(db);
  await migrateLegacyColumns(db);

  return db;
}

async function ensureMicePanelSchema(db) {
  await db.exec(`
CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    current_name TEXT,
    steam_id TEXT,
    eos_id TEXT,
    current_ip TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    game_seconds INTEGER NOT NULL DEFAULT 0,
    server_seconds INTEGER NOT NULL DEFAULT 0,
    commander_seconds INTEGER NOT NULL DEFAULT 0,
    squad_leader_seconds INTEGER NOT NULL DEFAULT 0,
    in_squad_seconds INTEGER NOT NULL DEFAULT 0,
    warmup_seconds INTEGER NOT NULL DEFAULT 0,
    permission_group TEXT NOT NULL DEFAULT 'default',
    ladder_rating INTEGER NOT NULL DEFAULT 1000,
    assets_json TEXT NOT NULL DEFAULT '{}',
    notes_json TEXT NOT NULL DEFAULT '{}',
    total_suicides INTEGER NOT NULL DEFAULT 0,
    total_reports_received INTEGER NOT NULL DEFAULT 0,
    total_reports_submitted INTEGER NOT NULL DEFAULT 0,
    total_squad_created INTEGER NOT NULL DEFAULT 0,
    total_matches INTEGER NOT NULL DEFAULT 0,
    total_match_wins INTEGER NOT NULL DEFAULT 0,
    total_lead_matches INTEGER NOT NULL DEFAULT 0,
    total_lead_wins INTEGER NOT NULL DEFAULT 0,
    total_cmd_matches INTEGER NOT NULL DEFAULT 0,
    total_cmd_wins INTEGER NOT NULL DEFAULT 0,
    UNIQUE(steam_id),
    UNIQUE(eos_id)
);

CREATE TABLE IF NOT EXISTS player_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    alias_name TEXT NOT NULL,
    seen_at INTEGER NOT NULL,
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_player_aliases_player ON player_aliases(player_id);

CREATE TABLE IF NOT EXISTS player_ips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    ip TEXT NOT NULL,
    seen_at INTEGER NOT NULL,
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_player_ips_player ON player_ips(player_id);

CREATE TABLE IF NOT EXISTS player_session_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    joined_at INTEGER NOT NULL,
    left_at INTEGER,
    duration_seconds INTEGER,
    source TEXT,
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS command_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    operator_name TEXT,
    command_text TEXT NOT NULL,
    command_result TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS report_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_player_id INTEGER,
    target_player_id INTEGER,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL,
    FOREIGN KEY(reporter_player_id) REFERENCES players(id) ON DELETE SET NULL,
    FOREIGN KEY(target_player_id) REFERENCES players(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS squad_create_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER,
    squad_id INTEGER,
    squad_name TEXT,
    team_name TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ladder_rating_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    old_rating INTEGER NOT NULL,
    new_rating INTEGER NOT NULL,
    reason TEXT,
    changed_at INTEGER NOT NULL,
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS match_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    map_name TEXT,
    layer_name TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    winner_team INTEGER,
    source TEXT
);

CREATE TABLE IF NOT EXISTS player_match_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    team_id INTEGER,
    was_squad_lead INTEGER NOT NULL DEFAULT 0,
    was_commander INTEGER NOT NULL DEFAULT 0,
    won INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(match_id) REFERENCES match_records(id) ON DELETE CASCADE,
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS log_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_event TEXT NOT NULL,
    event_name TEXT,
    raw_line TEXT,
    matched_player_name TEXT,
    created_at INTEGER NOT NULL,
    payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS player_warmup_stats (
    player_id INTEGER PRIMARY KEY,
    total_kills_light INTEGER NOT NULL DEFAULT 0,
    total_kills_other INTEGER NOT NULL DEFAULT 0,
    total_downed_light INTEGER NOT NULL DEFAULT 0,
    total_downed_other INTEGER NOT NULL DEFAULT 0,
    total_downed_light_fatal INTEGER NOT NULL DEFAULT 0,
    total_tk_down INTEGER NOT NULL DEFAULT 0,
    total_tk_kill INTEGER NOT NULL DEFAULT 0,
    total_deaths INTEGER NOT NULL DEFAULT 0,
    total_suicides INTEGER NOT NULL DEFAULT 0,
    total_downed_received INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS player_combat_stats (
    player_id INTEGER PRIMARY KEY,
    light_weapon_downs INTEGER NOT NULL DEFAULT 0,
    light_weapon_kills INTEGER NOT NULL DEFAULT 0,
    light_weapon_fatal_downs INTEGER NOT NULL DEFAULT 0,
    deaths INTEGER NOT NULL DEFAULT 0,
    tk_downs INTEGER NOT NULL DEFAULT 0,
    tk_kills INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_player_combat_stats_sort
ON player_combat_stats (
    light_weapon_kills DESC,
    light_weapon_downs DESC,
    light_weapon_fatal_downs DESC
);

CREATE TABLE IF NOT EXISTS player_warmup_combat_stats (
    player_id INTEGER PRIMARY KEY,
    downs INTEGER NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0,
    deaths INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_player_warmup_combat_stats_sort
ON player_warmup_combat_stats (
    kills DESC,
    downs DESC,
    deaths DESC
);

CREATE TABLE IF NOT EXISTS combat_log_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_event_id TEXT UNIQUE,
    server_id TEXT,
    match_id TEXT,
    map_name TEXT,
    layer_name TEXT,
    event_type TEXT NOT NULL,
    attacker_player_id INTEGER,
    victim_player_id INTEGER,
    attacker_name TEXT,
    victim_name TEXT,
    attacker_steam_id TEXT,
    attacker_eos_id TEXT,
    victim_steam_id TEXT,
    victim_eos_id TEXT,
    weapon TEXT,
    damage REAL,
    is_light_weapon INTEGER NOT NULL DEFAULT 0,
    is_teamkill INTEGER NOT NULL DEFAULT 0,
    is_fatal_down INTEGER NOT NULL DEFAULT 0,
    raw_line TEXT,
    payload_json TEXT,
    log_time INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(attacker_player_id) REFERENCES players(id) ON DELETE SET NULL,
    FOREIGN KEY(victim_player_id) REFERENCES players(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_combat_log_events_created_at
ON combat_log_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_combat_log_events_log_time
ON combat_log_events (log_time DESC);
CREATE INDEX IF NOT EXISTS idx_combat_log_events_attacker
ON combat_log_events (attacker_player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_combat_log_events_victim
ON combat_log_events (victim_player_id, created_at DESC);

CREATE TABLE IF NOT EXISTS combat_log_player_refs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    combat_log_event_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(combat_log_event_id) REFERENCES combat_log_events(id) ON DELETE CASCADE,
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE,
    UNIQUE(combat_log_event_id, player_id, role)
);
CREATE INDEX IF NOT EXISTS idx_combat_log_player_refs_player
ON combat_log_player_refs (player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_combat_log_player_refs_event
ON combat_log_player_refs (combat_log_event_id);

CREATE TABLE IF NOT EXISTS ip_lookup_cache (
  ip TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'none',
  source TEXT NOT NULL DEFAULT 'unknown',
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  isp TEXT NOT NULL DEFAULT '',
  org TEXT NOT NULL DEFAULT '',
  asn TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT '',
  latitude REAL,
  longitude REAL,
  is_private INTEGER NOT NULL DEFAULT 0,
  is_proxy INTEGER,
  is_hosting INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_ip_lookup_cache_updated ON ip_lookup_cache(updated_at);

CREATE TABLE IF NOT EXISTS player_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    tag_type TEXT NOT NULL,
    tag_value TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE,
    UNIQUE(player_id, tag_type, tag_value)
);
CREATE INDEX IF NOT EXISTS idx_player_tags_player ON player_tags(player_id);
CREATE INDEX IF NOT EXISTS idx_player_tags_type ON player_tags(tag_type);

CREATE TABLE IF NOT EXISTS player_violation_counts (
    player_id INTEGER NOT NULL,
    violation_key TEXT NOT NULL,
    violation_label TEXT,
    count INTEGER NOT NULL DEFAULT 0,
    first_at INTEGER,
    last_at INTEGER,
    PRIMARY KEY(player_id, violation_key),
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_player_violation_counts_player ON player_violation_counts(player_id);
CREATE INDEX IF NOT EXISTS idx_player_violation_counts_last ON player_violation_counts(last_at);

CREATE TABLE IF NOT EXISTS player_violation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    violation_key TEXT NOT NULL,
    violation_label TEXT,
    delta INTEGER NOT NULL,
    operator_name TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_player_violation_events_player ON player_violation_events(player_id);
CREATE INDEX IF NOT EXISTS idx_player_violation_events_at ON player_violation_events(created_at);

CREATE TABLE IF NOT EXISTS combat_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    date_key TEXT NOT NULL,
    file_path TEXT NOT NULL,
    first_event_at INTEGER NOT NULL,
    last_event_at INTEGER NOT NULL,
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE,
    UNIQUE(player_id, date_key, file_path)
);
CREATE INDEX IF NOT EXISTS idx_combat_sessions_player ON combat_sessions(player_id);
CREATE INDEX IF NOT EXISTS idx_combat_sessions_date ON combat_sessions(date_key);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);
  `);
}

async function runMigrations(db) {
  const applied = await db.all("SELECT version FROM schema_migrations ORDER BY version");
  const appliedSet = new Set(applied.map((row) => row.version));

  if (!appliedSet.has(1)) {
    const tableInfo = await db.all("PRAGMA table_info(players)");
    const cols = new Set(tableInfo.map((column) => column.name));

    if (cols.has("total_headshots") && !cols.has("total_downed_light_fatal")) {
      await db.run("ALTER TABLE players RENAME COLUMN total_headshots TO total_downed_light_fatal");
    }
    if (cols.has("total_kills_other_fatal") && !cols.has("total_downed_other")) {
      await db.run("ALTER TABLE players RENAME COLUMN total_kills_other_fatal TO total_downed_other");
    }
    if (cols.has("total_team_kills") && !cols.has("total_tk_down")) {
      await db.run("ALTER TABLE players RENAME COLUMN total_team_kills TO total_tk_down");
    }

    await db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", 1, Date.now());
  }

  if (!appliedSet.has(2)) {
    await db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", 2, Date.now());
  }

  if (!appliedSet.has(3)) {
    const tableInfo = await db.all("PRAGMA table_info(players)");
    const cols = new Set(tableInfo.map((column) => column.name));

    if (!cols.has("commander_seconds")) {
      await db.run("ALTER TABLE players ADD COLUMN commander_seconds INTEGER NOT NULL DEFAULT 0");
    }
    if (!cols.has("squad_leader_seconds")) {
      await db.run("ALTER TABLE players ADD COLUMN squad_leader_seconds INTEGER NOT NULL DEFAULT 0");
    }
    if (!cols.has("in_squad_seconds")) {
      await db.run("ALTER TABLE players ADD COLUMN in_squad_seconds INTEGER NOT NULL DEFAULT 0");
    }
    if (!cols.has("warmup_seconds")) {
      await db.run("ALTER TABLE players ADD COLUMN warmup_seconds INTEGER NOT NULL DEFAULT 0");
    }

    await db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", 3, Date.now());
  }

    if (!appliedSet.has(4)) {
    await db.exec(`
CREATE TABLE IF NOT EXISTS ip_lookup_cache (
    ip TEXT PRIMARY KEY,
    provider TEXT NOT NULL DEFAULT 'none',
    source TEXT NOT NULL DEFAULT 'unknown',
    country TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    isp TEXT NOT NULL DEFAULT '',
    org TEXT NOT NULL DEFAULT '',
    asn TEXT NOT NULL DEFAULT '',
    timezone TEXT NOT NULL DEFAULT '',
    latitude REAL,
    longitude REAL,
    is_private INTEGER NOT NULL DEFAULT 0,
    is_proxy INTEGER,
    is_hosting INTEGER,
    updated_at INTEGER NOT NULL DEFAULT 0,
    raw_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_ip_lookup_cache_updated ON ip_lookup_cache(updated_at);
    `);

    await db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", 4, Date.now());
  }

  if (!appliedSet.has(5)) {
    await db.exec(`
CREATE TABLE IF NOT EXISTS player_combat_stats (
    player_id INTEGER PRIMARY KEY,
    light_weapon_downs INTEGER NOT NULL DEFAULT 0,
    light_weapon_kills INTEGER NOT NULL DEFAULT 0,
    light_weapon_fatal_downs INTEGER NOT NULL DEFAULT 0,
    deaths INTEGER NOT NULL DEFAULT 0,
    tk_downs INTEGER NOT NULL DEFAULT 0,
    tk_kills INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_player_combat_stats_sort
ON player_combat_stats (
    light_weapon_kills DESC,
    light_weapon_downs DESC,
    light_weapon_fatal_downs DESC
);

CREATE TABLE IF NOT EXISTS player_warmup_combat_stats (
    player_id INTEGER PRIMARY KEY,
    downs INTEGER NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0,
    deaths INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_player_warmup_combat_stats_sort
ON player_warmup_combat_stats (
    kills DESC,
    downs DESC,
    deaths DESC
);

CREATE TABLE IF NOT EXISTS combat_log_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_event_id TEXT UNIQUE,
    server_id TEXT,
    match_id TEXT,
    map_name TEXT,
    layer_name TEXT,
    event_type TEXT NOT NULL,
    attacker_player_id INTEGER,
    victim_player_id INTEGER,
    attacker_name TEXT,
    victim_name TEXT,
    attacker_steam_id TEXT,
    attacker_eos_id TEXT,
    victim_steam_id TEXT,
    victim_eos_id TEXT,
    weapon TEXT,
    damage REAL,
    is_light_weapon INTEGER NOT NULL DEFAULT 0,
    is_teamkill INTEGER NOT NULL DEFAULT 0,
    is_fatal_down INTEGER NOT NULL DEFAULT 0,
    raw_line TEXT,
    payload_json TEXT,
    log_time INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(attacker_player_id) REFERENCES players(id) ON DELETE SET NULL,
    FOREIGN KEY(victim_player_id) REFERENCES players(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_combat_log_events_created_at
ON combat_log_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_combat_log_events_log_time
ON combat_log_events (log_time DESC);
CREATE INDEX IF NOT EXISTS idx_combat_log_events_attacker
ON combat_log_events (attacker_player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_combat_log_events_victim
ON combat_log_events (victim_player_id, created_at DESC);

CREATE TABLE IF NOT EXISTS combat_log_player_refs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    combat_log_event_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(combat_log_event_id) REFERENCES combat_log_events(id) ON DELETE CASCADE,
    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE,
    UNIQUE(combat_log_event_id, player_id, role)
);
CREATE INDEX IF NOT EXISTS idx_combat_log_player_refs_player
ON combat_log_player_refs (player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_combat_log_player_refs_event
ON combat_log_player_refs (combat_log_event_id);
    `);

    const tables = await db.all("SELECT name FROM sqlite_master WHERE type = 'table'");
    const names = new Set(tables.map((row) => row.name));
    if (names.has("players")) {
      const playerColumns = new Set((await db.all("PRAGMA table_info(players)")).map((row) => row.name));
      if (playerColumns.has("total_kills_light") || playerColumns.has("total_downed_light") || playerColumns.has("total_tk_down") || playerColumns.has("total_tk_kill") || playerColumns.has("total_deaths")) {
        await db.run(`
          INSERT OR REPLACE INTO player_combat_stats (
              player_id,
              light_weapon_downs,
              light_weapon_kills,
              light_weapon_fatal_downs,
              deaths,
              tk_downs,
              tk_kills,
              updated_at
          )
          SELECT
              id,
              COALESCE(total_downed_light, 0),
              COALESCE(total_kills_light, 0),
              COALESCE(total_downed_light_fatal, 0),
              COALESCE(total_deaths, 0),
              COALESCE(total_tk_down, 0),
              COALESCE(total_tk_kill, 0),
              COALESCE(updated_at, strftime('%s','now') * 1000)
          FROM players
        `);
      }
    }

    if (names.has("player_warmup_stats")) {
      await db.run(`
        INSERT OR REPLACE INTO player_warmup_combat_stats (
            player_id,
            downs,
            kills,
            deaths,
            updated_at
        )
        SELECT
            player_id,
            COALESCE(total_downed_light, 0) + COALESCE(total_downed_other, 0),
            COALESCE(total_kills_light, 0) + COALESCE(total_kills_other, 0),
            COALESCE(total_deaths, 0),
            COALESCE(updated_at, strftime('%s','now') * 1000)
        FROM player_warmup_stats
      `);
    }

    await db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", 5, Date.now());
  }
}

async function ensureCompatibleColumns(db) {
  const playerColumns = {
    current_name: "TEXT",
    steam_id: "TEXT",
    eos_id: "TEXT",
    current_ip: "TEXT",
    created_at: "INTEGER NOT NULL DEFAULT 0",
    updated_at: "INTEGER NOT NULL DEFAULT 0",
    game_seconds: "INTEGER NOT NULL DEFAULT 0",
    server_seconds: "INTEGER NOT NULL DEFAULT 0",
    commander_seconds: "INTEGER NOT NULL DEFAULT 0",
    squad_leader_seconds: "INTEGER NOT NULL DEFAULT 0",
    in_squad_seconds: "INTEGER NOT NULL DEFAULT 0",
    warmup_seconds: "INTEGER NOT NULL DEFAULT 0",
    permission_group: "TEXT NOT NULL DEFAULT 'default'",
    ladder_rating: "INTEGER NOT NULL DEFAULT 1000",
    assets_json: "TEXT NOT NULL DEFAULT '{}'",
    notes_json: "TEXT NOT NULL DEFAULT '{}'",
    total_suicides: "INTEGER NOT NULL DEFAULT 0",
    total_reports_received: "INTEGER NOT NULL DEFAULT 0",
    total_reports_submitted: "INTEGER NOT NULL DEFAULT 0",
    total_squad_created: "INTEGER NOT NULL DEFAULT 0",
    total_matches: "INTEGER NOT NULL DEFAULT 0",
    total_match_wins: "INTEGER NOT NULL DEFAULT 0",
    total_lead_matches: "INTEGER NOT NULL DEFAULT 0",
    total_lead_wins: "INTEGER NOT NULL DEFAULT 0",
    total_cmd_matches: "INTEGER NOT NULL DEFAULT 0",
    total_cmd_wins: "INTEGER NOT NULL DEFAULT 0",
  };

  for (const [column, definition] of Object.entries(playerColumns)) {
    await addColumnIfMissing(db, "players", column, definition);
  }

  await addColumnIfMissing(db, "player_aliases", "alias_name", "TEXT");
  await addColumnIfMissing(db, "player_aliases", "seen_at", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing(db, "player_ips", "ip", "TEXT");
  await addColumnIfMissing(db, "player_ips", "seen_at", "INTEGER NOT NULL DEFAULT 0");
}

async function migrateLegacyColumns(db) {
  const playerColumns = new Set((await db.all("PRAGMA table_info(players)")).map((row) => row.name));

  if (playerColumns.has("name")) {
    await db.run("UPDATE players SET current_name = COALESCE(current_name, name) WHERE current_name IS NULL OR current_name = ''");
  }
  if (playerColumns.has("last_seen_at")) {
    await db.run("UPDATE players SET updated_at = COALESCE(NULLIF(updated_at, 0), last_seen_at)");
  }
  if (playerColumns.has("total_playtime")) {
    await db.run("UPDATE players SET server_seconds = CASE WHEN server_seconds = 0 THEN total_playtime ELSE server_seconds END");
  }
  if (playerColumns.has("ladder_score")) {
    await db.run("UPDATE players SET ladder_rating = CASE WHEN ladder_rating = 1000 THEN ladder_score ELSE ladder_rating END");
  }
  if (playerColumns.has("assets")) {
    await db.run("UPDATE players SET assets_json = CASE WHEN assets_json = '{}' THEN assets ELSE assets_json END");
  }

  if (await tableExists(db, "kill_stats")) {
    const killColumns = new Set((await db.all("PRAGMA table_info(kill_stats)")).map((row) => row.name));
    if (killColumns.has("small_arm_kills")) {
      await db.run(`
        INSERT OR REPLACE INTO player_combat_stats (
            player_id,
            light_weapon_downs,
            light_weapon_kills,
            light_weapon_fatal_downs,
            deaths,
            tk_downs,
            tk_kills,
            updated_at
        )
        SELECT
            player_id,
            COALESCE(small_arm_incaps, 0),
            COALESCE(small_arm_kills, 0),
            COALESCE(headshot_kills, 0),
            COALESCE(deaths, 0),
            COALESCE(teamkill_incaps, 0),
            COALESCE(teamkill_kills, 0),
            COALESCE(updated_at, strftime('%s','now') * 1000)
        FROM kill_stats
      `);
    }
  }

  if (await tableExists(db, "match_stats")) {
    await db.run(`
      UPDATE players
      SET total_matches = COALESCE((SELECT total_matches FROM match_stats WHERE match_stats.player_id = players.id), total_matches),
          total_match_wins = COALESCE((SELECT wins FROM match_stats WHERE match_stats.player_id = players.id), total_match_wins),
          total_lead_matches = COALESCE((SELECT squad_leader_matches FROM match_stats WHERE match_stats.player_id = players.id), total_lead_matches),
          total_lead_wins = COALESCE((SELECT squad_leader_wins FROM match_stats WHERE match_stats.player_id = players.id), total_lead_wins),
          total_cmd_matches = COALESCE((SELECT commander_matches FROM match_stats WHERE match_stats.player_id = players.id), total_cmd_matches),
          total_cmd_wins = COALESCE((SELECT commander_wins FROM match_stats WHERE match_stats.player_id = players.id), total_cmd_wins)
      WHERE EXISTS (SELECT 1 FROM match_stats WHERE match_stats.player_id = players.id)
    `);
  }

  const aliasColumns = new Set((await db.all("PRAGMA table_info(player_aliases)")).map((row) => row.name));
  if (aliasColumns.has("name")) {
    await db.run("UPDATE player_aliases SET alias_name = COALESCE(alias_name, name)");
  }
  if (aliasColumns.has("last_seen_at")) {
    await db.run("UPDATE player_aliases SET seen_at = CASE WHEN seen_at = 0 THEN last_seen_at ELSE seen_at END");
  }

  const ipColumns = new Set((await db.all("PRAGMA table_info(player_ips)")).map((row) => row.name));
  if (ipColumns.has("ipAddress")) {
    await db.run("UPDATE player_ips SET ip = COALESCE(ip, ipAddress)");
  }
  if (ipColumns.has("ip_address")) {
    await db.run("UPDATE player_ips SET ip = COALESCE(ip, ip_address)");
  }
  if (ipColumns.has("lastSeenAt")) {
    await db.run("UPDATE player_ips SET seen_at = CASE WHEN seen_at = 0 THEN lastSeenAt ELSE seen_at END");
  }
  if (ipColumns.has("last_seen_at")) {
    await db.run("UPDATE player_ips SET seen_at = CASE WHEN seen_at = 0 THEN last_seen_at ELSE seen_at END");
  }
}

async function addColumnIfMissing(db, table, column, definition) {
  if (!(await tableExists(db, table))) return;
  const info = await db.all(`PRAGMA table_info(${table})`);
  if (info.some((row) => row.name === column)) return;
  await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function tableExists(db, table) {
  const row = await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", table);
  return Boolean(row);
}
