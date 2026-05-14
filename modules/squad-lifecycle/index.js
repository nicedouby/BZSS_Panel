// -*- coding: utf-8 -*-

import { parseSquadCreateEvent, normalizeSquadName } from "./log-adapter.js";
import { createSquadLifecycleReducer } from "./reducer.js";

const MATCH_END_EVENTS = ["GAME_END", "MATCH_END", "ROUND_END", "ROUND_ENDED", "NEW_GAME"];
const PENDING_CREATE_LOG_TTL_MS = 5 * 60 * 1000;

export function createSquadLifecycleModule({ core, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.squadLifecycle",
    source: "module.squadLifecycle",
    channel: "module",
  }) ?? core.logger;

  const moduleConfig = config.get("modules.squadLifecycle", {});
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const debugEnabled = Boolean(moduleConfig.debug ?? false);
  const pendingCreateLogTtlMs = normalizePositiveNumber(moduleConfig.pendingCreateLogTtlMs, PENDING_CREATE_LOG_TTL_MS);

  const reducer = createSquadLifecycleReducer({ config, logger: moduleLogger });
  const pendingCreateLogs = new Map();
  const unsubscribers = [];

  const api = {
    getCurrent(serverId = core.webStatus.serverId) {
      return reducer.getCurrentSnapshot(serverId);
    },

    getPendingCount() {
      return pendingCreateLogs.size;
    },

    getCurrentMatchId(serverId = core.webStatus.serverId) {
      return reducer.getCurrentMatchId(serverId);
    },
  };

  return {
    manifest: {
      id: "module.squadLifecycle",
      name: "Squad Lifecycle Module",
      kind: "module",
      version: "0.2.0",
      description: "Maintain squad lifecycle records, pending squad create logs, and creation timestamps from logs and RCON snapshots.",
    },
    apiName: "squadLifecycle",
    api,

    async start() {
      if (!enabled) return;

      unsubscribers.push(core.eventBus.onCoreEvent("On_SquadCreated", (event) => {
        handleCreateEvent(event);
      }));
      unsubscribers.push(core.eventBus.onCoreEvent("SQUAD_CREATED", (event) => {
        handleCreateEvent(event);
      }));

      unsubscribers.push(core.eventBus.onModuleEvent("module.matchState", "squadsUpdated", (event) => {
        const serverId = String(event.serverId ?? core.webStatus.serverId ?? "").trim();
        if (!serverId) return;

        cleanupExpiredPending();
        const matchId = resolveCurrentMatchId(serverId, event) || buildSyntheticMatchId(serverId, event);
        if (!matchId) return;

        reducer.setCurrentMatchId(serverId, matchId);
        flushPendingForSnapshot(serverId, matchId, Array.isArray(event.squads) ? event.squads : []);
        reducer.handleRconSquadSnapshot({
          serverId,
          matchId,
          observedAt: event.time ?? new Date().toISOString(),
          squads: Array.isArray(event.squads) ? event.squads : [],
        });
      }));

      for (const eventName of MATCH_END_EVENTS) {
        unsubscribers.push(core.eventBus.onCoreEvent(eventName, (event) => {
          const serverId = String(event.serverId ?? core.webStatus.serverId ?? "").trim();
          if (!serverId) return;
          cleanupExpiredPending();
          clearPendingForServer(serverId);
        }));
      }
    },

    async stop() {
      for (const unsubscriber of unsubscribers.splice(0)) unsubscriber();
      pendingCreateLogs.clear();
    },
  };

  function handleCreateEvent(event) {
    cleanupExpiredPending();

    const parsed = parseSquadCreateEvent(event);
    if (!parsed) return;

    const serverId = String(parsed.serverId ?? event.serverId ?? core.webStatus.serverId ?? "").trim();
    if (!serverId || parsed.squadId == null) return;

    const matchId = resolveCurrentMatchId(serverId, parsed) || buildSyntheticMatchId(serverId, parsed);
    if (!matchId) return;

    reducer.setCurrentMatchId(serverId, matchId);
    parsed.matchId = matchId;

    if (parsed.teamId != null) {
      reducer.handleSquadCreateLogEvent(parsed);
      return;
    }

    const pending = {
      serverId,
      matchId,
      eventTime: parsed.eventTime,
      squadId: parsed.squadId,
      squadName: parsed.squadName,
      factionName: parsed.factionName,
      creatorName: parsed.creatorName,
      creatorSteamId: parsed.creatorSteamId,
      creatorEosId: parsed.creatorEosId,
      rawLog: parsed.rawLog,
      sourceEventId: parsed.sourceEventId,
      teamId: null,
      needsTeamId: true,
      createdAt: Date.now(),
    };

    const key = buildPendingKey(pending);
    pendingCreateLogs.set(key, pending);

    if (debugEnabled) {
      logWithFallback(moduleLogger, "info", `Queued pending squad create log for ${key}`, {
        operation: "squadLifecycle.pendingCreate",
        data: {
          serverId,
          matchId,
          squadId: pending.squadId,
          squadName: pending.squadName,
        },
      });
    }
  }

  function flushPendingForSnapshot(serverId, matchId, squads) {
    const pendingItems = [...pendingCreateLogs.values()].filter((item) => item.serverId === serverId && item.matchId === matchId);
    if (pendingItems.length === 0) return;

    for (const pending of pendingItems) {
      cleanupExpiredPending();
      const matched = findMatchedSnapshotSquad(pending, squads);
      if (!matched) continue;

      reducer.handleSquadCreateLogEvent({
        ...pending,
        teamId: matched.teamID ?? matched.teamId ?? null,
        squadName: matched.squadName ?? pending.squadName,
      });
      pendingCreateLogs.delete(buildPendingKey(pending));

      if (debugEnabled) {
        logWithFallback(moduleLogger, "info", `Flushed pending squad create log for ${pending.serverId}:${pending.matchId}:S${pending.squadId}`, {
          operation: "squadLifecycle.flushPending",
          data: {
            serverId: pending.serverId,
            matchId: pending.matchId,
            squadId: pending.squadId,
            squadName: pending.squadName,
            teamId: matched.teamID ?? null,
          },
        });
      }
    }
  }

  function cleanupExpiredPending() {
    const now = Date.now();
    for (const [key, pending] of [...pendingCreateLogs.entries()]) {
      const ageMs = now - Number(pending.createdAt ?? now);
      if (ageMs <= pendingCreateLogTtlMs) continue;

      pendingCreateLogs.delete(key);
      if (debugEnabled) {
        logWithFallback(moduleLogger, "info", `Expired pending squad create log ${key}`, {
          operation: "squadLifecycle.expirePending",
          data: {
            serverId: pending.serverId,
            matchId: pending.matchId,
            squadId: pending.squadId,
            squadName: pending.squadName,
            ageMs,
          },
        });
      }
    }
  }

  function clearPendingForServer(serverId) {
    const currentMatchId = reducer.getCurrentMatchId(serverId);
    for (const [key, pending] of [...pendingCreateLogs.entries()]) {
      if (pending.serverId !== serverId) continue;
      if (currentMatchId && pending.matchId !== currentMatchId) continue;
      pendingCreateLogs.delete(key);
    }

    if (!currentMatchId) {
      for (const [key, pending] of [...pendingCreateLogs.entries()]) {
        if (pending.serverId === serverId) pendingCreateLogs.delete(key);
      }
    }

    if (currentMatchId) {
      reducer.clearMatch(serverId, currentMatchId);
    } else {
      reducer.clearServer(serverId);
    }
  }

  function resolveCurrentMatchId(serverId, event) {
    const parsedMatchId = String(event?.matchId ?? event?.sessionId ?? event?.sessionID ?? "").trim();
    if (parsedMatchId) return parsedMatchId;
    return reducer.getCurrentMatchId(serverId);
  }

  function buildSyntheticMatchId(serverId, event) {
    const matchId = String(event?.matchId ?? event?.sessionId ?? event?.sessionID ?? "").trim();
    if (matchId) return matchId;
    return `synthetic:${serverId}:current`;
  }
}

function buildPendingKey(pending) {
  return `${pending.serverId}:${pending.matchId}:S${pending.squadId}:${normalizeSquadName(pending.squadName)}`;
}

function findMatchedSnapshotSquad(pending, squads) {
  const normalizedPendingName = normalizeSquadName(pending.squadName);
  const sameSquadId = squads.filter((squad) => Number(squad.squadID ?? squad.squadId ?? -1) === Number(pending.squadId));
  if (sameSquadId.length === 0) return null;

  const exactNameMatches = normalizedPendingName
    ? sameSquadId.filter((squad) => normalizeSquadName(squad.squadName ?? squad.name ?? "") === normalizedPendingName)
    : [];

  if (exactNameMatches.length === 1) return exactNameMatches[0];
  if (exactNameMatches.length > 1) return null;

  const emptyNameMatches = sameSquadId.filter((squad) => !normalizeSquadName(squad.squadName ?? squad.name ?? ""));
  if (pending.squadName && emptyNameMatches.length === 1) return emptyNameMatches[0];
  if (!pending.squadName && emptyNameMatches.length === 1) return emptyNameMatches[0];

  if (sameSquadId.length === 1) return sameSquadId[0];
  return null;
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

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return number;
}
