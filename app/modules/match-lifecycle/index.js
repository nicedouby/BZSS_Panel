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

const DEFAULT_STATE_FILE = "./data/match-state/lifecycle.json";
const DEFAULT_HISTORY_LIMIT = 100;
const DEFAULT_FINISH_SETTLE_MS = 1500;
const DEFAULT_NEXT_MATCH_DELAY_MS = 8000;
const STATE_FILE_VERSION = 1;

/**
 * Authoritative match lifecycle state machine.
 *
 * match-state remains responsible for RCON/roster telemetry. This module owns
 * only lifecycle semantics and publishes one stable lifecycle snapshot through
 * WebStatus, which is already included in /api/snapshot/all.
 */
export function createMatchLifecycleModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.matchLifecycle",
    source: "module.matchLifecycle",
    channel: "module",
  }) ?? core.logger;
  const moduleConfig = config.get("modules.matchLifecycle", {});
  const enabled = moduleConfig.enabled !== false;
  const stateFile = path.resolve(
    process.cwd(),
    String(moduleConfig.stateFile ?? DEFAULT_STATE_FILE).trim() || DEFAULT_STATE_FILE,
  );
  const historyLimit = positiveInt(moduleConfig.historyLimit, DEFAULT_HISTORY_LIMIT);
  const finishSettleMs = nonNegativeInt(moduleConfig.finishSettleMs, DEFAULT_FINISH_SETTLE_MS);
  const nextMatchDelayMs = nonNegativeInt(moduleConfig.nextMatchDelayMs, DEFAULT_NEXT_MATCH_DELAY_MS);

  const unsubscribers = [];
  const recentEventIds = new Map();
  let persistTimer = null;
  let finishTimer = null;
  let nextMatchTimer = null;
  let started = false;
  let writeChain = Promise.resolve();

  const state = {
    state: MATCH_LIFECYCLE_STATE.UNKNOWN,
    previousState: "",
    serverId: normalizeText(core.webStatus?.serverId),
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
    getState() {
      return publicSnapshot();
    },
    getHistory() {
      return state.history.map(clone);
    },
    reconcile(reason = "manual") {
      reconcileFromMatchState(reason);
      return publicSnapshot();
    },
  };

  function publicSnapshot() {
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
    const snapshot = publicSnapshot();
    core.webStatus?.patch?.({ matchLifecycle: snapshot });

    if (emit) {
      core.eventBus?.emitModuleEvent?.("module.matchLifecycle", "updated", {
        eventName: "module.matchLifecycle.updated",
        layer: "module",
        source: "module.matchLifecycle",
        serverId: state.serverId,
        time: state.updatedAt,
        lifecycle: snapshot,
        canTriggerActions: snapshot.canTriggerActions,
        isReplay: snapshot.isReplay,
        sourceMode: snapshot.sourceMode,
      });
    }

    if (persist) schedulePersist();
    return snapshot;
  }

  function transition(nextState, meta = {}) {
    if (!Object.values(MATCH_LIFECYCLE_STATE).includes(nextState)) return false;

    const now = normalizeIso(meta.at) || new Date().toISOString();
    const from = state.state;
    const stateChanged = from !== nextState;
    const identityChanged = applyIdentity(meta);
    const metadataChanged = applyMetadata(meta);

    if (!stateChanged && !identityChanged && !metadataChanged) return false;

    if (stateChanged) {
      state.previousState = from;
      state.state = nextState;
      state.stateChangedAt = now;
      state.history.push({
        from,
        to: nextState,
        at: now,
        source: normalizeText(meta.source) || state.source,
        reason: normalizeText(meta.reason),
        map: state.map,
        layer: state.layer,
        mode: state.mode,
        sessionKey: state.sessionKey,
        winner: state.winner,
        sourceMode: normalizeText(meta.sourceMode) || state.sourceMode,
        isReplay: Boolean(meta.isReplay),
        canTriggerActions: Boolean(meta.canTriggerActions) && !meta.isReplay,
      });
      if (state.history.length > historyLimit) {
        state.history.splice(0, state.history.length - historyLimit);
      }
    }

    state.updatedAt = now;
    state.source = normalizeText(meta.source) || state.source || "unknown";
    state.reason = normalizeText(meta.reason) || state.reason;
    state.sourceMode = normalizeText(meta.sourceMode) || state.sourceMode || "live";
    state.isReplay = Boolean(meta.isReplay);
    state.canTriggerActions = Boolean(meta.canTriggerActions) && !state.isReplay;
    state.revision += 1;

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

  function applyIdentity(meta = {}) {
    let changed = false;
    for (const key of ["serverId", "map", "layer", "mode", "nextLayer", "sessionKey", "winner"]) {
      if (!(key in meta)) continue;
      const next = normalizeText(meta[key]);
      if (state[key] === next) continue;
      state[key] = next;
      changed = true;
    }
    for (const key of ["startedAt", "endedAt"]) {
      if (!(key in meta)) continue;
      const next = normalizeIso(meta[key]);
      if (state[key] === next) continue;
      state[key] = next;
      changed = true;
    }
    return changed;
  }

  function applyMetadata(meta = {}) {
    let changed = false;
    if (typeof meta.connected === "boolean" && state.connected !== meta.connected) {
      state.connected = meta.connected;
      changed = true;
    }
    if (typeof meta.stale === "boolean" && state.stale !== meta.stale) {
      state.stale = meta.stale;
      changed = true;
    }
    if (meta.playtime !== undefined) {
      const playtime = finiteOrNull(meta.playtime);
      if (state.playtime !== playtime) {
        state.playtime = playtime;
        changed = true;
      }
    }
    return changed;
  }

  function updateMetadata(meta = {}) {
    const identityChanged = applyIdentity(meta);
    const metadataChanged = applyMetadata(meta);
    if (!identityChanged && !metadataChanged) return false;
    state.updatedAt = normalizeIso(meta.at) || new Date().toISOString();
    state.source = normalizeText(meta.source) || state.source;
    state.reason = normalizeText(meta.reason) || state.reason;
    state.sourceMode = normalizeText(meta.sourceMode) || state.sourceMode;
    state.isReplay = Boolean(meta.isReplay ?? state.isReplay);
    state.canTriggerActions = Boolean(meta.canTriggerActions ?? state.canTriggerActions) && !state.isReplay;
    state.revision += 1;
    publish();
    return true;
  }

  function handleWorldBringUp(event = {}) {
    if (!enabled || !acceptLifecycleEvent(event)) return;
    clearLifecycleTimers();

    const payload = event?.normalized?.roundWorldBringUp ?? {};
    const eventAt = lifecycleEventIso(event, payload);
    const map = normalizeText(payload.mapName) || normalizeText(readMatchState()?.serverStatus?.map);
    const layer = normalizeText(payload.layerName) || normalizeText(readMatchState()?.serverStatus?.layer);
    const mode = normalizeText(payload.gameMode) || normalizeText(readMatchState()?.serverStatus?.mode);
    const serverId = normalizeText(payload.serverId) || normalizeText(event.serverId) || state.serverId;
    const sessionKey = buildSessionKey({ serverId, layer, worldPath: payload.worldPath, logLineTime: payload.logLineTime });

    transition(MATCH_LIFECYCLE_STATE.MAP_READY, {
      source: "round.world_bring_up",
      reason: state.layer && layer && state.layer !== layer ? "map_switch_completed" : "world_ready",
      at: eventAt,
      serverId,
      map,
      layer,
      mode,
      sessionKey,
      winner: "",
      startedAt: eventAt,
      endedAt: "",
      connected: resolveConnected(readMatchState()),
      stale: false,
      sourceMode: normalizeText(event.sourceMode) || "live",
      isReplay: Boolean(event.isReplay),
      canTriggerActions: Boolean(event.canTriggerActions) && !event.isReplay,
    });

    reconcileFromMatchState("world_bring_up_reconcile", {
      preserveMapReady: true,
      event,
    });
  }

  function handleMatchWinner(event = {}) {
    if (!enabled || !acceptLifecycleEvent(event)) return;

    const payload = event?.normalized?.roundMatchWinner ?? event?.normalized ?? {};
    const eventAt = lifecycleEventIso(event, payload);
    const winner = normalizeText(payload.winner ?? event.winner);
    const map = normalizeText(payload.mapName ?? event.mapName) || state.map;
    const eventMeta = {
      source: normalizeText(event.eventName) || "round.match_winner",
      reason: "winner_declared",
      at: eventAt,
      map,
      winner,
      endedAt: eventAt,
      sourceMode: normalizeText(event.sourceMode) || "live",
      isReplay: Boolean(event.isReplay),
      canTriggerActions: Boolean(event.canTriggerActions) && !event.isReplay,
      connected: resolveConnected(readMatchState()),
      stale: false,
    };

    clearLifecycleTimers();
    transition(MATCH_LIFECYCLE_STATE.ENDING, eventMeta);
    scheduleFinished(eventMeta);
  }

  function scheduleFinished(meta) {
    const expectedSession = state.sessionKey;
    const run = () => {
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

    if (finishSettleMs <= 0) run();
    else finishTimer = setTimeout(run, finishSettleMs);
  }

  function scheduleNextMatch(meta, expectedSession) {
    const run = () => {
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

    if (nextMatchDelayMs <= 0) run();
    else nextMatchTimer = setTimeout(run, nextMatchDelayMs);
  }

  function reconcileFromMatchState(reason = "match_state_update", options = {}) {
    const snapshot = readMatchState();
    if (!snapshot) return false;

    const serverStatus = snapshot.serverStatus ?? {};
    const match = snapshot.match ?? {};
    const map = normalizeText(serverStatus.map || match.map);
    const layer = normalizeText(serverStatus.layer || match.layer);
    const mode = normalizeText(serverStatus.mode || match.mode);
    const nextLayer = normalizeText(serverStatus.nextLayer || match.nextLayer);
    const playtime = finiteOrNull(serverStatus.playtime ?? match.playtime);
    const connected = resolveConnected(snapshot);
    const source = normalizeText(options?.event?.eventName) || reason;
    const baseMeta = {
      source,
      reason,
      map,
      layer,
      mode,
      nextLayer,
      connected,
      stale: !connected,
      playtime,
      sourceMode: normalizeText(options?.event?.sourceMode) || "rcon",
      isReplay: Boolean(options?.event?.isReplay),
      canTriggerActions: false,
    };

    const previousPlaytime = finiteOrNull(state.lastObservedPlaytime);
    const playtimeRolledBack = playtime != null
      && previousPlaytime != null
      && previousPlaytime - playtime >= 30;
    if (playtime != null) state.lastObservedPlaytime = playtime;

    if (!map && !layer) {
      if (state.state === MATCH_LIFECYCLE_STATE.UNKNOWN && connected) {
        return transition(MATCH_LIFECYCLE_STATE.WAITING, {
          ...baseMeta,
          reason: "connected_without_map",
        });
      }
      return updateMetadata(baseMeta);
    }

    const identityChanged = hasIdentityChanged({ map, layer });
    if (identityChanged) {
      clearLifecycleTimers();
      transition(MATCH_LIFECYCLE_STATE.LOADING_MAP, {
        ...baseMeta,
        reason: "rcon_map_changed",
        winner: "",
        startedAt: "",
        endedAt: "",
        sessionKey: buildSessionKey({ serverId: state.serverId, layer, worldPath: map, logLineTime: String(Date.now()) }),
      });

      if (playtime === 0 || playtime == null) {
        return transition(MATCH_LIFECYCLE_STATE.MAP_READY, {
          ...baseMeta,
          reason: "rcon_map_loaded",
          winner: "",
          endedAt: "",
        });
      }
      return transition(MATCH_LIFECYCLE_STATE.LIVE, {
        ...baseMeta,
        reason: "rcon_new_map_live",
        startedAt: state.startedAt || new Date().toISOString(),
        winner: "",
        endedAt: "",
      });
    }

    if (playtimeRolledBack && !isEndedState(state.state)) {
      clearLifecycleTimers();
      transition(MATCH_LIFECYCLE_STATE.MAP_READY, {
        ...baseMeta,
        reason: "playtime_rollback_new_round",
        winner: "",
        endedAt: "",
        startedAt: new Date().toISOString(),
      });
    }

    // A stale ShowServerInfo response from the just-finished round must never
    // resurrect an ended match merely because PLAYTIME_I is still > 0.
    if (isEndedState(state.state)) {
      return updateMetadata(baseMeta);
    }

    if (options.preserveMapReady && state.state === MATCH_LIFECYCLE_STATE.MAP_READY) {
      if (playtime != null && playtime > 0) {
        return transition(MATCH_LIFECYCLE_STATE.LIVE, {
          ...baseMeta,
          reason: "world_ready_with_positive_playtime",
          startedAt: state.startedAt || new Date().toISOString(),
        });
      }
      return updateMetadata(baseMeta);
    }

    if (playtime != null && playtime > 0) {
      if ([
        MATCH_LIFECYCLE_STATE.UNKNOWN,
        MATCH_LIFECYCLE_STATE.WAITING,
        MATCH_LIFECYCLE_STATE.LOADING_MAP,
        MATCH_LIFECYCLE_STATE.MAP_READY,
      ].includes(state.state)) {
        return transition(MATCH_LIFECYCLE_STATE.LIVE, {
          ...baseMeta,
          reason: "positive_playtime",
          startedAt: state.startedAt || new Date().toISOString(),
        });
      }
    } else if (playtime === 0 && [
      MATCH_LIFECYCLE_STATE.UNKNOWN,
      MATCH_LIFECYCLE_STATE.WAITING,
      MATCH_LIFECYCLE_STATE.LOADING_MAP,
    ].includes(state.state)) {
      return transition(MATCH_LIFECYCLE_STATE.MAP_READY, {
        ...baseMeta,
        reason: "zero_playtime_map_ready",
      });
    }

    return updateMetadata(baseMeta);
  }

  function hasIdentityChanged({ map, layer }) {
    const currentLayer = normalizeText(state.layer);
    const currentMap = normalizeText(state.map);
    if (currentLayer && layer) return !sameText(currentLayer, layer);
    if (currentMap && map) return !sameText(currentMap, map);
    return false;
  }

  function acceptLifecycleEvent(event = {}) {
    const eventId = normalizeText(event.eventId);
    if (eventId && recentEventIds.has(eventId)) return false;

    const eventMs = lifecycleEventMs(event);
    if (eventMs > 0 && state.logWatermarkMs > 0 && eventMs + 1000 < state.logWatermarkMs) {
      moduleLogger.debug?.("[MatchLifecycle] ignored stale lifecycle event", {
        operation: "matchLifecycle.staleEvent",
        data: {
          eventName: event.eventName,
          eventId,
          eventMs,
          watermarkMs: state.logWatermarkMs,
          isReplay: Boolean(event.isReplay),
        },
      });
      return false;
    }

    if (eventId) {
      recentEventIds.set(eventId, Date.now());
      if (recentEventIds.size > 300) {
        const keys = [...recentEventIds.keys()].slice(0, recentEventIds.size - 250);
        for (const key of keys) recentEventIds.delete(key);
      }
    }
    if (eventMs > state.logWatermarkMs) state.logWatermarkMs = eventMs;
    return true;
  }

  function readMatchState() {
    return modules?.matchState?.getState?.() ?? null;
  }

  function resolveConnected(snapshot) {
    if (!snapshot) return Boolean(core.rconManager?.getStatus?.()?.connected);
    if (typeof snapshot.rconStatus?.connected === "boolean") return snapshot.rconStatus.connected;
    return Boolean(core.rconManager?.getStatus?.()?.connected);
  }

  async function loadPersistedState() {
    try {
      const parsed = JSON.parse(await fs.readFile(stateFile, "utf8"));
      if (Number(parsed?.version) !== STATE_FILE_VERSION || !parsed?.lifecycle) return;
      const restored = parsed.lifecycle;
      const expectedServerId = normalizeText(core.webStatus?.serverId);
      if (normalizeText(restored.serverId) && expectedServerId && normalizeText(restored.serverId) !== expectedServerId) return;
      if (!Object.values(MATCH_LIFECYCLE_STATE).includes(restored.state)) return;

      for (const key of [
        "state", "previousState", "serverId", "map", "layer", "mode", "nextLayer", "sessionKey", "winner",
        "startedAt", "endedAt", "stateChangedAt", "updatedAt", "source", "reason", "sourceMode",
      ]) {
        if (restored[key] !== undefined) state[key] = normalizeText(restored[key]);
      }
      state.isReplay = true;
      state.canTriggerActions = false;
      state.connected = false;
      state.stale = true;
      state.playtime = finiteOrNull(restored.playtime);
      state.lastObservedPlaytime = finiteOrNull(restored.lastObservedPlaytime ?? restored.playtime);
      state.logWatermarkMs = Math.max(0, Number(restored.logWatermarkMs ?? 0) || 0);
      state.revision = Math.max(0, Number(restored.revision ?? 0) || 0);
      state.history = Array.isArray(restored.history)
        ? restored.history.slice(-historyLimit).map(clone)
        : [];
      state.source = "persisted_state";
      state.reason = "restored_after_restart";
      state.updatedAt = new Date().toISOString();
      state.revision += 1;
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
      lifecycle: {
        ...state,
        history: state.history.slice(-historyLimit),
      },
    };
    const tmpFile = `${stateFile}.tmp`;
    writeChain = writeChain
      .then(async () => {
        await fs.mkdir(path.dirname(stateFile), { recursive: true });
        await fs.writeFile(tmpFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
        await fs.rename(tmpFile, stateFile);
      })
      .catch((error) => {
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
      description: "权威比赛生命周期状态机。融合日志强信号与 RCON 校验，统一维护地图切换、地图就绪、对局进行、结算、结束与等待下一局状态。",
    },
    apiName: "matchLifecycle",
    api,

    async start() {
      if (!enabled || started) return;
      started = true;
      await loadPersistedState();

      unsubscribers.push(core.eventBus.onCoreEvent("round.world_bring_up", handleWorldBringUp));
      unsubscribers.push(core.eventBus.onCoreEvent("round.match_winner", handleMatchWinner));
      // Legacy compatibility. The real LogPost matcher emits round.match_winner.
      unsubscribers.push(core.eventBus.onCoreEvent("round.winner_declared", handleMatchWinner));
      unsubscribers.push(core.eventBus.onCoreEvent("MATCH_END", handleMatchWinner));
      unsubscribers.push(core.eventBus.onCoreEvent("RCON_CONNECTED", () => reconcileFromMatchState("rcon_connected")));
      unsubscribers.push(core.eventBus.onCoreEvent("RCON_DISCONNECTED", () => {
        updateMetadata({
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
      unsubscribers.push(core.eventBus.onModuleEvent("module.matchState", "roundUpdated", (event) => {
        // round.world_bring_up is normally received directly as a core event.
        // This is a reconciliation path only; it does not create a second event.
        reconcileFromMatchState("round_state_updated", { event });
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
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
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
  const raw = normalizeText(payload.logLineTime || payload.serverPlayAt || event.logTime || event.time);
  return parseEventTime(raw);
}

function lifecycleEventIso(event = {}, payload = {}) {
  const raw = normalizeText(payload.logLineTime || payload.serverPlayAt || event.logTime || event.time);
  const ms = parseEventTime(raw);
  return ms > 0 ? new Date(ms).toISOString() : new Date().toISOString();
}

function parseEventTime(value) {
  const text = normalizeText(value);
  if (!text) return 0;
  const squad = text.match(/^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d{3})$/);
  if (squad) {
    const [, year, month, day, hour, minute, second, millis] = squad;
    const valueMs = Date.UTC(
      Number(year), Number(month) - 1, Number(day),
      Number(hour), Number(minute), Number(second), Number(millis),
    );
    return Number.isFinite(valueMs) ? valueMs : 0;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildSessionKey({ serverId = "", layer = "", worldPath = "", logLineTime = "" } = {}) {
  return [normalizeText(serverId), normalizeText(layer), normalizeText(worldPath), normalizeText(logLineTime)]
    .filter(Boolean)
    .join("|");
}

function sameText(left, right) {
  return normalizeText(left).toLowerCase() === normalizeText(right).toLowerCase();
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeIso(value) {
  const text = normalizeText(value);
  if (!text) return "";
  const ms = parseEventTime(text);
  return ms > 0 ? new Date(ms).toISOString() : "";
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
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}
