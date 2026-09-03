// -*- coding: utf-8 -*-

import { parseSquadCreateEvent, normalizeSquadName } from "./log-adapter.js";
import { createSquadLifecycleReducer } from "./reducer.js";
import { classifySquadName } from "../../domain/squad/squad_name_classifier.js";
import crypto from "node:crypto";
import {
  clearTeamFactionMappings,
  getTeamIdByFactionName,
  rememberTeamFactionMappings,
} from "../../core/team-faction-cache.js";

const MATCH_END_EVENTS = ["GAME_END", "MATCH_END", "ROUND_END", "ROUND_ENDED", "NEW_GAME"];
const PENDING_CREATE_LOG_TTL_MS = 5 * 60 * 1000;
const CREATE_EVENT_DEDUPE_TTL_MS = 10_000;

export function createSquadLifecycleModule({ core, modules, config, logger }) {
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
  const replayPendingCreates = new Map();
  const replayRejected = [];
  const stableCreateEventKeys = new Set();
  let replayStatus = createReplayStatus();
  const recentCreateEventKeys = new Map();
  const unsubscribers = [];

  const api = {
    getCurrent(serverId = core.webStatus.serverId) {
      return reducer.getCurrentSnapshot(serverId);
    },

    getPendingCount() {
      return pendingCreateLogs.size;
    },

    getReplayStatus() {
      return { ...replayStatus, pendingTeamResolution: replayPendingCreates.size };
    },

    getReplayRejected() {
      return replayRejected.map((record) => ({ ...record }));
    },

    importReplayCreate,
    importReplayCreateBatch,
    updateReplayProgress,
    finalizeReplay,

    getCurrentMatchId(serverId = core.webStatus.serverId) {
      return reducer.getCurrentMatchId(serverId);
    },

    clearCurrent(serverId = core.webStatus.serverId) {
      const normalizedServerId = String(serverId ?? core.webStatus.serverId ?? "").trim();
      if (!normalizedServerId) return;
      cleanupExpiredPending();
      clearPendingForServer(normalizedServerId);
      clearReplayStateForServer(normalizedServerId);
    },
  };

  return {
    manifest: {
      id: "module.squadLifecycle",
      name: "Squad Lifecycle Module",
      kind: "module",
      version: "0.2.1",
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
        const matchId = resolveCurrentMatchId(serverId, event);
        if (!matchId) return;

        const previousMatchId = reducer.getCurrentMatchId(serverId);
        if (previousMatchId && previousMatchId !== matchId) {
          clearPendingForServer(serverId);
        }

        reducer.setCurrentMatchId(serverId, matchId);
        flushPendingForSnapshot(serverId, matchId, Array.isArray(event.squads) ? event.squads : []);
        flushReplayPending(serverId, matchId);
        reducer.handleRconSquadSnapshot({
          serverId,
          matchId,
          observedAt: event.time ?? new Date().toISOString(),
          squads: Array.isArray(event.squads) ? event.squads : [],
        });
      }));

      unsubscribers.push(core.eventBus.onModuleEvent("module.matchState", "roundUpdated", (event) => {
        const serverId = String(event?.serverId ?? core.webStatus.serverId ?? "").trim();
        const matchId = String(event?.matchId ?? "").trim();
        if (!serverId || !matchId) return;
        reducer.setCurrentMatchId(serverId, matchId);
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
      replayPendingCreates.clear();
      replayRejected.splice(0);
      stableCreateEventKeys.clear();
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
            matchId: reducer.getCurrentMatchId(event?.serverId ?? core.webStatus.serverId ?? ""),
          },
        });
      }
      return;
    }

    const serverId = String(parsed.serverId ?? event.serverId ?? core.webStatus.serverId ?? "").trim();
    if (!serverId || parsed.squadId == null) return;

    // Historical log records rebuild only the in-memory creation order. They
    // must never enter the live squadCreated channel used by enforcement,
    // warnings, broadcasts, or other real-time consumers.
    const sourceMode = String(parsed.sourceMode ?? event?.sourceMode ?? event?.rawEvent?.SourceMode ?? "").trim().toLowerCase();
    if (sourceMode === "replay" || parsed.isReplay === true || event?.isReplay === true) {
      return importReplayCreate({
        ...parsed,
        serverId,
        sourceMode: "replay",
        isReplay: true,
        canTriggerActions: false,
      });
    }

    const matchId = resolveCurrentMatchId(serverId, parsed);
    if (!matchId) return;

    reducer.setCurrentMatchId(serverId, matchId);
    parsed.matchId = matchId;

    if (isDuplicateCreateEvent(serverId, parsed) || hasStableCreateEvent(serverId, parsed)) {
      if (debugEnabled) {
        logWithFallback(moduleLogger, "info", "[SquadLifecycle] duplicate squad create event ignored", {
          operation: "squadLifecycle.createDuplicateIgnored",
          data: {
            serverId,
            matchId,
            eventName: String(event?.eventName ?? event?.Event ?? event?.rawEvent?.Event ?? event?.rawEvent?.eventName ?? ""),
            parsedFromRawLogLine: Boolean(parsed.parsedFromRawLogLine),
            sourceEventId: String(parsed.sourceEventId ?? ""),
            rawLogHash: buildRawLogHash(parsed.rawLog),
            dedupeKey: buildCreateEventDedupeKey(serverId, parsed),
            squadId: parsed.squadId,
            squadName: parsed.squadName,
            creatorName: parsed.creatorName,
          },
        });
      }
      return;
    }

    if (parsed.teamId == null) {
      const mappedTeamId = getTeamIdByFactionName(serverId, parsed.factionName);
      if (mappedTeamId != null) {
        parsed.teamId = mappedTeamId;
        parsed.needsTeamId = false;
      }
    }
    if (parsed.teamId == null) {
      const creatorTeamId = resolveCreatorTeamId(serverId, parsed);
      if (creatorTeamId != null) {
        parsed.teamId = creatorTeamId;
        parsed.needsTeamId = false;
      }
    }
    rememberCreateEvent(serverId, parsed);

    logWithFallback(moduleLogger, "info", `/xm [SquadLifecycle] squad create accepted: S${parsed.squadId} ${parsed.squadName} by ${parsed.creatorName || "unknown"}`, {
      operation: "squadLifecycle.createAccepted",
      data: {
        serverId,
        matchId,
        teamId: parsed.teamId,
        squadId: parsed.squadId,
        squadName: parsed.squadName,
        creatorName: parsed.creatorName,
        parsedFromRawLogLine: Boolean(parsed.parsedFromRawLogLine),
        sourceMode: parsed.sourceMode,
        canTriggerActions: parsed.canTriggerActions,
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
      sourceFile: parsed.sourceFile,
      sourceFileId: parsed.sourceFileId,
      sourceOffset: parsed.sourceOffset,
      sourceMode: parsed.sourceMode,
      canTriggerActions: parsed.canTriggerActions,
      parsedFromRawLogLine: Boolean(parsed.parsedFromRawLogLine),
      teamId: null,
      needsTeamId: true,
      createdAt: Date.now(),
    };

    const key = buildPendingKey(pending);
    const existingPending = pendingCreateLogs.get(key);
    if (existingPending) {
      existingPending.matchId = pending.matchId;
      existingPending.eventTime = pending.eventTime;
      existingPending.factionName = pending.factionName;
      existingPending.creatorName = pending.creatorName;
      existingPending.creatorSteamId = pending.creatorSteamId;
      existingPending.creatorEosId = pending.creatorEosId;
      existingPending.rawLog = pending.rawLog;
      existingPending.sourceEventId = pending.sourceEventId;
      existingPending.sourceMode = pending.sourceMode;
      existingPending.canTriggerActions = pending.canTriggerActions;
      existingPending.parsedFromRawLogLine = pending.parsedFromRawLogLine;
      existingPending.teamId = pending.teamId;
      existingPending.needsTeamId = pending.needsTeamId;
      if (debugEnabled) {
        logWithFallback(moduleLogger, "info", "[SquadLifecycle] merged duplicate pending squad create log", {
          operation: "squadLifecycle.pendingCreateMerged",
          data: {
            serverId,
            matchId,
            dedupeKey: key,
            squadId: pending.squadId,
            squadName: pending.squadName,
          },
        });
      }
      return;
    }

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
    rememberTeamFactionMappings(serverId, squads);
    const pendingItems = [...pendingCreateLogs.values()].filter((item) => item.serverId === serverId && item.matchId === matchId);
    if (pendingItems.length === 0) return;

    for (const pending of pendingItems) {
      cleanupExpiredPending();

      const creatorTeamId = resolveCreatorTeamId(serverId, pending);
      if (creatorTeamId != null) {
        const resolvedParsed = {
          ...pending,
          teamId: creatorTeamId,
          needsTeamId: false,
          squadName: pending.squadName,
          originalSquadName: pending.squadName,
          currentSquadName: "",
        };
        const record = reducer.handleSquadCreateLogEvent(resolvedParsed);
        pendingCreateLogs.delete(buildPendingKey(pending));
        emitSquadCreatedEvent(serverId, matchId, resolvedParsed, record);
        continue;
      }

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

      // The log creation name is authoritative. RCON only supplies the missing TeamID
      // and the current display name; it must never replace the original creation name.
      const currentSquadName = String(matched.squadName ?? matched.name ?? "").trim();
      const flushedParsed = {
        ...pending,
        teamId: matched.teamID ?? matched.teamId ?? null,
        squadName: pending.squadName,
        originalSquadName: pending.squadName,
        currentSquadName,
      };
      const record = reducer.handleSquadCreateLogEvent(flushedParsed);
      pendingCreateLogs.delete(buildPendingKey(pending));
      emitSquadCreatedEvent(serverId, matchId, flushedParsed, record);

      logWithFallback(moduleLogger, "info", `[SquadLifecycle] pending create flushed to LOG: T${matched.teamID ?? matched.teamId ?? ""} S${pending.squadId} ${pending.squadName || currentSquadName || ""}`, {
        operation: "squadLifecycle.flushPending",
        data: {
          serverId: pending.serverId,
          matchId: pending.matchId,
          squadId: pending.squadId,
          squadName: pending.squadName,
          currentSquadName,
          teamId: matched.teamID ?? matched.teamId ?? null,
          sourceMode: pending.sourceMode,
          canTriggerActions: pending.canTriggerActions,
        },
      });
    }
  }

  function resolveCreatorTeamId(serverId, source = {}) {
    const playerState = modules?.playerState?.api ?? modules?.playerState;
    if (!playerState) return null;

    let player = null;
    if (typeof playerState.findPlayer === "function") {
      player = playerState.findPlayer(serverId, {
        steamID: source.creatorSteamId,
        eosID: source.creatorEosId,
        name: source.creatorName,
      });
    } else if (source.creatorSteamId && typeof playerState.getPlayerBySteamID === "function") {
      player = playerState.getPlayerBySteamID(serverId, source.creatorSteamId);
    } else if (source.creatorEosId && typeof playerState.getPlayerByEOSID === "function") {
      player = playerState.getPlayerByEOSID(serverId, source.creatorEosId);
    } else if (source.creatorName && typeof playerState.getPlayerByName === "function") {
      player = playerState.getPlayerByName(serverId, source.creatorName);
    }

    return toNumber(player?.teamID ?? player?.teamId);
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
    clearTeamFactionMappings(serverId);
  }

  function resolveCurrentMatchId(serverId, event) {
    const matchState = modules?.matchState?.api ?? modules?.matchState;
    return String(matchState?.getCurrentMatchId?.() ?? "").trim();
  }

  function rememberCreateEvent(serverId, parsed) {
    const key = buildCreateEventDedupeKey(serverId, parsed);
    recentCreateEventKeys.set(key, Date.now());
    rememberStableCreateEvent(serverId, parsed);
  }

  function importReplayCreate(record = {}) {
    if (String(record.sourceMode ?? "").trim().toLowerCase() !== "replay") {
      return { ok: false, code: "invalid_source_mode" };
    }
    if (record.canTriggerActions !== false) {
      return { ok: false, code: "replay_actions_must_be_disabled" };
    }

    const serverId = String(record.serverId ?? core.webStatus.serverId ?? "").trim();
    if (!serverId || record.squadId == null) return { ok: false, code: "missing_required_fields" };
    const matchId = String(record.matchId ?? "").trim();
    if (!matchId) return { ok: false, code: "canonical_match_id_unavailable" };
    const normalized = {
      ...record,
      serverId,
      matchId,
      sourceMode: "replay",
      isReplay: true,
      canTriggerActions: false,
      originalSquadName: String(record.originalSquadName ?? record.squadName ?? "").trim(),
      sourceEventId: String(record.sourceEventId || buildReplayId(record)),
    };
    replayStatus.squadCreatesFound += 1;

    if (hasStableCreateEvent(serverId, normalized)) {
      replayStatus.duplicates += 1;
      return { ok: true, status: "duplicate" };
    }

    if (normalized.teamId == null) {
      normalized.teamId = getTeamIdByFactionName(serverId, normalized.factionName);
    }
    rememberStableCreateEvent(serverId, normalized);
    if (normalized.teamId == null) {
      replayPendingCreates.set(buildReplayId(normalized), normalized);
      replayStatus.pendingTeamResolution = replayPendingCreates.size;
      return { ok: true, status: "pending_team_resolution" };
    }

    reducer.setCurrentMatchId(serverId, matchId);
    const imported = reducer.handleSquadCreateLogEvent(normalized);
    replayStatus.accepted += 1;
    return { ok: true, status: "accepted", record: imported };
  }

  function importReplayCreateBatch(records = []) {
    const result = { found: 0, accepted: 0, rejectedPolicy: 0, duplicates: 0, pendingTeamResolution: 0 };
    for (const record of Array.isArray(records) ? records : []) {
      result.found += 1;
      const imported = importReplayCreate(record);
      if (imported.status === "accepted") result.accepted += 1;
      else if (imported.status === "rejected") result.rejectedPolicy += 1;
      else if (imported.status === "duplicate") result.duplicates += 1;
      else if (imported.status === "pending_team_resolution") result.pendingTeamResolution += 1;
    }
    return result;
  }

  function flushReplayPending(serverId, matchId) {
    for (const [replayId, pending] of [...replayPendingCreates.entries()]) {
      if (pending.serverId !== serverId) continue;
      const teamId = getTeamIdByFactionName(serverId, pending.factionName);
      if (teamId == null) continue;
      const normalized = { ...pending, matchId: matchId || pending.matchId, teamId };
      reducer.setCurrentMatchId(serverId, normalized.matchId);
      reducer.handleSquadCreateLogEvent(normalized);
      replayPendingCreates.delete(replayId);
      replayStatus.accepted += 1;
    }
    replayStatus.pendingTeamResolution = replayPendingCreates.size;
    if (replayStatus.status === "completed") reducer.rebuildCreationOrder(serverId, matchId);
    if (replayStatus.status === "resolving" && replayPendingCreates.size === 0) {
      finalizeReplay({ ...replayStatus, serverId, error: "" });
    }
  }

  function updateReplayProgress(progress = {}) {
    replayStatus = {
      ...replayStatus,
      ...progress,
      status: String(progress.status ?? replayStatus.status ?? "scanning"),
      pendingTeamResolution: replayPendingCreates.size,
    };
    return api.getReplayStatus();
  }

  function finalizeReplay(details = {}) {
    replayStatus.status = details.error ? "failed" : "rebuilding";
    replayStatus.error = String(details.error ?? "");
    const serverId = String(details.serverId ?? core.webStatus.serverId ?? "").trim();
    const matchId = reducer.getCurrentMatchId(serverId);
    const rebuilt = details.error ? { count: 0, matchId } : reducer.rebuildCreationOrder(serverId, matchId);
    const awaitingTeamResolution = !details.error && replayPendingCreates.size > 0;
    replayStatus = {
      ...replayStatus,
      ...details,
      status: details.error ? "failed" : awaitingTeamResolution ? "resolving" : "completed",
      progress: details.error ? replayStatus.progress : 100,
      pendingTeamResolution: replayPendingCreates.size,
      completedAt: awaitingTeamResolution ? "" : new Date().toISOString(),
    };
    return { ...rebuilt, replay: api.getReplayStatus() };
  }

  function rememberStableCreateEvent(serverId, parsed) {
    for (const key of buildStableCreateEventKeys(serverId, parsed)) stableCreateEventKeys.add(key);
  }

  function hasStableCreateEvent(serverId, parsed) {
    return buildStableCreateEventKeys(serverId, parsed).some((key) => stableCreateEventKeys.has(key));
  }

  function buildStableCreateEventKeys(serverId, parsed) {
    const keys = [];
    const fileId = String(parsed.sourceFileId ?? parsed.sourceFile ?? "").trim();
    const offset = Number(parsed.sourceOffset);
    if (fileId && Number.isFinite(offset) && offset >= 0) keys.push(`${serverId}:offset:${fileId}:${offset}`);
    const rawHash = buildRawLogHash(parsed.rawLog);
    if (rawHash) keys.push(`${serverId}:raw:${rawHash}`);
    return keys;
  }

  function clearReplayStateForServer(serverId) {
    for (const [key, pending] of [...replayPendingCreates.entries()]) {
      if (pending.serverId === serverId) replayPendingCreates.delete(key);
    }
    replayRejected.splice(0);
    stableCreateEventKeys.clear();
    replayStatus = createReplayStatus();
  }

  function isDuplicateCreateEvent(serverId, parsed) {
    cleanupExpiredCreateEventKeys();
    const key = buildCreateEventDedupeKey(serverId, parsed);
    return recentCreateEventKeys.has(key);
  }

  function buildCreateEventDedupeKey(serverId, parsed) {
    const rawLogHash = buildRawLogHash(parsed.rawLog);
    if (rawLogHash) {
      return [
        String(serverId ?? "").trim(),
        `rawLogHash:${rawLogHash}`,
      ].join(":");
    }

    const sourceEventId = String(parsed.sourceEventId ?? "").trim();
    if (sourceEventId) {
      return [
        String(serverId ?? "").trim(),
        `sourceEventId:${sourceEventId}`,
      ].join(":");
    }

    return [
      String(serverId ?? "").trim(),
      String(parsed.matchId ?? "").trim(),
      String(parsed.squadId ?? "").trim(),
      normalizeSquadName(parsed.squadName),
      String(parsed.creatorSteamId ?? "").trim(),
      String(parsed.creatorEosId ?? "").trim(),
      normalizeSquadName(parsed.creatorName),
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
      sourceMode: pending.sourceMode ?? "live",
      canTriggerActions: pending.canTriggerActions !== false,
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
    if (shouldSuppressModuleSquadCreatedEvent(record, parsed)) {
      return;
    }
    const createdAtMs = Number(record?.createdAtMs ?? parseTimestamp(parsed.eventTime));
    const createdAt = Number.isFinite(createdAtMs) && createdAtMs > 0
      ? new Date(createdAtMs).toISOString()
      : String(parsed.eventTime ?? "");
    const originalSquadName = String(parsed.originalSquadName ?? parsed.squadName ?? "").trim();
    const currentSquadName = String(parsed.currentSquadName ?? "").trim();
    const classification = classifySquadName(originalSquadName);
    const creationSignature = buildCreationSignature({
      serverId,
      matchId,
      squadId: parsed.squadId,
      squadName: originalSquadName,
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
      sourceMode: String(parsed.sourceMode ?? "live").trim().toLowerCase() || "live",
      canTriggerActions: parsed.canTriggerActions !== false,
      serverId,
      matchId,
      time: new Date().toISOString(),
      squadId: parsed.squadId,
      squadName: originalSquadName,
      originalSquadName,
      currentSquadName,
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

  function buildRawLogHash(rawLog) {
    const text = String(rawLog ?? "").trim();
    if (!text) return "";
    return crypto.createHash("sha1").update(text).digest("hex");
  }

  function shouldSuppressModuleSquadCreatedEvent(record, parsed) {
    if (!record) return false;
    if (record.creationSource === "LOG") return false;
    if (parsed?.parsedFromRawLogLine) return false;
    return true;
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

function toNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

function buildReplayId(record = {}) {
  const fileId = String(record.sourceFileId ?? record.sourceFile ?? "unknown").trim() || "unknown";
  const offset = Number(record.sourceOffset);
  if (Number.isFinite(offset) && offset >= 0) return `squadcreate:${fileId}:${offset}`;
  const raw = String(record.rawLog ?? "").trim();
  if (raw) return `squadcreate:raw:${crypto.createHash("sha1").update(raw).digest("hex")}`;
  return `squadcreate:fallback:${[
    record.eventTime,
    record.creatorSteamId || record.creatorEosId || record.creatorName,
    record.squadId,
    normalizeSquadName(record.squadName),
  ].join(":")}`;
}

function createReplayStatus() {
  return {
    status: "idle",
    progress: 0,
    scannedBytes: 0,
    totalBytes: 0,
    scannedLines: 0,
    squadCreatesFound: 0,
    accepted: 0,
    rejectedPolicy: 0,
    duplicates: 0,
    pendingTeamResolution: 0,
    startedAt: "",
    completedAt: "",
    error: "",
  };
}
