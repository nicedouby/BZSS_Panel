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

function normalizeSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

function optionalSeconds(value) {
  if (value == null || String(value).trim() === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.floor(numeric));
}

function normalizeAssetAmount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, numeric);
}

function parseAssets(value) {
  if (!value || String(value).trim() === "") return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function enrichAssets(row) {
  const assets = parseAssets(row?.assets_json ?? row?.assetsJson);
  return {
    assets,
    assetsJson: assets,
    warmupPoints: normalizeAssetAmount(assets.warmupPoints),
    blackEdgeSwitchCount: normalizeAssetAmount(assets.blackEdgeSwitchCount),
  };
}

function resolveEffectiveGameSeconds(row) {
  const override = optionalSeconds(row?.game_seconds_override ?? row?.gameSecondsOverride);
  if (override != null) return override;
  return normalizeSeconds(row?.game_seconds ?? row?.gameSeconds ?? row?.steam_game_seconds ?? row?.steamGameSeconds);
}

function mapPlayerPlaytimeRow(row) {
  if (!row) return null;
  const steamGameSeconds = normalizeSeconds(row.steam_game_seconds ?? row.steamGameSeconds ?? row.game_seconds ?? row.gameSeconds);
  const gameSecondsOverride = optionalSeconds(row.game_seconds_override ?? row.gameSecondsOverride);
  const gameSeconds = resolveEffectiveGameSeconds(row);
  return {
    ...row,
    ...enrichAssets(row),
    steam_game_seconds: steamGameSeconds,
    steamGameSeconds,
    game_seconds_override: gameSecondsOverride,
    gameSecondsOverride,
    game_seconds: gameSeconds,
    gameSeconds,
  };
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
    );
  }

  return {
    where: clauses.join(" AND "),
    params,
  };
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

  async findByIdentity({ name, steamID, eosID, qqNumber }) {
    const steam = cleanId(steamID);
    const eos = cleanId(eosID);
    const playerName = cleanText(name);
    const qq = cleanText(qqNumber);

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

    if (qq) {
      const row = await this.db.get("SELECT * FROM players WHERE qq_number = ?", qq);
      if (row) return row;
    }

    return null;
  }

  async upsertFromPresence({ name, steamID, eosID, ip, qqNumber, qqName } = {}) {
    const ts = now();
    const playerName = cleanText(name);
    const steam = cleanId(steamID);
    const eos = cleanId(eosID);
    const currentIp = cleanText(ip);
    const qq = cleanText(qqNumber);
    const qqDisplayName = cleanText(qqName);
    let existing = await this.findByIdentity({ name: playerName, steamID: steam, eosID: eos, qqNumber: qq });

    if (!existing) {
      try {
        const result = await this.db.run(
          `INSERT INTO players (current_name, steam_id, eos_id, qq_number, qq_name, qq_bound_at, current_ip, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          playerName,
          steam,
          eos,
          qq,
          qqDisplayName,
          qq ? ts : null,
          currentIp,
          ts,
          ts,
        );
        const created = await this.getPlayerById(result.lastID);
        if (playerName) await this.touchAlias(created.id, playerName, ts);
        if (currentIp) await this.touchIp(created.id, currentIp, ts);
        this.cache(created);
        return created;
      } catch (error) {
        if (!isPlayerIdentityConflict(error)) throw error;
        existing = await this.findByIdentity({ name: playerName, steamID: steam, eosID: eos, qqNumber: qq });
        if (!existing) throw error;
      }
    }

    const next = {
      current_name: playerName ?? existing.current_name,
      steam_id: existing.steam_id ?? steam,
      eos_id: existing.eos_id ?? eos,
      qq_number: qq ?? existing.qq_number,
      qq_name: qqDisplayName ?? existing.qq_name,
      qq_bound_at: qq ? (existing.qq_bound_at ?? ts) : existing.qq_bound_at,
      current_ip: currentIp ?? existing.current_ip,
    };

    try {
      await this.db.run(
        `UPDATE players
         SET current_name = ?, steam_id = ?, eos_id = ?, qq_number = ?, qq_name = ?, qq_bound_at = ?, current_ip = ?, updated_at = ?
         WHERE id = ?`,
        next.current_name,
        next.steam_id,
        next.eos_id,
        next.qq_number,
        next.qq_name,
        next.qq_bound_at,
        next.current_ip,
        ts,
        existing.id,
      );
    } catch (error) {
      if (!isPlayerIdentityConflict(error)) throw error;
      const conflicted = await this.findByIdentity({ name: playerName, steamID: steam, eosID: eos, qqNumber: qq });
      if (!conflicted) throw error;
      existing = conflicted;
    }

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

  async addTimeStats(playerId, patch = {}) {
    const id = Number(playerId);
    if (!Number.isFinite(id)) return null;

    const existing = await this.getPlayerById(id);
    if (!existing) return null;

    const serverSeconds = normalizeSeconds(patch.serverSeconds ?? patch.server_seconds ?? 0);
    const warmupSeconds = normalizeSeconds(patch.warmupSeconds ?? patch.warmup_seconds ?? 0);
    const warmupPoints = normalizeAssetAmount(patch.warmupPoints ?? patch.warmup_points ?? 0);
    if (serverSeconds <= 0 && warmupSeconds <= 0 && warmupPoints <= 0) {
      return mapPlayerPlaytimeRow(existing);
    }

    const assets = parseAssets(existing.assets_json);
    assets.warmupPoints = normalizeAssetAmount(assets.warmupPoints) + warmupPoints;

    await this.db.run(
      `UPDATE players
       SET server_seconds = server_seconds + ?,
           warmup_seconds = warmup_seconds + ?,
           assets_json = ?,
           updated_at = ?
       WHERE id = ?`,
      serverSeconds,
      warmupSeconds,
      JSON.stringify(assets),
      now(),
      id,
    );

    const updated = mapPlayerPlaytimeRow(await this.getPlayerById(id));
    this.cache(updated, existing);
    return updated;
  }

  async addAssetAmount(playerId, assetKey, amount = 0) {
    const id = Number(playerId);
    if (!Number.isFinite(id)) return null;

    const key = cleanText(assetKey);
    const delta = Number(amount);
    if (!key || !Number.isFinite(delta) || delta === 0) {
      return mapPlayerPlaytimeRow(await this.getPlayerById(id));
    }

    const existing = await this.getPlayerById(id);
    if (!existing) return null;

    const assets = parseAssets(existing.assets_json);
    const currentAmount = normalizeAssetAmount(assets[key]);
    assets[key] = Math.max(0, currentAmount + delta);

    await this.db.run(
      `UPDATE players
       SET assets_json = ?,
           updated_at = ?
       WHERE id = ?`,
      JSON.stringify(assets),
      now(),
      id,
    );

    const updated = mapPlayerPlaytimeRow(await this.getPlayerById(id));
    this.cache(updated, existing);
    return updated;
  }

  async consumeAssetAmount(playerId, assetKey, amount = 1) {
    const id = Number(playerId);
    if (!Number.isFinite(id)) {
      return {
        ok: false,
        error: "InvalidPlayerId",
        message: "Player id is invalid.",
        player: null,
        remaining: 0,
      };
    }

    const key = cleanText(assetKey);
    const cost = normalizeAssetAmount(amount);
    if (!key || cost <= 0) {
      return {
        ok: false,
        error: "InvalidAssetRequest",
        message: "Asset key and amount are required.",
        player: null,
        remaining: 0,
      };
    }

    const existing = await this.getPlayerById(id);
    if (!existing) {
      return {
        ok: false,
        error: "PlayerNotFound",
        message: "Player not found.",
        player: null,
        remaining: 0,
      };
    }

    const assets = parseAssets(existing.assets_json);
    const currentAmount = normalizeAssetAmount(assets[key]);
    if (currentAmount < cost) {
      return {
        ok: false,
        error: "AssetInsufficient",
        message: "Asset amount is insufficient.",
        player: mapPlayerPlaytimeRow(existing),
        remaining: currentAmount,
      };
    }

    assets[key] = Math.max(0, currentAmount - cost);

    await this.db.run(
      `UPDATE players
       SET assets_json = ?,
           updated_at = ?
       WHERE id = ?`,
      JSON.stringify(assets),
      now(),
      id,
    );

    const updated = mapPlayerPlaytimeRow(await this.getPlayerById(id));
    this.cache(updated, existing);
    return {
      ok: true,
      player: updated,
      remaining: normalizeAssetAmount(updated?.assets?.[key]),
    };
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
              players.permission_group, players.steam_game_seconds, players.game_seconds,
              players.game_seconds_override, players.server_seconds,
              players.commander_seconds, players.squad_leader_seconds, players.in_squad_seconds, players.warmup_seconds,
              players.assets_json, players.steam_avatar, players.updated_at
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

  async listPlayersWithSteamID({ limit, offset, order = "DESC" } = {}) {
    let query = `SELECT id, current_name, steam_id, eos_id, game_seconds, steam_avatar, updated_at
       FROM players
       WHERE steam_id IS NOT NULL
         AND TRIM(steam_id) <> ''
       ORDER BY updated_at ${order === "ASC" ? "ASC" : "DESC"}`;
    const params = [];
    if (limit !== undefined) {
      query += " LIMIT ?";
      params.push(Number(limit));
    }
    if (offset !== undefined) {
      query += " OFFSET ?";
      params.push(Number(offset));
    }
    return this.db.all(query, ...params);
  }

  async listPlayersBySteamIDs(steamIDs = []) {
    const ids = [...new Set(
      (Array.isArray(steamIDs) ? steamIDs : [])
        .map((id) => String(id ?? "").trim())
        .filter(Boolean),
    )];

    if (!ids.length) return [];

    const placeholders = ids.map(() => "?").join(", ");
    const rows = await this.db.all(
      `SELECT id, current_name, steam_id, eos_id, current_ip, steam_game_seconds, game_seconds, game_seconds_override, steam_avatar, updated_at, assets_json
       FROM players
       WHERE steam_id IN (${placeholders})`,
      ...ids,
    );
    return rows.map((row) => {
      const mapped = mapPlayerPlaytimeRow(row);
      mapped.current_ip = row.current_ip;
      return mapped;
    });
  }

  async listPlayersByIdentities({ steamIDs = [], eosIDs = [] } = {}) {
    const steam = [...new Set(
      (Array.isArray(steamIDs) ? steamIDs : [])
        .map((id) => String(id ?? "").trim())
        .filter(Boolean),
    )];
    const eos = [...new Set(
      (Array.isArray(eosIDs) ? eosIDs : [])
        .map((id) => String(id ?? "").trim())
        .filter(Boolean),
    )];

    const clauses = [];
    const params = [];

    if (steam.length) {
      clauses.push(`steam_id IN (${steam.map(() => "?").join(", ")})`);
      params.push(...steam);
    }

    if (eos.length) {
      clauses.push(`eos_id IN (${eos.map(() => "?").join(", ")})`);
      params.push(...eos);
    }

    if (!clauses.length) return [];

    const rows = await this.db.all(
      `SELECT id, current_name, steam_id, eos_id, steam_game_seconds, game_seconds, game_seconds_override, steam_avatar, updated_at, assets_json
       FROM players
       WHERE ${clauses.join(" OR ")}`,
      ...params,
    );
    return rows.map((row) => mapPlayerPlaytimeRow(row));
  }

  async updateGameDuration(playerId, gameSeconds) {
    const normalizedSeconds = normalizeSeconds(gameSeconds);
    const id = Number(playerId);
    const existing = await this.getPlayerById(id);
    if (!existing) return null;
    const effectiveSeconds = optionalSeconds(existing.game_seconds_override) ?? normalizedSeconds;

    await this.db.run(
      `UPDATE players
       SET steam_game_seconds = ?, game_seconds = ?, updated_at = ?
       WHERE id = ?`,
      normalizedSeconds,
      effectiveSeconds,
      now(),
      id,
    );

    const updated = mapPlayerPlaytimeRow(await this.getPlayerById(id));
    this.cache(updated, existing);
    return updated;
  }

  async setGameDurationOverride(playerId, gameSeconds) {
    const id = Number(playerId);
    const existing = await this.getPlayerById(id);
    if (!existing) return null;

    const overrideSeconds = gameSeconds == null ? null : normalizeSeconds(gameSeconds);
    const effectiveSeconds = overrideSeconds ?? normalizeSeconds(existing.steam_game_seconds ?? existing.game_seconds ?? 0);

    await this.db.run(
      `UPDATE players
       SET game_seconds_override = ?, game_seconds = ?, updated_at = ?
       WHERE id = ?`,
      overrideSeconds,
      effectiveSeconds,
      now(),
      id,
    );

    const updated = mapPlayerPlaytimeRow(await this.getPlayerById(id));
    this.cache(updated, existing);
    return updated;
  }

  async updateSteamAvatarBySteamID(steamID, steamAvatar) {
    const ts = now();
    await this.db.run(
      "UPDATE players SET steam_avatar = ?, updated_at = ? WHERE steam_id = ?",
      steamAvatar,
      ts,
      steamID
    );
    const steam = cleanId(steamID);
    if (steam && this.bySteamID.has(steam)) {
      const player = this.bySteamID.get(steam);
      player.steam_avatar = steamAvatar;
      player.updated_at = ts;
    }
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

  async addSessionHistory(playerId, session = {}) {
    const id = Number(playerId);
    if (!Number.isFinite(id)) return null;

    const joinedAt = Number(session.joinedAt ?? session.joined_at ?? 0);
    if (!Number.isFinite(joinedAt) || joinedAt <= 0) return null;

    const result = await this.db.run(
      `INSERT INTO player_session_history (player_id, joined_at, left_at, duration_seconds, source)
       VALUES (?, ?, NULL, NULL, ?)`,
      id,
      joinedAt,
      cleanText(session.source) ?? null,
    );

    return Number(result?.lastID ?? 0) || null;
  }

  async closeOpenSessionHistory(playerId, session = {}) {
    const id = Number(playerId);
    if (!Number.isFinite(id)) return false;

    const leftAt = Number(session.leftAt ?? session.left_at ?? 0);
    if (!Number.isFinite(leftAt) || leftAt <= 0) return false;

    const openRow = await this.db.get(
      `SELECT id, joined_at
       FROM player_session_history
       WHERE player_id = ? AND left_at IS NULL
       ORDER BY joined_at DESC, id DESC
       LIMIT 1`,
      id,
    );
    if (!openRow) return false;

    const joinedAt = Number(openRow.joined_at ?? 0);
    const durationSeconds = joinedAt > 0 ? Math.max(0, Math.floor((leftAt - joinedAt) / 1000)) : null;

    await this.db.run(
      `UPDATE player_session_history
       SET left_at = ?, duration_seconds = ?, source = COALESCE(source, ?)
       WHERE id = ?`,
      leftAt,
      durationSeconds,
      cleanText(session.source) ?? null,
      Number(openRow.id),
    );
    return true;
  }

  async listPlayerSessionHistory(playerId, options = {}) {
    const id = Number(playerId);
    if (!Number.isFinite(id)) return [];
    const { limit, offset } = this.normalizePaging(options);
    return this.db.all(
      `SELECT id, joined_at, left_at, duration_seconds, source
       FROM player_session_history
       WHERE player_id = ?
       ORDER BY joined_at DESC, id DESC
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

    const [aliases, ips, sessions] = await Promise.all([
      this.listPlayerAliases(id, { limit: 12 }),
      this.listPlayerIps(id, { limit: 12 }),
      this.listPlayerSessionHistory(id, { limit: 20 }),
    ]);

    return {
      player: mapPlayerPlaytimeRow(player),
      aliases,
      ips,
      sessionHistory: sessions,
      summary: {
        gameSeconds: resolveEffectiveGameSeconds(player),
        steamGameSeconds: normalizeSeconds(player.steam_game_seconds ?? player.game_seconds ?? 0),
        gameSecondsOverride: optionalSeconds(player.game_seconds_override),
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

  async bindQQToPlayer(playerId, { qqNumber, qqName } = {}) {
    const id = Number(playerId);
    if (!Number.isFinite(id)) return null;

    const qq = cleanText(qqNumber);
    if (!qq) {
      throw new Error("QQ number is required.");
    }

    const existing = await this.getPlayerById(id);
    if (!existing) return null;

    const ts = now();
    await this.db.run(
      `UPDATE players
       SET qq_number = ?, qq_name = ?, qq_bound_at = ?, updated_at = ?
       WHERE id = ?`,
      qq,
      cleanText(qqName),
      ts,
      ts,
      id,
    );

    const updated = await this.getPlayerById(id);
    this.cache(updated, existing);
    return updated;
  }

  async unbindQQFromPlayer(playerId) {
    const id = Number(playerId);
    if (!Number.isFinite(id)) return null;

    const existing = await this.getPlayerById(id);
    if (!existing) return null;

    const ts = now();
    await this.db.run(
      `UPDATE players
       SET qq_number = NULL,
           qq_name = NULL,
           qq_bound_at = NULL,
           updated_at = ?
       WHERE id = ?`,
      ts,
      id,
    );

    const updated = await this.getPlayerById(id);
    this.cache(updated, existing);
    return updated;
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
              COALESCE(SUM(warmup_seconds), 0) AS total_warmup_seconds,
              COALESCE(SUM(commander_seconds), 0) AS total_commander_seconds,
              COALESCE(SUM(squad_leader_seconds), 0) AS total_squad_leader_seconds,
              COALESCE(SUM(in_squad_seconds), 0) AS total_in_squad_seconds,
              COALESCE(SUM(total_matches), 0) AS total_matches,
              COALESCE(SUM(total_match_wins), 0) AS total_match_wins,
              COALESCE(MAX(updated_at), 0) AS last_player_update_at
       FROM players`,
    );

    const activeWindowRow = await this.db.get(
      "SELECT COUNT(*) AS active_players FROM players WHERE updated_at >= ?",
      windowStartTs,
    );

    const assetRows = await this.db.all("SELECT assets_json FROM players");
    const totalWarmupPoints = assetRows.reduce(
      (sum, row) => sum + normalizeAssetAmount(parseAssets(row.assets_json).warmupPoints),
      0,
    );

    const permissionGroups = await this.db.all(
      `SELECT permission_group, COUNT(*) AS players
       FROM players
       GROUP BY permission_group
       ORDER BY players DESC, permission_group ASC`,
    );

    const topByPlaytime = await this.db.all(
      `SELECT id, current_name, steam_id, eos_id, game_seconds, server_seconds,
              steam_game_seconds, game_seconds_override,
              commander_seconds, squad_leader_seconds, in_squad_seconds, warmup_seconds, assets_json
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

    const sevenDayStartTs = nowTs - 7 * 24 * 60 * 60 * 1000;
    const [newPlayers7dRow, repeatStats7dRow, repeatPlayers7d] = await Promise.all([
      this.db.get(
        `SELECT COUNT(*) AS new_players_7d
         FROM players
         WHERE created_at >= ?`,
        sevenDayStartTs,
      ),
      this.db.get(
        `WITH recent AS (
           SELECT pmr.player_id,
                  COUNT(*) AS match_count,
                  COUNT(DISTINCT strftime('%Y-%m-%d', mr.started_at / 1000, 'unixepoch', 'localtime')) AS active_days
           FROM player_match_records pmr
           JOIN match_records mr ON mr.id = pmr.match_id
           WHERE mr.started_at >= ?
           GROUP BY pmr.player_id
         )
         SELECT COUNT(*) AS active_players_7d,
                SUM(CASE WHEN match_count >= 2 THEN 1 ELSE 0 END) AS repeat_players_7d,
                SUM(CASE WHEN active_days >= 2 THEN 1 ELSE 0 END) AS repeat_by_days_players_7d,
                COALESCE(AVG(match_count), 0) AS avg_matches_per_active_7d,
                COALESCE(MAX(match_count), 0) AS max_matches_per_player_7d
         FROM recent`,
        sevenDayStartTs,
      ),
      this.db.all(
        `WITH recent AS (
           SELECT pmr.player_id,
                  COUNT(*) AS match_count,
                  COUNT(DISTINCT strftime('%Y-%m-%d', mr.started_at / 1000, 'unixepoch', 'localtime')) AS active_days,
                  MAX(mr.started_at) AS last_match_at
           FROM player_match_records pmr
           JOIN match_records mr ON mr.id = pmr.match_id
           WHERE mr.started_at >= ?
           GROUP BY pmr.player_id
           HAVING match_count >= 2
         )
         SELECT p.id,
                p.current_name,
                p.steam_id,
                p.eos_id,
                recent.match_count,
                recent.active_days,
                recent.last_match_at
         FROM recent
         JOIN players p ON p.id = recent.player_id
         ORDER BY recent.match_count DESC,
                  recent.active_days DESC,
                  recent.last_match_at DESC
         LIMIT ?`,
        sevenDayStartTs,
        normalizedTop,
      ),
    ]);

    const roleTags = [];
    const componentTags = [];
    for (const row of tagStats || []) {
      if (row.tag_type === "role") roleTags.push(row);
      if (row.tag_type === "component") componentTags.push(row);
    }

    const activePlayers7d = Number(repeatStats7dRow?.active_players_7d || 0);
    const repeatPlayers7dCount = Number(repeatStats7dRow?.repeat_players_7d || 0);
    const repeatByDaysPlayers7dCount = Number(repeatStats7dRow?.repeat_by_days_players_7d || 0);

    return {
      generatedAt: nowTs,
      windowDays: normalizedDays,
      topLimit: normalizedTop,
      overview: {
        totalPlayers: Number(overviewRow?.total_players || 0),
        activePlayersInWindow: Number(activeWindowRow?.active_players || 0),
        totalGameSeconds: Number(overviewRow?.total_game_seconds || 0),
        totalServerSeconds: Number(overviewRow?.total_server_seconds || 0),
        totalWarmupSeconds: Number(overviewRow?.total_warmup_seconds || 0),
        totalWarmupPoints,
        totalCommanderSeconds: Number(overviewRow?.total_commander_seconds || 0),
        totalSquadLeaderSeconds: Number(overviewRow?.total_squad_leader_seconds || 0),
        totalInSquadSeconds: Number(overviewRow?.total_in_squad_seconds || 0),
        totalMatches: Number(overviewRow?.total_matches || 0),
        totalMatchWins: Number(overviewRow?.total_match_wins || 0),
        lastPlayerUpdateAt: Number(overviewRow?.last_player_update_at || 0) || null,
      },
      playerStats7d: {
        windowDays: 7,
        newPlayers: Number(newPlayers7dRow?.new_players_7d || 0),
        activePlayers: activePlayers7d,
        repeatPlayers: repeatPlayers7dCount,
        repeatByDaysPlayers: repeatByDaysPlayers7dCount,
        repeatRate: activePlayers7d > 0 ? repeatPlayers7dCount / activePlayers7d : 0,
        repeatByDaysRate: activePlayers7d > 0 ? repeatByDaysPlayers7dCount / activePlayers7d : 0,
        avgMatchesPerActive: Number(repeatStats7dRow?.avg_matches_per_active_7d || 0),
        maxMatchesPerPlayer: Number(repeatStats7dRow?.max_matches_per_player_7d || 0),
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
          steamGameSeconds: Number(row.steam_game_seconds || 0),
          gameSecondsOverride: row.game_seconds_override == null ? null : Number(row.game_seconds_override || 0),
          serverSeconds: Number(row.server_seconds || 0),
          commanderSeconds: Number(row.commander_seconds || 0),
          squadLeaderSeconds: Number(row.squad_leader_seconds || 0),
          inSquadSeconds: Number(row.in_squad_seconds || 0),
          warmupSeconds: Number(row.warmup_seconds || 0),
          assets: parseAssets(row.assets_json),
          warmupPoints: normalizeAssetAmount(parseAssets(row.assets_json).warmupPoints),
        })),
        byViolations: topViolations.map((row) => ({
          playerId: Number(row.player_id),
          currentName: row.current_name || null,
          steamID: row.steam_id || null,
          eosID: row.eos_id || null,
          totalViolations: Number(row.total_violations || 0),
          lastViolationAt: Number(row.last_violation_at || 0) || null,
        })),
        byRepeat7d: repeatPlayers7d.map((row) => ({
          id: Number(row.id),
          currentName: row.current_name || null,
          steamID: row.steam_id || null,
          eosID: row.eos_id || null,
          matchCount: Number(row.match_count || 0),
          activeDays: Number(row.active_days || 0),
          lastMatchAt: Number(row.last_match_at || 0) || null,
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

  async listSteamFriends(playerId) {
    return this.db.all(
      `SELECT f.friend_steam_id AS steamID,
              COALESCE(p.current_name, f.friend_name) AS name,
              COALESCE(p.steam_avatar, f.friend_avatar) AS avatar,
              p.id AS dbPlayerId,
              p.game_seconds AS gameSeconds,
              p.server_seconds AS serverSeconds,
              f.updated_at
       FROM steam_friends f
       LEFT JOIN players p ON p.steam_id = f.friend_steam_id
       WHERE f.player_id = ?
       ORDER BY COALESCE(p.current_name, f.friend_name) COLLATE NOCASE ASC`,
      Number(playerId),
    );
  }

  async upsertSteamFriends(playerId, friends = []) {
    const ts = Date.now();
    await this.db.run("DELETE FROM steam_friends WHERE player_id = ?", Number(playerId));
    if (!friends.length) return;

    const stmt = await this.db.prepare(
      `INSERT INTO steam_friends (player_id, friend_steam_id, friend_name, friend_avatar, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const friend of friends) {
      await stmt.run(Number(playerId), friend.steamID, friend.name, friend.avatar, ts);
    }
    await stmt.finalize();
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

function isPlayerIdentityConflict(error) {
  const message = String(error?.message ?? "");
  return message.includes("SQLITE_CONSTRAINT") && (
    message.includes("players.eos_id") ||
    message.includes("players.steam_id")
  );
}
