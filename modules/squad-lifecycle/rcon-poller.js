// -*- coding: utf-8 -*-

export class SquadRconPoller {
  constructor(config, rconClient, lifecycleService, logger = console) {
    this.config = config;
    this.rconClient = rconClient;
    this.lifecycleService = lifecycleService;
    this.logger = logger;
    this.timer = null;
    this.running = false;
    this.inFlight = false;
  }

  start() {
    if (!this.config.enabled) return;
    if (this.running) return;

    this.running = true;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.rconPollIntervalMs);

    void this.tick();

    this.logger.info?.("[SquadRconPoller] started", {
      intervalMs: this.config.rconPollIntervalMs,
    });
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.logger.info?.("[SquadRconPoller] stopped");
  }

  async tick() {
    if (!this.running) return;
    if (this.inFlight) {
      if (this.config.debug) {
        this.logger.warn?.("[SquadRconPoller] skip tick because previous request is still in flight");
      }
      return;
    }

    this.inFlight = true;
    try {
      const snapshot = await this.withTimeout(
        this.rconClient.getSquadSnapshot(),
        this.config.rconTimeoutMs,
      );

      await this.lifecycleService.handleRconSnapshot(snapshot);
    } catch (error) {
      this.logger.warn?.("[SquadRconPoller] RCON snapshot failed, skip this tick", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.inFlight = false;
    }
  }

  async withTimeout(promise, timeoutMs) {
    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`RCON timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
