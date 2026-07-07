// -*- coding: utf-8 -*-

import {
  buildCoreControlBaseUrl,
  buildCoreControlHeaders,
  formatRevisionQuery,
  normalizeCoreControlConfig,
} from "./core-control-protocol.js";

export class CoreControlClient {
  constructor({ config, logger, fetchImpl = globalThis.fetch }) {
    this.config = normalizeCoreControlConfig(config, process.env);
    this.logger = logger;
    this.fetchImpl = fetchImpl;
    this.baseUrl = buildCoreControlBaseUrl(this.config);
    this.headers = buildCoreControlHeaders(this.config);
    this.cache = new Map();
    this.inFlight = new Map();
    this.lastCoreLatencyMs = null;
    this.lastSnapshotFetchedAt = 0;
    this.lastSnapshotRevisions = {};
  }

  getHealth() {
    return this.requestJson("/internal/health", { cacheTtlMs: 0 });
  }

  async getSnapshotAll({ since = null, cacheTtlMs = this.config.snapshotCacheTtlMs } = {}) {
    const query = since ? `?since=${encodeURIComponent(formatRevisionQuery(since))}` : "";
    const startedAt = Date.now();
    const response = await this.request(`/internal/snapshot/all${query}`, { cacheTtlMs });
    this.lastCoreLatencyMs = Date.now() - startedAt;
    if (response.status === 204) {
      return { ok: true, notModified: true, revisions: since ?? this.lastSnapshotRevisions, patch: {} };
    }
    const data = await response.json();
    this.lastSnapshotFetchedAt = Date.now();
    this.lastSnapshotRevisions = data?.revisions ?? this.lastSnapshotRevisions;
    return data;
  }

  getSnapshotServer() {
    return this.requestJson("/internal/snapshot/server", { cacheTtlMs: this.config.snapshotCacheTtlMs });
  }

  getSnapshotPlayers() {
    return this.requestJson("/internal/snapshot/players", { cacheTtlMs: this.config.snapshotCacheTtlMs });
  }

  getSnapshotSquads() {
    return this.requestJson("/internal/snapshot/squads", { cacheTtlMs: this.config.snapshotCacheTtlMs });
  }

  getTacticalStateV2Snapshot() {
    return this.requestJson("/internal/tactical-state-v2/snapshot", { cacheTtlMs: this.config.tacticalSnapshotCacheTtlMs });
  }

  getConsoleRecent(query = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === "") continue;
      params.set(key, String(value));
    }
    const suffix = params.size ? `?${params}` : "";
    return this.requestJson(`/internal/console/recent${suffix}`, { cacheTtlMs: this.config.consoleRecentCacheTtlMs });
  }

  getRconStatus() {
    return this.requestJson("/internal/rcon/status", { cacheTtlMs: 0 });
  }

  dispatchRconCommand(command, actor = null) {
    return this.requestJson("/internal/rcon/dispatch", {
      method: "POST",
      body: { command, actor },
      cacheTtlMs: 0,
    });
  }

  getWarmupState() {
    return this.requestJson("/internal/server/warmup", { cacheTtlMs: 0 });
  }

  setWarmupState(isWarmup, actor = null) {
    return this.requestJson("/internal/server/warmup", {
      method: "POST",
      body: { isWarmup, actor },
      cacheTtlMs: 0,
    });
  }

  getSnapshotCacheAgeMs() {
    return this.lastSnapshotFetchedAt > 0 ? Math.max(0, Date.now() - this.lastSnapshotFetchedAt) : null;
  }

  async requestJson(path, options = {}) {
    const response = await this.request(path, options);
    return response.json();
  }

  async request(path, options = {}) {
    const method = String(options.method ?? "GET").toUpperCase();
    const cacheTtlMs = Number(options.cacheTtlMs ?? 0);
    const cacheKey = `${method} ${path}`;
    const now = Date.now();
    if (cacheTtlMs > 0 && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (cached.expiresAt > now) return cached.response.clone();
    }
    if (this.inFlight.has(cacheKey)) {
      const shared = await this.inFlight.get(cacheKey);
      return shared.clone();
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    const task = this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...this.headers,
        ...(options.body ? { "Content-Type": "application/json; charset=utf-8" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    }).then((response) => {
      if (!response.ok && response.status !== 204) {
        return response.text().then((text) => {
          const error = new Error(`Core control request failed: ${response.status}`);
          error.statusCode = response.status;
          error.responseText = text;
          throw error;
        });
      }
      if (cacheTtlMs > 0) {
        this.cache.set(cacheKey, {
          expiresAt: Date.now() + cacheTtlMs,
          response: response.clone(),
        });
      }
      return response;
    }).finally(() => {
      clearTimeout(timeout);
      this.inFlight.delete(cacheKey);
    });
    this.inFlight.set(cacheKey, task);
    return (await task).clone();
  }
}

