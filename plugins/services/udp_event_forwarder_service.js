import { UdpEventSender } from "./udp_event_sender.js";

const COMPONENT = "UdpEventForwarderService";
const PLUGIN_ID = "udp_event_forwarder";
const SCHEMA = "bzss.udp.event.v1";
const EVENT_TTL_MS = 10 * 60 * 1000;
const MAX_SEEN_EVENTS = 5000;
const DEFAULT_MAX_LOGS = 2000;

function readPluginConfig(sourceConfig = {}) {
  if (sourceConfig && typeof sourceConfig.get === "function") {
    return sourceConfig.get("plugins.udpEventForwarder", {}) ?? {};
  }

  if (sourceConfig && typeof sourceConfig === "object") {
    return sourceConfig.plugins?.udpEventForwarder ?? {};
  }

  return {};
}

function configBool(value, fallback = false) {
  if (value == null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function configInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function configString(value, fallback) {
  return value == null || value === "" ? fallback : String(value);
}

function safeLogger(logger) {
  function write(level, message, extra = {}) {
    const payload = {
      module: COMPONENT,
      ownerType: "plugin",
      ownerName: PLUGIN_ID,
      ...extra,
    };

    const fn = logger?.[level];

    if (typeof fn === "function") {
      try {
        fn.call(logger, message, payload);
        return;
      } catch {
        try {
          fn.call(logger, payload, message);
          return;
        } catch {
          // fall through
        }
      }
    }

    const consoleFn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    consoleFn(`[${COMPONENT}] ${message}`, extra);
  }

  return {
    info: (message, extra) => write("info", message, extra),
    warn: (message, extra) => write("warn", message, extra),
    error: (message, extra) => write("error", message, extra),
    debug: (message, extra) => write("debug", message, extra),
  };
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return null;
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIsoOrNull(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }

  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function secondsToDisplay(seconds) {
  const n = toNumberOrNull(seconds);

  if (n == null) {
    return null;
  }

  const total = Math.max(0, Math.floor(n));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function compactObject(value) {
  if (Array.isArray(value)) {
    return value.map(compactObject);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) {
      continue;
    }

    out[key] = child && typeof child === "object" ? compactObject(child) : child;
  }

  return out;
}

function sanitizeNullableName(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  const lowered = text.toLowerCase();
  if (lowered === "null" || lowered === "nullptr" || lowered === "none" || lowered === "invalid") {
    return null;
  }

  return text;
}

function parseLayerNameFromWorldPath(worldPath) {
  if (!worldPath || typeof worldPath !== "string") {
    return null;
  }

  const last = worldPath.split("/").pop() || "";
  const beforeDot = last.split(".")[0] || last;
  return beforeDot || null;
}

function parseMapNameFromLayer(layer) {
  if (!layer || typeof layer !== "string") {
    return null;
  }

  const parts = layer.split("_");
  return parts[0] || null;
}

function parseGameModeFromLayer(layer) {
  if (!layer || typeof layer !== "string") {
    return null;
  }

  const parts = layer.split("_");
  for (const part of parts) {
    const upper = part.toUpperCase();
    if (["RAAS", "AAS", "INV", "INVASION", "TC", "SEED", "SKIRMISH", "TUTORIAL", "INS", "INSURGENCY", "DESTRUCTION"].includes(upper)) {
      return upper;
    }
  }

  return null;
}

function extractIdentity(source, prefix) {
  if (!source || typeof source !== "object") {
    return {
      name: null,
      steamId: null,
      eosId: null,
      controllerId: null,
    };
  }

  const nested = source[prefix] && typeof source[prefix] === "object" ? source[prefix] : {};

  return {
    name: sanitizeNullableName(firstDefined(
      nested.name,
      source[`${prefix}Name`],
      source[`${prefix}DisplayName`],
      source[`${prefix}_name`],
    )),
    steamId: firstDefined(
      nested.steamId,
      nested.steamID,
      nested.steam64ID,
      source[`${prefix}Steam64ID`],
      source[`${prefix}SteamID`],
      source[`${prefix}SteamId`],
      source[`${prefix}Steam`],
    ),
    eosId: firstDefined(
      nested.eosId,
      nested.eosID,
      source[`${prefix}EOSID`],
      source[`${prefix}EosID`],
      source[`${prefix}EosId`],
    ),
    controllerId: firstDefined(
      nested.controllerId,
      nested.controllerID,
      source[`${prefix}ControllerID`],
      source[`${prefix}ControllerId`],
    ),
  };
}

function normalizeProcessedPlayerRef(player) {
  if (!player || typeof player !== "object") {
    return {
      name: null,
      teamID: null,
      squadID: null,
      steam64ID: null,
      eosID: null,
      controllerID: null,
      role: "",
      isLeader: false,
      resolved: false,
      resolutionSource: "",
      isNullptr: false,
      isFallback: false,
      fallbackReason: "",
    };
  }

  return compactObject({
    name: sanitizeNullableName(player.name),
    teamID: firstDefined(player.teamID, player.teamId),
    squadID: firstDefined(player.squadID, player.squadId),
    steam64ID: firstDefined(player.steam64ID, player.steamID, player.steamId),
    eosID: firstDefined(player.eosID, player.eosId),
    controllerID: firstDefined(player.controllerID, player.controllerId),
    role: player.role ?? "",
    isLeader: Boolean(player.isLeader),
    resolved: Boolean(player.resolved),
    resolutionSource: player.resolutionSource ?? "",
    isNullptr: Boolean(player.isNullptr),
    isFallback: Boolean(player.isFallback),
    fallbackReason: player.fallbackReason ?? "",
  });
}

function normalizeCombatPayload(event) {
  if (!event || typeof event !== "object") {
    return {};
  }

  if (event.record && typeof event.record === "object") {
    return event.record;
  }

  if (event.normalized?.combat && typeof event.normalized.combat === "object") {
    return event.normalized.combat;
  }

  return event;
}

function normalizeRoundPayload(event) {
  if (!event || typeof event !== "object") {
    return {};
  }

  if (event.record && typeof event.record === "object") {
    return event.record;
  }

  if (event.normalized?.roundWorldBringUp && typeof event.normalized.roundWorldBringUp === "object") {
    return event.normalized.roundWorldBringUp;
  }

  return event;
}

function normalizeMatchStatePayload(event) {
  if (!event || typeof event !== "object") {
    return {};
  }

  if (event.matchState && typeof event.matchState === "object") {
    return event.matchState;
  }

  if (event.state && typeof event.state === "object") {
    return event.state;
  }

  return event;
}

function readConfig(sourceConfig = {}, pluginConfigOverride = {}) {
  const pluginConfig = {
    ...readPluginConfig(sourceConfig),
    ...pluginConfigOverride,
  };

  return {
    enabled: configBool(pluginConfig.enabled, false),
    host: configString(pluginConfig.host, "127.0.0.1"),
    port: configInt(pluginConfig.port, 39001),
    serverId: configString(pluginConfig.serverId, "BZSS_Main"),

    statusIntervalMs: configInt(pluginConfig.statusIntervalMs, 5000),
    heartbeatIntervalMs: configInt(pluginConfig.heartbeatIntervalMs, 30000),

    includeRawLog: configBool(pluginConfig.includeRawLog, false),
    includeIds: configBool(pluginConfig.includeIds, true),

    sendCombatEvents: configBool(pluginConfig.sendCombatEvents ?? pluginConfig.sendCombatDamage, true),
    sendCombatDamage: configBool(pluginConfig.sendCombatDamage, true),
    sendMapChanged: configBool(pluginConfig.sendMapChanged, true),
    sendChat: configBool(pluginConfig.sendChat, true),
    sendStatus: configBool(pluginConfig.sendStatus, true),
    sendHeartbeat: configBool(pluginConfig.sendHeartbeat, true),

    maxQueueSize: configInt(pluginConfig.maxQueueSize, 1000),
    maxPacketBytes: configInt(pluginConfig.maxPacketBytes, 1200),
    maxLogs: configInt(pluginConfig.maxLogs, DEFAULT_MAX_LOGS),
    dropPolicy: configString(pluginConfig.dropPolicy, "drop_oldest"),

    logSuccess: configBool(pluginConfig.logSuccess, false),
    logFailure: configBool(pluginConfig.logFailure, true),
  };
}

function subscribeEvent(eventBus, kind, eventName, handler) {
  if (!eventBus) {
    return () => {};
  }

  if (kind === "module" && typeof eventBus.onModuleEvent === "function") {
    const ret = eventBus.onModuleEvent(eventName.moduleId, eventName.name, handler);
    return typeof ret === "function" ? ret : () => {};
  }

  if (kind === "core" && typeof eventBus.onCoreEvent === "function") {
    const ret = eventBus.onCoreEvent(eventName, handler);
    return typeof ret === "function" ? ret : () => {};
  }

  return () => {};
}

function isNilOrEmpty(value) {
  return value === undefined || value === null || value === "";
}

export class UdpEventForwarderService {
  constructor(options = {}) {
    this.eventBus = options.eventBus;
    this.modules = options.modules || {};
    this.logger = safeLogger(options.logger);
    this.config = readConfig(options.config, options.pluginConfig);
    this.maxLogs = configInt(this.config.maxLogs, DEFAULT_MAX_LOGS);

    this.sender = new UdpEventSender({
      host: this.config.host,
      port: this.config.port,
      maxQueueSize: this.config.maxQueueSize,
      maxPacketBytes: this.config.maxPacketBytes,
      dropPolicy: this.config.dropPolicy,
      logSuccess: this.config.logSuccess,
      logFailure: this.config.logFailure,
      logger: options.logger,
    });

    this.started = false;
    this.unsubscribers = [];
    this.statusTimer = null;
    this.heartbeatTimer = null;
    this.sequence = 0;
    this.seenSourceEventIds = new Map();
    this.eventLogs = [];

    this.state = {
      serverId: this.config.serverId,
      matchId: null,
      map: null,
      layer: null,
      gameMode: null,
      previousMap: null,
      previousLayer: null,
      worldPath: null,
      playerCount: null,
      maxPlayers: null,
      queueCount: null,
      rconElapsedSeconds: null,
      rconDisplay: null,
      rconAvailable: false,
      rconUpdatedAt: null,
      logStartedAt: null,
      logElapsedSeconds: null,
      logDisplay: null,
      logAvailable: false,
      logUpdatedAt: null,
      lastMapChangedAt: null,
      lastMatchStateUpdatedAt: null,
      lastRoundStateUpdatedAt: null,
      lastCombatEventAt: null,
      lastForwardedAt: null,
    };
  }

  async start() {
    if (this.started) {
      return;
    }

    if (!this.eventBus) {
      throw new Error("UdpEventForwarderService requires eventBus in plugin context.");
    }

    this.sender.start();
    this.syncFromModules();

    const meta = {
      ownerType: "plugin",
      ownerName: PLUGIN_ID,
      module: COMPONENT,
    };

    this.unsubscribers.push(
      subscribeEvent(this.eventBus, "module", { moduleId: "module.combatClean", name: "damageResolved" }, (event) => this.forwardProcessedCombatEvent(event, "module.combatClean.damageResolved")),
      subscribeEvent(this.eventBus, "module", { moduleId: "module.combatClean", name: "woundResolved" }, (event) => this.forwardProcessedCombatEvent(event, "module.combatClean.woundResolved")),
      subscribeEvent(this.eventBus, "module", { moduleId: "module.combatClean", name: "reviveResolved" }, (event) => this.forwardProcessedCombatEvent(event, "module.combatClean.reviveResolved")),
      subscribeEvent(this.eventBus, "module", { moduleId: "module.combatClean", name: "killResolved" }, (event) => this.forwardProcessedCombatEvent(event, "module.combatClean.killResolved")),
      subscribeEvent(this.eventBus, "core", "round.world_bring_up", (event) => this.forwardMapChanged(event, "round.world_bring_up")),
      subscribeEvent(this.eventBus, "core", "On_RawLogLine", (event) => this.forwardMapChanged(event, "On_RawLogLine")),
      subscribeEvent(this.eventBus, "core", "RCON_MATCH_STATE_UPDATED", (event) => this.onMatchStateUpdated(event, "RCON_MATCH_STATE_UPDATED")),
      subscribeEvent(this.eventBus, "core", "RCON_LIST_PLAYERS_UPDATED", (event) => this.onMatchStateUpdated(event, "RCON_LIST_PLAYERS_UPDATED")),
      subscribeEvent(this.eventBus, "core", "RCON_LIST_SQUADS_UPDATED", (event) => this.onMatchStateUpdated(event, "RCON_LIST_SQUADS_UPDATED")),
      subscribeEvent(this.eventBus, "module", { moduleId: "module.matchState", name: "updated" }, (event) => this.onMatchStateUpdated(event, "module.matchState.updated")),
      subscribeEvent(this.eventBus, "module", { moduleId: "module.roundState", name: "updated" }, (event) => this.forwardMapChanged(event, "module.roundState.updated")),
      subscribeEvent(this.eventBus, "module", { moduleId: "module.chatManager", name: "CHAT_RECEIVED" }, (event) => this.forwardChat(event, "module.chatManager.CHAT_RECEIVED")),
    );

    if (this.config.sendStatus) {
      this.statusTimer = setInterval(() => {
        this.forwardStatus();
      }, this.config.statusIntervalMs);

      if (typeof this.statusTimer.unref === "function") {
        this.statusTimer.unref();
      }
    }

    if (this.config.sendHeartbeat) {
      this.heartbeatTimer = setInterval(() => {
        this.forwardHeartbeat();
      }, this.config.heartbeatIntervalMs);

      if (typeof this.heartbeatTimer.unref === "function") {
        this.heartbeatTimer.unref();
      }
    }

    this.started = true;

    this.logger.info("UDP event forwarder started.", {
      target: this.sender.getTarget(),
      config: {
        statusIntervalMs: this.config.statusIntervalMs,
        heartbeatIntervalMs: this.config.heartbeatIntervalMs,
        sendCombatEvents: this.config.sendCombatEvents,
        sendMapChanged: this.config.sendMapChanged,
        sendStatus: this.config.sendStatus,
        sendHeartbeat: this.config.sendHeartbeat,
      },
    });
  }

  async stop() {
    if (!this.started) {
      return;
    }

    this.started = false;

    for (const unsubscribe of this.unsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch (err) {
        this.logger.warn("Failed to unsubscribe UDP forwarder listener.", {
          error: err?.message || String(err),
        });
      }
    }

    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    await this.sender.stop();
    this.seenSourceEventIds.clear();

    this.logger.info("UDP event forwarder stopped.", {
      status: this.getStatus(),
    });
  }

  getStatus() {
    return {
      enabled: this.config.enabled,
      started: this.started,
      serverId: this.config.serverId,
      target: this.sender.getTarget(),
      maxLogs: this.maxLogs,
      state: {
        ...this.state,
      },
      sender: this.sender.getStatus(),
    };
  }

  nextEventId() {
    this.sequence += 1;
    const compactTime = new Date().toISOString().replace(/[-:.]/g, "");
    return `${this.config.serverId}:${compactTime}:${this.sequence}`;
  }

  buildMatchEnvelope() {
    return {
      matchId: this.state.matchId,
      map: this.state.map,
      layer: this.state.layer,
      gameMode: this.state.gameMode,
    };
  }

  buildEnvelope(type, payload, source = {}) {
    return compactObject({
      schema: SCHEMA,
      serverId: this.config.serverId,
      eventId: this.nextEventId(),
      type,
      timestamp: new Date().toISOString(),
      source: {
        plugin: PLUGIN_ID,
        eventBusEvent: source.eventBusEvent || null,
        sourceEventId: source.sourceEventId || null,
      },
      match: this.buildMatchEnvelope(),
      payload,
    });
  }

  emitUdp(type, payload, source = {}) {
    const envelope = this.buildEnvelope(type, payload, source);
    const accepted = this.sender.sendJson(envelope);
    const record = {
      id: envelope.eventId,
      schema: envelope.schema,
      serverId: envelope.serverId,
      type: envelope.type,
      timestamp: envelope.timestamp,
      source: {
        ...envelope.source,
      },
      match: {
        ...envelope.match,
      },
      payload: envelope.payload,
      accepted,
      delivery: accepted ? "queued" : "rejected",
      recordedAt: new Date().toISOString(),
    };

    this.eventLogs.push(record);
    if (this.eventLogs.length > this.maxLogs) {
      this.eventLogs.splice(0, this.eventLogs.length - this.maxLogs);
    }

    this.state.lastForwardedAt = record.recordedAt;
    return accepted;
  }

  syncFromModules() {
    this.syncFromMatchState(this.modules?.matchState?.getState?.() || this.modules?.matchState?.getOverview?.() || null, "initial");
    this.syncFromRoundState(this.modules?.roundState?.getState?.() || null, "initial");
  }

  onMatchStateUpdated(rawEvent, eventBusEvent) {
    const event = normalizeMatchStatePayload(rawEvent);
    this.state.lastMatchStateUpdatedAt = new Date().toISOString();

    const serverStatus = event.serverStatus && typeof event.serverStatus === "object" ? event.serverStatus : event;
    const match = event.match && typeof event.match === "object" ? event.match : event;

    const map = firstDefined(match.map, serverStatus.map, event.map);
    const layer = firstDefined(match.layer, serverStatus.layer, event.layer);
    const gameMode = firstDefined(match.mode, match.gameMode, serverStatus.mode, serverStatus.gameMode, event.gameMode);

    if (!isNilOrEmpty(map)) this.state.map = map;
    if (!isNilOrEmpty(layer)) this.state.layer = layer;
    if (!isNilOrEmpty(gameMode)) this.state.gameMode = gameMode;
    if (!isNilOrEmpty(match.matchId)) this.state.matchId = match.matchId;
    if (!isNilOrEmpty(event.matchId)) this.state.matchId = event.matchId;

    const playerCount = toNumberOrNull(firstDefined(
      serverStatus.playerCount,
      event.playerCount,
      event.players?.count,
      match.playerCount,
    ));

    const maxPlayers = toNumberOrNull(firstDefined(
      serverStatus.maxPlayers,
      event.maxPlayers,
      event.players?.max,
      match.maxPlayers,
    ));

    const queueCount = toNumberOrNull(firstDefined(
      serverStatus.queueCount,
      event.queueCount,
      event.players?.queue,
    ));

    const rconElapsedSeconds = toNumberOrNull(firstDefined(
      serverStatus.playtime,
      serverStatus.rconElapsedSeconds,
      event.playtime,
      match.playtime,
    ));

    if (playerCount != null) this.state.playerCount = playerCount;
    if (maxPlayers != null) this.state.maxPlayers = maxPlayers;
    if (queueCount != null) this.state.queueCount = queueCount;
    if (rconElapsedSeconds != null) {
      this.state.rconElapsedSeconds = rconElapsedSeconds;
      this.state.rconDisplay = firstDefined(serverStatus.rconDisplay, secondsToDisplay(rconElapsedSeconds));
      this.state.rconAvailable = true;
      this.state.rconUpdatedAt = new Date().toISOString();
    }

    this.syncFromRoundState(this.modules?.roundState?.getState?.() || null, eventBusEvent);
  }

  syncFromMatchState(snapshot, reason) {
    if (!snapshot || typeof snapshot !== "object") {
      return;
    }

    const serverStatus = snapshot.serverStatus && typeof snapshot.serverStatus === "object" ? snapshot.serverStatus : {};
    const match = snapshot.match && typeof snapshot.match === "object" ? snapshot.match : {};
    const players = snapshot.players && typeof snapshot.players === "object" ? snapshot.players : {};

    const map = firstDefined(match.map, serverStatus.map);
    const layer = firstDefined(match.layer, serverStatus.layer);
    const gameMode = firstDefined(match.mode, match.gameMode, serverStatus.mode, serverStatus.gameMode);

    if (!isNilOrEmpty(map)) this.state.map = map;
    if (!isNilOrEmpty(layer)) this.state.layer = layer;
    if (!isNilOrEmpty(gameMode)) this.state.gameMode = gameMode;
    if (!isNilOrEmpty(match.matchId)) this.state.matchId = match.matchId;

    const playerCount = toNumberOrNull(firstDefined(serverStatus.playerCount, players.count));
    const maxPlayers = toNumberOrNull(serverStatus.maxPlayers);
    const queueCount = toNumberOrNull(serverStatus.queueCount);
    const rconElapsedSeconds = toNumberOrNull(firstDefined(serverStatus.playtime, match.playtime));

    if (playerCount != null) this.state.playerCount = playerCount;
    if (maxPlayers != null) this.state.maxPlayers = maxPlayers;
    if (queueCount != null) this.state.queueCount = queueCount;
    if (rconElapsedSeconds != null) {
      this.state.rconElapsedSeconds = rconElapsedSeconds;
      this.state.rconDisplay = secondsToDisplay(rconElapsedSeconds);
      this.state.rconAvailable = true;
      this.state.rconUpdatedAt = new Date().toISOString();
    }

    this.state.serverId = String(snapshot.serverId ?? this.state.serverId ?? this.config.serverId);

    if (reason) {
      this.state.lastMatchStateUpdatedAt = new Date().toISOString();
    }
  }

  syncFromRoundState(snapshot, reason) {
    if (!snapshot || typeof snapshot !== "object") {
      return;
    }

    const current = snapshot.current && typeof snapshot.current === "object" ? snapshot.current : null;
    if (!current) {
      return;
    }

    const map = firstDefined(current.mapName, current.map, parseMapNameFromLayer(current.layerName));
    const layer = firstDefined(current.layerName, current.layer, parseLayerNameFromWorldPath(current.worldPath));
    const gameMode = firstDefined(current.gameMode, parseGameModeFromLayer(layer));

    if (!isNilOrEmpty(map)) this.state.map = map;
    if (!isNilOrEmpty(layer)) this.state.layer = layer;
    if (!isNilOrEmpty(gameMode)) this.state.gameMode = gameMode;
    if (!isNilOrEmpty(current.worldPath)) this.state.worldPath = current.worldPath;

    const startedAtMs = toNumberOrNull(current.logTimeStartedAtMs);
    if (startedAtMs != null) {
      this.state.logStartedAt = new Date(startedAtMs).toISOString();
      this.state.logElapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
      this.state.logDisplay = secondsToDisplay(this.state.logElapsedSeconds);
      this.state.logAvailable = true;
      this.state.logUpdatedAt = new Date().toISOString();
    }

    if (!isNilOrEmpty(current.logLineTime)) {
      this.state.logAvailable = true;
    }

    if (!isNilOrEmpty(current.matchId)) {
      this.state.matchId = current.matchId;
    }

    if (reason) {
      this.state.lastRoundStateUpdatedAt = new Date().toISOString();
    }
  }

  forwardChat(event, eventBusEvent) {
    const payload = event || {};
    
    this.logger.debug(`Forwarding chat event from ${payload.name}`, {
      channel: payload.channel,
      message: payload.message
    });

    this.emitUdp("chat.message", {
      ...payload,
    }, {
      eventBusEvent,
      sourceEventId: payload.seq ? String(payload.seq) : null,
    });
  }

  forwardProcessedCombatEvent(rawEvent, eventBusEvent) {
    if (!this.config.sendCombatEvents) {
      return;
    }

    const record = rawEvent?.record && typeof rawEvent.record === "object"
      ? rawEvent.record
      : null;

    if (!record) {
      return;
    }

    const combatType = String(record.type ?? "").trim().toLowerCase();
    if (!["damage", "wound", "kill", "revive"].includes(combatType)) {
      return;
    }

    const sourceEventId = firstDefined(
      record.raw?.sourceEventId,
      record.sourceEventId,
      record.id,
      rawEvent?.eventId,
    );
    if (this.shouldSuppressDuplicate(sourceEventId, "combat")) {
      return;
    }

    const udpType = combatType === "damage"
      ? "combat.damage"
      : combatType === "wound"
        ? "combat.wound"
        : combatType === "revive"
          ? "combat.revive"
          : "combat.kill";

    const payload = compactObject({
      combatType,
      eventName: record.eventName,

      time: record.time,
      logTime: record.logTime,

      attacker: normalizeProcessedPlayerRef(record.attacker),
      victim: normalizeProcessedPlayerRef(record.victim),

      attackerName: record.attacker?.name ?? null,
      victimName: record.victim?.name ?? null,

      damage: toNumberOrNull(record.damage),

      weapon: {
        raw: record.weapon?.raw ?? null,
        cleaned: record.weapon?.cleaned ?? null,
        displayName: record.weapon?.displayName ?? null,
        category: record.weapon?.category ?? null,
        sourceType: record.weapon?.sourceType ?? null,
      },

      relation: {
        attackerTeamID: record.relation?.attackerTeamID ?? null,
        victimTeamID: record.relation?.victimTeamID ?? null,
        sameTeam: Boolean(record.relation?.sameTeam),
        isFriendlyFire: Boolean(record.relation?.isFriendlyFire),
        friendlyFireType: record.relation?.friendlyFireType ?? "",
        teamSource: record.relation?.teamSource ?? "",
      },

      displayText: record.displayText ?? "",

      raw: this.config.includeRawLog
        ? {
            sourceModule: record.raw?.sourceModule ?? "module.combatClean",
            sourceEventId,
            rawLog: record.raw?.rawLog ?? "",
          }
        : {
            sourceModule: record.raw?.sourceModule ?? "module.combatClean",
            sourceEventId,
          },
    });

    this.state.lastCombatEventAt = new Date().toISOString();
    this.emitUdp(udpType, payload, {
      eventBusEvent,
      sourceEventId,
    });
  }

  forwardMapChanged(rawEvent, eventBusEvent) {
    if (!this.config.sendMapChanged) {
      return;
    }

    const event = normalizeRoundPayload(rawEvent);
    const sourceEventId = firstDefined(event.sourceEventId, rawEvent?.sourceEventId, rawEvent?.eventId, event.eventId);
    if (this.shouldSuppressDuplicate(sourceEventId, "round")) {
      return;
    }

    const rawLine = firstDefined(event.rawLog, event.line, event.message, rawEvent?.rawLog, rawEvent?.line, rawEvent?.message);
    const worldPath = firstDefined(
      event.worldPath,
      event.path,
      rawEvent?.worldPath,
      rawEvent?.path,
      this.extractWorldPathFromRawLine(rawLine),
    );

    const layer = firstDefined(
      event.layerName,
      event.currentLayer,
      event.layer,
      rawEvent?.layerName,
      rawEvent?.currentLayer,
      rawEvent?.layer,
      parseLayerNameFromWorldPath(worldPath),
    );

    const map = firstDefined(
      event.mapName,
      event.currentMap,
      event.map,
      rawEvent?.mapName,
      rawEvent?.currentMap,
      rawEvent?.map,
      parseMapNameFromLayer(layer),
    );

    const gameMode = firstDefined(
      event.gameMode,
      rawEvent?.gameMode,
      parseGameModeFromLayer(layer),
    );

    if (!worldPath && !layer && !map) {
      return;
    }

    const previousMap = this.state.map;
    const previousLayer = this.state.layer;

    if (!isNilOrEmpty(map)) this.state.map = map;
    if (!isNilOrEmpty(layer)) this.state.layer = layer;
    if (!isNilOrEmpty(gameMode)) this.state.gameMode = gameMode;
    if (!isNilOrEmpty(worldPath)) this.state.worldPath = worldPath;

    const startedAt = toIsoOrNull(firstDefined(event.logTimeStartedAtMs, rawEvent?.logTimeStartedAtMs));
    const startedAtValue = startedAt || toIsoOrNull(Date.now());

    if (startedAtValue) {
      this.state.logStartedAt = startedAtValue;
      this.state.logElapsedSeconds = 0;
      this.state.logDisplay = "00:00:00";
      this.state.logAvailable = true;
      this.state.logUpdatedAt = new Date().toISOString();
    }

    this.state.lastMapChangedAt = new Date().toISOString();
    this.state.lastRoundStateUpdatedAt = new Date().toISOString();
    if (event.matchId || rawEvent?.matchId) {
      this.state.matchId = event.matchId || rawEvent.matchId;
    } else if (!this.state.matchId) {
      this.state.matchId = `${this.config.serverId}:${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}:${layer || "unknown_layer"}`;
    }

    // Only forward when the map or layer actually changed to avoid noisy duplicates.
    const mapChanged = previousMap !== this.state.map || previousLayer !== this.state.layer;
    if (!mapChanged) {
      return;
    }

    this.emitUdp("match.map_changed", {
      previousMap,
      previousLayer,
      currentMap: this.state.map,
      currentLayer: this.state.layer,
      gameMode: this.state.gameMode,
      worldPath,
      rawLog: this.config.includeRawLog ? rawLine : undefined,
      logTime: {
        startedAt: this.state.logStartedAt,
        elapsedSeconds: this.state.logElapsedSeconds ?? 0,
        display: this.state.logDisplay ?? "00:00:00",
        available: true,
      },
      rconTime: {
        elapsedSeconds: this.state.rconElapsedSeconds,
        display: this.state.rconDisplay,
        available: this.state.rconAvailable,
      },
    }, {
      eventBusEvent,
      sourceEventId,
    });
  }

  forwardStatus() {
    this.syncFromModules();
    this.recomputeLogTimeFromStartedAt();

    const now = Date.now();
    const out = {
      players: {
        count: this.state.playerCount,
        max: this.state.maxPlayers,
        queue: this.state.queueCount,
      },
      time: {
        rcon: {
          elapsedSeconds: this.state.rconElapsedSeconds,
          display: this.state.rconDisplay,
          available: this.state.rconAvailable,
          updatedAt: this.state.rconUpdatedAt,
        },
        log: {
          elapsedSeconds: this.state.logElapsedSeconds,
          display: this.state.logDisplay,
          available: this.state.logAvailable,
          startedAt: this.state.logStartedAt,
          updatedAt: this.state.logUpdatedAt,
        },
      },
      match: this.buildMatchEnvelope(),
      health: {
        rconFresh: this.state.rconUpdatedAt ? now - new Date(this.state.rconUpdatedAt).getTime() < 15000 : false,
        logFresh: this.state.logUpdatedAt ? now - new Date(this.state.logUpdatedAt).getTime() < 15000 : false,
        roundFresh: this.state.lastRoundStateUpdatedAt ? now - new Date(this.state.lastRoundStateUpdatedAt).getTime() < 15000 : false,
      },
    };

    this.emitUdp("server.status", out, {
      eventBusEvent: "TIMER",
      sourceEventId: null,
    });
  }

  forwardHeartbeat() {
    this.syncFromModules();
    this.emitUdp("forwarder.heartbeat", {
      enabled: this.config.enabled,
      started: this.started,
      target: this.sender.getTarget(),
      sender: this.sender.getStatus(),
    }, {
      eventBusEvent: "TIMER",
      sourceEventId: null,
    });
  }

  recomputeLogTimeFromStartedAt() {
    if (!this.state.logStartedAt) {
      return;
    }

    const started = new Date(this.state.logStartedAt).getTime();
    if (!Number.isFinite(started)) {
      return;
    }

    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
    this.state.logElapsedSeconds = elapsedSeconds;
    this.state.logDisplay = secondsToDisplay(elapsedSeconds);
    this.state.logAvailable = true;
    this.state.logUpdatedAt = new Date().toISOString();
  }

  extractWorldPathFromRawLine(rawLine) {
    if (!rawLine || typeof rawLine !== "string") {
      return null;
    }

    const match = rawLine.match(/LogWorld:\s+Bringing World\s+(\S+)\s+up for play/i);
    return match?.[1] || null;
  }

  shouldSuppressDuplicate(sourceEventId, bucket) {
    if (!sourceEventId) {
      return false;
    }

    const key = `${bucket}:${sourceEventId}`;
    const now = Date.now();

    this.cleanupSeenEventIds(now);
    if (this.seenSourceEventIds.has(key)) {
      return true;
    }

    this.seenSourceEventIds.set(key, now);
    if (this.seenSourceEventIds.size > MAX_SEEN_EVENTS) {
      const oldestKey = this.seenSourceEventIds.keys().next().value;
      if (oldestKey) {
        this.seenSourceEventIds.delete(oldestKey);
      }
    }

    return false;
  }

  cleanupSeenEventIds(now = Date.now()) {
    for (const [key, createdAt] of [...this.seenSourceEventIds.entries()]) {
      if (now - createdAt <= EVENT_TTL_MS) {
        continue;
      }

      this.seenSourceEventIds.delete(key);
    }
  }

  getLogs(filter = {}) {
    const typeFilter = String(filter.type ?? "all").trim();
    const search = normalizeSearch(filter.search ?? filter.q ?? "");
    const limit = clampLimit(filter.limit, 200);
    const offset = clampOffset(filter.offset);

    let logs = [...this.eventLogs];

    if (typeFilter && typeFilter !== "all") {
      logs = logs.filter((log) => log.type === typeFilter);
    }

    if (search) {
      logs = logs.filter((log) => matchesLogSearch(log, search));
    }

    const total = logs.length;
    const page = logs.slice().reverse().slice(offset, offset + limit);

    return {
      logs: page,
      total,
      limit,
      offset,
      type: typeFilter || "all",
      search,
      status: this.getStatus(),
      updatedAt: this.state.lastForwardedAt,
    };
  }

  clearLogs() {
    const cleared = this.eventLogs.length;
    this.eventLogs.splice(0);
    return { ok: true, cleared };
  }
}

export function createUdpEventForwarderService(options) {
  return new UdpEventForwarderService(options);
}

function normalizeSearch(value) {
  return String(value ?? "").trim().toLowerCase();
}

function clampLimit(value, defaultValue) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(5000, Math.max(1, parsed));
}

function clampOffset(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function matchesLogSearch(log, search) {
  if (!search) return true;
  return [
    log.id,
    log.type,
    log.timestamp,
    log.source?.plugin,
    log.source?.eventBusEvent,
    log.source?.sourceEventId,
    log.match?.matchId,
    log.match?.map,
    log.match?.layer,
    log.match?.gameMode,
    JSON.stringify(log.payload ?? {}),
  ].some((value) => normalizeSearch(value).includes(search));
}
