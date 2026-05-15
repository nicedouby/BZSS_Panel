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

function normalizeSearchTerms(query) {
  return String(query ?? "")
    .trim()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function buildPlayerSearchWhere(query) {
  const terms = normalizeSearchTerms(query);
  if (!terms.length) {
    return {
      where: "1 = 1",
      params: [],
    };
  }

  const clauses = [];
  const params = [];

  for (const term of terms) {
    const like = `%${term}%`;
    clauses.push(`(
      CAST(players.id AS TEXT) LIKE ?
      OR players.current_name LIKE ?
      OR players.steam_id LIKE ?
      OR players.eos_id LIKE ?
      OR players.current_ip LIKE ?
      OR players.permission_group LIKE ?
      OR EXISTS (
        SELECT 1
        FROM player_aliases pa
        WHERE pa.player_id = players.id
          AND pa.alias_name LIKE ?
      )
      OR EXISTS (
        SELECT 1
        FROM player_ips pi
        WHERE pi.player_id = players.id
          AND pi.ip LIKE ?
      )
      OR EXISTS (
        SELECT 1
        FROM squad_create_records scr
        WHERE scr.player_id = players.id
          AND (
            CAST(scr.squad_id AS TEXT) LIKE ?
            OR scr.squad_name LIKE ?
            OR scr.team_name LIKE ?
          )
      )
    )`);

    params.push(
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
    );
  }

  return {
    where: clauses.join(" AND "),
    params,
  };
}

function normalizeCombatEventType(type) {
  const value = String(type ?? "").trim().toUpperCase();
  if (value === "WOUNDED") return "WOUNDED";
  if (value === "DIED") return "DIED";
  return "DAMAGE";
}

function toLogTime(value) {
  const ts = Number(value);
  if (Number.isFinite(ts) && ts > 0) return Math.trunc(ts);
  return null;
}

function buildSourceEventId(event = {}) {
  const raw = cleanText(event.sourceEventId ?? event.eventId ?? event.id);
  if (raw) return raw;
  const parts = [
    cleanText(event.eventName),
    cleanText(event.serverId),
    cleanText(event.time),
    cleanText(event.rawLog),
    cleanText(event?.record?.time),
  ].filter(Boolean);
  return parts.length ? parts.join("|") : null;
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
      "SELECT id FROM player_aliases WHERE player_id = ? AND alias_name = ? LIMIT 1",
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
    const row = await this.db.get(
      "SELECT id FROM player_ips WHERE player_id = ? AND ip = ? LIMIT 1",
      playerId,
      value,
    );
    if (row) {
      await this.db.run("UPDATE player_ips SET seen_at = ? WHERE id = ?", ts, row.id);
    } else {
      await this.db.run("INSERT INTO player_ips (player_id, ip, seen_at) VALUES (?, ?, ?)", playerId, value, ts);
    }
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

  async addCombatLogEvent({
    sourceEventId = null,
    serverId = null,
    matchId = null,
    mapName = null,
    layerName = null,
    eventType = "DAMAGE",
    attackerPlayerId = null,
    victimPlayerId = null,
    attackerName = null,
    victimName = null,
    attackerSteamId = null,
    attackerEosId = null,
    victimSteamId = null,
    victimEosId = null,
    weapon = null,
    damage = null,
    isLightWeapon = false,
    isTeamkill = false,
    isFatalDown = false,
    rawLine = null,
    payload = {},
    logTime = null,
  } = {}) {
    const normalizedSourceEventId = cleanText(sourceEventId);
    const payloadJson = JSON.stringify(payload ?? {});
    const createdAt = now();
    const params = [
      normalizedSourceEventId,
      cleanText(serverId),
      cleanText(matchId),
      cleanText(mapName),
      cleanText(layerName),
      normalizeCombatEventType(eventType),
      Number.isFinite(Number(attackerPlayerId)) ? Number(attackerPlayerId) : null,
      Number.isFinite(Number(victimPlayerId)) ? Number(victimPlayerId) : null,
      cleanText(attackerName),
      cleanText(victimName),
      cleanText(attackerSteamId),
      cleanText(attackerEosId),
      cleanText(victimSteamId),
      cleanText(victimEosId),
      cleanText(weapon),
      Number.isFinite(Number(damage)) ? Number(damage) : null,
      isLightWeapon ? 1 : 0,
      isTeamkill ? 1 : 0,
      isFatalDown ? 1 : 0,
      cleanText(rawLine),
      payloadJson,
      toLogTime(logTime),
      createdAt,
    ];

    if (normalizedSourceEventId) {
      const existing = await this.db.get(
        "SELECT id FROM combat_log_events WHERE source_event_id = ?",
        normalizedSourceEventId,
      );
      if (existing?.id) {
        return { id: Number(existing.id), inserted: false };
      }
    }

    const result = await this.db.run(
      `INSERT INTO combat_log_events (
         source_event_id, server_id, match_id, map_name, layer_name,
         event_type, attacker_player_id, victim_player_id,
         attacker_name, victim_name,
         attacker_steam_id, attacker_eos_id, victim_steam_id, victim_eos_id,
         weapon, damage, is_light_weapon, is_teamkill, is_fatal_down,
         raw_line, payload_json, log_time, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ...params,
    );
    return { id: Number(result.lastID), inserted: true };
  }

  async addCombatLogRefs(combatLogEventId, refs = []) {
    const id = Number(combatLogEventId);
    if (!Number.isFinite(id) || id <= 0) return 0;
    const ts = now();
    let changes = 0;

    for (const ref of refs) {
      const playerId = Number(ref?.playerId);
      const role = cleanText(ref?.role);
      if (!Number.isFinite(playerId) || !role) continue;
      const result = await this.db.run(
        `INSERT INTO combat_log_player_refs (combat_log_event_id, player_id, role, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(combat_log_event_id, player_id, role) DO UPDATE SET
           created_at = excluded.created_at`,
        id,
        playerId,
        role,
        ts,
      );
      changes += Number(result?.changes || 0);
    }

    return changes;
  }

  async incrementCombatStats(playerId, patch = {}) {
    const id = Number(playerId);
    if (!Number.isFinite(id) || id <= 0) return;
    const fields = {
      light_weapon_downs: Math.trunc(Number(patch.light_weapon_downs ?? patch.lightWeaponDowns ?? 0)),
      light_weapon_kills: Math.trunc(Number(patch.light_weapon_kills ?? patch.lightWeaponKills ?? 0)),
      light_weapon_fatal_downs: Math.trunc(Number(patch.light_weapon_fatal_downs ?? patch.lightWeaponFatalDowns ?? 0)),
      deaths: Math.trunc(Number(patch.deaths ?? 0)),
      tk_downs: Math.trunc(Number(patch.tk_downs ?? patch.tkDowns ?? 0)),
      tk_kills: Math.trunc(Number(patch.tk_kills ?? patch.tkKills ?? 0)),
    };

    const entries = Object.entries(fields).filter(([, value]) => Number.isFinite(value) && value !== 0);
    if (!entries.length) return;

    const assignments = entries.map(([key]) => `${key} = ${key} + excluded.${key}`).join(", ");
    const columns = entries.map(([key]) => key).join(", ");
    const placeholders = entries.map(() => "excluded." + entries[0][0]).length; // unused fallback to keep shape
    const values = entries.map(([, value]) => value);
    const ts = now();

    const sql = `
      INSERT INTO player_combat_stats (
        player_id, ${columns}, updated_at
      ) VALUES (
        ?, ${entries.map(() => "?").join(", ")}, ?
      )
      ON CONFLICT(player_id) DO UPDATE SET
        ${assignments},
        updated_at = excluded.updated_at
    `;
    await this.db.run(sql, id, ...values, ts);
  }

  async incrementWarmupCombatStats(playerId, patch = {}) {
    const id = Number(playerId);
    if (!Number.isFinite(id) || id <= 0) return;
    const fields = {
      downs: Math.trunc(Number(patch.downs ?? 0)),
      kills: Math.trunc(Number(patch.kills ?? 0)),
      deaths: Math.trunc(Number(patch.deaths ?? 0)),
    };
    const entries = Object.entries(fields).filter(([, value]) => Number.isFinite(value) && value !== 0);
    if (!entries.length) return;
    const columns = entries.map(([key]) => key).join(", ");
    const update = entries.map(([key]) => `${key} = ${key} + excluded.${key}`).join(", ");
    const values = entries.map(([, value]) => value);
    const ts = now();
    const sql = `
      INSERT INTO player_warmup_combat_stats (
        player_id, ${columns}, updated_at
      ) VALUES (
        ?, ${entries.map(() => "?").join(", ")}, ?
      )
      ON CONFLICT(player_id) DO UPDATE SET
        ${update},
        updated_at = excluded.updated_at
    `;
    await this.db.run(sql, id, ...values, ts);
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

  async listPlayers({ query = "", q: qAlias = "", limit = 100, offset = 0, sort = "updated_desc" } = {}) {
    const searchQuery = query || qAlias || "";
    const search = buildPlayerSearchWhere(searchQuery);
    const cappedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    let orderBy = "players.updated_at DESC";
    if (sort === "name_asc") {
      orderBy = "COALESCE(players.current_name, '') COLLATE NOCASE ASC, players.updated_at DESC";
    } else if (sort === "last_login_desc") {
      orderBy = "players.updated_at DESC";
    }

    return this.db.all(
      `SELECT players.id, players.current_name, players.steam_id, players.eos_id, players.current_ip,
              players.permission_group, players.game_seconds, players.server_seconds,
              players.commander_seconds, players.squad_leader_seconds, players.in_squad_seconds, players.warmup_seconds,
              players.total_squad_created, players.updated_at
       FROM players
       WHERE ${search.where}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      ...search.params,
      cappedLimit,
      safeOffset,
    );
  }

  async countPlayers({ query = "", q: qAlias = "" } = {}) {
    const searchQuery = query || qAlias || "";
    const search = buildPlayerSearchWhere(searchQuery);
    const row = await this.db.get(
      `SELECT COUNT(*) AS count
       FROM players
       WHERE ${search.where}`,
      ...search.params,
    );
    return Number(row?.count ?? 0);
  }

  async getPlayerById(playerId) {
    return this.db.get("SELECT * FROM players WHERE id = ?", Number(playerId));
  }

  async listPlayersWithSteamID() {
    return this.db.all(
      `SELECT id, current_name, steam_id, eos_id, game_seconds, updated_at
       FROM players
       WHERE steam_id IS NOT NULL
         AND TRIM(steam_id) <> ''
       ORDER BY updated_at DESC`,
    );
  }

  async updateGameDuration(playerId, gameSeconds) {
    const normalizedSeconds = Math.max(0, Math.floor(Number(gameSeconds) || 0));
    await this.db.run(
      "UPDATE players SET game_seconds = ?, updated_at = ? WHERE id = ?",
      normalizedSeconds,
      now(),
      Number(playerId),
    );

    const updated = await this.getPlayerById(playerId);
    this.cache(updated);
    return updated;
  }

  normalizePaging({ limit = 12, offset = 0 } = {}) {
    return {
      limit: Math.min(Math.max(Number(limit) || 12, 1), 100),
      offset: Math.max(Number(offset) || 0, 0),
    };
  }

  async listPlayerAliases(playerId, options = {}) {
    const id = Number(playerId);
    if (!Number.isFinite(id)) return [];
    const { limit, offset } = this.normalizePaging(options);
    return this.db.all(
      `SELECT alias_name, MAX(seen_at) AS seen_at
       FROM player_aliases
       WHERE player_id = ?
       GROUP BY alias_name
       ORDER BY seen_at DESC, alias_name DESC
       LIMIT ? OFFSET ?`,
      id,
      limit,
      offset,
    );
  }

  async listPlayerIps(playerId, options = {}) {
    const id = Number(playerId);
    if (!Number.isFinite(id)) return [];
    const { limit, offset } = this.normalizePaging(options);
    return this.db.all(
      `SELECT ip, MAX(seen_at) AS seen_at
       FROM player_ips
       WHERE player_id = ?
       GROUP BY ip
       ORDER BY seen_at DESC, ip DESC
       LIMIT ? OFFSET ?`,
      id,
      limit,
      offset,
    );
  }

  async listPlayerSquadCreated(playerId, options = {}) {
    const id = Number(playerId);
    if (!Number.isFinite(id)) return [];
    const { limit, offset } = this.normalizePaging(options);
    return this.db.all(
      `SELECT squad_id, squad_name, team_name, created_at
       FROM squad_create_records
       WHERE player_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      id,
      limit,
      offset,
    );
  }

  async getPlayerWarmupStats(playerId) {
    const id = Number(playerId);
    if (!Number.isFinite(id)) return null;
    return this.db.get("SELECT * FROM player_warmup_combat_stats WHERE player_id = ?", id);
  }

  async listWarmupCombatStats({ limit = 100, offset = 0 } = {}) {
    const cappedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    return this.db.all(
      `SELECT p.id, p.current_name, p.steam_id, p.eos_id,
              COALESCE(w.downs, 0) AS downs,
              COALESCE(w.kills, 0) AS kills,
              COALESCE(w.deaths, 0) AS deaths,
              COALESCE(w.updated_at, 0) AS updated_at
       FROM player_warmup_combat_stats w
       JOIN players p ON p.id = w.player_id
       ORDER BY w.kills DESC, w.downs DESC, w.deaths DESC, w.updated_at DESC
       LIMIT ? OFFSET ?`,
      cappedLimit,
      safeOffset,
    );
  }

  async listCombatLogsByPlayer(playerId, options = {}) {
    const id = Number(playerId);
    if (!Number.isFinite(id)) return [];
    const { limit, offset } = this.normalizePaging(options);
    return this.db.all(
      `SELECT
         r.combat_log_event_id,
         r.player_id AS ref_player_id,
         e.id,
         e.event_type,
         r.role,
         e.attacker_name,
         e.victim_name,
         e.weapon,
         e.damage,
         e.is_light_weapon,
         e.is_teamkill,
         e.is_fatal_down,
         e.raw_line,
         e.payload_json,
         e.created_at,
         e.log_time
       FROM combat_log_player_refs r
       JOIN combat_log_events e ON e.id = r.combat_log_event_id
       WHERE r.player_id = ?
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT ? OFFSET ?`,
      id,
      limit,
      offset,
    );
  }

  async listCombatSessionsByPlayer(playerId, options = {}) {
    const id = Number(playerId);
    if (!Number.isFinite(id)) return [];
    const { limit, offset } = this.normalizePaging(options);
    return this.db.all(
      `SELECT
         id,
         player_id,
         date_key,
         file_path,
         first_event_at,
         last_event_at
       FROM combat_sessions
       WHERE player_id = ?
       ORDER BY last_event_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      id,
      limit,
      offset,
    );
  }

  async getPlayerDetail(playerId) {
    const id = Number(playerId);
    if (!Number.isFinite(id)) return null;

    const player = await this.getPlayerById(id);
    if (!player) return null;

    const [aliases, ips, squadCreatedRows, combatSessions] = await Promise.all([
      this.listPlayerAliases(id, { limit: 12 }),
      this.listPlayerIps(id, { limit: 12 }),
      this.listPlayerSquadCreated(id, { limit: 1 }),
      this.listCombatSessionsByPlayer(id, { limit: 100 }),
    ]);

    return {
      player,
      aliases,
      ips,
      squadCreated: squadCreatedRows[0] ?? null,
      combatSessions: combatSessions.map((row) => ({
        id: Number(row.id),
        playerId: Number(row.player_id || 0) || null,
        dateKey: row.date_key || null,
        filePath: row.file_path || null,
        firstEventAt: Number(row.first_event_at || 0) || null,
        lastEventAt: Number(row.last_event_at || 0) || null,
      })),
      summary: {
        gameSeconds: Number(player.game_seconds ?? 0),
        serverSeconds: Number(player.server_seconds ?? 0),
      },
    };
  }

  async setPermissionGroup(playerId, permissionGroup) {
    await this.db.run(
      "UPDATE players SET permission_group = ?, updated_at = ? WHERE id = ?",
      cleanText(permissionGroup) ?? "default",
      now(),
      Number(playerId),
    );
  }

  async resetCombatStats() {
    const deletes = [
      await this.db.run("DELETE FROM player_combat_stats"),
      await this.db.run("DELETE FROM player_warmup_combat_stats"),
      await this.db.run("DELETE FROM combat_log_player_refs"),
      await this.db.run("DELETE FROM combat_log_events"),
    ];
    return deletes.reduce((sum, result) => sum + Number(result?.changes || 0), 0);
  }

  async deletePlayer(playerId) {
    const existing = await this.getPlayerById(playerId);
    if (!existing) return false;
    await this.db.run("DELETE FROM players WHERE id = ?", Number(playerId));
    this.evict(existing);
    return true;
  }

  async getDatabaseStats({ top = 10, days = 14 } = {}) {
    const normalizedTop = Math.min(Math.max(Number(top) || 10, 1), 100);
    const normalizedDays = Math.min(Math.max(Number(days) || 14, 1), 120);
    const nowTs = now();
    const windowStartTs = nowTs - normalizedDays * 24 * 60 * 60 * 1000;

    const overviewRow = await this.db.get(
      `SELECT COUNT(*) AS total_players,
              COALESCE(SUM(game_seconds), 0) AS total_game_seconds,
              COALESCE(SUM(server_seconds), 0) AS total_server_seconds,
              COALESCE(SUM(commander_seconds), 0) AS total_commander_seconds,
              COALESCE(SUM(squad_leader_seconds), 0) AS total_squad_leader_seconds,
              COALESCE(SUM(in_squad_seconds), 0) AS total_in_squad_seconds,
              COALESCE(SUM(total_matches), 0) AS total_matches,
              COALESCE(SUM(total_match_wins), 0) AS total_match_wins,
              COALESCE(SUM(total_suicides), 0) AS total_suicides,
              COALESCE(MAX(updated_at), 0) AS last_player_update_at
       FROM players
       LEFT JOIN player_combat_stats pcs ON pcs.player_id = players.id`,
    );

    const activeWindowRow = await this.db.get(
      "SELECT COUNT(*) AS active_players FROM players WHERE updated_at >= ?",
      windowStartTs,
    );

    const permissionGroups = await this.db.all(
      `SELECT permission_group, COUNT(*) AS players
       FROM players
       GROUP BY permission_group
       ORDER BY players DESC, permission_group ASC`,
    );

    const topByPlaytime = await this.db.all(
      `SELECT id, current_name, steam_id, eos_id, game_seconds, server_seconds,
              commander_seconds, squad_leader_seconds, in_squad_seconds, warmup_seconds
       FROM players
       ORDER BY game_seconds DESC, server_seconds DESC, updated_at DESC
       LIMIT ?`,
      normalizedTop,
    );

    const tagStats = await this.db.all(
      `SELECT tag_type, tag_value, COUNT(*) AS players
       FROM player_tags
       GROUP BY tag_type, tag_value
       ORDER BY players DESC, tag_value ASC`,
    );

    const topViolations = await this.db.all(
      `SELECT pvc.player_id,
              COALESCE(p.current_name, p.steam_id, p.eos_id, 'Unknown') AS current_name,
              p.steam_id,
              p.eos_id,
              SUM(pvc.count) AS total_violations,
              MAX(pvc.last_at) AS last_violation_at
       FROM player_violation_counts pvc
       LEFT JOIN players p ON p.id = pvc.player_id
       GROUP BY pvc.player_id
       HAVING total_violations > 0
       ORDER BY total_violations DESC, last_violation_at DESC
       LIMIT ?`,
      normalizedTop,
    );

    const violationTypeStats = await this.db.all(
      `SELECT violation_key,
              COALESCE(MAX(violation_label), violation_key) AS violation_label,
              SUM(count) AS total_count,
              COUNT(*) AS affected_players,
              MAX(last_at) AS last_at
       FROM player_violation_counts
       GROUP BY violation_key
       HAVING total_count > 0
       ORDER BY total_count DESC, violation_key ASC
       LIMIT ?`,
      normalizedTop,
    );

    const matchTrend = await this.db.all(
      `SELECT strftime('%Y-%m-%d', started_at / 1000, 'unixepoch', 'localtime') AS day,
              COUNT(*) AS match_count,
              SUM(CASE WHEN ended_at IS NOT NULL THEN 1 ELSE 0 END) AS completed_count
       FROM match_records
       WHERE started_at >= ?
       GROUP BY day
       ORDER BY day ASC`,
      windowStartTs,
    );

    const roleTags = [];
    const componentTags = [];
    for (const row of tagStats || []) {
      if (row.tag_type === "role") roleTags.push(row);
      if (row.tag_type === "component") componentTags.push(row);
    }

    return {
      generatedAt: nowTs,
      windowDays: normalizedDays,
      topLimit: normalizedTop,
      overview: {
        totalPlayers: Number(overviewRow?.total_players || 0),
        activePlayersInWindow: Number(activeWindowRow?.active_players || 0),
        totalGameSeconds: Number(overviewRow?.total_game_seconds || 0),
        totalServerSeconds: Number(overviewRow?.total_server_seconds || 0),
        totalCommanderSeconds: Number(overviewRow?.total_commander_seconds || 0),
        totalSquadLeaderSeconds: Number(overviewRow?.total_squad_leader_seconds || 0),
        totalInSquadSeconds: Number(overviewRow?.total_in_squad_seconds || 0),
        totalMatches: Number(overviewRow?.total_matches || 0),
        totalMatchWins: Number(overviewRow?.total_match_wins || 0),
        totalSuicides: Number(overviewRow?.total_suicides || 0),
        lastPlayerUpdateAt: Number(overviewRow?.last_player_update_at || 0) || null,
      },
      breakdowns: {
        permissionGroups: permissionGroups.map((row) => ({
          permissionGroup: row.permission_group || "default",
          players: Number(row.players || 0),
        })),
        roleTags: roleTags.slice(0, normalizedTop).map((row) => ({
          tagValue: row.tag_value,
          players: Number(row.players || 0),
        })),
        componentTags: componentTags.slice(0, normalizedTop).map((row) => ({
          tagValue: row.tag_value,
          players: Number(row.players || 0),
        })),
        violationTypes: violationTypeStats.map((row) => ({
          violationKey: row.violation_key,
          violationLabel: row.violation_label || row.violation_key,
          totalCount: Number(row.total_count || 0),
          affectedPlayers: Number(row.affected_players || 0),
          lastAt: Number(row.last_at || 0) || null,
        })),
      },
      leaderboards: {
        byPlaytime: topByPlaytime.map((row) => ({
          id: Number(row.id),
          currentName: row.current_name || null,
          steamID: row.steam_id || null,
          eosID: row.eos_id || null,
          gameSeconds: Number(row.game_seconds || 0),
          serverSeconds: Number(row.server_seconds || 0),
          commanderSeconds: Number(row.commander_seconds || 0),
          squadLeaderSeconds: Number(row.squad_leader_seconds || 0),
          inSquadSeconds: Number(row.in_squad_seconds || 0),
          warmupSeconds: Number(row.warmup_seconds || 0),
        })),
        byViolations: topViolations.map((row) => ({
          playerId: Number(row.player_id),
          currentName: row.current_name || null,
          steamID: row.steam_id || null,
          eosID: row.eos_id || null,
          totalViolations: Number(row.total_violations || 0),
          lastViolationAt: Number(row.last_violation_at || 0) || null,
        })),
      },
      trends: {
        matchesByDay: matchTrend.map((row) => ({
          day: row.day,
          matchCount: Number(row.match_count || 0),
          completedCount: Number(row.completed_count || 0),
        })),
      },
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
