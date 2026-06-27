// -*- coding: utf-8 -*-

import { getParam } from "../../core/event-normalizer.js";

/**
 * Module: PlayerState
 *
 * Canonical in-memory player list per server.
 * Other modules should resolve players through this list instead of rebuilding
 * ad hoc indexes on their own.
 */
export function createPlayerStateModule({ core, modules, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.playerState",
    source: "module.playerState",
    channel: "module",
  }) ?? core.logger;
  const servers = new Map();
  const commanderByServer = new Map();
  const unsubscribers = [];

  function ensureServerState(serverId) {
    const key = String(serverId ?? "");
    if (!servers.has(key)) {
      servers.set(key, {
        playersByKey: new Map(),
        byName: new Map(),
        byNormalizedName: new Map(),
        bySteamID: new Map(),
        byEOSID: new Map(),
        byControllerID: new Map(),
        updatedAt: "",
      });
    }
    return servers.get(key);
  }

  function clearServer(serverId) {
    const state = ensureServerState(serverId);
    state.playersByKey.clear();
    state.byName.clear();
    state.byNormalizedName.clear();
    state.bySteamID.clear();
    state.byEOSID.clear();
    state.byControllerID.clear();
    state.updatedAt = new Date().toISOString();
  }

  function indexPlayer(serverState, player) {
    const playerKey = getCanonicalPlayerKey(player);
    if (player.name) {
      serverState.byName.set(String(player.name), playerKey);
      const normalizedName = normalizeName(player.name);
      if (normalizedName) serverState.byNormalizedName.set(normalizedName, playerKey);
    }
    if (player.steamID) serverState.bySteamID.set(String(player.steamID), playerKey);
    if (player.eosID) serverState.byEOSID.set(String(player.eosID), playerKey);
    if (player.controllerID) serverState.byControllerID.set(String(player.controllerID), playerKey);
  }

  function rebuildIndexes(serverState) {
    serverState.byName.clear();
    serverState.byNormalizedName.clear();
    serverState.bySteamID.clear();
    serverState.byEOSID.clear();
    serverState.byControllerID.clear();

    for (const player of serverState.playersByKey.values()) {
      indexPlayer(serverState, player);
    }
    serverState.updatedAt = new Date().toISOString();
  }

  function resolveExistingPlayer(serverState, identity = {}) {
    const steamID = cleanIdentityValue(identity.steamID ?? identity.steam64ID);
    const eosID = cleanIdentityValue(identity.eosID);
    const controllerID = cleanIdentityValue(identity.controllerID);
    const name = cleanIdentityValue(identity.name);
    const normalizedName = normalizeName(name);

    const playerKey = (steamID ? serverState.bySteamID.get(steamID) : null)
      ?? (eosID ? serverState.byEOSID.get(eosID) : null)
      ?? (controllerID ? serverState.byControllerID.get(controllerID) : null)
      ?? (name ? serverState.byName.get(name) : null)
      ?? (normalizedName ? serverState.byNormalizedName.get(normalizedName) : null)
      ?? null;

    return playerKey ? serverState.playersByKey.get(playerKey) ?? null : null;
  }

  function upsertPlayer(serverId, identity = {}, patch = {}) {
    const state = ensureServerState(serverId);
    const existing = resolveExistingPlayer(state, identity);
    const base = existing ?? {
      serverId,
      playerID: "",
      name: cleanIdentityValue(identity.name),
      steamID: cleanIdentityValue(identity.steamID ?? identity.steam64ID),
      eosID: cleanIdentityValue(identity.eosID),
      controllerID: cleanIdentityValue(identity.controllerID),
      teamID: "",
      squadID: "",
      previousTeamID: "",
      previousSquadID: "",
      firstSeenAt: "",
      lastSquadChangeAt: "",
      squadJoinedAt: "",
      squadLeftAt: "",
      squadlessSince: "",
      squadlessSeconds: 0,
      isLeader: false,
      role: "",
      state: "unknown",
      raw: "",
      lastSeenTime: "",
    };

    const next = {
      ...base,
      ...patch,
      serverId,
      name: firstNonEmpty(patch.name, identity.name, base.name),
      steamID: firstNonEmpty(patch.steamID, patch.steam64ID, identity.steamID, identity.steam64ID, base.steamID),
      eosID: firstNonEmpty(patch.eosID, identity.eosID, base.eosID),
      controllerID: firstNonEmpty(patch.controllerID, identity.controllerID, base.controllerID),
      teamID: normalizeRconId(patch.teamID ?? base.teamID),
      squadID: normalizeRconId(patch.squadID ?? base.squadID),
      lastSeenTime: patch.lastSeenTime ?? new Date().toISOString(),
    };

    if (existing) {
      const oldKey = getCanonicalPlayerKey(existing);
      existing.playerID = next.playerID;
      existing.name = next.name;
      existing.steamID = next.steamID;
      existing.eosID = next.eosID;
      existing.controllerID = next.controllerID;
      existing.teamID = next.teamID;
      existing.squadID = next.squadID;
      existing.previousTeamID = next.previousTeamID ?? existing.previousTeamID;
      existing.previousSquadID = next.previousSquadID ?? existing.previousSquadID;
      existing.firstSeenAt = next.firstSeenAt ?? existing.firstSeenAt;
      existing.lastSquadChangeAt = next.lastSquadChangeAt ?? existing.lastSquadChangeAt;
      existing.squadJoinedAt = next.squadJoinedAt ?? existing.squadJoinedAt;
      existing.squadLeftAt = next.squadLeftAt ?? existing.squadLeftAt;
      existing.squadlessSince = next.squadlessSince ?? existing.squadlessSince;
      existing.squadlessSeconds = next.squadlessSeconds ?? existing.squadlessSeconds;
      existing.isLeader = Boolean(next.isLeader);
      existing.role = next.role ?? "";
      existing.state = next.state ?? existing.state;
      existing.raw = next.raw ?? existing.raw;
      existing.lastSeenTime = next.lastSeenTime;
      existing.lastSpawnTime = next.lastSpawnTime ?? existing.lastSpawnTime;
      const newKey = getCanonicalPlayerKey(existing);
      if (oldKey !== newKey) {
        state.playersByKey.delete(oldKey);
        state.playersByKey.set(newKey, existing);
      }
      rebuildIndexes(state);
      return existing;
    }

    state.playersByKey.set(getCanonicalPlayerKey(next), next);
    rebuildIndexes(state);
    return next;
  }

  function emitSquadMembershipChange(change) {
    const payload = {
      eventId: `module.playerState:squad:${change.serverId}:${change.playerKey}:${Date.now()}`,
      eventName: change.eventName,
      layer: "module",
      source: "module.playerState",
      serverId: change.serverId,
      time: change.time,

      reason: "rconListPlayersDiff",
      sourceEventName: "RCON_LIST_PLAYERS_UPDATED",

      player: {
        playerKey: change.playerKey,
        playerID: change.current.playerID,
        name: change.current.name,
        steamID: change.current.steamID,
        eosID: change.current.eosID,
        controllerID: change.current.controllerID,
        role: change.current.role,
        isLeader: Boolean(change.current.isLeader),
      },

      previous: {
        teamID: change.previousTeamID,
        squadID: change.previousSquadID,
      },

      current: {
        teamID: change.currentTeamID,
        squadID: change.currentSquadID,
      },
    };

    core.eventBus.emitModuleEvent("module.playerState", change.eventType, payload);

    logWithFallback(moduleLogger, "info", () => {
      if (change.type === "joined") {
        return `[PLAYER_STATE] ${change.current.name} joined squad ${change.currentSquadID}`;
      }
      if (change.type === "left") {
        return `[PLAYER_STATE] ${change.current.name} left squad ${change.previousSquadID}`;
      }
      return `[PLAYER_STATE] ${change.current.name} changed squad ${change.previousSquadID} -> ${change.currentSquadID}`;
    }, {
      operation: "squadMembershipChanged",
      data: payload,
    });
  }

  function emitCommanderAuthorized(change) {
    const payload = {
      eventId: `module.playerState:commanderAuthorized:${change.serverId}:${change.playerKey}:${Date.now()}`,
      eventName: "module.playerState.commanderAuthorized",
      layer: "module",
      source: "module.playerState",
      serverId: change.serverId,
      time: change.time,

      reason: "rconListPlayersDiff",
      sourceEventName: "RCON_LIST_PLAYERS_UPDATED",

      player: {
        playerKey: change.playerKey,
        playerID: change.current.playerID,
        name: change.current.name,
        steamID: change.current.steamID,
        eosID: change.current.eosID,
        controllerID: change.current.controllerID,
        role: change.current.role,
        isLeader: Boolean(change.current.isLeader),
      },

      previous: {
        teamID: change.previousTeamID,
        squadID: change.previousSquadID,
        isLeader: Boolean(change.previous?.isLeader),
      },

      current: {
        teamID: change.currentTeamID,
        squadID: change.currentSquadID,
        isLeader: Boolean(change.current?.isLeader),
      },

      commander: {
        authorized: true,
        source: "commandSquad",
      },
    };

    core.eventBus.emitModuleEvent("module.playerState", "commanderAuthorized", payload);

    logWithFallback(moduleLogger, "info", () => {
      return `[PLAYER_STATE] commander authorized: ${change.current.name} (squad ${change.currentSquadID})`;
    }, {
      operation: "commanderAuthorized",
      data: payload,
    });
  }

  function updateCommanderAuthorizationFromSnapshot(serverId, oldMap, newMap, now) {
    const prev = commanderByServer.get(String(serverId ?? "")) ?? { playerKey: "" };
    const commandSquadKeys = resolveCommandSquadKeys(modules, serverId);
    const candidate = detectCommanderCandidate(newMap, commandSquadKeys);
    if (!candidate) return;
    if (candidate.playerKey && candidate.playerKey === prev.playerKey) return;

    commanderByServer.set(String(serverId ?? ""), {
      playerKey: candidate.playerKey,
      observedAt: now,
    });

    const previous = oldMap.get(candidate.playerKey) ?? null;
    const previousSquadID = normalizeRconId(previous?.squadID);
    const currentSquadID = normalizeRconId(candidate.current.squadID);
    const previousTeamID = normalizeRconId(previous?.teamID);
    const currentTeamID = normalizeRconId(candidate.current.teamID);

    emitCommanderAuthorized({
      serverId,
      playerKey: candidate.playerKey,
      previous,
      current: candidate.current,
      previousTeamID,
      currentTeamID,
      previousSquadID,
      currentSquadID,
      time: now,
    });
  }

  function replaceFromRcon(serverId, players) {
    const now = new Date().toISOString();
    const state = ensureServerState(serverId);
    const hadPreviousSnapshot = state.playersByKey.size > 0;

    const oldComparableMap = new Map();
    const oldStateByStableKey = new Map();
    for (const player of state.playersByKey.values()) {
      const normalized = normalizeRconPlayer(player);
      const key = getStablePlayerKey(normalized);
      if (!key) continue;
      oldComparableMap.set(key, normalized);
      oldStateByStableKey.set(key, player);
    }

    const newComparableMap = makeComparablePlayerSnapshot(players);
    const changes = hadPreviousSnapshot
      ? detectSquadMembershipChanges(serverId, oldComparableMap, newComparableMap, now)
      : [];

    clearServer(serverId);
    const nextState = ensureServerState(serverId);

    for (const player of players) {
      const normalized = normalizeRconPlayer(player);
      const playerKey = getStablePlayerKey(normalized);
      const previous = playerKey ? oldStateByStableKey.get(playerKey) : null;
      const previousSquadID = normalizeRconId(previous?.squadID);
      const currentSquadID = normalizeRconId(normalized.squadID);
      const previousTeamID = normalizeRconId(previous?.teamID);
      const currentTeamID = normalizeRconId(normalized.teamID);
      const squadChanged = Boolean(previous) && previousSquadID !== currentSquadID;

      const squadless = computeSquadlessTiming({ previous, currentSquadID, now });

      const next = {
        serverId,
        playerID: normalized.playerID,
        name: normalized.name,
        steamID: normalized.steamID,
        eosID: normalized.eosID,
        controllerID: normalized.controllerID,
        teamID: currentTeamID,
        squadID: currentSquadID,
        previousTeamID,
        previousSquadID,
        firstSeenAt: previous?.firstSeenAt ?? now,
        lastSquadChangeAt: squadChanged ? now : previous?.lastSquadChangeAt ?? "",
        squadJoinedAt: currentSquadID && !previousSquadID
          ? now
          : previous?.squadJoinedAt ?? "",
        squadLeftAt: previousSquadID && !currentSquadID
          ? now
          : previous?.squadLeftAt ?? "",
        squadlessSince: squadless.squadlessSince,
        squadlessSeconds: squadless.squadlessSeconds,
        isLeader: Boolean(normalized.isLeader),
        role: normalized.role,
        state: "online",
        lastSeenTime: now,
        raw: normalized.raw,
      };
      nextState.playersByKey.set(getCanonicalPlayerKey(next), next);
    }

    rebuildIndexes(nextState);
    core.webStatus.set("playerCount", players.length);

    for (const change of changes) {
      emitSquadMembershipChange(change);
    }

    updateCommanderAuthorizationFromSnapshot(serverId, oldComparableMap, newComparableMap, now);

    logWithFallback(moduleLogger, "debug", () => `Player snapshot refreshed (${players.length})`, {
      operation: "replaceFromRcon",
      data: {
        players: players.length,
        serverId,
        squadChanges: changes.length,
      },
    });

    core.eventBus.emitModuleEvent("module.playerState", "playersSnapshotUpdated", {
      eventId: `module.playerState:${Date.now()}`,
      eventName: "module.playerState.playersSnapshotUpdated",
      layer: "module",
      source: "module.playerState",
      serverId,
      time: now,
      params: [],
      players: api.getPlayerList(serverId),
      squadChanges: changes.map((change) => ({
        type: change.type,
        playerKey: change.playerKey,
        playerName: change.current.name,
        previousSquadID: change.previousSquadID,
        currentSquadID: change.currentSquadID,
        previousTeamID: change.previousTeamID,
        currentTeamID: change.currentTeamID,
        time: change.time,
      })),
    });
  }

  function getServerSnapshot(serverId) {
    const state = ensureServerState(serverId);
    const players = [...state.playersByKey.values()].map(clonePlayer);
    return {
      serverId: String(serverId ?? ""),
      updatedAt: state.updatedAt,
      count: players.length,
      players,
      indexes: {
        byName: Object.fromEntries(state.byName),
        byNormalizedName: Object.fromEntries(state.byNormalizedName),
        bySteamID: Object.fromEntries(state.bySteamID),
        byEOSID: Object.fromEntries(state.byEOSID),
        byControllerID: Object.fromEntries(state.byControllerID),
      },
    };
  }

  const api = {
    getPlayerByName(serverId, name) {
      return cloneOrNull(resolveExistingPlayer(ensureServerState(serverId), { name }));
    },

    getPlayerBySteamID(serverId, steamID) {
      return cloneOrNull(resolveExistingPlayer(ensureServerState(serverId), { steamID }));
    },

    getPlayerByEOSID(serverId, eosID) {
      return cloneOrNull(resolveExistingPlayer(ensureServerState(serverId), { eosID }));
    },

    getPlayerByControllerID(serverId, controllerID) {
      return cloneOrNull(resolveExistingPlayer(ensureServerState(serverId), { controllerID }));
    },

    findPlayer(serverId, identity = {}) {
      return cloneOrNull(resolveExistingPlayer(ensureServerState(serverId), identity));
    },

    getPlayerList(serverId) {
      return getServerSnapshot(serverId).players;
    },

    getOnlinePlayers(serverId) {
      return getServerSnapshot(serverId).players;
    },

    getState(serverId) {
      if (serverId != null && String(serverId).trim() !== "") {
        return getServerSnapshot(serverId);
      }

      const byServer = {};
      for (const key of servers.keys()) {
        byServer[key] = getServerSnapshot(key);
      }
      return { byServer };
    },

    replaceFromRcon,
  };

  return {
    manifest: { id: "module.playerState", name: "Player State Module", kind: "module", version: "0.4.0", description: "Canonical global player list module. Maintains one in-memory player list per server with merged identity indexes, team/squad state, role and presence data for reuse by combat, match and database modules." },
    apiName: "playerState",
    api,

    async start() {
      unsubscribers.push(core.eventBus.onCoreEvent("RCON_LIST_PLAYERS_UPDATED", (event) => {
        replaceFromRcon(event.serverId, event.players ?? []);
      }));

      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerSpawnRequested", (event) => {
        const spawnTeamID = inferTeamIDFromSpawn(getParam(event, "Spawn"));
        const player = upsertPlayer(event.serverId, {
          name: getParam(event, "PlayerName"),
          steam64ID: getParam(event, "Steam64ID"),
          eosID: getParam(event, "EOSID"),
          controllerID: getParam(event, "ControllerID"),
        }, {
          role: getParam(event, "DeployRole"),
          ...(spawnTeamID ? { teamID: spawnTeamID } : {}),
          state: "playing",
          lastSpawnTime: new Date().toISOString(),
        });

        if (player) {
          logWithFallback(moduleLogger, "debug", () => `Spawn update for ${player.name}`, {
            operation: "playerSpawnRequested",
            data: {
              serverId: event.serverId,
              playerName: player.name,
              role: player.role,
            },
          });
          core.eventBus.emitModuleEvent("module.playerState", "playerUpdated", {
            ...event,
            layer: "module",
            source: "module.playerState",
            eventName: "module.playerState.playerUpdated",
            player: clonePlayer(player),
          });
        }
      }));

      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerWounded", (event) => {
        upsertPlayer(event.serverId, {
          name: getParam(event, "VictimName"),
          steam64ID: getParam(event, "VictimCachedSteam64ID"),
          eosID: getParam(event, "VictimCachedEOSID"),
        }, {
          state: "wounded",
        });

        upsertPlayer(event.serverId, {
          name: getParam(event, "AttackerName"),
          steam64ID: getParam(event, "AttackerSteam64ID"),
          eosID: getParam(event, "AttackerEOSID"),
          controllerID: getParam(event, "AttackerControllerID"),
        }, {
          state: "playing",
        });
      }));

      unsubscribers.push(core.eventBus.onCoreEvent("On_PlayerDied", (event) => {
        upsertPlayer(event.serverId, {
          name: getParam(event, "VictimName"),
          steam64ID: getParam(event, "VictimCachedSteam64ID"),
          eosID: getParam(event, "VictimCachedEOSID"),
        }, {
          state: "dead",
        });

        upsertPlayer(event.serverId, {
          name: getParam(event, "AttackerName"),
          steam64ID: getParam(event, "AttackerSteam64ID"),
          eosID: getParam(event, "AttackerEOSID"),
          controllerID: getParam(event, "AttackerControllerID"),
        }, {
          state: "playing",
        });
      }));

      logWithFallback(moduleLogger, "info", "PlayerState subscriptions ready.", {
        label: "MODULE",
        operation: "start",
      });
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      commanderByServer.clear();
      logWithFallback(moduleLogger, "info", "PlayerState subscriptions stopped.", {
        label: "MODULE",
        operation: "stop",
      });
    },
  };
}

