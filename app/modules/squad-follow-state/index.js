// -*- coding: utf-8 -*-

export function createSquadFollowStateModule({ core, config, logger }) {
  const previousPlayerStates = new Map();
  const recentEvents = [];
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

    if (!settings.enabled) return null;

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
          steamID: resolveSteamID(member),
          position: clonePlainObject(position),
          distanceMeters,
          inside,
          disengaged,
          reason,
        };

        evaluatedMembers.push(memberRecord);
        if (playerKey) {
          playerIndex[playerKey] = {
            teamId: squad.teamId,
            squadId: squad.squadId,
            leaderKey: resolvePlayerKey(leaderCandidate),
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

    detectAndEmitTransitions({
      serverId,
      generatedAt,
      radiusMeters: settings.radiusMeters,
      squads,
      playerIndex,
    });

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
      getState,
    },
  };

  function getState() {
    return {
      enabled: defaultOptions.enabled,
      radiusMeters: defaultOptions.radiusMeters,
      recentEvents: [...recentEvents].reverse(),
      trackedPlayers: previousPlayerStates.size,
    };
  }

  function detectAndEmitTransitions({ serverId, generatedAt, radiusMeters, squads, playerIndex }) {
    const currentKeys = new Set();
    const squadLookup = buildSquadLookup(squads);

    for (const [playerKey, current] of Object.entries(playerIndex ?? {})) {
      currentKeys.add(playerKey);

      const trackable =
        current.reason === "" ||
        current.reason === "outside_leader_radius";

      if (!trackable) {
        previousPlayerStates.delete(playerKey);
        continue;
      }

      const squad = squadLookup.get(`${current.teamId}:${current.squadId}`);
      const member = squad?.members?.find?.((item) => item.key === playerKey) ?? null;

      const nextState = {
        serverId,
        key: playerKey,
        name: member?.name ?? "",
        steamID: member?.steamID ?? "",
        teamId: current.teamId,
        squadId: current.squadId,
        leaderKey: current.leaderKey ?? "",
        inside: Boolean(current.inside),
        disengaged: Boolean(current.disengaged),
        distanceMeters: current.distanceMeters,
        reason: current.reason ?? "",
        seenAt: generatedAt,
      };

      const previous = previousPlayerStates.get(playerKey);

      if (previous) {
        const sameSquad =
          previous.teamId === nextState.teamId &&
          previous.squadId === nextState.squadId;

        const sameLeader =
          String(previous.leaderKey ?? "") === String(nextState.leaderKey ?? "");

        if (sameSquad && sameLeader) {
          if (previous.inside === true && nextState.disengaged === true) {
            emitFollowTransition({
              type: "exit",
              serverId,
              generatedAt,
              radiusMeters,
              previous,
              current: nextState,
              squad,
            });
          }

          if (previous.disengaged === true && nextState.inside === true) {
            emitFollowTransition({
              type: "enter",
              serverId,
              generatedAt,
              radiusMeters,
              previous,
              current: nextState,
              squad,
            });
          }
        }
      }

      previousPlayerStates.set(playerKey, nextState);
    }

    for (const key of previousPlayerStates.keys()) {
      if (!currentKeys.has(key)) {
        previousPlayerStates.delete(key);
      }
    }
  }

  function emitFollowTransition({ type, serverId, generatedAt, radiusMeters, previous, current, squad }) {
    const eventName =
      type === "exit"
        ? "playerExitedLeaderRadius"
        : "playerEnteredLeaderRadius";

    const payload = {
      eventId: `module.squadFollowState:${eventName}:${serverId}:${current.key}:${Date.now()}`,
      eventName: `module.squadFollowState.${eventName}`,
      layer: "module",
      source: "module.squadFollowState",
      serverId,
      time: generatedAt,
      type,
      radiusMeters,
      player: {
        key: current.key,
        name: current.name,
        steamID: current.steamID,
        teamId: current.teamId,
        squadId: current.squadId,
      },
      leader: squad?.leader ?? null,
      squad: {
        key: squad?.key ?? `${current.teamId}:${current.squadId}`,
        teamId: current.teamId,
        squadId: current.squadId,
        squadName: squad?.squadName ?? `Squad ${current.squadId}`,
        insideCount: squad?.insideCount ?? 0,
        outsideCount: squad?.outsideCount ?? 0,
        aliveMembers: squad?.aliveMembers ?? 0,
        totalMembers: squad?.totalMembers ?? 0,
      },
      previous: {
        inside: previous.inside,
        disengaged: previous.disengaged,
        distanceMeters: previous.distanceMeters,
        reason: previous.reason,
      },
      current: {
        inside: current.inside,
        disengaged: current.disengaged,
        distanceMeters: current.distanceMeters,
        reason: current.reason,
      },
    };

    recentEvents.push(payload);
    if (recentEvents.length > EVENT_HISTORY_LIMIT) {
      recentEvents.splice(0, recentEvents.length - EVENT_HISTORY_LIMIT);
    }

    moduleLogger?.debug?.("squad-follow-state transition", {
      eventName,
      serverId,
      playerKey: current.key,
      type,
    });

    core.eventBus?.emitModuleEvent?.("module.squadFollowState", eventName, payload);
    core.eventBus?.emitModuleEvent?.("module.squadFollowState", "playerRadiusStateChanged", payload);
  }

  function buildSquadLookup(squads) {
    const map = new Map();
    for (const squad of Array.isArray(squads) ? squads : []) {
      map.set(`${squad.teamId}:${squad.squadId}`, squad);
    }
    return map;
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
