// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

import {
  parseCurrentMap,
  parseListPlayers,
  parseListSquads,
  parseNextMap,
} from "../../core/squad-rcon.js";
import {
  clearTeamFactionMappings,
  rememberTeamFactionMappings,
} from "../../core/team-faction-cache.js";
import { normalizeRoundWorldBringUpPayload } from "../../core/event-normalizer.js";
import { classifySquadName } from "../../domain/squad/squad_name_classifier.js";

/**
 * Module: MatchState
 *
 * Active RCON polling aggregator and event listener for the current match state.
 * This module consolidates round lifecycle events and RCON polling.
 */
export function createMatchStateModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.matchState",
    source: "module.matchState",
    channel: "module",
  }) ?? core.logger;
  const moduleConfig = config.get("modules.matchState", {});
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const polling = {
    serverInfoIntervalMs: Number(moduleConfig.polling?.serverInfoIntervalMs ?? 5000),
    playersIntervalMs: Number(moduleConfig.polling?.playersIntervalMs ?? 3000),
    squadsIntervalMs: Number(moduleConfig.polling?.squadsIntervalMs ?? 5000),
    currentMapIntervalMs: Number(moduleConfig.polling?.currentMapIntervalMs ?? 15000),
    nextMapIntervalMs: Number(moduleConfig.polling?.nextMapIntervalMs ?? 30000),
  };

  const MAX_ROUND_HISTORY = 200;
  const DEFAULT_DEDUPE_TTL_MS = 10 * 60 * 1000;
  const DEFAULT_SESSION_STATE_FILE = "./data/match-state/session.json";
  const LEGACY_SESSION_STATE_FILE = "./data/match-state-session.json";
  const SESSION_STATE_VERSION = 1;
  const roundDedupeTtlMs = normalizePositiveNumber(moduleConfig.roundDedupeTtlMs, DEFAULT_DEDUPE_TTL_MS);
  const roundMaxHistory = normalizePositiveNumber(moduleConfig.roundMaxHistory ?? moduleConfig.maxEvents, MAX_ROUND_HISTORY);
  const sessionStateFile = path.resolve(
    process.cwd(),
    String(moduleConfig.sessionStateFile ?? DEFAULT_SESSION_STATE_FILE).trim() || DEFAULT_SESSION_STATE_FILE,
  );
  const roundRecentKeys = new Map();
  const roundHistory = [];
  const sessionState = {
    loaded: false,
    filePath: sessionStateFile,
    byServerId: new Map(),
    persistedByServerId: new Map(),
    lastPersistedFingerprintByServerId: new Map(),
    announcedSameMatchByServerId: new Map(),
    announcedComparisonByServerId: new Map(),
    awaitingComparisonByServerId: new Map(),
    waitingForServerInfoByServerId: new Map(),
    subscriptionActive: null,
    serverInfoReady: false,
  };

  const timers = [];
  const unsubscribers = [];
  let started = false;
  const running = {
    serverInfo: false,
    players: false,
    squads: false,
    currentMap: false,
    nextMap: false,
  };

  const state = {
    serverId: core.webStatus.serverId,
    updatedAt: "",
    revision: 0,
    serverStatus: {
      map: "",
      layer: "",
      mode: "",
      nextLayer: "",
      nextLayerSource: "",
      playerCount: null,
      playerCountSource: "",
      maxPlayers: null,
      queueCount: null,
      playtime: null,
      tps: null,
      tpsStatus: "unknown",
      raw: "",
      fields: {},
      lastUpdatedAt: "",
    },
    match: {
      map: "",
      layer: "",
      mode: "",
      nextLayer: "",
      playtime: null,
      tickets: {
        team1: null,
        team2: null,
      },
      phase: "unknown", // 预热、进行中、结算中
      lastUpdatedAt: "",
    },
    round: {
      current: null,
      history: [],
      lastAcceptedAt: "",
      lastDedupedAt: "",
    },
    players: makePlayersSnapshot([]),
    squads: {
      list: [],
      count: 0,
      lastUpdatedAt: "",
    },
    rconStatus: {
      lastError: "",
    },
    rconPolling: {
      enabled: false,
      dynamicEnabled: false,
      mode: "disabled",
      playersIntervalMs: polling.playersIntervalMs,
      squadsIntervalMs: polling.squadsIntervalMs,
      fastUntilSeconds: 90,
      mediumUntilSeconds: 180,
      logClockSeconds: 0,
      logClockHasAnchor: false,
      logClockManual: false,
    },
    logAccess: {
      granted: false,
      pythonLogParser: "unknown",
      udpReceiver: "unknown",
      status: "unknown",
      lastUpdatedAt: "",
    },
  };

  const snapshotCache = {
    key: "",
    snapshot: null,
    overviewSnapshot: null,
    overview: null,
  };

  function getSnapshot() {
    const cacheKey = getSnapshotCacheKey();
    if (snapshotCache.key === cacheKey && snapshotCache.snapshot) {
      return snapshotCache.snapshot;
    }

    const snapshot = {
      ...state,
      serverStatus: { ...state.serverStatus, fields: { ...state.serverStatus.fields } },
      match: { ...state.match, tickets: { ...state.match.tickets } },
      round: {
        current: state.round.current ? clone(state.round.current) : null,
        history: state.round.history.map(clone),
        lastAcceptedAt: state.round.lastAcceptedAt,
        lastDedupedAt: state.round.lastDedupedAt,
      },
      players: {
        list: [...state.players.list],
        bySteam64ID: { ...state.players.bySteam64ID },
        byEOSID: { ...state.players.byEOSID },
        byControllerID: { ...state.players.byControllerID },
        byName: { ...state.players.byName },
        count: state.players.count,
        lastUpdatedAt: state.players.lastUpdatedAt,
      },
      squads: {
        list: [...state.squads.list],
        count: state.squads.count,
        lastUpdatedAt: state.squads.lastUpdatedAt,
      },
      rconStatus: { ...state.rconStatus },
      rconPolling: { ...state.rconPolling },
      logAccess: { ...state.logAccess },
    };

    snapshotCache.key = cacheKey;
    snapshotCache.snapshot = snapshot;
    snapshotCache.overviewSnapshot = null;
    snapshotCache.overview = null;
    return snapshot;
  }

  const api = {
    getState: getSnapshot,

    getOverview(matchState = null) {
      const snapshot = matchState ?? getSnapshot();
      if (snapshotCache.overviewSnapshot === snapshot && snapshotCache.overview) {
        return snapshotCache.overview;
      }

      const overview = {
        status: core.webStatus.getSnapshot(),
        matchState: snapshot,
        serverStatus: snapshot.serverStatus,
        match: snapshot.match,
        players: snapshot.players.list,
        squads: snapshot.squads.list,
        round: snapshot.round,
        rconStatus: snapshot.rconStatus,
        rconPolling: snapshot.rconPolling,
        logAccess: snapshot.logAccess,
      };

      if (snapshotCache.snapshot === snapshot) {
        snapshotCache.overviewSnapshot = snapshot;
        snapshotCache.overview = overview;
      }

      return overview;
    },

    getRoundState() {
      const snapshot = getSnapshot();
      return {
        serverId: state.serverId,
        updatedAt: state.updatedAt,
        ...snapshot.round,
      };
    },

    getRoundOverview() {
      const roundState = api.getRoundState();
      return {
        status: core.webStatus.getSnapshot(),
        roundState,
        latest: roundState.history.slice(-20).reverse(),
      };
    },

    async refresh(type = "all") {
      const report = {
        ok: true,
        errors: [],
      };

      if (type === "serverInfo" || type === "all") await refreshServerInfo(report);
      if (type === "players" || type === "all") await refreshPlayers(report);
      if (type === "squads" || type === "all") await refreshSquads(report);
      if (type === "currentMap" || type === "all") await refreshCurrentMap(report);
      if (type === "nextMap" || type === "all") await refreshNextMap(report);
      const snapshot = getSnapshot();
      return {
        ok: report.ok,
        type,
        matchState: snapshot,
        overview: api.getOverview(snapshot),
        errors: report.errors,
      };
    },
  };

  // MatchState 的实时能力来自轮询与状态广播。
  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.("module.matchState") !== false
      && core.pluginSubscriptions?.isSubscribed?.("module.matchState") !== false;
  }

  function ingestWorldBringUp(event) {
    if (!enabled || !isSubscribed()) return null;

    const parsed = event?.normalized?.roundWorldBringUp
      ? { ...event.normalized.roundWorldBringUp }
      : normalizeRoundWorldBringUpPayload(event);
    if (!parsed?.worldPath || !parsed?.logLineTime || !parsed?.serverPlayAt) {
      return null;
    }

    const serverId = String(parsed.serverId ?? event?.serverId ?? core.webStatus.serverId ?? "").trim();
    if (!serverId) return null;

    const dedupeKey = [
      serverId,
      String(parsed.logLineTime ?? "").trim(),
      String(parsed.worldPath ?? "").trim(),
      String(parsed.serverPlayAt ?? "").trim(),
    ].join(":");

    cleanupRoundRecentKeys();
    if (roundRecentKeys.has(dedupeKey)) {
      state.round.lastDedupedAt = new Date().toISOString();
      return null;
    }
    roundRecentKeys.set(dedupeKey, Date.now());

    const record = {
      ...parsed,
      serverId,
      dedupeKey,
      sourceEventId: String(event?.eventId ?? ""),
      receivedAt: new Date().toISOString(),
      rawLog: String(event?.rawLog ?? parsed.rawLog ?? ""),
    };

    state.serverId = serverId;
    state.round.current = clone(record);
    roundHistory.push(clone(record));
    if (roundHistory.length > roundMaxHistory) {
      roundHistory.splice(0, roundHistory.length - roundMaxHistory);
    }
    state.round.history = roundHistory.map(clone);
    state.round.lastAcceptedAt = record.receivedAt;
    state.updatedAt = record.receivedAt;

    // Reset tickets and phase on world bring up (new round)
    state.match.tickets = { team1: null, team2: null };
    state.match.phase = "warmup"; // 通常刚开始是预热

    updateWebStatus();

    clearTeamFactionMappings(serverId);

    // Immediately trigger squad refresh on round start to fetch faction names mapping
    void refreshSquads().catch((error) => {
      moduleLogger.warn(`[MatchState] failed to refresh squads on world bring up: ${error?.message ?? error}`);
    });

    const currentLayer = String(
      record.layerName
      || state.serverStatus.layer
      || state.match.layer
      || "unknown",
    ).trim() || "unknown";
    moduleLogger.info(`/xm 对局开始 图层=${currentLayer}`, {
      operation: "matchStart",
      data: {
        serverId,
        layer: currentLayer,
        mapName: record.mapName || "",
      },
    });

    const payload = {
      eventName: "module.matchState.roundUpdated",
      layer: "module",
      source: "module.matchState",
      serverId,
      time: record.receivedAt,
      record: clone(record),
      roundState: api.getRoundState(),
    };

    core.eventBus.emitModuleEvent("module.matchState", "roundUpdated", payload);
    // Emit legacy event for compatibility if needed
    core.eventBus.emitModuleEvent("module.roundState", "updated", {
      ...payload,
      eventName: "module.roundState.updated",
      source: "module.roundState",
      state: api.getRoundState(),
    });

    moduleLogger.info(
      `[MATCH] Round World bring up detected: ${record.layerName} map=${record.mapName || "unknown"}`,
      {
        operation: "ingestWorldBringUp",
        data: { serverId, layerName: record.layerName, mapName: record.mapName },
      },
    );
    maybeAnnounceRestoredSameMatch("roundWorldBringUp");

    return record;
  }

  function cleanupRoundRecentKeys() {
    const now = Date.now();
    for (const [key, createdAt] of [...roundRecentKeys.entries()]) {
      if (now - Number(createdAt ?? now) <= roundDedupeTtlMs) continue;
      roundRecentKeys.delete(key);
    }
  }

  async function refreshServerInfo(report = null) {
    return guarded("serverInfo", async () => {
      const result = await executeRcon("ShowServerInfo");
      if (!result.success) {
        noteRefreshFailure(report, "serverInfo", result.message || "ShowServerInfo failed.");
        sessionState.serverInfoReady = false;
        updateStatuses();
        emitRconStatusUpdated();
        return state.serverStatus;
      }

      const parsed = parseShowServerInfo(result.rconResponse);
      const next = mergeServerStatus(state.serverStatus, parsed, result.rconResponse);

      if (!next.map || !next.layer) {
        const currentMap = await fetchCurrentMap();
        next.map = next.map || currentMap.level || "";
        next.layer = next.layer || currentMap.layer || "";
      }

      state.serverStatus = next;
      syncMatchFromServerStatus();
      updateWebStatus();
      sessionState.serverInfoReady = true;
      logWithFallback(moduleLogger, "debug", () => "Server info refreshed.", {
        operation: "refreshServerInfo",
        data: {
          map: next.map,
          layer: next.layer,
          playerCount: next.playerCount,
          tps: next.tps,
        },
      });
      emitServerStatusUpdated();
      emitUpdated("serverStatus");
      maybeAnnounceRestoredSameMatch("refreshServerInfo");
      await persistMatchSessionState();
      return state.serverStatus;
    }, () => state.serverStatus, report);
  }

  async function refreshPlayers(report = null) {
    return guarded("players", async () => {
      const result = await executeRcon("ListPlayers");
      if (!result.success) {
        noteRefreshFailure(report, "players", result.message || "ListPlayers failed.");
        updateStatuses();
        emitRconStatusUpdated();
        return state.players.list;
      }

      const players = parseListPlayers(result.rconResponse);
      const event = makeEvent("RCON_LIST_PLAYERS_UPDATED", { players });
      logWithFallback(moduleLogger, "debug", () => `Players refreshed (${players.length})`, {
        operation: "refreshPlayers",
        data: {
          players: players.length,
        },
      });
      core.eventBus.emitCoreEvent("RCON_LIST_PLAYERS_UPDATED", event);
      if (!started) applyPlayersUpdatedEvent(event);
      return players;
    }, () => state.players.list, report);
  }

  function applyPlayersUpdatedEvent(event = {}) {
    if (!enabled || !isSubscribed()) return;

    const players = Array.isArray(event.players) ? event.players : [];
    const serverId = String(event.serverId ?? state.serverId ?? core.webStatus.serverId ?? "").trim();
    if (serverId) state.serverId = serverId;

    if (!state.serverStatus.playerCountSource || state.serverStatus.playerCountSource !== "serverInfo") {
      state.serverStatus.playerCount = players.length;
      state.serverStatus.playerCountSource = "listPlayers";
    }
    syncMatchFromServerStatus();
    updateWebStatus();

    const enrichedPlayers = enrichPlayersWithMatchPresence(state.serverId, players);
    state.players = makePlayersSnapshot(enrichedPlayers);

    emitPlayersUpdated();
    emitUpdated("players");
  }

  function enrichPlayersWithMatchPresence(serverId, players) {
    const list = Array.isArray(players) ? players : [];
    const getPlayer = modules?.matchPlayerPresence?.getPlayer;
    const findPlayerState = modules?.playerState?.findPlayer;
    const getPlayerStats = modules?.networkStats?.getPlayerStats;
    if (
      typeof getPlayer !== "function" &&
      typeof findPlayerState !== "function" &&
      typeof getPlayerStats !== "function"
    ) {
      return list;
    }

    const serverKey = String(serverId ?? core.webStatus.serverId ?? "").trim();
    return list.map((player) => {
      const presence = typeof getPlayer === "function" ? getPlayer(player, serverKey) : null;
      const playerState = typeof findPlayerState === "function" ? findPlayerState(serverKey, player) : null;
      const netStats = typeof getPlayerStats === "function" && player.steamID ? getPlayerStats(player.steamID) : null;
      if (!presence && !playerState && !netStats) return player;

      return {
        ...player,
        ...(playerState ? {
          squadlessSince: String(playerState.squadlessSince ?? ""),
          squadlessSeconds: Number(playerState.squadlessSeconds ?? 0),
          firstSeenAt: String(playerState.firstSeenAt ?? ""),
          lastSquadChangeAt: String(playerState.lastSquadChangeAt ?? ""),
          squadJoinedAt: String(playerState.squadJoinedAt ?? ""),
          squadLeftAt: String(playerState.squadLeftAt ?? ""),
          lastSeenTime: String(playerState.lastSeenTime ?? ""),
          state: String(playerState.state ?? ""),
        } : {}),
        ...(presence ? {
          matchOnlineSeconds: Math.floor(Number(presence.matchOnlineMs ?? 0) / 1000),
          matchObservedOnlineSeconds: Number(presence.matchObservedOnlineSeconds ?? 0),
          matchEstimatedOnlineSeconds: Number(presence.matchEstimatedOnlineSeconds ?? 0),
          matchFirstSeenAt: String(presence.matchFirstSeenAt ?? ""),
          matchLastSeenAt: String(presence.matchLastSeenAt ?? ""),
          matchJoinCount: Number(presence.matchJoinCount ?? 0),
        } : {}),
        ...(netStats ? {
          ping: netStats.ping,
          packetLoss: netStats.packetLoss,
        } : {}),
      };
    });
  }

  async function refreshSquads(report = null) {
    return guarded("squads", async () => {
      const result = await executeRcon("ListSquads");
      if (!result.success) {
        noteRefreshFailure(report, "squads", result.message || "ListSquads failed.");
        updateStatuses();
        emitRconStatusUpdated();
        return state.squads.list;
      }

      const squads = parseListSquads(result.rconResponse);
      logWithFallback(moduleLogger, "debug", () => `Squads refreshed (${squads.length})`, {
        operation: "refreshSquads",
        data: {
          squads: squads.length,
        },
      });

      const event = makeEvent("RCON_LIST_SQUADS_UPDATED", { squads });
      core.eventBus.emitCoreEvent("RCON_LIST_SQUADS_UPDATED", event);
      if (!started) applySquadsUpdatedEvent(event);
      return squads;
    }, () => state.squads.list, report);
  }

  function applySquadsUpdatedEvent(event = {}) {
    if (!enabled || !isSubscribed()) return;

    const squads = Array.isArray(event.squads) ? event.squads : [];
    const serverId = String(event.serverId ?? state.serverId ?? core.webStatus.serverId ?? "").trim();
    if (serverId) state.serverId = serverId;

    const classifiedSquads = squads.map(classifySquad);
    rememberTeamFactionMappings(serverId, classifiedSquads);
    state.squads = {
      list: classifiedSquads,
      count: classifiedSquads.length,
      lastUpdatedAt: new Date().toISOString(),
    };
    maybeSetCurrentMatchIdentity("squadsUpdated");
    updateWebStatus();
    emitSquadsUpdated();
    emitUpdated("squads");
    maybeAnnounceRestoredSameMatch("squadsUpdated");
  }

  function classifySquad(squad) {
    const classification = classifySquadName(squad?.squadName ?? squad?.name ?? "");
    return {
      ...squad,
      squadNature: classification.nature,
      squadNatureLabel: classification.label,
      squadNatureReason: classification.reason,
      squadNatureRule: classification.matchedRule,
      squadNatureConfidence: classification.confidence,
      squadNatureNormalizedName: classification.normalizedName,
      squadVehicleClass: classification.vehicleClass,
      squadVehicleClassLabel: classification.vehicleClassLabel,
      squadVehicleClassReason: classification.vehicleClassReason,
      squadVehicleClassRule: classification.vehicleClassRule,
      squadVehicleClassConfidence: classification.vehicleClassConfidence,
    };
  }

  async function refreshCurrentMap(report = null) {
    return guarded("currentMap", async () => {
      const currentMap = await fetchCurrentMap();
      if (currentMap.level || currentMap.layer) {
        state.serverStatus.map = currentMap.level || state.serverStatus.map || "";
        state.serverStatus.layer = currentMap.layer || state.serverStatus.layer || "";
        state.serverStatus.lastUpdatedAt = new Date().toISOString();
        syncMatchFromServerStatus();
        maybeSetCurrentMatchIdentity("currentMap");
        updateWebStatus();
        emitServerStatusUpdated();
        emitUpdated("currentMap");
        maybeAnnounceRestoredSameMatch("currentMap");
      }
      return currentMap;
    }, () => ({
      level: state.serverStatus.map || null,
      layer: state.serverStatus.layer || null,
    }), report);
  }

  async function refreshNextMap(report = null) {
    return guarded("nextMap", async () => {
      if (state.serverStatus.nextLayerSource === "serverInfo") return null;

      const result = await executeRcon("ShowNextMap");
      if (!result.success) {
        noteRefreshFailure(report, "nextMap", result.message || "ShowNextMap failed.");
        updateStatuses();
        emitRconStatusUpdated();
        return {
          level: null,
          layer: state.serverStatus.nextLayer || null,
        };
      }

      const nextMap = parseNextMap(result.rconResponse);
      if (nextMap.layer && !isSameLayer(nextMap.layer, state.serverStatus.layer || state.match.layer || state.serverStatus.map)) {
        state.serverStatus.nextLayer = nextMap.layer;
        state.serverStatus.nextLayerSource = "showNextMap";
        state.serverStatus.lastUpdatedAt = new Date().toISOString();
        syncMatchFromServerStatus();
        maybeSetCurrentMatchIdentity("nextMap");
        updateWebStatus();
        emitServerStatusUpdated();
        emitUpdated("nextMap");
      }
      return nextMap;
    }, () => ({
      level: null,
      layer: state.serverStatus.nextLayer || null,
    }), report);
  }

  async function fetchCurrentMap() {
    const result = await executeRcon("ShowCurrentMap");
    if (!result.success) return { level: null, layer: null };
    return parseCurrentMap(result.rconResponse);
  }

  async function executeRcon(command) {
    return core.rconManager.dispatchCommand({
      command,
      requestedBy: "module.matchState",
      reason: "match-state-poll",
      system: true,
    });
  }

  async function guarded(key, fn, fallback = null, report = null) {
    const subscribed = isSubscribed();
    if (sessionState.subscriptionActive == null) {
      sessionState.subscriptionActive = subscribed;
    } else if (sessionState.subscriptionActive !== subscribed) {
      await handleSubscriptionTransition(subscribed);
    }

    if (!subscribed) {
      noteRefreshFailure(report, key, "Match state module is not subscribed.");
      return typeof fallback === "function" ? fallback() : fallback;
    }
    if (running[key]) return typeof fallback === "function" ? fallback() : fallback;
    running[key] = true;
    try {
      updateStatuses();
      return await fn();
    } catch (error) {
      noteRefreshFailure(report, key, error?.message ?? String(error));
      logWithFallback(moduleLogger, "warn", `${key} polling failed: ${error.message}`, {
        operation: "guarded",
      });
      updateStatuses();
      emitRconStatusUpdated();
      return typeof fallback === "function" ? fallback() : fallback;
    } finally {
      running[key] = false;
    }
  }

  async function handleSubscriptionTransition(subscribed) {
    const previous = sessionState.subscriptionActive;
    sessionState.subscriptionActive = subscribed;

    if (previous === true && subscribed === false) {
      await persistMatchSessionState({ promoteComparisonState: true });
      sessionState.announcedSameMatchByServerId.clear();
      sessionState.announcedComparisonByServerId.clear();
      sessionState.awaitingComparisonByServerId.clear();
      sessionState.waitingForServerInfoByServerId.clear();
      logWithFallback(moduleLogger, "info", "[MatchState] 订阅已关闭，已保存上一局对局指纹", {
        operation: "matchState.subscriptionDisabled",
        data: {
          filePath: sessionState.filePath,
          serverId: normalizeText(state.serverId || core.webStatus.serverId || ""),
        },
      });
      return;
    }

    if (previous === false && subscribed === true) {
      logWithFallback(moduleLogger, "info", "[MatchState] 订阅已重新开启，正在比对当前对局", {
        operation: "matchState.subscriptionEnabled",
        data: {
          filePath: sessionState.filePath,
          serverId: normalizeText(state.serverId || core.webStatus.serverId || ""),
        },
      });
      maybeAnnounceRestoredSameMatch("subscriptionEnabled");
    }
  }

  function noteRefreshFailure(report, section, message) {
    if (!report) return;
    report.ok = false;
    report.errors.push({
      section,
      message: String(message ?? "Refresh failed."),
    });
  }

  function syncMatchFromServerStatus() {
    state.match.map = state.serverStatus.map || "";
    state.match.layer = state.serverStatus.layer || "";
    state.match.mode = state.serverStatus.mode || "";
    state.match.nextLayer = state.serverStatus.nextLayer || "";
    state.match.playtime = state.serverStatus.playtime;
    state.match.lastUpdatedAt = state.serverStatus.lastUpdatedAt;

    // Phase inference based on playtime and events
    if (state.match.playtime === 0) {
      state.match.phase = "warmup";
    } else if (state.match.playtime > 0) {
      if (state.match.phase === "warmup" || state.match.phase === "unknown") {
        state.match.phase = "in_progress";
      }
    }
    maybeSetCurrentMatchIdentity("serverStatus");
  }

  function getSnapshotCacheKey() {
    const webStatusUpdatedAt = String(core.webStatus?.state?.updatedAt ?? core.webStatus?.getSnapshot?.()?.updatedAt ?? "");
    return [
      state.revision,
      state.serverId,
      state.updatedAt,
      state.serverStatus.lastUpdatedAt,
      state.players.lastUpdatedAt,
      state.squads.lastUpdatedAt,
      state.match.lastUpdatedAt,
      state.round.lastAcceptedAt,
      state.round.lastDedupedAt,
      state.rconStatus.lastUpdatedAt,
      state.rconPolling.lastUpdatedAt,
      state.logAccess.lastUpdatedAt,
      webStatusUpdatedAt,
    ].join("|");
  }

  function updateStatuses() {
    const webSnapshot = core.webStatus.getSnapshot();
    const rconStatus = core.rconManager.getStatus();
    const logAccessGranted = webSnapshot.pythonLogParser === "running" || webSnapshot.udpReceiver === "listening";

    state.rconStatus = {
      ...rconStatus,
      status: rconStatus.connected ? "connected" : (rconStatus.enabled ? "disconnected" : "disabled"),
      lastUpdatedAt: new Date().toISOString(),
    };
    state.rconPolling = {
      ...(rconStatus.polling ?? state.rconPolling),
      lastUpdatedAt: new Date().toISOString(),
    };

    state.logAccess = {
      granted: logAccessGranted,
      pythonLogParser: webSnapshot.pythonLogParser ?? "unknown",
      udpReceiver: webSnapshot.udpReceiver ?? "unknown",
      status: logAccessGranted ? "granted" : "missing",
      lastUpdatedAt: new Date().toISOString(),
    };

    state.revision += 1;
  }

  function updateWebStatus() {
    updateStatuses();

    core.webStatus.patch({
      map: state.serverStatus.map || "",
      layer: state.serverStatus.layer || "",
      mode: state.serverStatus.mode || "",
      nextLayer: state.serverStatus.nextLayer || "",
      playerCount: Number(state.serverStatus.playerCount ?? state.players.count ?? 0),
      maxPlayers: state.serverStatus.maxPlayers,
      queueCount: state.serverStatus.queueCount ?? 0,
      tps: state.serverStatus.tps ?? core.webStatus.getSnapshot?.()?.tps ?? core.webStatus.state?.tps,
      tpsStatus: state.serverStatus.tpsStatus,
      playtime: state.serverStatus.playtime,
      rconStatus: state.rconStatus.status,
      rconPolling: { ...state.rconPolling },
      logAccessGranted: state.logAccess.granted,
      squadCount: state.squads.count,
      currentLayer: state.serverStatus.layer || "",
      matchState: formatMatchStateLabel(state.match),
      matchPhase: state.match.phase,
    });
  }

  function emitUpdated(changed) {
    state.updatedAt = new Date().toISOString();
    state.revision += 1;
    updateStatuses();

    const event = makeEvent("module.matchState.updated", {
      changed,
      matchState: getSnapshot(),
      serverStatus: { ...state.serverStatus },
      match: { ...state.match },
      players: state.players.list,
      squads: state.squads.list,
      rconStatus: { ...state.rconStatus },
      logAccess: { ...state.logAccess },
    });

    core.eventBus.emitModuleEvent("module.matchState", "updated", event);
    core.eventBus.emitCoreEvent("RCON_MATCH_STATE_UPDATED", {
      ...event,
      eventName: "RCON_MATCH_STATE_UPDATED",
      layer: "core",
      source: "module.matchState",
    });
  }

  function emitServerStatusUpdated() {
    core.eventBus.emitModuleEvent("module.matchState", "serverStatusUpdated", makeEvent("module.matchState.serverStatusUpdated", {
      serverStatus: { ...state.serverStatus },
      match: { ...state.match },
    }));
  }

  function emitPlayersUpdated() {
    core.eventBus.emitModuleEvent("module.matchState", "playersUpdated", makeEvent("module.matchState.playersUpdated", {
      players: state.players.list,
      indexes: {
        bySteam64ID: { ...state.players.bySteam64ID },
        byEOSID: { ...state.players.byEOSID },
        byControllerID: { ...state.players.byControllerID },
        byName: { ...state.players.byName },
      },
    }));
  }

  function emitSquadsUpdated() {
    core.eventBus.emitModuleEvent("module.matchState", "squadsUpdated", makeEvent("module.matchState.squadsUpdated", {
      squads: state.squads.list,
    }));
  }

  function emitRconStatusUpdated() {
    core.eventBus.emitModuleEvent("module.matchState", "rconStatusUpdated", makeEvent("module.matchState.rconStatusUpdated", {
      rconStatus: { ...state.rconStatus },
    }));
  }

  function makeEvent(eventName, patch = {}) {
    return {
      eventId: `${eventName}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
      eventName,
      layer: eventName.startsWith("module.") ? "module" : "core",
      source: "module.matchState",
      serverId: state.serverId,
      time: new Date().toISOString(),
      params: [],
      ...patch,
    };
  }

  function startTimer(fn, intervalMs) {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;
    timers.push(setInterval(() => {
      fn().catch((error) => logWithFallback(moduleLogger, "warn", `timer failed: ${error.message}`, {
        operation: "timer",
      }));
    }, intervalMs));
  }

  async function loadMatchSessionState() {
    if (sessionState.loaded) return;
    sessionState.loaded = true;
    sessionState.byServerId.clear();

    try {
      const text = await fs.readFile(sessionState.filePath, "utf8");
      const parsed = JSON.parse(text);
      const rawServers = parsed?.servers && typeof parsed.servers === "object"
        ? parsed.servers
        : parsed;

      if (rawServers && typeof rawServers === "object" && !Array.isArray(rawServers)) {
        for (const [serverId, value] of Object.entries(rawServers)) {
          const normalizedServerId = normalizeText(serverId);
          const record = normalizeMatchSessionRecord(value);
          if (!normalizedServerId || !record) continue;
          sessionState.byServerId.set(normalizedServerId, record);
          sessionState.persistedByServerId.set(normalizedServerId, { ...record });
          sessionState.lastPersistedFingerprintByServerId.set(
            normalizedServerId,
            record.fingerprint || record.fullKey || record.baseKey || "",
          );
        }
      }

      if (sessionState.byServerId.size > 0) {
        logWithFallback(moduleLogger, "info", "[MatchState] session state loaded", {
          operation: "matchState.sessionStateLoaded",
          data: {
            filePath: sessionState.filePath,
            servers: [...sessionState.byServerId.keys()],
          },
        });
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        logWithFallback(moduleLogger, "warn", "[MatchState] session state read failed", {
          operation: "matchState.sessionStateReadFailed",
          data: {
            filePath: sessionState.filePath,
            message: String(error?.message ?? error),
          },
        });
      }
      sessionState.byServerId.clear();
    }
  }

  async function persistMatchSessionState(options = {}) {
    const promoteComparisonState = options?.promoteComparisonState === true;
    const currentFingerprint = buildCurrentMatchFingerprint();
    const serverId = normalizeText(state.serverId || core.webStatus.serverId || "");
    if (serverId && currentFingerprint) {
      const currentFingerprintKey = currentFingerprint.fingerprint || currentFingerprint.fullKey || currentFingerprint.baseKey || "";
      const lastPersistedFingerprint = sessionState.lastPersistedFingerprintByServerId.get(serverId) ?? "";
      if (lastPersistedFingerprint === currentFingerprintKey && sessionState.persistedByServerId.has(serverId)) {
        if (promoteComparisonState) {
          const persistedRecord = sessionState.persistedByServerId.get(serverId);
          if (persistedRecord) {
            sessionState.byServerId.set(serverId, { ...persistedRecord });
          }
        }
        return;
      }
      const record = {
        sessionId: buildMatchSessionId(serverId, currentFingerprint),
        closedAt: new Date().toISOString(),
        ...currentFingerprint,
      };
      sessionState.persistedByServerId.set(serverId, record);
      sessionState.lastPersistedFingerprintByServerId.set(serverId, currentFingerprintKey);
      if (promoteComparisonState) {
        sessionState.byServerId.set(serverId, { ...record });
      }
    }

    if (sessionState.persistedByServerId.size === 0) return;

    const payload = {
      version: SESSION_STATE_VERSION,
      servers: Object.fromEntries(
        [...sessionState.persistedByServerId.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => [key, { ...value }]),
      ),
    };

    try {
      await fs.mkdir(path.dirname(sessionState.filePath), { recursive: true });
      const tempFile = `${sessionState.filePath}.${process.pid}.${Date.now()}.tmp`;
      try {
        await fs.writeFile(tempFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
        await fs.rename(tempFile, sessionState.filePath);
      } finally {
        await fs.rm(tempFile, { force: true }).catch(() => {});
      }
    } catch (error) {
      logWithFallback(moduleLogger, "warn", "[MatchState] session state write failed", {
        operation: "matchState.sessionStateWriteFailed",
        data: {
          filePath: sessionState.filePath,
          message: String(error?.message ?? error),
        },
      });
    }
  }

  function maybeAnnounceRestoredSameMatch(trigger = "") {
    const serverId = normalizeText(state.serverId || core.webStatus.serverId || "");
    if (!serverId) return false;

    const previous = sessionState.byServerId.get(serverId);
    if (!previous) return false;

    if (!sessionState.serverInfoReady) {
      const waitingKey = `serverInfo:${previous.sessionId || serverId}`;
      const announcedWaiting = sessionState.waitingForServerInfoByServerId.get(serverId) ?? "";
      if (announcedWaiting !== waitingKey) {
        sessionState.waitingForServerInfoByServerId.set(serverId, waitingKey);
        logWithFallback(moduleLogger, "info", "[MatchState] 当前对局信息不足，等待 ShowServerInfo 返回后再比对", {
          operation: "matchState.waitingForServerInfo",
          data: {
            trigger,
            serverId,
            sessionId: String(previous.sessionId ?? ""),
            previousClosedAt: String(previous.closedAt ?? ""),
          },
        });
      }
      return false;
    }

    const current = buildCurrentMatchFingerprint();
    if (!current) {
      const waitingKey = `waiting:${String(previous.sessionId ?? previous.baseKey ?? serverId)}`;
      const announcedWaiting = sessionState.awaitingComparisonByServerId.get(serverId) ?? "";
      if (announcedWaiting !== waitingKey) {
        sessionState.awaitingComparisonByServerId.set(serverId, waitingKey);
        logWithFallback(moduleLogger, "info", "[MatchState] 当前对局信息不足，暂不比对", {
          operation: "matchState.waitingForCurrentMatch",
          data: {
            trigger,
            serverId,
            sessionId: String(previous.sessionId ?? ""),
            previousClosedAt: String(previous.closedAt ?? ""),
            previousFingerprint: previous,
          },
        });
      }
      return false;
    }

    const currentComparisonKey = current.fullKey || current.baseKey;
    const previousSessionId = String(previous.sessionId ?? "").trim();
    const announcedComparison = sessionState.announcedComparisonByServerId.get(serverId) ?? "";
    const sameKey = `same:${previousSessionId || currentComparisonKey}`;
    const differentKey = `different:${previousSessionId || currentComparisonKey}`;
    if (announcedComparison === sameKey) return true;
    if (announcedComparison === differentKey) return false;
    sessionState.awaitingComparisonByServerId.delete(serverId);

    if (!isSameMatchFingerprint(current, previous)) {
      sessionState.announcedComparisonByServerId.set(serverId, differentKey);
      sessionState.announcedSameMatchByServerId.delete(serverId);
      logWithFallback(moduleLogger, "info", "/xm 当前对局与上一次关闭的对局不是同一对局", {
        operation: "matchState.differentMatchRestored",
        data: {
          trigger,
          serverId,
          sessionId: previousSessionId || "",
          previousClosedAt: String(previous.closedAt ?? ""),
          currentFingerprint: current,
          previousFingerprint: previous,
        },
      });
      return false;
    }

    sessionState.announcedComparisonByServerId.set(serverId, sameKey);
    sessionState.announcedSameMatchByServerId.set(serverId, previousSessionId || currentComparisonKey);
    logWithFallback(moduleLogger, "info", "/xm 当前对局与上一次关闭的对局为同一对局", {
      operation: "matchState.sameMatchRestored",
      data: {
        trigger,
        serverId,
        sessionId: previousSessionId || "",
        previousClosedAt: String(previous.closedAt ?? ""),
        currentFingerprint: current,
        previousFingerprint: previous,
      },
      });
    return true;
  }

  function buildCurrentMatchFingerprint() {
    const map = normalizeMatchFingerprintPart(state.serverStatus.map || state.match.map || "");
    const layer = normalizeMatchFingerprintPart(state.serverStatus.layer || state.match.layer || "");
    const mode = normalizeMatchFingerprintPart(state.serverStatus.mode || state.match.mode || "");
    const baseParts = [map, layer, mode].filter(Boolean);
    if (baseParts.length === 0) return null;

    const { team1Name, team2Name } = extractSquadTeamNames(state.squads.list);
    const normalizedTeam1Name = normalizeMatchFingerprintPart(team1Name);
    const normalizedTeam2Name = normalizeMatchFingerprintPart(team2Name);
    const fullParts = [baseParts.join("|"), normalizedTeam1Name, normalizedTeam2Name].filter(Boolean);
    const fullKey = normalizedTeam1Name && normalizedTeam2Name ? fullParts.join("|") : "";
    const baseKey = baseParts.join("|");

    return {
      baseKey,
      fullKey,
      fingerprint: fullKey || baseKey,
      map,
      layer,
      mode,
      team1Name: String(team1Name ?? "").trim(),
      team2Name: String(team2Name ?? "").trim(),
    };
  }

  function isSameMatchFingerprint(current, previous) {
    if (!current?.baseKey || !previous) return false;
    const previousBaseKey = String(previous.baseKey ?? "").trim();
    if (!previousBaseKey) return false;

    const currentFullKey = String(current.fullKey ?? "").trim();
    const previousFullKey = String(previous.fullKey ?? "").trim();
    if (currentFullKey && previousFullKey) {
      return currentFullKey === previousFullKey;
    }

    return current.baseKey === previousBaseKey;
  }

  function normalizeMatchSessionRecord(value) {
    if (!value || typeof value !== "object") return null;
    const baseKey = normalizeText(value.baseKey ?? value.matchKey ?? value.fingerprint ?? "");
    const fullKey = normalizeText(value.fullKey ?? value.matchFullKey ?? "");
    const sessionId = normalizeText(value.sessionId ?? value.id ?? "");
    const closedAt = String(value.closedAt ?? value.lastClosedAt ?? "").trim();

    if (!baseKey && !fullKey && !sessionId) return null;

    return {
      sessionId: sessionId || buildMatchSessionId("unknown", { baseKey, fullKey, fingerprint: fullKey || baseKey }),
      closedAt,
      baseKey,
      fullKey,
      fingerprint: normalizeText(value.fingerprint ?? fullKey ?? baseKey),
      map: String(value.map ?? "").trim(),
      layer: String(value.layer ?? "").trim(),
      mode: String(value.mode ?? "").trim(),
      team1Name: String(value.team1Name ?? "").trim(),
      team2Name: String(value.team2Name ?? "").trim(),
    };
  }

  function extractSquadTeamNames(squads = []) {
    let team1Name = "";
    let team2Name = "";

    for (const squad of Array.isArray(squads) ? squads : []) {
      const teamId = Number(squad?.teamID ?? squad?.teamId ?? NaN);
      const teamName = String(squad?.teamName ?? squad?.factionName ?? "").trim();
      if (!teamName) continue;
      if (teamId === 1 && !team1Name) team1Name = teamName;
      if (teamId === 2 && !team2Name) team2Name = teamName;
      if (team1Name && team2Name) break;
    }

    return { team1Name, team2Name };
  }

  function normalizeMatchFingerprintPart(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function buildMatchSessionId(serverId, fingerprint) {
    return [
      "match-state",
      serverId,
      fingerprint?.fingerprint || fingerprint?.fullKey || fingerprint?.baseKey || "unknown",
      Date.now(),
    ].join(":");
  }

  function enrichPlayersWithMatchPresence(serverId, players) {
    const list = Array.isArray(players) ? players : [];
    const getPlayer = modules?.matchPlayerPresence?.getPlayer;
    const findPlayerState = modules?.playerState?.findPlayer;
    if (typeof getPlayer !== "function" && typeof findPlayerState !== "function") return list;

    const serverKey = String(serverId ?? core.webStatus.serverId ?? "").trim();
    return list.map((player) => {
      const presence = typeof getPlayer === "function" ? getPlayer(player, serverKey) : null;
      const playerState = typeof findPlayerState === "function" ? findPlayerState(serverKey, player) : null;
      if (!presence && !playerState) return player;

      return {
        ...player,
        ...(playerState ? {
          squadlessSince: String(playerState.squadlessSince ?? ""),
          squadlessSeconds: Number(playerState.squadlessSeconds ?? 0),
          firstSeenAt: String(playerState.firstSeenAt ?? ""),
          lastSquadChangeAt: String(playerState.lastSquadChangeAt ?? ""),
          squadJoinedAt: String(playerState.squadJoinedAt ?? ""),
          squadLeftAt: String(playerState.squadLeftAt ?? ""),
          lastSeenTime: String(playerState.lastSeenTime ?? ""),
          state: String(playerState.state ?? ""),
        } : {}),
        ...(presence ? {
          matchOnlineSeconds: Math.floor(Number(presence.matchOnlineMs ?? 0) / 1000),
          matchObservedOnlineSeconds: Number(presence.matchObservedOnlineSeconds ?? 0),
          matchEstimatedOnlineSeconds: Number(presence.matchEstimatedOnlineSeconds ?? 0),
          matchFirstSeenAt: String(presence.matchFirstSeenAt ?? ""),
          matchLastSeenAt: String(presence.matchLastSeenAt ?? ""),
          matchJoinCount: Number(presence.matchJoinCount ?? 0),
        } : {}),
      };
    });
  }

  function maybeSetCurrentMatchIdentity(trigger = "") {
    const matchCache = modules?.matchCache;
    if (typeof matchCache?.setCurrentMatch !== "function") return;
    const identity = buildCurrentMatchIdentity();
    if (!identity) return;
    matchCache.setCurrentMatch({
      ...identity,
      savedAt: new Date().toISOString(),
      trigger,
    }, state.serverId || core.webStatus.serverId || "");
  }

  function buildCurrentMatchIdentity() {
    const map = normalizeMatchFingerprintPart(state.serverStatus.map || state.match.map || "");
    const layer = normalizeMatchFingerprintPart(state.serverStatus.layer || state.match.layer || "");
    const mode = normalizeMatchFingerprintPart(state.serverStatus.mode || state.match.mode || "");
    const baseParts = [map, layer, mode].filter(Boolean);
    if (baseParts.length === 0) return null;

    const { team1Name, team2Name } = extractSquadTeamNames(state.squads.list);
    const normalizedTeam1Name = normalizeMatchFingerprintPart(team1Name);
    const normalizedTeam2Name = normalizeMatchFingerprintPart(team2Name);
    const fullParts = [baseParts.join("|"), normalizedTeam1Name, normalizedTeam2Name].filter(Boolean);
    const fullKey = normalizedTeam1Name && normalizedTeam2Name ? fullParts.join("|") : "";
    const baseKey = baseParts.join("|");

    return {
      serverId: state.serverId || core.webStatus.serverId || "",
      baseKey,
      fullKey,
      fingerprint: fullKey || baseKey,
      map,
      layer,
      mode,
      team1Name: String(team1Name ?? "").trim(),
      team2Name: String(team2Name ?? "").trim(),
      roundAnchor: {
        worldPath: String(state.round.current?.worldPath ?? "").trim(),
        serverPlayAt: String(state.round.current?.serverPlayAt ?? "").trim(),
        logLineTime: String(state.round.current?.logLineTime ?? "").trim(),
      },
      lastObservedPlaytimeSeconds: Number(state.serverStatus.playtime ?? state.match.playtime ?? 0) || 0,
    };
  }

  function maybeAnnounceRestoredSameMatch_legacy(trigger = "") {
    const serverId = normalizeText(state.serverId || core.webStatus.serverId || "");
    if (!serverId) return false;

    const matchCache = modules?.matchCache;
    const cachedMatch = typeof matchCache?.getMatchIdentity === "function"
      ? matchCache.getMatchIdentity(serverId)
      : null;
    if (!cachedMatch) return false;

    const comparison = typeof matchCache?.compareCachedMatch === "function"
      ? matchCache.compareCachedMatch(cachedMatch, serverId)
      : { status: "pending", reason: "cache_unavailable" };

    if (comparison.status === "pending") return false;
    if (comparison.status === "ambiguous") {
      logWithFallback(moduleLogger, "info", "[MatchState] 当前对局信息不足，暂不比对", {
        operation: "matchState.waitingForCurrentMatch",
        data: { trigger, serverId, reason: comparison.reason },
      });
      return false;
    }
    if (comparison.status === "different") {
      logWithFallback(moduleLogger, "info", "/xm 当前对局与上一轮关闭的对局不是同一对局", {
        operation: "matchState.differentMatchRestored",
        data: {
          trigger,
          serverId,
          reason: comparison.reason,
          currentFingerprint: comparison.currentMatch,
          previousFingerprint: comparison.cachedMatch,
        },
      });
      return false;
    }

    logWithFallback(moduleLogger, "info", "/xm 当前对局与上一轮关闭的对局为同一对局", {
      operation: "matchState.sameMatchRestored",
      data: {
        trigger,
        serverId,
        reason: comparison.reason,
        currentFingerprint: comparison.currentMatch,
        previousFingerprint: comparison.cachedMatch,
      },
    });
    return true;
  }

  async function loadMatchSessionState_legacy() {
    if (sessionState.loaded) return;
    sessionState.loaded = true;
    const matchCache = modules?.matchCache;
    if (!matchCache) return;

    const status = typeof matchCache.getStatus === "function"
      ? matchCache.getStatus(state.serverId || core.webStatus.serverId || "")
      : null;
    if (!status?.cachedMatch) return;

    const restored = await matchCache.restoreCurrentMatch(
      status.cachedMatch,
      status.serverId || state.serverId || core.webStatus.serverId || "",
    );
    if (restored) {
      const serverKey = normalizeText(status.serverId || state.serverId || core.webStatus.serverId || "");
      if (serverKey) {
        sessionState.byServerId.set(serverKey, {
          sessionId: restored.sessionId || buildMatchSessionId(serverKey, restored),
          closedAt: restored.closedAt || new Date().toISOString(),
          ...restored,
        });
      }
    }
  }

  async function persistMatchSessionState_legacy(options = {}) {
    const promoteComparisonState = options?.promoteComparisonState === true;
    const cacheCurrentMatch = modules?.matchCache?.getStatus?.(state.serverId || core.webStatus.serverId || "")?.currentMatch ?? null;
    const currentFingerprint = buildCurrentMatchIdentity() ?? cacheCurrentMatch;
    const serverId = normalizeText(state.serverId || core.webStatus.serverId || "");
    if (serverId && currentFingerprint) {
      const currentFingerprintKey = currentFingerprint.fingerprint || currentFingerprint.fullKey || currentFingerprint.baseKey || "";
      const lastPersistedFingerprint = sessionState.lastPersistedFingerprintByServerId.get(serverId) ?? "";
      if (lastPersistedFingerprint === currentFingerprintKey && sessionState.persistedByServerId.has(serverId)) {
        if (promoteComparisonState) {
          const persistedRecord = sessionState.persistedByServerId.get(serverId);
          if (persistedRecord) {
            sessionState.byServerId.set(serverId, { ...persistedRecord });
          }
        }
        return;
      }
      const record = {
        sessionId: buildMatchSessionId(serverId, currentFingerprint),
        closedAt: new Date().toISOString(),
        ...currentFingerprint,
      };
      sessionState.persistedByServerId.set(serverId, record);
      sessionState.lastPersistedFingerprintByServerId.set(serverId, currentFingerprintKey);
      if (promoteComparisonState) {
        sessionState.byServerId.set(serverId, { ...record });
      }
    }

    if (sessionState.persistedByServerId.size === 0) return;

    const payload = {
      version: SESSION_STATE_VERSION,
      servers: Object.fromEntries(
        [...sessionState.persistedByServerId.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => [key, { ...value }]),
      ),
    };

    try {
      await fs.mkdir(path.dirname(sessionState.filePath), { recursive: true });
      const tempFile = `${sessionState.filePath}.${process.pid}.${Date.now()}.tmp`;
      try {
        await fs.writeFile(tempFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
        await fs.rename(tempFile, sessionState.filePath);
      } finally {
        await fs.rm(tempFile, { force: true }).catch(() => {});
      }
    } catch (error) {
      logWithFallback(moduleLogger, "warn", "[MatchState] session state write failed", {
        operation: "matchState.sessionStateWriteFailed",
        data: {
          filePath: sessionState.filePath,
          message: String(error?.message ?? error),
        },
      });
    }

    const matchCache = modules?.matchCache;
    if (matchCache) {
      maybeSetCurrentMatchIdentity("persist");
      await matchCache.flush(state.serverId || core.webStatus.serverId || "", { force: options?.promoteComparisonState === true });
    }
  }

  function normalizeMatchFingerprintPart_legacy(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function extractSquadTeamNames_legacy(squads = []) {
    let team1Name = "";
    let team2Name = "";

    for (const squad of Array.isArray(squads) ? squads : []) {
      const teamId = Number(squad?.teamID ?? squad?.teamId ?? NaN);
      const teamName = String(squad?.teamName ?? squad?.factionName ?? "").trim();
      if (!teamName) continue;
      if (teamId === 1 && !team1Name) team1Name = teamName;
      if (teamId === 2 && !team2Name) team2Name = teamName;
      if (team1Name && team2Name) break;
    }

    return { team1Name, team2Name };
  }

  return {
    manifest: {
      id: "module.matchState",
      name: "Match State Module",
      kind: "module",
      version: "0.3.0",
      description: "对局全局状态聚合模块。合并了 roundState 功能，追踪地图切换、回合开始/结束、票数变化、队伍得分等核心事件。",
    },
    apiName: "matchState",
    api,

    async start() {
      core.webRegistry.registerPage({
        id: "web.matchState",
        title: "对局状态",
        group: "监控",
        route: "/match-state",
        pageModule: "/pages/match-state.js",
        source: "module.matchState",
        required: false,
        enabled: true,
        order: 10,
        icon: "📊",
      });

      if (!enabled) return;
      started = true;
      await migrateLegacySessionStateFileIfNeeded(sessionState.filePath);
      await loadMatchSessionState();
      sessionState.announcedSameMatchByServerId.clear();
      sessionState.announcedComparisonByServerId.clear();
      sessionState.awaitingComparisonByServerId.clear();
      sessionState.waitingForServerInfoByServerId.clear();
      sessionState.serverInfoReady = false;
      sessionState.subscriptionActive = isSubscribed();

      unsubscribers.push(core.eventBus.onCoreEvent("RCON_CONNECTED", () => {
        if (!isSubscribed()) return;
        updateStatuses();
        emitRconStatusUpdated();
        void (async () => {
          await refreshServerInfo();
          await refreshPlayers();
          await refreshSquads();
          await refreshCurrentMap();
          await refreshNextMap();
        })();
      }));
      unsubscribers.push(core.eventBus.onCoreEvent("RCON_DISCONNECTED", () => {
        if (!isSubscribed()) return;
        updateStatuses();
        emitRconStatusUpdated();
      }));
      unsubscribers.push(core.eventBus.onCoreEvent("RCON_ERROR", () => {
        if (!isSubscribed()) return;
        updateStatuses();
        emitRconStatusUpdated();
      }));
      unsubscribers.push(core.eventBus.onCoreEvent("PLUGIN_SUBSCRIPTIONS_UPDATED", async (event) => {
        const targetId = normalizeText(event?.id ?? event?.targetId ?? "");
        if (targetId && targetId !== "module.matchState") return;

        const subscribed = typeof event?.subscribed === "boolean"
          ? event.subscribed
          : isSubscribed();
        await handleSubscriptionTransition(subscribed);
      }));
      unsubscribers.push(core.eventBus.onCoreEvent("RCON_LIST_PLAYERS_UPDATED", applyPlayersUpdatedEvent));
      unsubscribers.push(core.eventBus.onCoreEvent("RCON_LIST_SQUADS_UPDATED", applySquadsUpdatedEvent));

      // Ingest round world bring up
      unsubscribers.push(core.eventBus.onCoreEvent("round.world_bring_up", ingestWorldBringUp));

      // Tickets parsing from chat or other events could be added here
      unsubscribers.push(core.eventBus.onCoreEvent("round.tickets_changed", (event) => {
        if (!event?.normalized?.tickets) return;
        const { team1, team2 } = event.normalized.tickets;
        state.match.tickets.team1 = team1;
        state.match.tickets.team2 = team2;
        state.match.lastUpdatedAt = new Date().toISOString();
        updateWebStatus();
        emitUpdated("tickets");
      }));

      // Round ended
      unsubscribers.push(core.eventBus.onCoreEvent("round.winner_declared", (event) => {
        state.match.phase = "ended";
        logWithFallback(moduleLogger, "info", "/xm 对局结束", {
          operation: "matchState.roundEnded",
          data: {
            serverId: String(event?.serverId ?? state.serverId ?? core.webStatus.serverId ?? "").trim(),
            eventId: String(event?.eventId ?? "").trim(),
            winner: String(event?.normalized?.winner ?? event?.winner ?? "").trim(),
          },
        });
        updateWebStatus();
        emitUpdated("phase");
      }));

      updateWebStatus();
      const initialRconStatus = core.rconManager.getStatus();
      if (initialRconStatus?.connected) {
        await refreshServerInfo();
        await refreshCurrentMap();
        await refreshNextMap();
      }

      startTimer(refreshServerInfo, polling.serverInfoIntervalMs);
      startTimer(refreshCurrentMap, polling.currentMapIntervalMs);
      startTimer(refreshNextMap, polling.nextMapIntervalMs);

      logWithFallback(
        moduleLogger,
        "info",
        `MatchState (Consolidated) started.`,
        {
          label: "MODULE",
          operation: "start",
        },
      );
    },

    async stop() {
      started = false;
      await persistMatchSessionState({ promoteComparisonState: true });
      for (const timer of timers.splice(0)) clearInterval(timer);
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      roundRecentKeys.clear();
      roundHistory.length = 0;
      sessionState.persistedByServerId.clear();
      sessionState.lastPersistedFingerprintByServerId.clear();
      logWithFallback(moduleLogger, "info", "MatchState stopped.", {
        label: "MODULE",
        operation: "stop",
      });
    },
  };

}

async function migrateLegacySessionStateFileIfNeeded(targetFilePath) {
  const defaultRelativePath = "./data/match-state/session.json";
  const legacyRelativePath = "./data/match-state-session.json";
  const normalizedTarget = path.resolve(String(targetFilePath ?? "").trim() || defaultRelativePath);
  const defaultTarget = path.resolve(process.cwd(), defaultRelativePath);
  if (normalizedTarget !== defaultTarget) return;

  const legacyFile = path.resolve(process.cwd(), legacyRelativePath);
  if (legacyFile === normalizedTarget) return;
  if (await pathExists(legacyFile) === false) return;
  if (await pathExists(normalizedTarget)) return;

  await fs.mkdir(path.dirname(normalizedTarget), { recursive: true });
  try {
    await fs.rename(legacyFile, normalizedTarget);
  } catch {
    await fs.copyFile(legacyFile, normalizedTarget);
    await fs.rm(legacyFile, { force: true }).catch(() => {});
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getStableIdentityKey(player = {}) {
  const steamID = String(player?.steamID ?? player?.steam64ID ?? "").trim();
  if (steamID) return `steam:${steamID}`;

  const eosID = String(player?.eosID ?? "").trim();
  if (eosID) return `eos:${eosID}`;

  const controllerID = String(player?.controllerID ?? "").trim();
  if (controllerID) return `controller:${controllerID}`;

  const name = String(player?.name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (name) return `name:${name}`;

  return "";
}

function makePlayersSnapshot(players) {
  const snapshot = {
    list: players,
    bySteam64ID: {},
    byEOSID: {},
    byControllerID: {},
    byName: {},
    count: players.length,
    lastUpdatedAt: new Date().toISOString(),
  };

  for (const player of players) {
    if (player.steamID) snapshot.bySteam64ID[player.steamID] = player;
    if (player.eosID) snapshot.byEOSID[player.eosID] = player;
    if (player.controllerID) snapshot.byControllerID[player.controllerID] = player;
    if (player.name) snapshot.byName[player.name] = player;
  }

  return snapshot;
}

function parseShowServerInfo(raw) {
  const fields = extractServerInfoFields(raw);
  const tps = pickNumber(fields, ["TPS", "ServerTPS", "TickRate", "ServerTickRate"]);
  const derivedPlayers = derivePlayerCounts(raw);
  const layer = pickString(fields, ["Layer_s"]);

  return {
    map: pickString(fields, ["MapName_s"]),
    layer,
    mode: deriveModeFromLayer(layer) || pickString(fields, ["GameMode_s"]),
    nextLayer: pickString(fields, ["NextLayer_s"]),
    playerCount: pickNumber(fields, ["PlayerCount_I", "PlayerCount", "Players"]) ?? derivedPlayers.playerCount,
    maxPlayers: pickNumber(fields, ["MaxPlayers", "MaxPlayers_I", "MaxPlayerCount_I", "MaxPlayerCount"]) ?? derivedPlayers.maxPlayers,
    queueCount: pickNumber(fields, ["Queue_I", "Queue", "PlayerQueue_I", "PlayerQueue", "PublicQueue_I", "PublicQueue", "NumPlayersQueued"]),
    playtime: pickNumber(fields, ["PLAYTIME_I", "PlayTime_I", "Playtime_I", "PlayTime", "Playtime", "ElapsedTime_I", "RoundTime_I", "GameTime_I"]),
    tps,
    tpsStatus: resolveTpsStatus(tps),
    fields,
  };
}

function mergeServerStatus(current, parsed, raw) {
  const next = {
    ...current,
    raw,
    fields: parsed.fields ?? {},
    lastUpdatedAt: new Date().toISOString(),
  };

  assignIfPresent(next, "map", parsed.map);
  assignIfPresent(next, "layer", parsed.layer);
  assignIfPresent(next, "maxPlayers", parsed.maxPlayers);
  assignIfPresent(next, "queueCount", parsed.queueCount);
  assignIfPresent(next, "playtime", parsed.playtime);
  assignIfPresent(next, "tps", parsed.tps);

  const derivedMode = deriveModeFromLayer(next.layer || parsed.layer);
  if (derivedMode) {
    next.mode = derivedMode;
  } else {
    assignIfPresent(next, "mode", parsed.mode);
  }

  if (hasValue(parsed.tpsStatus) && parsed.tpsStatus !== "unknown") {
    next.tpsStatus = parsed.tpsStatus;
  }

  const normalizedNextLayer = normalizeLayerLabel(parsed.nextLayer);
  const normalizedCurrentLayer = normalizeLayerLabel(next.layer || parsed.layer || current.layer);
  const isSameAsCurrentLayer = normalizedNextLayer
    && normalizedCurrentLayer
    && normalizedNextLayer === normalizedCurrentLayer;

  if (hasValue(parsed.nextLayer) && !isSameAsCurrentLayer) {
    next.nextLayer = parsed.nextLayer;
    next.nextLayerSource = "serverInfo";
  } else if (hasValue(parsed.nextLayer) && isSameAsCurrentLayer) {
    next.nextLayer = "";
    next.nextLayerSource = "cached";
  }

  if (hasValue(parsed.playerCount)) {
    next.playerCount = parsed.playerCount;
    next.playerCountSource = "serverInfo";
  }

  return next;
}

function extractServerInfoFields(raw) {
  const fields = {};
  const knownKeys = [
    "MapName_s",
    "Layer_s",
    "GameMode_s",
    "NextLayer_s",
    "PlayerCount_I",
    "PlayerCount",
    "Players",
    "MaxPlayers",
    "MaxPlayers_I",
    "MaxPlayerCount_I",
    "MaxPlayerCount",
    "Queue_I",
    "Queue",
    "PlayerQueue_I",
    "PlayerQueue",
    "PublicQueue_I",
    "PublicQueue",
    "NumPlayersQueued",
    "PLAYTIME_I",
    "PlayTime_I",
    "Playtime_I",
    "PlayTime",
    "Playtime",
    "ElapsedTime_I",
    "RoundTime_I",
    "GameTime_I",
    "TPS",
    "ServerTPS",
    "TickRate",
    "ServerTickRate",
  ];

  const text = String(raw ?? "");
  const jsonFields = parseServerInfoJson(text);
  if (jsonFields) {
    Object.assign(fields, jsonFields);
  }

  for (const key of knownKeys) {
    const match = text.match(new RegExp(`\\b${escapeRegExp(key)}\\b\\s*[:=]\\s*([^\\r\\n,]+)`, "i"));
    if (match) fields[key] = cleanFieldValue(match[1]);
  }

  for (const line of text.split("\n")) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*[:=]\s*(.*?)\s*$/);
    if (!match) continue;
    fields[match[1]] = cleanFieldValue(match[2]);
  }

  return fields;
}

function parseServerInfoJson(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const fields = {};
    for (const [key, value] of Object.entries(parsed)) {
      fields[key] = cleanFieldValue(value);
    }
    return fields;
  } catch {
    return null;
  }
}

function pickString(fields, keys) {
  for (const key of keys) {
    const value = fields[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function pickNumber(fields, keys) {
  for (const key of keys) {
    if (!(key in fields) || fields[key] == null || String(fields[key]).trim() === "") continue;
    const value = firstNumber(fields[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function derivePlayerCounts(raw) {
  const text = String(raw ?? "");
  const slash = text.match(/\b(?:Players?|PlayerCount)\b[^0-9]*(\d+)\s*\/\s*(\d+)/i);
  if (slash) {
    return {
      playerCount: Number(slash[1]),
      maxPlayers: Number(slash[2]),
    };
  }

  const of = text.match(/\b(?:Players?|PlayerCount)\b[^0-9]*(\d+)\s*(?:of|out\s+of)\s*(\d+)/i);
  if (of) {
    return {
      playerCount: Number(of[1]),
      maxPlayers: Number(of[2]),
    };
  }

  return { playerCount: null, maxPlayers: null };
}

function assignIfPresent(target, key, value) {
  if (hasValue(value)) target[key] = value;
}

function hasValue(value) {
  if (value == null) return false;
  if (typeof value === "number") return Number.isFinite(value);
  return String(value).trim() !== "";
}

function normalizeLayerLabel(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isSameLayer(left, right) {
  const leftLabel = normalizeLayerLabel(left);
  const rightLabel = normalizeLayerLabel(right);
  return Boolean(leftLabel && rightLabel && leftLabel === rightLabel);
}

function firstNumber(value) {
  const match = String(value ?? "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function resolveTpsStatus(tps) {
  if (tps == null) return "unknown";
  if (tps < 20) return "critical";
  if (tps < 28) return "warning";
  return "good";
}

function deriveModeFromLayer(layer) {
  const text = String(layer ?? "").trim();
  if (!text) return "";

  const tokens = text.split(/[_\s-]+/).filter(Boolean);
  if (!tokens.length) return "";

  const lastToken = tokens[tokens.length - 1];
  if (/^seed$/i.test(lastToken)) return "seed";

  if (/^(?:v?\d+|pve|pvp)$/i.test(lastToken) && tokens.length > 1) {
    const previous = String(tokens[tokens.length - 2] ?? "").trim();
    if (!previous) return "";
    if (/^seed$/i.test(previous)) return "seed";
    if (/^(?:pve|pvp)$/i.test(previous)) return previous;
    return /^[a-z]+$/i.test(previous) ? previous : "";
  }

  const mode = String(lastToken).trim();
  if (/^seed$/i.test(mode)) return "seed";
  if (/^(?:pve|pvp)$/i.test(mode)) return mode;
  return /^[a-z]+$/i.test(mode) ? mode : "";
}

function cleanFieldValue(value) {
  return String(value ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatMatchStateLabel(match) {
  const parts = [match.map, match.layer, match.mode].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "Unknown";
}

function logWithFallback(logger, method, message, context) {
  const fn = logger?.[method];
  if (typeof fn === "function") {
    fn.call(logger, message, context);
    return;
  }

  const rendered = typeof message === "function" ? message() : message;
  if (method === "warn") {
    logger?.warn?.(rendered);
    return;
  }

  logger?.info?.(rendered);
}

function clone(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.floor(number);
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}
