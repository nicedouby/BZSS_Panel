// -*- coding: utf-8 -*-

import { createDatabase } from "../../core/database.js";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

export function createSquadManagementRepository({ config, logger } = {}) {
  const databaseConfig = config?.get?.("modules.squadManagement.database", null)
    ?? config?.get?.("database", null)
    ?? {};
  let db = null;
  let tableShape = null;

  return {
    async init() {
      db = await createDatabase(databaseConfig);
      await ensureSchema(db);
      tableShape = await inspectTableShape(db);
      return db;
    },

    async close() {
      if (!db?.close) return;
      await db.close();
      db = null;
    },

    async insertRecord(record = {}) {
      const database = await ensureDb();
      const shape = await ensureTableShape(database);
      const row = normalizeRecord(record);
      const legacyRow = {
        ...row,
        // Older databases keep these columns NOT NULL, so preserve legacy compatibility
        // while still letting the service layer work with null semantics.
        teamId: row.teamId ?? 0,
        squadId: row.squadId ?? 0,
      };

      const columns = [];
      const values = [];
      appendColumn(columns, values, "record_key", legacyRow.recordKey);
      appendColumn(columns, values, "kind", legacyRow.kind, shape.hasKind);
      appendColumn(columns, values, "record_type", legacyRow.kind, shape.hasRecordType);
      appendColumn(columns, values, "time", legacyRow.time);
      appendColumn(columns, values, "time_ms", legacyRow.timeMs, shape.hasTimeMs);
      appendColumn(columns, values, "log_time", legacyRow.logTime);
      appendColumn(columns, values, "log_seconds", legacyRow.logSeconds, shape.hasLogSeconds);
      appendColumn(columns, values, "server_id", legacyRow.serverId);
      appendColumn(columns, values, "match_id", legacyRow.matchId);
      appendColumn(columns, values, "source", legacyRow.source);
      appendColumn(columns, values, "operator_name", legacyRow.operatorName);
      appendColumn(columns, values, "actor_name", legacyRow.actorName);
      appendColumn(columns, values, "actor_id", legacyRow.actorId);
      appendColumn(columns, values, "system", legacyRow.system, shape.hasSystem);
      appendColumn(columns, values, "team_id", legacyRow.teamId);
      appendColumn(columns, values, "squad_id", legacyRow.squadId);
      appendColumn(columns, values, "generation", legacyRow.generation);
      appendColumn(columns, values, "squad_name", legacyRow.squadName);
      appendColumn(columns, values, "team_name", legacyRow.teamName);
      appendColumn(columns, values, "creator_name", legacyRow.creatorName);
      appendColumn(columns, values, "creator_eos_id", legacyRow.creatorEosId);
      appendColumn(columns, values, "creator_steam_id", legacyRow.creatorSteamId);
      appendColumn(columns, values, "player_name", legacyRow.playerName);
      appendColumn(columns, values, "player_eos_id", legacyRow.playerEosId);
      appendColumn(columns, values, "player_steam_id", legacyRow.playerSteamId);
      appendColumn(columns, values, "steam_id", legacyRow.steamId);
      appendColumn(columns, values, "eos_id", legacyRow.eosId);
      appendColumn(columns, values, "player_key", legacyRow.playerKey);
      appendColumn(columns, values, "reason", legacyRow.reason);
      appendColumn(columns, values, "result", legacyRow.result);
      appendColumn(columns, values, "error", legacyRow.error);
      appendColumn(columns, values, "command", legacyRow.command);
      appendColumn(columns, values, "payload_json", legacyRow.payloadJson);
      appendColumn(columns, values, "creation_signature", legacyRow.creationSignature);
      appendColumn(columns, values, "created_at", legacyRow.createdAt);
      appendColumn(columns, values, "updated_at", legacyRow.updatedAt);

      await database.run(
        `INSERT INTO squad_management_records (${columns.join(", ")})
         VALUES (${columns.map(() => "?").join(", ")})
         ON CONFLICT(record_key) DO NOTHING`,
        ...values,
      );

      return row;
    },

    async listRecords(query = {}) {
      const database = await ensureDb();
      const kind = normalizeKindFilter(query.kind ?? query.type ?? "all");
      const limit = normalizeLimit(query.limit);
      const offset = normalizeOffset(query.offset);
      const shape = await ensureTableShape(database);
      const clauses = [];
      const params = [];

      if (query.serverId) {
        clauses.push("server_id = ?");
        params.push(String(query.serverId).trim());
      }

      if (query.matchId) {
        clauses.push("match_id = ?");
        params.push(String(query.matchId).trim());
      }

      if (kind !== "all") {
        if (kind === "action") {
          clauses.push(`(${kindExpr(shape)} = 'disband' OR ${kindExpr(shape)} = 'kick' OR ${kindExpr(shape)} = 'remove' OR ${kindExpr(shape)} = 'switch_team' OR ${kindExpr(shape)} = 'action')`);
        } else {
          clauses.push(`${kindExpr(shape)} = ?`);
          params.push(kind);
        }
      }

      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = await database.all(
        `SELECT *
         FROM squad_management_records
         ${where}
         ORDER BY COALESCE(time_ms, created_at, 0) DESC, id DESC
         LIMIT ? OFFSET ?`,
        ...params,
        limit,
        offset,
      );

      return rows.map(mapRecordRow);
    },

    async getSummary(query = {}) {
      const database = await ensureDb();
      const shape = await ensureTableShape(database);
      const clauses = [];
      const params = [];

      if (query.serverId) {
        clauses.push("server_id = ?");
        params.push(String(query.serverId).trim());
      }

      if (query.matchId) {
        clauses.push("match_id = ?");
        params.push(String(query.matchId).trim());
      }

      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const totalRow = await database.get(
        `SELECT
           COUNT(*) AS total,
           MAX(${timeMsExpr(shape)}) AS last_event_time_ms
         FROM squad_management_records
         ${where}`,
        ...params,
      );

      const byKindRows = await database.all(
        `SELECT ${kindExpr(shape)} AS kind, COUNT(*) AS count
         FROM squad_management_records
         ${where}
         GROUP BY ${kindExpr(shape)}`,
        ...params,
      );

      const byResultRows = await database.all(
        `SELECT result, COUNT(*) AS count
         FROM squad_management_records
         ${where}
         GROUP BY result`,
        ...params,
      );

      const byKind = Object.fromEntries(byKindRows.map((row) => [String(row.kind ?? ""), Number(row.count ?? 0)]));
      const byResult = Object.fromEntries(byResultRows.map((row) => [String(row.result ?? ""), Number(row.count ?? 0)]));
      const actionTotal = Number(byKind.disband ?? 0) + Number(byKind.kick ?? 0) + Number(byKind.remove ?? 0) + Number(byKind.switch_team ?? 0) + Number(byKind.action ?? 0);
      const success = Number(byResult.success ?? 0);
      const failed = Number(byResult.failed ?? 0) + Number(byResult.forbidden ?? 0) + Number(byResult.invalid ?? 0);

      return {
        total: Number(totalRow?.total ?? 0),
        created: Number(byKind.squad_created ?? 0),
        disbanded: Number(byKind.disband ?? 0),
        kicked: Number(byKind.kick ?? 0),
        removed: Number(byKind.remove ?? 0),
        switched: Number(byKind.switch_team ?? 0),
        actions: actionTotal,
        success,
        failed,
        lastEventAt: iso(totalRow?.last_event_time_ms ?? 0),
        byKind,
        byResult,
      };
    },
  };

  async function ensureDb() {
    if (db) return db;
    db = await createDatabase(databaseConfig);
    await ensureSchema(db);
    tableShape = await inspectTableShape(db);
    return db;
  }

  async function ensureTableShape(database) {
    if (tableShape) return tableShape;
    tableShape = await inspectTableShape(database);
    return tableShape;
  }
}

