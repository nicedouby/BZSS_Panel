// -*- coding: utf-8 -*-

import { hashMetrics } from "./store.js";

const SAMPLE_INTERVAL_MS = 1000;
const INITIAL_SAMPLE_DELAY_MS = 5000;

export class ServerInfoSampler {
  constructor({ serverId, store, getSnapshot, logger }) {
    this.serverId = serverId;
    this.store = store;
    this.getSnapshot = getSnapshot;
    this.logger = logger;
    this.lastSavedHash = null;
    this.timer = null;
    this.running = false;
    this.tickInFlight = null;
    this.currentSample = null;
  }

  normalizeMetrics(raw) {
    const tps = raw.metrics?.tps;
    return {
      players: Math.max(0, Math.floor(Number(raw.metrics?.players ?? 0))),
      queue: Math.max(0, Math.floor(Number(raw.metrics?.queue ?? 0))),
      tps: (tps === null || tps === undefined) ? null : Number(Number(tps).toFixed(2)),
    };
  }

  async tick() {
    if (this.tickInFlight) return this.tickInFlight;
    this.tickInFlight = (async () => {
      try {
        const raw = await this.getSnapshot();
        const metrics = this.normalizeMetrics(raw);
        const metricsHash = hashMetrics(metrics);
        this.currentSample = {
          server_id: this.serverId,
          timestamp_ms: Date.now(),
          metrics,
        };

        if (metricsHash === this.lastSavedHash) return;
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
    })().finally(() => {
      this.tickInFlight = null;
    });
    return this.tickInFlight;
  }

  schedule(delayMs) {
    if (!this.running || this.timer) return;
    this.timer = setTimeout(async () => {
      this.timer = null;
      await this.tick();
      this.schedule(SAMPLE_INTERVAL_MS);
    }, delayMs);
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.schedule(INITIAL_SAMPLE_DELAY_MS);
  }

  async stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.tickInFlight;
  }

  getCurrentSample() {
    return this.currentSample;
  }
}
