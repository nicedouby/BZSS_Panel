// -*- coding: utf-8 -*-

import { createDatabase } from "../../core/database.js";
import { PlayerRepository } from "../../repositories/player-repository.js";

function identityFromPlayer(player) {
  return {
    name: player?.name ?? player?.current_name ?? null,
    steamID: player?.steamID ?? player?.steam64 ?? player?.steam_id ?? null,
    eosID: player?.eosID ?? player?.eos ?? player?.eos_id ?? null,
  };
}

/**
 * Module: PlayerDatabase
 *
 * MicePanel-compatible player database. The default SQLite file is
 * data/micepanel.db, matching the current MicePanel schema naming.
 */
export function createPlayerDatabaseModule({ core, modules, config }) {
  let db = null;
  let repo = null;
  const unsubscribers = [];

  async function upsertOnlinePlayers(serverId) {
    const online = modules.playerState?.getOnlinePlayers(serverId) ?? [];
    for (const player of online) {
      await repo.upsertFromPresence(identityFromPlayer(player));
    }
  }

  const api = {
    async listPlayers(options = {}) {
      const [players, total] = await Promise.all([
        repo.listPlayers(options),
        repo.countPlayers(options),
      ]);

      return {
        items: players,
        players: players.map((p) => ({
          id: p.id,
          name: p.current_name ?? "",
          steam64: p.steam_id ?? "",
          steamID: p.steam_id ?? "",
          eos: p.eos_id ?? "",
          eosID: p.eos_id ?? "",
          ip: p.current_ip ?? "",
          permissionGroup: p.permission_group ?? "default",
          gameSeconds: Number(p.game_seconds ?? 0),
          serverSeconds: Number(p.server_seconds ?? 0),
          commanderSeconds: Number(p.commander_seconds ?? 0),
          squadLeaderSeconds: Number(p.squad_leader_seconds ?? 0),
          inSquadSeconds: Number(p.in_squad_seconds ?? 0),
          warmupSeconds: Number(p.warmup_seconds ?? 0),
          suicides: Number(p.total_suicides ?? 0),
          updatedAt: Number(p.updated_at ?? 0) || null,
        })),
        total,
      };
    },

    async getStats(options = {}) {
      return repo.getDatabaseStats(options);
    },

    async getPlayerDetail(playerId) {
      return repo.getPlayerDetail(playerId);
    },

    async listPlayerAliases(playerId, options = {}) {
      return repo.listPlayerAliases(playerId, options);
    },

    async listPlayerIps(playerId, options = {}) {
      return repo.listPlayerIps(playerId, options);
    },

    async setPermissionGroup(playerId, permissionGroup) {
      await repo.setPermissionGroup(playerId, permissionGroup);
      return { ok: true };
    },

    async deletePlayer(playerId) {
      return { deleted: await repo.deletePlayer(playerId) };
    },

    async syncOnline(serverId = core.webStatus.serverId) {
      await upsertOnlinePlayers(serverId);
      return { ok: true };
    },

    async upsertFromPresence(identity = {}) {
      return repo.upsertFromPresence(identity);
    },

    async updateGameDuration(playerId, gameSeconds) {
      return repo.updateGameDuration(playerId, gameSeconds);
    },

    async listPlayersWithSteamID() {
      return repo.listPlayersWithSteamID();
    },

    async getCachedPlayer(identity = {}) {
      return repo.findCachedPlayer(identity);
    },

  };

  return {
    manifest: { id: "module.playerDatabase", name: "Player Database Module", kind: "module", version: "0.2.0", description: "玩家持久化数据库模块。只提供数据读写接口，不主动监听事件。" },
    apiName: "playerDatabase",
    api,

    async init() {
      db = await createDatabase(config.get("database", config.get("modules.playerDatabase.database", {})));
      repo = new PlayerRepository(db);
      await repo.hydrateCache();
    },

    async start() {
      // Event listening has been moved to module.playerDbSync
    },

    async stop() {
      for (const un of unsubscribers) un();
      unsubscribers.length = 0;
      await db?.close();
    },
  };
}
