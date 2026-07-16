// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_BATCH_BYTES = 128 * 1024;
const DEFAULT_FLUSH_INTERVAL_MS = 50;
const DEFAULT_MAX_QUEUED_BYTES = 32 * 1024 * 1024;
const DEFAULT_STAT_CACHE_MS = 250;
const DEFAULT_READ_CACHE_MAX_BYTES = 32 * 1024 * 1024;

export class FileIOManager {
  constructor({ config = {}, logger = null } = {}) {
    this.config = config ?? {};
    this.logger = logger;
    this.batchBytes = Math.max(4 * 1024, Number(this.config.appendBatchBytes ?? DEFAULT_BATCH_BYTES));
    this.flushIntervalMs = Math.max(10, Number(this.config.appendFlushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS));
    this.maxQueuedBytes = Math.max(1024 * 1024, Number(this.config.maxQueuedBytes ?? DEFAULT_MAX_QUEUED_BYTES));
    this.statCacheMs = Math.max(0, Number(this.config.statCacheMs ?? DEFAULT_STAT_CACHE_MS));
    this.readCacheMaxBytes = Math.max(0, Number(this.config.readCacheMaxBytes ?? DEFAULT_READ_CACHE_MAX_BYTES));

    this.startedAt = 0;
    this.channels = new Map();
    this.statCache = new Map();
    this.statJobs = new Map();
    this.readCache = new Map();
    this.metrics = {
      appendCalls: 0,
      appendBytes: 0,
      flushCount: 0,
      flushBytes: 0,
      activeChannels: 0,
      queuedBytes: 0,
      maxQueuedBytes: 0,
      droppedDebugWrites: 0,
      statCalls: 0,
      readCalls: 0,
      atomicWrites: 0,
      errors: 0,
      lastError: "",
    };
  }

  async start() {
    this.startedAt = Date.now();
  }

  async stop() {
    const pending = [...this.channels.values()].map((channel) => this.flush(channel));
    await Promise.allSettled(pending);
    for (const channel of this.channels.values()) {
      if (channel.timer) clearTimeout(channel.timer);
      channel.timer = null;
      if (!channel.stream) continue;
      await new Promise((resolve) => {
        const stream = channel.stream;
        const done = () => resolve();
        stream.once("finish", done);
        stream.once("error", done);
        stream.end();
      });
    }
    this.channels.clear();
    this.metrics.activeChannels = 0;
    this.metrics.queuedBytes = 0;
  }

  resolve(filePath) {
    const value = String(filePath ?? "").trim();
    if (!value) throw new Error("File path is required.");
    return path.normalize(path.isAbsolute(value) ? value : path.resolve(process.cwd(), value));
  }

  async exists(filePath) {
    try {
      await fs.access(this.resolve(filePath));
      return true;
    } catch {
      return false;
    }
  }

  async stat(filePath) {
    const absolute = this.resolve(filePath);
    this.metrics.statCalls += 1;
    const cached = this.statCache.get(absolute);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const existing = this.statJobs.get(absolute);
    if (existing) return existing;

    const job = fs.stat(absolute)
      .then((value) => {
        this.statCache.set(absolute, { value, expiresAt: Date.now() + this.statCacheMs });
        return value;
      })
      .catch((error) => {
        this.metrics.errors += 1;
        this.rememberError(error);
        throw error;
      })
      .finally(() => this.statJobs.delete(absolute));
    this.statJobs.set(absolute, job);
    return job;
  }

  async readRange(filePath, offset, length) {
    const absolute = this.resolve(filePath);
    const safeOffset = Math.max(0, Number(offset) || 0);
    const safeLength = Math.max(0, Number(length) || 0);
    if (safeLength === 0) return Buffer.alloc(0);

    this.metrics.readCalls += 1;
    const handle = await fs.open(absolute, "r");
    try {
      const buffer = Buffer.allocUnsafe(safeLength);
      const result = await handle.read(buffer, 0, safeLength, safeOffset);
      return buffer.subarray(0, result.bytesRead);
    } finally {
      await handle.close().catch(() => {});
    }
  }

  async readText(filePath, { encoding = "utf8", maxBytes = this.readCacheMaxBytes } = {}) {
    const absolute = this.resolve(filePath);
    const info = await this.stat(absolute);
    if (Number.isFinite(maxBytes) && info.size > maxBytes) {
      throw new Error(`Refusing to read ${info.size} bytes into memory; limit is ${maxBytes}.`);
    }
    this.metrics.readCalls += 1;
    return fs.readFile(absolute, { encoding });
  }

  async readJson(filePath, { cache = true, maxBytes = this.readCacheMaxBytes } = {}) {
    const absolute = this.resolve(filePath);
    const info = await this.stat(absolute);
    const key = `${absolute}\0${info.size}\0${Math.trunc(info.mtimeMs)}`;
    if (cache) {
      const cached = this.readCache.get(key);
      if (cached) return cached;
    }

    const text = await this.readText(absolute, { maxBytes });
    const value = JSON.parse(text);
    if (cache && text.length <= this.readCacheMaxBytes) {
      this.readCache.set(key, value);
      while (this.readCache.size > 128) {
        this.readCache.delete(this.readCache.keys().next().value);
      }
    }
    return value;
  }

