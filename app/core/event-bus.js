// -*- coding: utf-8 -*-

import { performance } from "node:perf_hooks";

const DEFAULT_CORE_EVENT_DEDUPE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_RECENT_CORE_EVENT_IDS = 20_000;

/**
 * Core: EventBus
 *
 * 分层事件总线：
 * - Module 订阅 Core Event
 * - Plugin 订阅 Module Event
 * - Web 可以订阅状态变化，但一般通过 API/SSE 获取
 */
export class EventBus {
  constructor({
    logger,
    performanceMonitor = null,
    coreEventDedupeTtlMs = DEFAULT_CORE_EVENT_DEDUPE_TTL_MS,
    maxRecentCoreEventIds = DEFAULT_MAX_RECENT_CORE_EVENT_IDS,
  }) {
    this.logger = logger;
    this.performanceMonitor = performanceMonitor;
    this.coreListeners = new Map();
    this.moduleListeners = new Map();
    this.coreEventDedupeTtlMs = Math.max(1000, Number(coreEventDedupeTtlMs) || DEFAULT_CORE_EVENT_DEDUPE_TTL_MS);
    this.maxRecentCoreEventIds = Math.max(1000, Number(maxRecentCoreEventIds) || DEFAULT_MAX_RECENT_CORE_EVENT_IDS);
    this.recentCoreEventIds = new Map();
    this.metrics = {
      coreEventsReceived: 0,
      coreEventsEmitted: 0,
      coreEventsDeduplicated: 0,
      recentCoreEventIds: 0,
    };
  }

  setPerformanceMonitor(performanceMonitor) {
    this.performanceMonitor = performanceMonitor ?? null;
  }

  onCoreEvent(eventName, handler) {
    logWithFallback(this.logger, "debug", () => `Registered core listener for ${eventName}`, {
      operation: "subscribe",
      eventName,
      data: {
        listenerCount: getListenerCount(this.coreListeners, eventName) + 1,
      },
    });
    return this.#on(this.coreListeners, eventName, handler);
  }

  emitCoreEvent(eventName, event) {
    this.metrics.coreEventsReceived += 1;
    if (!this.#claimCoreEvent(event)) {
      this.metrics.coreEventsDeduplicated += 1;
      return false;
    }

    this.metrics.coreEventsEmitted += 1;
    logWithFallback(this.logger, "event", () => `Emit core event ${eventName}`, {
      operation: "emitCoreEvent",
      eventName,
      data: summarizeEvent(event),
    });
    this.#emit(this.coreListeners, eventName, event);
    this.#emit(this.coreListeners, "*", event);
    return true;
  }

  hasRecentCoreEventId(eventId) {
    const key = normalizeEventId(eventId);
    if (!key) return false;
    const now = Date.now();
    this.#pruneRecentCoreEventIds(now);
    const seenAt = this.recentCoreEventIds.get(key);
    return Number.isFinite(seenAt) && now - seenAt <= this.coreEventDedupeTtlMs;
  }

  getDiagnostics() {
    return {
      ...this.metrics,
      recentCoreEventIds: this.recentCoreEventIds.size,
      coreEventDedupeTtlMs: this.coreEventDedupeTtlMs,
      maxRecentCoreEventIds: this.maxRecentCoreEventIds,
    };
  }

  onModuleEvent(moduleId, eventName, handler) {
    logWithFallback(this.logger, "debug", () => `Registered module listener for ${moduleId}:${eventName}`, {
      operation: "subscribe",
      eventName,
      moduleId,
      source: moduleId,
      data: {
        listenerCount: getListenerCount(this.moduleListeners, `${moduleId}:${eventName}`) + 1,
      },
    });
    return this.#on(this.moduleListeners, `${moduleId}:${eventName}`, handler);
  }

  emitModuleEvent(moduleId, eventName, event) {
    logWithFallback(this.logger, "event", () => `Emit module event ${moduleId}:${eventName}`, {
      operation: "emitModuleEvent",
      eventName,
      moduleId,
      source: moduleId,
      data: summarizeEvent(event),
    });
    this.#emit(this.moduleListeners, `${moduleId}:${eventName}`, event);
    this.#emit(this.moduleListeners, `${moduleId}:*`, event);
  }

  #claimCoreEvent(event) {
    const eventId = getLogPostEventId(event);
    if (!eventId) return true;

    const now = Date.now();
    this.#pruneRecentCoreEventIds(now);
    const seenAt = this.recentCoreEventIds.get(eventId);
    if (Number.isFinite(seenAt) && now - seenAt <= this.coreEventDedupeTtlMs) {
      return false;
    }

    this.recentCoreEventIds.set(eventId, now);
    while (this.recentCoreEventIds.size > this.maxRecentCoreEventIds) {
      const oldestKey = this.recentCoreEventIds.keys().next().value;
      if (!oldestKey) break;
      this.recentCoreEventIds.delete(oldestKey);
    }
    this.metrics.recentCoreEventIds = this.recentCoreEventIds.size;
    return true;
  }

  #pruneRecentCoreEventIds(now = Date.now()) {
    for (const [eventId, seenAt] of this.recentCoreEventIds) {
      if (now - seenAt <= this.coreEventDedupeTtlMs) break;
      this.recentCoreEventIds.delete(eventId);
    }
    this.metrics.recentCoreEventIds = this.recentCoreEventIds.size;
  }

  #on(map, key, handler) {
    if (!map.has(key)) map.set(key, new Set());
    const set = map.get(key);
    set.add(handler);
    return () => set.delete(handler);
  }

  #emit(map, key, event) {
    const handlers = map.get(key);
    if (!handlers) return;

    for (const handler of handlers) {
      const startedAt = performance.now();
      try {
        const result = handler(event);
        if (result && typeof result.then === "function") {
          result.catch((error) => {
            logWithFallback(this.logger, "error", `Async event handler failed. Key=${key} Error=${error.stack ?? error}`, {
              operation: "emit",
              data: {
                key,
              },
            });
          });
        }
      } catch (error) {
        logWithFallback(this.logger, "error", `Event handler failed. Key=${key} Error=${error.stack ?? error}`, {
          operation: "emit",
          data: {
            key,
          },
        });
      } finally {
        this.performanceMonitor?.recordOperation?.(`eventBus:${key}`, performance.now() - startedAt);
      }
    }
  }
}

function getLogPostEventId(event) {
  if (!event || typeof event !== "object") return "";
  const eventId = normalizeEventId(event.eventId ?? event.rawEvent?.EventId);
  if (!eventId) return "";

  const source = String(event.source ?? "").trim().toLowerCase();
  const hasRawLogPostIdentity = Boolean(event.rawEvent?.EventId);
  if (source !== "python-log-parser" && !hasRawLogPostIdentity) return "";
  return eventId;
}

function normalizeEventId(value) {
  return String(value ?? "").trim();
}

function getListenerCount(map, key) {
  return map.get(key)?.size ?? 0;
}

function summarizeEvent(event) {
  if (!event || typeof event !== "object") {
    return null;
  }

  return {
    source: event.source ?? "",
    serverId: event.serverId ?? "",
    hasPayload: Boolean(event.payload),
    players: Array.isArray(event.players) ? event.players.length : undefined,
    squads: Array.isArray(event.squads) ? event.squads.length : undefined,
  };
}

function logWithFallback(logger, method, message, context) {
  const fn = logger?.[method];
  if (typeof fn === "function") {
    fn.call(logger, message, context);
    return;
  }

  if (method === "debug" || method === "event") {
    logger?.info?.(typeof message === "function" ? message() : message);
    return;
  }

  logger?.error?.(typeof message === "function" ? message() : message);
}
