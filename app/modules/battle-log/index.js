// -*- coding: utf-8 -*-

const MODULE_ID = "module.battleLog";
const DEFAULT_MAX_EVENTS = 1500;
const VALID_STAT_TYPES = new Set([
  "down",
  "kill",
  "death",
  "revive",
  "tk",
  "player_connected",
  "player_joined",
  "player_disconnected",
  "player_left",
  "squad_created",
  "squad_disbanded",
  "map_bring_up",
  "map_changed",
]);
let activePlayerApi = null;
let activeBattleLogEvents = null;

export function createBattleLogModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: MODULE_ID,
    source: MODULE_ID,
    channel: "module",
  }) ?? core.logger;

  const moduleConfig = config?.get?.("modules.battleLog", {}) ?? {};
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const maxEvents = Math.max(1, Number(moduleConfig.maxEvents ?? DEFAULT_MAX_EVENTS));
  const sourceConfig = moduleConfig.sources ?? {};
  const logEnabled = Boolean(sourceConfig.log?.enabled ?? true);
  const modEnabled = Boolean(sourceConfig.mod?.enabled ?? false);
  activePlayerApi = modules?.playerState ?? null;

  const events = [];
  const seenEventKeys = new Set();
  const unsubscribers = [];
  let lastUpdatedAt = "";
  activeBattleLogEvents = events;

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.(MODULE_ID) !== false
      && core.pluginSubscriptions?.isSubscribed?.(MODULE_ID) !== false;
  }

  function handleCombatCleanWound(event) {
    if (!enabled || !logEnabled || !isSubscribed()) return null;
    const record = event?.record ?? null;
    if (!record) return null;

    const serverId = resolveServerId(event, record);
    const sourceEventId = resolveSourceEventId(record, event);
    const time = resolveTime(record, event);
    const attacker = resolveCombatIdentity(record, "attacker");
    const victim = resolveCombatIdentity(record, "victim");
    return pushBattleRecord(buildBattleRecord({
      statType: "down",
      sourceType: "log",
      sourceModule: "module.combatClean",
      sourceEventName: "module.combatClean.woundResolved",
      sourceEventId,
      serverId,
      time,
      playerRole: "victim",
      player: victim,
      counterparty: attacker,
      sourceRecord: record,
      relation: record.relation ?? {},
      tags: ["down"],
      note: "combatClean woundResolved",
    }));
  }

  function handleCombatCleanKill(event) {
    if (!enabled || !logEnabled || !isSubscribed()) return null;
    const record = event?.record ?? null;
    if (!record) return null;

    const relation = record.relation ?? {};
    if (relation.friendlyFireType === "team_kill" || record.isTeamKill || record.tk || relation.isFriendlyFire === true && relation.friendlyFireType === "team_kill") {
      return null;
    }

    const serverId = resolveServerId(event, record);
    const sourceEventId = resolveSourceEventId(record, event);
    const time = resolveTime(record, event);
    const attacker = resolveCombatIdentity(record, "attacker");
    const victim = resolveCombatIdentity(record, "victim");

    pushBattleRecord(buildBattleRecord({
      statType: "kill",
      sourceType: "log",
      sourceModule: "module.combatClean",
      sourceEventName: "module.combatClean.killResolved",
      sourceEventId,
      serverId,
      time,
      playerRole: "attacker",
      player: attacker,
      counterparty: victim,
      sourceRecord: record,
      relation,
      tags: ["kill"],
      note: "combatClean killResolved",
    }));

    return pushBattleRecord(buildBattleRecord({
      statType: "death",
      sourceType: "log",
      sourceModule: "module.combatClean",
      sourceEventName: "module.combatClean.killResolved",
      sourceEventId,
      serverId,
      time,
      playerRole: "victim",
      player: victim,
      counterparty: attacker,
      sourceRecord: record,
      relation,
      tags: ["death"],
      note: "combatClean killResolved",
    }));
  }

  function handleCombatCleanRevive(event) {
    if (!enabled || !logEnabled || !isSubscribed()) return null;
    const record = event?.record ?? null;
    if (!record) return null;

    const serverId = resolveServerId(event, record);
    const sourceEventId = resolveSourceEventId(record, event);
    const time = resolveTime(record, event);
    const rescuer = resolveCombatIdentity(record, "attacker");
    const revived = resolveCombatIdentity(record, "victim");

    return pushBattleRecord(buildBattleRecord({
      statType: "revive",
      sourceType: "log",
      sourceModule: "module.combatClean",
      sourceEventName: "module.combatClean.reviveResolved",
      sourceEventId,
      serverId,
      time,
      playerRole: "attacker",
      player: rescuer,
      counterparty: revived,
      sourceRecord: record,
      relation: record.relation ?? {},
      tags: ["revive"],
      note: "combatClean reviveResolved",
    }));
  }

  function handleTeamKill(event) {
    if (!enabled || !isSubscribed()) return null;
    const payload = event?.record ?? event?.payload ?? event?.data ?? event ?? {};
    if (!payload || typeof payload !== "object") return null;
    if (event?.eventName !== "TEAM_KILL" && !payload.isTeamKill) return null;

    const serverId = resolveServerId(event, payload);
    const sourceEventId = resolveTeamKillSourceEventId(event, payload);
    const time = resolveTime(payload, event);
    const attacker = resolveRconIdentity(payload, "attacker");
    const victim = resolveRconIdentity(payload, "victim");
    const relation = {
      isFriendlyFire: true,
      friendlyFireType: "team_kill",
      teamKillReason: String(payload.teamKillReason ?? payload.friendlyFireReason ?? "rcon_team_kill"),
    };

    pushBattleRecord(buildBattleRecord({
      statType: "tk",
      sourceType: "rcon",
      sourceModule: "core.rconManager",
      sourceEventName: "TEAM_KILL",
      sourceEventId,
      serverId,
      time,
      playerRole: "attacker",
      player: attacker,
      counterparty: victim,
      sourceRecord: payload,
      relation,
      tags: ["friendly_fire", "team_kill", "tk"],
      note: "RCON TEAM_KILL",
    }));

    return pushBattleRecord(buildBattleRecord({
      statType: "death",
      sourceType: "rcon",
      sourceModule: "core.rconManager",
      sourceEventName: "TEAM_KILL",
      sourceEventId,
      serverId,
      time,
      playerRole: "victim",
      player: victim,
      counterparty: attacker,
      sourceRecord: payload,
      relation,
      tags: ["friendly_fire", "team_kill", "death"],
      note: "RCON TEAM_KILL",
    }));
  }

  function handlePlayerConnected(event) {
    if (!enabled || !isSubscribed()) return null;
    const payload = normalizeCorePayload(event);
    const player = resolveCorePlayer(payload, event, "player");
    const time = resolveTime(payload, event);
    const sourceEventId = resolveCoreSourceEventId(event, payload);
    const note = buildPlayerConnectionNote(payload);
    return pushBattleRecord(buildBattleRecord({
      statType: "player_connected",
      sourceType: "core",
      sourceModule: event?.source ?? "core.eventBus",
      sourceEventName: event?.eventName ?? "On_PlayerConnected",
      sourceEventId,
      serverId: resolveServerId(event, payload),
      time,
      playerRole: "player",
      player,
      counterparty: null,
      sourceRecord: payload,
      relation: {},
      tags: ["player_connected"],
      note,
      displayMode: "single",
    }));
  }

  function handlePlayerJoined(event) {
    if (!enabled || !isSubscribed()) return null;
    const payload = normalizeCorePayload(event);
    const player = resolveCorePlayer(payload, event, "player");
    const time = resolveTime(payload, event);
    const sourceEventId = resolveCoreSourceEventId(event, payload);
    return pushBattleRecord(buildBattleRecord({
      statType: "player_joined",
      sourceType: "core",
      sourceModule: event?.source ?? "core.eventBus",
      sourceEventName: event?.eventName ?? "On_PlayerJoined",
      sourceEventId,
      serverId: resolveServerId(event, payload),
      time,
      playerRole: "player",
      player,
      counterparty: null,
      sourceRecord: payload,
      relation: {},
      tags: ["player_joined"],
      note: buildPlayerJoinNote(payload),
      displayMode: "single",
    }));
  }

  function handlePlayerDisconnected(event) {
    if (!enabled || !isSubscribed()) return null;
    const payload = normalizeCorePayload(event);
    const player = resolveCorePlayer(payload, event, "player");
    const time = resolveTime(payload, event);
    const sourceEventId = resolveCoreSourceEventId(event, payload);
    return pushBattleRecord(buildBattleRecord({
      statType: "player_disconnected",
      sourceType: "core",
      sourceModule: event?.source ?? "core.eventBus",
      sourceEventName: event?.eventName ?? "On_PlayerDisconnected",
      sourceEventId,
      serverId: resolveServerId(event, payload),
      time,
      playerRole: "player",
      player,
      counterparty: null,
      sourceRecord: payload,
      relation: {},
      tags: ["player_disconnected"],
      note: buildPlayerDisconnectNote(payload),
      displayMode: "single",
    }));
  }

  function handlePlayerLeft(event) {
    if (!enabled || !isSubscribed()) return null;
    const payload = normalizeCorePayload(event);
    const player = resolveCorePlayer(payload, event, "player");
    const time = resolveTime(payload, event);
    const sourceEventId = resolveCoreSourceEventId(event, payload);
    return pushBattleRecord(buildBattleRecord({
      statType: "player_left",
      sourceType: "core",
      sourceModule: event?.source ?? "core.eventBus",
      sourceEventName: event?.eventName ?? "On_PlayerLeft",
      sourceEventId,
      serverId: resolveServerId(event, payload),
      time,
      playerRole: "player",
      player,
      counterparty: null,
      sourceRecord: payload,
      relation: {},
      tags: ["player_left"],
      note: buildPlayerLeaveNote(payload),
      displayMode: "single",
    }));
  }

  function handleSquadCreated(event) {
    if (!enabled || !isSubscribed()) return null;
    const payload = normalizeCorePayload(event);
    const creator = resolveCorePlayer(payload, event, "creator");
    const time = resolveTime(payload, event);
    const sourceEventId = resolveCoreSourceEventId(event, payload);
    return pushBattleRecord(buildBattleRecord({
      statType: "squad_created",
      sourceType: "core",
      sourceModule: event?.source ?? "core.eventBus",
      sourceEventName: event?.eventName ?? "On_SquadCreated",
      sourceEventId,
      serverId: resolveServerId(event, payload),
      time,
      playerRole: "attacker",
      player: creator,
      counterparty: null,
      sourceRecord: payload,
      relation: {},
      tags: ["squad_created"],
      note: buildSquadCreateNote(payload),
      displayMode: "single",
    }));
  }

  function handleSquadDisbanded(event) {
    if (!enabled || !isSubscribed()) return null;
    const payload = normalizeCorePayload(event);
    const creator = resolveCorePlayer(payload, event, "creator");
    const time = resolveTime(payload, event);
    const sourceEventId = resolveCoreSourceEventId(event, payload);
    return pushBattleRecord(buildBattleRecord({
      statType: "squad_disbanded",
      sourceType: "core",
      sourceModule: event?.source ?? "core.eventBus",
      sourceEventName: event?.eventName ?? "On_SquadDisbanded",
      sourceEventId,
      serverId: resolveServerId(event, payload),
      time,
      playerRole: "attacker",
      player: creator,
      counterparty: null,
      sourceRecord: payload,
      relation: {},
      tags: ["squad_disbanded"],
      note: buildSquadDisbandNote(payload),
      displayMode: "single",
    }));
  }

  function handleRoundWorldBringUp(event) {
    if (!enabled || !isSubscribed()) return null;
    const payload = normalizeCorePayload(event);
    const player = resolveCorePlayer(payload, event, "player");
    const time = resolveTime(payload, event);
    const sourceEventId = resolveCoreSourceEventId(event, payload);
    return pushBattleRecord(buildBattleRecord({
      statType: "map_bring_up",
      sourceType: "core",
      sourceModule: event?.source ?? "core.eventBus",
      sourceEventName: event?.eventName ?? "round.world_bring_up",
      sourceEventId,
      serverId: resolveServerId(event, payload),
      time,
      playerRole: "player",
      player,
      counterparty: null,
      sourceRecord: payload,
      relation: {},
      tags: ["map_bring_up"],
      note: buildMapBringUpNote(payload),
      displayMode: "single",
    }));
  }

  function handleRoundMatchWinner(event) {
    if (!enabled || !isSubscribed()) return null;
    const payload = normalizeCorePayload(event);
    const player = resolveCorePlayer(payload, event, "player");
    const time = resolveTime(payload, event);
    const sourceEventId = resolveCoreSourceEventId(event, payload);
    return pushBattleRecord(buildBattleRecord({
      statType: "map_changed",
      sourceType: "core",
      sourceModule: event?.source ?? "core.eventBus",
      sourceEventName: event?.eventName ?? "round.match_winner",
      sourceEventId,
      serverId: resolveServerId(event, payload),
      time,
      playerRole: "player",
      player,
      counterparty: null,
      sourceRecord: payload,
      relation: {},
      tags: ["map_changed"],
      note: buildMapWinnerNote(payload),
      displayMode: "single",
    }));
  }

  function pushBattleRecord(record) {
    if (!record) return null;
    const key = String(record.sourceEventKey ?? "").trim();
    if (!key) return null;
    if (seenEventKeys.has(key)) return null;

    events.push(record);
    seenEventKeys.add(key);
    lastUpdatedAt = record.time || new Date().toISOString();

    while (events.length > maxEvents) {
      const removed = events.shift();
      if (removed?.sourceEventKey) seenEventKeys.delete(String(removed.sourceEventKey));
    }

    return record;
  }

  function rebuildSeenKeys() {
    seenEventKeys.clear();
    for (const record of events) {
      if (record?.sourceEventKey) {
        seenEventKeys.add(String(record.sourceEventKey));
      }
    }
  }

  function getFilteredEvents(filter = {}) {
    const serverId = String(filter.serverId ?? "").trim();
    const type = String(filter.type ?? "all").trim().toLowerCase();
    const search = String(filter.search ?? "").trim().toLowerCase();
    const playerKey = String(filter.playerKey ?? "").trim().toLowerCase();
    const limit = clampLimit(filter.limit, 200);
    const offset = Math.max(Number(filter.offset) || 0, 0);

    let result = events;
    if (serverId) {
      result = result.filter((record) => String(record.serverId ?? "").trim() === serverId);
    }
    if (VALID_STAT_TYPES.has(type)) {
      result = result.filter((record) => String(record.statType ?? record.type ?? "").trim().toLowerCase() === type);
    }
    if (playerKey) {
      result = result.filter((record) => matchesPlayerKey(record.player, playerKey) || matchesPlayerKey(record.counterparty, playerKey));
    }
    if (search) {
      result = result.filter((record) => matchesSearch(record, search));
    }

    return result
      .slice()
      .reverse()
      .slice(offset, offset + limit)
      .map(cloneJsonSafe);
  }

  function getOverview(serverId = "") {
    const filtered = getServerEvents(serverId);
    const stats = aggregateEvents(filtered);
    return {
      ok: true,
      enabled,
      source: "log",
      count: stats.total,
      stats,
      lastUpdatedAt,
      latest: filtered.slice(-20).reverse().map(cloneJsonSafe),
      sourceStatus: {
        log: { enabled: logEnabled, subscribed: isSubscribed() },
        mod: { enabled: modEnabled, subscribed: false, supported: false },
      },
      serverId: String(serverId ?? "").trim(),
    };
  }

  function getEvents(filter = {}) {
    return getFilteredEvents(filter);
  }

  function getPlayerStats(serverId = "", playerQuery = {}) {
    const identity = resolveQueryIdentity(playerQuery);
    const filtered = getServerEvents(serverId).filter((record) => matchesPlayerIdentity(record.player, identity));
    const stats = aggregateEvents(filtered);
    const resolvedPlayer = resolvePlayerProfile(serverId, identity) ?? identity;
    return {
      ok: true,
      enabled,
      source: "log",
      serverId: String(serverId ?? "").trim(),
      query: identity.queryText,
      player: resolvedPlayer,
      stats,
      count: stats.total,
      lastUpdatedAt: filtered[filtered.length - 1]?.time ?? "",
      latest: filtered.slice(-20).reverse().map(cloneJsonSafe),
    };
  }

  function getRateHistory(serverId = "", windowMinutes = 30) {
    const minutes = Math.max(1, Number(windowMinutes) || 30);
    const now = Date.now();
    const cutoff = now - minutes * 60 * 1000;
    const buckets = new Map();

    for (const record of getServerEvents(serverId)) {
      const eventTime = parseTimestampMs(record.time);
      if (eventTime < cutoff) continue;
      const bucketTime = Math.floor(eventTime / 60000) * 60000;
      if (!buckets.has(bucketTime)) {
        buckets.set(bucketTime, {
          timestamp: bucketTime,
          total: 0,
          down: 0,
          kill: 0,
          death: 0,
          revive: 0,
          tk: 0,
        });
      }
      const bucket = buckets.get(bucketTime);
      bucket.total += 1;
      const statType = String(record.statType ?? record.type ?? "").trim().toLowerCase();
      if (statType in bucket) bucket[statType] += 1;
    }

    return [...buckets.values()].sort((left, right) => left.timestamp - right.timestamp);
  }

  function clear(serverId = "") {
    const targetServerId = String(serverId ?? "").trim();
    const before = events.length;
    if (targetServerId) {
      const remaining = events.filter((record) => String(record.serverId ?? "").trim() !== targetServerId);
      events.splice(0, events.length, ...remaining);
    } else {
      events.splice(0, events.length);
    }
    rebuildSeenKeys();
    lastUpdatedAt = new Date().toISOString();
    moduleLogger.info("Battle log cleared.", {
      operation: "clear",
      data: {
        serverId: targetServerId,
        cleared: before - events.length,
      },
    });
    return {
      ok: true,
      cleared: before - events.length,
      serverId: targetServerId,
    };
  }

  function getStatus() {
    return {
      ok: true,
      enabled,
      source: "log",
      logEnabled,
      modEnabled,
      count: events.length,
      lastUpdatedAt,
      sourceStatus: {
        log: { enabled: logEnabled, subscribed: isSubscribed() },
        mod: { enabled: modEnabled, subscribed: false, supported: false },
      },
    };
  }

  function normalizeCombatCleanType(record) {
    return String(record?.type ?? record?.statType ?? "").trim().toLowerCase();
  }

  function replayCombatCleanRecord(record) {
    if (!record || typeof record !== "object") return null;

    const type = normalizeCombatCleanType(record);
    if (!type) return null;

    const event = {
      eventId: `module.combatClean:${record.id ?? resolveSourceEventId(record, null)}`,
      eventName: `module.combatClean.${type}Resolved`,
      layer: "module",
      source: "module.combatClean",
      serverId: record.serverId,
      time: record.time,
      record,
    };

    if (type === "wound") return handleCombatCleanWound(event);
    if (type === "kill") return handleCombatCleanKill(event);
    if (type === "revive") return handleCombatCleanRevive(event);
    return null;
  }

  function backfillFromCombatClean() {
    if (!enabled || !logEnabled || !isSubscribed()) {
      return { attempted: false, fetched: 0, imported: 0, reason: "disabled" };
    }

    const combatCleanApi = modules?.combatClean;
    if (!combatCleanApi?.getOverview || !combatCleanApi?.getEvents) {
      return { attempted: false, fetched: 0, imported: 0, reason: "combat_clean_unavailable" };
    }

    const overview = combatCleanApi.getOverview("");
    const total = Math.max(0, Number(overview?.count ?? 0));
    if (!total) {
      return { attempted: true, fetched: 0, imported: 0, reason: "empty" };
    }

    const fetchedRecords = combatCleanApi.getEvents({
      limit: Math.min(total, maxEvents),
      offset: 0,
    });
    const orderedRecords = Array.isArray(fetchedRecords) ? fetchedRecords.slice().reverse() : [];

    let imported = 0;
    for (const record of orderedRecords) {
      const before = events.length;
      replayCombatCleanRecord(record);
      imported += Math.max(0, events.length - before);
    }

    return {
      attempted: true,
      fetched: orderedRecords.length,
      imported,
      reason: imported > 0 ? "ok" : "deduped",
    };
  }

  async function backfillFromCombatManagerCache() {
    if (!enabled || !logEnabled || !isSubscribed()) {
      return { attempted: false, fetched: 0, imported: 0, reason: "disabled" };
    }

    const combatManagerApi = modules?.combatManager;
    if (!combatManagerApi?.readCacheSnapshot) {
      return { attempted: false, fetched: 0, imported: 0, reason: "combat_manager_unavailable" };
    }

    const targetServerId = String(core?.webStatus?.serverId ?? "").trim();
    const snapshot = await combatManagerApi.readCacheSnapshot(targetServerId);
    const cachedEvents = Array.isArray(snapshot?.events) ? snapshot.events : [];
    if (!cachedEvents.length) {
      return { attempted: true, fetched: 0, imported: 0, reason: "empty" };
    }

    const orderedRecords = cachedEvents
      .filter((record) => String(record?.sourceLayer ?? "processed").trim().toLowerCase() === "processed")
      .slice()
      .reverse();

    let imported = 0;
    for (const record of orderedRecords) {
      const before = events.length;
      replayCombatCleanRecord(record);
      imported += Math.max(0, events.length - before);
    }

    return {
      attempted: true,
      serverId: targetServerId,
      fetched: orderedRecords.length,
      imported,
      reason: imported > 0 ? "ok" : "deduped",
    };
  }

  const api = {
    getStatus,
    getOverview,
    getEvents,
    getPlayerStats,
    getRateHistory,
    clear,
  };

  return {
    manifest: {
      id: MODULE_ID,
      name: "战绩记录",
      kind: "module",
      version: "1.0.0",
      description: "战绩事件订阅层。当前只接收 combatClean 的击倒、击杀、死亡、复苏，以及 RCON TEAM_KILL 事件；后续可扩展 mod 全量战绩源。",
    },
    apiName: "battleLog",
    api,

    async start() {
      core.webRegistry?.registerPage?.({
        id: "web.battleLog",
        title: "战绩记录",
        group: "管理",
        route: "/battle-log",
        pageModule: "/pages/battle-log.js",
        source: MODULE_ID,
        required: false,
        enabled: true,
        order: 115,
        icon: "🏆",
        requiredPermission: "combat_manager.view",
        legacyRequiredPermissions: ["kill_manager.view"],
      });

      if (enabled && logEnabled) {
        unsubscribers.push(core.eventBus.onModuleEvent("module.combatClean", "woundResolved", handleCombatCleanWound));
        unsubscribers.push(core.eventBus.onModuleEvent("module.combatClean", "killResolved", handleCombatCleanKill));
        unsubscribers.push(core.eventBus.onModuleEvent("module.combatClean", "reviveResolved", handleCombatCleanRevive));
      }
      unsubscribers.push(core.eventBus.onCoreEvent("TEAM_KILL", handleTeamKill));
      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerConnected", handlePlayerConnected));
      unsubscribers.push(core.eventBus.onCoreEvent("PLAYER_CONNECTED", handlePlayerConnected));
      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerJoined", handlePlayerJoined));
      unsubscribers.push(core.eventBus.onCoreEvent("PLAYER_JOINED", handlePlayerJoined));
      unsubscribers.push(core.eventBus.onCoreEvent("PLAYER_POST_LOGIN", handlePlayerConnected));
      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerDisconnected", handlePlayerDisconnected));
      unsubscribers.push(core.eventBus.onCoreEvent("PLAYER_DISCONNECTED", handlePlayerDisconnected));
      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerLeft", handlePlayerLeft));
      unsubscribers.push(core.eventBus.onCoreEvent("PLAYER_LEFT", handlePlayerLeft));
      unsubscribers.push(core.eventBus.onCoreEvent("On_SquadCreated", handleSquadCreated));
      unsubscribers.push(core.eventBus.onCoreEvent("SQUAD_CREATED", handleSquadCreated));
      unsubscribers.push(core.eventBus.onCoreEvent("On_SquadDisbanded", handleSquadDisbanded));
      unsubscribers.push(core.eventBus.onCoreEvent("SQUAD_DISBANDED", handleSquadDisbanded));
      unsubscribers.push(core.eventBus.onCoreEvent("round.world_bring_up", handleRoundWorldBringUp));
      unsubscribers.push(core.eventBus.onCoreEvent("round.match_winner", handleRoundMatchWinner));

      const combatCleanBackfill = backfillFromCombatClean();
      const cacheBackfill = await backfillFromCombatManagerCache();

      moduleLogger.info("Battle log module started.", {
        operation: "start",
        data: {
          enabled,
          logEnabled,
          modEnabled,
          maxEvents,
          backfill: {
            combatClean: combatCleanBackfill,
            combatManagerCache: cacheBackfill,
          },
        },
      });
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe?.();
        } catch {}
      }
      moduleLogger.info("Battle log module stopped.", {
        operation: "stop",
        data: {
          count: events.length,
          lastUpdatedAt,
        },
      });
    },
  };
}

