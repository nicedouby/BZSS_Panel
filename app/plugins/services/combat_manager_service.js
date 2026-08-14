// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const COMBAT_MANAGER_MODULE_ID = "module.combatManager";
const COMBAT_MANAGER_VISIBLE_NAME = "战斗管理";
const DEFAULT_ENABLED = true;
const DEFAULT_CACHE_DIR = "data/combat-manager";
const LEGACY_CONFIG_PREFIX = ["kill", "_manager"].join("");
const LEGACY_EVENT_PREFIX = ["KILL", "_MANAGER"].join("");
const LEGACY_EVENT_NAMES = Object.freeze({
  killManagerUpdated: [LEGACY_EVENT_PREFIX, "_UPDATED"].join(""),
  killEvent: [LEGACY_EVENT_PREFIX, "_EVENT"].join(""),
  killLogUpdated: [LEGACY_EVENT_PREFIX, "_LOG_UPDATED"].join(""),
});
const NEW_EVENT_NAMES = Object.freeze({
  eventProcessed: "COMBAT_EVENT_PROCESSED",
  updated: "COMBAT_MANAGER_UPDATED",
  snapshotRequested: "COMBAT_MANAGER_SNAPSHOT_REQUESTED",
  snapshot: "COMBAT_MANAGER_SNAPSHOT",
});

