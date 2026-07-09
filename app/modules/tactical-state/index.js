// -*- coding: utf-8 -*-

const COMPOSE_DEBOUNCE_MS = 50;

export function createTacticalStateModule({ core, modules, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.tacticalState",
    source: "module.tacticalState",
    channel: "module",
  }) ?? core.logger;

  const state = createInitialState();
  const subscribers = new Set();
  const unsubscribers = [];
  let started = false;
  let composeTimer = null;
  let composeInFlight = null;

  function subscribe(listener) {
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  }

  function getServerId() {
    return String(core.webStatus?.serverId ?? core.webStatus?.getSnapshot?.()?.serverId ?? "").trim();
  }

  function scheduleCompose() {
    if (composeTimer) clearTimeout(composeTimer);
    composeTimer = setTimeout(() => {
      composeTimer = null;
      void composeSnapshot();
    }, COMPOSE_DEBOUNCE_MS);
  }

  async function composeSnapshot() {
    if (composeInFlight) return composeInFlight;

    composeInFlight = (async () => {
      const serverId = getServerId();
      const generatedAt = new Date().toISOString();
      const sourceErrors = [];

      try {
        const matchState = modules.matchState?.getState?.(serverId) ?? modules.matchState?.getSnapshot?.(serverId) ?? modules.matchState?.getState?.() ?? null;
        const playerState = modules.playerState?.getState?.(serverId) ?? null;
        const playerStatePlayers = Array.isArray(modules.playerState?.getOnlinePlayers?.(serverId))
          ? modules.playerState.getOnlinePlayers(serverId)
          : Array.isArray(playerState?.players)
            ? playerState.players
            : [];
        const bzssPlayers = Array.isArray(modules.bzssCoreMonitor?.getTelemetryPlayers?.())
          ? modules.bzssCoreMonitor.getTelemetryPlayers()
          : Array.isArray(modules.bzssCoreMonitor?.getPlayers?.())
            ? modules.bzssCoreMonitor.getPlayers()
            : [];
        const bzssRaw = modules.bzssCoreMonitor?.getRawSnapshot?.() ?? null;

        const linked = await linkPlayers({
          serverId,
          matchState,
          playerStatePlayers,
          bzssPlayers,
          modules,
          sourceErrors,
          generatedAt,
        });

        const snapshot = buildSnapshot({
          serverId,
          generatedAt,
          matchState,
          playerState,
          playerStatePlayers,
          bzssRaw,
          linked,
          sourceErrors,
        });

        state.revision += 1;
        state.generatedAt = generatedAt;
        state.snapshot = snapshot;
        state.lastError = "";
        state.lastUpdatedAt = generatedAt;

        const payload = clonePlainObject(snapshot);
        for (const listener of subscribers) {
          try {
            listener(payload);
          } catch {
            // ignore
          }
        }
        core.eventBus?.emitModuleEvent?.("module.tacticalState", "snapshotUpdated", {
          eventId: `module.tacticalState:${Date.now()}:${state.revision}`,
          eventName: "module.tacticalState.snapshotUpdated",
          layer: "module",
          source: "module.tacticalState",
          serverId,
          time: generatedAt,
          snapshot: payload,
        });
        return payload;
      } catch (error) {
        const message = error?.message ?? "Failed to compose tactical snapshot.";
        state.lastError = message;
        moduleLogger.warn(message, {
          operation: "composeSnapshot",
          data: { serverId, message },
        });
        state.snapshot = buildEmptySnapshot({
          serverId,
          generatedAt,
          error: message,
        });
        return clonePlainObject(state.snapshot);
      } finally {
        composeInFlight = null;
      }
    })();

    return composeInFlight;
  }

  async function getSnapshot() {
    return composeSnapshot();
  }

  async function getPlayers() {
    const snapshot = await getSnapshot();
    return Array.isArray(snapshot.players) ? snapshot.players : [];
  }

  async function getPlayer(identity = {}, options = {}) {
    const snapshot = await getSnapshot();
    const players = Array.isArray(snapshot.players) ? snapshot.players : [];
    return findPlayer(players, identity, options);
  }

  function buildSnapshot({
    serverId,
    generatedAt,
    matchState,
    playerState,
    playerStatePlayers,
    bzssRaw,
    linked,
    sourceErrors,
  }) {
    const match = matchState?.match ?? {};
    const serverStatus = matchState?.serverStatus ?? {};
    const webStatus = core.webStatus?.getSnapshot?.() ?? {};
    const teams = buildTeams({
      linkedPlayers: linked.players,
      matchState,
    });

    return {
      meta: {
        serverId,
        revision: state.revision + 1,
        generatedAt,
        sources: {
          matchState: matchState?.updatedAt ?? matchState?.match?.lastUpdatedAt ?? "",
          playerState: playerState?.updatedAt ?? "",
          bzssCoreMonitor: bzssRaw?.updatedAt ?? bzssRaw?.state?.updatedAt ?? "",
          playerDatabase: linked.sourceInfo.playerDatabaseUpdatedAt ?? "",
          networkStats: linked.sourceInfo.networkStatsUpdatedAt ?? "",
        },
      },
      server: {
        serverId,
        name: firstText(webStatus.serverName, webStatus.name, serverStatus.serverName, serverStatus.name, ""),
        map: firstText(serverStatus.map, match.map, webStatus.map, ""),
        layer: firstText(serverStatus.layer, match.layer, webStatus.layer, ""),
        mode: firstText(serverStatus.mode, match.mode, webStatus.mode, ""),
        tickets: normalizeTickets(match?.tickets ?? serverStatus?.tickets ?? null),
        playerCount: numberOrNull(serverStatus.playerCount, webStatus.playerCount, playerStatePlayers.length),
        rconStatus: clonePlainObject(matchState?.rconStatus ?? {}),
      },
      match: clonePlainObject(matchState?.match ?? {}),
      teams,
      players: linked.players,
      squadFollow: linked.squadFollow ?? null,
      assets: {
        captureZones: cloneArray(bzssRaw?.captureZones),
        fobs: cloneArray(bzssRaw?.fobs),
        mainZones: cloneArray(bzssRaw?.mainZones),
        explosions: cloneArray(bzssRaw?.explosions),
      },
      diagnostics: {
        unlinkedRconPlayers: linked.diagnostics.unlinkedRconPlayers,
        unlinkedBzssPlayers: linked.diagnostics.unlinkedBzssPlayers,
        stalePlayers: linked.diagnostics.stalePlayers,
        sourceErrors: linked.diagnostics.sourceErrors,
      },
    };
  }

  function buildTeams({ linkedPlayers, matchState }) {
    const teamMap = new Map();
    const squadsByTeam = new Map();

    for (const player of linkedPlayers) {
      const teamId = player.match?.teamId ?? null;
      if (teamId == null) continue;
      if (!teamMap.has(teamId)) {
        teamMap.set(teamId, {
          teamId,
          teamName: player.match?.teamName ?? `Team ${teamId}`,
          factionName: player.match?.factionName ?? player.match?.teamName ?? `Team ${teamId}`,
          playerCount: 0,
          ticketCount: null,
          squads: [],
        });
      }
      const team = teamMap.get(teamId);
      team.playerCount += 1;
      if (!squadsByTeam.has(teamId)) squadsByTeam.set(teamId, new Map());
      const teamSquads = squadsByTeam.get(teamId);
      const squadId = player.match?.squadId ?? null;
      if (squadId == null) continue;
      if (!teamSquads.has(squadId)) {
        teamSquads.set(squadId, {
          squadId,
          squadName: player.match?.squadName ?? `Squad ${squadId}`,
          playerCount: 0,
        });
      }
      teamSquads.get(squadId).playerCount += 1;
    }

    const ticketTeam1 = matchState?.match?.tickets?.team1 ?? null;
    const ticketTeam2 = matchState?.match?.tickets?.team2 ?? null;
    for (const team of teamMap.values()) {
      team.ticketCount = team.teamId === 1 ? ticketTeam1 : team.teamId === 2 ? ticketTeam2 : null;
      team.squads = [...(squadsByTeam.get(team.teamId)?.values() ?? [])];
    }

    if (!teamMap.size) {
      const fallbackTeams = [
        { teamId: 1, teamName: "Team 1", factionName: "Team 1", ticketCount: ticketTeam1 },
        { teamId: 2, teamName: "Team 2", factionName: "Team 2", ticketCount: ticketTeam2 },
      ];
      return fallbackTeams.map((team) => ({ ...team, playerCount: 0, squads: [] }));
    }

    return [...teamMap.values()];
  }

  async function linkPlayers({ serverId, matchState, playerStatePlayers, bzssPlayers, modules, sourceErrors, generatedAt }) {
    const rconPlayers = dedupePlayers([
      ...(Array.isArray(matchState?.players?.list) ? matchState.players.list : []),
      ...playerStatePlayers,
    ]);
    const rconIndex = buildRconIndex(rconPlayers);
    const bzssIndex = buildBzssIndex(bzssPlayers);

    const steamIDs = new Set();
    for (const player of rconPlayers) {
      const steamID = normalizeSteamID(player?.steamID ?? player?.steam64ID ?? player?.steam64 ?? "");
      if (steamID) steamIDs.add(steamID);
    }

    const [dbPlayers, profileMap, networkMap] = await Promise.all([
      steamIDs.size > 0 && typeof modules.playerDatabase?.listPlayersBySteamIDs === "function"
        ? modules.playerDatabase.listPlayersBySteamIDs([...steamIDs])
        : [],
      Promise.resolve(buildProfileMap(modules, [...steamIDs])),
      Promise.resolve(buildNetworkMap(modules, [...steamIDs])),
    ]);

    const profileLookup = new Map();
    for (const row of Array.isArray(dbPlayers) ? dbPlayers : []) {
      const steamID = normalizeSteamID(row?.steam_id ?? row?.steamID ?? row?.steam64 ?? row?.steam64ID ?? "");
      if (!steamID) continue;
      profileLookup.set(steamID, {
        steamAvatar: row?.steam_avatar ?? row?.steamAvatar ?? profileMap[steamID]?.steamAvatar ?? null,
        playtimeHours: resolvePlaytimeHours(row),
        permissionGroup: row?.permission_group ?? row?.permissionGroup ?? profileMap[steamID]?.permissionGroup ?? null,
        updatedAt: row?.updated_at ?? row?.updatedAt ?? profileMap[steamID]?.updatedAt ?? null,
      });
    }

    const players = [];
    const diagnostics = {
      unlinkedRconPlayers: [],
      unlinkedBzssPlayers: [],
      stalePlayers: [],
      sourceErrors: [...sourceErrors],
    };
    const matchedBzssKeys = new Set();
    for (const rconPlayer of rconPlayers) {
      const linked = linkRconPlayer({
        rconPlayer,
        bzssIndex,
        profileLookup,
        networkMap,
        generatedAt,
        sourceErrors,
      });
      if (linked.conflict && Array.isArray(linked.candidates) && linked.candidates.length > 1) {
        sourceErrors.push({
          type: "multi-match",
          identity: linked.identity,
          message: "BZSS player matched multiple RCON candidates; highest priority match selected.",
          candidates: linked.candidates.map((item) => ({
            method: item.method,
            confidence: item.confidence,
            key: item.player?.key ?? "",
          })),
        });
      }
      if (linked?.bzss) {
        matchedBzssKeys.add(linked.bzss.key);
      } else {
        diagnostics.unlinkedRconPlayers.push({
          identity: linked.identity,
          reason: "missing-bzss-telemetry",
        });
        diagnostics.stalePlayers.push({
          identity: linked.identity,
          reason: "missing-bzss-telemetry",
        });
      }
      players.push(linked.player);
    }

    for (const bzssPlayer of bzssPlayers) {
      const bzssKey = buildBzssIdentityKey(bzssPlayer);
      if (matchedBzssKeys.has(bzssKey)) continue;
      diagnostics.unlinkedBzssPlayers.push({
        identity: {
          key: bzssKey,
          playerID: numberOrNull(bzssPlayer?.playerId, bzssPlayer?.playerIndex, null),
          playerId: numberOrNull(bzssPlayer?.playerId, bzssPlayer?.playerIndex, null),
          name: normalizeText(bzssPlayer?.playerName ?? bzssPlayer?.name ?? ""),
          steamID: normalizeSteamID(bzssPlayer?.playerGuid ?? bzssPlayer?.steamID ?? bzssPlayer?.steam64ID ?? ""),
          eosID: normalizeEosID(bzssPlayer?.eosID ?? bzssPlayer?.playerGuid ?? ""),
          controllerID: normalizeText(
            bzssPlayer?.controllerID
              ?? bzssPlayer?.controllerId
              ?? bzssPlayer?.playerControllerID
              ?? bzssPlayer?.playerControllerId
              ?? bzssPlayer?.playerId
              ?? bzssPlayer?.playerIndex
              ?? "",
          ),
        },
        reason: "missing-rcon-player",
        telemetry: {
          position: clonePlainObject(bzssPlayer?.position ?? bzssPlayer?.soldierInfo?.position ?? null),
          yaw: numberOrNull(bzssPlayer?.yaw, bzssPlayer?.soldierInfo?.rotation?.z, null),
          observedAt: bzssPlayer?.observedAt ?? "",
          presenceHint: firstText(bzssPlayer?.presenceHint, ""),
        },
      });

      const bzssOnly = buildBzssOnlyPlayer({
        bzssPlayer: {
          ...bzssPlayer,
          key: bzssKey,
        },
        profileLookup,
        networkMap,
        generatedAt,
      });
      players.push(bzssOnly.player);
    }

    players.sort((left, right) => {
      const leftKey = String(left?.identity?.key ?? "");
      const rightKey = String(right?.identity?.key ?? "");
      return leftKey.localeCompare(rightKey);
    });

    const squadFollow = modules.squadFollowState?.composeFromPlayers?.({
      serverId,
      generatedAt,
      players,
    }) ?? null;

    return {
      players,
      squadFollow,
      diagnostics,
      sourceInfo: {
        playerDatabaseUpdatedAt: profileMap.updatedAt ?? "",
        networkStatsUpdatedAt: networkMap.updatedAt ?? "",
      },
    };
  }

  function linkRconPlayer({
    rconPlayer,
    bzssIndex,
    profileLookup,
    networkMap,
    generatedAt,
  }) {
    const rconIdentity = buildRconIdentity(rconPlayer);
    const candidate = resolveBzssMatch(rconPlayer, bzssIndex);
    const bzss = candidate?.player ?? null;
    const link = buildLink(candidate?.method ?? "unlinked", candidate?.confidence ?? "none", candidate?.notes ?? []);
    const steamID = normalizeSteamID(rconIdentity.steamID ?? bzss?.playerGuid ?? "");
    const profile = steamID ? (profileLookup.get(steamID) ?? null) : null;
    const network = steamID ? (networkMap.map.get(steamID) ?? null) : null;
    const player = buildTacticalPlayer({
      rconPlayer,
      bzssPlayer: bzss,
      rconIdentity,
      profile,
      network,
      link,
      generatedAt,
      missingBzssTelemetry: !bzss,
      source: candidate?.method ?? "unlinked",
    });

    return {
      identity: player.identity,
      player,
      bzss,
      conflict: candidate?.conflict ?? false,
      candidates: candidate?.candidates ?? [],
    };
  }

  function buildBzssOnlyPlayer({ bzssPlayer, profileLookup, networkMap, generatedAt }) {
    const identity = {
      key: bzssPlayer.key,
      playerID: bzssPlayer.playerId ?? bzssPlayer.playerIndex ?? null,
      playerId: bzssPlayer.playerId ?? bzssPlayer.playerIndex ?? null,
      name: bzssPlayer.playerName ?? "",
      steamID: normalizeSteamID(bzssPlayer.playerGuid ?? ""),
      eosID: normalizeEosID(bzssPlayer.playerGuid ?? ""),
      controllerID: null,
    };
    const profile = identity.steamID ? (profileLookup.get(identity.steamID) ?? null) : null;
    const network = identity.steamID ? (networkMap.map.get(identity.steamID) ?? null) : null;
    const player = buildTacticalPlayer({
      rconPlayer: null,
      bzssPlayer,
      rconIdentity: identity,
      profile,
      network,
      link: buildLink("unlinked", "none", ["missing-rcon-player"]),
      generatedAt,
      missingBzssTelemetry: false,
      source: "unlinked",
    });
    return {
      identity: player.identity,
      player,
    };
  }

  function buildTacticalPlayer({
    rconPlayer,
    bzssPlayer,
    rconIdentity,
    profile,
    network,
    link,
    generatedAt,
    missingBzssTelemetry,
    source,
  }) {
    const playerID = numberOrNull(rconIdentity.playerID, bzssPlayer?.playerId, bzssPlayer?.playerIndex);
    const name = firstText(rconIdentity.name, bzssPlayer?.playerName, "Unknown");
    const steamID = normalizeSteamID(rconIdentity.steamID ?? bzssPlayer?.playerGuid ?? "");
    const eosID = normalizeEosID(rconIdentity.eosID ?? bzssPlayer?.playerGuid ?? "");
    const controllerID = normalizeText(rconIdentity.controllerID ?? rconPlayer?.controllerID ?? "");
    const teamId = numberOrNull(rconPlayer?.teamID ?? bzssPlayer?.teamId);
    const squadId = numberOrNull(rconPlayer?.squadID ?? bzssPlayer?.squadId);
    const squadName = firstText(rconPlayer?.squadName, bzssPlayer?.squadName, squadId == null ? "" : `Squad ${squadId}`);
    const teamName = firstText(rconPlayer?.teamName, bzssPlayer?.teamName, teamId == null ? "" : `Team ${teamId}`);
    const presenceHint = firstText(bzssPlayer?.presenceHint, "");
    const noPawn = presenceHint === "noPawn";
    const telemetryPosition = clonePlainObject(bzssPlayer?.position ?? bzssPlayer?.soldierInfo?.position ?? null);
    const telemetryRotation = clonePlainObject(bzssPlayer?.soldierInfo?.rotation ?? null);
    const telemetryYaw = numberOrNull(bzssPlayer?.yaw, bzssPlayer?.soldierInfo?.rotation?.z, null);
    const hasTelemetry = Boolean(bzssPlayer);
    const hasPosition = Boolean(telemetryPosition);

    const player = {
      identity: {
        key: buildIdentityKey({ playerID, steamID, eosID, controllerID, name }),
        playerID,
        playerId: playerID,
        name,
        steamID: steamID || null,
        eosID: eosID || null,
        controllerID: controllerID || null,
      },
      presence: {
        online: Boolean(rconPlayer),
        state: noPawn
          ? "noPawn"
          : firstText(rconPlayer?.state, missingBzssTelemetry ? "onlineNoTelemetry" : "online"),
        firstSeenAt: firstText(rconPlayer?.firstSeenAt, ""),
        lastSeenAt: firstText(rconPlayer?.lastSeenAt, generatedAt),
        squadlessSince: firstText(rconPlayer?.squadlessSince, ""),
        squadlessSeconds: numberOrNull(rconPlayer?.squadlessSeconds, 0),
      },
      match: {
        teamId,
        teamName,
        squadId,
        squadName,
        isLeader: Boolean(rconPlayer?.isLeader ?? bzssPlayer?.isLeader),
        role: firstText(rconPlayer?.role, bzssPlayer?.role, ""),
      },
      telemetry: {
        position: telemetryPosition,
        rotation: telemetryRotation,
        yaw: telemetryYaw,
        health: noPawn ? null : numberOrNull(bzssPlayer?.soldierInfo?.health, null),
        soldierClass: noPawn ? "" : firstText(bzssPlayer?.soldierInfo?.soldierClass, ""),
        weaponClass: noPawn ? "" : firstText(bzssPlayer?.soldierInfo?.weaponClass, ""),
        fireTeamIndex: numberOrNull(bzssPlayer?.ftIndex, null),
        fireTeamPosition: numberOrNull(bzssPlayer?.ftPosition, null),
        presenceHint,
        hasTelemetry,
        hasPosition,
      },
      combat: {
        kills: numberOrNull(bzssPlayer?.playerScoreboard?.stats?.numKills, bzssPlayer?.kills, null),
        deaths: numberOrNull(bzssPlayer?.playerScoreboard?.stats?.numDeaths, bzssPlayer?.deaths, null),
        wounds: numberOrNull(bzssPlayer?.playerScoreboard?.stats?.numWounds, bzssPlayer?.wounds, null),
        woundeds: numberOrNull(bzssPlayer?.playerScoreboard?.stats?.numWoundeds, bzssPlayer?.woundeds, null),
        teamKills: numberOrNull(bzssPlayer?.playerScoreboard?.stats?.numTeamKills, bzssPlayer?.teamKills, null),
        revives: numberOrNull(bzssPlayer?.playerScoreboard?.stats?.revivedPoints, null),
        healPoints: numberOrNull(bzssPlayer?.playerScoreboard?.stats?.healPoints, null),
        objectiveScore: numberOrNull(bzssPlayer?.playerScoreboard?.stats?.objectiveScore, null),
        teamworkScore: numberOrNull(bzssPlayer?.playerScoreboard?.stats?.teamworkScore, null),
        combatScore: numberOrNull(bzssPlayer?.playerScoreboard?.stats?.combatScore, null),
      },
      vehicle: {
        vehicleType: firstText(bzssPlayer?.vehicleInfo?.vehicleType, ""),
        health: numberOrNull(bzssPlayer?.vehicleInfo?.health, null),
        maxHealth: numberOrNull(bzssPlayer?.vehicleInfo?.maxHealth, null),
        raw: firstText(bzssPlayer?.vehicleInfo?.raw, ""),
      },
      network: {
        gamePing: numberOrNull(bzssPlayer?.ping, bzssPlayer?.playerScoreboard?.ping, null),
        icmpPing: numberOrNull(network?.ping, null),
        packetLoss: numberOrNull(network?.packetLoss, null),
      },
      profile: {
        steamAvatar: profile?.steamAvatar ?? null,
        playtimeHours: profile?.playtimeHours ?? null,
        permissionGroup: profile?.permissionGroup ?? null,
      },
      link,
      freshness: {
        rconUpdatedAt: firstText(rconPlayer?.lastSeenAt, rconPlayer?.lastSeenTime, ""),
        playerStateUpdatedAt: firstText(rconPlayer?.lastSeenAt, ""),
        bzssCoreUpdatedAt: firstText(bzssPlayer?.observedAt, ""),
        profileUpdatedAt: profile?.updatedAt ?? "",
        generatedAt,
      },
      raw: {
        rcon: clonePlainObject(rconPlayer),
        bzss: clonePlainObject(bzssPlayer),
        source,
      },
    };

    return player;
  }

  function resolveBzssMatch(rconPlayer, bzssIndex) {
    const candidates = [];
    const playerID = numberOrNull(rconPlayer?.playerID, rconPlayer?.playerId, null);
    const controllerID = normalizeText(
      rconPlayer?.controllerID
        ?? rconPlayer?.controllerId
        ?? rconPlayer?.playerControllerID
        ?? rconPlayer?.playerControllerId
        ?? "",
    );
    const steamID = normalizeSteamID(rconPlayer?.steamID ?? rconPlayer?.steam64ID ?? rconPlayer?.steam64 ?? "");
    const eosID = normalizeEosID(rconPlayer?.eosID ?? "");
    const name = normalizeText(rconPlayer?.name ?? "");
    const normalizedName = normalizeName(name);

    pushCandidates(candidates, bzssIndex.byPlayerID.get(playerID), "playerID", "high");
    pushCandidates(candidates, bzssIndex.byControllerID?.get(controllerID), "controllerID", "high");
    pushCandidates(candidates, bzssIndex.bySteamID.get(steamID), "steamID", "high");
    pushCandidates(candidates, bzssIndex.byEOSID.get(eosID), "eosID", "high");
    pushCandidates(candidates, bzssIndex.byExactName.get(name), "name", "medium");
    pushCandidates(candidates, bzssIndex.byNormalizedName.get(normalizedName), "normalizedName", "low");

    if (candidates.length === 0) {
      return { player: null, method: "unlinked", confidence: "none", notes: [] };
    }

    candidates.sort((left, right) => left.priority - right.priority);
    const chosen = candidates[0];
    const noteSet = new Set(chosen.notes ?? []);
    const conflict = candidates.length > 1;
    if (conflict) {
      noteSet.add("multi-match");
      noteSet.add(`candidates:${candidates.map((item) => item.player.key).join(",")}`);
    }
    return {
      player: chosen.player,
      method: chosen.method,
      confidence: chosen.confidence,
      notes: [...noteSet],
      conflict,
      candidates,
    };
  }

  function pushCandidates(out, players, method, confidence) {
    const list = Array.isArray(players) ? players : [];
    for (const player of list) {
      out.push({
        player,
        method,
        confidence,
        priority: identityPriority(method),
        notes: [],
      });
    }
  }

  function buildRconIdentity(rconPlayer) {
    return {
      key: buildIdentityKey({
        playerID: numberOrNull(rconPlayer?.playerID, rconPlayer?.playerId, null),
        steamID: normalizeSteamID(rconPlayer?.steamID ?? rconPlayer?.steam64ID ?? rconPlayer?.steam64 ?? ""),
        eosID: normalizeEosID(rconPlayer?.eosID ?? ""),
        controllerID: normalizeText(
          rconPlayer?.controllerID
            ?? rconPlayer?.controllerId
            ?? rconPlayer?.playerControllerID
            ?? rconPlayer?.playerControllerId
            ?? "",
        ),
        name: normalizeText(rconPlayer?.name ?? ""),
      }),
      playerID: numberOrNull(rconPlayer?.playerID, rconPlayer?.playerId, null),
      playerId: numberOrNull(rconPlayer?.playerID, rconPlayer?.playerId, null),
      name: normalizeText(rconPlayer?.name ?? ""),
      steamID: normalizeSteamID(rconPlayer?.steamID ?? rconPlayer?.steam64ID ?? rconPlayer?.steam64 ?? ""),
      eosID: normalizeEosID(rconPlayer?.eosID ?? ""),
      controllerID: normalizeText(
        rconPlayer?.controllerID
          ?? rconPlayer?.controllerId
          ?? rconPlayer?.playerControllerID
          ?? rconPlayer?.playerControllerId
          ?? "",
      ),
    };
  }

  function buildRconIndex(players) {
    const index = {
      byPlayerID: new Map(),
      byControllerID: new Map(),
      bySteamID: new Map(),
      byEOSID: new Map(),
      byExactName: new Map(),
      byNormalizedName: new Map(),
    };

    for (const player of players) {
      const item = {
        ...clonePlainObject(player),
        key: buildIdentityKey({
          playerID: numberOrNull(player?.playerID, player?.playerId, null),
          steamID: normalizeSteamID(player?.steamID ?? player?.steam64ID ?? player?.steam64 ?? ""),
          eosID: normalizeEosID(player?.eosID ?? ""),
          controllerID: normalizeText(
            player?.controllerID
              ?? player?.controllerId
              ?? player?.playerControllerID
              ?? player?.playerControllerId
              ?? "",
          ),
          name: normalizeText(player?.name ?? ""),
        }),
      };
      const playerID = numberOrNull(item.playerID, item.playerId, null);
      const controllerID = normalizeText(
        item.controllerID
          ?? item.controllerId
          ?? item.playerControllerID
          ?? item.playerControllerId
          ?? "",
      );
      const steamID = normalizeSteamID(item.steamID ?? "");
      const eosID = normalizeEosID(item.eosID ?? "");
      const name = normalizeText(item.name ?? "");
      const normalizedName = normalizeName(name);

      if (playerID != null) pushMapValue(index.byPlayerID, playerID, item);
      if (controllerID) pushMapValue(index.byControllerID, controllerID, item);
      if (steamID) pushMapValue(index.bySteamID, steamID, item);
      if (eosID) pushMapValue(index.byEOSID, eosID, item);
      if (name) pushMapValue(index.byExactName, name, item);
      if (normalizedName) pushMapValue(index.byNormalizedName, normalizedName, item);
    }

    return index;
  }

  function buildBzssIndex(players) {
    const index = {
      byPlayerID: new Map(),
      byControllerID: new Map(),
      bySteamID: new Map(),
      byEOSID: new Map(),
      byExactName: new Map(),
      byNormalizedName: new Map(),
    };

    for (const player of players) {
      const item = clonePlainObject(player);
      const playerID = numberOrNull(item.playerId, item.playerIndex, null);
      const controllerID = normalizeText(
        item.controllerID
          ?? item.controllerId
          ?? item.playerControllerID
          ?? item.playerControllerId
          ?? item.playerId
          ?? item.playerIndex
          ?? "",
      );
      const steamID = normalizeSteamID(item.playerGuid ?? "");
      const eosID = normalizeEosID(item.playerGuid ?? "");
      const name = normalizeText(item.playerName ?? "");
      const normalizedName = normalizeName(name);
      item.key = item.key || buildIdentityKey({
        playerID,
        steamID,
        eosID,
        controllerID,
        name,
      });
      if (playerID != null) pushMapValue(index.byPlayerID, playerID, item);
      if (controllerID) pushMapValue(index.byControllerID, controllerID, item);
      if (steamID) pushMapValue(index.bySteamID, steamID, item);
      if (eosID) pushMapValue(index.byEOSID, eosID, item);
      if (name) pushMapValue(index.byExactName, name, item);
      if (normalizedName) pushMapValue(index.byNormalizedName, normalizedName, item);
    }
    return index;
  }

  function dedupePlayers(players) {
    const seen = new Set();
    const output = [];
    for (const player of players) {
      const key = buildIdentityKey({
        playerID: numberOrNull(player?.playerID, player?.playerId, null),
        steamID: normalizeSteamID(player?.steamID ?? player?.steam64ID ?? player?.steam64 ?? ""),
        eosID: normalizeEosID(player?.eosID ?? ""),
        controllerID: normalizeText(player?.controllerID ?? ""),
        name: normalizeText(player?.name ?? ""),
      });
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(player);
    }
    return output;
  }

  function buildProfileMap(modulesRef, steamIDs) {
    const map = {};
    for (const steamID of steamIDs) {
      map[steamID] = {
        steamAvatar: null,
        playtimeHours: null,
        permissionGroup: null,
        updatedAt: "",
      };
    }
    return map;
  }

  function buildNetworkMap(modulesRef, steamIDs) {
    const map = new Map();
    for (const steamID of steamIDs) {
      const stats = modulesRef.networkStats?.getPlayerStats?.(steamID) ?? null;
      map.set(steamID, stats);
    }
    return {
      map,
      updatedAt: new Date().toISOString(),
    };
  }

  function buildLink(method, confidence, notes = []) {
    return {
      method,
      confidence,
      notes: Array.from(new Set(Array.isArray(notes) ? notes.filter(Boolean).map(String) : [])),
    };
  }

  function buildIdentityKey(identity = {}) {
    const playerID = numberOrNull(identity.playerID, identity.playerId, null);
    const steamID = normalizeSteamID(identity.steamID ?? "");
    const eosID = normalizeEosID(identity.eosID ?? "");
    const controllerID = normalizeText(identity.controllerID ?? "");
    const name = normalizeText(identity.name ?? "");

    if (playerID != null) return `player:${playerID}`;
    if (steamID) return `steam:${steamID}`;
    if (eosID) return `eos:${eosID}`;
    if (controllerID) return `controller:${controllerID}`;
    if (name) return `name:${normalizeName(name)}`;
    return "";
  }

  function identityPriority(method) {
    switch (method) {
      case "playerID": return 1;
      case "controllerID": return 2;
      case "steamID": return 3;
      case "eosID": return 4;
      case "name": return 5;
      case "normalizedName": return 6;
      default: return 99;
    }
  }

  function buildBzssIdentityKey(bzssPlayer = {}) {
    return bzssPlayer?.key || buildIdentityKey({
      playerID: numberOrNull(bzssPlayer?.playerId, bzssPlayer?.playerIndex, null),
      steamID: normalizeSteamID(bzssPlayer?.steamID ?? bzssPlayer?.steam64ID ?? bzssPlayer?.playerGuid ?? ""),
      eosID: normalizeEosID(bzssPlayer?.eosID ?? bzssPlayer?.playerGuid ?? ""),
      controllerID: normalizeText(
        bzssPlayer?.controllerID
          ?? bzssPlayer?.controllerId
          ?? bzssPlayer?.playerControllerID
          ?? bzssPlayer?.playerControllerId
          ?? bzssPlayer?.playerId
          ?? bzssPlayer?.playerIndex
          ?? "",
      ),
      name: normalizeText(bzssPlayer?.playerName ?? bzssPlayer?.name ?? ""),
    });
  }

  function normalizeTickets(tickets) {
    if (!tickets || typeof tickets !== "object") return { team1: null, team2: null };
    return {
      team1: numberOrNull(tickets.team1, tickets.team1Count, tickets.t1, null),
      team2: numberOrNull(tickets.team2, tickets.team2Count, tickets.t2, null),
    };
  }

  function resolvePlaytimeHours(row) {
    const seconds = numberOrNull(row?.steam_game_seconds, row?.steamGameSeconds, row?.game_seconds, row?.gameSeconds, null);
    if (seconds == null) return null;
    return Math.round((seconds / 3600) * 10) / 10;
  }

  function findPlayer(players, identity = {}, options = {}) {
    const playerID = numberOrNull(identity.playerID, identity.playerId, null);
    const steamID = normalizeSteamID(identity.steamID ?? identity.steam64ID ?? identity.steam64 ?? "");
    const eosID = normalizeEosID(identity.eosID ?? "");
    const controllerID = normalizeText(identity.controllerID ?? "");
    const name = normalizeText(identity.name ?? "");
    const normalizedName = normalizeName(name);

    const keys = [
      playerID != null ? `player:${playerID}` : "",
      steamID ? `steam:${steamID}` : "",
      eosID ? `eos:${eosID}` : "",
      controllerID ? `controller:${controllerID}` : "",
      name ? `name:${name}` : "",
      normalizedName ? `name:${normalizedName}` : "",
    ].filter(Boolean);

    for (const key of keys) {
      const found = players.find((player) => {
        const identityKey = String(player?.identity?.key ?? "");
        return identityKey === key;
      });
      if (found) return found;
    }

    if (options.allowLooseName === true && name) {
      return players.find((player) => normalizeName(player?.identity?.name ?? "") === normalizedName) ?? null;
    }
    return null;
  }

  function buildEmptySnapshot({ serverId, generatedAt, error }) {
    return {
      meta: {
        serverId,
        revision: state.revision,
        generatedAt,
        sources: {},
      },
      server: {
        serverId,
        name: "",
        map: "",
        layer: "",
        mode: "",
        tickets: { team1: null, team2: null },
        playerCount: 0,
        rconStatus: {},
      },
      match: {},
      teams: [],
      players: [],
      squadFollow: null,
      assets: { captureZones: [], fobs: [], mainZones: [], explosions: [] },
      diagnostics: {
        unlinkedRconPlayers: [],
        unlinkedBzssPlayers: [],
        stalePlayers: [],
        sourceErrors: [{ type: "compose-error", message: error }],
      },
    };
  }

  async function getComposedSnapshot() {
    return composeSnapshot();
  }

  return {
    manifest: {
      id: "module.tacticalState",
      name: "Tactical State Module",
      kind: "module",
      version: "0.1.0",
      description: "Compose match-state, player-state, bzss-core-monitor, player database and network stats into a tactical snapshot.",
    },
    apiName: "tacticalState",
    api: {
      getSnapshot: getComposedSnapshot,
      getPlayers,
      getPlayer,
      subscribe,
    },
    async start() {
      if (started) return;
      started = true;
      const watch = [
        ["module.matchState", "updated"],
        ["module.playerState", "playersSnapshotUpdated"],
        ["module.bzssCoreMonitor", "stateBroadcast"],
      ];

      for (const [moduleId, eventName] of watch) {
        unsubscribers.push(core.eventBus.onModuleEvent(moduleId, eventName, scheduleCompose));
      }

      scheduleCompose();
    },
    async stop() {
      started = false;
      if (composeTimer) {
        clearTimeout(composeTimer);
        composeTimer = null;
      }
      for (const unsubscribe of unsubscribers.splice(0)) {
        try {
          unsubscribe();
        } catch {
          // ignore
        }
      }
      subscribers.clear();
    },
  };
}

function createInitialState() {
  return {
    revision: 0,
    generatedAt: "",
    lastUpdatedAt: "",
    snapshot: null,
    lastError: "",
  };
}

function pushMapValue(map, key, value) {
  if (key === "" || key == null) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
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

function cloneArray(value) {
  return Array.isArray(value) ? value.map((item) => clonePlainObject(item)) : [];
}

function normalizeText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeName(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeSteamID(value) {
  const text = normalizeText(value);
  return /^\d{17}$/.test(text) ? text : "";
}

function normalizeEosID(value) {
  const text = normalizeText(value).toLowerCase();
  return /^[0-9a-z]{32}$/.test(text) ? text : "";
}

function numberOrNull(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function firstText(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return "";
}

