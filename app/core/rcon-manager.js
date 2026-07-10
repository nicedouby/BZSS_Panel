// -*- coding: utf-8 -*-

import SquadRcon, {
  parseCurrentMap,
  parseListPlayers,
  parseListSquads,
  parseNextMap,
} from "./squad-rcon.js";
import { resolveRconRefreshPolicy } from "./rcon-refresh-policy.js";
import {
  canSendRconCommand,
  resolveRconPermission,
} from "../../web-client/src/shared/rcon-permissions.js";

export function resolveRconPassword(config, logger) {
  const passwordFromEnv = String(config?.passwordFromEnv ?? "").trim();
  if (passwordFromEnv) {
    const envPassword = process.env[passwordFromEnv];
    if (typeof envPassword === "string" && envPassword.trim()) {
      return envPassword;
    }

    logger?.warn?.(`RCON password env var ${passwordFromEnv} is missing or empty; falling back to config.password.`);
  }

  return config?.password ?? "";
}

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
 * - 业务动作仍应走 warning 等模块。 */
export class RconManager {
  constructor({ config, logger, eventBus, webStatus }) {
    this.config = config ?? {};
    this.logger = logger;
    this.eventBus = eventBus;
    this.webStatus = webStatus;

    this.enabled = Boolean(this.config.enabled);
    this.minIntervalMs = Number(this.config.rateLimit?.minIntervalMs ?? 500);
    this.priorityMinIntervalMs = Math.max(0, Number(this.config.rateLimit?.priorityMinIntervalMs ?? 50));
    this.maxQueueSize = Number(this.config.rateLimit?.maxQueueSize ?? 100);
    this.allowMultipleConnections = Boolean(this.config.allowMultipleConnections === true);
    this.commandPoolSize = this.allowMultipleConnections
      ? parsePositiveInteger(this.config.commandPoolSize ?? this.config.workers, 4)
      : 1;
    this.queryPoolSize = this.allowMultipleConnections
      ? parsePositiveInteger(this.config.queryPoolSize, 1)
      : 1;

    this.squadRcon = null;
    this.disbandRcon = null;
    this.rconWorkers = [];
    this.commandPool = createRconPool("command");
    this.queryPool = createRconPool("query");
    this.disbandPool = createRconPool("disband");
    this.queue = this.commandPool.queue;
    this.priorityQueue = this.commandPool.priorityQueue;
    this.disbandQueue = this.disbandPool.priorityQueue;
    this.processing = false;
    this.disbandProcessing = false;
    this.lastCommandTime = 0;
    this.lastDisbandCommandTime = 0;

    this.polling = {
      enabled: Boolean(this.config.polling?.enabled ?? false),
      playersIntervalMs: Number(this.config.polling?.playersIntervalMs ?? 3000),
      squadsIntervalMs: Number(this.config.polling?.squadsIntervalMs ?? 5000),
      dynamic: {
        enabled: Boolean(this.config.polling?.dynamic?.enabled ?? true),
        fastUntilSeconds: Number(this.config.polling?.dynamic?.fastUntilSeconds ?? 90),
        mediumUntilSeconds: Number(this.config.polling?.dynamic?.mediumUntilSeconds ?? 180),
        fastPlayersIntervalMs: Number(this.config.polling?.dynamic?.fastPlayersIntervalMs ?? 1000),
        fastSquadsIntervalMs: Number(this.config.polling?.dynamic?.fastSquadsIntervalMs ?? 1500),
        mediumPlayersIntervalMs: Number(this.config.polling?.dynamic?.mediumPlayersIntervalMs ?? 2500),
        mediumSquadsIntervalMs: Number(this.config.polling?.dynamic?.mediumSquadsIntervalMs ?? 3500),
      },
    };

    this.pollingTimers = {
      players: null,
      squads: null,
    };
    this.pollingKickPending = {
      players: false,
      squads: false,
    };
    this.connectionGeneration = 0;
    this.initialRefreshGeneration = -1;
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
      players: null,
      squads: null,
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
      password: resolveRconPassword(this.config, this.logger),
      autoReconnectDelay: this.config.autoReconnectDelay ?? 5000,
      commandTimeoutMs: this.config.commandTimeoutMs ?? 15000,
      logger: this.logger,
    });

    this.attachSquadRconEvents();

    this.disbandRcon = this.allowMultipleConnections
      ? new SquadRcon({
          host: this.config.host,
          port: this.config.port,
          password: resolveRconPassword(this.config, this.logger),
          autoReconnectDelay: this.config.autoReconnectDelay ?? 5000,
          commandTimeoutMs: this.config.commandTimeoutMs ?? 15000,
          logger: this.logger,
        })
      : this.squadRcon;
    this.disbandPool.lanes = [createPoolLane("disband", this.disbandRcon)];
    this.disbandQueue = this.disbandPool.priorityQueue;

    this.commandPool.lanes = this.allowMultipleConnections
      ? this.createPoolLanes("command", this.commandPoolSize)
      : [createPoolLane("command-1", this.squadRcon)];
    this.queryPool.lanes = this.allowMultipleConnections
      ? this.createPoolLanes("query", this.queryPoolSize)
      : [createPoolLane("query-1", this.squadRcon)];
    this.rconWorkers = this.commandPool.lanes;

    try {
      this.logger.info(`Connecting to RCON ${this.config.host}:${this.config.port}`, {
        operation: "start",
      });
      await this.squadRcon.connect();
      this.setConnected(true);
      if (this.connectionGeneration === 0) {
        this.connectionGeneration = 1;
        this.kickInitialPolling(this.connectionGeneration);
      }

      if (this.allowMultipleConnections) {
        this.disbandRcon.connect()
          .then(() => {
            this.logger.info("RCON disband lane connected.", { operation: "start" });
          })
          .catch((err) => {
            this.logger.error(`RCON disband lane connection failed: ${err.message}`, { operation: "start" });
          });

        for (const worker of [...this.commandPool.lanes, ...this.queryPool.lanes]) {
          worker.client.connect()
            .then(() => {
              this.logger.info(`RCON lane ${worker.id} connected.`, { operation: "start" });
            })
            .catch((err) => {
              this.logger.error(`RCON lane ${worker.id} connection failed: ${err.message}`, { operation: "start" });
            });
        }
      }

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
    this.clearPollingTimer("players");
    this.clearPollingTimer("squads");
    this.pollingKickPending.players = false;
    this.pollingKickPending.squads = false;

    for (const dispose of this.rconEventTeardown.splice(0)) {
      try {
        dispose();
      } catch {}
    }

    if (this.squadRcon) {
      await this.squadRcon.disconnect().catch(() => {});
    }

    if (this.disbandRcon && this.disbandRcon !== this.squadRcon) {
      await this.disbandRcon.disconnect().catch(() => {});
      this.disbandRcon = null;
    }

    for (const worker of this.rconWorkers) {
      if (worker.client && worker.client !== this.squadRcon) {
        await worker.client.disconnect().catch(() => {});
      }
    }
    for (const worker of this.queryPool.lanes) {
      if (worker.client && worker.client !== this.squadRcon) {
        await worker.client.disconnect().catch(() => {});
      }
    }
    this.rconWorkers = [];
    this.commandPool.lanes = [];
    this.queryPool.lanes = [];
    this.disbandPool.lanes = [];
    this.clearPoolTimer(this.commandPool);
    this.clearPoolTimer(this.queryPool);
    this.clearPoolTimer(this.disbandPool);

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
          this.connectionGeneration += 1;
          this.kickInitialPolling(this.connectionGeneration);
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
        
        // Also emit as native log for better debugging visibility in the console
        if (eventName === "CHAT_MESSAGE") {
          this.emitNativeLog({
            level: "push",
            message: `[CHAT] ${payload.channel} | ${payload.name}: ${payload.message}`,
            source: "core.rconManager",
            label: "Chat",
          });
        }

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

  createPoolLanes(kind, count) {
    const lanes = [];
    for (let i = 0; i < count; i++) {
      const client = new SquadRcon({
        host: this.config.host,
        port: this.config.port,
        password: resolveRconPassword(this.config, this.logger),
        autoReconnectDelay: this.config.autoReconnectDelay ?? 5000,
        commandTimeoutMs: this.config.commandTimeoutMs ?? 15000,
        logger: this.logger,
      });
      lanes.push(createPoolLane(`${kind}-${i + 1}`, client));
    }
    return lanes;
  }

  kickInitialPolling(generation) {
    if (!this.polling.enabled) return;
    if (this.initialRefreshGeneration === generation) return;
    this.initialRefreshGeneration = generation;
    this.pollingKickPending.players = true;
    this.pollingKickPending.squads = true;
    this.startPolling();
  }

  startPolling() {
    if (!this.polling.enabled) return;
    const players = this.resolvePollingInterval("players");
    const squads = this.resolvePollingInterval("squads");
    this.logger.info(`RCON polling started. players=${players}ms squads=${squads}ms`);

    if (this.pollingKickPending.players) {
      this.pollingKickPending.players = false;
      this.clearPollingTimer("players");
      void this.runPollingTick("players").catch((err) => this.logger.warn(`Initial ListPlayers failed: ${err.message}`));
    } else if (!this.pollingTimers.players) {
      this.schedulePolling("players");
    }

    if (this.pollingKickPending.squads) {
      this.pollingKickPending.squads = false;
      this.clearPollingTimer("squads");
      void this.runPollingTick("squads").catch((err) => this.logger.warn(`Initial ListSquads failed: ${err.message}`));
    } else if (!this.pollingTimers.squads) {
      this.schedulePolling("squads");
    }
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

    const actor = request?.actor ?? request?.user ?? null;
    const system = Boolean(request?.system);
    const requiredPermission = resolveRconPermission(command, request);
    if (!system && !canSendRconCommand(actor, command, request)) {
      return {
        success: false,
        code: "Forbidden",
        message: `Permission '${requiredPermission}' is required.`,
        requiredPermission,
        rconExecuted: false,
        rconResponse: "",
      };
    }

    const priority = isPriorityRequest(request);
    const bypassRateLimit = Boolean(request?.bypassRateLimit === true);
    if (this.getQueueSize() >= this.maxQueueSize) {
      return {
        success: false,
        message: "RCON queue is full.",
        rconExecuted: false,
        rconResponse: "",
      };
    }

    return await new Promise((resolve) => {
      const enqueuedAt = Date.now();
      const item = {
        request: { ...request, command },
        priority,
        bypassRateLimit,
        resolve,
        enqueuedAt,
      };

      const pool = this.resolveCommandPool(request, command);
      this.ensurePoolLanes(pool);
      if (priority) pool.priorityQueue.push(item);
      else pool.queue.push(item);

      this.status.queueSize = this.getQueueSize();
      this.webStatus.set("rconQueue", this.getQueueSize());
      this.logger.debug(() => `Queued RCON command ${command}`, {
        operation: "dispatchCommand",
        data: {
          command,
          requestedBy: request?.requestedBy ?? "",
          requiredPermission,
          queueSize: this.getQueueSize(),
          priority,
          pool: pool.name,
        },
      });

      this.pumpPool(pool);
    });
  }

  resolveCommandPool(request, command) {
    if (isDisbandLaneRequest(request, command)) return this.disbandPool;
    if (isQueryLaneRequest(request, command)) return this.queryPool;
    return this.commandPool;
  }

  ensurePoolLanes(pool) {
    if (!pool || pool.lanes.length > 0) return;
    if (pool.name === "disband") {
      const client = this.disbandRcon ?? this.squadRcon;
      if (client) pool.lanes = [createPoolLane("disband", client)];
      return;
    }
    if ((pool.name === "command" || pool.name === "query") && this.squadRcon) {
      pool.lanes = [createPoolLane(`${pool.name}-1`, this.squadRcon)];
    }
    if (pool.name === "command") this.rconWorkers = this.commandPool.lanes;
  }

  processDisbandQueue() {
    this.pumpPool(this.disbandPool);
    return Promise.resolve();
  }

  processQueue() {
    this.pumpPool(this.commandPool);
    return Promise.resolve();
  }

  runWorker(worker) {
    this.pumpPool(this.commandPool);
    return Promise.resolve(worker);
  }

  pumpPool(pool) {
    if (!pool || !this.hasPoolQueue(pool)) return;
    if (pool.pumping) return;
    pool.pumping = true;

    try {
      this.clearPoolTimer(pool);
      let dispatched = false;

      while (this.hasPoolQueue(pool)) {
        const lane = this.pickReadyLane(pool);
        if (!lane) break;

        const item = this.shiftPoolItem(pool);
        if (!item) break;

        dispatched = true;
        lane.busy = true;
        const now = Date.now();
        lane.lastUsedAt = now;
        const cooldownMs = this.resolveItemCooldownMs(item);
        lane.cooldownUntil = now + cooldownMs;

        this.status.queueSize = this.getQueueSize();
        this.webStatus.set("rconQueue", this.getQueueSize());

        void this.executeQueuedItem(item, lane.client, {
          lane: lane.id,
          pool: pool.name,
          updateLastCommandTime: (value) => {
            lane.lastCommandTime = value;
            lane.lastUsedAt = value;
            if (pool.name === "command") this.lastCommandTime = value;
            if (pool.name === "disband") this.lastDisbandCommandTime = value;
          },
        }).then((result) => {
          if (result?.success) {
            lane.failureCount = 0;
            lane.lastError = "";
          } else {
            lane.failureCount += 1;
            lane.lastError = String(result?.message ?? "RCON command failed.");
          }
        }).catch((error) => {
          lane.failureCount += 1;
          lane.lastError = error instanceof Error ? error.message : String(error);
          this.logger.error(`RCON lane ${lane.id} failed: ${error.stack ?? error}`);
        }).finally(() => {
          lane.busy = false;
          this.pumpAllPools();
        });
      }

      if (!dispatched && this.hasPoolQueue(pool)) {
        this.schedulePoolPump(pool);
      }
    } finally {
      pool.pumping = false;
    }
  }

  pumpAllPools() {
    this.pumpPool(this.disbandPool);
    this.pumpPool(this.commandPool);
    this.pumpPool(this.queryPool);
  }

  hasPoolQueue(pool) {
    return pool.priorityQueue.length > 0 || pool.queue.length > 0;
  }

  shiftPoolItem(pool) {
    return pool.priorityQueue.length > 0 ? pool.priorityQueue.shift() : pool.queue.shift();
  }

  pickReadyLane(pool) {
    const now = Date.now();
    return pool.lanes
      .filter((lane) => !lane.busy && !this.isClientBusy(lane.client) && Number(lane.cooldownUntil ?? 0) <= now)
      .sort(compareLaneIdleOrder)[0] ?? null;
  }

  isClientBusy(client) {
    if (!client) return false;
    const pools = [this.commandPool, this.queryPool, this.disbandPool];
    return pools.some((pool) => pool.lanes.some((lane) => lane.client === client && lane.busy));
  }

  schedulePoolPump(pool) {
    if (pool.timer) return;
    const delayMs = this.resolveNextPoolDelayMs(pool);
    if (!Number.isFinite(delayMs)) return;

    pool.timer = setTimeout(() => {
      pool.timer = null;
      this.pumpPool(pool);
    }, Math.max(0, delayMs));
  }

  clearPoolTimer(pool) {
    if (!pool?.timer) return;
    clearTimeout(pool.timer);
    pool.timer = null;
  }

  resolveNextPoolDelayMs(pool) {
    const now = Date.now();
    const times = pool.lanes
      .filter((lane) => !lane.busy && !this.isClientBusy(lane.client))
      .map((lane) => Number(lane.cooldownUntil ?? 0))
      .filter((value) => Number.isFinite(value));
    if (times.length === 0) return Number.POSITIVE_INFINITY;
    return Math.max(0, Math.min(...times) - now);
  }

  resolveItemCooldownMs(item) {
    if (item?.bypassRateLimit) return 0;
    return item?.priority ? this.priorityMinIntervalMs : this.minIntervalMs;
  }

  async executeQueuedItem(item, client, { lane = "default", updateLastCommandTime = () => {} } = {}) {
    const command = item.request.command;
    const queuedMs = Date.now() - Number(item.enqueuedAt ?? Date.now());
    const startedAt = Date.now();

    try {
      if (!client?.connected || !client?.loggedIn) {
        await client.connect();
      }

      updateLastCommandTime(Date.now());
      this.emitNativeLog({
        level: "status",
        message: `[RCON:${lane}] start ${command} queued=${queuedMs}ms`,
        command,
        lane,
        queuedMs,
        requestedBy: item.request.requestedBy ?? "",
        source: "core.rconManager",
      });
      this.logger.debug(() => `Executing queued RCON command ${command}`, {
        operation: "executeQueuedItem",
        data: {
          command,
          requestedBy: item.request.requestedBy ?? "",
          queueSize: this.getQueueSize(),
          priority: Boolean(item?.priority),
          bypassRateLimit: Boolean(item?.bypassRateLimit),
          lane,
          queuedMs,
        },
      });
      const response = await client.execute(command);
      const executionMs = Date.now() - startedAt;

      this.emitNativeLog({
        level: "status",
        message: `[RCON:${lane}] done ${command} queued=${queuedMs}ms exec=${executionMs}ms`,
        command,
        lane,
        queuedMs,
        executionMs,
        source: "core.rconManager",
      });
      const result = {
        success: true,
        message: "RCON command executed.",
        rconExecuted: true,
        rconResponse: response,
        queueLane: lane,
        queuedMs,
        executionMs,
      };
      item.resolve(result);
      return result;
    } catch (error) {
      const executionMs = Date.now() - startedAt;
      this.status.lastError = error.message;
      this.webStatus.set("rcon", "error");
      this.emitNativeLog({
        level: "error",
        message: `[RCON:${lane}] failed ${command} queued=${queuedMs}ms exec=${executionMs}ms error=${error.message}`,
        command,
        lane,
        queuedMs,
        executionMs,
        source: "core.rconManager",
      });
      this.logger.warn(`RCON command failed: ${command} -> ${error.message}`, {
        operation: "executeQueuedItem",
        data: {
          command,
          requestedBy: item.request.requestedBy ?? "",
          lane,
        },
      });

      const result = {
        success: false,
        message: error.message,
        rconExecuted: false,
        rconResponse: "",
        queueLane: lane,
        queuedMs,
        executionMs,
      };
      item.resolve(result);
      return result;
    }
  }

  async refreshPlayers() {
    if (!this.enabled) return [];
    if (this.refreshInFlight.players) return this.refreshInFlight.players;

    const refreshPromise = (async () => {
      const result = await this.dispatchCommand({
        command: "ListPlayers",
        requestedBy: "core.rconManager",
        reason: "rcon-poll-players",
        system: true,
        rconChannel: "query",
      });
      if (!result?.success) return [];

      const parseStartedAt = Date.now();
      const players = parseListPlayers(result.rconResponse);
      const parseMs = Date.now() - parseStartedAt;
      this.status.lastPlayersRefresh = new Date().toISOString();
      this.webStatus.set("playerCount", players.length);
      this.logger.info(
        `[RCON_PERF] command=ListPlayers queuedMs=${Number(result.queuedMs ?? 0)} executionMs=${Number(result.executionMs ?? 0)} parseMs=${parseMs} playerCount=${players.length}`,
        { operation: "refreshPlayers" },
      );

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
    })();

    this.refreshInFlight.players = refreshPromise;
    try {
      return await refreshPromise;
    } finally {
      if (this.refreshInFlight.players === refreshPromise) {
        this.refreshInFlight.players = null;
      }
    }
  }

  async refreshSquads() {
    if (!this.enabled) return [];
    if (this.refreshInFlight.squads) return this.refreshInFlight.squads;

    const refreshPromise = (async () => {
      const result = await this.dispatchCommand({
        command: "ListSquads",
        requestedBy: "core.rconManager",
        reason: "rcon-poll-squads",
        system: true,
        rconChannel: "query",
      });
      if (!result?.success) return [];

      const squads = parseListSquads(result.rconResponse);
      this.status.lastSquadsRefresh = new Date().toISOString();
      this.webStatus.set("squadCount", squads.length);

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
    })();

    this.refreshInFlight.squads = refreshPromise;
    try {
      return await refreshPromise;
    } finally {
      if (this.refreshInFlight.squads === refreshPromise) {
        this.refreshInFlight.squads = null;
      }
    }
  }

  async runPollingTick(type) {
    if (!this.polling.enabled) return [];

    try {
      if (type === "players") {
        return await this.refreshPlayers();
      }

      if (type === "squads") {
        return await this.refreshSquads();
      }

      return [];
    } finally {
      this.schedulePolling(type);
    }
  }

  schedulePolling(type) {
    if (!this.polling.enabled) return;
    const delayMs = this.resolvePollingInterval(type);
    this.clearPollingTimer(type);

    this.pollingTimers[type] = setTimeout(() => {
      this.pollingTimers[type] = null;
      this.runPollingTick(type).catch((err) => this.logger.warn(`${type} polling failed: ${err.message}`));
    }, delayMs);
  }

  clearPollingTimer(type) {
    const timer = this.pollingTimers[type];
    if (timer) {
      clearTimeout(timer);
      this.pollingTimers[type] = null;
    }
  }

  resolvePollingInterval(type) {
    const snapshot = this.webStatus?.getSnapshot?.() ?? {};
    const policy = this.resolvePollingPolicy(snapshot);

    if (type === "players") return policy.playersIntervalMs;
    if (type === "squads") return policy.squadsIntervalMs;
    return policy.playersIntervalMs;
  }

  async getCurrentMap() {
    if (!this.enabled) return { level: null, layer: null };
    const result = await this.dispatchCommand({
      command: "ShowCurrentMap",
      requestedBy: "core.rconManager",
      reason: "rcon-query-current-map",
      system: true,
      rconChannel: "query",
    });
    if (!result?.success) return { level: null, layer: null };
    return parseCurrentMap(result.rconResponse);
  }

  async getNextMap() {
    if (!this.enabled) return { level: null, layer: null };
    const result = await this.dispatchCommand({
      command: "ShowNextMap",
      requestedBy: "core.rconManager",
      reason: "rcon-query-next-map",
      system: true,
      rconChannel: "query",
    });
    if (!result?.success) return { level: null, layer: null };
    return parseNextMap(result.rconResponse);
  }

  getStatus() {
    const snapshot = this.webStatus?.getSnapshot?.() ?? {};
    const policy = this.resolvePollingPolicy(snapshot);
    return {
      ...this.status,
      connected: Boolean(this.squadRcon?.connected),
      authenticated: Boolean(this.squadRcon?.loggedIn),
      queueSize: this.getQueueSize(),
      allowMultipleConnections: this.allowMultipleConnections,
      workers: this.commandPool.lanes.map((w) => ({
        id: w.id,
        connected: Boolean(w.client?.connected),
        authenticated: Boolean(w.client?.loggedIn),
        busy: w.busy,
        cooldownUntil: Number(w.cooldownUntil ?? 0),
        failureCount: Number(w.failureCount ?? 0),
      })),
      commandPool: this.getPoolStatus(this.commandPool),
      queryPool: this.getPoolStatus(this.queryPool),
      disbandLane: this.getPoolStatus(this.disbandPool),
      polling: {
        enabled: this.polling.enabled,
        dynamicEnabled: this.polling.dynamic.enabled,
        mode: policy.mode,
        playersIntervalMs: policy.playersIntervalMs,
        squadsIntervalMs: policy.squadsIntervalMs,
        fastUntilSeconds: policy.fastUntilSeconds,
        mediumUntilSeconds: policy.mediumUntilSeconds,
        logClockSeconds: Number(snapshot.logClockSeconds ?? 0) || 0,
        logClockHasAnchor: Boolean(snapshot.logClockHasAnchor),
        logClockManual: Boolean(snapshot.logClockManual),
      },
    };
  }

  getQueueSize() {
    return getPoolQueueSize(this.commandPool) + getPoolQueueSize(this.queryPool) + getPoolQueueSize(this.disbandPool);
  }

  getPoolStatus(pool) {
    const now = Date.now();
    const nextReadyAt = pool.lanes
      .filter((lane) => !lane.busy)
      .map((lane) => Number(lane.cooldownUntil ?? 0))
      .filter((value) => Number.isFinite(value) && value > now)
      .sort((a, b) => a - b)[0] ?? 0;
    return {
      name: pool.name,
      size: pool.lanes.length,
      busy: pool.lanes.filter((lane) => lane.busy).length,
      queueSize: getPoolQueueSize(pool),
      priorityQueueSize: pool.priorityQueue.length,
      normalQueueSize: pool.queue.length,
      nextReadyAt,
      nextReadyInMs: nextReadyAt ? Math.max(0, nextReadyAt - now) : 0,
      lanes: pool.lanes.map((lane) => ({
        id: lane.id,
        connected: Boolean(lane.client?.connected),
        authenticated: Boolean(lane.client?.loggedIn),
        busy: Boolean(lane.busy),
        lastCommandTime: Number(lane.lastCommandTime ?? 0),
        lastUsedAt: Number(lane.lastUsedAt ?? 0),
        cooldownUntil: Number(lane.cooldownUntil ?? 0),
        failureCount: Number(lane.failureCount ?? 0),
        lastError: String(lane.lastError ?? ""),
      })),
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

  resolvePollingPolicy(snapshot = {}) {
    return resolveRconRefreshPolicy({
      logClockSeconds: snapshot.logClockSeconds,
      logClockHasAnchor: snapshot.logClockHasAnchor,
      logClockManual: snapshot.logClockManual,
      config: {
        enabled: this.polling.dynamic.enabled,
        playersIntervalMs: this.polling.playersIntervalMs,
        squadsIntervalMs: this.polling.squadsIntervalMs,
        dynamic: this.polling.dynamic,
      },
    });
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

function createRconPool(name) {
  return {
    name,
    lanes: [],
    queue: [],
    priorityQueue: [],
    timer: null,
    pumping: false,
  };
}

function createPoolLane(id, client) {
  return {
    id,
    client,
    busy: false,
    lastCommandTime: 0,
    lastUsedAt: 0,
    cooldownUntil: 0,
    failureCount: 0,
    lastError: "",
  };
}

function getPoolQueueSize(pool) {
  return Number(pool?.queue?.length ?? 0) + Number(pool?.priorityQueue?.length ?? 0);
}

function compareLaneIdleOrder(a, b) {
  const aLast = Number(a?.lastUsedAt ?? 0);
  const bLast = Number(b?.lastUsedAt ?? 0);
  if (aLast !== bLast) return aLast - bLast;
  return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function isPriorityRequest(request) {
  return String(request?.priority ?? "").trim().toLowerCase() === "high"
    || request?.priority === true
    || request?.bypassRateLimit === true;
}

function isDisbandLaneRequest(request, command) {
  const lane = String(request?.rconChannel ?? request?.lane ?? "").trim().toLowerCase();
  return lane === "disband" || /^AdminDisbandSquad\b/i.test(String(command ?? "").trim());
}

function isQueryLaneRequest(request, command) {
  const lane = String(request?.rconChannel ?? request?.lane ?? "").trim().toLowerCase();
  if (lane === "query" || lane === "poll" || lane === "polling") return true;
  return /^(ListPlayers|ListSquads|ShowCurrentMap|ShowNextMap|ShowServerInfo)\b/i.test(String(command ?? "").trim());
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