async function ensureSchema(db) {
  await db.exec(`
CREATE TABLE IF NOT EXISTS squad_management_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  record_key TEXT NOT NULL UNIQUE,

  kind TEXT NOT NULL DEFAULT '',
  time TEXT NOT NULL DEFAULT '',
  time_ms INTEGER NOT NULL DEFAULT 0,

  log_time TEXT DEFAULT '',
  log_seconds INTEGER,

  server_id TEXT NOT NULL DEFAULT '',
  match_id TEXT DEFAULT '',

  source TEXT DEFAULT '',
  operator_name TEXT DEFAULT '',
  actor_name TEXT DEFAULT '',
  actor_id TEXT DEFAULT '',
  system INTEGER DEFAULT 0,

  team_id INTEGER,
  squad_id INTEGER,
  generation INTEGER,

  squad_name TEXT DEFAULT '',
  team_name TEXT DEFAULT '',

  creator_name TEXT DEFAULT '',
  creator_eos_id TEXT DEFAULT '',
  creator_steam_id TEXT DEFAULT '',

  player_name TEXT DEFAULT '',
  player_eos_id TEXT DEFAULT '',
  player_steam_id TEXT DEFAULT '',

  steam_id TEXT DEFAULT '',
  eos_id TEXT DEFAULT '',
  player_key TEXT DEFAULT '',

  reason TEXT DEFAULT '',
  result TEXT DEFAULT '',
  error TEXT DEFAULT '',
  command TEXT DEFAULT '',

  payload_json TEXT DEFAULT '{}',

  record_type TEXT DEFAULT '',
  creation_signature TEXT DEFAULT '',
  created_at INTEGER DEFAULT 0,
  updated_at INTEGER DEFAULT 0
);
  `);

  await addColumnIfMissing(db, "squad_management_records", "kind", "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "time", "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "time_ms", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing(db, "squad_management_records", "log_time", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "log_seconds", "INTEGER");
  await addColumnIfMissing(db, "squad_management_records", "server_id", "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "match_id", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "source", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "operator_name", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "actor_name", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "actor_id", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "system", "INTEGER DEFAULT 0");
  await addColumnIfMissing(db, "squad_management_records", "team_id", "INTEGER");
  await addColumnIfMissing(db, "squad_management_records", "squad_id", "INTEGER");
  await addColumnIfMissing(db, "squad_management_records", "generation", "INTEGER");
  await addColumnIfMissing(db, "squad_management_records", "squad_name", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "team_name", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "creator_name", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "creator_eos_id", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "creator_steam_id", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "player_name", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "player_eos_id", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "player_steam_id", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "steam_id", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "eos_id", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "player_key", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "reason", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "result", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "error", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "command", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "payload_json", "TEXT DEFAULT '{}'");
  await addColumnIfMissing(db, "squad_management_records", "record_type", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "creation_signature", "TEXT DEFAULT ''");
  await addColumnIfMissing(db, "squad_management_records", "created_at", "INTEGER DEFAULT 0");
  await addColumnIfMissing(db, "squad_management_records", "updated_at", "INTEGER DEFAULT 0");

  await db.run(
    "UPDATE squad_management_records SET kind = COALESCE(NULLIF(kind, ''), record_type) WHERE COALESCE(kind, '') = ''",
  );
  await db.run(
    "UPDATE squad_management_records SET time_ms = COALESCE(NULLIF(time_ms, 0), created_at) WHERE COALESCE(time_ms, 0) = 0",
  );

  await createIndexIfMissing(db, "idx_squad_mgmt_records_server_match", "server_id, match_id");
  if ((await inspectTableShape(db)).hasKind) {
    await createIndexIfMissing(db, "idx_squad_mgmt_records_kind_time", "kind, time_ms DESC");
  }
  await createIndexIfMissing(db, "idx_squad_mgmt_records_player", "player_key");
  await createIndexIfMissing(db, "idx_squad_mgmt_records_squad", "server_id, match_id, team_id, squad_id");
}

async function addColumnIfMissing(db, table, column, definition) {
  const info = await db.all(`PRAGMA table_info(${table})`);
  if (info.some((row) => row.name === column)) return;
  await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function createIndexIfMissing(db, indexName, columnsSql) {
  const row = await db.get("SELECT name FROM sqlite_master WHERE type='index' AND name = ?", indexName);
  if (row) return;
  await db.run(`CREATE INDEX ${indexName} ON squad_management_records(${columnsSql})`);
}

async function inspectTableShape(db) {
  const info = await db.all("PRAGMA table_info(squad_management_records)");
  const columns = new Set(info.map((row) => row.name));
  return {
    hasKind: columns.has("kind"),
    hasRecordType: columns.has("record_type"),
    hasTimeMs: columns.has("time_ms"),
    hasLogSeconds: columns.has("log_seconds"),
    hasSystem: columns.has("system"),
  };
}

function appendColumn(columns, values, column, value, include = true) {
  if (!include) return;
  columns.push(column);
  values.push(value);
}

function kindExpr(shape) {
  if (shape.hasKind) return "kind";
  if (shape.hasRecordType) return "record_type";
  return "''";
}

function timeMsExpr(shape) {
  const parts = [];
  if (shape.hasTimeMs) parts.push("NULLIF(time_ms, 0)");
  parts.push("NULLIF(created_at, 0)");
  return `COALESCE(${parts.join(", ")}, 0)`;
}

function normalizeRecord(record = {}) {
  const timeMs = normalizeTimeMs(record.timeMs ?? record.createdAt ?? record.created_at ?? record.time);
  const timeText = normalizeText(record.time) || iso(timeMs);
  const logTime = normalizeText(record.logTime ?? record.log_time);
  const recordKey = normalizeText(record.recordKey ?? record.record_key) || buildRecordKey(record, timeMs, timeText);
  const kind = normalizeText(record.kind ?? record.record_type ?? "action") || "action";
  const payload = record.payloadJson ?? record.payload_json ?? record.payload ?? {};
  const creatorSteamId = normalizeText(record.creatorSteamId ?? record.creator_steam_id);
  const creatorEosId = normalizeText(record.creatorEosId ?? record.creator_eos_id);
  const playerSteamId = normalizeText(record.playerSteamId ?? record.player_steam_id);
  const playerEosId = normalizeText(record.playerEosId ?? record.player_eos_id);
  const steamId = normalizeText(record.steamId ?? record.steam_id ?? playerSteamId ?? creatorSteamId);
  const eosId = normalizeText(record.eosId ?? record.eos_id ?? playerEosId ?? creatorEosId);
  const playerKey = normalizeText(record.playerKey ?? record.player_key)
    || buildPlayerKey({ playerId: record.playerId, steamId, eosId, playerName: record.playerName ?? record.creatorName });

  return {
    recordKey,
    kind,
    time: timeText,
    timeMs,
    logTime: logTime || timeText,
    logSeconds: normalizeNullableNumber(record.logSeconds ?? record.log_seconds),
    serverId: normalizeText(record.serverId ?? record.server_id),
    matchId: normalizeText(record.matchId ?? record.match_id),
    source: normalizeText(record.source),
    operatorName: normalizeText(record.operatorName ?? record.operator_name),
    actorName: normalizeText(record.actorName ?? record.actor_name),
    actorId: normalizeText(record.actorId ?? record.actor_id),
    system: Boolean(record.system) ? 1 : 0,
    teamId: normalizeNullableNumber(record.teamId ?? record.team_id),
    squadId: normalizeNullableNumber(record.squadId ?? record.squad_id),
    generation: normalizeNullableNumber(record.generation),
    squadName: normalizeText(record.squadName ?? record.squad_name),
    teamName: normalizeText(record.teamName ?? record.team_name),
    creatorName: normalizeText(record.creatorName ?? record.creator_name),
    creatorEosId,
    creatorSteamId,
    playerName: normalizeText(record.playerName ?? record.player_name),
    playerEosId,
    playerSteamId,
    steamId,
    eosId,
    playerKey,
    reason: normalizeText(record.reason),
    result: normalizeText(record.result),
    error: normalizeText(record.error),
    command: normalizeText(record.command),
    payloadJson: stringifyJson(payload),
    creationSignature: normalizeText(record.creationSignature ?? record.creation_signature),
    createdAt: Number(record.createdAt ?? record.created_at ?? timeMs ?? 0) || timeMs,
    updatedAt: Number(record.updatedAt ?? record.updated_at ?? timeMs ?? 0) || timeMs,
  };
}

function mapRecordRow(row = {}) {
  return {
    id: Number(row.id ?? 0),
    recordKey: normalizeText(row.record_key),
    kind: normalizeText(row.kind || row.record_type),
    time: normalizeText(row.time),
    timeMs: Number(row.time_ms ?? row.created_at ?? 0) || 0,
    logTime: normalizeText(row.log_time),
    logSeconds: row.log_seconds == null ? null : Number(row.log_seconds),
    serverId: normalizeText(row.server_id),
    matchId: normalizeText(row.match_id),
    source: normalizeText(row.source),
    operatorName: normalizeText(row.operator_name),
    actorName: normalizeText(row.actor_name),
    actorId: normalizeText(row.actor_id),
    system: Boolean(Number(row.system ?? 0)),
    teamId: row.team_id == null || Number(row.team_id) === 0 ? null : Number(row.team_id),
    squadId: row.squad_id == null || Number(row.squad_id) === 0 ? null : Number(row.squad_id),
    generation: row.generation == null ? null : Number(row.generation),
    squadName: normalizeText(row.squad_name),
    teamName: normalizeText(row.team_name),
    creatorName: normalizeText(row.creator_name),
    creatorEosId: normalizeText(row.creator_eos_id),
    creatorSteamId: normalizeText(row.creator_steam_id),
    playerName: normalizeText(row.player_name),
    playerEosId: normalizeText(row.player_eos_id),
    playerSteamId: normalizeText(row.player_steam_id),
    steamId: normalizeText(row.steam_id || row.player_steam_id || row.creator_steam_id),
    eosId: normalizeText(row.eos_id || row.player_eos_id || row.creator_eos_id),
    playerKey: normalizeText(row.player_key),
    reason: normalizeText(row.reason),
    result: normalizeText(row.result),
    error: normalizeText(row.error),
    command: normalizeText(row.command),
    creationSignature: normalizeText(row.creation_signature),
    payload: parseJson(row.payload_json),
    createdAt: Number(row.created_at ?? row.time_ms ?? 0) || 0,
    updatedAt: Number(row.updated_at ?? row.time_ms ?? 0) || 0,
  };
}

function normalizeKindFilter(kind) {
  const value = normalizeText(kind).toLowerCase();
  if (value === "created" || value === "squad_created") return "squad_created";
  if (value === "remove") return "remove";
  if (value === "switch" || value === "switch_team" || value === "team_balance") return "switch_team";
  if (value === "disband" || value === "kick" || value === "action" || value === "all") return value;
  return "all";
}

function normalizeLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(number));
}

function normalizeOffset(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

function normalizeNullableNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function normalizeTimeMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (!value) return Date.now();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function stringifyJson(value) {
  if (value == null) return "{}";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "{}";
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      return JSON.stringify({ value: trimmed });
    }
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function parseJson(value) {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function buildRecordKey(record, timeMs, timeText) {
  return [
    normalizeText(record.kind ?? record.record_type ?? "action"),
    normalizeText(record.serverId ?? record.server_id),
    normalizeText(record.matchId ?? record.match_id),
    normalizeText(record.source),
    normalizeText(record.operatorName ?? record.operator_name),
    normalizeText(record.teamId ?? record.team_id),
    normalizeText(record.squadId ?? record.squad_id),
    normalizeText(record.playerKey ?? record.player_key ?? record.playerName ?? record.creatorName),
    normalizeText(record.command),
    String(timeMs || timeText || Date.now()),
  ].filter(Boolean).join(":");
}

function buildPlayerKey({ playerId, steamId, eosId, playerName } = {}) {
  const pid = normalizeText(playerId);
  const steam = normalizeText(steamId);
  const eos = normalizeText(eosId);
  const name = normalizeText(playerName);
  if (pid) return `player:${pid}`;
  if (steam) return `steam:${steam}`;
  if (eos) return `eos:${eos}`;
  if (name) return `name:${name}`;
  return "";
}

function iso(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  return new Date(number).toISOString();
}
