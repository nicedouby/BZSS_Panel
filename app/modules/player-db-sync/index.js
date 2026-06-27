// -*- coding: utf-8 -*-

function identityFromPlayer(player) {
  return {
    name: player?.name ?? player?.current_name ?? null,
    steamID: player?.steamID ?? player?.steam64 ?? player?.steam_id ?? null,
    eosID: player?.eosID ?? player?.eos ?? player?.eos_id ?? null,
  };
}

/**
 * Module: PlayerDbSync
 *
 * 中间层模块：负责监听核心事件并调用 playerDatabase 的 API 进行数据写入。
 * 从而实现数据读写层与事件监听层的解耦。
 */
export function createPlayerDbSyncModule({ core, modules, logger }) {
  const unsubscribers = [];
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.playerDbSync",
    source: "module.playerDbSync",
    channel: "module",
  }) ?? core.logger;

  return {
    manifest: {
      id: "module.playerDbSync",
      name: "Player DB Sync Middleware",
      kind: "module",
      version: "0.1.0",
      description: "玩家数据库同步中间层。监听服务器事件并写入玩家数据库。",
    },

    async init() {},

    async start() {
      const dbApi = modules.playerDatabase;
      if (!dbApi) {
        moduleLogger.warn("Player Database module is not loaded. Sync middleware will be idle.");
        return;
      }

      unsubscribers.push(core.eventBus.onCoreEvent("RCON_LIST_PLAYERS_UPDATED", async (event) => {
        try {
          for (const player of event.players ?? []) {
            await dbApi.upsertFromPresence(identityFromPlayer(player));
          }
        } catch (error) {
          moduleLogger.error(`Failed to sync RCON_LIST_PLAYERS_UPDATED to DB: ${error.message}`);
        }
      }));

      moduleLogger.info("Player DB Sync middleware started.");
    },

    async stop() {
      for (const un of unsubscribers) un();
      unsubscribers.length = 0;
    },
  };
}