function computeSquadlessTiming({ previous, currentSquadID, now }) {
  const isInSquad = Boolean(normalizeRconId(currentSquadID));
  if (isInSquad) {
    return { squadlessSince: "", squadlessSeconds: 0 };
  }

  const previousSquadID = normalizeRconId(previous?.squadID);
  const wasInSquad = Boolean(previousSquadID);
  const previousSince = String(previous?.squadlessSince ?? "").trim();
  const squadlessSince = (!wasInSquad && previousSince) ? previousSince : String(now);

  const sinceMs = Date.parse(squadlessSince);
  const nowMs = Date.parse(String(now));
  const deltaSeconds = Number.isFinite(sinceMs) && Number.isFinite(nowMs)
    ? Math.max(0, Math.floor((nowMs - sinceMs) / 1000))
    : 0;

  return { squadlessSince, squadlessSeconds: deltaSeconds };
}

function clonePlayer(player) {
  return player ? { ...player } : null;
}

function cloneOrNull(player) {
  return player ? clonePlayer(player) : null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const cleaned = cleanIdentityValue(value);
    if (cleaned) return cleaned;
  }
  return "";
}

function getCanonicalPlayerKey(player) {
  const steamID = cleanIdentityValue(player?.steamID ?? player?.steam64ID);
  if (steamID) return `steam:${steamID}`;
  const eosID = cleanIdentityValue(player?.eosID);
  if (eosID) return `eos:${eosID}`;
  const controllerID = cleanIdentityValue(player?.controllerID);
  if (controllerID) return `controller:${controllerID}`;
  const normalizedName = normalizeName(player?.name);
  if (normalizedName) return `name:${normalizedName}`;
  return `anon:${Math.random().toString(16).slice(2)}`;
}

