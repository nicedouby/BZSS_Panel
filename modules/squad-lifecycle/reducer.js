// -*- coding: utf-8 -*-

import { buildSquadLifecycleKey, createCurrentSnapshot, formatLifecycleRecord } from "./service.js";

export function createSquadLifecycleReducer({ config, logger } = {}) {
  const state = {
    recordsByKey: new Map(),
    currentMatchIdByServer: new Map(),
    orderByMatchKey: new Map(),
    updatedAt: "",
  };
  const moduleConfig = config?.get?.("modules.squadLifecycle", {}) ?? {};
  const preferLogCreateEvent = Boolean(moduleConfig.preferLogCreateEvent ?? moduleConfig.preferLogCreatedAt ?? true);

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
    const key = buildSquadLifecycleKey(logEvent.serverId, logEvent.matchId, logEvent.teamId, logEvent.squadId);
    const current = state.recordsByKey.get(key) ?? null;
    const next = current ? { ...current } : createBaseRecord(logEvent, getNextOrder(logEvent.serverId, logEvent.matchId));
    const nextCreatedAtMs = parseTimestamp(logEvent.eventTime);
    const shouldPromoteLogTimestamp = !current
      || (current.creationSource === "RCON_SNAPSHOT" && preferLogCreateEvent);

    next.key = key;
    next.serverId = String(logEvent.serverId ?? "").trim();
    next.matchId = String(logEvent.matchId ?? "").trim();
    next.teamId = logEvent.teamId ?? null;
    next.squadId = logEvent.squadId ?? null;
    next.squadName = String(logEvent.squadName ?? "").trim();
    next.factionName = String(logEvent.factionName ?? "").trim();
    next.creatorName = String(logEvent.creatorName ?? "").trim();
    next.creatorSteamId = String(logEvent.creatorSteamId ?? "").trim();
    next.creatorEosId = String(logEvent.creatorEosId ?? "").trim();
    next.rawLog = String(logEvent.rawLog ?? "");
    next.sourceEventId = String(logEvent.sourceEventId ?? "");

    if (shouldPromoteLogTimestamp) {
      if (Number.isFinite(nextCreatedAtMs)) {
        next.createdAtMs = nextCreatedAtMs;
        next.createdAt = new Date(nextCreatedAtMs).toISOString();
      }
      next.creationSource = "LOG";
      next.creationConfidence = "HIGH";
    }

    state.recordsByKey.set(key, formatLifecycleRecord(next));
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
      const key = buildSquadLifecycleKey(serverId, matchId, squad.teamID ?? squad.teamId ?? null, squad.squadID ?? squad.squadId ?? null);
      const current = state.recordsByKey.get(key) ?? null;
      const next = current ? { ...current } : createBaseRecord({
        serverId,
        matchId,
        teamId: squad.teamID ?? squad.teamId ?? null,
        squadId: squad.squadID ?? squad.squadId ?? null,
        squadName: squad.squadName ?? squad.name ?? "",
        factionName: squad.teamName ?? "",
        creatorName: squad.creatorName ?? "",
        creatorSteamId: squad.creatorSteamID ?? squad.creatorSteamId ?? "",
        creatorEosId: squad.creatorEOSID ?? squad.creatorEosId ?? "",
        rawLog: squad.raw ?? "",
        sourceEventId: squad.sourceEventId ?? "",
      }, getNextOrder(serverId, matchId));

      next.key = key;
      next.serverId = serverId;
      next.matchId = matchId;
      next.teamId = squad.teamID ?? squad.teamId ?? null;
      next.squadId = squad.squadID ?? squad.squadId ?? null;
      next.squadName = String(squad.squadName ?? squad.name ?? "").trim();
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

      state.recordsByKey.set(key, formatLifecycleRecord(next));
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

    touchUpdatedAt();
  }

  function getCurrentSnapshot(serverId) {
    const serverKey = String(serverId ?? "").trim();
    const currentMatchId = getCurrentMatchId(serverKey) || findLatestMatchId(serverKey);
    const records = [...state.recordsByKey.values()].filter((record) => {
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

function createBaseRecord(source, order) {
  return {
    key: "",
    order: Number(order ?? 0),
    serverId: String(source.serverId ?? "").trim(),
    matchId: String(source.matchId ?? "").trim(),
    teamId: source.teamId ?? null,
    squadId: source.squadId ?? null,
    squadName: String(source.squadName ?? "").trim(),
    factionName: String(source.factionName ?? "").trim(),
    creatorName: String(source.creatorName ?? "").trim(),
    creatorSteamId: String(source.creatorSteamId ?? "").trim(),
    creatorEosId: String(source.creatorEosId ?? "").trim(),
    rawLog: String(source.rawLog ?? ""),
    sourceEventId: String(source.sourceEventId ?? ""),
    createdAtMs: 0,
    createdAt: null,
    creationSource: "RCON_SNAPSHOT",
    creationConfidence: "MEDIUM",
  };
}

function parseTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value) return Date.now();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : Date.now();
}