function resolveServerId(event, record) {
  return String(record?.serverId ?? event?.serverId ?? "").trim();
}

function resolveTime(record, event) {
  return String(record?.time ?? event?.time ?? new Date().toISOString());
}

function resolveSourceEventId(record, event) {
  return String(record?.raw?.sourceEventId ?? record?.sourceEventId ?? record?.id ?? event?.eventId ?? `${record?.serverId ?? event?.serverId ?? ""}:${record?.time ?? event?.time ?? Date.now()}:${Math.random().toString(16).slice(2)}`).trim();
}

function resolveTeamKillSourceEventId(event, payload) {
  return String(event?.eventId ?? payload?.sourceEventId ?? payload?.id ?? `${payload?.serverId ?? event?.serverId ?? ""}:${payload?.time ?? event?.time ?? Date.now()}:${Math.random().toString(16).slice(2)}`).trim();
}

function resolveCombatIdentity(record, side) {
  const key = side === "attacker" ? "attacker" : "victim";
  const source = record?.[key] && typeof record[key] === "object" ? record[key] : {};
  return resolvePlayerRef(record?.serverId ?? "", {
    name: firstPresent(source.displayName, source.name, record?.[`${key}Name`], record?.[`${key}DisplayName`]),
    steam64ID: firstPresent(source.steam64ID, source.steamID, record?.[`${key}Steam64ID`], record?.[`${key}SteamID`]),
    eosID: firstPresent(source.eosID, source.eosID, record?.[`${key}EOSID`], record?.[`${key}EosID`]),
    controllerID: firstPresent(source.controllerID, source.controllerID, record?.[`${key}ControllerID`], record?.[`${key}ControllerId`]),
    teamID: firstPresent(source.teamID, source.teamId, record?.[`${key}TeamID`], record?.[`${key}TeamId`]),
    squadID: firstPresent(source.squadID, source.squadId, record?.[`${key}SquadID`], record?.[`${key}SquadId`]),
  });
}

