// -*- coding: utf-8 -*-

import {
  buildSquadLifecycleKey,
  buildSquadLifecycleSlotKey,
  createCurrentSnapshot,
  formatLifecycleRecord,
} from "./service.js";

export function createSquadLifecycleReducer({ config, logger } = {}) {
  const state = {
    recordsByKey: new Map(),
    latestKeyBySlot: new Map(),
    generationBySlot: new Map(),
    currentMatchIdByServer: new Map(),
    orderByMatchKey: new Map(),
    updatedAt: "",
  };

  function setCurrentMatchId(serverId, matchId) {
    const serverKey = String(serverId ?? "").trim();
    if (!serverKey) return;
    const matchKey = String(matchId ?? "").trim();
    if (!matchKey) {
      state.currentMatchIdByServer.delete(serverKey);
      return;
    }
    state.currentMatchIdByServer.set(serverKey, matchKey);
  }

  function getCurrentMatchId(serverId) {
    return state.currentMatchIdByServer.get(String(serverId ?? "").trim()) ?? "";
  }

  function getNextOrder(serverId, matchId) {
    const key = `${String(serverId ?? "").trim()}:${String(matchId ?? "").trim()}`;
    const next = Number(state.orderByMatchKey.get(key) ?? 0) + 1;
    state.orderByMatchKey.set(key, next);
    return next;
  }

  function handleSquadCreateLogEvent(logEvent) {
    const slotKey = buildSquadLifecycleSlotKey(logEvent.serverId, logEvent.matchId, logEvent.teamId, logEvent.squadId);
    const current = getCurrentRecord(slotKey);
    const eventCreatedAtMs = parseTimestamp(logEvent.eventTime);
    const logConfirmedAt = new Date().toISOString();
    const promoteRconRecord = Boolean(current && current.creationSource === "RCON_SNAPSHOT");
    const sameEvent = isSameCreationEvent(current, logEvent, eventCreatedAtMs);
    const shouldReuseCurrentRecord = Boolean(current) && (sameEvent || promoteRconRecord);
    const next = shouldReuseCurrentRecord
      ? { ...current }
      : createBaseRecord(logEvent, getNextOrder(logEvent.serverId, logEvent.matchId), getNextGeneration(slotKey));
    const key = buildSquadLifecycleKey(logEvent.serverId, logEvent.matchId, logEvent.teamId, logEvent.squadId, next.generation);
    const originalSquadName = String(logEvent.originalSquadName ?? logEvent.squadName ?? "").trim();
    const currentSquadName = String(logEvent.currentSquadName ?? next.currentSquadName ?? "").trim();

    next.key = key;
    next.slotKey = slotKey;
    next.serverId = String(logEvent.serverId ?? "").trim();
    next.matchId = String(logEvent.matchId ?? "").trim();
    next.teamId = logEvent.teamId ?? null;
    next.squadId = logEvent.squadId ?? null;
    next.originalSquadName = originalSquadName;
    next.currentSquadName = currentSquadName;
    // Backward-compatible squadName remains the authoritative log creation name once confirmed.
    next.squadName = originalSquadName || currentSquadName;
    next.factionName = String(logEvent.factionName ?? "").trim();
    next.creatorName = String(logEvent.creatorName ?? "").trim();
    next.creatorSteamId = String(logEvent.creatorSteamId ?? "").trim();
    next.creatorEosId = String(logEvent.creatorEosId ?? "").trim();
    next.rawLog = String(logEvent.rawLog ?? "");
    next.sourceEventId = String(logEvent.sourceEventId ?? "");
    next.sourceMode = String(logEvent.sourceMode ?? next.sourceMode ?? "live").trim().toLowerCase() || "live";
    next.canTriggerActions = logEvent.canTriggerActions !== false;
    next.logConfirmedAt = logConfirmedAt;

    if (Number.isFinite(eventCreatedAtMs)) {
      next.createdAtMs = eventCreatedAtMs;
      next.createdAt = new Date(eventCreatedAtMs).toISOString();
    }

    next.creationSource = "LOG";
    next.creationConfidence = "HIGH";
    if (promoteRconRecord) {
      next.rconPromotedToLog = true;
    } else if (next.rconPromotedToLog == null) {
      next.rconPromotedToLog = false;
    }

    upsertRecord(next);
    touchUpdatedAt();
    return state.recordsByKey.get(key);
  }

  function handleRconSquadSnapshot(snapshot) {
    const serverId = String(snapshot?.serverId ?? "").trim();
    const matchId = String(snapshot?.matchId ?? getCurrentMatchId(serverId) ?? "").trim();
    if (!serverId || !matchId) return [];

    setCurrentMatchId(serverId, matchId);

    const observedAtMs = parseTimestamp(snapshot?.observedAt ?? new Date().toISOString());
    const squads = Array.isArray(snapshot?.squads) ? snapshot.squads : [];
    const records = [];

    for (const squad of squads) {
      const teamId = squad.teamID ?? squad.teamId ?? null;
      const squadId = squad.squadID ?? squad.squadId ?? null;
      const currentSquadName = String(squad.squadName ?? squad.name ?? "").trim();
      const slotKey = buildSquadLifecycleSlotKey(serverId, matchId, teamId, squadId);
      const current = getCurrentRecord(slotKey);
      const next = current ? { ...current } : createBaseRecord({
        serverId,
        matchId,
        teamId,
        squadId,
        squadName: currentSquadName,
        factionName: squad.teamName ?? "",
        creatorName: squad.creatorName ?? "",
        creatorSteamId: squad.creatorSteamID ?? squad.creatorSteamId ?? "",
        creatorEosId: squad.creatorEOSID ?? squad.creatorEosId ?? "",
        rawLog: squad.raw ?? "",
        sourceEventId: squad.sourceEventId ?? "",
      }, getNextOrder(serverId, matchId), getNextGeneration(slotKey));

      const key = buildSquadLifecycleKey(serverId, matchId, teamId, squadId, next.generation);
      next.key = key;
      next.slotKey = slotKey;
      next.serverId = serverId;
      next.matchId = matchId;
      next.teamId = teamId;
      next.squadId = squadId;
      next.currentSquadName = currentSquadName;
      // RCON is current display state only. It must not overwrite a log-confirmed creation name.
      if (!String(next.originalSquadName ?? "").trim()) {
        next.squadName = currentSquadName;
      } else {
        next.squadName = String(next.originalSquadName).trim();
      }
      next.factionName = String(squad.teamName ?? next.factionName ?? "").trim();
      next.creatorName = String(squad.creatorName ?? next.creatorName ?? "").trim();
      next.creatorSteamId = String(squad.creatorSteamID ?? squad.creatorSteamId ?? next.creatorSteamId ?? "").trim();
      next.creatorEosId = String(squad.creatorEOSID ?? squad.creatorEosId ?? next.creatorEosId ?? "").trim();
      next.rawLog = String(squad.raw ?? next.rawLog ?? "");

      if (!current) {
        next.createdAtMs = observedAtMs;
        next.createdAt = new Date(observedAtMs).toISOString();
        next.creationSource = "RCON_SNAPSHOT";
        next.creationConfidence = "MEDIUM";
      }

      upsertRecord(next);
      records.push(state.recordsByKey.get(key));
    }

    touchUpdatedAt();
    return records;
  }

  function clearMatch(serverId, matchId) {
    const serverKey = String(serverId ?? "").trim();
    const matchKey = String(matchId ?? "").trim();
    if (!serverKey || !matchKey) return;

    for (const [key, record] of [...state.recordsByKey.entries()]) {
      if (record.serverId === serverKey && record.matchId === matchKey) {
        state.recordsByKey.delete(key);
      }
    }

    if (state.currentMatchIdByServer.get(serverKey) === matchKey) {
      state.currentMatchIdByServer.delete(serverKey);
    }

    state.orderByMatchKey.delete(`${serverKey}:${matchKey}`);
    for (const [slotKey, latestKey] of [...state.latestKeyBySlot.entries()]) {
      if (String(latestKey ?? "").startsWith(`${serverKey}:${matchKey}:`)) {
        state.latestKeyBySlot.delete(slotKey);
      }
    }
    for (const [slotKey, generation] of [...state.generationBySlot.entries()]) {
      if (String(slotKey).startsWith(`${serverKey}:${matchKey}:`)) {
        state.generationBySlot.delete(slotKey);
      }
    }
    touchUpdatedAt();
  }

  function clearServer(serverId) {
    const serverKey = String(serverId ?? "").trim();
    if (!serverKey) return;

    for (const [key, record] of [...state.recordsByKey.entries()]) {
      if (record.serverId === serverKey) {
        state.recordsByKey.delete(key);
      }
    }

    for (const currentKey of [...state.currentMatchIdByServer.keys()]) {
      if (currentKey === serverKey) {
        state.currentMatchIdByServer.delete(currentKey);
      }
    }

    for (const key of [...state.orderByMatchKey.keys()]) {
      if (key.startsWith(`${serverKey}:`)) {
        state.orderByMatchKey.delete(key);
      }
    }

    for (const slotKey of [...state.latestKeyBySlot.keys()]) {
      if (slotKey.startsWith(`${serverKey}:`)) {
        state.latestKeyBySlot.delete(slotKey);
      }
    }

    for (const slotKey of [...state.generationBySlot.keys()]) {
      if (slotKey.startsWith(`${serverKey}:`)) {
        state.generationBySlot.delete(slotKey);
      }
    }

    touchUpdatedAt();
  }

  function getCurrentSnapshot(serverId) {
    const serverKey = String(serverId ?? "").trim();
    const currentMatchId = getCurrentMatchId(serverKey) || findLatestMatchId(serverKey);
    const records = [...state.latestKeyBySlot.values()]
      .map((key) => state.recordsByKey.get(key) ?? null)
      .filter((record) => {
        if (!record) return false;
        if (record.serverId !== serverKey) return false;
        if (!currentMatchId) return true;
        return record.matchId === currentMatchId;
      });

    return createCurrentSnapshot({
      serverId: serverKey,
      matchId: currentMatchId || null,
      records,
      updatedAt: state.updatedAt || new Date().toISOString(),
    });
  }

  function getAllRecords() {
    return [...state.recordsByKey.values()];
  }

  function touchUpdatedAt() {
    state.updatedAt = new Date().toISOString();
  }

  function findLatestMatchId(serverId) {
    const serverKey = String(serverId ?? "").trim();
    const records = [...state.recordsByKey.values()].filter((record) => record.serverId === serverKey);
    if (records.length === 0) return "";
    let latestMatchId = "";
    let latestOrder = -1;

    for (const record of records) {
      const order = Number(record.order ?? 0);
      if (order >= latestOrder) {
        latestOrder = order;
        latestMatchId = String(record.matchId ?? "");
      }
    }

    return latestMatchId;
  }

  function getCurrentRecord(slotKey) {
    const key = state.latestKeyBySlot.get(slotKey);
    if (!key) return null;
    return state.recordsByKey.get(key) ?? null;
  }

  function getNextGeneration(slotKey) {
    const next = Number(state.generationBySlot.get(slotKey) ?? 0) + 1;
    state.generationBySlot.set(slotKey, next);
    return next;
  }

  function upsertRecord(record) {
    const formatted = formatLifecycleRecord(record);
    state.recordsByKey.set(formatted.key, formatted);
    state.latestKeyBySlot.set(formatted.slotKey, formatted.key);
    state.generationBySlot.set(formatted.slotKey, Number(formatted.generation ?? 0) || 1);
    return formatted;
  }

  return {
    setCurrentMatchId,
    getCurrentMatchId,
    handleSquadCreateLogEvent,
    handleRconSquadSnapshot,
    clearMatch,
    clearServer,
    getCurrentSnapshot,
    getAllRecords,
  };
}

