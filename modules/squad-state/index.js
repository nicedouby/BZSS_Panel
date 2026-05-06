// -*- coding: utf-8 -*-

import { getParam } from "../../core/event-normalizer.js";

/**
 * Module: SquadState
 *
 * 小队实时状态。
 */
export function createSquadStateModule({ core }) {
  const squads = new Map();
  const unsubscribers = [];

  function key(serverId, squadId) {
    return `${serverId}:${squadId}`;
  }

  const api = {
    getSquad(serverId, squadId) {
      return squads.get(key(serverId, squadId)) ?? null;
    },
    getSquads(serverId) {
      return [...squads.values()].filter((s) => s.serverId === serverId);
    },
  };

  return {
    manifest: { id: "module.squadState", name: "Squad State Module", kind: "module", version: "0.1.0" },
    apiName: "squadState",
    api,

    async start() {
      unsubscribers.push(core.eventBus.onCoreEvent("On_SquadCreated", (event) => {
        const squadId = getParam(event, "SquadID");
        const squad = {
          serverId: event.serverId,
          squadId,
          name: getParam(event, "SquadName"),
          leaderName: getParam(event, "PlayerName"),
          leaderEOS: getParam(event, "EOSID"),
          leaderSteam64: getParam(event, "Steam64ID"),
          faction: getParam(event, "FactionName"),
          createdAt: event.time,
          memberSteam64s: [],
        };

        squads.set(key(event.serverId, squadId), squad);
        core.webStatus.set("squadCount", api.getSquads(event.serverId).length);

        core.eventBus.emitModuleEvent("module.squadState", "squadCreated", {
          ...event,
          layer: "module",
          source: "module.squadState",
          eventName: "module.squadState.squadCreated",
          squad,
        });
      }));
    },

    async stop() { for (const un of unsubscribers) un(); },
  };
}
