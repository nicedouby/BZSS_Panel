// -*- coding: utf-8 -*-

const COMBAT_TYPES = {
  On_PlayerDamaged: "damage",
  On_PlayerWounded: "wound",
  On_PlayerDied: "death",
  On_PlayerRevived: "revive",
};

const VALID_FILTER_TYPES = new Set(["damage", "wound", "death", "revive", "friendly", "teamDamage", "teamWound", "teamKill", "tk"]);

/**
 * Module: CombatState
 *
 * Aggregates structured combat events emitted by the Python log parser.
 * It does not parse Squad.log lines; it only normalizes event params.
 */
export function createCombatStateModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.combatState",
    source: "module.combatState",
    channel: "module",
  }) ?? core.logger;
  const moduleConfig = config.get("modules.combatState", {});
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const maxEvents = Math.max(1, Number(moduleConfig.maxEvents ?? 5000));
  const events = [];
  const unsubscribers = [];
  let lastUpdatedAt = "";

  function ingest(event) {
    if (!isSubscribed()) return null;

    const type = COMBAT_TYPES[event?.eventName];
    if (!type) return null;

    const params = normalizeParams(event);
    const record = addTeamKillMetadata(normalizeCombatEvent({ event, params, type }));

    events.push(applyCombatEventFlags(record));
    if (events.length > maxEvents) {
      events.splice(0, events.length - maxEvents);
    }

    lastUpdatedAt = record.time || new Date().toISOString();
    logWithFallback(moduleLogger, "debug", () => `Combat event captured ${record.type}`, {
      operation: "ingest",
      eventName: record.eventName,
      data: {
        attackerName: record.attackerName,
        victimName: record.victimName,
        weapon: record.weapon,
      },
    });

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

  function ingestKillManageTeamKill(event) {
    if (!isSubscribed()) return null;
    const sourceRecord = event?.record;
    if (!sourceRecord?.isTeamKill) return null;
    if (sourceRecord.type !== "tk" && event?.eventName !== "TEAM_KILL") return null;

    const record = {
      id: String(sourceRecord.sourceEventId || event?.eventId || `tk:${Date.now()}:${Math.random().toString(16).slice(2)}`),
      type: "tk",
      eventName: String(event?.eventName ?? "module.killManage.teamKillResolved"),
      time: String(sourceRecord.time ?? event?.time ?? new Date().toISOString()),
      serverId: String(sourceRecord.serverId ?? event?.serverId ?? ""),
      victimName: String(sourceRecord.victimName ?? ""),
      attackerName: String(sourceRecord.attackerName ?? ""),
      damage: null,
      weapon: String(sourceRecord.weapon ?? ""),
      causedBy: String(sourceRecord.causedBy ?? "RCON_TEAM_KILL"),
      fromObject: "",
      attackerEOSID: String(sourceRecord.attackerEOSID ?? ""),
      attackerSteam64ID: String(sourceRecord.attackerSteam64ID ?? ""),
      attackerControllerID: String(sourceRecord.attackerControllerID ?? ""),
      victimEOSID: String(sourceRecord.victimEOSID ?? ""),
      victimSteam64ID: String(sourceRecord.victimSteam64ID ?? ""),
      attackerTeamID: sourceRecord.attackerTeamID ?? "",
      victimTeamID: sourceRecord.victimTeamID ?? "",
      identityConfidence: String(sourceRecord.identityConfidence ?? ""),
      parseConfidence: String(sourceRecord.parseConfidence ?? ""),
      confidence: String(sourceRecord.confidence ?? ""),
      parseStatus: String(sourceRecord.parseStatus ?? ""),
      identitySource: "",
      rawLog: String(sourceRecord.rawLog ?? ""),
      isFriendlyFire: true,
      isTeamKill: true,
      isTeamKillDown: false,
      tk: true,
      tkDown: false,
      friendlyFireType: "team_kill",
      friendlyFireLabel: "友军击杀",
      friendlyFireReason: sourceRecord.friendlyFireReason ?? sourceRecord.teamKillReason ?? "rcon_team_kill",
      teamKillReason: sourceRecord.teamKillReason ?? "rcon_team_kill",
      severity: "danger",
      tags: ["friendly_fire", "friendly_kill", "tk"],
    };

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
      time: record.time,
      record,
      stats: buildStats(),
    });
    return record;
  }

  function getState() {
    return {
      events: events.map(enrichEvent),
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
      revive: 0,
      teamDamage: 0,
      teamWound: 0,
      teamKill: 0,
    };

    for (const raw of events) {
      const event = enrichEvent(raw);
      if (event.type in stats) stats[event.type] += 1;
      if (event.friendlyFireType === "team_damage") stats.teamDamage += 1;
      if (event.friendlyFireType === "team_wound" || event.isTeamKillDown) stats.teamWound += 1;
      if (event.friendlyFireType === "team_kill" || event.isTeamKill) stats.teamKill += 1;
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
      const offset = Math.max(Number(filter.offset) || 0, 0);

      let result = events;

      if (VALID_FILTER_TYPES.has(type)) {
        if (type === "friendly") {
          result = result.filter((event) => event.isFriendlyFire);
        } else if (type === "teamDamage") {
          result = result.filter((event) => event.friendlyFireType === "team_damage");
        } else if (type === "teamWound") {
          result = result.filter((event) => event.friendlyFireType === "team_wound");
        } else if (type === "teamKill" || type === "tk") {
          result = result.filter((event) => event.friendlyFireType === "team_kill" || event.isTeamKill);
        } else {
          result = result.filter((event) => event.type === type);
        }
      }

      if (search) {
        result = result.filter((event) => matchesSearch(event, search));
      }

      return result.slice().reverse().slice(offset, offset + limit).map(enrichEvent);
    },

    clear() {
      const cleared = events.length;
      events.splice(0);
      lastUpdatedAt = new Date().toISOString();
      logWithFallback(moduleLogger, "info", `Cleared combat events (${cleared})`, {
        label: "MODULE",
        operation: "clear",
        data: {
          cleared,
        },
      });
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

  function resolvePlayer(serverId, identity = {}) {
    const playerState = modules?.playerState;
    const matchState = modules?.matchState;
    const steamID = String(identity.steamID ?? identity.steam64ID ?? "").trim();
    const eosID = String(identity.eosID ?? "").trim();
    const controllerID = String(identity.controllerID ?? "").trim();
    const name = String(identity.name ?? "").trim();

    const player =
      playerState?.getPlayerBySteamID?.(serverId, steamID)
      ?? playerState?.getPlayerByEOSID?.(serverId, eosID)
      ?? playerState?.getPlayerByControllerID?.(serverId, controllerID)
      ?? playerState?.getPlayerByName?.(serverId, name)
      ?? null;

    if (player) return player;

    const matchPlayers = matchState?.getState?.()?.players;
    if (!matchPlayers) return null;

    return matchPlayers.bySteam64ID?.[steamID]
      ?? matchPlayers.byEOSID?.[eosID]
      ?? matchPlayers.byControllerID?.[controllerID]
      ?? matchPlayers.byName?.[name]
      ?? findPlayerByNormalizedName(matchPlayers.list, serverId, name)
      ?? null;
  }

  function findPlayerByNormalizedName(players, serverId, name) {
    const normalizedName = normalizeName(name);
    if (!normalizedName) return null;

    const list = Array.isArray(players) ? players : [];
    for (const player of list) {
      if (!player) continue;
      if (player.serverId != null && String(player.serverId) !== String(serverId)) continue;
      if (normalizeName(player.name) === normalizedName) return player;
    }

    return null;
  }

  function normalizeName(value) {
    return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function toFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function sameTextId(left, right) {
    const a = String(left ?? "").trim();
    const b = String(right ?? "").trim();
    return Boolean(a && b && a === b);
  }

  function isSameCombatIdentity(record) {
    return sameTextId(record.attackerSteam64ID, record.victimSteam64ID)
      || sameTextId(record.attackerEOSID, record.victimEOSID)
      || sameTextId(record.attackerControllerID, record.victimControllerID)
      || sameTextId(record.attackerName, record.victimName);
  }

  function pushEventFlag(flags, flag) {
    if (!flag?.key) return;
    if (flags.some((item) => item.key === flag.key)) return;
    flags.push(flag);
  }

  function buildCombatEventFlags(record) {
    const flags = [];
    const type = String(record?.type ?? "").trim().toLowerCase();
    const damage = toFiniteNumber(record?.damage);

    if ((type === "died" || type === "death") && damage !== null && Math.abs(damage) === 300) {
      pushEventFlag(flags, {
        key: "give_up",
        label: "放弃",
        level: "neutral",
        reason: "died_damage_300",
      });
      if (isSameCombatIdentity(record)) {
        return flags;
      }
    }

    if (record?.isFriendlyFire) {
      pushEventFlag(flags, {
        key: "friendly_fire",
        label: "友伤",
        level: record?.isTeamKill || record?.isTeamKillDown ? "danger" : "warning",
        reason: record?.friendlyFireReason || "same_team",
      });
    }

    if (record?.isTeamKillDown) {
      pushEventFlag(flags, {
        key: "tk_down",
        label: "TK击倒",
        level: "warning",
        reason: record?.friendlyFireReason || "same_team",
      });
    }

    if (isSameCombatIdentity(record)) {
      pushEventFlag(flags, {
        key: "self_damage",
        label: "自伤",
        level: "warning",
        reason: "same_attacker_victim",
      });
    }

    return flags;
  }

  function applyCombatEventFlags(record) {
    const flags = buildCombatEventFlags(record);
    return {
      ...record,
      eventFlags: flags,
      eventFlagLabels: flags.map((flag) => flag.label),
      tags: [...new Set([
        ...(Array.isArray(record.tags) ? record.tags : []),
        ...flags.map((flag) => `event:${flag.key}`),
      ])],
    };
  }

  function addTeamKillMetadata(record) {
    const attacker = resolvePlayer(record.serverId, {
      name: record.attackerName,
      steamID: record.attackerSteam64ID,
      eosID: record.attackerEOSID,
      controllerID: record.attackerControllerID,
    });
    const victim = resolvePlayer(record.serverId, {
      name: record.victimName,
      steamID: record.victimSteam64ID,
      eosID: record.victimEOSID,
      controllerID: record.victimControllerID,
    });
    const attackerTeamID = record.attackerTeamID || attacker?.teamID || "";
    const victimTeamID = record.victimTeamID || victim?.teamID || "";
    if (String(record?.type ?? "").trim().toLowerCase() === "revive") {
      return applyCombatEventFlags({
        ...record,
        attackerTeamID,
        victimTeamID,
        isFriendlyFire: false,
        isTeamKill: false,
        isTeamKillDown: false,
        tk: false,
        tkDown: false,
        friendlyFireType: "",
        friendlyFireLabel: "",
        severity: "",
        tags: Array.isArray(record.tags) ? [...record.tags] : [],
      });
    }
    const isFriendlyFire = sameKnownTeam(attackerTeamID, victimTeamID);
    const friendlyFireKind = getFriendlyFireKind(record.type);
    const isTeamKill = Boolean(isFriendlyFire && friendlyFireKind.isTeamKill);
    const isTeamKillDown = Boolean(isFriendlyFire && friendlyFireKind.isTeamKillDown);

    return applyCombatEventFlags({
      ...record,
      attackerTeamID,
      victimTeamID,
      isFriendlyFire,
      isTeamKill,
      isTeamKillDown,
      tk: isTeamKill,
      tkDown: isTeamKillDown,
      friendlyFireType: isFriendlyFire ? friendlyFireKind.type : "",
      friendlyFireLabel: isFriendlyFire ? friendlyFireKind.label : "",
      severity: isFriendlyFire ? "danger" : "",
      tags: isFriendlyFire
        ? ["friendly_fire", friendlyFireKind.tag, ...(isTeamKill ? ["tk"] : []), ...(isTeamKillDown ? ["tk_down"] : [])]
        : [],
    });
  }

  function enrichEvent(event) {
    const base = cloneEvent(event);

    // Late-bind team info and friendly-fire classification so older events can
    // become fully annotated once PlayerState gets a team snapshot.
    const attacker = resolvePlayer(base.serverId, {
      name: base.attackerName,
      steamID: base.attackerSteam64ID,
      eosID: base.attackerEOSID,
      controllerID: base.attackerControllerID,
    });
    const victim = resolvePlayer(base.serverId, {
      name: base.victimName,
      steamID: base.victimSteam64ID,
      eosID: base.victimEOSID,
      controllerID: base.victimControllerID,
    });

    const attackerTeamID = base.attackerTeamID || attacker?.teamID || "";
    const victimTeamID = base.victimTeamID || victim?.teamID || "";
    if (String(base.type ?? "").trim().toLowerCase() === "revive") {
      return applyCombatEventFlags({
        ...base,
        attackerTeamID,
        victimTeamID,
        isFriendlyFire: false,
        isTeamKill: false,
        isTeamKillDown: false,
        tk: false,
        tkDown: false,
        friendlyFireType: "",
        friendlyFireLabel: "",
        severity: base.severity || "",
        tags: Array.isArray(base.tags) ? [...base.tags] : [],
      });
    }
    const isFriendlyFire = sameKnownTeam(attackerTeamID, victimTeamID) || Boolean(base.isFriendlyFire);
    const friendlyFireKind = getFriendlyFireKind(base.type);
    const isTeamKill = Boolean(isFriendlyFire && friendlyFireKind.isTeamKill) || Boolean(base.isTeamKill || base.tk);
    const isTeamKillDown = Boolean(isFriendlyFire && friendlyFireKind.isTeamKillDown) || Boolean(base.isTeamKillDown || base.tkDown);

    return applyCombatEventFlags({
      ...base,
      attackerTeamID,
      victimTeamID,
      isFriendlyFire,
      isTeamKill,
      isTeamKillDown,
      tk: isTeamKill,
      tkDown: isTeamKillDown,
      friendlyFireType: isFriendlyFire ? (base.friendlyFireType || friendlyFireKind.type) : "",
      friendlyFireLabel: isFriendlyFire ? (base.friendlyFireLabel || friendlyFireKind.label) : "",
      severity: isFriendlyFire ? "danger" : (base.severity || ""),
      tags: isFriendlyFire
        ? [...new Set([...(Array.isArray(base.tags) ? base.tags : []), "friendly_fire", friendlyFireKind.tag, ...(isTeamKill ? ["tk"] : []), ...(isTeamKillDown ? ["tk_down"] : [])])]
        : (Array.isArray(base.tags) ? base.tags : []),
    });
  }

  // CombatState 是实时事件入口之一。
  // 关闭订阅后保留模块实例与历史数据，但不再接收新的战斗事件。
  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.("module.combatState") !== false
      && core.pluginSubscriptions?.isSubscribed?.("module.combatState") !== false;
  }

  return {
    manifest: { id: "module.combatState", name: "Combat State Module", kind: "module", version: "0.1.0", description: "战斗状态追踪模块。在 KillManage 之上进行更细粒度的战斗场景分析，包括连杀判定、阵亡速度、交战热度等派生指标。为将来的高级战报、英雄榜等功能提供基础数据结构，目前以骨架形态存在，供后续扩展。" },
    apiName: "combatState",
    api,

    async start() {
      if (!enabled) return;
      for (const eventName of Object.keys(COMBAT_TYPES)) {
        unsubscribers.push(core.eventBus.onCoreEvent(eventName, ingest));
      }
      if (core.eventBus?.onModuleEvent) {
        unsubscribers.push(core.eventBus.onModuleEvent("module.killManage", "teamKillResolved", ingestKillManageTeamKill));
      }
      logWithFallback(moduleLogger, "info", `CombatState started. maxEvents=${maxEvents}`, {
        label: "MODULE",
        operation: "start",
        data: {
          maxEvents,
        },
      });
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      events.splice(0);
      lastUpdatedAt = "";
      logWithFallback(moduleLogger, "info", "CombatState stopped.", {
        label: "MODULE",
        operation: "stop",
      });
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
    attackerTeamID: getParam(params, "AttackerTeamID") || getParam(params, "AttackerTeamId") || getParam(params, "AttackerTeam"),
    victimTeamID: getParam(params, "VictimTeamID") || getParam(params, "VictimTeamId") || getParam(params, "VictimTeam"),
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
    event.attackerTeamID,
    event.victimTeamID,
    ...(Array.isArray(event.tags) ? event.tags : []),
  ].some((value) => String(value ?? "").toLowerCase().includes(search));
}

function sameKnownTeam(left, right) {
  if (left == null || right == null) return false;
  const leftText = String(left).trim();
  const rightText = String(right).trim();
  return leftText !== "" && rightText !== "" && leftText === rightText;
}

function getFriendlyFireKind(type) {
  const normalized = String(type ?? "").toLowerCase();
  if (normalized === "damaged" || normalized === "damage") {
    return { type: "team_damage", label: "友军伤害", tag: "friendly_damage", isTeamKill: false };
  }
  if (normalized === "wounded" || normalized === "wound") {
    return { type: "team_wound", label: "TK击倒", tag: "tk_down", isTeamKill: false, isTeamKillDown: true };
  }
  return { type: "team_kill", label: "友军击杀", tag: "friendly_kill", isTeamKill: true, isTeamKillDown: false };
}

function cloneEvent(event) {
  return { ...event };
}

function logWithFallback(logger, method, message, context) {
  const fn = logger?.[method];
  if (typeof fn === "function") {
    fn.call(logger, message, context);
    return;
  }

  const rendered = typeof message === "function" ? message() : message;
  logger?.module?.(rendered);
}
