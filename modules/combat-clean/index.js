// -*- coding: utf-8 -*-

const VALID_TYPES = new Set(["damage", "wound", "kill", "revive"]);
const DEFAULT_MAX_EVENTS = 5000;
const FALLBACK_REASON = "attacker_nullptr_use_victim";

export function createCombatCleanModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.combatClean",
    source: "module.combatClean",
    channel: "module",
  }) ?? core.logger;
  const moduleConfig = config?.get?.("modules.combatClean", {}) ?? {};
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const maxEvents = Math.max(1, Number(moduleConfig.maxEvents ?? DEFAULT_MAX_EVENTS));
  const events = [];
  const rejected = [];
  const sourceEventIds = new Set();
  const unsubscribers = [];
  let lastUpdatedAt = "";

  function ingest(event, { optionalTkFeed = false } = {}) {
    if (!isSubscribed()) return null;

    const rawRecord = event?.record ?? event?.rawRecord ?? null;
    if (!rawRecord || typeof rawRecord !== "object") {
      return reject(event, rawRecord, "missing_raw_record", ["module.killManage event does not include record"]);
    }

    const sourceEventId = String(rawRecord.sourceEventId ?? event?.eventId ?? rawRecord.id ?? "").trim();
    if (optionalTkFeed && sourceEventId && sourceEventIds.has(sourceEventId)) return null;

    const cleanType = normalizeType(rawRecord.type, event);
    if (!cleanType) {
      return reject(event, rawRecord, "unsupported_type", [`Unsupported raw combat type: ${String(rawRecord.type ?? "")}`]);
    }

    const victimIdentity = extractIdentity(rawRecord, "victim");
    if (isNullishPlayerValue(victimIdentity.name)) {
      return reject(event, rawRecord, "missing_victim", ["Victim is null, nullptr, or empty"]);
    }

    const warnings = [];
    let attackerIdentity = extractIdentity(rawRecord, "attacker");
    let attackerFallback = false;
    if (isNullishPlayerValue(attackerIdentity.name)) {
      attackerIdentity = { ...victimIdentity };
      attackerFallback = true;
      warnings.push(FALLBACK_REASON);
    }

    const serverId = String(rawRecord.serverId ?? event?.serverId ?? core.webStatus?.serverId ?? "");
    const victim = makePlayerRef(serverId, victimIdentity, rawRecord, "victim");
    const attacker = makePlayerRef(serverId, attackerIdentity, rawRecord, "attacker", {
      isFallback: attackerFallback,
      fallbackReason: attackerFallback ? FALLBACK_REASON : "",
    });
    const relation = buildRelation(cleanType, attacker, victim, rawRecord);
    const weapon = buildWeapon(rawRecord);
    const eventFlags = buildEventFlags(rawRecord, relation);
    const record = {
      id: makeCleanId(cleanType, sourceEventId, rawRecord),
      serverId,
      time: String(rawRecord.time ?? event?.time ?? new Date().toISOString()),
      logTime: String(rawRecord.logTime ?? event?.logTime ?? ""),
      type: cleanType,
      eventName: cleanType === "damage" ? "BZSS_DAMAGE" : cleanType === "wound" ? "BZSS_WOUND" : cleanType === "revive" ? "BZSS_REVIVE" : "BZSS_KILL",
      attacker,
      victim,
      damage: parseDamage(rawRecord.damage),
      weapon,
      relation,
      displayText: buildDisplayText(cleanType, attacker, victim, weapon, rawRecord.damage, relation),
      eventFlags,
      eventFlagLabels: eventFlags.map((flag) => String(flag?.label ?? "")).filter(Boolean),
      raw: {
        sourceModule: "module.killManage",
        sourceEventId,
        rawLog: String(rawRecord.rawLog ?? event?.rawLog ?? ""),
        rawRecord: sanitizeRawRecord(rawRecord),
      },
      parse: {
        status: String(rawRecord.parseStatus ?? "Cleaned"),
        warnings,
      },
    };

    events.push(record);
    if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
    if (sourceEventId) sourceEventIds.add(sourceEventId);
    lastUpdatedAt = record.time || new Date().toISOString();

    core.eventBus.emitModuleEvent("module.combatClean", `${cleanType}Resolved`, {
      eventId: `module.combatClean:${record.id}`,
      eventName: `module.combatClean.${cleanType}Resolved`,
      layer: "module",
      source: "module.combatClean",
      serverId: record.serverId,
      time: new Date().toISOString(),
      record,
    });
    core.eventBus.emitModuleEvent("module.combatClean", "updated", {
      eventId: `module.combatClean.updated:${Date.now()}`,
      eventName: "module.combatClean.updated",
      layer: "module",
      source: "module.combatClean",
      serverId: record.serverId,
      time: new Date().toISOString(),
      record,
      overview: api.getOverview(record.serverId),
    });

    logWithFallback(moduleLogger, "debug", () => `CombatClean accepted ${record.eventName}`, {
      operation: "ingest",
      eventName: record.eventName,
      data: { id: record.id, displayText: record.displayText },
    });

    return record;
  }

  function reject(event, rawRecord, status, warnings = []) {
    const item = {
      id: `rejected:${Date.now()}:${Math.random().toString(16).slice(2)}`,
      serverId: String(rawRecord?.serverId ?? event?.serverId ?? core.webStatus?.serverId ?? ""),
      time: String(rawRecord?.time ?? event?.time ?? new Date().toISOString()),
      status,
      warnings,
      raw: {
        sourceModule: "module.killManage",
        sourceEventId: String(rawRecord?.sourceEventId ?? event?.eventId ?? ""),
        rawLog: String(rawRecord?.rawLog ?? event?.rawLog ?? ""),
        rawRecord: sanitizeRawRecord(rawRecord),
      },
    };
    rejected.push(item);
    if (rejected.length > maxEvents) rejected.splice(0, rejected.length - maxEvents);
    core.eventBus.emitModuleEvent("module.combatClean", "rejected", {
      eventId: `module.combatClean:${item.id}`,
      eventName: "module.combatClean.rejected",
      layer: "module",
      source: "module.combatClean",
      serverId: item.serverId,
      time: new Date().toISOString(),
      rejection: item,
    });
    return item;
  }

  function makePlayerRef(serverId, identity, rawRecord, side, patch = {}) {
    const rawRef = {
      name: cleanPlayerValue(identity.name),
      teamID: identity.teamID ?? "",
      squadID: identity.squadID ?? "",
      steam64ID: cleanPlayerValue(identity.steam64ID),
      eosID: cleanPlayerValue(identity.eosID),
      controllerID: cleanPlayerValue(identity.controllerID),
      role: "",
      isLeader: false,
      resolved: false,
      resolutionSource: "raw",
      isNullptr: isNullishPlayerValue(identity.name),
      isFallback: false,
      fallbackReason: "",
    };

    const resolution = resolvePlayer(serverId, identity);
    if (resolution.player) {
      mergePlayer(rawRef, resolution.player);
      rawRef.resolved = true;
      rawRef.resolutionSource = resolution.source;
    } else if (rawRef.name || rawRef.steam64ID || rawRef.eosID || rawRef.controllerID) {
      rawRef.resolved = true;
      rawRef.resolutionSource = hasRawId(rawRef) ? "raw_id" : "raw_name";
    }

    if (side === "attacker" && patch.isFallback) {
      rawRef.isNullptr = false;
    }

    return {
      ...rawRef,
      ...patch,
    };
  }

  function resolvePlayer(serverId, identity = {}) {
    const steam64ID = cleanPlayerValue(identity.steam64ID);
    const eosID = cleanPlayerValue(identity.eosID);
    const controllerID = cleanPlayerValue(identity.controllerID);
    const name = cleanPlayerValue(identity.name);

    const playerState = modules?.playerState;
    const playerStatePlayer = playerState?.findPlayer?.(serverId, {
      steam64ID,
      eosID,
      controllerID,
      name,
    })
      ?? playerState?.getPlayerBySteamID?.(serverId, steam64ID)
      ?? playerState?.getPlayerByEOSID?.(serverId, eosID)
      ?? playerState?.getPlayerByControllerID?.(serverId, controllerID)
      ?? playerState?.getPlayerByName?.(serverId, name)
      ?? null;
    if (playerStatePlayer) {
      return { player: playerStatePlayer, source: "module.playerState" };
    }

    const matchPlayers = modules?.matchState?.getState?.()?.players;
    if (!matchPlayers) return { player: null, source: "" };

    const matchPlayer = matchPlayers.bySteam64ID?.[steam64ID]
      ?? matchPlayers.byEOSID?.[eosID]
      ?? matchPlayers.byControllerID?.[controllerID]
      ?? matchPlayers.byName?.[name]
      ?? findPlayerByNormalizedName(matchPlayers.list, serverId, name)
      ?? null;
    if (matchPlayer) {
      return { player: matchPlayer, source: "module.matchState" };
    }

    return { player: null, source: "" };
  }

  function buildRelation(type, attacker, victim, rawRecord) {
    const attackerTeamID = firstPresent(rawRecord.attackerTeamID, attacker.teamID);
    const victimTeamID = firstPresent(rawRecord.victimTeamID, victim.teamID);
    const sameTeam = sameKnownTeam(attackerTeamID, victimTeamID);
    const rawFriendly = Boolean(rawRecord.isFriendlyFire || rawRecord.isTeamKill || rawRecord.tk || rawRecord.tkDown);
    if (String(type ?? "").trim().toLowerCase() === "revive") {
      return {
        attackerTeamID,
        victimTeamID,
        sameTeam,
        isFriendlyFire: false,
        friendlyFireType: "",
        teamSource: resolveTeamSource(rawRecord, attacker, victim),
      };
    }
    const isFriendlyFire = Boolean(sameTeam || rawFriendly);
    const friendlyFireType = isFriendlyFire
      ? String(rawRecord.friendlyFireType || friendlyFireKind(type))
      : "";
    const teamSource = resolveTeamSource(rawRecord, attacker, victim);

    return {
      attackerTeamID,
      victimTeamID,
      sameTeam,
      isFriendlyFire,
      friendlyFireType,
      teamSource,
    };
  }

  function buildEventFlags(rawRecord, relation) {
    const flags = [];

    const pushFlag = (flag) => {
      if (!flag) return;
      const key = String(flag.key ?? "").trim();
      const label = String(flag.label ?? "").trim();
      if (!key && !label) return;
      if (key && flags.some((item) => String(item.key ?? "").trim() === key)) return;
      if (!key && label && flags.some((item) => String(item.label ?? "").trim() === label)) return;
      flags.push(cloneJsonSafe(flag));
    };

    const sameTextId = (left, right) => {
      const a = String(left ?? "").trim();
      const b = String(right ?? "").trim();
      return Boolean(a && b && a === b);
    };

    const isSameCombatIdentity = () => sameTextId(rawRecord.attackerSteam64ID, rawRecord.victimSteam64ID)
      || sameTextId(rawRecord.attackerEOSID, rawRecord.victimEOSID)
      || sameTextId(rawRecord.attackerControllerID, rawRecord.victimControllerID)
      || sameTextId(rawRecord.attackerName, rawRecord.victimName);

    const type = String(rawRecord.type ?? "").trim().toLowerCase();
    const damage = Number(rawRecord.damage);
    if ((type === "died" || type === "death") && Number.isFinite(damage) && Math.abs(damage) === 300) {
      pushFlag({ key: "give_up", label: "放弃", level: "neutral", reason: "died_damage_300" });
    }

    for (const flag of Array.isArray(rawRecord.eventFlags) ? rawRecord.eventFlags : []) {
      pushFlag(flag);
    }

    for (const label of Array.isArray(rawRecord.eventFlagLabels) ? rawRecord.eventFlagLabels : []) {
      const text = String(label).trim();
      if (!text) continue;
      pushFlag({ label: text });
    }

    if (flags.some((flag) => String(flag.key ?? "").trim() === "give_up" || String(flag.label ?? "").trim() === "放弃")) {
      if (isSameCombatIdentity()) {
        return flags;
      }
    }

    if (relation?.isFriendlyFire && relation?.friendlyFireType === "team_wound") {
      pushFlag({ key: "tk_down", label: "TK击倒", level: "warning", reason: "same_team" });
    }

    if (relation?.isFriendlyFire) {
      pushFlag({
        key: "friendly_fire",
        label: "友伤",
        level: relation?.friendlyFireType === "team_kill" ? "danger" : "warning",
        reason: rawRecord.friendlyFireReason || rawRecord.teamKillReason || "same_team",
      });
    }

    if (isSameCombatIdentity()) {
      pushFlag({
        key: "self_damage",
        label: "自伤",
        level: "warning",
        reason: "same_attacker_victim",
      });
    }

    return flags;
  }

  function buildWeapon(rawRecord) {
    const raw = String(rawRecord.rawCausedBy ?? rawRecord.weapon ?? rawRecord.causedBy ?? "").trim();
    const fallback = String(rawRecord.causedBy ?? rawRecord.weapon ?? rawRecord.rawCausedBy ?? "").trim();
    const cleaned = cleanWeaponName(raw || fallback);
    return {
      raw: raw || fallback,
      cleaned,
      category: String(rawRecord.causedByCategory ?? rawRecord.weaponCategory ?? "").trim(),
      displayName: cleaned || raw || fallback || "Unknown",
      sourceType: String(rawRecord.causedByCategory ?? "").trim() || (raw ? "rawCausedBy" : (fallback ? "causedBy" : "")),
    };
  }

  function getState(serverId = "") {
    const filtered = filterByServer(events, serverId);
    return {
      events: filtered.map(cloneJsonSafe),
      count: filtered.length,
      stats: buildStats(filtered),
      lastUpdatedAt,
      rejected: filterByServer(rejected, serverId).map(cloneJsonSafe),
    };
  }

  const api = {
    getState,

    getEvents(filter = {}) {
      const serverId = String(filter.serverId ?? "").trim();
      const type = String(filter.type ?? "all").trim();
      const search = normalizeSearch(filter.search);
      const playerKey = normalizeSearch(filter.playerKey);
      const limit = clampLimit(filter.limit, 200);
      const offset = clampOffset(filter.offset);

      let result = filterByServer(events, serverId);
      if (VALID_TYPES.has(type)) result = result.filter((event) => event.type === type);
      if (search) result = result.filter((event) => matchesSearch(event, search));
      if (playerKey) result = result.filter((event) => matchesPlayerKey(event, playerKey));

      return result.slice().reverse().slice(offset, offset + limit).map(cloneJsonSafe);
    },

    getOverview(serverId = "") {
      const filtered = filterByServer(events, serverId);
      const rejectedFiltered = filterByServer(rejected, serverId);
      return {
        serverId: String(serverId ?? ""),
        count: filtered.length,
        stats: buildStats(filtered),
        rejected: rejectedFiltered.length,
        lastUpdatedAt,
        latest: filtered.slice(-20).reverse().map(cloneJsonSafe),
      };
    },

    getPlayerEvents(serverId, playerQuery = {}, options = {}) {
      const keys = buildPlayerKeys(playerQuery);
      const limit = clampLimit(options.limit, 50);
      const offset = clampOffset(options.offset);
      let result = filterByServer(events, String(serverId ?? "").trim());
      if (keys.length) {
        result = result.filter((event) => keys.some((key) => matchesPlayerKey(event, key)));
      }
      return result.slice().reverse().slice(offset, offset + limit).map(cloneJsonSafe);
    },

    getEventById(id) {
      const text = String(id ?? "").trim();
      const found = events.find((event) => event.id === text);
      return found ? cloneJsonSafe(found) : null;
    },

    clear(serverId = "") {
      const target = String(serverId ?? "").trim();
      let cleared;
      if (target) {
        cleared = events.length;
        for (let i = events.length - 1; i >= 0; i -= 1) {
          if (String(events[i].serverId ?? "") === target) events.splice(i, 1);
        }
        cleared -= events.length;
      } else {
        cleared = events.length;
        events.splice(0);
      }
      sourceEventIds.clear();
      lastUpdatedAt = new Date().toISOString();
      core.eventBus.emitModuleEvent("module.combatClean", "updated", {
        eventId: `module.combatClean.clear:${Date.now()}`,
        eventName: "module.combatClean.updated",
        layer: "module",
        source: "module.combatClean",
        serverId: target || core.webStatus?.serverId || "",
        time: lastUpdatedAt,
        cleared,
        overview: api.getOverview(target),
      });
      return { ok: true, cleared };
    },
  };

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.("module.combatClean") !== false
      && core.pluginSubscriptions?.isSubscribed?.("module.combatClean") !== false;
  }

  return {
    manifest: {
      id: "module.combatClean",
      name: "\u6218\u6597\u7ba1\u7406\uff08\u5904\u7406\u540e\uff09",
      kind: "module",
      version: "0.2.0",
      description: "Combat Manager (Processed) event layer built from raw module.killManage evidence records. External plugins and the UDP forwarder should subscribe here instead of raw combat logs or combatState.",
    },
    apiName: "combatClean",
    api,

    async start() {
      core.webRegistry?.registerPage?.({
        id: "web.combatClean",
        title: "\u6218\u6597\u7ba1\u7406\uff08\u5904\u7406\u540e\uff09",
        group: "\u7ba1\u7406",
        route: "/combat-clean",
        pageModule: "/pages/combat-clean.js",
        source: "module.combatClean",
        required: false,
        enabled: true,
        order: 111,
        icon: "C",
      });

      if (!enabled) return;
      unsubscribers.push(core.eventBus.onModuleEvent("module.killManage", "combatResolved", ingest));
      unsubscribers.push(core.eventBus.onModuleEvent("module.killManage", "teamKillResolved", (event) => ingest(event, { optionalTkFeed: true })));
      logWithFallback(moduleLogger, "info", `CombatClean started. maxEvents=${maxEvents}`, {
        label: "MODULE",
        operation: "start",
        data: { maxEvents },
      });
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      logWithFallback(moduleLogger, "info", "CombatClean stopped.", {
        label: "MODULE",
        operation: "stop",
      });
    },
  };
}

