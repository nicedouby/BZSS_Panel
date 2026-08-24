// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

export const MATCH_LIFECYCLE_STATE = Object.freeze({
  UNKNOWN: "unknown",
  WAITING: "waiting",
  LOADING_MAP: "loading_map",
  MAP_READY: "map_ready",
  LIVE: "live",
  ENDING: "ending",
  FINISHED: "finished",
  NEXT_MATCH: "next_match",
});

const VALID_STATES = new Set(Object.values(MATCH_LIFECYCLE_STATE));
const DEFAULT_STATE_FILE = "./data/match-state/lifecycle.json";
const STATE_FILE_VERSION = 1;

/**
 * Authoritative match lifecycle state machine.
 *
 * module.matchState remains the RCON/roster telemetry aggregator. This module
 * is the single source of truth for lifecycle semantics and deliberately gives
 * strong log events (world bring-up / winner) priority over briefly stale RCON
 * snapshots during map transitions.
 */
export function createMatchLifecycleModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.matchLifecycle",
    source: "module.matchLifecycle",
    channel: "module",
  }) ?? core.logger;
  const moduleConfig = config.get("modules.matchLifecycle", {});
  const enabled = moduleConfig.enabled !== false;
  const historyLimit = positiveInt(moduleConfig.historyLimit, 100);
  const finishSettleMs = nonNegativeInt(moduleConfig.finishSettleMs, 1500);
  const nextMatchDelayMs = nonNegativeInt(moduleConfig.nextMatchDelayMs, 8000);
  const worldIdentityGraceMs = nonNegativeInt(moduleConfig.worldIdentityGraceMs, 12_000);
  const stateFile = path.resolve(
    process.cwd(),
    String(moduleConfig.stateFile ?? DEFAULT_STATE_FILE).trim() || DEFAULT_STATE_FILE,
  );

  const unsubscribers = [];
  const recentEventIds = new Map();
  let started = false;
  let persistTimer = null;
  let finishTimer = null;
  let nextMatchTimer = null;
  let identityLockUntil = 0;
  let writeChain = Promise.resolve();

  const state = {
    state: MATCH_LIFECYCLE_STATE.UNKNOWN,
    previousState: "",
    serverId: text(core.webStatus?.serverId),
    map: "",
    layer: "",
    mode: "",
    nextLayer: "",
    sessionKey: "",
    winner: "",
    startedAt: "",
    endedAt: "",
    stateChangedAt: "",
    updatedAt: new Date().toISOString(),
    source: "startup",
    reason: "not_initialized",
    sourceMode: "live",
    isReplay: false,
    canTriggerActions: false,
    connected: false,
    stale: true,
    playtime: null,
    lastObservedPlaytime: null,
    logWatermarkMs: 0,
    revision: 0,
    history: [],
  };

  const api = {
    getState: () => snapshot(),
    getHistory: () => state.history.map(clone),
    reconcile(reason = "manual") {
      reconcileFromMatchState(reason);
      return snapshot();
    },
  };

  function snapshot() {
    return {
      state: state.state,
      previousState: state.previousState,
      serverId: state.serverId,
      map: state.map,
      layer: state.layer,
      mode: state.mode,
      nextLayer: state.nextLayer,
      sessionKey: state.sessionKey,
      winner: state.winner,
      startedAt: state.startedAt,
      endedAt: state.endedAt,
      stateChangedAt: state.stateChangedAt,
      updatedAt: state.updatedAt,
      source: state.source,
      reason: state.reason,
      sourceMode: state.sourceMode,
      isReplay: state.isReplay,
      canTriggerActions: state.canTriggerActions,
      connected: state.connected,
      stale: state.stale,
      playtime: state.playtime,
      revision: state.revision,
      history: state.history.slice(-20).map(clone),
    };
  }

  function publish({ persist = true, emit = true } = {}) {
    const lifecycle = snapshot();
    core.webStatus?.patch?.({ matchLifecycle: lifecycle });
    if (emit) {
      core.eventBus?.emitModuleEvent?.("module.matchLifecycle", "updated", {
        eventName: "module.matchLifecycle.updated",
        layer: "module",
        source: "module.matchLifecycle",
        serverId: state.serverId,
        time: state.updatedAt,
        lifecycle,
        sourceMode: lifecycle.sourceMode,
        isReplay: lifecycle.isReplay,
        canTriggerActions: lifecycle.canTriggerActions,
      });
    }
    if (persist) schedulePersist();
  }

  function transition(nextState, meta = {}) {
    if (!VALID_STATES.has(nextState)) return false;
    const from = state.state;
    const at = eventIso(meta.at) || new Date().toISOString();
    const stateChanged = from !== nextState;
    const changed = applyMeta(meta);
    if (!stateChanged && !changed) return false;

    if (stateChanged) {
      state.previousState = from;
      state.state = nextState;
      state.stateChangedAt = at;
      state.history.push({
        from,
        to: nextState,
        at,
        source: text(meta.source) || state.source,
        reason: text(meta.reason),
        map: state.map,
        layer: state.layer,
        mode: state.mode,
        sessionKey: state.sessionKey,
        winner: state.winner,
        sourceMode: text(meta.sourceMode) || state.sourceMode,
        isReplay: Boolean(meta.isReplay),
        canTriggerActions: Boolean(meta.canTriggerActions) && !meta.isReplay,
      });
      if (state.history.length > historyLimit) {
        state.history.splice(0, state.history.length - historyLimit);
      }
    }

    finalizeMeta(meta, at);
    if (stateChanged) {
      moduleLogger.info?.(`[MatchLifecycle] ${from} -> ${nextState}`, {
        operation: "matchLifecycle.transition",
        data: {
          from,
          to: nextState,
          source: state.source,
          reason: state.reason,
          map: state.map,
          layer: state.layer,
          winner: state.winner,
          isReplay: state.isReplay,
        },
      });
    }
    publish();
    return true;
  }

  function touch(meta = {}) {
    if (!applyMeta(meta)) return false;
    finalizeMeta(meta, eventIso(meta.at) || new Date().toISOString());
    publish();
    return true;
  }

  function applyMeta(meta = {}) {
    let changed = false;
    for (const key of ["serverId", "map", "layer", "mode", "nextLayer", "sessionKey", "winner"]) {
      if (!(key in meta)) continue;
      const value = text(meta[key]);
      if (state[key] === value) continue;
      state[key] = value;
      changed = true;
    }
    for (const key of ["startedAt", "endedAt"]) {
      if (!(key in meta)) continue;
      const value = eventIso(meta[key]);
      if (state[key] === value) continue;
      state[key] = value;
      changed = true;
    }
    if (typeof meta.connected === "boolean" && state.connected !== meta.connected) {
      state.connected = meta.connected;
      changed = true;
    }
    if (typeof meta.stale === "boolean" && state.stale !== meta.stale) {
      state.stale = meta.stale;
      changed = true;
    }
    if (meta.playtime !== undefined) {
      const value = finiteOrNull(meta.playtime);
      if (state.playtime !== value) {
        state.playtime = value;
        changed = true;
      }
    }
    return changed;
  }

  function finalizeMeta(meta, at) {
    state.updatedAt = at;
    state.source = text(meta.source) || state.source || "unknown";
    state.reason = text(meta.reason) || state.reason;
    state.sourceMode = text(meta.sourceMode) || state.sourceMode || "live";
    state.isReplay = Boolean(meta.isReplay);
    state.canTriggerActions = Boolean(meta.canTriggerActions) && !state.isReplay;
    state.revision += 1;
  }

  function handleWorldBringUp(event = {}) {
    if (!enabled || !acceptLogEvent(event)) return;
    clearLifecycleTimers();

    const payload = event?.normalized?.roundWorldBringUp ?? {};
    const current = readMatchState();
    const at = lifecycleEventIso(event, payload);
    const map = text(payload.mapName) || text(current?.serverStatus?.map);
    const layer = text(payload.layerName) || text(current?.serverStatus?.layer);
    const mode = text(payload.gameMode) || text(current?.serverStatus?.mode);
    const serverId = text(payload.serverId) || text(event.serverId) || state.serverId;

    identityLockUntil = Date.now() + worldIdentityGraceMs;
    transition(MATCH_LIFECYCLE_STATE.MAP_READY, {
      source: "round.world_bring_up",
      reason: state.layer && layer && !same(state.layer, layer) ? "map_switch_completed" : "world_ready",
      at,
      serverId,
      map,
      layer,
      mode,
      sessionKey: sessionKey(serverId, layer, payload.worldPath, payload.logLineTime),
      winner: "",
      startedAt: at,
      endedAt: "",
      connected: connected(current),
      stale: false,
      sourceMode: text(event.sourceMode) || "live",
      isReplay: Boolean(event.isReplay),
      canTriggerActions: Boolean(event.canTriggerActions) && !event.isReplay,
    });

    reconcileFromMatchState("world_bring_up_reconcile", { event });
  }

  function handleMatchWinner(event = {}) {
    if (!enabled || !acceptLogEvent(event)) return;
    clearLifecycleTimers();

    const payload = event?.normalized?.roundMatchWinner ?? event?.normalized ?? {};
    const at = lifecycleEventIso(event, payload);
    const meta = {
      source: text(event.eventName) || "round.match_winner",
      reason: "winner_declared",
      at,
      map: text(payload.mapName ?? event.mapName) || state.map,
      winner: text(payload.winner ?? event.winner),
      endedAt: at,
      sourceMode: text(event.sourceMode) || "live",
      isReplay: Boolean(event.isReplay),
      canTriggerActions: Boolean(event.canTriggerActions) && !event.isReplay,
      connected: connected(readMatchState()),
      stale: false,
    };

    transition(MATCH_LIFECYCLE_STATE.ENDING, meta);
    scheduleFinished(meta);
  }

  function scheduleFinished(meta) {
    const expectedSession = state.sessionKey;
    const finish = () => {
      finishTimer = null;
      if (state.state !== MATCH_LIFECYCLE_STATE.ENDING || state.sessionKey !== expectedSession) return;
      transition(MATCH_LIFECYCLE_STATE.FINISHED, {
        ...meta,
        source: "match_lifecycle_settle",
        reason: "match_finished",
        at: new Date().toISOString(),
        canTriggerActions: false,
      });
      scheduleNextMatch(meta, expectedSession);
    };
    if (finishSettleMs <= 0) finish();
    else finishTimer = setTimeout(finish, finishSettleMs);
  }

  function scheduleNextMatch(meta, expectedSession) {
    const next = () => {
      nextMatchTimer = null;
      if (state.state !== MATCH_LIFECYCLE_STATE.FINISHED || state.sessionKey !== expectedSession) return;
      transition(MATCH_LIFECYCLE_STATE.NEXT_MATCH, {
        ...meta,
        source: "match_lifecycle_wait",
        reason: "waiting_for_next_match",
        at: new Date().toISOString(),
        canTriggerActions: false,
      });
    };
    if (nextMatchDelayMs <= 0) next();
    else nextMatchTimer = setTimeout(next, nextMatchDelayMs);
  }

  function reconcileFromMatchState(reason = "match_state_update", options = {}) {
    const current = readMatchState();
    if (!current) return false;

    const server = current.serverStatus ?? {};
    const match = current.match ?? {};
    const map = text(server.map || match.map);
    const layer = text(server.layer || match.layer);
    const mode = text(server.mode || match.mode);
    const nextLayer = text(server.nextLayer || match.nextLayer);
    const playtime = finiteOrNull(server.playtime ?? match.playtime);
    const isConnected = connected(current);
    const source = text(options.event?.eventName) || reason;
    const base = {
      source,
      reason,
      map,
      layer,
      mode,
      nextLayer,
      playtime,
      connected: isConnected,
      stale: !isConnected,
      sourceMode: text(options.event?.sourceMode) || "rcon",
      isReplay: Boolean(options.event?.isReplay),
      canTriggerActions: false,
    };

    const previousPlaytime = finiteOrNull(state.lastObservedPlaytime);
    const playtimeRolledBack = playtime != null
      && previousPlaytime != null
      && previousPlaytime - playtime >= 30;
    if (playtime != null) state.lastObservedPlaytime = playtime;

    if (!map && !layer) {
      if (state.state === MATCH_LIFECYCLE_STATE.UNKNOWN && isConnected) {
        return transition(MATCH_LIFECYCLE_STATE.WAITING, { ...base, reason: "connected_without_map" });
      }
      return touch(base);
    }

    const identityChanged = hasIdentityChanged(map, layer);
    if (!identityChanged && identityLockUntil > 0) identityLockUntil = 0;

    if (identityChanged && Date.now() < identityLockUntil) {
      return touch({
        ...base,
        map: state.map,
        layer: state.layer,
        mode: state.mode,
        reason: "ignored_stale_rcon_identity_after_world_bring_up",
      });
    }

    if (identityChanged) {
      identityLockUntil = 0;
      clearLifecycleTimers();
      transition(MATCH_LIFECYCLE_STATE.LOADING_MAP, {
        ...base,
        reason: "rcon_map_changed",
        winner: "",
        startedAt: "",
        endedAt: "",
        sessionKey: sessionKey(state.serverId, layer, map, String(Date.now())),
      });
      if (playtime != null && playtime > 0) {
        return transition(MATCH_LIFECYCLE_STATE.LIVE, {
          ...base,
          reason: "rcon_new_map_live",
          winner: "",
          endedAt: "",
          startedAt: new Date().toISOString(),
        });
      }
      return transition(MATCH_LIFECYCLE_STATE.MAP_READY, {
        ...base,
        reason: "rcon_map_loaded",
        winner: "",
        endedAt: "",
      });
    }

    if (isEndedState(state.state)) return touch(base);

    if (playtimeRolledBack) {
      clearLifecycleTimers();
      transition(MATCH_LIFECYCLE_STATE.MAP_READY, {
        ...base,
        reason: "playtime_rollback_new_round",
        winner: "",
        endedAt: "",
        startedAt: new Date().toISOString(),
      });
    }

    if (playtime != null && playtime > 0) {
      if (state.state !== MATCH_LIFECYCLE_STATE.LIVE) {
        return transition(MATCH_LIFECYCLE_STATE.LIVE, {
          ...base,
          reason: "positive_playtime",
          startedAt: state.startedAt || new Date().toISOString(),
        });
      }
      return touch(base);
    }

    if (playtime === 0 && [
      MATCH_LIFECYCLE_STATE.UNKNOWN,
      MATCH_LIFECYCLE_STATE.WAITING,
      MATCH_LIFECYCLE_STATE.LOADING_MAP,
    ].includes(state.state)) {
      return transition(MATCH_LIFECYCLE_STATE.MAP_READY, {
        ...base,
        reason: "zero_playtime_map_ready",
      });
    }

    return touch(base);
  }

  function hasIdentityChanged(map, layer) {
    if (state.layer && layer) return !same(state.layer, layer);
    if (state.map && map) return !same(state.map, map);
    return false;
  }

  function acceptLogEvent(event = {}) {
    const sourceMode = text(event.sourceMode ?? event.rawEvent?.SourceMode).toLowerCase();
    const canTriggerActions = event.canTriggerActions ?? event.rawEvent?.CanTriggerActions;
    if (Boolean(event.isReplay) || (sourceMode && sourceMode !== "live")) return false;
    if (canTriggerActions === false || text(canTriggerActions).toLowerCase() === "false") return false;

    const id = text(event.eventId);
    if (id && recentEventIds.has(id)) return false;
    const ms = lifecycleEventMs(event);
    if (ms > 0 && state.logWatermarkMs > 0 && ms + 1000 < state.logWatermarkMs) {
      moduleLogger.debug?.("[MatchLifecycle] ignored stale lifecycle event", {
        operation: "matchLifecycle.staleEvent",
        data: {
          eventName: event.eventName,
          eventId: id,
          eventMs: ms,
          watermarkMs: state.logWatermarkMs,
          isReplay: Boolean(event.isReplay),
        },
      });
      return false;
    }
    if (id) {
      recentEventIds.set(id, Date.now());
      while (recentEventIds.size > 300) recentEventIds.delete(recentEventIds.keys().next().value);
    }
    if (ms > state.logWatermarkMs) state.logWatermarkMs = ms;
    return true;
  }

  function readMatchState() {
    return modules?.matchState?.getState?.() ?? null;
  }

  function connected(current) {
    if (typeof current?.rconStatus?.connected === "boolean") return current.rconStatus.connected;
    return Boolean(core.rconManager?.getStatus?.()?.connected);
  }

  async function loadPersistedState() {
    try {
      const parsed = JSON.parse(await fs.readFile(stateFile, "utf8"));
      const saved = parsed?.lifecycle;
      if (Number(parsed?.version) !== STATE_FILE_VERSION || !saved || !VALID_STATES.has(saved.state)) return;
      const expectedServerId = text(core.webStatus?.serverId);
      if (text(saved.serverId) && expectedServerId && text(saved.serverId) !== expectedServerId) return;

      Object.assign(state, {
        ...state,
        ...saved,
        state: saved.state,
        serverId: text(saved.serverId) || expectedServerId,
        history: Array.isArray(saved.history) ? saved.history.slice(-historyLimit).map(clone) : [],
        playtime: finiteOrNull(saved.playtime),
        lastObservedPlaytime: finiteOrNull(saved.lastObservedPlaytime ?? saved.playtime),
        logWatermarkMs: Math.max(0, Number(saved.logWatermarkMs ?? 0) || 0),
        revision: Math.max(0, Number(saved.revision ?? 0) || 0) + 1,
        source: "persisted_state",
        reason: "restored_after_restart",
        sourceMode: "restore",
        isReplay: true,
        canTriggerActions: false,
        connected: false,
        stale: true,
        updatedAt: new Date().toISOString(),
      });
      publish({ persist: false, emit: false });
    } catch (error) {
      if (error?.code !== "ENOENT") {
        moduleLogger.warn?.(`[MatchLifecycle] failed to load persisted state: ${error?.message ?? error}`);
      }
    }
  }

  function schedulePersist() {
    if (!started) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void persistNow();
    }, 250);
  }

  function persistNow() {
    const payload = {
      version: STATE_FILE_VERSION,
      savedAt: new Date().toISOString(),
      lifecycle: { ...state, history: state.history.slice(-historyLimit) },
    };
    const tmp = `${stateFile}.tmp`;
    writeChain = writeChain.then(async () => {
      await fs.mkdir(path.dirname(stateFile), { recursive: true });
      await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      await fs.rename(tmp, stateFile);
    }).catch((error) => {
      moduleLogger.warn?.(`[MatchLifecycle] failed to persist state: ${error?.message ?? error}`);
    });
    return writeChain;
  }

  function clearLifecycleTimers() {
    if (finishTimer) clearTimeout(finishTimer);
    if (nextMatchTimer) clearTimeout(nextMatchTimer);
    finishTimer = null;
    nextMatchTimer = null;
  }

  return {
    manifest: {
      id: "module.matchLifecycle",
      name: "Match Lifecycle Module",
      kind: "module",
      version: "1.0.0",
      hidden: true,
      description: "权威比赛生命周期状态机：地图切换、地图就绪、进行中、结算、结束及等待下一局。",
    },
    apiName: "matchLifecycle",
    api,

    async start() {
      if (!enabled || started) return;
      started = true;
      await loadPersistedState();

      unsubscribers.push(core.eventBus.onCoreEvent("round.world_bring_up", handleWorldBringUp));
      unsubscribers.push(core.eventBus.onCoreEvent("round.match_winner", handleMatchWinner));
      // Compatibility only. LogPost's real matcher emits round.match_winner.
      unsubscribers.push(core.eventBus.onCoreEvent("round.winner_declared", handleMatchWinner));
      unsubscribers.push(core.eventBus.onCoreEvent("MATCH_END", handleMatchWinner));
      unsubscribers.push(core.eventBus.onCoreEvent("RCON_CONNECTED", () => reconcileFromMatchState("rcon_connected")));
      unsubscribers.push(core.eventBus.onCoreEvent("RCON_DISCONNECTED", () => {
        touch({
          source: "RCON_DISCONNECTED",
          reason: "rcon_disconnected",
          connected: false,
          stale: true,
          canTriggerActions: false,
        });
      }));
      unsubscribers.push(core.eventBus.onModuleEvent("module.matchState", "updated", () => {
        reconcileFromMatchState("match_state_updated");
      }));
      unsubscribers.push(core.eventBus.onModuleEvent("module.matchState", "serverStatusUpdated", () => {
        reconcileFromMatchState("server_status_updated");
      }));

      reconcileFromMatchState("startup_reconcile");
      publish();
    },

    async stop() {
      started = false;
      for (const unsubscribe of unsubscribers.splice(0)) {
        try { unsubscribe(); } catch {}
      }
      clearLifecycleTimers();
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = null;
      await persistNow();
    },
  };
}