  async writeJsonAtomic(filePath, value, { indent = 2 } = {}) {
    const absolute = this.resolve(filePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const temporary = `${absolute}.${process.pid}.${randomUUID()}.tmp`;
    const text = `${JSON.stringify(value, null, indent)}\n`;
    try {
      await fs.writeFile(temporary, text, "utf8");
      await fs.rename(temporary, absolute);
      this.invalidate(absolute);
      this.metrics.atomicWrites += 1;
    } catch (error) {
      this.metrics.errors += 1;
      this.rememberError(error);
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  async append(filePath, text, { channel = "event", priority = "normal" } = {}) {
    const value = String(text ?? "");
    if (!value) return true;

    const entry = await this.getChannel(filePath, channel);
    const bytes = Buffer.byteLength(value);
    this.metrics.appendCalls += 1;
    this.metrics.appendBytes += bytes;

    if (this.metrics.queuedBytes + bytes > this.maxQueuedBytes) {
      if (priority === "debug") {
        this.metrics.droppedDebugWrites += 1;
        return false;
      }
      await this.flush(entry);
    }

    entry.pending.push(value);
    entry.pendingBytes += bytes;
    this.metrics.queuedBytes += bytes;
    this.metrics.maxQueuedBytes = Math.max(this.metrics.maxQueuedBytes, this.metrics.queuedBytes);

    if (entry.pendingBytes >= this.batchBytes) {
      void this.flush(entry);
    } else if (!entry.timer) {
      entry.timer = setTimeout(() => {
        entry.timer = null;
        void this.flush(entry);
      }, this.flushIntervalMs);
      entry.timer.unref?.();
    }
    return true;
  }

  async appendBatch(filePath, values, options = {}) {
    const rows = Array.isArray(values) ? values : [];
    if (rows.length === 0) return true;
    return this.append(filePath, rows.join(""), options);
  }

  async flush(channelOrPath) {
    const entry = typeof channelOrPath === "object"
      ? channelOrPath
      : [...this.channels.values()].find((item) => item.absolute === this.resolve(channelOrPath));
    if (!entry) return;

    if (entry.flushing) return entry.flushing;
    entry.flushing = (async () => {
      try {
        if (entry.timer) {
          clearTimeout(entry.timer);
          entry.timer = null;
        }
        if (!entry.pendingBytes) return;

        const payload = entry.pending.splice(0).join("");
        const bytes = entry.pendingBytes;
        entry.pendingBytes = 0;
        this.metrics.queuedBytes = Math.max(0, this.metrics.queuedBytes - bytes);

        const writable = entry.stream.write(payload);
        if (!writable) await once(entry.stream, "drain");
        this.metrics.flushCount += 1;
        this.metrics.flushBytes += bytes;
      } catch (error) {
        this.metrics.errors += 1;
        this.rememberError(error);
        throw error;
      } finally {
        entry.flushing = null;
        if (entry.pendingBytes > 0) void this.flush(entry);
      }
    })();
    return entry.flushing;
  }

  async getChannel(filePath, channel) {
    const absolute = this.resolve(filePath);
    const key = `${channel}\0${absolute}`;
    let entry = this.channels.get(key);
    if (entry) return entry;

    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const writer = createWriteStream(absolute, {
      flags: "a",
      encoding: "utf8",
      highWaterMark: this.batchBytes,
    });
    writer.on("error", (error) => {
      this.metrics.errors += 1;
      this.rememberError(error);
    });

    entry = {
      key,
      channel,
      absolute,
      stream: writer,
      pending: [],
      pendingBytes: 0,
      timer: null,
      flushing: null,
    };
    this.channels.set(key, entry);
    this.metrics.activeChannels = this.channels.size;
    return entry;
  }

  streamFile(filePath, options = {}) {
    return createReadStream(this.resolve(filePath), options);
  }

  invalidate(filePath) {
    const absolute = this.resolve(filePath);
    for (const key of this.readCache.keys()) {
      if (key.startsWith(`${absolute}\0`)) this.readCache.delete(key);
    }
    this.statCache.delete(absolute);
  }

  getDiagnostics() {
    return {
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : "",
      ...this.metrics,
      channels: [...this.channels.values()].map((entry) => ({
        channel: entry.channel,
        path: entry.absolute,
        pendingBytes: entry.pendingBytes,
        writableLength: entry.stream.writableLength,
      })),
    };
  }

  rememberError(error) {
    this.metrics.lastError = String(error?.message ?? error ?? "");
    this.logger?.warn?.(`FileIO error: ${this.metrics.lastError}`);
  }
}
