// -*- coding: utf-8 -*-

import { getParam } from "../../core/event-normalizer.js";

/**
 * Module: SquadState
 *
 * 小队实时状态模块。
 *
 * 数据来源：
 * - Python On_SquadCreated
 * - RCON_LIST_SQUADS_UPDATED：ListSquads 快照
 */
export function createSquadStateModule({ core }) {
  const squads = new Map();
  const unsubscribers = [];

  function key(serverId, teamID, squadID) {
    return `${serverId}:${teamID ?? ""}:${squadID}`;
  }

  function clearServer(serverId) {
    for (const [k, squad] of [...squads.entries()]) {
      if (squad.serverId === serverId) squads.delete(k);
    }
  }

  function setSquad(squad) {
    squads.set(key(squad.serverId, squad.teamID, squad.squadID), squad);
  }

  function replaceFromRcon(serverId, rconSquads) {
    clearServer(serverId);

    for (const s of rconSquads) {
      setSquad({
        serverId,
        teamID: s.teamID,
        teamName: s.teamName,
        squadID: s.squadID,
        squadName: s.squadName,
        name: s.squadName,
        size: s.size,
        locked: Boolean(s.locked),
        creatorName: s.creatorName,
        creatorSteamID: s.creatorSteamID ?? "",
        creatorEOSID: s.creatorEOSID ?? "",
        leaderName: s.creatorName,
        leaderSteamID: s.creatorSteamID ?? "",
        leaderEOSID: s.creatorEOSID ?? "",
        raw: s.raw,
      });
    }

    core.webStatus.set("squadCount", rconSquads.length);

    core.eventBus.emitModuleEvent("module.squadState", "squadsSnapshotUpdated", {
      eventId: `module.squadState:${Date.now()}`,
      eventName: "module.squadState.squadsSnapshotUpdated",
      layer: "module",
      source: "module.squadState",
      serverId,
      time: new Date().toISOString(),
      params: [],
      squads: api.getSquads(serverId),
    });
  }

  const api = {
    getSquad(serverId, teamID, squadID) {
      return squads.get(key(serverId, teamID, squadID)) ?? null;
    },

    getSquads(serverId) {
      return [...squads.values()].filter((s) => s.serverId === serverId);
    },

    replaceFromRcon,
  };

  return {
    manifest: { id: "module.squadState", name: "Squad State Module", kind: "module", version: "0.2.0", description: "小队实时状态维护模块。订阅建队、解队、加入/离开小队等核心事件，在内存中维护每支小队的成员列表、队长、队名和公开状态快照。建队顺序追踪、队伍平衡等模块依赖此模块的快照数据进行判断和操作。" },
    apiName: "squadState",
    api,

    async start() {
      unsubscribers.push(core.eventBus.onCoreEvent("RCON_LIST_SQUADS_UPDATED", (event) => {
        replaceFromRcon(event.serverId, event.squads ?? []);
      }));

      unsubscribers.push(core.eventBus.onCoreEvent("On_SquadCreated", (event) => {
        const squadID = getParam(event, "SquadID");

        const squad = {
          serverId: event.serverId,
          teamID: "",
          teamName: getParam(event, "FactionName"),
          squadID,
          squadName: getParam(event, "SquadName"),
          name: getParam(event, "SquadName"),
          size: 0,
          locked: false,
          leaderName: getParam(event, "PlayerName"),
          leaderEOSID: getParam(event, "EOSID"),
          leaderSteamID: getParam(event, "Steam64ID"),
          createdAt: event.time,
          memberSteamIDs: [],
        };

        setSquad(squad);
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

    async stop() {
      for (const un of unsubscribers) un();
    },
  };
}
