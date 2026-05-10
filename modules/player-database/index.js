// -*- coding: utf-8 -*-

import { getParam } from "../../core/event-normalizer.js";
import { createDatabase } from "../../core/database.js";
import { PlayerRepository } from "../../repositories/player-repository.js";

const POST_LOGIN_PATTERN = /PostLogin:\s+NewPlayer:\s+(?<controllerClass>\S+)\s+(?<controllerPath>\S+)\s+\(IP:\s+(?<ip>[\d.]+)\s+\|\s+Online IDs:\s+EOS:\s+(?<eos>[0-9a-fA-F]+|INVALID)\s+steam:\s+(?<steam>\d+|INVALID)\)/i;

function identityFromPlayer(player) {
  return {
    name: player?.name ?? player?.current_name ?? null,
    steamID: player?.steamID ?? player?.steam64 ?? player?.steam_id ?? null,
    eosID: player?.eosID ?? player?.eos ?? player?.eos_id ?? null,
  };
}

function eventIdentity(event, prefix) {
  return {
    name: getParam(event, `${prefix}Name`) || null,
    steamID: getParam(event, `${prefix}Steam64ID`) || getParam(event, `${prefix}SteamID`) || null,
    eosID: getParam(event, `${prefix}EOSID`) || null,
  };
}

