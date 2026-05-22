// -*- coding: utf-8 -*-

import { hashMetrics } from "./store.js";

export class ServerInfoSampler {
  constructor({ serverId, store, getSnapshot, logger }) {
    this.serverId = serverId;
    this.store = store;
    this.getSnapshot = getSnapshot;
    this.logger = logger;
    this.lastSavedHash = null;
    this.interval = null;
    this.currentSample = null;
  }

  normalizeMetrics(raw) {
    return {
      players: Math.max(0, Math.floor(Number(raw.metrics?.players ?? 0))),
      queue: Math.max(0, Math.floor(Number(raw.metrics?.queue ?? 0))),
      tps: Number(Number(raw.metrics?.tps ?? 0).toFixed(2)),
    };
  }

  async tick() {
    try {
      const raw = await this.getSnapshot();
      const metrics = this.normalizeMetrics(raw);
      const metricsHash = hashMetrics(metrics);

      this.currentSample = {
        server_id: this.serverId,
        timestamp_ms: Date.now(),
        metrics,
      };

      if (metricsHash === this.lastSavedHash) {
        return;
      }

      await this.store.insertSample({
        serverId: this.serverId,
        timestampMs: this.currentSample.timestamp_ms,
        metrics,
        metricsHash,
      });

      this.lastSavedHash = metricsHash;
    } catch (error) {
      this.logger?.warn?.(`[ServerStats] scheduled tick failed: ${error.message}`);
    }
  }

  async start() {
    if (this.interval) return;
    this.interval = setInterval(() => this.tick(), 1000);
    await this.tick(); // Initial tick
  }

  async stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  getCurrentSample() {
    return this.currentSample;
  }
}
