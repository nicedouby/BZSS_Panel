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
export function createPlayerStateModule({ core }) {
  const playersByName = new Map();
  const playersBySteamID = new Map();
  const playersByEOSID = new Map();
  const unsubscribers = [];

  function makeKey(serverId, value) {
    return `${serverId}:${value}`;
  }

  function clearServer(serverId) {
    for (const [key, p] of [...playersByName.entries()]) {
      if (p.serverId === serverId) playersByName.delete(key);
    }
    for (const [key, p] of [...playersBySteamID.entries()]) {
      if (p.serverId === serverId) playersBySteamID.delete(key);
    }
    for (const [key, p] of [...playersByEOSID.entries()]) {
      if (p.serverId === serverId) playersByEOSID.delete(key);
    }
  }

  function indexPlayer(player) {
    if (player.name) playersByName.set(makeKey(player.serverId, player.name), player);
    if (player.steamID) playersBySteamID.set(makeKey(player.serverId, player.steamID), player);
    if (player.eosID) playersByEOSID.set(makeKey(player.serverId, player.eosID), player);
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
      return playersByName.get(makeKey(serverId, name)) ?? null;
    },

    getPlayerBySteamID(serverId, steamID) {
      return playersBySteamID.get(makeKey(serverId, steamID)) ?? null;
    },

    getPlayerByEOSID(serverId, eosID) {
      return playersByEOSID.get(makeKey(serverId, eosID)) ?? null;
    },

    getOnlinePlayers(serverId) {
      return [...playersByName.values()].filter((p) => p.serverId === serverId);
    },

    replaceFromRcon,
  };

  return {
    manifest: { id: "module.playerState", name: "Player State Module", kind: "module", version: "0.2.0" },
    apiName: "playerState",
    api,

    async start() {
      unsubscribers.push(core.eventBus.onCoreEvent("RCON_LIST_PLAYERS_UPDATED", (event) => {
        replaceFromRcon(event.serverId, event.players ?? []);
      }));

      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerSpawnRequested", (event) => {
        const player = upsertByName(event.serverId, getParam(event, "PlayerName"), {
          role: getParam(event, "DeployRole"),
          state: "playing",
          lastSpawnTime: new Date().toISOString(),
        });

        if (player) {
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
        upsertByName(event.serverId, getParam(event, "VictimName"), { state: "wounded" });
      }));

      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerDied", (event) => {
        upsertByName(event.serverId, getParam(event, "VictimName"), { state: "dead" });
      }));
    },

    async stop() {
      for (const un of unsubscribers) un();
    },
  };
}
