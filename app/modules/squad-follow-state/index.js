// -*- coding: utf-8 -*-

export function createSquadFollowStateModule({ core, config, logger }) {
  const previousPlayerStates = new Map();
  const recentEvents = [];
  let lastSnapshot = null;
  const EVENT_HISTORY_LIMIT = 200;

  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.squadFollowState",
    source: "module.squadFollowState",
    channel: "module",
  }) ?? core.logger;

  const moduleConfig = config?.get?.("modules.squadFollowState", {}) ?? {};
  const defaultOptions = {
    enabled: moduleConfig.enabled !== false,
    radiusMeters: numberOrNull(moduleConfig.radiusMeters, 200) ?? 200,
    minSquadSize: Math.max(1, numberOrNull(moduleConfig.minSquadSize, 2) ?? 2),
    ignoreDead: moduleConfig.ignoreDead !== false,
    ignoreVehicleCrew: Boolean(moduleConfig.ignoreVehicleCrew ?? false),
    staleMs: Math.max(0, numberOrNull(moduleConfig.staleMs, 5000) ?? 5000),
    markerMode: String(moduleConfig.markerMode ?? "disengaged"),
  };

  function composeFromPlayers({ serverId = "", generatedAt = new Date().toISOString(), players = [], options = {} } = {}) {
    const settings = {
      enabled: options.enabled ?? defaultOptions.enabled,
      radiusMeters: numberOrNull(options.radiusMeters, defaultOptions.radiusMeters) ?? defaultOptions.radiusMeters,
      minSquadSize: Math.max(1, numberOrNull(options.minSquadSize, defaultOptions.minSquadSize) ?? defaultOptions.minSquadSize),
      ignoreDead: options.ignoreDead ?? defaultOptions.ignoreDead,
      ignoreVehicleCrew: options.ignoreVehicleCrew ?? defaultOptions.ignoreVehicleCrew,
      staleMs: Math.max(0, numberOrNull(options.staleMs, defaultOptions.staleMs) ?? defaultOptions.staleMs),
      markerMode: String(options.markerMode ?? defaultOptions.markerMode),
    };

    if (!settings.enabled) {
      lastSnapshot = null;
      return null;
    }

    const list = Array.isArray(players) ? players : [];
    const squadMap = new Map();
    const diagnostics = {
      squadsWithoutLeader: [],
      playersWithoutPosition: [],
    };

    for (const player of list) {
      const teamId = resolveTeamId(player);
      const squadId = resolveSquadId(player);
      if (teamId !== 1 && teamId !== 2) continue;
      if (!Number.isFinite(squadId) || squadId <= 0) continue;

      const squadKey = `${teamId}:${squadId}`;
      if (!squadMap.has(squadKey)) {
        squadMap.set(squadKey, {
          key: squadKey,
          teamId,
          squadId,
          squadName: resolveSquadName(player, squadId),
          leader: null,
          totalMembers: 0,
          aliveMembers: 0,
          insideCount: 0,
          outsideCount: 0,
          insidePlayerKeys: [],
          outsidePlayerKeys: [],
          members: [],
        });
      }

      const squad = squadMap.get(squadKey);
      squad.totalMembers += 1;
      squad.members.push(player);
    }

    const squads = [];
    const playerIndex = {};

    for (const squad of squadMap.values()) {
      if (squad.totalMembers < settings.minSquadSize) {
        continue;
      }

      const allMembers = Array.isArray(squad.members) ? squad.members : [];
      const leaderCandidate = allMembers.find((player) => isSquadLeader(player)) ?? null;
      const leaderPosition = resolvePosition(leaderCandidate);

      if (!leaderCandidate || !leaderPosition) {
        diagnostics.squadsWithoutLeader.push({
          teamId: squad.teamId,
          squadId: squad.squadId,
          memberCount: squad.totalMembers,
        });
      }

      const followCenter = leaderPosition ?? resolvePosition(leaderCandidate) ?? null;
      const evaluatedMembers = [];

      for (const member of allMembers) {
        const playerKey = resolvePlayerKey(member);
        const steam64ID = resolveSteamID(member);
        const eosID = resolveEOSID(member);
        const controllerID = resolveControllerID(member);
        const position = resolvePosition(member);
        const health = resolveHealth(member);
        const vehicleType = resolveVehicleType(member);
        const isDead = health != null && health <= 0;
        const hasPosition = Boolean(position && Number.isFinite(position.x) && Number.isFinite(position.y));
        const isVehicleCrew = Boolean(vehicleType) && vehicleType !== "none" && vehicleType !== "None";

        let reason = "";
        let inside = false;
        let disengaged = false;
        let distanceMeters = null;

        if (!playerKey) {
          reason = "missing_identity";
        } else if (!hasPosition) {
          reason = "missing_position";
          diagnostics.playersWithoutPosition.push({
            key: playerKey,
            teamId: squad.teamId,
            squadId: squad.squadId,
          });
        } else if (settings.ignoreDead && isDead) {
          reason = "dead_ignored";
        } else if (settings.ignoreVehicleCrew && isVehicleCrew) {
          reason = "vehicle_ignored";
        } else if (!leaderPosition) {
          reason = "missing_leader_position";
        } else {
          distanceMeters = distanceMetersBetween(position, leaderPosition);
          inside = member === leaderCandidate || distanceMeters <= settings.radiusMeters;
          disengaged = member !== leaderCandidate && !inside;
          reason = disengaged ? "outside_leader_radius" : "";
        }

        const memberRecord = {
          key: playerKey,
          name: resolvePlayerName(member),
          steam64ID,
          steamID: steam64ID,
          eosID,
          controllerID,
          position: clonePlainObject(position),
          distanceMeters,
          inside,
          disengaged,
          reason,
        };

        evaluatedMembers.push(memberRecord);
        if (playerKey) {
          playerIndex[playerKey] = {
            key: playerKey,
            playerKey,
            name: resolvePlayerName(member),
            steam64ID,
            steamID: steam64ID,
            eosID,
            controllerID,
            teamId: squad.teamId,
            squadId: squad.squadId,
            leaderKey: resolvePlayerKey(leaderCandidate),
            leaderName: resolvePlayerName(leaderCandidate),
            squadName: squad.squadName,
            distanceMeters,
            inside,
            disengaged,
            reason,
          };
        }

        if (reason === "" || reason === "outside_leader_radius") {
          squad.aliveMembers += 1;
          if (inside) {
            squad.insideCount += 1;
            squad.insidePlayerKeys.push(playerKey);
          } else {
            squad.outsideCount += 1;
            squad.outsidePlayerKeys.push(playerKey);
          }
        }
      }

      squad.leader = leaderPosition
        ? {
            key: resolvePlayerKey(leaderCandidate),
            playerId: resolvePlayerId(leaderCandidate),
            steamID: resolveSteamID(leaderCandidate),
            name: resolvePlayerName(leaderCandidate),
            position: clonePlainObject(leaderPosition),
          }
        : null;
      squad.members = evaluatedMembers;
      squads.push(squad);
    }

    squads.sort((left, right) => {
      if (right.outsideCount !== left.outsideCount) return right.outsideCount - left.outsideCount;
      if (left.teamId !== right.teamId) return left.teamId - right.teamId;
      return left.squadId - right.squadId;
    });

    const result = {
      enabled: true,
      serverId: String(serverId ?? ""),
      radiusMeters: settings.radiusMeters,
      radiusGameUnits: Math.round(settings.radiusMeters * 100),
      markerMode: settings.markerMode,
      generatedAt,
      squads,
      playerIndex,
      diagnostics,
    };

    lastSnapshot = clonePlainObject(result);
    detectAndEmitTransitions({ playerIndex });
    return result;
  }

  return {
    manifest: {
      id: "module.squadFollowState",
      name: "Squad Follow State Module",
      kind: "module",
      version: "0.1.0",
      hidden: true,
      description: "Compose squad leader follow radius status from tactical players.",
    },
    apiName: "squadFollowState",
    api: {
      composeFromPlayers,
      getCurrentSnapshot,
      getPlayerFollowState,
      isPlayerInsideLeaderRadius,
      getState,
    },
  };

  function getState() {
    return {
      enabled: defaultOptions.enabled,
      radiusMeters: defaultOptions.radiusMeters,
      recentEvents: [...recentEvents].reverse(),
      trackedPlayers: previousPlayerStates.size,
      currentSnapshot: getCurrentSnapshot(),
    };
  }

  function getCurrentSnapshot() {
    return clonePlainObject(lastSnapshot);
  }

  function getPlayerFollowState(identity = {}) {
    const snapshot = lastSnapshot;
    if (!snapshot || !snapshot.playerIndex) return null;

    const match = resolvePlayerFollowEntry(snapshot, identity);
    if (!match) return null;

    return clonePlainObject({
      serverId: snapshot.serverId ?? "",
      generatedAt: snapshot.generatedAt ?? "",
      radiusMeters: snapshot.radiusMeters ?? null,
      playerKey: match.playerKey ?? match.key ?? "",
      key: match.playerKey ?? match.key ?? "",
      name: match.name ?? "",
      steam64ID: match.steam64ID ?? match.steamID ?? "",
      steamID: match.steamID ?? match.steam64ID ?? "",
      eosID: match.eosID ?? "",
      controllerID: match.controllerID ?? "",
      teamId: match.teamId ?? null,
      squadId: match.squadId ?? null,
      leaderKey: match.leaderKey ?? "",
      leaderName: match.leaderName ?? "",
      inside: Boolean(match.inside),
      disengaged: Boolean(match.disengaged),
      distanceMeters: match.distanceMeters ?? null,
      reason: match.reason ?? "",
      squadName: match.squadName ?? "",
    });
  }

  function isPlayerInsideLeaderRadius(identity = {}) {
    const state = getPlayerFollowState(identity);
    if (!state) return null;
    return Boolean(state.inside);
  }

  function detectAndEmitTransitions({ playerIndex }) {
    const currentKeys = new Set();
    for (const [playerKey, current] of Object.entries(playerIndex ?? {})) {
      currentKeys.add(playerKey);
      const trackable =
        current.reason === "" ||
        current.reason === "outside_leader_radius";

      if (!trackable) {
        previousPlayerStates.delete(playerKey);
        continue;
      }

      previousPlayerStates.set(playerKey, {
        key: playerKey,
        teamId: current.teamId,
        squadId: current.squadId,
        leaderKey: current.leaderKey ?? "",
        inside: Boolean(current.inside),
        disengaged: Boolean(current.disengaged),
        distanceMeters: current.distanceMeters,
        reason: current.reason ?? "",
      });
    }

    for (const key of previousPlayerStates.keys()) {
      if (!currentKeys.has(key)) {
        previousPlayerStates.delete(key);
      }
    }
  }
}