function cleanIdentityValue(value) {
  return String(value ?? "").trim();
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

function inferTeamIDFromSpawn(spawn) {
  const match = String(spawn ?? "").match(/\bTeam(\d+)/i);
  return match ? String(match[1]) : "";
}

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeRconId(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  if (text === "0" || lower === "none" || lower === "null" || lower === "undefined") {
    return "";
  }
  return text;
}

function isCommandSquadId(value) {
  const id = normalizeRconId(value);
  if (!id) return false;
  const lower = String(id).trim().toLowerCase();
  return lower === "10" || lower === "cmd" || lower === "command";
}

function isCommandSquadName(value) {
  const name = String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!name) return false;
  if (name === "command squad") return true;
  if (name === "cmd") return true;
  if (name === "command") return true;
  return /\bcommand\s*squad\b/i.test(name);
}

function resolveCommandSquadKeys(modules, serverId) {
  const list = typeof modules?.squadManagement?.getSquads === "function"
    ? modules.squadManagement.getSquads(serverId)
    : [];

  if (!Array.isArray(list) || list.length === 0) return [];

  const keys = [];
  for (const squad of list) {
    const squadName = squad?.squadName ?? squad?.name ?? "";
    if (!isCommandSquadName(squadName)) continue;

    const teamID = normalizeRconId(squad?.teamID ?? squad?.teamId);
    const squadID = normalizeRconId(squad?.squadID ?? squad?.squadId);
    if (!teamID || !squadID) continue;

    keys.push({ teamID, squadID, squadName: String(squadName ?? "") });
  }
  return keys;
}

