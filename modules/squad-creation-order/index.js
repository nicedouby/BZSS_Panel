// -*- coding: utf-8 -*-

import { getParam } from "../../core/event-normalizer.js";

const DEFAULT_MISSING_CONFIRM_SNAPSHOTS = 2;
const DEFAULT_MISSING_CONFIRM_MS = 15000;

export function createSquadCreationOrderModule({ core, config }) {
  const moduleConfig = config?.get?.("modules.squadCreationOrder", {}) ?? {};
  const missingConfirmSnapshots = Number(moduleConfig.missingConfirmSnapshots ?? DEFAULT_MISSING_CONFIRM_SNAPSHOTS);
  const missingConfirmMs = Number(moduleConfig.missingConfirmMs ?? DEFAULT_MISSING_CONFIRM_MS);

  const recordsByMatch = new Map();
  const recordsByKey = new Map();
  const dedupeKeysByMatch = new Map();
  const currentSessionByServer = new Map();
  const activeSlotMap = new Map();
  const generationBySlot = new Map();
  const orderCounterByMatch = new Map();
  const unsubscribers = [];

  function getMatchKey(serverId, sessionId) {
    return `${serverId}:${sessionId}`;
  }

  function getSlotKey(serverId, sessionId, teamID, squadID) {
    return `${serverId}:${sessionId}:${normalizeID(teamID)}:${normalizeID(squadID)}`;
  }

  function getRecordKey(serverId, sessionId, teamID, squadID, generation) {
    return `${getSlotKey(serverId, sessionId, teamID, squadID)}:${generation}`;
  }

  function getEventSourceId(event) {
    return String(
      event.sourceEventId
      || event.eventId
      || `${event.serverId}:${event.sessionId}:${event.seq ?? ""}`,
    );
  }

  function getSessionRecords(serverId, sessionId) {
    const matchKey = getMatchKey(serverId, sessionId);
    if (!recordsByMatch.has(matchKey)) recordsByMatch.set(matchKey, []);
    if (!dedupeKeysByMatch.has(matchKey)) dedupeKeysByMatch.set(matchKey, new Set());
    if (!orderCounterByMatch.has(matchKey)) orderCounterByMatch.set(matchKey, 0);
    return recordsByMatch.get(matchKey);
  }

  function snapshotRecords(records) {
    return records.map((record) => ({ ...record, raw: cloneRaw(record.raw) }));
  }

  function hasDeclaredPermission(permission) {
    const configPermissions = core.config.get("permissions", null);
    const declaredPermissions = [
      ...(Array.isArray(configPermissions) ? configPermissions : []),
      ...(Array.isArray(configPermissions?.granted) ? configPermissions.granted : []),
      ...(Array.isArray(configPermissions?.allowed) ? configPermissions.allowed : []),
      ...(Array.isArray(configPermissions?.permissions) ? configPermissions.permissions : []),
    ];

    if (declaredPermissions.length > 0) {
      return declaredPermissions.includes(permission);
    }

    if (permission === "log.read") {
      return Boolean(core.config.get("pythonLogParser.enabled", false));
    }

    if (permission === "event.subscribe.On_SquadCreated") {
      return true;
    }

    if (permission === "rcon.read.squads") {
      return Boolean(core.config.get("rcon.enabled", false));
    }

    if (permission === "event.subscribe.RCON_LIST_SQUADS_UPDATED") {
      return true;
    }

    return false;
  }

  function ensureCurrentSession(serverId, sessionId) {
    const previousSessionId = currentSessionByServer.get(serverId);
    if (previousSessionId && previousSessionId !== sessionId) {
      clearActiveSlotsForSession(serverId, previousSessionId);
    }

    currentSessionByServer.set(serverId, sessionId);
  }

  function clearActiveSlotsForSession(serverId, sessionId) {
    const prefix = `${serverId}:${sessionId}:`;
    for (const slotKey of [...activeSlotMap.keys()]) {
      if (slotKey.startsWith(prefix)) activeSlotMap.delete(slotKey);
    }
  }

  function recordSquadCreated(event) {
    const serverId = String(event.serverId ?? "");
    const sessionId = String(event.sessionId ?? "");
    if (!serverId || !sessionId) return null;

    const sourceEventId = getEventSourceId(event);
    const matchKey = getMatchKey(serverId, sessionId);
    const records = getSessionRecords(serverId, sessionId);
    const dedupeKeys = dedupeKeysByMatch.get(matchKey);

    if (dedupeKeys.has(sourceEventId)) {
      return null;
    }

    ensureCurrentSession(serverId, sessionId);

    const teamID = getParam(event, "TeamID") || getParam(event, "TeamId") || getParam(event, "Team") || "";
    const teamName = getParam(event, "TeamName") || getParam(event, "FactionName") || "";
    const squadID = getParam(event, "SquadID");
    const slotKey = getSlotKey(serverId, sessionId, teamID, squadID);
    const previousRecord = recordsByKey.get(activeSlotMap.get(slotKey));
    const previousGeneration = Number(generationBySlot.get(slotKey) ?? 0);
    const generation = previousGeneration + 1;
    const reusedSlot = Boolean(previousGeneration > 0 || previousRecord);
    const recordKey = getRecordKey(serverId, sessionId, teamID, squadID, generation);
    const order = Number(orderCounterByMatch.get(matchKey) ?? 0) + 1;

    if (previousRecord && isLiveStatus(previousRecord.status)) {
      updateRecordStatus(previousRecord, {
        status: "replaced",
        statusConfidence: "replaced_by_new_log_in_same_slot",
        disappearedAt: new Date().toISOString(),
      });
    }

    const record = {
      order,
      serverId,
      sessionId,
      teamID: normalizeNullable(teamID),
      teamName,
      factionName: teamName,
      squadID: normalizeNullable(squadID),
      squadName: getParam(event, "SquadName"),
      creatorName: getParam(event, "PlayerName"),
      creatorSteam64ID: getParam(event, "Steam64ID"),
      creatorEOSID: getParam(event, "EOSID"),
      createdAt: String(event.time ?? ""),
      createdLogTime: String(event.logTime ?? ""),
      sourceEventId,
      source: "log",
      seq: String(event.seq ?? ""),
      time: String(event.time ?? ""),
      logTime: String(event.logTime ?? ""),
      status: "active",
      statusConfidence: "created_by_log",
      firstSeenInRconAt: "",
      lastSeenInRconAt: "",
      missingSince: "",
      missingSnapshotCount: 0,
      disappearedAt: "",
      generation,
      reusedSlot,
      recordKey,
      slotKey,
      raw: String(event.rawLog ?? event.raw ?? ""),
    };

    dedupeKeys.add(sourceEventId);
    records.push(record);
    recordsByKey.set(recordKey, record);
    activeSlotMap.set(slotKey, recordKey);
    generationBySlot.set(slotKey, generation);
    orderCounterByMatch.set(matchKey, order);

    emitModuleEvent("recorded", serverId, sessionId, {
      record: cloneRecord(record),
      records: snapshotRecords(records),
    });

    if (previousRecord && previousRecord.status === "replaced") {
      emitStatusUpdated(previousRecord);
    }

    return record;
  }

  function handleRconSquadsUpdated(event) {
    const serverId = String(event.serverId ?? core.webStatus?.serverId ?? "");
    const sessionId = currentSessionByServer.get(serverId);
    if (!serverId || !sessionId) return;

    const now = new Date().toISOString();
    const records = getSessionRecords(serverId, sessionId);
    const existingSlots = new Set();

    for (const squad of event.squads ?? []) {
      const teamID = normalizeNullable(squad.teamID);
      const squadID = normalizeNullable(squad.squadID);
      if (squadID === "") continue;

      const slotKey = getSlotKey(serverId, sessionId, teamID, squadID);
      existingSlots.add(slotKey);

      const activeRecord = findActiveRecordForRconSquad(serverId, sessionId, squad, slotKey);
      if (activeRecord && isLiveStatus(activeRecord.status)) {
        existingSlots.add(activeRecord.slotKey);
        confirmRecordByRcon(activeRecord, now);
        continue;
      }

      createRconOnlyRecord({ serverId, sessionId, squad, slotKey, now, records });
    }

    for (const [slotKey, recordKey] of [...activeSlotMap.entries()]) {
      if (!slotKey.startsWith(`${serverId}:${sessionId}:`)) continue;
      if (existingSlots.has(slotKey)) continue;

      const record = recordsByKey.get(recordKey);
      if (!record || !isLiveStatus(record.status)) continue;

      markMissingOrDisbanded(record, now);
    }

    emitModuleEvent("snapshotUpdated", serverId, sessionId, {
      records: snapshotRecords(records),
      presentSlotKeys: [...existingSlots],
    });
  }

  function findActiveRecordForRconSquad(serverId, sessionId, squad, exactSlotKey) {
    const exact = recordsByKey.get(activeSlotMap.get(exactSlotKey));
    if (exact) return exact;

    const squadID = normalizeNullable(squad.squadID);
    const teamName = normalizeID(squad.teamName);
    if (!squadID || !teamName) return null;

    const records = recordsByMatch.get(getMatchKey(serverId, sessionId)) ?? [];
    return records.find((record) => {
      if (!isLiveStatus(record.status)) return false;
      if (normalizeNullable(record.squadID) !== squadID) return false;
      if (!normalizeID(record.teamName)) return false;
      return normalizeID(record.teamName).toLowerCase() === teamName.toLowerCase();
    }) ?? null;
  }

  function confirmRecordByRcon(record, now) {
    const nextConfidence = record.source === "rcon_snapshot_without_log"
      ? "rcon_only"
      : "confirmed_by_rcon";
    const changed = record.status !== "active" || record.statusConfidence !== nextConfidence;

    record.status = "active";
    record.statusConfidence = nextConfidence;
    record.firstSeenInRconAt = record.firstSeenInRconAt || now;
    record.lastSeenInRconAt = now;
    record.missingSince = "";
    record.missingSnapshotCount = 0;

    if (changed) emitStatusUpdated(record);
  }

  function markMissingOrDisbanded(record, now) {
    record.missingSnapshotCount = Number(record.missingSnapshotCount ?? 0) + 1;
    record.missingSince = record.missingSince || now;

    const missingForMs = Date.parse(now) - Date.parse(record.missingSince);
    const enoughSnapshots = record.missingSnapshotCount >= Math.max(1, missingConfirmSnapshots);
    const enoughTime = Number.isFinite(missingForMs) && missingForMs >= Math.max(0, missingConfirmMs);

    if (enoughSnapshots && enoughTime) {
      updateRecordStatus(record, {
        status: "disbanded",
        statusConfidence: "inferred_by_rcon_absence",
        disappearedAt: now,
      });
      activeSlotMap.delete(record.slotKey);
      emitStatusUpdated(record);
      emitModuleEvent("disbandedInferred", record.serverId, record.sessionId, {
        record: cloneRecord(record),
      });
      return;
    }

    updateRecordStatus(record, {
      status: "missing",
      statusConfidence: "inferred_by_rcon_absence",
    });
    emitStatusUpdated(record);
  }

  function createRconOnlyRecord({ serverId, sessionId, squad, slotKey, now, records }) {
    const previousGeneration = Number(generationBySlot.get(slotKey) ?? 0);
    const generation = previousGeneration + 1;
    const recordKey = getRecordKey(serverId, sessionId, squad.teamID, squad.squadID, generation);

    const record = {
      order: null,
      serverId,
      sessionId,
      teamID: normalizeNullable(squad.teamID),
      teamName: String(squad.teamName ?? ""),
      factionName: String(squad.teamName ?? ""),
      squadID: normalizeNullable(squad.squadID),
      squadName: String(squad.squadName ?? squad.name ?? ""),
      creatorName: String(squad.creatorName ?? ""),
      creatorSteam64ID: String(squad.creatorSteamID ?? squad.creatorSteam64ID ?? ""),
      creatorEOSID: String(squad.creatorEOSID ?? ""),
      createdAt: "",
      createdLogTime: "",
      sourceEventId: "",
      source: "rcon_snapshot_without_log",
      seq: "",
      time: "",
      logTime: "",
      status: "active",
      statusConfidence: "rcon_only",
      firstSeenInRconAt: now,
      lastSeenInRconAt: now,
      missingSince: "",
      missingSnapshotCount: 0,
      disappearedAt: "",
      generation,
      reusedSlot: previousGeneration > 0,
      recordKey,
      slotKey,
      raw: { squad },
    };

    records.push(record);
    recordsByKey.set(recordKey, record);
    activeSlotMap.set(slotKey, recordKey);
    generationBySlot.set(slotKey, generation);
    emitStatusUpdated(record);
  }

  function updateRecordStatus(record, patch) {
    Object.assign(record, patch);
  }

  function emitStatusUpdated(record) {
    emitModuleEvent("statusUpdated", record.serverId, record.sessionId, {
      record: cloneRecord(record),
      records: snapshotRecords(recordsByMatch.get(getMatchKey(record.serverId, record.sessionId)) ?? []),
    });
  }

  function emitModuleEvent(eventName, serverId, sessionId, patch = {}) {
    core.eventBus.emitModuleEvent("module.squadCreationOrder", eventName, {
      eventId: `module.squadCreationOrder:${eventName}:${serverId}:${sessionId}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
      eventName: `module.squadCreationOrder.${eventName}`,
      layer: "module",
      source: "module.squadCreationOrder",
      serverId,
      sessionId,
      time: new Date().toISOString(),
      ...patch,
    });
  }

  const api = {
    getCurrentOrder(serverId) {
      const sessionId = currentSessionByServer.get(serverId);
      if (!sessionId) return [];
      return this.getOrderBySession(serverId, sessionId);
    },

    getOrderBySession(serverId, sessionId) {
      const records = recordsByMatch.get(getMatchKey(serverId, sessionId)) ?? [];
      return snapshotRecords(records);
    },

    clearSession(serverId, sessionId) {
      const matchKey = getMatchKey(serverId, sessionId);
      const records = recordsByMatch.get(matchKey) ?? [];

      for (const record of records) {
        recordsByKey.delete(record.recordKey);
        if (activeSlotMap.get(record.slotKey) === record.recordKey) {
          activeSlotMap.delete(record.slotKey);
        }
      }

      recordsByMatch.delete(matchKey);
      dedupeKeysByMatch.delete(matchKey);
      orderCounterByMatch.delete(matchKey);
      clearActiveSlotsForSession(serverId, sessionId);

      if (currentSessionByServer.get(serverId) === sessionId) {
        currentSessionByServer.delete(serverId);
      }
    },

    clearServer(serverId) {
      for (const matchKey of [...recordsByMatch.keys()]) {
        if (matchKey.startsWith(`${serverId}:`)) {
          const sessionId = matchKey.slice(`${serverId}:`.length);
          this.clearSession(serverId, sessionId);
        }
      }

      currentSessionByServer.delete(serverId);
    },
  };

  return {
    manifest: {
      id: "module.squadCreationOrder",
      name: "建队顺序",
      kind: "module",
      version: "0.2.0",
      permissions: [
        "log.read",
        "event.subscribe.On_SquadCreated",
      ],
      optionalPermissions: [
        "rcon.read.squads",
        "event.subscribe.RCON_LIST_SQUADS_UPDATED",
      ],
    },
    apiName: "squadCreationOrder",
    api,

    async start() {
      if (!hasDeclaredPermission("log.read")) {
        const error = new Error("Squad Creation Order plugin requires log.read permission.");
        core.logger.error(error.message);
        throw error;
      }

      if (!hasDeclaredPermission("event.subscribe.On_SquadCreated")) {
        throw new Error("Squad Creation Order plugin requires event.subscribe.On_SquadCreated permission.");
      }

      core.webRegistry.registerPage({
        id: "web.squadCreationOrder",
        title: "建队顺序",
        group: "管理",
        route: "/squad-creation-order",
        pageModule: "/pages/squad-creation-order.js",
        source: "module.squadCreationOrder",
        required: false,
        enabled: true,
        order: 105,
        icon: "队",
      });

      unsubscribers.push(core.eventBus.onCoreEvent("On_SquadCreated", (event) => {
        recordSquadCreated(event);
      }));

      if (hasDeclaredPermission("rcon.read.squads") && hasDeclaredPermission("event.subscribe.RCON_LIST_SQUADS_UPDATED")) {
        unsubscribers.push(core.eventBus.onCoreEvent("RCON_LIST_SQUADS_UPDATED", (event) => {
          handleRconSquadsUpdated(event);
        }));
      } else {
        core.logger.warn("Squad Creation Order started without RCON squad snapshot permission; disband inference is disabled.");
      }
    },

    async stop() {
      for (const unsubscriber of unsubscribers.splice(0)) unsubscriber();
    },
  };
}

function isLiveStatus(status) {
  return status === "active" || status === "missing" || status === "uncertain";
}

function normalizeID(value) {
  return String(value ?? "").trim();
}

function normalizeNullable(value) {
  return normalizeID(value);
}

function cloneRecord(record) {
  return { ...record, raw: cloneRaw(record.raw) };
}

function cloneRaw(raw) {
  if (!raw || typeof raw !== "object") return raw;
  return JSON.parse(JSON.stringify(raw));
}