function resolveRconIdentity(payload, side) {
  const key = side === "attacker" ? "attacker" : "victim";
  return resolvePlayerRef(payload?.serverId ?? "", {
    name: firstPresent(payload?.[`${key}Name`], payload?.[`${key}`], payload?.[`${key}DisplayName`], key === "attacker" ? payload?.tk1 : payload?.tk2),
    steam64ID: firstPresent(payload?.[`${key}Steam64ID`], payload?.[`${key}SteamID`], payload?.[`${key}SteamId`]),
    eosID: firstPresent(payload?.[`${key}EOSID`], payload?.[`${key}EosID`]),
    controllerID: firstPresent(payload?.[`${key}ControllerID`], payload?.[`${key}ControllerId`]),
    teamID: firstPresent(payload?.[`${key}TeamID`], payload?.[`${key}TeamId`]),
    squadID: firstPresent(payload?.[`${key}SquadID`], payload?.[`${key}SquadId`]),
  });
}

function resolvePlayerRef(serverId, identity = {}) {
  const normalized = normalizePlayerRef(identity);
  const modulesPlayerState = getModulePlayerState();
  const playerApi = modulesPlayerState?.api ?? modulesPlayerState;
  const player =
    playerApi?.findPlayer?.(serverId, {
      steam64ID: normalized.steam64ID,
      steamID: normalized.steam64ID,
      eosID: normalized.eosID,
      controllerID: normalized.controllerID,
      name: normalized.name,
    })
    ?? playerApi?.getPlayerBySteamID?.(serverId, normalized.steam64ID)
    ?? playerApi?.getPlayerByEOSID?.(serverId, normalized.eosID)
    ?? playerApi?.getPlayerByControllerID?.(serverId, normalized.controllerID)
    ?? playerApi?.getPlayerByName?.(serverId, normalized.name)
    ?? null;

  if (player && typeof player === "object") {
    return normalizePlayerRef(player);
  }

  return normalized;
}

