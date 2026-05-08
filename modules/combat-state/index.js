// -*- coding: utf-8 -*-

const COMBAT_TYPES = {
  On_PlayerDamaged: "damage",
  On_PlayerWounded: "wound",
  On_PlayerDied: "death",
};

const VALID_FILTER_TYPES = new Set(["damage", "wound", "death"]);

/**
 * Module: CombatState
 *
 * Aggregates structured combat events emitted by the Python log parser.
 * It does not parse Squad.log lines; it only normalizes event params.
 */
export function createCombatStateModule({ core, config }) {
  const moduleConfig = config.get("modules.combatState", {});
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const maxEvents = Math.max(1, Number(moduleConfig.maxEvents ?? 5000));
  const events = [];
  const unsubscribers = [];
  let lastUpdatedAt = "";

  function ingest(event) {
    const type = COMBAT_TYPES[event?.eventName];
    if (!type) return null;

    const params = normalizeParams(event);
    const record = normalizeCombatEvent({ event, params, type });

    events.push(record);
    if (events.length > maxEvents) {
      events.splice(0, events.length - maxEvents);
    }

    lastUpdatedAt = record.time || new Date().toISOString();

    core.eventBus.emitModuleEvent("module.combatState", "updated", {
      eventName: "module.combatState.updated",
      layer: "module",
      source: "module.combatState",
      serverId: record.serverId,
      time: new Date().toISOString(),
      record,
      stats: buildStats(),
    });

    return record;
  }

  function getState() {
    return {
      events: events.map(cloneEvent),
      count: events.length,
      stats: buildStats(),
      lastUpdatedAt,
    };
  }

  function buildStats() {
    const stats = {
      total: events.length,
      damage: 0,
      wound: 0,
      death: 0,
    };

    for (const event of events) {
      if (event.type in stats) stats[event.type] += 1;
    }

    return stats;
  }

  const api = {
    getState,

    getOverview() {
      const state = getState();
      return {
        count: state.count,
        stats: state.stats,
        lastUpdatedAt: state.lastUpdatedAt,
        latest: state.events.slice(-20).reverse(),
      };
    },

    getEvents(filter = {}) {
      const type = String(filter.type ?? "all").trim();
      const search = String(filter.search ?? "").trim().toLowerCase();
      const limit = clampLimit(filter.limit, 200);

      let result = events;

      if (VALID_FILTER_TYPES.has(type)) {
        result = result.filter((event) => event.type === type);
      }

      if (search) {
        result = result.filter((event) => matchesSearch(event, search));
      }

      return result.slice(-limit).reverse().map(cloneEvent);
    },

    clear() {
      const cleared = events.length;
      events.splice(0);
      lastUpdatedAt = new Date().toISOString();
      core.eventBus.emitModuleEvent("module.combatState", "cleared", {
        eventName: "module.combatState.cleared",
        layer: "module",
        source: "module.combatState",
        serverId: core.webStatus.serverId,
        time: lastUpdatedAt,
        cleared,
      });
      return { ok: true, cleared };
    },
  };

  return {
    manifest: { id: "module.combatState", name: "Combat State Module", kind: "module", version: "0.1.0" },
    apiName: "combatState",
    api,

    async start() {
      if (!enabled) return;
      for (const eventName of Object.keys(COMBAT_TYPES)) {
        unsubscribers.push(core.eventBus.onCoreEvent(eventName, ingest));
      }
      core.logger.module(`module.combatState started. maxEvents=${maxEvents}`);
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      events.splice(0);
      lastUpdatedAt = "";
    },
  };
}

export function normalizeParams(event) {
  const result = {};

  function assign(name, value) {
    const key = String(name ?? "").trim();
    if (!key) return;
    result[key] = normalizeValue(value);

    const paramMatch = key.match(/^Param\d+_(.+)$/);
    if (paramMatch && !(paramMatch[1] in result)) {
      result[paramMatch[1]] = normalizeValue(value);
    }
  }

  if (event?.paramMap && typeof event.paramMap === "object") {
    for (const [key, value] of Object.entries(event.paramMap)) assign(key, value);
  }

  if (Array.isArray(event?.params)) {
    for (const item of event.params) {
      if (Array.isArray(item)) {
        assign(item[0], item[1]);
      } else if (item && typeof item === "object") {
        assign(item.name ?? item.key ?? item.paramName, item.value ?? item.paramValue ?? "");
      }
    }
  } else if (event?.params && typeof event.params === "object") {
    for (const [key, value] of Object.entries(event.params)) assign(key, value);
  }

  const rawEvent = event?.rawEvent && typeof event.rawEvent === "object" ? event.rawEvent : event;
  if (rawEvent && typeof rawEvent === "object") {
    for (const [key, value] of Object.entries(rawEvent)) {
      if (/^Param\d+_/.test(key)) assign(key, value);
    }
  }

  return result;
}

function normalizeCombatEvent({ event, params, type }) {
  const causedBy = getParam(params, "CausedBy");
  const fromObject = getParam(params, "FromObject");
  const damageValue = getParam(params, "ActualDamage") || getParam(params, "KillingDamage");

  return {
    id: String(event?.eventId || `${event?.eventName ?? "combat"}:${event?.serverId ?? ""}:${event?.time ?? Date.now()}:${Math.random().toString(16).slice(2)}`),
    type,
    eventName: String(event?.eventName ?? ""),
    time: String(event?.time ?? new Date().toISOString()),
    serverId: String(event?.serverId ?? event?.ServerID ?? ""),
    victimName: getParam(params, "VictimName"),
    attackerName: getParam(params, "AttackerName"),
    damage: parseDamage(damageValue),
    weapon: causedBy || fromObject || "",
    causedBy,
    fromObject,
    attackerEOSID: getParam(params, "AttackerEOSID"),
    attackerSteam64ID: getParam(params, "AttackerSteam64ID"),
    attackerControllerID: getParam(params, "AttackerControllerID"),
    victimEOSID: getParam(params, "VictimCachedEOSID"),
    victimSteam64ID: getParam(params, "VictimCachedSteam64ID"),
    identityConfidence: getParam(params, "IdentityConfidence"),
    parseConfidence: getParam(params, "ParseConfidence"),
    confidence: getParam(params, "Confidence"),
    parseStatus: getParam(params, "ParseStatus"),
    identitySource: getParam(params, "IdentitySource"),
    rawLog: getRawLog(event),
  };
}

function getParam(params, name) {
  const value = params?.[name];
  return value == null ? "" : String(value);
}

function normalizeValue(value) {
  return value == null ? "" : String(value);
}

function parseDamage(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number.parseFloat(text);
  return Number.isFinite(number) ? number : null;
}

function getRawLog(event) {
  return String(
    event?.rawLog
    ?? event?.raw
    ?? event?.RawLog
    ?? event?.Raw
    ?? event?.rawEvent?.Raw
    ?? event?.rawEvent?.RawLog
    ?? "",
  );
}

function clampLimit(value, defaultValue) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(5000, Math.max(1, parsed));
}

function matchesSearch(event, search) {
  return [
    event.victimName,
    event.attackerName,
    event.attackerSteam64ID,
    event.attackerEOSID,
    event.causedBy,
    event.weapon,
  ].some((value) => String(value ?? "").toLowerCase().includes(search));
}

function cloneEvent(event) {
  return { ...event };
}
