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

function parseAssets(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (!value || String(value).trim() === "") return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function warmupPointsFromPlayer(player) {
  const direct = Number(player?.warmupPoints ?? 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const assets = parseAssets(player?.assets ?? player?.assets_json ?? player?.assetsJson);
  const value = Number(assets.warmupPoints ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function blackEdgeSwitchCountFromPlayer(player) {
  const direct = Number(player?.blackEdgeSwitchCount ?? 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const assets = parseAssets(player?.assets ?? player?.assets_json ?? player?.assetsJson);
  const value = Number(assets.blackEdgeSwitchCount ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizedText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function steamProfileMatches(existing, steamID, steamAvatar, profile = {}) {
  if (!existing) return false;

  const checks = [
    [normalizedText(steamAvatar), normalizedText(existing.avatar_medium ?? existing.avatarMedium)],
    [normalizedText(profile.personaName ?? profile.personaname), normalizedText(existing.persona_name ?? existing.personaName)],
    [
      normalizedText(profile.profileUrl ?? profile.profileurl),
      normalizedText(existing.profile_url ?? existing.profileUrl) ?? `https://steamcommunity.com/profiles/${steamID}/`,
    ],
    [normalizedText(profile.avatar ?? profile.avatarsmall), normalizedText(existing.avatar_small ?? existing.avatarSmall)],
    [normalizedText(profile.avatarMedium ?? profile.avatarmedium), normalizedText(existing.avatar_medium ?? existing.avatarMedium)],
    [normalizedText(profile.avatarFull ?? profile.avatarfull), normalizedText(existing.avatar_full ?? existing.avatarFull)],
  ];

  for (const [expected, current] of checks) {
    if (expected != null && expected !== current) return false;
  }

  const visibility = Number(profile.communityvisibilitystate);
  if (Number.isFinite(visibility)) {
    const currentVisibility = Number(existing.community_visibility_state ?? existing.communityVisibilityState);
    if (!Number.isFinite(currentVisibility) || visibility !== currentVisibility) return false;
  }

  return true;
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
        items: players.map((p) => ({
          ...p,
          assets: parseAssets(p.assets ?? p.assets_json ?? p.assetsJson),
          warmupPoints: warmupPointsFromPlayer(p),
          blackEdgeSwitchCount: blackEdgeSwitchCountFromPlayer(p),
        })),
        players: players.map((p) => ({
          id: p.id,
          name: p.current_name ?? "",
          steam64: p.steam_id ?? "",
          steamID: p.steam_id ?? "",
          eos: p.eos_id ?? "",
          eosID: p.eos_id ?? "",
          ip: p.current_ip ?? "",
          permissionGroup: p.permission_group ?? "default",
          steamGameSeconds: Number(p.steam_game_seconds ?? 0),
          gameSeconds: Number(p.game_seconds ?? 0),
          gameSecondsOverride: p.game_seconds_override == null ? null : Number(p.game_seconds_override ?? 0),
          serverSeconds: Number(p.server_seconds ?? 0),
          commanderSeconds: Number(p.commander_seconds ?? 0),
          squadLeaderSeconds: Number(p.squad_leader_seconds ?? 0),
          inSquadSeconds: Number(p.in_squad_seconds ?? 0),
          warmupSeconds: Number(p.warmup_seconds ?? 0),
          assets: parseAssets(p.assets ?? p.assets_json ?? p.assetsJson),
          warmupPoints: warmupPointsFromPlayer(p),
          blackEdgeSwitchCount: blackEdgeSwitchCountFromPlayer(p),
          suicides: Number(p.total_suicides ?? 0),
          updatedAt: Number(p.updated_at ?? 0) || null,
          steamAvatar: p.steam_avatar ?? null,
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

    async listPlayerSessionHistory(playerId, options = {}) {
      return repo.listPlayerSessionHistory(playerId, options);
    },

    async listPlayerContainer(playerId, container, options = {}) {
      return repo.listPlayerContainer(playerId, container, options);
    },

    async listPlayerTags(playerId, tagType = null) {
      return repo.listPlayerTags(playerId, tagType);
    },

    async replacePlayerTags(playerId, tagType, tagValues = []) {
      return repo.replacePlayerTags(playerId, tagType, tagValues);
    },

    async setPlayerTagPresence(playerId, tagType, tagValue, enabled) {
      return repo.setPlayerTagPresence(playerId, tagType, tagValue, enabled);
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

    async bindQQToPlayer(playerId, binding = {}) {
      return repo.bindQQToPlayer(playerId, binding);
    },

    async unbindQQFromPlayer(playerId) {
      return repo.unbindQQFromPlayer(playerId);
    },

    async findByIdentity(identity = {}) {
      return repo.findByIdentity(identity);
    },

    async updateGameDuration(playerId, gameSeconds) {
      return repo.updateGameDuration(playerId, gameSeconds);
    },

    async addTimeStats(playerId, patch = {}) {
      return repo.addTimeStats(playerId, patch);
    },

    async addAssetAmount(playerId, assetKey, amount) {
      return repo.addAssetAmount(playerId, assetKey, amount);
    },

    async consumeAssetAmount(playerId, assetKey, amount) {
      return repo.consumeAssetAmount(playerId, assetKey, amount);
    },

    async addAssetByIdentity(identity = {}, assetKey, amount) {
      const player = await repo.upsertFromPresence(identityFromPlayer(identity));
      if (!player?.id) return null;
      return repo.addAssetAmount(player.id, assetKey, amount);
    },

    async consumeAssetByIdentity(identity = {}, assetKey, amount) {
      const player = await repo.findByIdentity(identityFromPlayer(identity));
      if (!player?.id) {
        return {
          ok: false,
          error: "PlayerNotFound",
          message: "Player not found.",
          player: null,
          remaining: 0,
        };
      }
      return repo.consumeAssetAmount(player.id, assetKey, amount);
    },

    async setGameDurationOverride(playerId, gameSeconds) {
      return repo.setGameDurationOverride(playerId, gameSeconds);
    },

    async updateSteamAvatarBySteamID(steamID, steamAvatar, profile = {}) {
      const normalizedSteamID = String(steamID ?? "").trim();
      if (!normalizedSteamID) return null;

      const cachedPlayer = repo.bySteamID?.get?.(normalizedSteamID) ?? null;
      if (cachedPlayer?.id && normalizedText(cachedPlayer.steam_avatar) === normalizedText(steamAvatar)) {
        const existingProfile = await repo.getSteamProfile(cachedPlayer.id, cachedPlayer);
        if (steamProfileMatches(existingProfile, normalizedSteamID, steamAvatar, profile)) {
          return cachedPlayer;
        }
      }

      return repo.updateSteamAvatarBySteamID(normalizedSteamID, steamAvatar, profile);
    },

    async listPlayersWithSteamID(options = {}) {
      return repo.listPlayersWithSteamID(options);
    },

    async listPlayersBySteamIDs(steamIDs = []) {
      return repo.listPlayersBySteamIDs(steamIDs);
    },

    async listSquadBrowserBzssTopBySteamIDs(steamIDs = []) {
      return repo.listSquadBrowserBzssTopBySteamIDs(steamIDs);
    },

    async listPlayersByIdentities(identities = {}) {
      return repo.listPlayersByIdentities(identities);
    },

    async getCachedPlayer(identity = {}) {
      return repo.findCachedPlayer(identity);
    },

    async addSessionHistory(playerId, session = {}) {
      return repo.addSessionHistory(playerId, session);
    },

    async closeOpenSessionHistory(playerId, session = {}) {
      return repo.closeOpenSessionHistory(playerId, session);
    },

    async upsertSquadBrowserSessions(playerId, sessions = [], fetchedAt = Date.now()) {
      return repo.upsertSquadBrowserSessions(playerId, sessions, fetchedAt);
    },

    async listSquadBrowserSessions(playerId, options = {}) {
      return repo.listSquadBrowserSessions(playerId, options);
    },

    async upsertSquadBrowserProfile(playerId, licenseId, profile = {}, fetchedAt = Date.now(), lastError = null) {
      return repo.upsertSquadBrowserProfile(playerId, licenseId, profile, fetchedAt, lastError);
    },

    async recordSquadBrowserLookupFailure(playerId, licenseId, error) {
      return repo.recordSquadBrowserLookupFailure(playerId, licenseId, error);
    },

    async listSquadBrowserRefreshCandidates(options = {}) {
      return repo.listSquadBrowserRefreshCandidates(options);
    },

    async listSquadBrowserRefreshCandidatesBySteamIDs(steamIDs = [], options = {}) {
      return repo.listSquadBrowserRefreshCandidatesBySteamIDs(steamIDs, options);
    },

    async replaceSquadBrowserServerRankings(playerId, rankings = [], fetchedAt = Date.now()) {
      return repo.replaceSquadBrowserServerRankings(playerId, rankings, fetchedAt);
    },

    async listSteamFriends(playerId) {
      return repo.listSteamFriends(playerId);
    },

    async upsertSteamFriends(playerId, friends) {
      return repo.upsertSteamFriends(playerId, friends);
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