function isSquadLeader(player) {
  if (player?.match?.isLeader === true) return true;
  if (player?.isLeader === true) return true;
  if (player?.raw?.rcon?.isLeader === true) return true;
  if (player?.raw?.bzss?.isLeader === true) return true;

  const role = [
    player?.match?.role,
    player?.role,
    player?.soldierInfo?.soldierClass,
    player?.telemetry?.soldierClass,
  ].map((value) => String(value ?? "").toLowerCase()).join(" ");

  return role.includes("squadleader") || role.includes("officer") || /\bsl\b/.test(role);
}

function resolvePlayerKey(player) {
  const playerId = resolvePlayerId(player);
  if (playerId != null) {
    return `idx:${playerId}`;
  }

  return String(
    player?.identity?.key ??
    player?.key ??
    player?.playerKey ??
    player?.playerId ??
    player?.playerID ??
    ""
  ).trim();
}

function resolvePlayerId(player) {
  return numberOrNull(
    player?.identity?.playerId,
    player?.identity?.playerID,
    player?.playerIndex,
    player?.playerId,
    player?.playerID,
    null,
  );
}

function resolvePlayerName(player) {
  return String(player?.identity?.name ?? player?.name ?? player?.playerName ?? "").trim();
}

function resolveSteamID(player) {
  return String(player?.identity?.steamID ?? player?.steamID ?? player?.playerGuid ?? "").trim();
}

