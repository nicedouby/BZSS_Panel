// -*- coding: utf-8 -*-

import { normalizeRoundWorldBringUpPayload } from "../../core/event-normalizer.js";

const MAX_HISTORY = 200;
const DEFAULT_DEDUPE_TTL_MS = 10 * 60 * 1000;

export function createRoundStateModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.roundState",
    source: "module.roundState",
    channel: "module",
  }) ?? core.logger;
  const moduleConfig = config.get("modules.roundState", {});
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const dedupeTtlMs = normalizePositiveNumber(moduleConfig.dedupeTtlMs, DEFAULT_DEDUPE_TTL_MS);
  const maxHistory = normalizePositiveNumber(moduleConfig.maxHistory ?? moduleConfig.maxEvents, MAX_HISTORY);
  const recentKeys = new Map();
  const history = [];
  const unsubscribers = [];

  const state = {
    serverId: core.webStatus.serverId,
    updatedAt: "",
    current: null,
    history: [],
    lastAcceptedAt: "",
    lastDedupedAt: "",
  };

  const api = {
    getState() {
      return getState();
    },

    getOverview() {
      const snapshot = getState();
      return {
        ...snapshot,
        latest: snapshot.history.slice(-20).reverse(),
      };
    },

    getCurrent(serverId = core.webStatus.serverId) {
      const current = state.current;
      if (!current) return null;
      if (serverId && String(current.serverId ?? "") !== String(serverId)) return null;
      return clone(current);
    },
  };

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.("module.roundState") !== false
      && core.pluginSubscriptions?.isSubscribed?.("module.roundState") !== false;
  }

  function ingest(event) {
    if (!enabled || !isSubscribed()) return null;

    const parsed = event?.normalized?.roundWorldBringUp
      ? { ...event.normalized.roundWorldBringUp }
      : normalizeRoundWorldBringUpPayload(event);
    if (!parsed?.worldPath || !parsed?.logLineTime || !parsed?.serverPlayAt) {
      return null;
    }

    const serverId = String(parsed.serverId ?? event?.serverId ?? core.webStatus.serverId ?? "").trim();
    if (!serverId) return null;

    const dedupeKey = buildDedupeKey(serverId, parsed);
    cleanupRecentKeys();
    if (recentKeys.has(dedupeKey)) {
      state.lastDedupedAt = new Date().toISOString();
      return null;
    }
    recentKeys.set(dedupeKey, Date.now());

    const record = {
      ...parsed,
      serverId,
      dedupeKey,
      sourceEventId: String(event?.eventId ?? ""),
      receivedAt: new Date().toISOString(),
      rawLog: String(event?.rawLog ?? parsed.rawLog ?? ""),
    };

    state.serverId = serverId;
    state.current = clone(record);
    history.push(clone(record));
    trimHistory();
    state.history = history.map(clone);
    state.updatedAt = record.receivedAt;
    state.lastAcceptedAt = record.receivedAt;

    core.webStatus.patch({
      map: record.mapName || "",
      layer: record.layerName || "",
      mode: record.gameMode || "",
      currentLayer: record.layerName || "",
      logTime: {
        startedAtMs: record.logTimeStartedAtMs,
        logLineTime: record.logLineTime,
        serverPlayAt: record.serverPlayAt,
        worldPath: record.worldPath,
        layerName: record.layerName,
        mapName: record.mapName,
        gameMode: record.gameMode,
      },
    });

    const payload = {
      eventName: "module.roundState.updated",
      layer: "module",
      source: "module.roundState",
      serverId,
      time: record.receivedAt,
      record: clone(record),
      state: getState(),
    };

    core.eventBus.emitModuleEvent("module.roundState", "updated", payload);

    moduleLogger.info(
      `[ROUND] World bring up detected: ${record.layerName} map=${record.mapName || "unknown"} mode=${record.gameMode || "unknown"} tick=${record.maxTickRate ?? "unknown"} logTime reset`,
      {
        operation: "roundWorldBringUp",
        data: {
          serverId,
          dedupeKey,
          logLineTime: record.logLineTime,
          worldPath: record.worldPath,
          layerName: record.layerName,
          mapName: record.mapName,
          gameMode: record.gameMode,
          maxTickRate: record.maxTickRate,
          serverPlayAt: record.serverPlayAt,
          logTimeStartedAtMs: record.logTimeStartedAtMs,
        },
      },
    );

    return record;
  }

  function getState() {
    return {
      serverId: state.serverId,
      updatedAt: state.updatedAt,
      current: state.current ? clone(state.current) : null,
      history: history.map(clone),
      lastAcceptedAt: state.lastAcceptedAt,
      lastDedupedAt: state.lastDedupedAt,
    };
  }

  function cleanupRecentKeys() {
    const now = Date.now();
    for (const [key, createdAt] of [...recentKeys.entries()]) {
      if (now - Number(createdAt ?? now) <= dedupeTtlMs) continue;
      recentKeys.delete(key);
    }
  }

  function trimHistory() {
    if (history.length <= maxHistory) return;
    history.splice(0, history.length - maxHistory);
  }

  return {
    manifest: {
      id: "module.roundState",
      name: "Round State Module",
      kind: "module",
      version: "0.1.0",
      description: "Track round.world_bring_up events, dedupe repeated log lines, and publish the current round anchor state.",
    },
    apiName: "roundState",
    api,

    async start() {
      if (!enabled) {
        moduleLogger.info("RoundState module disabled by config.", { operation: "start" });
        return;
      }

      unsubscribers.push(core.eventBus.onCoreEvent("round.world_bring_up", ingest));
      moduleLogger.info("RoundState module started.", {
        operation: "start",
        data: {
          dedupeTtlMs,
          maxHistory,
        },
      });
    },

    async stop() {
      for (const unsubscriber of unsubscribers.splice(0)) {
        try {
          unsubscriber();
        } catch {}
      }
      recentKeys.clear();
      history.splice(0);
      state.current = null;
      state.history = [];
      state.updatedAt = "";
      state.lastAcceptedAt = "";
      state.lastDedupedAt = "";
    },
  };
}

function buildDedupeKey(serverId, parsed) {
  return [
    String(serverId ?? "").trim(),
    String(parsed.logLineTime ?? "").trim(),
    String(parsed.worldPath ?? "").trim(),
    String(parsed.serverPlayAt ?? "").trim(),
  ].join(":");
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
