// -*- coding: utf-8 -*-

import { SERVER_STATS_CHANNELS } from "./schema.js";

export function createServerStatsApi({ sampler, store, getLiveSnapshot, getServerId, getMatchStateSnapshot, core }) {
  return {
    getChannels() {
      return SERVER_STATS_CHANNELS.map((channel) => ({ ...channel }));
    },

    async getHistory({ serverId, fromMs, toMs, includeCurrent = false }) {
      const history = await store.getHistory({
        serverId: serverId ?? getServerId(),
        fromMs: Number(fromMs),
        toMs: Number(toMs),
        includeCurrent,
      });

      return {
        ...history,
        channels: this.getChannels(),
      };
    },

    async getCurrent({ serverId }) {
      const sample = sampler.getCurrentSample() ?? {
        server_id: serverId ?? getServerId(),
        timestamp_ms: Date.now(),
        metrics: { players: 0, queue: 0, tps: 0 },
      };

      const matchState = getMatchStateSnapshot ? getMatchStateSnapshot() : null;
      const serverStatus = matchState?.serverStatus ?? {};
      const status = core?.webStatus?.getSnapshot?.() ?? {};
      const roundCurrent = matchState?.round?.current ?? {};

      return {
        timestamp_ms: sample.timestamp_ms,
        server: {
          id: sample.server_id,
          name: status.serverName ?? "BZSS Server",
          maxPlayers: Number(status.serverTickRate?.maxPlayers ?? status.maxPlayers ?? serverStatus.maxPlayers ?? 100),
          maxQueue: Number(status.serverTickRate?.maxQueue ?? status.maxQueue ?? serverStatus.maxQueue ?? 50),
        },
        match: {
          map: status.currentLayer || serverStatus.map || roundCurrent.mapName || "Unknown",
          layer: serverStatus.layer || roundCurrent.layerName || "Unknown",
          mode: serverStatus.mode || roundCurrent.gameMode || "Unknown",
          startedAt: roundCurrent.serverPlayAt || roundCurrent.logLineTime || roundCurrent.receivedAt || null,
          roundId: roundCurrent.dedupeKey || null,
          phase: matchState?.match?.phase ?? "unknown"
        },
        metrics: sample.metrics,
      };
    },

    async listAvailableDates({ serverId }) {
      return store.listAvailableDates({ serverId: serverId ?? getServerId() });
    },
  };
}