function detectCommanderCandidate(newMap, commandSquadKeys = []) {
  let leaderHit = null;
  let roleHit = null;
  let anyHit = null;

  const hasKeys = Array.isArray(commandSquadKeys) && commandSquadKeys.length > 0;

  for (const [playerKey, current] of newMap.entries()) {
    const inCommandSquad = hasKeys
      ? commandSquadKeys.some((key) => key.teamID === normalizeRconId(current?.teamID) && key.squadID === normalizeRconId(current?.squadID))
      : isCommandSquadId(current?.squadID);
    if (!inCommandSquad) continue;

    anyHit = anyHit ?? { playerKey, current };

    if (Boolean(current?.isLeader)) {
      leaderHit = { playerKey, current };
      break;
    }

    const role = String(current?.role ?? "").trim().toLowerCase();
    if (role && (role.includes("commander") || role === "cmd" || role.includes(" cmd"))) {
      roleHit = roleHit ?? { playerKey, current };
    }
  }

  return leaderHit ?? roleHit ?? anyHit;
}

function normalizeRconPlayer(player = {}) {
  return {
    playerID: cleanIdentityValue(player.playerID),
    name: cleanIdentityValue(player.name),
    steamID: cleanIdentityValue(player.steamID ?? player.steam64ID),
    eosID: cleanIdentityValue(player.eosID),
    controllerID: cleanIdentityValue(player.controllerID),
    teamID: normalizeRconId(player.teamID),
    squadID: normalizeRconId(player.squadID),
    isLeader: Boolean(player.isLeader),
    role: cleanIdentityValue(player.role),
    raw: player.raw ?? "",
  };
}