export function createCombatManagerService({ core, modules, config, logger }) {
  bindCombatManagerModules(modules);
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: COMBAT_MANAGER_MODULE_ID,
    source: COMBAT_MANAGER_MODULE_ID,
    channel: "module",
  }) ?? core.logger;

  const moduleConfig = readCompatConfig(config, [
    "modules.combatManager",
    "modules.combat_manager",
    "combat_manager",
    LEGACY_CONFIG_PREFIX,
  ], {});
  const enabled = Boolean(firstPresent(
    moduleConfig.enabled,
    config?.get?.("modules.combatManager.enabled"),
    config?.get?.("modules.combat_manager.enabled"),
    config?.get?.("combat_manager.enabled"),
    config?.get?.([LEGACY_CONFIG_PREFIX, ".enabled"].join("")),
    DEFAULT_ENABLED,
  ));
  const cacheDir = path.resolve(process.cwd(), String(firstPresent(
    moduleConfig.cacheDir,
    config?.get?.("modules.combatManager.cacheDir"),
    config?.get?.("modules.combat_manager.cacheDir"),
    config?.get?.("combat_manager.cacheDir"),
    DEFAULT_CACHE_DIR,
  )));

  const unsubscribers = [];
  const eventEmitter = new Map();
  const cacheWriteTimers = new Map();
  const cacheWritePromises = new Map();
  let cacheWriteNonce = 0;
  let lastSnapshotAt = "";

  const api = {
    getConfig() {
      return {
        enabled,
        moduleId: COMBAT_MANAGER_MODULE_ID,
      };
    },

    getEvents(filter = {}) {
      return cloneList(selectPrimaryEvents(filter), normalizeCombatEvent);
    },

    getOverview(serverId = "") {
      return getCombatManagerSnapshot(serverId);
    },

    getCacheFilePath(serverId = "") {
      return getCombatCacheFilePath(serverId);
    },

    async readCacheSnapshot(serverId = "") {
      return readCombatCacheSnapshot(serverId);
    },

    async ensureCacheSnapshot(serverId = "") {
      return ensureCombatCacheSnapshot(serverId);
    },

    getEventById(id) {
      const text = String(id ?? "").trim();
      if (!text) return null;

      const processedHit = modules?.combatClean?.getEventById?.(text);
      if (processedHit) return normalizeCombatEvent(processedHit, "processed");

      const rawHit = modules?.combatState?.getState?.()?.events?.find?.((event) => String(event?.id ?? "") === text) ?? null;
      if (rawHit) return normalizeCombatEvent(rawHit, "raw");

      const recentRaw = modules?.combatState?.getEvents?.({ limit: 5000 }) ?? [];
      const rawMatch = recentRaw.find((event) => String(event?.id ?? "") === text);
      if (rawMatch) return normalizeCombatEvent(rawMatch, "raw");

      const recentProcessed = modules?.combatClean?.getEvents?.({ limit: 5000 }) ?? [];
      const processedMatch = recentProcessed.find((event) => String(event?.id ?? "") === text);
      if (processedMatch) return normalizeCombatEvent(processedMatch, "processed");

      return null;
    },

    getPlayerEvents(serverId, playerQuery = {}, options = {}) {
      const events = selectPrimaryEvents({
        serverId,
        ...playerQuery,
        ...options,
      });

      return cloneList(events, (event) => normalizeCombatEvent(event, detectSource(event)));
    },

    getRateHistory(serverId = "", windowMinutes = 30) {
      const primary = selectPrimaryEvents({ serverId, limit: 5000 });
      const now = Date.now();
      const windowMs = Number.isFinite(Number(windowMinutes)) ? Number(windowMinutes) * 60 * 1000 : 30 * 60 * 1000;
      const cutoff = now - windowMs;
      const buckets = new Map();

      for (let i = 0; i <= Math.max(1, Math.floor(windowMs / 60000)); i += 1) {
        const time = Math.floor((now - i * 60000) / 60000) * 60000;
        buckets.set(time, { damage: 0, wound: 0, kill: 0 });
      }

      for (const event of primary) {
        const normalized = normalizeCombatEvent(event, detectSource(event));
        const eventTime = parseTimestampMs(normalized.time);
        if (eventTime < cutoff) continue;
        const minute = Math.floor(eventTime / 60000) * 60000;
        const bucket = buckets.get(minute);
        if (!bucket) continue;
        const type = normalizeType(normalized.type);
        if (type === "damage") bucket.damage += 1;
        else if (type === "wound") bucket.wound += 1;
        else if (type === "kill" || type === "death" || type === "tk") bucket.kill += 1;
      }

      return [...buckets.entries()]
        .map(([timestamp, counts]) => ({ timestamp, ...counts }))
        .sort((left, right) => left.timestamp - right.timestamp);
    },

    clear(serverId = "") {
      const target = String(serverId ?? "").trim();
      const rawResult = modules?.combatState?.clear?.(target) ?? { ok: true, cleared: 0 };
      const processedResult = modules?.combatClean?.clear?.(target) ?? { ok: true, cleared: 0 };
      scheduleCombatCacheWrite(target);
      emitCombatManagerUpdate({
        serverId: target,
        eventName: NEW_EVENT_NAMES.updated,
        layer: "module",
        source: COMBAT_MANAGER_MODULE_ID,
        time: new Date().toISOString(),
        cleared: Number(rawResult.cleared ?? 0) + Number(processedResult.cleared ?? 0),
      });
      return {
        ok: Boolean(rawResult.ok !== false && processedResult.ok !== false),
        cleared: Number(rawResult.cleared ?? 0) + Number(processedResult.cleared ?? 0),
        rawCleared: Number(rawResult.cleared ?? 0),
        processedCleared: Number(processedResult.cleared ?? 0),
      };
    },

    getRecentKills(serverId = "", limit = 50) {
      const normalized = selectPrimaryEvents({
        serverId,
        limit,
        type: "kill",
      });
      return cloneList(normalized, (event) => normalizeCombatEvent(event, detectSource(event)));
    },

    on(eventName, handler) {
      if (typeof handler !== "function") return () => {};
      if (!eventEmitter.has(eventName)) eventEmitter.set(eventName, new Set());
      eventEmitter.get(eventName).add(handler);
      return () => eventEmitter.get(eventName)?.delete(handler);
    },
  };

  function handleDamageEvent(event) {
    return ingestSourceEvent(event, "damage");
  }

  function handleWoundEvent(event) {
    return ingestSourceEvent(event, "wound");
  }

  function handleKillEvent(event) {
    return ingestSourceEvent(event, "kill");
  }

  function classifyCombatEvent(record = {}) {
    const type = normalizeType(record.type ?? record.eventType ?? "");
    const isFriendlyFire = Boolean(record.isFriendlyFire || record.isTeamKill || record.tk || record.tkDown);
    const source = detectSource(record);
    return {
      type,
      source,
      isFriendlyFire,
      isProcessed: source === "processed",
      isRaw: source === "raw",
      isRevive: type === "revive",
      isKill: type === "kill" || type === "death" || type === "tk",
    };
  }

  function normalizeCombatEvent(record = {}, sourceHint = "") {
    const source = sourceHint || detectSource(record);
    const type = normalizeType(record.type ?? record.eventType ?? "");
    const normalized = {
      ...cloneJsonSafe(record),
      sourceLayer: source === "processed" ? "processed" : "raw",
      sourceModule: source === "processed" ? "module.combatClean" : "module.combatState",
      eventName: String(record.eventName ?? (source === "processed" ? `module.combatClean.${type || "updated"}` : `module.combatState.${type || "updated"}`)),
      type,
      time: String(record.time ?? record.createdAt ?? new Date().toISOString()),
    };

    if (normalized.attacker && typeof normalized.attacker === "object") {
      normalized.attacker = cloneJsonSafe(normalized.attacker);
    }
    if (normalized.victim && typeof normalized.victim === "object") {
      normalized.victim = cloneJsonSafe(normalized.victim);
    }

    if (!normalized.weapon || typeof normalized.weapon !== "object") {
      const weaponName = String(normalized.weapon ?? normalized.causedBy ?? normalized.rawCausedBy ?? "").trim();
      normalized.weapon = weaponName
        ? { displayName: weaponName, cleaned: weaponName, raw: weaponName }
        : normalized.weapon;
    }

    return normalized;
  }
  normalizeCombatEventRef = normalizeCombatEvent;

  function emitCombatManagerUpdate(payload = {}) {
    const snapshot = getCombatManagerSnapshot(payload.serverId ?? "");
    scheduleCombatCacheWrite(payload.serverId ?? "");
    const emitted = {
      ...payload,
      layer: payload.layer ?? "module",
      source: payload.source ?? COMBAT_MANAGER_MODULE_ID,
      time: payload.time ?? new Date().toISOString(),
      snapshot,
      overview: snapshot,
    };

    emitModuleEvent(NEW_EVENT_NAMES.updated, {
      ...emitted,
      eventName: NEW_EVENT_NAMES.updated,
    });
    emitModuleEvent(NEW_EVENT_NAMES.snapshot, {
      ...emitted,
      eventName: NEW_EVENT_NAMES.snapshot,
    });
    emitModuleEvent(LEGACY_EVENT_NAMES.killManagerUpdated, {
      ...emitted,
      eventName: LEGACY_EVENT_NAMES.killManagerUpdated,
    });
    emitModuleEvent(LEGACY_EVENT_NAMES.killLogUpdated, {
      ...emitted,
      eventName: LEGACY_EVENT_NAMES.killLogUpdated,
    });

    return emitted;
  }

  function getCombatManagerSnapshot(serverId = "", options = {}) {
    const target = String(serverId ?? "").trim();
    const includeEvents = Boolean(options?.includeEvents);
    const rawState = modules?.combatState?.getState?.(target) ?? modules?.combatState?.getState?.() ?? null;
    const processedOverview = modules?.combatClean?.getOverview?.(target) ?? null;
    const processedEvents = modules?.combatClean?.getEvents?.({
      serverId: target,
      limit: 5000,
      offset: 0,
      type: "all",
      search: "",
    }) ?? [];
    const rawEvents = rawState?.events ?? [];
    const primaryEvents = mergeCombatEventLists(rawEvents, processedEvents);
    const stats = processedOverview?.stats ?? rawState?.stats ?? {};
    const rawStats = rawState?.stats ?? {};
    const processedStats = processedOverview?.stats ?? {};
    const rejected = Number(processedOverview?.rejected ?? rawState?.rejected?.length ?? 0);

    return {
      serverId: target,
      count: Number(primaryEvents.length ?? 0),
      stats,
      rawStats,
      processedStats,
      rejected,
      lastUpdatedAt: processedOverview?.lastUpdatedAt ?? rawState?.lastUpdatedAt ?? lastSnapshotAt,
      events: includeEvents ? cloneList(primaryEvents, (event) => normalizeCombatEvent(event, detectSource(event))) : [],
      latest: cloneList(primaryEvents.slice(-20).reverse(), (event) => normalizeCombatEvent(event, detectSource(event))),
      rawLatest: cloneList(rawEvents.slice(-20).reverse(), (event) => normalizeCombatEvent(event, "raw")),
      processedLatest: cloneList(processedEvents.slice(-20).reverse(), (event) => normalizeCombatEvent(event, "processed")),
      rawCount: Number(rawState?.count ?? rawEvents.length ?? 0),
      processedCount: Number(processedOverview?.count ?? processedEvents.length ?? 0),
      dependencies: {
        combatState: {
          loaded: Boolean(modules?.combatState),
          subscribed: Boolean(modules?.combatState),
        },
        combatClean: {
          loaded: Boolean(modules?.combatClean),
          subscribed: Boolean(modules?.combatClean),
        },
      },
    };
  }

  function ingestSourceEvent(event, expectedType = "") {
    const record = event?.record ?? event?.rejection ?? event?.payload?.record ?? null;
    if (!record) {
      return null;
    }

    const source = detectSource(record, event);
    const normalized = normalizeCombatEvent(record, source);
    if (expectedType && normalizeType(normalized.type) !== expectedType) {
      return null;
    }

    const eventId = String(event?.eventId ?? normalized.id ?? `${COMBAT_MANAGER_MODULE_ID}:${Date.now()}`);
    const processedPayload = {
      eventId,
      eventName: NEW_EVENT_NAMES.eventProcessed,
      source: COMBAT_MANAGER_MODULE_ID,
      serverId: normalized.serverId ?? event?.serverId ?? "",
      time: normalized.time ?? event?.time ?? new Date().toISOString(),
      record: normalized,
    };

    // This is the single-record ingress for downstream consumers.  Keep it
    // separate from manager snapshots: a snapshot is intentionally emitted
    // several times for compatibility, while a cleaned combat record must be
    // observable exactly once.
    emitModuleEvent(NEW_EVENT_NAMES.eventProcessed, processedPayload);

    emitCombatManagerUpdate({
      eventName: NEW_EVENT_NAMES.eventProcessed,
      ...processedPayload,
    });

    emitModuleEvent(LEGACY_EVENT_NAMES.killEvent, {
      eventId,
      eventName: LEGACY_EVENT_NAMES.killEvent,
      source: COMBAT_MANAGER_MODULE_ID,
      serverId: normalized.serverId ?? event?.serverId ?? "",
      time: normalized.time ?? event?.time ?? new Date().toISOString(),
      record: normalized,
    });

    return normalized;
  }

  function emitModuleEvent(eventName, payload) {
    for (const handler of eventEmitter.get(eventName) ?? []) {
      try {
        handler(payload);
      } catch (error) {
        moduleLogger?.warn?.(`CombatManager listener failed for ${eventName}: ${error?.message ?? error}`);
      }
    }
    core.eventBus?.emitModuleEvent?.(COMBAT_MANAGER_MODULE_ID, eventName, payload);
  }

  async function start() {
    if (!enabled) {
      moduleLogger?.info?.("CombatManager service disabled.");
      return;
    }

    const combatStateCleared = core.eventBus?.onModuleEvent?.("module.combatState", "cleared", (event) => {
      emitCombatManagerUpdate({
        eventId: String(event?.eventId ?? `${COMBAT_MANAGER_MODULE_ID}:cleared:${Date.now()}`),
        eventName: NEW_EVENT_NAMES.updated,
        source: COMBAT_MANAGER_MODULE_ID,
        serverId: String(event?.serverId ?? ""),
        time: String(event?.time ?? new Date().toISOString()),
        cleared: Number(event?.cleared ?? 0),
      });
    });
    const combatCleanUpdated = core.eventBus?.onModuleEvent?.("module.combatClean", "updated", (event) => {
      ingestSourceEvent(event, "");
    });
    const combatCleanRejected = core.eventBus?.onModuleEvent?.("module.combatClean", "rejected", (event) => {
      emitCombatManagerUpdate({
        eventId: String(event?.eventId ?? `${COMBAT_MANAGER_MODULE_ID}:rejected:${Date.now()}`),
        eventName: NEW_EVENT_NAMES.updated,
        source: COMBAT_MANAGER_MODULE_ID,
        serverId: String(event?.serverId ?? ""),
        time: String(event?.time ?? new Date().toISOString()),
        rejected: event?.rejection ?? null,
      });
    });

    unsubscribers.push(
      combatStateCleared,
      combatCleanUpdated,
      combatCleanRejected,
    );

    emitCombatManagerUpdate({
      eventName: NEW_EVENT_NAMES.snapshotRequested,
      source: COMBAT_MANAGER_MODULE_ID,
      time: new Date().toISOString(),
      serverId: core.webStatus?.serverId ?? "",
    });
    try {
      await queueCombatCacheWrite(core.webStatus?.serverId ?? "", () => writeCombatCacheSnapshot(core.webStatus?.serverId ?? ""));
    } catch (error) {
      moduleLogger?.warn?.(`CombatManager cache write failed on start: ${error?.message ?? error}`);
    }

    moduleLogger?.info?.("CombatManager service started.", {
      operation: "start",
      data: {
        enabled,
      },
    });
  }

  async function stop() {
    for (const unsubscribe of unsubscribers.splice(0)) {
      try {
        unsubscribe?.();
      } catch {}
    }
    for (const timer of cacheWriteTimers.values()) {
      clearTimeout(timer);
    }
    cacheWriteTimers.clear();
    await Promise.allSettled(cacheWritePromises.values());
    cacheWritePromises.clear();
    eventEmitter.clear?.();
    moduleLogger?.info?.("CombatManager service stopped.", {
      operation: "stop",
    });
  }

  function scheduleCombatCacheWrite(serverId = "") {
    const target = normalizeServerKey(serverId);
    const existing = cacheWriteTimers.get(target);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      cacheWriteTimers.delete(target);
      queueCombatCacheWrite(target, () => writeCombatCacheSnapshot(target));
    }, 250);
    cacheWriteTimers.set(target, timer);
  }

  function queueCombatCacheWrite(serverId = "", task) {
    const target = normalizeServerKey(serverId);
    const previous = cacheWritePromises.get(target) ?? Promise.resolve();
    const writePromise = previous
      .catch(() => {})
      .then(() => task());

    cacheWritePromises.set(target, writePromise);
    writePromise.finally(() => {
      if (cacheWritePromises.get(target) === writePromise) {
        cacheWritePromises.delete(target);
      }
    });
    return writePromise;
  }

  async function writeCombatCacheSnapshot(serverId = "") {
    const snapshot = getCombatManagerSnapshot(serverId);
    const filePath = getCombatCacheFilePath(serverId);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${++cacheWriteNonce}.tmp`;
    const payload = JSON.stringify(snapshot, null, 2);
    await fs.mkdir(cacheDir, { recursive: true });
    try {
      await fs.writeFile(tempPath, payload, "utf8");
      await fs.rename(tempPath, filePath);
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "EPERM") throw error;
      await fs.writeFile(filePath, payload, "utf8");
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => {});
    }
  }

  async function readCombatCacheSnapshot(serverId = "") {
    const filePath = getCombatCacheFilePath(serverId);
    try {
      const text = await fs.readFile(filePath, "utf8");
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async function ensureCombatCacheSnapshot(serverId = "") {
    const existing = await readCombatCacheSnapshot(serverId);
    if (existing) return existing;
    await queueCombatCacheWrite(serverId, () => writeCombatCacheSnapshot(serverId));
    return readCombatCacheSnapshot(serverId);
  }

  function getCombatCacheFilePath(serverId = "") {
    return path.join(cacheDir, `${normalizeServerKey(serverId)}.json`);
  }

  return {
    api,
    start,
    stop,
    normalizeCombatEvent,
    handleDamageEvent,
    handleWoundEvent,
    handleKillEvent,
    classifyCombatEvent,
    emitCombatManagerUpdate,
    getCombatManagerSnapshot,
  };
}

function readCompatConfig(config, paths, defaultValue = {}) {
  for (const pathText of paths) {
    const value = config?.get?.(pathText, undefined);
    if (value !== undefined) return value;
  }
  return defaultValue;
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

function detectSource(record = {}, event = null) {
  const source = String(record.sourceLayer ?? record.sourceModule ?? event?.source ?? "").toLowerCase();
  if (source.includes("processed") || source.includes("combclean") || source.includes("combatclean")) return "processed";
  if (source.includes("raw") || source.includes("combatstate") || source.includes("killmanage")) return "raw";
  if (record.attacker?.teamID != null || record.victim?.teamID != null || record.weapon?.typeLabel) return "processed";
  return "raw";
}

function normalizeType(value) {
  const type = String(value ?? "").trim().toLowerCase();
  if (type === "damaged") return "damage";
  if (type === "wounded") return "wound";
  if (type === "died") return "death";
  if (type === "dead") return "death";
  if (type === "revived") return "revive";
  if (type === "teamkill") return "tk";
  return type;
}

function parseTimestampMs(value) {
  if (value == null) return Date.now();
  if (typeof value === "number" && Number.isFinite(value)) return value > 10 ** 11 ? value : value * 1000;
  const text = String(value).trim();
  if (!text) return Date.now();
  const number = Number(text);
  if (Number.isFinite(number)) return number > 10 ** 11 ? number : number * 1000;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function normalizeServerKey(value = "") {
  return String(value ?? "").trim().replace(/[^A-Za-z0-9_.-]/g, "_") || "default";
}

  function selectPrimaryEvents(filter = {}) {
    const serverId = String(filter.serverId ?? "").trim();
    const type = normalizeType(filter.type ?? "all");
    const search = String(filter.search ?? filter.q ?? "").trim().toLowerCase();
    const limit = Math.max(1, Number(filter.limit ?? 300) || 300);
  const offset = Math.max(0, Number(filter.offset ?? 0) || 0);
  const mode = String(filter.mode ?? filter.view ?? "").trim().toLowerCase();

  const processed = modulesRef?.combatClean?.getEvents?.({
    serverId,
    type: type === "all" ? "all" : type,
    search,
    limit: 5000,
    offset: 0,
    playerKey: String(filter.playerKey ?? "").trim(),
    steam64ID: String(filter.steam64ID ?? filter.steamID ?? "").trim(),
    eosID: String(filter.eosID ?? "").trim(),
    controllerID: String(filter.controllerID ?? "").trim(),
    name: String(filter.name ?? "").trim(),
  }) ?? [];
  const raw = modulesRef?.combatState?.getEvents?.({
    serverId,
    type: translateToCombatStateType(type),
    search,
    limit: 5000,
    offset: 0,
  }) ?? [];
  const replay = modulesRef?.killRecords?.getCombatRecords?.({
    serverId,
    source: "replay",
    type: "all",
    limit: 5000,
    offset: 0,
  })?.records ?? [];

  let events;
  if (mode === "raw") {
    events = raw;
  } else if (mode === "processed") {
    events = processed;
  } else if (mode === "replay") {
    events = replay;
  } else {
    // Cleaned events are the authoritative live stream. Raw events are only
    // the fallback when the clean layer has not produced anything yet.
    events = processed.length
      ? mergeCombatEventLists([], processed, replay)
      : mergeCombatEventLists(raw, [], replay);
  }

  const playerKeys = [
    filter.playerKey,
    filter.steam64ID,
    filter.steamID,
    filter.eosID,
    filter.controllerID,
    filter.name,
  ].map((val) => String(val ?? "").trim().toLowerCase()).filter(Boolean);

  if (playerKeys.length) {
    events = events.filter((event) => {
      const normalized = normalizeCombatEventRef(event, detectSource(event));
      return playerKeys.some((key) => {
        const attacker = normalized.attacker;
        const victim = normalized.victim;
        return [attacker, victim].some((player) => {
          if (player?.steam64ID && String(player.steam64ID).toLowerCase() === key) return true;
          if (player?.eosID && String(player.eosID).toLowerCase() === key) return true;
          if (player?.controllerID && String(player.controllerID).toLowerCase() === key) return true;
          if (player?.playerId && String(player.playerId).toLowerCase() === key) return true;
          if (player?.id && String(player.id).toLowerCase() === key) return true;

          const name = String(player?.name ?? "").toLowerCase();
          const displayName = String(player?.displayName ?? "").toLowerCase();
          return (name && (name === key || name.includes(key))) || (displayName && (displayName === key || displayName.includes(key)));
        });
      });
    });
  }

  if (search) {
    events = events.filter((event) => matchesSearch(event, search));
  }

  if (type !== "all" && mode !== "raw" && mode !== "processed") {
    events = events.filter((event) => normalizeType(event?.type ?? event?.eventName) === type || matchesTypeAlias(event, type));
  }

  return events.slice().reverse().slice(offset, offset + limit);
}

function mergeCombatEventLists(rawEvents = [], processedEvents = [], replayEvents = []) {
  const merged = [];
  const seen = new Set();

  for (const event of [...rawEvents, ...processedEvents, ...replayEvents]) {
    const key = buildCombatEventDedupKey(event);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(event);
  }

  return merged.sort(compareCombatEventsForDisplay);
}

function buildCombatEventDedupKey(event = {}) {
  const rawLog = String(event?.rawLog ?? event?.raw?.rawLog ?? "").trim();
  if (rawLog) return `rawLog|${rawLog}`;
  const sourceEventId = String(
    event?.raw?.sourceEventId
    ?? event?.sourceEventId
    ?? event?.eventId
    ?? event?.id
    ?? "",
  ).trim();
  const type = normalizeType(event?.type ?? event?.eventName);
  const serverId = String(event?.serverId ?? "").trim();
  const sourceMarker = String(event?.sourceModule ?? event?.sourceLayer ?? "").trim().toLowerCase();

  if (!sourceEventId && !type && !serverId) return "";
  return [serverId, sourceEventId || type || "event", sourceMarker].filter(Boolean).join("|");
}

function compareCombatEventsForDisplay(left, right) {
  const leftTime = parseTimestampMs(left?.time ?? left?.createdAt ?? 0);
  const rightTime = parseTimestampMs(right?.time ?? right?.createdAt ?? 0);
  if (leftTime !== rightTime) return leftTime - rightTime;

  const leftId = String(left?.id ?? left?.eventId ?? "").localeCompare(String(right?.id ?? right?.eventId ?? ""));
  if (leftId !== 0) return leftId;

  return String(left?.sourceModule ?? "").localeCompare(String(right?.sourceModule ?? ""));
}

function translateToCombatStateType(type) {
  if (type === "all") return "all";
  if (type === "kill") return "death";
  if (type === "tk") return "tk";
  if (type === "teamdamage") return "teamDamage";
  if (type === "teamwound") return "teamWound";
  if (type === "teamkill") return "teamKill";
  return type;
}

function matchesTypeAlias(event, type) {
  const normalized = normalizeType(event?.type ?? event?.eventName);
  if (normalized === type) return true;
  if (type === "kill" && (normalized === "death" || normalized === "tk")) return true;
  if (type === "damage" && normalized === "damaged") return true;
  if (type === "wound" && normalized === "wounded") return true;
  if (type === "friendly") return Boolean(event?.isFriendlyFire || event?.relation?.isFriendlyFire || event?.tk || event?.isTeamKill);
  if (type === "teamdamage") return Boolean((normalized === "damage" || normalized === "damaged") && (event?.isFriendlyFire || event?.relation?.isFriendlyFire) && !event?.isTeamKill);
  if (type === "teamwound") return Boolean((normalized === "wound" || normalized === "wounded") && (event?.isFriendlyFire || event?.relation?.isFriendlyFire));
  if (type === "teamkill" || type === "tk") return Boolean((normalized === "kill" || normalized === "death" || normalized === "tk") && (event?.isFriendlyFire || event?.relation?.isFriendlyFire || event?.tk || event?.isTeamKill));
  return false;
}

function matchesSearch(event, search) {
  if (!search) return true;
  const haystack = [
    event?.attackerName,
    event?.victimName,
    event?.attacker?.name,
    event?.victim?.name,
    event?.weapon?.displayName,
    event?.weapon?.cleaned,
    event?.weapon,
    event?.causedBy,
    event?.rawCausedBy,
    event?.parseStatus,
    event?.eventName,
    event?.sourceModule,
    event?.sourceLayer,
    event?.sourceMode,
    event?.rawLog,
    ...(Array.isArray(event?.tags) ? event.tags : []),
  ]
    .map((item) => String(item ?? "").toLowerCase())
    .join(" | ");
  return haystack.includes(search);
}

function cloneJsonSafe(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function cloneList(list, mapFn) {
  return Array.isArray(list) ? list.map((item) => mapFn(item)) : [];
}

function selectPrimaryEventsFromModules(filter = {}) {
  return selectPrimaryEvents(filter);
}

var modulesRef = {};
var normalizeCombatEventRef = (record) => record;

export function bindCombatManagerModules(modules = {}) {
  modulesRef = modules ?? {};
}

export default createCombatManagerService;