function recordIdentity(record, prefix) {
  return {
    name: record?.[`${prefix}Name`] || null,
    steamID: record?.[`${prefix}Steam64ID`] || record?.[`${prefix}SteamID`] || null,
    eosID: record?.[`${prefix}EOSID`] || null,
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

  async function recordCombat(event, type) {
    const victimIdentity = eventIdentity(event, "Victim");
    const attackerIdentity = eventIdentity(event, "Attacker");
    const victim = victimIdentity.name || victimIdentity.steamID || victimIdentity.eosID
      ? await repo.upsertFromPresence(victimIdentity)
      : null;
    const attacker = attackerIdentity.name || attackerIdentity.steamID || attackerIdentity.eosID
      ? await repo.upsertFromPresence(attackerIdentity)
      : null;

    if (type === "wounded") {
      if (attacker?.id && attacker.id !== victim?.id) await repo.incrementFields(attacker.id, { total_downed_light: 1 });
      if (victim?.id) await repo.incrementFields(victim.id, { total_downed_received: 1 });
    }

    if (type === "died") {
      if (victim?.id) await repo.incrementFields(victim.id, { total_deaths: 1 });
      if (attacker?.id && attacker.id !== victim?.id) {
        await repo.incrementFields(attacker.id, { total_kills_light: 1 });
      } else if (victim?.id) {
        await repo.incrementFields(victim.id, { total_suicides: 1 });
      }
    }

    await repo.addLogEvent({
      sourceEvent: event.eventName,
      eventName: `combat.${type}`,
      rawLine: event.rawLog,
      matchedPlayerName: victimIdentity.name || attackerIdentity.name,
      payload: event,
    });
  }

  async function recordFriendlyFireStats(event) {
    const record = event?.record;
    if (!record?.isFriendlyFire) return;

    const attackerIdentity = recordIdentity(record, "attacker");
    const attacker = attackerIdentity.name || attackerIdentity.steamID || attackerIdentity.eosID
      ? await repo.upsertFromPresence(attackerIdentity)
      : null;
    if (!attacker?.id) return;

    if (record.friendlyFireType === "team_wound" || record.isTeamKillDown || record.tkDown) {
      await repo.incrementFields(attacker.id, { total_tk_down: 1 });
    } else if (record.friendlyFireType === "team_kill" || record.isTeamKill || record.tk) {
      await repo.incrementFields(attacker.id, { total_tk_kill: 1 });
    }
  }

  const api = {
    async listPlayers(options = {}) {
      const [players, total, stats] = await Promise.all([
        repo.listPlayers(options),
        repo.countPlayers(options),
        repo.getDatabaseStats(options),
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
          ladderRating: Number(p.ladder_rating ?? 1000),
          gameSeconds: Number(p.game_seconds ?? 0),
          serverSeconds: Number(p.server_seconds ?? 0),
          commanderSeconds: Number(p.commander_seconds ?? 0),
          squadLeaderSeconds: Number(p.squad_leader_seconds ?? 0),
          inSquadSeconds: Number(p.in_squad_seconds ?? 0),
          warmupSeconds: Number(p.warmup_seconds ?? 0),
          kills: Number(p.total_kills_light ?? 0) + Number(p.total_kills_other ?? 0),
          downs: Number(p.total_downed_light ?? 0) + Number(p.total_downed_other ?? 0),
          deaths: Number(p.total_deaths ?? 0),
          teamKills: Number(p.total_tk_down ?? 0) + Number(p.total_tk_kill ?? 0),
          suicides: Number(p.total_suicides ?? 0),
          squadCreated: Number(p.total_squad_created ?? 0),
          lastLoginAt: Number(p.last_login_at ?? 0) || null,
          updatedAt: Number(p.updated_at ?? 0) || null,
        })),
        total,
        stats,
      };
    },

    async getStats(options = {}) {
      return repo.getDatabaseStats(options);
    },

    async getPlayerDetail(playerId) {
      return repo.getPlayerDetail(playerId);
    },

    async setPermissionGroup(playerId, permissionGroup) {
      await repo.setPermissionGroup(playerId, permissionGroup);
      return { ok: true };
    },

    async resetKillStats() {
      return { changed: await repo.resetKillStats() };
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
    manifest: { id: "module.playerDatabase", name: "Player Database Module", kind: "module", version: "0.2.0", description: "玩家持久化数据库模块。将玩家历史出现记录、SteamID/EOSID 映射关系、权限组设置等信息持久化至本地 SQLite 数据库。提供玩家搜索、详情查询、权限组修改等 API，是玩家管理页面的后端核心，也是黑名单、积分等功能的数据基础。" },
    apiName: "playerDatabase",
    api,

    async init() {
      db = await createDatabase(config.get("database", config.get("modules.playerDatabase.database", {})));
      repo = new PlayerRepository(db);
      await repo.hydrateCache();
    },

    async start() {
      unsubscribers.push(core.eventBus.onCoreEvent("RCON_LIST_PLAYERS_UPDATED", async (event) => {
        for (const player of event.players ?? []) {
          await repo.upsertFromPresence(identityFromPlayer(player));
        }
      }));

      unsubscribers.push(core.eventBus.onCoreEvent("On_SquadCreated", async (event) => {
        const player = await repo.upsertFromPresence({
          name: getParam(event, "PlayerName"),
          steamID: getParam(event, "Steam64ID"),
          eosID: getParam(event, "EOSID"),
        });
        await repo.addSquadCreated({
          playerId: player?.id ?? null,
          squadID: getParam(event, "SquadID") || null,
          squadName: getParam(event, "SquadName") || null,
          teamName: getParam(event, "FactionName") || null,
        });
      }));

      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerWounded", (event) => recordCombat(event, "wounded")));
      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerDied", (event) => recordCombat(event, "died")));
      if (core.eventBus.onModuleEvent) {
        unsubscribers.push(core.eventBus.onModuleEvent("module.killManage", "combatResolved", recordFriendlyFireStats));
      }

      unsubscribers.push(core.eventBus.onCoreEvent("*", async (event) => {
        if (!event?.eventName || event.eventName === "On_PlayerWounded" || event.eventName === "On_PlayerDied") return;

        const rawLine = event.rawLog ?? "";
        const login = rawLine.match(POST_LOGIN_PATTERN);
        if (login?.groups) {
          const { controllerClass, controllerPath, ip, eos, steam } = login.groups;
          const player = await repo.upsertFromPresence({ eosID: eos, steamID: steam, ip });
          await repo.recordLogin({
            playerId: player?.id ?? null,
            ip,
            eosID: eos,
            steamID: steam,
            controllerPath: `${controllerClass} ${controllerPath}`,
          });
        }

        await repo.addLogEvent({
          sourceEvent: event.eventName,
          eventName: event.eventName,
          rawLine,
          payload: event,
        });
      }));
    },

    async stop() {
      for (const un of unsubscribers) un();
      unsubscribers.length = 0;
      await db?.close();
    },
  };
}
