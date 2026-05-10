// -*- coding: utf-8 -*-

import { getParam } from "../../core/event-normalizer.js";

/**
 * Module: PlayerState
 *
 * Canonical in-memory player list per server.
 * Other modules should resolve players through this list instead of rebuilding
 * ad hoc indexes on their own.
 */
export function createPlayerStateModule({ core, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.playerState",
    source: "module.playerState",
    channel: "module",
  }) ?? core.logger;
  const servers = new Map();
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

  function replaceFromRcon(serverId, players) {
    clearServer(serverId);
    const state = ensureServerState(serverId);

    for (const player of players) {
      const next = {
        serverId,
        playerID: player.playerID,
        name: cleanIdentityValue(player.name),
        steamID: cleanIdentityValue(player.steamID),
        eosID: cleanIdentityValue(player.eosID),
        controllerID: cleanIdentityValue(player.controllerID),
        teamID: player.teamID ?? "",
        squadID: player.squadID ?? "",
        isLeader: Boolean(player.isLeader),
        role: player.role ?? "",
        state: "online",
        lastSeenTime: new Date().toISOString(),
        raw: player.raw,
      };
      state.playersByKey.set(getCanonicalPlayerKey(next), next);
    }

    rebuildIndexes(state);
    core.webStatus.set("playerCount", players.length);
    logWithFallback(moduleLogger, "debug", () => `Player snapshot refreshed (${players.length})`, {
      operation: "replaceFromRcon",
      data: {
        players: players.length,
        serverId,
      },
    });

    core.eventBus.emitModuleEvent("module.playerState", "playersSnapshotUpdated", {
      eventId: `module.playerState:${Date.now()}`,
      eventName: "module.playerState.playersSnapshotUpdated",
      layer: "module",
      source: "module.playerState",
      serverId,
      time: new Date().toISOString(),
      params: [],
      players: api.getPlayerList(serverId),
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
    manifest: { id: "module.playerState", name: "Player State Module", kind: "module", version: "0.3.0", description: "Canonical global player list module. Maintains one in-memory player list per server with merged identity indexes, team/squad state, role and presence data for reuse by combat, match and database modules." },
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
      logWithFallback(moduleLogger, "info", "PlayerState subscriptions stopped.", {
        label: "MODULE",
        operation: "stop",
      });
    },
  };
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
  return match ? Number(match[1]) : "";
}

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
