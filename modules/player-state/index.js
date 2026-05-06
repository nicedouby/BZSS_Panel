// -*- coding: utf-8 -*-

import { getParam } from "../../core/event-normalizer.js";

/**
 * Module: PlayerState
 *
 * 当前在线玩家实时状态。
 */
export function createPlayerStateModule({ core }) {
  const playersByName = new Map();
  const unsubscribers = [];

  function upsertByName(serverId, name, patch = {}) {
    if (!name) return null;

    const key = `${serverId}:${name}`;
    const old = playersByName.get(key) ?? {
      serverId,
      name,
      state: "unknown",
      lastSeenTime: "",
    };

    const next = { ...old, ...patch, lastSeenTime: new Date().toISOString() };
    playersByName.set(key, next);
    return next;
  }

  const api = {
    getPlayerByName(serverId, name) {
      return playersByName.get(`${serverId}:${name}`) ?? null;
    },
    getOnlinePlayers(serverId) {
      return [...playersByName.values()].filter((p) => p.serverId === serverId);
    },
  };

  return {
    manifest: { id: "module.playerState", name: "Player State Module", kind: "module", version: "0.1.0" },
    apiName: "playerState",
    api,

    async start() {
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

    async stop() { for (const un of unsubscribers) un(); },
  };
}
