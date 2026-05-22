// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export class ServerMetricStore {
  constructor({ dataDir, logger }) {
    this.dataDir = path.resolve(process.cwd(), dataDir || "data/server-stats");
    this.logger = logger;
  }

  async init() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
    } catch (error) {
      this.logger?.error?.(`[ServerStats] Failed to create data directory: ${error.message}`);
    }
  }

  async insertSample({ serverId, timestampMs, metrics, metricsHash }) {
    const date = new Date(timestampMs).toISOString().split("T")[0];
    const filePath = path.join(this.dataDir, `${serverId}-${date}.jsonl`);
    
    // Minimal data for file storage to save space
    const entry = {
      t: timestampMs,
      m: metrics,
      h: metricsHash.substring(0, 8), // Short hash for deduplication check if needed
    };

    try {
      await fs.appendFile(filePath, JSON.stringify(entry) + "\n", "utf8");
    } catch (error) {
      this.logger?.warn?.(`[ServerStats] Failed to append sample to ${filePath}: ${error.message}`);
    }
  }

  async getHistory({ serverId, fromMs, toMs }) {
    const startMs = Number(fromMs);
    const endMs = Number(toMs);
    
    // Get all relevant dates in the range
    const dates = [];
    let current = new Date(startMs);
    const end = new Date(endMs);
    
    // Ensure we include the start date and end date
    while (current <= end) {
      dates.push(current.toISOString().split("T")[0]);
      current.setDate(current.getDate() + 1);
    }
    // Add one more day to be safe if it spans midnight exactly
    const lastDate = end.toISOString().split("T")[0];
    if (!dates.includes(lastDate)) dates.push(lastDate);

    let allSamples = [];

    // Read previous sample for virtual point if needed
    // (Search in current and previous files)
    let previousSample = null;
    const sortedAvailableDates = await this.listAvailableDates({ serverId });
    const firstDateInRange = dates[0];
    const olderDates = sortedAvailableDates.filter(d => d < firstDateInRange);
    
    if (olderDates.length > 0) {
      const latestOlderFile = path.join(this.dataDir, `${serverId}-${olderDates[0]}.jsonl`);
      previousSample = await this.readLastSampleBefore(latestOlderFile, startMs);
    }

    for (const date of dates) {
      const filePath = path.join(this.dataDir, `${serverId}-${date}.jsonl`);
      try {
        const content = await fs.readFile(filePath, "utf8");
        const lines = content.split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          const entry = JSON.parse(line);
          if (entry.t >= startMs && entry.t <= endMs) {
            allSamples.push({
              timestamp_ms: entry.t,
              metrics: entry.m,
              virtual: false,
            });
          } else if (entry.t < startMs) {
            // Keep track of the latest sample before our range within the same day
            if (!previousSample || entry.t > previousSample.timestamp_ms) {
              previousSample = {
                timestamp_ms: entry.t,
                metrics: entry.m,
                virtual: true,
              };
            }
          }
        }
      } catch (err) {
        // File might not exist for some days, skip
      }
    }

    const result = [];
    if (previousSample) {
      result.push({
        timestamp_ms: startMs,
        metrics: previousSample.metrics,
        virtual: true,
      });
    }

    // Sort by time just in case
    allSamples.sort((a, b) => a.timestamp_ms - b.timestamp_ms);
    result.push(...allSamples);

    return {
      server_id: serverId,
      from_ms: startMs,
      to_ms: endMs,
      samples: result,
      summary: {
        sampleCount: result.length,
        firstAt: result[0]?.timestamp_ms ?? null,
        lastAt: result.at(-1)?.timestamp_ms ?? null,
        latest: result.length > 0 ? {
          timestamp_ms: result.at(-1).timestamp_ms,
          metrics: result.at(-1).metrics,
        } : null,
      },
    };
  }

  async readLastSampleBefore(filePath, beforeMs) {
    try {
      const content = await fs.readFile(filePath, "utf8");
      const lines = content.split("\n");
      let last = null;
      for (const line of lines) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line);
        if (entry.t < beforeMs) {
          if (!last || entry.t > last.timestamp_ms) {
            last = {
              timestamp_ms: entry.t,
              metrics: entry.m,
            };
          }
        }
      }
      return last;
    } catch {
      return null;
    }
  }

  async listAvailableDates({ serverId }) {
    try {
      const files = await fs.readdir(this.dataDir);
      const prefix = `${serverId}-`;
      const suffix = ".jsonl";
      
      const dates = files
        .filter(f => f.startsWith(prefix) && f.endsWith(suffix))
        .map(f => f.substring(prefix.length, f.length - suffix.length))
        .sort((a, b) => b.localeCompare(a)); // Newest first
        
      return dates;
    } catch (error) {
      return [];
    }
  }
}

export function hashMetrics(metrics) {
  const text = JSON.stringify(metrics);
  return crypto.createHash("sha1").update(text).digest("hex");
}
