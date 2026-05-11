// -*- coding: utf-8 -*-

import SquadRcon from "./squad-rcon.js";

/**
 * Core: RconManager
 *
 * BZSS 的唯一 RCON 出口。
 *
 * 这版按 MicePanel_better 的 RCON 结构迁移：
 * - core/rcon.js：低层 RCON TCP 协议
 * - core/squad-rcon.js：Squad 专用命令和事件解析
 * - core/rcon-manager.js：连接生命周期、队列、限流、轮询、Core Event 转发
 *
 * 规则：
 * - 插件不能直接调用 RCON。
 * - Web 控制台可以通过 ConsoleModule 间接执行手动 RCON。
 * - 业务动作仍应走 warning/team-balance 等模块。
 */
export class RconManager {
  constructor({ config, logger, eventBus, webStatus }) {
    this.config = config ?? {};
    this.logger = logger;
    this.eventBus = eventBus;
    this.webStatus = webStatus;

    this.enabled = Boolean(this.config.enabled);
    this.minIntervalMs = Number(this.config.rateLimit?.minIntervalMs ?? 500);
    this.maxQueueSize = Number(this.config.rateLimit?.maxQueueSize ?? 100);

    this.squadRcon = null;
    this.queue = [];
    this.processing = false;
    this.lastCommandTime = 0;

    this.polling = {
      enabled: Boolean(this.config.polling?.enabled ?? false),
      playersIntervalMs: Number(this.config.polling?.playersIntervalMs ?? 5000),
      squadsIntervalMs: Number(this.config.polling?.squadsIntervalMs ?? 10000),
    };

    this.timers = [];
    this.rconEventTeardown = [];
    this.nativeLogListeners = new Set();

    this.status = {
      enabled: this.enabled,
      connected: false,
      authenticated: false,
      queueSize: 0,
      lastError: "",
      lastPlayersRefresh: "",
      lastSquadsRefresh: "",
    };

    this.refreshInFlight = {
      players: false,
      squads: false,
    };
  }

  async start() {
    if (!this.enabled) {
      this.webStatus.set("rcon", "disabled");
      this.logger.info("RconManager disabled.", {
        operation: "start",
      });
      return;
    }

    this.squadRcon = new SquadRcon({
      host: this.config.host,
      port: this.config.port,
      password: this.config.password,
      autoReconnectDelay: this.config.autoReconnectDelay ?? 5000,
      commandTimeoutMs: this.config.commandTimeoutMs ?? 15000,
      logger: this.logger,
    });

    this.attachSquadRconEvents();

    try {
      this.logger.info(`Connecting to RCON ${this.config.host}:${this.config.port}`, {
        operation: "start",
      });
      await this.squadRcon.connect();
      this.setConnected(true);
      this.startPolling();
    } catch (error) {
      this.status.lastError = error.message;
      this.webStatus.set("rcon", "error");
      this.logger.error(`Initial RCON connection failed: ${error.message}`, {
        operation: "start",
      });
      this.logger.info("RCON will retry automatically if autoReconnect is enabled after a successful connection.", {
        operation: "start",
      });
    }
  }

  async stop() {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];

    for (const dispose of this.rconEventTeardown.splice(0)) {
      try {
        dispose();
      } catch {}
    }

    if (this.squadRcon) {
      await this.squadRcon.disconnect().catch(() => {});
    }

