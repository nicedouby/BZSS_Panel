// -*- coding: utf-8 -*-

const now = () => Date.now();

function cleanText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function cleanId(value) {
  const text = cleanText(value);
  if (!text || text.toLowerCase() === "invalid" || text === "0") return null;
  return text;
}

export class PlayerRepository {
  constructor(db) {
    this.db = db;
    this.bySteamID = new Map();
    this.byEOSID = new Map();
    this.byName = new Map();
  }

  async hydrateCache() {
    this.bySteamID.clear();
    this.byEOSID.clear();
    this.byName.clear();

    const rows = await this.db.all("SELECT * FROM players");
    for (const row of rows) this.cache(row);
  }

  async findByIdentity({ name, steamID, eosID }) {
    const steam = cleanId(steamID);
    const eos = cleanId(eosID);
    const playerName = cleanText(name);

    if (eos) {
      const row = await this.db.get("SELECT * FROM players WHERE eos_id = ?", eos);
      if (row) return row;
    }
    if (steam) {
      const row = await this.db.get("SELECT * FROM players WHERE steam_id = ?", steam);
      if (row) return row;
    }
    if (playerName) {
      const row = await this.db.get("SELECT * FROM players WHERE current_name = ? ORDER BY updated_at DESC LIMIT 1", playerName);
      if (row) return row;

      return this.db.get(
        `SELECT players.*
         FROM player_aliases
         JOIN players ON players.id = player_aliases.player_id
         WHERE player_aliases.alias_name = ?
         ORDER BY player_aliases.seen_at DESC, player_aliases.id DESC
         LIMIT 1`,
        playerName,
      );
    }

    return null;
  }

