// -*- coding: utf-8 -*-

import { parseSquadCreateEvent, normalizeSquadName } from "./log-adapter.js";
import { createSquadLifecycleReducer } from "./reducer.js";
import { classifySquadName } from "../../domain/squad/squad_name_classifier.js";

const MATCH_END_EVENTS = ["GAME_END", "MATCH_END", "ROUND_END", "ROUND_ENDED", "NEW_GAME"];
const PENDING_CREATE_LOG_TTL_MS = 5 * 60 * 1000;
const CREATE_EVENT_DEDUPE_TTL_MS = 10_000;

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
  const recentCreateEventKeys = new Map();
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
      unsubscribers.push(core.eventBus.onCoreEvent("On_RawLogLine", (event) => {
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
      recentCreateEventKeys.clear();
    },
  };

  function handleCreateEvent(event) {
    cleanupExpiredPending();

    const parsed = parseSquadCreateEvent(event);
    if (!parsed) {
      if (looksLikeSquadCreateRawLog(event)) {
        logWithFallback(moduleLogger, "warn", "[SquadLifecycle] raw squad create log could not be parsed", {
          operation: "squadLifecycle.rawCreateParseFailed",
          data: {
            serverId: String(event?.serverId ?? core.webStatus.serverId ?? "").trim(),
            matchId: String(event?.matchId ?? event?.sessionId ?? event?.sessionID ?? "").trim() || reducer.getCurrentMatchId(event?.serverId ?? core.webStatus.serverId ?? ""),
          },
        });
      }
      return;
    }

    const serverId = String(parsed.serverId ?? event.serverId ?? core.webStatus.serverId ?? "").trim();
    if (!serverId || parsed.squadId == null) return;

    if (isDuplicateCreateEvent(serverId, parsed)) {
      if (debugEnabled) {
        logWithFallback(moduleLogger, "info", "[SquadLifecycle] duplicate squad create event ignored", {
          operation: "squadLifecycle.createDuplicateIgnored",
          data: {
            serverId,
            matchId: String(parsed.matchId ?? event?.matchId ?? event?.sessionId ?? event?.sessionID ?? "").trim(),
            squadId: parsed.squadId,
            squadName: parsed.squadName,
            creatorName: parsed.creatorName,
            parsedFromRawLogLine: Boolean(parsed.parsedFromRawLogLine),
          },
        });
      }
      return;
    }

    const matchId = resolveCurrentMatchId(serverId, parsed) || buildSyntheticMatchId(serverId, parsed);
    if (!matchId) return;

    reducer.setCurrentMatchId(serverId, matchId);
    parsed.matchId = matchId;
    rememberCreateEvent(serverId, parsed);

    logWithFallback(moduleLogger, "info", `/xm [SquadLifecycle] squad create accepted: S${parsed.squadId} ${parsed.squadName}`, {
      operation: "squadLifecycle.createAccepted",
      data: {
        serverId,
        matchId,
        teamId: parsed.teamId,
        squadId: parsed.squadId,
        squadName: parsed.squadName,
        creatorName: parsed.creatorName,
        parsedFromRawLogLine: Boolean(parsed.parsedFromRawLogLine),
      },
    });

    if (parsed.teamId != null) {
      const record = reducer.handleSquadCreateLogEvent(parsed);
      emitSquadCreatedEvent(serverId, matchId, parsed, record);
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
    emitSquadCreatedEvent(serverId, matchId, parsed, null);

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
      if (!matched) {
        logWithFallback(moduleLogger, "warn", "[SquadLifecycle] pending create did not match current RCON squads", {
          operation: "squadLifecycle.flushPendingUnmatched",
          data: {
            serverId,
            matchId,
            pending: describePendingCreate(pending),
            squads: squads.map(describeRconSquad),
          },
        });
        continue;
      }

      const flushedParsed = {
        ...pending,
        teamId: matched.teamID ?? matched.teamId ?? null,
        squadName: matched.squadName ?? pending.squadName,
      };
      const record = reducer.handleSquadCreateLogEvent(flushedParsed);
      pendingCreateLogs.delete(buildPendingKey(pending));
      emitSquadCreatedEvent(serverId, matchId, flushedParsed, record);

      logWithFallback(moduleLogger, "info", `[SquadLifecycle] pending create flushed to LOG: T${matched.teamID ?? matched.teamId ?? ""} S${pending.squadId} ${pending.squadName || matched.squadName || ""}`, {
        operation: "squadLifecycle.flushPending",
        data: {
          serverId: pending.serverId,
          matchId: pending.matchId,
          squadId: pending.squadId,
          squadName: pending.squadName,
          teamId: matched.teamID ?? matched.teamId ?? null,
        },
      });
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

  function rememberCreateEvent(serverId, parsed) {
    const key = buildCreateEventDedupeKey(serverId, parsed);
    recentCreateEventKeys.set(key, Date.now());
  }

  function isDuplicateCreateEvent(serverId, parsed) {
    cleanupExpiredCreateEventKeys();
    const key = buildCreateEventDedupeKey(serverId, parsed);
    return recentCreateEventKeys.has(key);
  }

  function buildCreateEventDedupeKey(serverId, parsed) {
    return [
      String(serverId ?? "").trim(),
      String(parsed.matchId ?? "").trim(),
      String(parsed.squadId ?? "").trim(),
      normalizeSquadName(parsed.squadName),
      normalizeSquadName(parsed.creatorName),
      String(parsed.creatorSteamId ?? "").trim(),
      normalizeEventTimeToSeconds(parsed.eventTime),
    ].join(":");
  }

  function cleanupExpiredCreateEventKeys() {
    const now = Date.now();
    for (const [key, createdAt] of [...recentCreateEventKeys.entries()]) {
      if (now - Number(createdAt ?? now) <= CREATE_EVENT_DEDUPE_TTL_MS) continue;
      recentCreateEventKeys.delete(key);
    }
  }

  function describePendingCreate(pending) {
    return {
      serverId: pending.serverId,
      matchId: pending.matchId,
      teamId: pending.teamId ?? null,
      squadId: pending.squadId ?? null,
      squadName: pending.squadName ?? "",
      creatorName: pending.creatorName ?? "",
    };
  }

  function describeRconSquad(squad) {
    return {
      teamID: squad?.teamID ?? squad?.teamId ?? null,
      squadID: squad?.squadID ?? squad?.squadId ?? null,
      squadName: squad?.squadName ?? squad?.name ?? "",
      creatorName: squad?.creatorName ?? "",
    };
  }

  function emitSquadCreatedEvent(serverId, matchId, parsed, record) {
    const createdAtMs = Number(record?.createdAtMs ?? parseTimestamp(parsed.eventTime));
    const createdAt = Number.isFinite(createdAtMs) && createdAtMs > 0
      ? new Date(createdAtMs).toISOString()
      : String(parsed.eventTime ?? "");
    const classification = classifySquadName(parsed.squadName);
    const creationSignature = buildCreationSignature({
      serverId,
      matchId,
      squadId: parsed.squadId,
      squadName: parsed.squadName,
      creatorName: parsed.creatorName,
      creatorSteamId: parsed.creatorSteamId,
      creatorEosId: parsed.creatorEosId,
      createdAtMs,
    });

    core.eventBus.emitModuleEvent("module.squadLifecycle", "squadCreated", {
      eventId: `module.squadLifecycle:${Date.now()}`,
      eventName: "module.squadLifecycle.squadCreated",
      layer: "module",
      source: "module.squadLifecycle",
      serverId,
      matchId,
      time: new Date().toISOString(),
      squadId: parsed.squadId,
      squadName: parsed.squadName,
      factionName: parsed.factionName,
      teamId: parsed.teamId ?? record?.teamId ?? null,
      creatorName: parsed.creatorName,
      creatorSteamId: parsed.creatorSteamId,
      creatorEosId: parsed.creatorEosId,
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
      sourceEventId: parsed.sourceEventId ?? "",
      creationSource: record?.creationSource ?? "LOG",
      createdAtMs,
      createdAt,
      creationSignature,
      record: record ? { ...record } : null,
    });
  }
}

function buildPendingKey(pending) {
  return `${pending.serverId}:${pending.matchId}:S${pending.squadId}:${normalizeSquadName(pending.squadName)}`;
}

function findMatchedSnapshotSquad(pending, squads) {
  const sameSquadId = squads.filter((squad) => Number(squad.squadID ?? squad.squadId ?? -1) === Number(pending.squadId));
  if (sameSquadId.length === 0) return null;

  if (sameSquadId.length === 1) return sameSquadId[0];

  const creatorNameMatches = exactMatchFilter(sameSquadId, pending.creatorName, (squad) => squad.creatorName ?? "");
  if (creatorNameMatches.length === 1) return creatorNameMatches[0];

  const squadNameMatches = exactMatchFilter(sameSquadId, pending.squadName, (squad) => squad.squadName ?? squad.name ?? "");
  if (squadNameMatches.length === 1) return squadNameMatches[0];

  const factionNameMatches = exactMatchFilter(sameSquadId, pending.factionName, (squad) => squad.teamName ?? squad.factionName ?? "");
  if (factionNameMatches.length === 1) return factionNameMatches[0];

  return null;
}

function exactMatchFilter(items, expected, getValue) {
  const target = String(expected ?? "").trim();
  if (!target) return [];
  return items.filter((item) => String(getValue(item) ?? "").trim() === target);
}

function normalizeEventTimeToSeconds(value) {
  const parsed = Date.parse(String(value ?? ""));
  if (!Number.isFinite(parsed)) return "";
  return String(Math.floor(parsed / 1000));
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

function looksLikeSquadCreateRawLog(event) {
  const rawLog = String(event?.rawLog ?? event?.rawEvent?.Raw ?? event?.sourceRaw ?? event?.raw ?? "").trim();
  return /LogSquad:/i.test(rawLog) && /has created Squad/i.test(rawLog);
}

function parseTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value) return Date.now();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function buildCreationSignature(source = {}) {
  const creatorKey = buildCreatorKey(source);
  const createdAtMs = Number.isFinite(Number(source.createdAtMs)) ? Number(source.createdAtMs) : Date.now();
  const timeBucket = Math.floor(createdAtMs / 10000);

  return [
    String(source.serverId ?? "").trim(),
    String(source.matchId ?? "").trim(),
    String(source.squadId ?? "").trim(),
    normalizeSquadName(source.squadName),
    creatorKey,
    String(timeBucket),
  ].join(":");
}

function buildCreatorKey(source = {}) {
  const steamId = String(source.creatorSteamId ?? source.creatorSteamID ?? "").trim();
  const eosId = String(source.creatorEosId ?? source.creatorEOSID ?? "").trim();
  const name = normalizeSquadName(source.creatorName);
  if (steamId) return `steam:${steamId}`;
  if (eosId) return `eos:${eosId}`;
  if (name) return `name:${name}`;
  return "";
}