function extractIdentity(rawRecord, side) {
  const prefix = side === "attacker" ? "attacker" : "victim";
  const title = side === "attacker" ? "Attacker" : "Victim";
  return {
    name: firstPresent(rawRecord[`${prefix}Name`], rawRecord[`${title}Name`]),
    teamID: firstPresent(rawRecord[`${prefix}TeamID`], rawRecord[`${title}TeamID`], rawRecord[`${prefix}TeamId`]),
    squadID: firstPresent(rawRecord[`${prefix}SquadID`], rawRecord[`${title}SquadID`], rawRecord[`${prefix}SquadId`]),
    steam64ID: firstPresent(rawRecord[`${prefix}Steam64ID`], rawRecord[`${prefix}SteamID`], rawRecord[`${title}Steam64ID`], rawRecord[`${title}SteamID`]),
    eosID: firstPresent(rawRecord[`${prefix}EOSID`], rawRecord[`${prefix}EosID`], rawRecord[`${title}EOSID`]),
    controllerID: firstPresent(rawRecord[`${prefix}ControllerID`], rawRecord[`${prefix}ControllerId`], rawRecord[`${title}ControllerID`]),
  };
}

function normalizeType(type, event) {
  const text = String(type ?? event?.record?.type ?? "").trim().toLowerCase();
  if (text === "damage" || text === "damaged") return "damage";
  if (text === "wound" || text === "wounded") return "wound";
  if (text === "revive" || text === "revived") return "revive";
  if (text === "kill" || text === "killed" || text === "death" || text === "died" || text === "tk") return "kill";
  return "";
}

