// -*- coding: utf-8 -*-

/**
 * EventBus：BZSS Panel JS 后端内部事件总线。
 *
 * 设计目标：
 * 1. 插件不直接监听 UDP Socket
 * 2. 插件只订阅 EventBus
 * 3. 后续即使 UDP 换成 TCP / WebSocket / 文件补读，插件也不用改
 *
 * 当前支持：
 * - eventBus.on("On_PlayerWounded", handler)
 * - eventBus.on("*", handler)
 * - eventBus.emit("On_PlayerWounded", event)
 */

export class EventBus {
  /**
   * @param {object} options
   * @param {object} options.logger 日志器
   */
  constructor({ logger }) {
    this.logger = logger;

    /**
     * Map<string, Set<Function>>
     *
     * key 是事件名，例如：
     * - On_PlayerWounded
     * - On_SquadCreated
     * - *
     */
    this.listeners = new Map();
  }

  /**
   * 订阅事件。
   *
   * @param {string} eventName 事件名
   * @param {(event: object) => void | Promise<void>} handler 事件处理函数
   * @returns {() => void} 返回取消订阅函数
   */
  on(eventName, handler) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }

    const set = this.listeners.get(eventName);
    set.add(handler);

    // 返回取消订阅函数，方便插件卸载时清理。
    return () => {
      set.delete(handler);
    };
  }

  /**
   * 投递事件。
   *
   * 注意：
   * 这里不会因为某个插件报错而中断其他插件。
   *
   * @param {string} eventName 事件名
   * @param {object} event 事件对象
   */
  emit(eventName, event) {
    const handlers = this.listeners.get(eventName);

    if (!handlers || handlers.size === 0) {
      return;
    }

    for (const handler of handlers) {
      try {
        const result = handler(event);

        // 如果插件返回 Promise，则异步捕获错误。
        if (result && typeof result.then === "function") {
          result.catch((error) => {
            this.logger.error(`Event handler async error. Event=${eventName} Error=${error.stack ?? error}`);
          });
        }
      } catch (error) {
        this.logger.error(`Event handler error. Event=${eventName} Error=${error.stack ?? error}`);
      }
    }
  }
}