    this.setConnected(false);
    this.webStatus.set("rcon", "stopped");
    this.emitNativeLog({
      level: "status",
      message: "RCON stopped.",
      source: "core.rconManager",
    });
    this.logger.info("RconManager stopped.", {
      operation: "stop",
    });
  }

  attachSquadRconEvents() {
    const forwarded = [
      "RCON_CONNECTED",
      "RCON_DISCONNECTED",
      "RCON_ERROR",
      "CHAT_MESSAGE",
      "SQUAD_CREATED",
      "POSSESSED_ADMIN_CAM",
      "UNPOSSESSED_ADMIN_CAM",
      "TEAM_KILL",
      "GAME_START",
      "MATCH_START",
      "ROUND_START",
      "NEW_GAME",
      "GAME_END",
      "MATCH_END",
      "ROUND_END",
      "ROUND_ENDED",
    ];

    for (const eventName of forwarded) {
      const handler = (payload = {}) => {
        if (eventName === "RCON_CONNECTED") {
          this.setConnected(true);
          this.startPolling();
          this.emitNativeLog({
            level: "status",
            message: `Connected to ${payload.host}:${payload.port}`,
            host: payload.host,
            port: payload.port,
          });
        }

        if (eventName === "RCON_DISCONNECTED") {
          this.setConnected(false);
          this.emitNativeLog({
            level: "status",
            message: `Disconnected: ${String(payload?.reason ?? "unknown reason")}`,
            reason: String(payload?.reason ?? "unknown reason"),
          });
        }

        if (eventName === "RCON_ERROR") {
          const message = payload instanceof Error ? payload.message : String(payload?.message ?? payload ?? "RCON error");
          this.status.lastError = message;
          this.webStatus.set("rcon", "error");
          this.emitNativeLog({
            level: "error",
            message: `RCON error: ${message}`,
            errorName: payload?.name || (payload instanceof Error ? payload.name : "Error"),
          });
        }

        const normalizedPayload = normalizeRconPayload(eventName, payload);
        this.logger.debug(() => `Forwarding ${eventName}`, {
          operation: "forwardEvent",
          eventName,
          data: summarizePayload(normalizedPayload),
        });
        this.eventBus.emitCoreEvent(eventName, {
          eventId: `rcon:${eventName}:${Date.now()}`,
          eventName,
          layer: "core",
          source: "core.rconManager",
          serverId: this.webStatus.serverId,
          time: new Date().toISOString(),
          params: [],
          payload: normalizedPayload,
        });
      };

      this.squadRcon.on(eventName, handler);
      this.rconEventTeardown.push(() => this.squadRcon.off(eventName, handler));
    }

    const nativeEvents = [
      "RCON_NATIVE_WRITE",
      "RCON_NATIVE_RESPONSE",
      "RCON_NATIVE_ERROR",
      "RCON_NATIVE_PUSH",
    ];

    for (const eventName of nativeEvents) {
      const handler = (payload = {}) => {
        const entry = mapNativeRconEventToConsoleEntry(eventName, payload);
        if (!entry) return;
        this.emitNativeLog(entry);
      };

      this.squadRcon.on(eventName, handler);
      this.rconEventTeardown.push(() => this.squadRcon.off(eventName, handler));
    }
  }

  setConnected(value) {
    this.status.connected = Boolean(value);
    this.status.authenticated = Boolean(value && this.squadRcon?.loggedIn);
    this.webStatus.set("rcon", value ? "connected" : "disconnected");
  }

  startPolling() {
    if (!this.polling.enabled) return;
    if (this.timers.length > 0) return;

    this.logger.info(`RCON polling started. players=${this.polling.playersIntervalMs}ms squads=${this.polling.squadsIntervalMs}ms`);

    this.refreshPlayers().catch((err) => this.logger.warn(`Initial ListPlayers failed: ${err.message}`));
    this.refreshSquads().catch((err) => this.logger.warn(`Initial ListSquads failed: ${err.message}`));

    this.timers.push(setInterval(() => {
      this.refreshPlayers().catch((err) => this.logger.warn(`ListPlayers failed: ${err.message}`));
    }, this.polling.playersIntervalMs));

    this.timers.push(setInterval(() => {
      this.refreshSquads().catch((err) => this.logger.warn(`ListSquads failed: ${err.message}`));
    }, this.polling.squadsIntervalMs));
  }

  /**
   * 受控 RCON 命令入口。
   *
   * @param {{command: string, requestedBy?: string, reason?: string, sourceEventId?: string}} request
   */
  async dispatchCommand(request) {
    if (!this.enabled) {
      return {
        success: false,
        message: "RCON is disabled.",
        rconExecuted: false,
        rconResponse: "",
      };
    }

    const command = String(request?.command ?? "").trim();
    if (!command) {
      return {
        success: false,
        message: "RCON command is empty.",
        rconExecuted: false,
        rconResponse: "",
      };
    }

    if (this.queue.length >= this.maxQueueSize) {
      return {
        success: false,
        message: "RCON queue is full.",
        rconExecuted: false,
        rconResponse: "",
      };
    }

    return await new Promise((resolve) => {
      this.queue.push({
        request: { ...request, command },
        resolve,
      });

      this.status.queueSize = this.queue.length;
      this.webStatus.set("rconQueue", this.queue.length);
      this.logger.debug(() => `Queued RCON command ${command}`, {
        operation: "dispatchCommand",
        data: {
          command,
          requestedBy: request?.requestedBy ?? "",
          queueSize: this.queue.length,
        },
      });

      this.processQueue().catch((error) => {
        this.logger.error(`RCON queue processor failed: ${error.stack ?? error}`);
      });
    });
  }

  async processQueue() {
    if (this.processing) return;

    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift();

        this.status.queueSize = this.queue.length;
        this.webStatus.set("rconQueue", this.queue.length);

        const diff = Date.now() - this.lastCommandTime;
        if (diff < this.minIntervalMs) {
          await sleep(this.minIntervalMs - diff);
        }

        try {
          if (!this.squadRcon?.connected || !this.squadRcon?.loggedIn) {
            await this.squadRcon.connect();
          }

          this.lastCommandTime = Date.now();
          this.logger.debug(() => `Executing queued RCON command ${item.request.command}`, {
            operation: "processQueue",
            data: {
              command: item.request.command,
              requestedBy: item.request.requestedBy ?? "",
              queueSize: this.queue.length,
            },
          });
          const response = await this.squadRcon.execute(item.request.command);

          this.logger.debug(() => `RCON command completed ${item.request.command}`, {
            operation: "processQueue",
            data: {
              command: item.request.command,
              responseBytes: String(response ?? "").length,
            },
          });
          item.resolve({
            success: true,
            message: "RCON command executed.",
            rconExecuted: true,
            rconResponse: response,
          });
        } catch (error) {
          this.status.lastError = error.message;
          this.webStatus.set("rcon", "error");
          this.logger.warn(`RCON command failed: ${item.request.command} -> ${error.message}`, {
            operation: "processQueue",
            data: {
              command: item.request.command,
              requestedBy: item.request.requestedBy ?? "",
            },
          });

          item.resolve({
            success: false,
            message: error.message,
            rconExecuted: false,
            rconResponse: "",
          });
        }
      }
    } finally {
      this.processing = false;
    }
  }

  async refreshPlayers() {
    if (!this.enabled || !this.squadRcon) return [];
    if (this.refreshInFlight.players) return [];

    this.refreshInFlight.players = true;

    try {
      if (!this.squadRcon.connected || !this.squadRcon.loggedIn) {
        await this.squadRcon.connect();
      }

      const players = await this.squadRcon.getListPlayers();
      this.status.lastPlayersRefresh = new Date().toISOString();
      this.webStatus.set("playerCount", players.length);
      this.logger.debug(() => `ListPlayers refreshed (${players.length})`, {
        operation: "refreshPlayers",
        data: {
          players: players.length,
        },
      });

      this.eventBus.emitCoreEvent("RCON_LIST_PLAYERS_UPDATED", {
        eventId: `rcon:listPlayers:${Date.now()}`,
        eventName: "RCON_LIST_PLAYERS_UPDATED",
        layer: "core",
        source: "core.rconManager",
        serverId: this.webStatus.serverId,
        time: new Date().toISOString(),
        params: [],
        players,
      });

      return players;
    } finally {
      this.refreshInFlight.players = false;
    }
  }

  async refreshSquads() {
    if (!this.enabled || !this.squadRcon) return [];
    if (this.refreshInFlight.squads) return [];

    this.refreshInFlight.squads = true;

    try {
      if (!this.squadRcon.connected || !this.squadRcon.loggedIn) {
        await this.squadRcon.connect();
      }

      const squads = await this.squadRcon.getSquads();
      this.status.lastSquadsRefresh = new Date().toISOString();
      this.webStatus.set("squadCount", squads.length);
      this.logger.debug(() => `ListSquads refreshed (${squads.length})`, {
        operation: "refreshSquads",
        data: {
          squads: squads.length,
        },
      });

      this.eventBus.emitCoreEvent("RCON_LIST_SQUADS_UPDATED", {
        eventId: `rcon:listSquads:${Date.now()}`,
        eventName: "RCON_LIST_SQUADS_UPDATED",
        layer: "core",
        source: "core.rconManager",
        serverId: this.webStatus.serverId,
        time: new Date().toISOString(),
        params: [],
        squads,
      });

      return squads;
    } finally {
      this.refreshInFlight.squads = false;
    }
  }

  async getCurrentMap() {
    if (!this.enabled || !this.squadRcon) return { level: null, layer: null };
    return await this.squadRcon.getCurrentMap();
  }

  async getNextMap() {
    if (!this.enabled || !this.squadRcon) return { level: null, layer: null };
    return await this.squadRcon.getNextMap();
  }

  getStatus() {
    return {
      ...this.status,
      connected: Boolean(this.squadRcon?.connected),
      authenticated: Boolean(this.squadRcon?.loggedIn),
      queueSize: this.queue.length,
    };
  }

  onNativeLog(handler) {
    if (typeof handler !== "function") {
      return () => {};
    }

    this.nativeLogListeners.add(handler);
    return () => this.nativeLogListeners.delete(handler);
  }

  emitNativeLog(entry = {}) {
    const line = {
      time: entry.time || new Date().toISOString(),
      level: entry.level || "info",
      message: String(entry.message ?? ""),
      ...entry,
    };

    for (const listener of this.nativeLogListeners) {
      try {
        listener(line);
      } catch (error) {
        this.logger.error(`Native RCON log listener failed: ${error.stack ?? error}`);
      }
    }
  }
}

