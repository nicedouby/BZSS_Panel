// -*- coding: utf-8 -*-

import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_MAX_POINTS = 1500;
const HARD_MAX_POINTS = 5000;
const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;

export class ServerMetricStore {
  constructor({ dataDir, logger }) {
    this.dataDir = path.resolve(process.cwd(), dataDir || "data/server-stats");
    this.logger = logger;
    this.historyInFlight = new Map();
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
    const entry = {
      t: timestampMs,
      m: metrics,
      h: metricsHash.substring(0, 8),
    };

    try {
      await fs.appendFile(filePath, JSON.stringify(entry) + "\n", "utf8");
    } catch (error) {
      this.logger?.warn?.(`[ServerStats] Failed to append sample to ${filePath}: ${error.message}`);
    }
  }

  getHistory({ serverId, fromMs, toMs, maxPoints = DEFAULT_MAX_POINTS, signal } = {}) {
    const normalized = normalizeHistoryQuery({ serverId, fromMs, toMs, maxPoints });
    const key = JSON.stringify(normalized);
    let entry = this.historyInFlight.get(key);

    if (!entry) {
      const controller = new AbortController();
      entry = {
        controller,
        consumers: 0,
        settled: false,
        promise: null,
      };
      entry.promise = this.readHistoryStream({
        ...normalized,
        signal: controller.signal,
      }).finally(() => {
        entry.settled = true;
        if (this.historyInFlight.get(key) === entry) {
          this.historyInFlight.delete(key);
        }
      });
      this.historyInFlight.set(key, entry);
    }

    entry.consumers += 1;
    return waitForSharedHistory(entry.promise, signal).finally(() => {
      entry.consumers = Math.max(0, entry.consumers - 1);
      if (entry.consumers === 0 && !entry.settled) {
        entry.controller.abort();
      }
    });
  }

  async readHistoryStream({ serverId, fromMs: startMs, toMs: endMs, maxPoints, signal }) {
    throwIfAborted(signal);
    const dates = enumerateDates(startMs, endMs);
    const sortedAvailableDates = await this.listAvailableDates({ serverId });
    const olderDate = sortedAvailableDates.find((date) => date < dates[0]) ?? null;
    let previousSample = null;
    let sourceSampleCount = 0;

    if (olderDate) {
      const olderPath = path.join(this.dataDir, `${serverId}-${olderDate}.jsonl`);
      await this.readJsonLines(olderPath, signal, (entry) => {
        if (entry.t < startMs && (!previousSample || entry.t > previousSample.timestamp_ms)) {
          previousSample = toSample(entry, true);
        }
      });
    }

    // Reserve one result slot for the virtual sample immediately before the range.
    const bucketCount = Math.max(1, maxPoints - 1);
    const bucketWidthMs = Math.max(1, Math.ceil((endMs - startMs + 1) / bucketCount));
    const buckets = new Array(bucketCount);

    for (const date of dates) {
      throwIfAborted(signal);
      const filePath = path.join(this.dataDir, `${serverId}-${date}.jsonl`);
      await this.readJsonLines(filePath, signal, (entry) => {
        const timestamp = Number(entry?.t);
        if (!Number.isFinite(timestamp)) return;

        if (timestamp < startMs) {
          if (!previousSample || timestamp > previousSample.timestamp_ms) {
            previousSample = toSample(entry, true);
          }
          return;
        }
        if (timestamp > endMs) return;

        sourceSampleCount += 1;
        const bucketIndex = Math.min(
          bucketCount - 1,
          Math.max(0, Math.floor((timestamp - startMs) / bucketWidthMs)),
        );
        buckets[bucketIndex] = addToBucket(buckets[bucketIndex], entry);
      });
    }

    const samples = [];
    if (previousSample) {
      samples.push({
        timestamp_ms: startMs,
        metrics: previousSample.metrics,
        virtual: true,
      });
    }

    for (const bucket of buckets) {
      if (!bucket) continue;
      samples.push(finalizeBucket(bucket));
    }

    if (samples.length > maxPoints) {
      samples.splice(previousSample ? 1 : 0, samples.length - maxPoints);
    }

    return {
      server_id: serverId,
      from_ms: startMs,
      to_ms: endMs,
      samples,
      summary: buildHistorySummary(samples, sourceSampleCount),
    };
  }