  async upsertFromPresence({ name, steamID, eosID, ip } = {}) {
    const ts = now();
    const playerName = cleanText(name);
    const steam = cleanId(steamID);
    const eos = cleanId(eosID);
    const currentIp = cleanText(ip);
    const existing = await this.findByIdentity({ name: playerName, steamID: steam, eosID: eos });

    if (!existing) {
      const result = await this.db.run(
        `INSERT INTO players (current_name, steam_id, eos_id, current_ip, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        playerName,
        steam,
        eos,
        currentIp,
        ts,
        ts,
      );
      const created = await this.getPlayerById(result.lastID);
      if (playerName) await this.touchAlias(created.id, playerName, ts);
      if (currentIp) await this.touchIp(created.id, currentIp, ts);
      this.cache(created);
      return created;
    }

    const next = {
      current_name: playerName ?? existing.current_name,
      steam_id: existing.steam_id ?? steam,
      eos_id: existing.eos_id ?? eos,
      current_ip: currentIp ?? existing.current_ip,
    };

    await this.db.run(
      `UPDATE players
       SET current_name = ?, steam_id = ?, eos_id = ?, current_ip = ?, updated_at = ?
       WHERE id = ?`,
      next.current_name,
      next.steam_id,
      next.eos_id,
      next.current_ip,
      ts,
      existing.id,
    );

    if (next.current_name) await this.touchAlias(existing.id, next.current_name, ts);
    if (currentIp) await this.touchIp(existing.id, currentIp, ts);

    const updated = await this.getPlayerById(existing.id);
    this.cache(updated, existing);
    return updated;
  }

  async touchAlias(playerId, aliasName, ts = now()) {
    const alias = cleanText(aliasName);
    if (!alias) return;
    const row = await this.db.get(
      "SELECT id FROM player_aliases WHERE player_id = ? AND alias_name = ? ORDER BY seen_at DESC LIMIT 1",
      playerId,
      alias,
    );
    if (row) {
      await this.db.run("UPDATE player_aliases SET seen_at = ? WHERE id = ?", ts, row.id);
    } else {
      await this.db.run("INSERT INTO player_aliases (player_id, alias_name, seen_at) VALUES (?, ?, ?)", playerId, alias, ts);
    }
  }

  async touchIp(playerId, ip, ts = now()) {
    const value = cleanText(ip);
    if (!value) return;
    await this.db.run("UPDATE players SET current_ip = ?, updated_at = ? WHERE id = ?", value, ts, playerId);
    await this.db.run("INSERT INTO player_ips (player_id, ip, seen_at) VALUES (?, ?, ?)", playerId, value, ts);
  }

  async recordLogin({ playerId = null, ip = null, controllerPath = null, eosID = null, steamID = null } = {}) {
    await this.db.run(
      "INSERT INTO player_logins (player_id, ip, controller_path, eos_id, steam_id, joined_at) VALUES (?, ?, ?, ?, ?, ?)",
      playerId,
      cleanText(ip),
      cleanText(controllerPath),
      cleanId(eosID),
      cleanId(steamID),
      now(),
    );
  }

  async addSquadCreated({ playerId = null, squadID = null, squadName = null, teamName = null } = {}) {
    await this.db.run(
      "INSERT INTO squad_create_records (player_id, squad_id, squad_name, team_name, created_at) VALUES (?, ?, ?, ?, ?)",
      playerId,
      squadID,
      cleanText(squadName),
      cleanText(teamName),
      now(),
    );
    if (playerId) await this.incrementFields(playerId, { total_squad_created: 1 });
  }

  async addLogEvent({ sourceEvent, eventName = null, rawLine = null, payload = {}, matchedPlayerName = null } = {}) {
    await this.db.run(
      "INSERT INTO log_events (source_event, event_name, raw_line, matched_player_name, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
      cleanText(sourceEvent) ?? "UNKNOWN",
      cleanText(eventName),
      cleanText(rawLine),
      cleanText(matchedPlayerName),
      now(),
      JSON.stringify(payload ?? {}),
    );
  }

  async incrementFields(playerId, patch) {
    const entries = Object.entries(patch ?? {}).filter(([, value]) => Number.isFinite(Number(value)) && Number(value) !== 0);
    if (!entries.length) return;

    const columns = new Set((await this.db.all("PRAGMA table_info(players)")).map((row) => row.name));
    const safeEntries = entries.filter(([key]) => columns.has(key));
    if (!safeEntries.length) return;

    const assignments = safeEntries.map(([key]) => `${key} = ${key} + ?`).join(", ");
    const values = safeEntries.map(([, value]) => Math.trunc(Number(value)));
    await this.db.run(
      `UPDATE players SET ${assignments}, updated_at = ? WHERE id = ?`,
      ...values,
      now(),
      playerId,
    );
  }

  async listPlayers({ query = "", limit = 100, offset = 0, sort = "updated_desc" } = {}) {
    const q = `%${String(query ?? "").trim()}%`;
    const cappedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const orderBy = sort === "name_asc"
      ? "COALESCE(players.current_name, '') COLLATE NOCASE ASC, players.updated_at DESC"
      : "players.updated_at DESC";

    return this.db.all(
      `SELECT players.id, players.current_name, players.steam_id, players.eos_id, players.current_ip,
              players.permission_group, players.ladder_rating, players.game_seconds, players.server_seconds,
              players.commander_seconds, players.squad_leader_seconds, players.in_squad_seconds, players.warmup_seconds,
              players.total_kills_light, players.total_kills_other, players.total_downed_light, players.total_downed_other,
              players.total_tk_down, players.total_tk_kill, players.total_suicides, players.total_deaths,
              players.total_downed_received, players.total_squad_created, players.updated_at,
              login.last_login_at
       FROM players
       LEFT JOIN (
          SELECT player_id, MAX(joined_at) AS last_login_at
          FROM player_logins
          GROUP BY player_id
       ) AS login ON login.player_id = players.id
       WHERE (? = '%%' OR players.current_name LIKE ? OR players.steam_id LIKE ? OR players.eos_id LIKE ? OR players.current_ip LIKE ?)
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      q,
      q,
      q,
      q,
      q,
      cappedLimit,
      safeOffset,
    );
  }

  async countPlayers({ query = "" } = {}) {
    const q = `%${String(query ?? "").trim()}%`;
    const row = await this.db.get(
      `SELECT COUNT(*) AS count
       FROM players
       WHERE (? = '%%' OR current_name LIKE ? OR steam_id LIKE ? OR eos_id LIKE ? OR current_ip LIKE ?)`,
      q,
      q,
      q,
      q,
      q,
    );
    return Number(row?.count ?? 0);
  }

  async getPlayerById(playerId) {
    return this.db.get("SELECT * FROM players WHERE id = ?", Number(playerId));
  }

  async getPlayerDetail(playerId) {
    const id = Number(playerId);
    if (!Number.isFinite(id)) return null;

    const player = await this.getPlayerById(id);
    if (!player) return null;

    const [aliases, ips, logins, squadCreated, recentEvents] = await Promise.all([
      this.db.all("SELECT alias_name, seen_at FROM player_aliases WHERE player_id = ? ORDER BY seen_at DESC LIMIT 100", id),
      this.db.all("SELECT ip, seen_at FROM player_ips WHERE player_id = ? ORDER BY seen_at DESC LIMIT 100", id),
      this.db.all("SELECT ip, controller_path, eos_id, steam_id, joined_at FROM player_logins WHERE player_id = ? ORDER BY joined_at DESC LIMIT 100", id),
      this.db.all("SELECT squad_id, squad_name, team_name, created_at FROM squad_create_records WHERE player_id = ? ORDER BY created_at DESC LIMIT 100", id),
      this.db.all(
        `SELECT source_event, event_name, raw_line, matched_player_name, created_at
         FROM log_events
         WHERE matched_player_name = ? OR payload_json LIKE ?
         ORDER BY created_at DESC
         LIMIT 100`,
        player.current_name,
        `%${player.current_name ?? ""}%`,
      ),
    ]);

    return { player, aliases, ips, logins, squadCreated, recentEvents };
  }

  async getDatabaseStats() {
    const overview = await this.db.get(
      `SELECT COUNT(*) AS totalPlayers,
              COALESCE(SUM(server_seconds), 0) AS totalServerSeconds,
              COALESCE(SUM(game_seconds), 0) AS totalGameSeconds,
              COALESCE(SUM(total_kills_light + total_kills_other), 0) AS totalKills,
              COALESCE(SUM(total_deaths), 0) AS totalDeaths,
              COALESCE(MAX(updated_at), 0) AS lastUpdatedAt
       FROM players`,
    );
    return {
      totalPlayers: Number(overview?.totalPlayers ?? 0),
      totalServerSeconds: Number(overview?.totalServerSeconds ?? 0),
      totalGameSeconds: Number(overview?.totalGameSeconds ?? 0),
      totalKills: Number(overview?.totalKills ?? 0),
      totalDeaths: Number(overview?.totalDeaths ?? 0),
      lastUpdatedAt: Number(overview?.lastUpdatedAt ?? 0) || null,
    };
  }

  findCachedPlayer({ steamID, eosID, name } = {}) {
    const steam = cleanId(steamID);
    if (steam && this.bySteamID.has(steam)) return this.bySteamID.get(steam);
    const eos = cleanId(eosID);
    if (eos && this.byEOSID.has(eos)) return this.byEOSID.get(eos);
    const playerName = cleanText(name)?.toLowerCase();
    if (playerName && this.byName.has(playerName)) return this.byName.get(playerName);
    return null;
  }

  cache(player, previous = null) {
    if (previous) this.evict(previous);
    if (!player) return;
    const steam = cleanId(player.steam_id);
    const eos = cleanId(player.eos_id);
    const name = cleanText(player.current_name)?.toLowerCase();
    if (steam) this.bySteamID.set(steam, player);
    if (eos) this.byEOSID.set(eos, player);
    if (name) this.byName.set(name, player);
  }

  evict(player) {
    if (!player) return;
    const steam = cleanId(player.steam_id);
    const eos = cleanId(player.eos_id);
    const name = cleanText(player.current_name)?.toLowerCase();
    if (steam) this.bySteamID.delete(steam);
    if (eos) this.byEOSID.delete(eos);
    if (name) this.byName.delete(name);
  }
}