function normalizeRconPayload(eventName, payload) {
  if (eventName === "RCON_ERROR") {
    return {
      message: payload instanceof Error ? payload.message : String(payload?.message ?? payload ?? "Unknown RCON error"),
      name: payload?.name || (payload instanceof Error ? payload.name : "Error"),
      stack: payload instanceof Error ? payload.stack : payload?.stack,
    };
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  return payload;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapNativeRconEventToConsoleEntry(eventName, payload) {
  if (eventName === "RCON_NATIVE_WRITE") {
    return {
      time: payload.time,
      level: "input",
      message: `> ${String(payload.command ?? payload.body ?? "").trim()}`,
      command: String(payload.command ?? ""),
      source: "core.rconManager",
    };
  }

  if (eventName === "RCON_NATIVE_RESPONSE") {
    return {
      time: payload.time,
      level: "output",
      message: String(payload.body ?? "") || "(empty response)",
      command: String(payload.command ?? ""),
      source: "core.rconManager",
    };
  }

  if (eventName === "RCON_NATIVE_ERROR") {
    return {
      time: payload.time,
      level: "error",
      message: String(payload.message ?? "Unknown RCON error"),
      command: String(payload.command ?? ""),
      source: "core.rconManager",
    };
  }

  if (eventName === "RCON_NATIVE_PUSH") {
    const isTeamKill = Boolean(payload.isTeamKill || isTeamKillRconPush(payload.body));
    return {
      time: payload.time,
      level: "push",
      message: String(payload.body ?? ""),
      source: "core.rconManager",
      isTeamKill,
      tags: isTeamKill ? ["tk"] : [],
    };
  }

  return null;
}

function summarizePayload(payload) {
  if (!payload || typeof payload !== "object") return null;

  return {
    players: Array.isArray(payload.players) ? payload.players.length : undefined,
    squads: Array.isArray(payload.squads) ? payload.squads.length : undefined,
    host: payload.host,
    port: payload.port,
    reason: payload.reason,
  };
}

function isTeamKillRconPush(value) {
  return /\[ChatAdmin]\s+ASQKillDeathRuleset\s+:\s+Player\s+.*?\s+Team Killed Player\s+/i.test(String(value ?? ""));
}