function getModulePlayerState() {
  return getModulePlayerApi();
}

function normalizePlayerRef(value = {}) {
  const source = value && typeof value === "object" ? value : { name: value };
  const name = cleanText(firstPresent(source.displayName, source.name, source.playerName, source.title));
  const steam64ID = cleanText(firstPresent(source.steam64ID, source.steamID, source.steamId));
  const eosID = cleanText(firstPresent(source.eosID, source.eosId));
  const controllerID = cleanText(firstPresent(source.controllerID, source.controllerId));
  const teamID = cleanText(firstPresent(source.teamID, source.teamId));
  const squadID = cleanText(firstPresent(source.squadID, source.squadId));

  return {
    name,
    displayName: cleanText(firstPresent(source.displayName, name, source.playerName, source.name)),
    steam64ID,
    steamID: steam64ID,
    eosID,
    controllerID,
    teamID,
    squadID,
    isBot: Boolean(source.isBot ?? false),
  };
}

function buildBattleRecord({
  statType,
  sourceType,
  sourceModule,
  sourceEventName,
  sourceEventId,
  serverId,
  time,
  playerRole,
  player,
  counterparty,
  sourceRecord,
  relation,
  tags = [],
  note = "",
}) {
  const subject = normalizePlayerRef(player);
  const other = normalizePlayerRef(counterparty);
  const sourceEventKey = [
    sourceModule,
    sourceEventId,
    statType,
    playerRole,
    playerKey(subject),
  ].join("|");

  return {
    id: sourceEventKey,
    sourceEventKey,
    serverId: cleanText(serverId),
    time: cleanText(time || new Date().toISOString()),
    eventTime: parseTimestampMs(time || new Date().toISOString()),
    type: statType,
    statType,
    sourceType,
    sourceModule,
    sourceEventName,
    sourceEventId: cleanText(sourceEventId),
    playerRole,
    player: subject,
    counterparty: other,
    playerKey: playerKey(subject),
    counterpartyKey: playerKey(other),
    playerName: subject.displayName || subject.name || "",
    counterpartyName: other.displayName || other.name || "",
    attacker: playerRole === "attacker" ? subject : other,
    victim: playerRole === "attacker" ? other : subject,
    attackerName: playerRole === "attacker" ? subject.displayName || subject.name || "" : other.displayName || other.name || "",
    victimName: playerRole === "attacker" ? other.displayName || other.name || "" : subject.displayName || subject.name || "",
    attackerSteam64ID: playerRole === "attacker" ? subject.steam64ID : other.steam64ID,
    victimSteam64ID: playerRole === "attacker" ? other.steam64ID : subject.steam64ID,
    attackerEOSID: playerRole === "attacker" ? subject.eosID : other.eosID,
    victimEOSID: playerRole === "attacker" ? other.eosID : subject.eosID,
    attackerControllerID: playerRole === "attacker" ? subject.controllerID : other.controllerID,
    victimControllerID: playerRole === "attacker" ? other.controllerID : subject.controllerID,
    attackerTeamID: playerRole === "attacker" ? subject.teamID : other.teamID,
    victimTeamID: playerRole === "attacker" ? other.teamID : subject.teamID,
    relation: cloneJsonSafe(relation ?? {}),
    isFriendlyFire: Boolean(relation?.isFriendlyFire),
    isTeamKill: statType === "tk",
    tk: statType === "tk",
    damage: 0,
    weapon: buildBattleWeapon(sourceRecord, sourceType),
    tags: uniqueStrings(tags),
    eventFlags: buildEventFlags(tags, sourceType),
    eventFlagLabels: uniqueStrings(buildEventFlags(tags, sourceType).map((flag) => flag.label)),
    displayText: buildDisplayText(statType, subject, other),
    note: cleanText(note || sourceEventName || statType),
    parse: { status: "Logged", warnings: [] },
    raw: {
      sourceModule,
      sourceEventId: cleanText(sourceEventId),
      sourceEventName,
    },
  };
}

