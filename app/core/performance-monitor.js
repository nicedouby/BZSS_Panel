// -*- coding: utf-8 -*-

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { monitorEventLoopDelay } from "node:perf_hooks";

const execFileAsync = promisify(execFile);

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
    this.networkEnabled = this.config?.get?.("performance.network.enabled", false) ?? false;
    this.networkSampleIntervalMs = Number(this.config?.get?.("performance.network.sampleIntervalMs", 60000) ?? 60000);
    this.networkCommandTimeoutMs = Number(this.config?.get?.("performance.network.commandTimeoutMs", 5000) ?? 5000);
    this.sampleIntervalMs = Number(this.config?.get?.("performance.sampleIntervalMs", 10000) ?? 10000);
    this.logIntervalMs = Number(this.config?.get?.("performance.logIntervalMs", 60000) ?? 60000);
    this.maxHistoryPoints = Number(this.config?.get?.("performance.maxHistoryPoints", 120) ?? 120);

    this.history = [];
    this.sampleTimer = null;
    this.logTimer = null;
    this.histogram = null;
    this.lastNetworkTotals = null;
    this.lastNetworkSampleAt = null;
    this.lastNetworkMetrics = null;
    this.isNetworkSampling = false;
    this.networkErrorLogged = false;

    if (this.enabled) {
      try {
        this.histogram = monitorEventLoopDelay({ resolution: 10 });
      } catch (err) {
        this.logger?.warn(`Could not initialize monitorEventLoopDelay: ${err.message}. Event loop delay stats will not be collected.`);
      }
    }
  }

  start() {
    if (this.sampleTimer || this.logTimer) {
      this.logger?.warn("PerformanceMonitor is already running.");
      return;
    }
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
      if (this.networkEnabled && (!this.lastNetworkSampleAt || Date.now() - this.lastNetworkSampleAt >= this.networkSampleIntervalMs)) {
        this.#triggerNetworkSampling();
      }

      const memory = process.memoryUsage();
      const network = this.lastNetworkMetrics || null;
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
        network,
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
      (latest.network
        ? `NetIn=${this.#formatBytesPerSecond(latest.network.bytesInPerSec)} `
          + `NetOut=${this.#formatBytesPerSecond(latest.network.bytesOutPerSec)} `
          + `NetTotal=${this.#formatBytesPerSecond(latest.network.bytesTotalPerSec)} `
        : "") +
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

  #triggerNetworkSampling() {
    if (this.isNetworkSampling) return;
    this.isNetworkSampling = true;
    this.#readNetworkCounters()
      .then((current) => {
        if (!current) return;
        const now = Date.now();
        const previous = this.lastNetworkTotals;
        this.lastNetworkTotals = current;
        this.lastNetworkSampleAt = now;

        if (!previous || !Number.isFinite(this.lastNetworkSampleAt) || !current.timestamp) {
          this.lastNetworkMetrics = {
            bytesInTotal: current.bytesInTotal,
            bytesOutTotal: current.bytesOutTotal,
            bytesInPerSec: null,
            bytesOutPerSec: null,
            bytesTotalPerSec: null,
            sampleIntervalMs: null,
            source: current.source,
          };
          return;
        }

        const elapsedMs = Math.max(now - previous.timestamp, 1);
        const inDelta = Math.max(0, current.bytesInTotal - previous.bytesInTotal);
        const outDelta = Math.max(0, current.bytesOutTotal - previous.bytesOutTotal);
        this.lastNetworkMetrics = {
          bytesInTotal: current.bytesInTotal,
          bytesOutTotal: current.bytesOutTotal,
          bytesInPerSec: (inDelta * 1000) / elapsedMs,
          bytesOutPerSec: (outDelta * 1000) / elapsedMs,
          bytesTotalPerSec: ((inDelta + outDelta) * 1000) / elapsedMs,
          sampleIntervalMs: elapsedMs,
          source: current.source,
        };
      })
      .catch((error) => {
        if (!this.networkErrorLogged) {
          this.logger?.warn(`Failed to sample network traffic: ${error.message}. This warning will only be logged once.`);
          this.networkErrorLogged = true;
        }
      })
      .finally(() => {
        this.isNetworkSampling = false;
      });
  }

  async #readNetworkCounters() {
    if (process.platform !== "win32") {
      return null;
    }

    try {
      const script = [
        "$items = Get-NetAdapterStatistics | Select-Object ReceivedBytes,SentBytes;",
        "if ($items -is [array]) { $items | ConvertTo-Json -Compress } else { @($items) | ConvertTo-Json -Compress }",
      ].join(" ");
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        script,
      ], {
        encoding: "utf8",
        timeout: this.networkCommandTimeoutMs,
        maxBuffer: 1024 * 1024,
      });

      const output = stdout.trim();
      if (!output) return null;
      const parsed = JSON.parse(output);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      let bytesInTotal = 0;
      let bytesOutTotal = 0;

      for (const item of items) {
        const received = Number(item?.ReceivedBytes ?? 0);
        const sent = Number(item?.SentBytes ?? 0);
        if (Number.isFinite(received)) bytesInTotal += Math.max(0, received);
        if (Number.isFinite(sent)) bytesOutTotal += Math.max(0, sent);
      }

      return {
        bytesInTotal,
        bytesOutTotal,
        timestamp: Date.now(),
        source: "Get-NetAdapterStatistics",
      };
    } catch (err) {
      throw err;
    }
  }

  #formatBytesPerSecond(bytesPerSec) {
    if (!Number.isFinite(Number(bytesPerSec))) return "--";
    return `${this.#formatBytes(bytesPerSec)}/s`;
  }

  #formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }
}