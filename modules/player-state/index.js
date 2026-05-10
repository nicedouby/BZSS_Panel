// -*- coding: utf-8 -*-

import { getParam } from "../../core/event-normalizer.js";

/**
 * Module: PlayerState
 *
 * 玩家实时状态模块。
 *
 * 数据来源：
 * - Python 日志事件：出生/倒地/死亡
 * - RCON_LIST_PLAYERS_UPDATED：ListPlayers 快照
 */
export function createPlayerStateModule({ core, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.playerState",
    source: "module.playerState",
    channel: "module",
  }) ?? core.logger;
  const playersByName = new Map();
  const playersByNormalizedName = new Map();
  const playersBySteamID = new Map();
  const playersByEOSID = new Map();
  const playersByControllerID = new Map();
  const unsubscribers = [];

  function makeKey(serverId, value) {
    return `${serverId}:${value}`;
  }

  function clearServer(serverId) {
    for (const [key, p] of [...playersByName.entries()]) {
      if (p.serverId === serverId) playersByName.delete(key);
    }
    for (const [key, p] of [...playersByNormalizedName.entries()]) {
      if (p.serverId === serverId) playersByNormalizedName.delete(key);
    }
    for (const [key, p] of [...playersBySteamID.entries()]) {
      if (p.serverId === serverId) playersBySteamID.delete(key);
    }
    for (const [key, p] of [...playersByEOSID.entries()]) {
      if (p.serverId === serverId) playersByEOSID.delete(key);
    }
    for (const [key, p] of [...playersByControllerID.entries()]) {
      if (p.serverId === serverId) playersByControllerID.delete(key);
    }
  }

  function indexPlayer(player) {
    if (player.name) {
      playersByName.set(makeKey(player.serverId, player.name), player);
      const normalizedName = normalizeName(player.name);
      if (normalizedName) playersByNormalizedName.set(makeKey(player.serverId, normalizedName), player);
    }
    if (player.steamID) playersBySteamID.set(makeKey(player.serverId, player.steamID), player);
    if (player.eosID) playersByEOSID.set(makeKey(player.serverId, player.eosID), player);
    if (player.controllerID) playersByControllerID.set(makeKey(player.serverId, player.controllerID), player);
  }

  function upsertByName(serverId, name, patch = {}) {
    if (!name) return null;

    const key = makeKey(serverId, name);
    const old = playersByName.get(key) ?? {
      serverId,
      name,
      steamID: "",
      eosID: "",
      state: "unknown",
      lastSeenTime: "",
    };

    const next = {
      ...old,
      ...patch,
      lastSeenTime: new Date().toISOString(),
    };

    indexPlayer(next);
    return next;
  }

  function replaceFromRcon(serverId, players) {
    clearServer(serverId);

    for (const p of players) {
      indexPlayer({
        serverId,
        playerID: p.playerID,
        name: p.name,
        steamID: p.steamID ?? "",
        eosID: p.eosID ?? "",
        teamID: p.teamID,
        squadID: p.squadID,
        isLeader: Boolean(p.isLeader),
        role: p.role ?? "",
        state: "online",
        lastSeenTime: new Date().toISOString(),
        raw: p.raw,
      });
    }

    core.webStatus.set("playerCount", players.length);
    logWithFallback(moduleLogger, "debug", () => `Player snapshot refreshed (${players.length})`, {
      operation: "replaceFromRcon",
      data: {
        players: players.length,
        serverId,
      },
    });

    core.eventBus.emitModuleEvent("module.playerState", "playersSnapshotUpdated", {
      eventId: `module.playerState:${Date.now()}`,
      eventName: "module.playerState.playersSnapshotUpdated",
      layer: "module",
      source: "module.playerState",
      serverId,
      time: new Date().toISOString(),
      params: [],
      players: api.getOnlinePlayers(serverId),
    });
  }

  const api = {
    getPlayerByName(serverId, name) {
      const rawName = String(name ?? "");
      const trimmedName = rawName.trim();
      const normalizedName = normalizeName(name);

      return playersByName.get(makeKey(serverId, rawName))
        ?? (trimmedName ? playersByName.get(makeKey(serverId, trimmedName)) : null)
        ?? (normalizedName ? playersByNormalizedName.get(makeKey(serverId, normalizedName)) : null)
        ?? null;
    },

    getPlayerBySteamID(serverId, steamID) {
      return playersBySteamID.get(makeKey(serverId, steamID)) ?? null;
    },

    getPlayerByEOSID(serverId, eosID) {
      return playersByEOSID.get(makeKey(serverId, eosID)) ?? null;
    },

    getPlayerByControllerID(serverId, controllerID) {
      return playersByControllerID.get(makeKey(serverId, controllerID)) ?? null;
    },

    getOnlinePlayers(serverId) {
      return [...playersByName.values()].filter((p) => p.serverId === serverId);
    },

    replaceFromRcon,
  };

  return {
    manifest: { id: "module.playerState", name: "Player State Module", kind: "module", version: "0.2.0", description: "玩家实时状态维护模块。订阅玩家连接、断开、更换队伍、受伤、死亡等核心事件，在内存中维护每位在线玩家的当前状态快照，包括身份信息、所属队伍/小队、职业、存活状态等。是击杀管理、对局状态、玩家数据库等模块的基础数据源。" },
    apiName: "playerState",
    api,

    async start() {
      unsubscribers.push(core.eventBus.onCoreEvent("RCON_LIST_PLAYERS_UPDATED", (event) => {
        replaceFromRcon(event.serverId, event.players ?? []);
      }));

      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerSpawnRequested", (event) => {
        const spawnTeamID = inferTeamIDFromSpawn(getParam(event, "Spawn"));
        const player = upsertByName(event.serverId, getParam(event, "PlayerName"), {
          role: getParam(event, "DeployRole"),
          ...(spawnTeamID ? { teamID: spawnTeamID } : {}),
          state: "playing",
          lastSpawnTime: new Date().toISOString(),
        });

        if (player) {
          logWithFallback(moduleLogger, "debug", () => `Spawn update for ${player.name}`, {
            operation: "playerSpawnRequested",
            data: {
              serverId: event.serverId,
              playerName: player.name,
              role: player.role,
            },
          });
          core.eventBus.emitModuleEvent("module.playerState", "playerUpdated", {
            ...event,
            layer: "module",
            source: "module.playerState",
            eventName: "module.playerState.playerUpdated",
            player,
          });
        }
      }));

      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerWounded", (event) => {
        upsertByName(event.serverId, getParam(event, "VictimName"), {
          state: "wounded",
          eosID: getParam(event, "VictimCachedEOSID"),
          steamID: getParam(event, "VictimCachedSteam64ID"),
        });

        upsertByName(event.serverId, getParam(event, "AttackerName"), {
          state: "playing",
          eosID: getParam(event, "AttackerEOSID"),
          steamID: getParam(event, "AttackerSteam64ID"),
          controllerID: getParam(event, "AttackerControllerID"),
        });
      }));

      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerDied", (event) => {
        upsertByName(event.serverId, getParam(event, "VictimName"), {
          state: "dead",
          eosID: getParam(event, "VictimCachedEOSID"),
          steamID: getParam(event, "VictimCachedSteam64ID"),
        });

        upsertByName(event.serverId, getParam(event, "AttackerName"), {
          state: "playing",
          eosID: getParam(event, "AttackerEOSID"),
          steamID: getParam(event, "AttackerSteam64ID"),
          controllerID: getParam(event, "AttackerControllerID"),
        });
      }));

      logWithFallback(moduleLogger, "info", "PlayerState subscriptions ready.", {
        label: "MODULE",
        operation: "start",
      });
    },

    async stop() {
      for (const un of unsubscribers) un();
      logWithFallback(moduleLogger, "info", "PlayerState subscriptions stopped.", {
        label: "MODULE",
        operation: "stop",
      });
    },
  };
}

function logWithFallback(logger, method, message, context) {
  const fn = logger?.[method];
  if (typeof fn === "function") {
    fn.call(logger, message, context);
    return;
  }

  const rendered = typeof message === "function" ? message() : message;
  logger?.module?.(rendered);
}

function inferTeamIDFromSpawn(spawn) {
  const match = String(spawn ?? "").match(/\bTeam(\d+)/i);
  return match ? Number(match[1]) : "";
}

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