function buildBattleWeapon(sourceRecord, sourceType) {
  const raw = firstPresent(sourceRecord?.weapon?.raw, sourceRecord?.weapon?.displayName, sourceRecord?.weaponName, sourceRecord?.causedBy, sourceRecord?.rawCausedBy, "");
  const cleaned = firstPresent(sourceRecord?.weapon?.cleaned, sourceRecord?.weapon?.displayName, sourceRecord?.weaponName, sourceRecord?.causedBy, sourceRecord?.rawCausedBy, "");
  const displayName = cleanText(firstPresent(sourceRecord?.weapon?.displayName, cleaned, raw, sourceType === "rcon" ? "RCON TEAM_KILL" : ""));
  return {
    raw: cleanText(raw),
    cleaned: cleanText(cleaned),
    displayName,
    typeKey: cleanText(sourceType),
    typeLabel: sourceType === "rcon" ? "RCON" : "log",
  };
}

function buildEventFlags(tags, sourceType) {
  const flags = uniqueStrings(tags).map((tag) => ({
    key: tag,
    label: formatTagLabel(tag),
  }));
  if (sourceType === "rcon") {
    flags.unshift({ key: "rcon", label: "RCON" });
  }
  return flags;
}

function buildDisplayText(statType, player, counterparty) {
  const left = player.displayName || player.name || "Unknown";
  const right = counterparty.displayName || counterparty.name || "Unknown";
  if (statType === "down") return `${left} downed by ${right}`;
  if (statType === "kill") return `${left} killed ${right}`;
  if (statType === "death") return `${left} died from ${right}`;
  if (statType === "revive") return `${left} revived ${right}`;
  if (statType === "tk") return `${left} team-killed ${right}`;
  return `${left} ${statType} ${right}`;
}