function mergePlayer(target, player) {
  if (!target.name && player.name) target.name = String(player.name);
  if (!target.steam64ID && (player.steamID || player.steam64ID)) target.steam64ID = String(player.steamID ?? player.steam64ID);
  if (!target.eosID && player.eosID) target.eosID = String(player.eosID);
  if (!target.controllerID && player.controllerID) target.controllerID = String(player.controllerID);
  if ((target.teamID == null || target.teamID === "") && player.teamID != null) target.teamID = player.teamID;
  if ((target.squadID == null || target.squadID === "") && player.squadID != null) target.squadID = player.squadID;
  if (player.role) target.role = String(player.role);
  target.isLeader = Boolean(player.isLeader);
}

function buildDisplayText(type, attacker, victim, weapon, damage, relation) {
  if (String(type ?? "").trim().toLowerCase() === "revive") {
    const ff = relation.isFriendlyFire ? " [friendly fire]" : "";
    return `${attacker.name || "Unknown"} revived ${victim.name || "Unknown"}${ff}`;
  }
  const verb = type === "damage" ? "damaged" : type === "wound" ? "wounded" : "killed";
  const amount = damage == null || damage === "" ? "" : ` (${trimNumber(damage)})`;
  const ff = relation.isFriendlyFire ? " [friendly fire]" : "";
  return `${attacker.name || "Unknown"} ${verb} ${victim.name || "Unknown"} with ${weapon.displayName || "Unknown"}${amount}${ff}`;
}

