// -*- coding: utf-8 -*-

function normalizeSteamID(value) {
  const raw = String(value || "").trim();
  return raw || null;
}

function normalizeSeconds(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

export class SteamPlaytimeRepository {
  constructor(db) {
    this.db = db;
  }

  async upsertFromLookup(steamID, lookup = {}, { lastSeenName = null } = {}) {
    const id = normalizeSteamID(steamID);
    if (!id) return null;

    const appId = Math.max(0, Math.floor(Number(lookup.appId) || 0));
    const gameName = String(lookup.gameName || "Squad");
    const gameSeconds = normalizeSeconds(lookup.gameSeconds);
    const fetchedAt = Math.max(0, Math.floor(Number(lookup.fetchedAt) || Date.now()));
    const safeName = typeof lastSeenName === "string" && lastSeenName.trim() ? lastSeenName.trim() : null;

    await this.db.run(
      `
INSERT INTO steam_playtimes (
    steam_id, app_id, game_name, game_seconds, fetched_at, last_seen_name
) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(steam_id) DO UPDATE SET
    app_id = excluded.app_id,
    game_name = excluded.game_name,
    game_seconds = MAX(steam_playtimes.game_seconds, excluded.game_seconds),
    fetched_at = MAX(steam_playtimes.fetched_at, excluded.fetched_at),
    last_seen_name = COALESCE(excluded.last_seen_name, steam_playtimes.last_seen_name)
      `,
      id,
      appId,
      gameName,
      gameSeconds,
      fetchedAt,
      safeName,
    );

    return this.getBySteamID(id);
  }

  async getBySteamID(steamID) {
    const id = normalizeSteamID(steamID);
    if (!id) return null;
    return this.db.get("SELECT * FROM steam_playtimes WHERE steam_id = ?", id);
  }

  async getManyBySteamIDs(steamIDs = []) {
    const ids = [...new Set(steamIDs.map(normalizeSteamID).filter(Boolean))];
    if (!ids.length) return new Map();

    const placeholders = ids.map(() => "?").join(",");
    const rows = await this.db.all(`SELECT * FROM steam_playtimes WHERE steam_id IN (${placeholders})`, ...ids);
    return new Map(rows.map((row) => [row.steam_id, row]));
  }

  async addRefreshLog({
    jobId = null,
    jobType,
    steamID = null,
    playerId = null,
    playerName = null,
    status,
    message = null,
    gameSeconds = null,
  } = {}) {
    await this.db.run(
      `INSERT INTO steam_playtime_refresh_logs
       (job_id, job_type, steam_id, player_id, player_name, status, message, game_seconds, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      jobId,
      String(jobType || "unknown"),
      normalizeSteamID(steamID),
      playerId == null ? null : Number(playerId),
      String(playerName || "").trim() || null,
      String(status || "unknown"),
      message == null ? null : String(message),
      gameSeconds == null ? null : normalizeSeconds(gameSeconds),
      Date.now(),
    );
  }

  async listRecentLogs({ limit = 100 } = {}) {
    const cappedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return this.db.all(
      `SELECT id, job_id, job_type, steam_id, player_id, player_name, status, message, game_seconds, created_at
       FROM steam_playtime_refresh_logs
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      cappedLimit,
    );
  }
}