function isEndedState(value) {
  return value === MATCH_LIFECYCLE_STATE.ENDING
    || value === MATCH_LIFECYCLE_STATE.FINISHED
    || value === MATCH_LIFECYCLE_STATE.NEXT_MATCH;
}

function lifecycleEventMs(event = {}) {
  const payload = event?.normalized?.roundWorldBringUp
    ?? event?.normalized?.roundMatchWinner
    ?? event?.normalized
    ?? {};
  return parseEventTime(text(payload.logLineTime || payload.serverPlayAt || event.logTime || event.time));
}

function lifecycleEventIso(event = {}, payload = {}) {
  const ms = parseEventTime(text(payload.logLineTime || payload.serverPlayAt || event.logTime || event.time));
  return ms > 0 ? new Date(ms).toISOString() : new Date().toISOString();
}

function eventIso(value) {
  const raw = text(value);
  if (!raw) return "";
  const ms = parseEventTime(raw);
  return ms > 0 ? new Date(ms).toISOString() : "";
}

function parseEventTime(value) {
  const raw = text(value);
  if (!raw) return 0;
  const match = raw.match(/^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d{3})$/);
  if (match) {
    const [, year, month, day, hour, minute, second, millis] = match;
    const ms = Date.UTC(
      Number(year), Number(month) - 1, Number(day), Number(hour),
      Number(minute), Number(second), Number(millis),
    );
    return Number.isFinite(ms) ? ms : 0;
  }
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function sessionKey(serverId, layer, worldPath, logLineTime) {
  return [serverId, layer, worldPath, logLineTime].map(text).filter(Boolean).join("|");
}

function same(left, right) {
  return text(left).toLowerCase() === text(right).toLowerCase();
}

function text(value) {
  return String(value ?? "").trim();
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveInt(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeInt(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
