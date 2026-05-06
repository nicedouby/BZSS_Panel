// -*- coding: utf-8 -*-

/**
 * Core: RconManager
 *
 * 唯一 RCON 出口。
 * 当前是 stub，后续替换为真实 RCON 实现。
 */
export class RconManager {
  constructor({ config, logger, eventBus, webStatus }) {
    this.config = config ?? {};
    this.logger = logger;
    this.eventBus = eventBus;
    this.webStatus = webStatus;

    this.enabled = this.config.enabled ?? false;
    this.minIntervalMs = this.config.rateLimit?.minIntervalMs ?? 500;
    this.lastCommandTime = 0;
  }

  async start() {
    if (!this.enabled) {
      this.webStatus.set("rcon", "disabled");
      this.logger.info("RconManager disabled.");
      return;
    }

    this.webStatus.set("rcon", "connected");
    this.logger.info("RconManager started.");
  }

  async stop() {
    this.webStatus.set("rcon", "stopped");
    this.logger.info("RconManager stopped.");
  }

  async dispatchCommand(request) {
    const now = Date.now();
    const diff = now - this.lastCommandTime;

    if (diff < this.minIntervalMs) {
      await sleep(this.minIntervalMs - diff);
    }

    this.lastCommandTime = Date.now();

    this.logger.warn(`[RCON-STUB] ${request.command}`);

    return {
      success: true,
      message: "RCON stub executed. Real RCON is not implemented yet.",
      rconExecuted: false,
      rconResponse: "",
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
