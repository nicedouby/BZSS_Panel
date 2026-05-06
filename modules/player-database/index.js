// -*- coding: utf-8 -*-

/**
 * Module: PlayerDatabase
 *
 * 长期玩家数据库的入口。
 * 当前只提供内存列表，后续接 SQLite / PostgreSQL。
 */
export function createPlayerDatabaseModule({ modules }) {
  const api = {
    listPlayers() {
      const serverId = "BZSS_Main";
      const online = modules.playerState?.getOnlinePlayers(serverId) ?? [];
      return online.map((p) => ({
        name: p.name,
        steam64: p.steam64 ?? "",
        eos: p.eos ?? "",
        state: p.state,
        lastSeenTime: p.lastSeenTime,
      }));
    },
  };

  return {
    manifest: { id: "module.playerDatabase", name: "Player Database Module", kind: "module", version: "0.1.0" },
    apiName: "playerDatabase",
    api,
  };
}
