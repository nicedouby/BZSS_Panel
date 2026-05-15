// -*- coding: utf-8 -*-

import { getParam } from "../../core/event-normalizer.js";
import { createDatabase } from "../../core/database.js";
import { PlayerRepository } from "../../repositories/player-repository.js";

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

function resolveTeamID(identity, player, event, prefix) {
  return identity?.teamID
    ?? player?.teamID
    ?? event?.[`${prefix}TeamID`]
    ?? event?.[`${prefix}TeamId`]
    ?? "";
}

function sameTeam(left, right) {
  const a = String(left ?? "").trim();
  const b = String(right ?? "").trim();
  return Boolean(a && b && a === b);
}

function buildCombatSourceEventId(event, type) {
  return String(
    event?.eventId
      ?? event?.sourceEventId
      ?? event?.eventName
      ?? `${event?.serverId ?? ""}:${type}:${event?.time ?? ""}:${event?.rawLog ?? ""}`,
  ).trim() || null;
}

function eventIdentityWeapon(event) {
  return String(event?.weapon ?? event?.causedBy ?? event?.FromObject ?? event?.fromObject ?? "").trim() || null;
}

function eventDamageValue(event, type) {
  const value = type === "wounded"
    ? event?.KillingDamage
    : event?.KillingDamage ?? event?.ActualDamage;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function eventTimeMs(event) {
  const ts = Number(event?.time ?? event?.timestamp ?? 0);
  if (Number.isFinite(ts) && ts > 0) return Math.trunc(ts);
  const parsed = Date.parse(String(event?.time ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function isWarmupActive(core, modules, event) {
  const snapshot = core.webStatus?.getSnapshot?.() ?? {};
  const match = core.runtimeState?.getMatch?.() ?? {};
  const roundState = modules.roundState?.getState?.() ?? null;
  const matchState = modules.matchState?.getState?.() ?? null;

  const candidates = [
    event?.isWarmup,
    event?.warmup,
    event?.phase,
    event?.roundState,
    event?.matchState,
    snapshot?.phase,
    snapshot?.roundState,
    snapshot?.matchState,
    match?.phase,
    match?.roundState,
    match?.state,
    roundState?.phase,
    roundState?.state,
    matchState?.phase,
    matchState?.state,
  ];

  return candidates.some((value) => {
    const text = String(value ?? "").trim().toLowerCase();
    return text === "warmup"
      || text === "preround"
      || text === "staging"
      || text === "waiting"
      || text === "preparation";
  });
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

    if (isWarmupActive(core, modules, event)) {
      await recordWarmupCombatOnly({ attacker, victim, type });
      return;
    }

    await recordNormalCombatWithLog({
      event,
      type,
      attacker,
      victim,
      attackerIdentity,
      victimIdentity,
    });
  }

  async function recordWarmupCombatOnly({ attacker, victim, type }) {
    if (type === "wounded") {
      if (attacker?.id && attacker.id !== victim?.id) {
        await repo.incrementWarmupCombatStats(attacker.id, { downs: 1 });
      }
      return;
    }

    if (type === "died") {
      if (victim?.id) {
        await repo.incrementWarmupCombatStats(victim.id, { deaths: 1 });
      }

      if (attacker?.id && attacker.id !== victim?.id) {
        await repo.incrementWarmupCombatStats(attacker.id, { kills: 1 });
      }
    }
  }

  async function recordNormalCombatWithLog({
    event,
    type,
    attacker,
    victim,
    attackerIdentity,
    victimIdentity,
  }) {
    void event;
    void type;
    void attacker;
    void victim;
    void attackerIdentity;
    void victimIdentity;
  }

  async function recordFriendlyFireStats(event) {
    void event;
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
          squadCreated: Number(p.total_squad_created ?? 0),
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

    async listPlayerSquadCreated(playerId, options = {}) {
      return repo.listPlayerSquadCreated(playerId, options);
    },

    async getPlayerWarmupStats(playerId) {
      return repo.getPlayerWarmupStats(playerId);
    },

    async listWarmupCombatStats(options = {}) {
      return repo.listWarmupCombatStats(options);
    },

    async setPermissionGroup(playerId, permissionGroup) {
      await repo.setPermissionGroup(playerId, permissionGroup);
      return { ok: true };
    },

    async resetCombatStats() {
      return { changed: await repo.resetCombatStats() };
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
    manifest: { id: "module.playerDatabase", name: "Player Database Module", kind: "module", version: "0.2.0", description: "玩家持久化数据库模块。将玩家历史出现记录、SteamID/EOSID 映射关系、权限组设置等信息持久化至本地 SQLite 数据库。提供玩家搜索、详情查询、权限组修改等 API，是玩家管理页面的后端核心，也是玩家档案功能的数据基础。" },
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
      unsubscribers.push(core.eventBus.onCoreEvent("*", async (event) => {
        if (!event?.eventName || event.eventName === "On_PlayerWounded" || event.eventName === "On_PlayerDied") return;

      await repo.addLogEvent({
        sourceEvent: event.eventName,
        eventName: event.eventName,
        rawLine: event.rawLog ?? "",
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