function getStablePlayerKey(player) {
  const steamID = cleanIdentityValue(player?.steamID ?? player?.steam64ID);
  if (steamID) return `steam:${steamID}`;

  const eosID = cleanIdentityValue(player?.eosID);
  if (eosID) return `eos:${eosID}`;

  const controllerID = cleanIdentityValue(player?.controllerID);
  if (controllerID) return `controller:${controllerID}`;

  const name = normalizeName(player?.name);
  if (name) return `name:${name}`;

  return "";
}

function makeComparablePlayerSnapshot(players = []) {
  const map = new Map();

  for (const player of players) {
    const normalized = normalizeRconPlayer(player);
    const key = getStablePlayerKey(normalized);
    if (!key) continue;
    map.set(key, normalized);
  }

  return map;
}

function detectSquadMembershipChanges(serverId, oldMap, newMap, now) {
  const changes = [];

  for (const [playerKey, current] of newMap.entries()) {
    const previous = oldMap.get(playerKey);
    if (!previous) continue;

    const previousSquadID = normalizeRconId(previous.squadID);
    const currentSquadID = normalizeRconId(current.squadID);
    const previousTeamID = normalizeRconId(previous.teamID);
    const currentTeamID = normalizeRconId(current.teamID);

    const wasInSquad = Boolean(previousSquadID);
    const isInSquad = Boolean(currentSquadID);

    if (!wasInSquad && isInSquad) {
      // Squad leaders can appear as "joining" when they create a squad; callers don't want a joined event in that case.
      if (Boolean(current.isLeader)) continue;
      changes.push({
        type: "joined",
        eventType: "playerJoinedSquad",
        eventName: "module.playerState.playerJoinedSquad",
        serverId,
        playerKey,
        previous,
        current,
        previousTeamID,
        currentTeamID,
        previousSquadID,
        currentSquadID,
        time: now,
      });
      continue;
    }

    if (wasInSquad && !isInSquad) {
      changes.push({
        type: "left",
        eventType: "playerLeftSquad",
        eventName: "module.playerState.playerLeftSquad",
        serverId,
        playerKey,
        previous,
        current,
        previousTeamID,
        currentTeamID,
        previousSquadID,
        currentSquadID,
        time: now,
      });
      continue;
    }

    if (wasInSquad && isInSquad && previousSquadID !== currentSquadID) {
      changes.push({
        type: "changed",
        eventType: "playerChangedSquad",
        eventName: "module.playerState.playerChangedSquad",
        serverId,
        playerKey,
        previous,
        current,
        previousTeamID,
        currentTeamID,
        previousSquadID,
        currentSquadID,
        time: now,
      });
    }
  }

  return changes;
}