function buildStats(list) {
  const stats = {
    total: list.length,
    damage: 0,
    wound: 0,
    kill: 0,
    revive: 0,
    friendlyFire: 0,
    teamDamage: 0,
    teamWound: 0,
    teamKill: 0,
  };
  for (const event of list) {
    if (event.type in stats) stats[event.type] += 1;
    if (event.relation?.isFriendlyFire) stats.friendlyFire += 1;
    if (event.relation?.friendlyFireType === "team_damage") stats.teamDamage += 1;
    if (event.relation?.friendlyFireType === "team_wound") stats.teamWound += 1;
    if (event.relation?.friendlyFireType === "team_kill") stats.teamKill += 1;
  }
  return stats;
}

function matchesSearch(event, search) {
  return [
    event.id,
    event.type,
    event.eventName,
    event.displayText,
    event.attacker?.name,
    event.victim?.name,
    event.attacker?.steam64ID,
    event.victim?.steam64ID,
    event.attacker?.eosID,
    event.victim?.eosID,
    event.weapon?.raw,
    event.weapon?.cleaned,
    event.weapon?.category,
    event.raw?.rawLog,
  ].some((value) => normalizeSearch(value).includes(search));
}

function matchesPlayerKey(event, playerKey) {
  const key = normalizeSearch(playerKey);
  if (!key) return true;
  return [event.attacker, event.victim].some((player) => [
    player?.name,
    normalizeName(player?.name),
    player?.steam64ID,
    player?.eosID,
    player?.controllerID,
  ].some((value) => normalizeSearch(value) === key || normalizeSearch(value).includes(key)));
}

