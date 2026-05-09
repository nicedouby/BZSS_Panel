// -*- coding: utf-8 -*-

/**
 * Core: EventBus
 *
 * 分层事件总线：
 * - Module 订阅 Core Event
 * - Plugin 订阅 Module Event
 * - Web 可以订阅状态变化，但一般通过 API/SSE 获取
 */
export class EventBus {
  constructor({ logger }) {
    this.logger = logger;
    this.coreListeners = new Map();
    this.moduleListeners = new Map();
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
    logWithFallback(this.logger, "event", () => `Emit core event ${eventName}`, {
      operation: "emitCoreEvent",
      eventName,
      data: summarizeEvent(event),
    });
    this.#emit(this.coreListeners, eventName, event);
    this.#emit(this.coreListeners, "*", event);
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
      }
    }
  }
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