function resolveEOSID(player) {
  return String(
    player?.identity?.eosID ??
    player?.eosID ??
    player?.playerEOSID ??
    player?.playerEosID ??
    "",
  ).trim();
}

function resolveControllerID(player) {
  return String(player?.identity?.controllerID ?? player?.controllerID ?? player?.playerControllerID ?? "").trim();
}

function resolveTeamId(player) {
  return numberOrNull(player?.match?.teamId, player?.teamId, player?.teamID, null) ?? NaN;
}

function resolveSquadId(player) {
  return numberOrNull(player?.match?.squadId, player?.squadId, player?.squadID, null) ?? NaN;
}

function resolveSquadName(player, squadId) {
  return String(player?.match?.squadName ?? player?.squadName ?? (Number.isFinite(squadId) ? `Squad ${squadId}` : "")).trim();
}

function resolvePosition(player) {
  const position = player?.telemetry?.position ?? player?.soldierInfo?.position ?? player?.position ?? null;
  if (!position || typeof position !== "object") return null;
  const x = numberOrNull(position.x, null);
  const y = numberOrNull(position.y, null);
  const z = numberOrNull(position.z, null);
  if (x == null || y == null) return null;
  return { x, y, z };
}

function resolveHealth(player) {
  return numberOrNull(player?.telemetry?.health, player?.soldierInfo?.health, player?.health, null);
}

