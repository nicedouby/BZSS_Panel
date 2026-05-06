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
    return this.#on(this.coreListeners, eventName, handler);
  }

  emitCoreEvent(eventName, event) {
    this.#emit(this.coreListeners, eventName, event);
    this.#emit(this.coreListeners, "*", event);
  }

  onModuleEvent(moduleId, eventName, handler) {
    return this.#on(this.moduleListeners, `${moduleId}:${eventName}`, handler);
  }

  emitModuleEvent(moduleId, eventName, event) {
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
            this.logger.error(`Async event handler failed. Key=${key} Error=${error.stack ?? error}`);
          });
        }
      } catch (error) {
        this.logger.error(`Event handler failed. Key=${key} Error=${error.stack ?? error}`);
      }
    }
  }
}