  async readJsonLines(filePath, signal, onEntry) {
    throwIfAborted(signal);
    const input = createReadStream(filePath, { encoding: "utf8" });
    const abort = () => input.destroy(createAbortError());
    signal?.addEventListener("abort", abort, { once: true });

    try {
      const lines = readline.createInterface({
        input,
        crlfDelay: Infinity,
      });
      for await (const line of lines) {
        throwIfAborted(signal);
        if (!line.trim()) continue;
        try {
          onEntry(JSON.parse(line));
        } catch {
          // Ignore a damaged line without retaining the rest of the file.
        }
      }
    } catch (error) {
      if (error?.name === "AbortError" || signal?.aborted) throw createAbortError();
      if (error?.code !== "ENOENT") {
        this.logger?.warn?.(`[ServerStats] Failed to stream ${filePath}: ${error.message}`);
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      input.destroy();
    }
  }

  async listAvailableDates({ serverId }) {
    try {
      const files = await fs.readdir(this.dataDir);
      const prefix = `${serverId}-`;
      const suffix = ".jsonl";
      return files
        .filter((file) => file.startsWith(prefix) && file.endsWith(suffix))
        .map((file) => file.substring(prefix.length, file.length - suffix.length))
        .sort((left, right) => right.localeCompare(left));
    } catch {
      return [];
    }
  }
}

function normalizeHistoryQuery({ serverId, fromMs, toMs, maxPoints }) {
  const endMs = Number.isFinite(Number(toMs)) ? Number(toMs) : Date.now();
  const startMs = Number.isFinite(Number(fromMs)) ? Number(fromMs) : endMs - 24 * 60 * 60 * 1000;
  if (startMs > endMs) {
    throw createQueryError("from_ms must not be greater than to_ms");
  }
  if (endMs - startMs > MAX_RANGE_MS) {
    throw createQueryError("server stats history range cannot exceed 31 days");
  }

  return {
    serverId: String(serverId ?? "BZSS_Main").trim() || "BZSS_Main",
    fromMs: Math.floor(startMs),
    toMs: Math.floor(endMs),
    maxPoints: Math.max(2, Math.min(HARD_MAX_POINTS, Math.floor(Number(maxPoints) || DEFAULT_MAX_POINTS))),
  };
}

function enumerateDates(startMs, endMs) {
  const dates = [];
  const cursor = new Date(startMs);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(endMs);
  end.setUTCHours(0, 0, 0, 0);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function toSample(entry, virtual = false) {
  return {
    timestamp_ms: Number(entry.t),
    metrics: entry.m && typeof entry.m === "object" ? { ...entry.m } : {},
    virtual,
  };
}

function addToBucket(bucket, entry) {
  const timestamp = Number(entry.t);
  const metrics = entry.m && typeof entry.m === "object" ? entry.m : {};
  const next = bucket ?? {
    firstAt: timestamp,
    lastAt: timestamp,
    count: 0,
    sums: {},
    counts: {},
    latest: {},
  };
  next.firstAt = Math.min(next.firstAt, timestamp);
  next.lastAt = Math.max(next.lastAt, timestamp);
  next.count += 1;

  for (const [key, value] of Object.entries(metrics)) {
    const number = Number(value);
    if (value !== null && value !== "" && Number.isFinite(number)) {
      next.sums[key] = (next.sums[key] ?? 0) + number;
      next.counts[key] = (next.counts[key] ?? 0) + 1;
    } else {
      next.latest[key] = value;
    }
  }
  return next;
}

function finalizeBucket(bucket) {
  const metrics = { ...bucket.latest };
  for (const [key, sum] of Object.entries(bucket.sums)) {
    const count = bucket.counts[key] ?? 1;
    metrics[key] = Number((sum / count).toFixed(2));
  }
  return {
    timestamp_ms: bucket.lastAt,
    metrics,
    virtual: false,
    source_count: bucket.count,
  };
}

function buildHistorySummary(samples, sourceSampleCount) {
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

function waitForSharedHistory(promise, signal) {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(createAbortError());
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

function createAbortError() {
  const error = new Error("Server stats history request aborted");
  error.name = "AbortError";
  return error;
}

function createQueryError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

export function hashMetrics(metrics) {
  const text = JSON.stringify(metrics);
  return crypto.createHash("sha1").update(text).digest("hex");
}
