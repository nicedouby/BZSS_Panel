// -*- coding: utf-8 -*-

import { monitorEventLoopDelay } from "node:perf_hooks";

/**
 * Core: PerformanceMonitor
 * 
 * Periodically collects process memory and event loop delay statistics,
 * logs metrics summaries, and maintains history snapshots.
 */
export class PerformanceMonitor {
  constructor({ config, logger } = {}) {
    this.config = config;
    this.logger = logger;
    
    this.enabled = this.config?.get?.("performance.enabled", true) ?? true;
    this.sampleIntervalMs = Number(this.config?.get?.("performance.sampleIntervalMs", 10000) ?? 10000);
    this.logIntervalMs = Number(this.config?.get?.("performance.logIntervalMs", 60000) ?? 60000);
    this.maxHistoryPoints = Number(this.config?.get?.("performance.maxHistoryPoints", 120) ?? 120);

    this.history = [];
    this.sampleTimer = null;
    this.logTimer = null;
    this.histogram = null;

    if (this.enabled) {
      try {
        this.histogram = monitorEventLoopDelay({ resolution: 10 });
      } catch (err) {
        this.logger?.warn(`Could not initialize monitorEventLoopDelay: ${err.message}. Event loop delay stats will not be collected.`);
      }
    }
  }

  start() {
    if (!this.enabled) {
      this.logger?.info("PerformanceMonitor is disabled.");
      return;
    }

    if (this.histogram) {
      try {
        this.histogram.enable();
      } catch (err) {
        this.logger?.error(`Failed to enable monitorEventLoopDelay histogram: ${err.message}`);
      }
    }

    this.logger?.info("PerformanceMonitor started.");

    // Sample metrics periodically
    this.sampleTimer = setInterval(() => this.sample(), this.sampleIntervalMs);

    // Log metrics periodically
    this.logTimer = setInterval(() => this.logReport(), this.logIntervalMs);

    // Sample immediately on start
    this.sample();
  }

  stop() {
    if (this.sampleTimer) {
      clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }
    if (this.logTimer) {
      clearInterval(this.logTimer);
      this.logTimer = null;
    }
    if (this.histogram) {
      try {
        this.histogram.disable();
        this.histogram.reset();
      } catch {}
    }
    this.logger?.info("PerformanceMonitor stopped.");
  }

  sample() {
    try {
      const memory = process.memoryUsage();
      const eventLoopDelayMs = this.histogram
        ? {
            mean: this.histogram.mean / 1e6,
            p95: this.histogram.percentile(95) / 1e6,
            p99: this.histogram.percentile(99) / 1e6,
            max: this.histogram.max / 1e6,
          }
        : { mean: 0, p95: 0, p99: 0, max: 0 };

      // Reset histogram for the next interval
      if (this.histogram) {
        this.histogram.reset();
      }

      this.history.push({
        timestamp: Date.now(),
        memory: {
          rss: memory.rss,
          heapUsed: memory.heapUsed,
          heapTotal: memory.heapTotal,
          external: memory.external,
          arrayBuffers: memory.arrayBuffers || 0,
        },
        eventLoop: eventLoopDelayMs,
      });

      if (this.history.length > this.maxHistoryPoints) {
        this.history.splice(0, this.history.length - this.maxHistoryPoints);
      }
    } catch (error) {
      this.logger?.error(`Error during performance sampling: ${error.message}`);
    }
  }

  logReport() {
    if (this.history.length === 0) return;
    const latest = this.history[this.history.length - 1];
    
    this.logger?.info(
      `[perf-metrics] RSS=${(latest.memory.rss / 1024 / 1024).toFixed(2)}MB ` +
      `HeapUsed=${(latest.memory.heapUsed / 1024 / 1024).toFixed(2)}MB ` +
      `External=${(latest.memory.external / 1024 / 1024).toFixed(2)}MB ` +
      `ArrayBuffers=${(latest.memory.arrayBuffers / 1024 / 1024).toFixed(2)}MB ` +
      `EventLoopMean=${latest.eventLoop.mean.toFixed(2)}ms ` +
      `EventLoopP95=${latest.eventLoop.p95.toFixed(2)}ms ` +
      `EventLoopP99=${latest.eventLoop.p99.toFixed(2)}ms ` +
      `EventLoopMax=${latest.eventLoop.max.toFixed(2)}ms`
    );
  }

  getSnapshot() {
    return {
      history: this.history,
      latest: this.history[this.history.length - 1] ?? null,
    };
  }
}