function aggregateEvents(records) {
  const stats = {
    total: 0,
    down: 0,
    kill: 0,
    death: 0,
    revive: 0,
    tk: 0,
  };

  for (const record of records) {
    stats.total += 1;
    const statType = String(record?.statType ?? record?.type ?? "").trim().toLowerCase();
    if (statType in stats) {
      stats[statType] += 1;
    }
  }

  return stats;
}

function getServerEvents(serverId = "") {
  const events = activeBattleLogEvents ?? [];
  const wantedServerId = String(serverId ?? "").trim();
  return wantedServerId
    ? events.filter((record) => String(record.serverId ?? "").trim() === wantedServerId)
    : events.slice();
}

function matchesSearch(record, search) {
  const text = [
    record?.displayText,
    record?.note,
    record?.sourceEventName,
    record?.sourceEventId,
    record?.sourceModule,
    record?.playerName,
    record?.counterpartyName,
    record?.attackerName,
    record?.victimName,
    record?.weapon?.displayName,
    record?.weapon?.cleaned,
    record?.weapon?.raw,
    ...(Array.isArray(record?.tags) ? record.tags : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return text.includes(search);
}

function matchesPlayerIdentity(player, identity) {
  if (!identity) return false;
  const key = playerKey(player);
  if (identity.playerKey && key && identity.playerKey === key) return true;
  if (identity.steam64ID && player.steam64ID && identity.steam64ID === player.steam64ID) return true;
  if (identity.eosID && player.eosID && identity.eosID === player.eosID) return true;
  if (identity.controllerID && player.controllerID && identity.controllerID === player.controllerID) return true;
  if (identity.name && normalizeName(identity.name) === normalizeName(player.name || player.displayName)) return true;
  return false;
}

function resolveQueryIdentity(playerQuery = {}) {
  const queryText = cleanText(playerQuery?.q ?? playerQuery?.query ?? playerQuery?.name ?? "");
  const identity = {
    queryText,
    playerKey: cleanText(playerQuery?.playerKey ?? ""),
    steam64ID: cleanText(playerQuery?.steam64ID ?? playerQuery?.steamID ?? ""),
    eosID: cleanText(playerQuery?.eosID ?? playerQuery?.eosId ?? ""),
    controllerID: cleanText(playerQuery?.controllerID ?? playerQuery?.controllerId ?? ""),
    name: cleanText(playerQuery?.name ?? queryText),
  };

  if (!identity.playerKey && !identity.steam64ID && !identity.eosID && !identity.controllerID && !identity.name) {
    identity.name = queryText;
  }

  return identity;
}

function resolvePlayerProfile(serverId, identity = {}) {
  const queryName = cleanText(identity.name ?? identity.queryText ?? "");
  const queryKey = cleanText(identity.playerKey ?? "");
  const querySteam = cleanText(identity.steam64ID ?? "");
  const queryEos = cleanText(identity.eosID ?? "");
  const queryController = cleanText(identity.controllerID ?? "");
  const playerApi = getModulePlayerApi();
  const player =
    playerApi?.findPlayer?.(serverId, {
      steam64ID: querySteam,
      steamID: querySteam,
      eosID: queryEos,
      controllerID: queryController,
      name: queryName,
    })
    ?? playerApi?.getPlayerBySteamID?.(serverId, querySteam)
    ?? playerApi?.getPlayerByEOSID?.(serverId, queryEos)
    ?? playerApi?.getPlayerByControllerID?.(serverId, queryController)
    ?? playerApi?.getPlayerByName?.(serverId, queryName)
    ?? null;

  if (player) return normalizePlayerRef(player);

  const fallback = {
    playerKey: queryKey,
    name: queryName,
    displayName: queryName,
    steam64ID: querySteam,
    steamID: querySteam,
    eosID: queryEos,
    controllerID: queryController,
  };

  return normalizePlayerRef(fallback);
}

function getModulePlayerApi() {
  return activePlayerApi;
}

function playerKey(player = {}) {
  const steam64ID = cleanText(player?.steam64ID ?? player?.steamID);
  if (steam64ID) return `steam64:${steam64ID.toLowerCase()}`;
  const eosID = cleanText(player?.eosID);
  if (eosID) return `eos:${eosID.toLowerCase()}`;
  const controllerID = cleanText(player?.controllerID);
  if (controllerID) return `controller:${controllerID.toLowerCase()}`;
  const name = cleanText(player?.name ?? player?.displayName);
  if (name) return `name:${normalizeName(name)}`;
  return "unknown";
}

function matchesPlayerKey(player, wantedKey) {
  if (!wantedKey) return false;
  return playerKey(player) === wantedKey;
}

function buildEventKey(record) {
  return String(record?.sourceEventKey ?? "").trim();
}

function parseTimestampMs(value) {
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function resolveCombatField(record, side, field) {
  const prefix = side === "attacker" ? "attacker" : "victim";
  const value = record?.[`${prefix}${field}`] ?? record?.[`${prefix}${field[0].toUpperCase()}${field.slice(1)}`];
  return value;
}

function sanitizeRawRecord(value) {
  return cloneJsonSafe(value);
}

function cloneJsonSafe(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function cleanText(value) {
  return String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeName(value) {
  return cleanText(value).toLowerCase();
}

function firstPresent(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).map((value) => cleanText(value)).filter(Boolean))];
}

function formatTagLabel(tag) {
  const value = cleanText(tag).toLowerCase();
  if (value === "tk") return "TK";
  if (value === "down") return "Down";
  if (value === "kill") return "Kill";
  if (value === "death") return "Death";
  if (value === "revive") return "Revive";
  if (value === "friendly_fire") return "Friendly Fire";
  if (value === "team_kill") return "Team Kill";
  return cleanText(tag);
}

function clampLimit(value, fallback = 200) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return Math.max(1, Math.floor(fallback));
  return Math.min(Math.floor(number), 1000);
}

function normalizeCorePayload(event = {}) {
  const payload = event?.payload ?? event?.data ?? event?.record ?? event?.normalized ?? event ?? {};
  const source = payload && typeof payload === "object" ? payload : {};
  const paramMap = source.paramMap && typeof source.paramMap === "object"
    ? source.paramMap
    : event?.paramMap && typeof event.paramMap === "object"
      ? event.paramMap
      : {};

  return {
    ...source,
    paramMap,
    eventName: firstPresent(source.eventName, source.Event, event?.eventName, ""),
    eventId: firstPresent(source.eventId, source.EventId, event?.eventId, ""),
    serverId: firstPresent(source.serverId, source.ServerID, event?.serverId, ""),
    time: firstPresent(source.time, source.Time, event?.time, new Date().toISOString()),
    logTime: firstPresent(source.logTime, source.LogTime, event?.logTime, ""),
    rawLog: firstPresent(source.rawLog, source.Raw, event?.rawLog, ""),
  };
}

function resolveCoreSourceEventId(event, payload) {
  return firstPresent(
    payload?.eventId,
    payload?.EventId,
    payload?.sourceEventId,
    payload?.SourceEventId,
    payload?.sourceSeq,
    payload?.SourceSeq,
    event?.eventId,
    event?.sourceEventId,
    `${payload?.serverId ?? event?.serverId ?? ""}:${payload?.time ?? event?.time ?? Date.now()}:${Math.random().toString(16).slice(2)}`,
  );
}

function resolveCorePlayer(payload, event, role = "player") {
  const serverId = resolveServerId(event, payload);
  const prefix = role === "creator" ? "Creator" : role === "player" ? "" : String(role ?? "").replace(/[^a-z0-9]/gi, "");
  const read = (...keys) => firstPresent(...keys.map((key) => {
    if (!key) return "";
    return payload?.[key] ?? payload?.paramMap?.[key] ?? event?.[key] ?? "";
  }));
  const name = read(
    `${prefix}PlayerName`,
    `${prefix}Name`,
    `${prefix}DisplayName`,
    "PlayerName",
    "Name",
    "DisplayName",
  );
  const controllerID = read(
    `${prefix}ControllerID`,
    `${prefix}ControllerId`,
    "ControllerID",
    "ControllerId",
  );
  const eosID = read(
    `${prefix}EOSID`,
    `${prefix}EosID`,
    "EOSID",
    "EosID",
  );
  const steam64ID = read(
    `${prefix}Steam64ID`,
    `${prefix}SteamID`,
    `${prefix}SteamId`,
    "Steam64ID",
    "SteamID",
    "SteamId",
  );
  const teamID = read(
    `${prefix}TeamID`,
    `${prefix}TeamId`,
    "TeamID",
    "TeamId",
  );
  const squadID = read(
    `${prefix}SquadID`,
    `${prefix}SquadId`,
    "SquadID",
    "SquadId",
  );

  return resolvePlayerRef(serverId, {
    name,
    displayName: name,
    controllerID,
    eosID,
    steam64ID,
    steamID: steam64ID,
    teamID,
    squadID,
  });
}

function buildPlayerConnectionNote(payload) {
  const name = firstPresent(payload?.PlayerName, payload?.paramMap?.PlayerName, payload?.playerName, "Unknown Player");
  const controller = firstPresent(payload?.ControllerID, payload?.paramMap?.ControllerID, "");
  const eos = firstPresent(payload?.EOSID, payload?.paramMap?.EOSID, "");
  const steam = firstPresent(payload?.Steam64ID, payload?.paramMap?.Steam64ID, "");
  return [
    `connected: ${name}`,
    controller ? `controller=${controller}` : "",
    eos ? `eos=${eos}` : "",
    steam ? `steam64=${steam}` : "",
  ].filter(Boolean).join(" | ");
}

function buildPlayerJoinNote(payload) {
  const name = firstPresent(payload?.PlayerName, payload?.paramMap?.PlayerName, payload?.playerName, "Unknown Player");
  const channel = firstPresent(payload?.Channel, payload?.paramMap?.Channel, "");
  return channel ? `joined: ${name} | channel=${channel}` : `joined: ${name}`;
}

function buildPlayerDisconnectNote(payload) {
  const name = firstPresent(payload?.PlayerName, payload?.paramMap?.PlayerName, payload?.playerName, "Unknown Player");
  return `disconnected: ${name}`;
}

function buildPlayerLeaveNote(payload) {
  const name = firstPresent(payload?.PlayerName, payload?.paramMap?.PlayerName, payload?.playerName, "Unknown Player");
  return `left: ${name}`;
}

function buildSquadCreateNote(payload) {
  const playerName = firstPresent(payload?.PlayerName, payload?.paramMap?.PlayerName, payload?.playerName, "Unknown Player");
  const squadName = firstPresent(payload?.SquadName, payload?.paramMap?.SquadName, payload?.squadName, "Squad");
  const squadId = firstPresent(payload?.SquadID, payload?.paramMap?.SquadID, payload?.squadId, "");
  const factionName = firstPresent(payload?.FactionName, payload?.paramMap?.FactionName, payload?.factionName, "");
  return [
    `squad created by ${playerName}`,
    squadName ? `squad=${squadName}` : "",
    squadId ? `squadId=${squadId}` : "",
    factionName ? `faction=${factionName}` : "",
  ].filter(Boolean).join(" | ");
}

function buildSquadDisbandNote(payload) {
  const playerName = firstPresent(payload?.PlayerName, payload?.paramMap?.PlayerName, payload?.playerName, "Unknown Player");
  const squadName = firstPresent(payload?.SquadName, payload?.paramMap?.SquadName, payload?.squadName, "Squad");
  return `squad disbanded by ${playerName}${squadName ? ` | squad=${squadName}` : ""}`;
}

function buildMapBringUpNote(payload) {
  const mapName = firstPresent(payload?.mapName, payload?.MapName, payload?.paramMap?.mapName, payload?.paramMap?.MapName, "");
  const gameMode = firstPresent(payload?.gameMode, payload?.GameMode, payload?.paramMap?.gameMode, payload?.paramMap?.GameMode, "");
  const worldPath = firstPresent(payload?.worldPath, payload?.WorldPath, payload?.paramMap?.worldPath, payload?.paramMap?.WorldPath, "");
  return [
    "round world bring up",
    mapName ? `map=${mapName}` : "",
    gameMode ? `mode=${gameMode}` : "",
    worldPath ? `world=${worldPath}` : "",
  ].filter(Boolean).join(" | ");
}

function buildMapWinnerNote(payload) {
  const winner = firstPresent(payload?.winner, payload?.Winner, payload?.paramMap?.winner, payload?.paramMap?.Winner, "");
  const mapName = firstPresent(payload?.mapName, payload?.MapName, payload?.paramMap?.mapName, payload?.paramMap?.MapName, "");
  return [
    "round winner",
    winner ? `winner=${winner}` : "",
    mapName ? `map=${mapName}` : "",
  ].filter(Boolean).join(" | ");
}
