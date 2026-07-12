// -*- coding: utf-8 -*-

import { SERVER_STATS_CHANNELS } from "./schema.js";

export function createServerStatsApi({ sampler, store, getLiveSnapshot, getServerId, getMatchStateSnapshot, core }) {
  return {
    getChannels() {
      return SERVER_STATS_CHANNELS.map((channel) => ({ ...channel }));
    },

    async getHistory({ serverId, fromMs, toMs, includeCurrent = false, maxPoints = 1500, signal }) {
      const boundedMaxPoints = Math.max(2, Math.min(5000, Math.floor(Number(maxPoints) || 1500)));
      const history = await store.getHistory({
        serverId: serverId ?? getServerId(),
        fromMs: Number(fromMs),
        toMs: Number(toMs),
        maxPoints: includeCurrent ? Math.max(2, boundedMaxPoints - 1) : boundedMaxPoints,
        signal,
      });

      if (includeCurrent) {
        const live = sampler.getCurrentSample();
        const liveTimestamp = Number(live?.timestamp_ms);
        const lastTimestamp = Number(history.samples.at(-1)?.timestamp_ms ?? 0);
        if (
          live
          && Number.isFinite(liveTimestamp)
          && liveTimestamp >= history.from_ms
          && liveTimestamp <= history.to_ms
          && liveTimestamp > lastTimestamp
        ) {
          history.samples.push({
            timestamp_ms: liveTimestamp,
            metrics: { ...(live.metrics ?? {}) },
            virtual: false,
          });
          history.summary = summarizeHistory(history.samples, history.summary?.sourceSampleCount ?? history.samples.length);
        }
      }

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

function summarizeHistory(samples, sourceSampleCount) {
  return {
    sampleCount: samples.length,
    sourceSampleCount,
    downsampled: sourceSampleCount > samples.filter((sample) => !sample.virtual).length,
    firstAt: samples[0]?.timestamp_ms ?? null,
    lastAt: samples.at(-1)?.timestamp_ms ?? null,
    latest: samples.length > 0 ? {
      timestamp_ms: samples.at(-1).timestamp_ms,
      metrics: samples.at(-1).metrics,
    } : null,
  };
}