function buildPlayerKeys(query) {
  if (typeof query === "string") return [normalizeSearch(query)].filter(Boolean);
  return [
    query?.playerKey,
    query?.steam64ID,
    query?.steamID,
    query?.eosID,
    query?.controllerID,
    query?.name,
  ].map(normalizeSearch).filter(Boolean);
}

function findPlayerByNormalizedName(players, serverId, name) {
  const normalizedName = normalizeName(name);
  if (!normalizedName) return null;
  for (const player of Array.isArray(players) ? players : []) {
    if (!player) continue;
    if (player.serverId != null && String(player.serverId) !== String(serverId)) continue;
    if (normalizeName(player.name) === normalizedName) return player;
  }
  return null;
}

function resolveTeamSource(rawRecord, attacker, victim) {
  if (rawRecord.attackerTeamID != null || rawRecord.victimTeamID != null) return "raw";
  const sources = new Set([attacker.resolutionSource, victim.resolutionSource].filter(Boolean));
  if (sources.size === 0) return "unknown";
  return [...sources].join("+");
}

function friendlyFireKind(type) {
  if (type === "damage") return "team_damage";
  if (type === "wound") return "team_wound";
  return "team_kill";
}

function cleanWeaponName(value) {
  return String(value ?? "")
    .trim()
    .replace(/^.+\./, "")
    .replace(/_C_\d+$/i, "")
    .replace(/_C$/i, "")
    .replace(/^BP_/, "")
    .replace(/_/g, " ")
    .trim();
}

