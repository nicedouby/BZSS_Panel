// -*- coding: utf-8 -*-

import { SERVER_STATS_CHANNELS } from "./schema.js";

export function createServerStatsApi({ sampler, store, getLiveSnapshot, getServerId }) {
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
      return sampler.getCurrentSample() ?? {
        server_id: serverId ?? getServerId(),
        timestamp_ms: Date.now(),
        metrics: { players: 0, queue: 0, tps: 0 },
      };
    },

    async listAvailableDates({ serverId }) {
      return store.listAvailableDates({ serverId: serverId ?? getServerId() });
    },
  };
}
