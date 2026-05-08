// -*- coding: utf-8 -*-

import { getParam } from "../../core/event-normalizer.js";

export function createSquadCreationOrderModule({ core }) {
  const recordsByMatch = new Map();
  const dedupeKeysByMatch = new Map();
  const currentSessionByServer = new Map();
  const unsubscribers = [];

  function getMatchKey(serverId, sessionId) {
    return `${serverId}:${sessionId}`;
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
    return recordsByMatch.get(matchKey);
  }

  function snapshotRecords(records) {
    return records.map((record) => ({ ...record }));
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

    return false;
  }

  function recordSquadCreated(event) {
    const serverId = String(event.serverId ?? "");
    const sessionId = String(event.sessionId ?? "");
    const sourceEventId = getEventSourceId(event);
    const matchKey = getMatchKey(serverId, sessionId);
    const records = getSessionRecords(serverId, sessionId);
    const dedupeKeys = dedupeKeysByMatch.get(matchKey);

    if (dedupeKeys.has(sourceEventId)) {
      return null;
    }

    const record = {
      order: records.length + 1,
      serverId,
      sessionId,
      sourceEventId,
      seq: String(event.seq ?? ""),
      time: String(event.time ?? ""),
      logTime: String(event.logTime ?? ""),
      squadID: getParam(event, "SquadID"),
      squadName: getParam(event, "SquadName"),
      factionName: getParam(event, "FactionName"),
      creatorName: getParam(event, "PlayerName"),
      creatorEOSID: getParam(event, "EOSID"),
      creatorSteam64ID: getParam(event, "Steam64ID"),
      raw: String(event.rawLog ?? event.raw ?? ""),
    };

    dedupeKeys.add(sourceEventId);
    records.push(record);
    currentSessionByServer.set(serverId, sessionId);

    const recordsSnapshot = snapshotRecords(records);
    core.eventBus.emitModuleEvent("module.squadCreationOrder", "recorded", {
      eventId: `module.squadCreationOrder:${serverId}:${sessionId}:${record.seq}`,
      eventName: "module.squadCreationOrder.recorded",
      layer: "module",
      source: "module.squadCreationOrder",
      serverId,
      sessionId,
      time: new Date().toISOString(),
      record: { ...record },
      records: recordsSnapshot,
    });

    return record;
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
      recordsByMatch.delete(matchKey);
      dedupeKeysByMatch.delete(matchKey);

      if (currentSessionByServer.get(serverId) === sessionId) {
        currentSessionByServer.delete(serverId);
      }
    },

    clearServer(serverId) {
      for (const matchKey of [...recordsByMatch.keys()]) {
        if (matchKey.startsWith(`${serverId}:`)) {
          recordsByMatch.delete(matchKey);
          dedupeKeysByMatch.delete(matchKey);
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
      version: "0.1.0",
      permissions: [
        "log.read",
        "event.subscribe.On_SquadCreated",
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
    },

    async stop() {
      for (const unsubscriber of unsubscribers) unsubscriber();
    },
  };
}