function createBaseRecord(source, order, generation) {
  return {
    key: "",
    order: Number(order ?? 0),
    serverId: String(source.serverId ?? "").trim(),
    matchId: String(source.matchId ?? "").trim(),
    teamId: source.teamId ?? null,
    squadId: source.squadId ?? null,
    squadName: String(source.squadName ?? "").trim(),
    originalSquadName: String(source.originalSquadName ?? "").trim(),
    currentSquadName: String(source.currentSquadName ?? source.squadName ?? "").trim(),
    factionName: String(source.factionName ?? "").trim(),
    creatorName: String(source.creatorName ?? "").trim(),
    creatorSteamId: String(source.creatorSteamId ?? "").trim(),
    creatorEosId: String(source.creatorEosId ?? "").trim(),
    rawLog: String(source.rawLog ?? ""),
    sourceEventId: String(source.sourceEventId ?? ""),
    sourceMode: String(source.sourceMode ?? "live").trim().toLowerCase() || "live",
    canTriggerActions: source.canTriggerActions !== false,
    slotKey: "",
    generation: Number(generation ?? source.generation ?? 0) || 1,
    createdAtMs: 0,
    createdAt: null,
    creationSource: "RCON_SNAPSHOT",
    creationConfidence: "MEDIUM",
    logConfirmedAt: null,
    rconPromotedToLog: false,
  };
}

function parseTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value) return Date.now();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function isSameCreationEvent(current, logEvent, nextCreatedAtMs) {
  if (!current) return false;

  const currentSourceEventId = String(current.sourceEventId ?? "").trim();
  const nextSourceEventId = String(logEvent.sourceEventId ?? "").trim();
  if (currentSourceEventId && nextSourceEventId && currentSourceEventId === nextSourceEventId) {
    return true;
  }

  const currentRawLog = String(current.rawLog ?? "");
  const nextRawLog = String(logEvent.rawLog ?? "");
  if (currentRawLog && nextRawLog && currentRawLog === nextRawLog) {
    const currentCreatedAtMs = Number(current.createdAtMs ?? 0);
    if (currentCreatedAtMs > 0 && Number.isFinite(nextCreatedAtMs) && currentCreatedAtMs === nextCreatedAtMs) {
      return true;
    }
  }

  return false;
}