function cleanPlayerValue(value) {
  return isNullishPlayerValue(value) ? "" : String(value ?? "").trim();
}

function isNullishPlayerValue(value) {
  const text = String(value ?? "").trim();
  return text === "" || /^null(?:ptr)?$/i.test(text) || /^none$/i.test(text);
}

function sameKnownTeam(left, right) {
  const leftText = String(left ?? "").trim();
  const rightText = String(right ?? "").trim();
  return leftText !== "" && rightText !== "" && leftText === rightText;
}

function hasRawId(ref) {
  return Boolean(ref.steam64ID || ref.eosID || ref.controllerID);
}

function firstPresent(...values) {
  for (const value of values) {
    if (value != null && String(value).trim() !== "") return value;
  }
  return "";
}

function parseDamage(value) {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

  function normalizeName(value) {
    return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  }

function normalizeSearch(value) {
  return String(value ?? "").trim().toLowerCase();
}

function filterByServer(list, serverId) {
  const target = String(serverId ?? "").trim();
  return target ? list.filter((event) => String(event.serverId ?? "") === target) : list;
}

function makeCleanId(type, sourceEventId, rawRecord) {
  const base = sourceEventId || rawRecord.id || `${rawRecord.serverId ?? ""}:${rawRecord.time ?? Date.now()}:${Math.random().toString(16).slice(2)}`;
  return `combatClean:${type}:${String(base).replace(/[^A-Za-z0-9_.:-]/g, "_")}`;
}

function clampLimit(value, defaultValue) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(5000, Math.max(1, parsed));
}

function clampOffset(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function trimNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "");
  return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(6)));
}

function cloneJsonSafe(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function sanitizeRawRecord(rawRecord) {
  const cloned = cloneJsonSafe(rawRecord);
  if (!cloned || typeof cloned !== "object") return cloned;

  delete cloned.confidence;
  delete cloned.Confidence;
  delete cloned.parseConfidence;
  delete cloned.ParseConfidence;
  delete cloned.identityConfidence;
  delete cloned.IdentityConfidence;
  delete cloned.teamConfidence;
  delete cloned.TeamConfidence;

  return cloned;
}

function logWithFallback(logger, method, message, context) {
  const fn = logger?.[method];
  if (typeof fn === "function") {
    fn.call(logger, message, context);
    return;
  }
  logger?.info?.(typeof message === "function" ? message() : message);
}