function resolveVehicleType(player) {
  return String(player?.vehicle?.vehicleType ?? player?.vehicleInfo?.vehicleType ?? "").trim();
}

function distanceMetersBetween(a, b) {
  const dx = numberOrNull(a?.x, 0) - numberOrNull(b?.x, 0);
  const dy = numberOrNull(a?.y, 0) - numberOrNull(b?.y, 0);
  return Math.sqrt(dx * dx + dy * dy) / 100;
}

function clonePlainObject(value) {
  if (value == null || typeof value !== "object") return value ?? null;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // fallback below
    }
  }
  return JSON.parse(JSON.stringify(value));
}

function numberOrNull(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function resolvePlayerFollowEntry(snapshot, identity = {}) {
  const index = snapshot?.playerIndex && typeof snapshot.playerIndex === "object" ? snapshot.playerIndex : {};
  const entries = Object.entries(index).map(([key, value]) => ({
    key,
    ...value,
  }));
  if (!entries.length) return null;

  const lookup = normalizeFollowIdentity(identity);
  if (!lookup.hasAny) return null;

  const matched = findMatchingPlayerFollowEntry(entries, lookup);
  return matched ? matched.entry : null;
}

function findMatchingPlayerFollowEntry(entries, lookup) {
  const checks = [
    (entry) => lookup.steamIDs.some((value) => matchText(entry.steam64ID, value) || matchText(entry.steamID, value)),
    (entry) => lookup.eosIDs.some((value) => matchText(entry.eosID, value)),
    (entry) => lookup.controllerIDs.some((value) => matchText(entry.controllerID, value)),
    (entry) => lookup.names.some((value) => matchText(entry.name, value)),
    (entry) => lookup.playerKeys.some((value) => matchText(entry.playerKey ?? entry.key, value)),
  ];

  for (const check of checks) {
    const found = entries.find((entry) => check(entry));
    if (found) return { entry: found };
  }

  return null;
}

function normalizeFollowIdentity(identity = {}) {
  const directText = typeof identity === "string" || typeof identity === "number"
    ? String(identity).trim()
    : "";
  const steamIDs = uniqueTexts([identity.steam64ID, identity.steamID]);
  const eosIDs = uniqueTexts([identity.eosID]);
  const controllerIDs = uniqueTexts([identity.controllerID]);
  const names = uniqueTexts([identity.name]);
  const playerKeys = uniqueTexts([
    directText,
    identity.key,
    identity.playerKey,
    identity.playerIndex,
    identity.playerId,
  ]);

  return {
    steamIDs,
    eosIDs,
    controllerIDs,
    names,
    playerKeys,
    hasAny: steamIDs.length > 0 || eosIDs.length > 0 || controllerIDs.length > 0 || names.length > 0 || playerKeys.length > 0,
  };
}

function uniqueTexts(values) {
  const seen = new Set();
  const output = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = String(value ?? "").trim();
    if (!text) continue;
    const normalized = text.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(text);
  }
  return output;
}

function matchText(left, right) {
  return String(left ?? "").trim().toLowerCase() === String(right ?? "").trim().toLowerCase();
}
