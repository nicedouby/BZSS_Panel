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
        byBzssGuid: new Map(),
        byBzssName: new Map(),
        bzssCacheByGuid: new Map(),
        bzssCacheByName: new Map(),
        updatedAt: "",
        bzssUpdatedAt: "",
      });
    }
    return servers.get(key);
  }

  function clearActivePlayers(serverState) {
    serverState.playersByKey.clear();
    serverState.byName.clear();
    serverState.byNormalizedName.clear();
    serverState.bySteamID.clear();
    serverState.byEOSID.clear();
    serverState.byControllerID.clear();
    serverState.byBzssGuid.clear();
    serverState.byBzssName.clear();
    serverState.updatedAt = new Date().toISOString();
  }

  function clearBzssCache(serverState) {
    serverState.bzssCacheByGuid.clear();
    serverState.bzssCacheByName.clear();
    serverState.bzssUpdatedAt = new Date().toISOString();
  }

  function ensureSourceData(player) {
    if (!player.sourceData) {
      Object.defineProperty(player, "sourceData", {
        value: { rcon: null, bzssCore: null },
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }
    return player.sourceData;
  }

  function getTeamSquadPriority() {
    return normalizePriority(core.config?.get?.("modules.playerState.teamSquadSourcePriority", "rcon"));
  }

  function normalizePriority(value) {
    const text = String(value ?? "").trim().toLowerCase();
    return text === "bzsscore" || text === "bzss_core" ? "bzssCore" : "rcon";
  }

  function isBzssPriority() {
    return getTeamSquadPriority() === "bzssCore";
  }

  function getPreferredRecord(player) {
    const rcon = player?.sourceData?.rcon ?? null;
    const bzss = player?.sourceData?.bzssCore ?? null;
    return isBzssPriority() ? (bzss ?? rcon) : (rcon ?? bzss);
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

    const bzssGuid = cleanIdentityValue(player?.sourceData?.bzssCore?.playerGuid);
    const bzssName = normalizeName(player?.sourceData?.bzssCore?.playerName);
    if (bzssGuid) serverState.byBzssGuid.set(bzssGuid, playerKey);
    if (bzssName) serverState.byBzssName.set(bzssName, playerKey);
  }

  function rebuildIndexes(serverState) {
    serverState.byName.clear();
    serverState.byNormalizedName.clear();
    serverState.bySteamID.clear();
    serverState.byEOSID.clear();
    serverState.byControllerID.clear();
    serverState.byBzssGuid.clear();
    serverState.byBzssName.clear();
    for (const player of serverState.playersByKey.values()) {
      indexPlayer(serverState, player);
    }
    serverState.updatedAt = new Date().toISOString();
  }

  function resolvePlayerKey(serverState, identity = {}) {
    const steamID = cleanIdentityValue(identity.steamID ?? identity.steam64ID);
    const eosID = cleanIdentityValue(identity.eosID);
    const controllerID = cleanIdentityValue(identity.controllerID);
    const name = cleanIdentityValue(identity.name);
    const normalizedName = normalizeName(name);
    const guid = cleanIdentityValue(identity.guid ?? identity.playerGuid ?? identity.bzssGuid);
    const bzssName = normalizeName(identity.bzssName ?? identity.playerName);

    return (steamID ? serverState.bySteamID.get(steamID) : null)
      ?? (eosID ? serverState.byEOSID.get(eosID) : null)
      ?? (controllerID ? serverState.byControllerID.get(controllerID) : null)
      ?? (name ? serverState.byName.get(name) : null)
      ?? (normalizedName ? serverState.byNormalizedName.get(normalizedName) : null)
      ?? (guid ? serverState.byBzssGuid.get(guid) : null)
      ?? (bzssName ? serverState.byBzssName.get(bzssName) : null)
      ?? null;
  }

  function resolveExistingPlayer(serverState, identity = {}) {
    const playerKey = resolvePlayerKey(serverState, identity);
    return playerKey ? serverState.playersByKey.get(playerKey) ?? null : null;
  }

  function createBlankPlayer(serverId, identity = {}) {
    const player = {
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
      position: null,
      rotation: null,
      health: null,
      maxHealth: null,
      weaponClass: "",
      ammoValues: [],
      ping: null,
      soldierInfo: createEmptyDerivedSoldierInfo(),
      networkInfo: createEmptyNetworkInfo(),
    };
    ensureSourceData(player);
    return player;
  }

  function resolveBzssMatchForPlayer(serverState, player) {
    const existingGuid = cleanIdentityValue(player?.sourceData?.bzssCore?.playerGuid);
    if (existingGuid && serverState.bzssCacheByGuid.has(existingGuid)) {
      return clonePlainObject(serverState.bzssCacheByGuid.get(existingGuid));
    }

    const eosID = cleanIdentityValue(player?.eosID);
    if (eosID && serverState.bzssCacheByGuid.has(eosID)) {
      return clonePlainObject(serverState.bzssCacheByGuid.get(eosID));
    }

    const name = normalizeName(player?.name ?? player?.sourceData?.bzssCore?.playerName);
    if (name && serverState.bzssCacheByName.has(name)) {
      return clonePlainObject(serverState.bzssCacheByName.get(name));
    }

    return null;
  }

  function setSourceData(player, sourceName, patch = null) {
    const sourceData = ensureSourceData(player);
    sourceData[sourceName] = patch ? clonePlainObject(patch) : null;
  }

  function mergePlayerFields(player, serverState, now, previousPublic = null) {
    const rcon = player?.sourceData?.rcon ?? null;
    const bzss = player?.sourceData?.bzssCore ?? null;
    const primary = getPreferredRecord(player);
    const secondary = primary === rcon ? bzss : rcon;
    const derived = buildDerivedBzssState(bzss);

    const previousTeamID = normalizeRconId(previousPublic?.teamID ?? player.previousTeamID);
    const previousSquadID = normalizeRconId(previousPublic?.squadID ?? player.previousSquadID);
    const currentTeamID = normalizeRconId(primary?.teamID ?? primary?.teamId)
      || normalizeRconId(secondary?.teamID ?? secondary?.teamId);
    const currentSquadID = normalizeRconId(primary?.squadID ?? primary?.squadId)
      || normalizeRconId(secondary?.squadID ?? secondary?.squadId);

    player.playerID = firstNonEmpty(rcon?.playerID, bzss?.playerId, player.playerID);
    player.name = firstNonEmpty(rcon?.name, bzss?.playerName, player.name);
    player.steamID = firstNonEmpty(rcon?.steamID, player.steamID);
    player.eosID = firstNonEmpty(rcon?.eosID, player.eosID);
    player.controllerID = firstNonEmpty(rcon?.controllerID, player.controllerID);
    player.teamID = currentTeamID;
    player.squadID = currentSquadID;
    player.previousTeamID = previousTeamID;
    player.previousSquadID = previousSquadID;
    player.firstSeenAt = firstNonEmpty(previousPublic?.firstSeenAt, player.firstSeenAt, now);
    player.lastSquadChangeAt = previousPublic
      && (previousTeamID !== currentTeamID || previousSquadID !== currentSquadID)
      ? now
      : previousPublic?.lastSquadChangeAt ?? player.lastSquadChangeAt;
    player.squadJoinedAt = currentSquadID && !previousSquadID
      ? now
      : previousPublic?.squadJoinedAt ?? player.squadJoinedAt;
    player.squadLeftAt = previousSquadID && !currentSquadID
      ? now
      : previousPublic?.squadLeftAt ?? player.squadLeftAt;
    const squadless = computeSquadlessTiming({ previous: previousPublic ?? player, currentSquadID, now });
    player.squadlessSince = squadless.squadlessSince;
    player.squadlessSeconds = squadless.squadlessSeconds;
    player.isLeader = Boolean(rcon?.isLeader);
    player.role = firstNonEmpty(rcon?.role, player.role);
    player.state = firstNonEmpty(rcon?.state, player.state);
    player.raw = firstNonEmpty(rcon?.raw, bzss?.rawText, player.raw);
    player.lastSeenTime = firstNonEmpty(rcon?.lastSeenTime, now);
    player.position = derived.position;
    player.rotation = derived.rotation;
    player.health = derived.health;
    player.maxHealth = derived.maxHealth;
    player.weaponClass = derived.weaponClass;
    player.ammoValues = derived.ammoValues;
    player.ping = derived.ping;
    player.soldierInfo = derived.soldierInfo;
    player.networkInfo = derived.networkInfo;
  }

  function materializePlayer(player) {
    return player ? { ...player } : null;
  }

  function buildComparableSnapshot(players = []) {
    const map = new Map();
    for (const player of players) {
      const normalized = normalizeRconPlayer(player);
      const key = getStablePlayerKey(normalized);
      if (!key) continue;
      map.set(key, normalized);
    }
    return map;
  }

  function emitSquadMembershipChange(change, meta = {}) {
    const payload = {
      eventId: `module.playerState:squad:${change.serverId}:${change.playerKey}:${Date.now()}`,
      eventName: change.eventName,
      layer: "module",
      source: "module.playerState",
      serverId: change.serverId,
      time: change.time,
      reason: meta.reason ?? "rconListPlayersDiff",
      sourceEventName: meta.sourceEventName ?? "RCON_LIST_PLAYERS_UPDATED",
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
      if (change.type === "joined") return `[PLAYER_STATE] ${change.current.name} joined squad ${change.currentSquadID}`;
      if (change.type === "left") return `[PLAYER_STATE] ${change.current.name} left squad ${change.previousSquadID}`;
      return `[PLAYER_STATE] ${change.current.name} changed squad ${change.previousSquadID} -> ${change.currentSquadID}`;
    }, {
      operation: "squadMembershipChanged",
      data: payload,
    });
  }

  function emitCommanderAuthorized(change, meta = {}) {
    const payload = {
      eventId: `module.playerState:commanderAuthorized:${change.serverId}:${change.playerKey}:${Date.now()}`,
      eventName: "module.playerState.commanderAuthorized",
      layer: "module",
      source: "module.playerState",
      serverId: change.serverId,
      time: change.time,
      reason: meta.reason ?? "rconListPlayersDiff",
      sourceEventName: meta.sourceEventName ?? "RCON_LIST_PLAYERS_UPDATED",
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
    logWithFallback(moduleLogger, "info", () => `[PLAYER_STATE] commander authorized: ${change.current.name} (squad ${change.currentSquadID})`, {
      operation: "commanderAuthorized",
      data: payload,
    });
  }

  function updateCommanderAuthorizationFromSnapshot(serverId, oldMap, newMap, now, meta = {}) {
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
    emitCommanderAuthorized({
      serverId,
      playerKey: candidate.playerKey,
      previous,
      current: candidate.current,
      previousTeamID: normalizeRconId(previous?.teamID),
      currentTeamID: normalizeRconId(candidate.current.teamID),
      previousSquadID: normalizeRconId(previous?.squadID),
      currentSquadID: normalizeRconId(candidate.current.squadID),
      time: now,
    }, meta);
  }

  function emitPlayersSnapshotUpdated(serverId, now, players, squadChanges, sourceEventName) {
    core.eventBus.emitModuleEvent("module.playerState", "playersSnapshotUpdated", {
      eventId: `module.playerState:${Date.now()}`,
      eventName: "module.playerState.playersSnapshotUpdated",
      layer: "module",
      source: "module.playerState",
      serverId,
      time: now,
      params: [],
      sourceEventName,
      players,
      squadChanges: squadChanges.map((change) => ({
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

  function computeSquadChanges(serverId, oldMap, newMap, now) {
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

  function normalizeBzssRecord(player = {}, now = new Date().toISOString()) {
    const record = clonePlainObject(player) ?? {};
    record.playerName = cleanIdentityValue(record.playerName ?? record.name);
    record.playerGuid = cleanIdentityValue(record.playerGuid ?? record.guid ?? record.playerOnlineID ?? record.playerID);
    record.updatedAt = now;
    return record;
  }

  function normalizeBzssUpdatePayload(payload = {}) {
    return {
      ...payload,
      players: Array.isArray(payload.players) ? payload.players : [],
      status: String(payload.status ?? "").trim(),
      serverId: String(payload.serverId ?? "").trim(),
    };
  }

  function resolveBzssUpdateTargetServerId(event = {}) {
    return String(event.serverId ?? core.webStatus.serverId ?? "").trim();
  }

  function attachBzssCache(serverState, players = [], now = new Date().toISOString()) {
    clearBzssCache(serverState);
    for (const rawPlayer of players) {
      const normalized = normalizeBzssRecord(rawPlayer, now);
      if (normalized.playerGuid) serverState.bzssCacheByGuid.set(normalized.playerGuid, normalized);
      if (normalized.playerName) serverState.bzssCacheByName.set(normalizeName(normalized.playerName), normalized);
    }
  }

  function applyRconSnapshot(serverId, players = []) {
    const now = new Date().toISOString();
    const state = ensureServerState(serverId);
    const hadPreviousSnapshot = state.playersByKey.size > 0;
    const previousPlayers = new Map(state.playersByKey);
    const oldComparable = buildComparableSnapshot(previousPlayers.values());
    const nextPlayers = new Map();

    for (const rawPlayer of Array.isArray(players) ? players : []) {
      const normalized = normalizeRconPlayer(rawPlayer);
      const previous = resolveExistingPlayer(state, normalized)
        ?? previousPlayers.get(getStablePlayerKey(normalized))
        ?? null;

      const next = previous ?? createBlankPlayer(serverId, normalized);
      const previousPublic = materializePlayer(next);
      ensureSourceData(next);
      setSourceData(next, "rcon", {
        playerID: normalized.playerID,
        name: normalized.name,
        steamID: normalized.steamID,
        eosID: normalized.eosID,
        controllerID: normalized.controllerID,
        teamID: normalized.teamID,
        squadID: normalized.squadID,
        isLeader: normalized.isLeader,
        role: normalized.role,
        raw: normalized.raw,
        lastSeenTime: now,
        state: "online",
      });
      setSourceData(next, "bzssCore", resolveBzssMatchForPlayer(state, next));
      mergePlayerFields(next, state, now, previousPublic);

      next.previousTeamID = previousPublic?.teamID ?? "";
      next.previousSquadID = previousPublic?.squadID ?? "";
      next.firstSeenAt = previousPublic?.firstSeenAt || now;
      next.lastSquadChangeAt = previousPublic
        && (normalizeRconId(previousPublic.teamID) !== normalizeRconId(next.teamID)
          || normalizeRconId(previousPublic.squadID) !== normalizeRconId(next.squadID))
        ? now
        : previousPublic?.lastSquadChangeAt ?? "";
      next.squadJoinedAt = normalizeRconId(next.squadID) && !normalizeRconId(previousPublic?.squadID)
        ? now
        : previousPublic?.squadJoinedAt ?? "";
      next.squadLeftAt = !normalizeRconId(next.squadID) && normalizeRconId(previousPublic?.squadID)
        ? now
        : previousPublic?.squadLeftAt ?? "";

      const key = getCanonicalPlayerKey(next);
      nextPlayers.set(key, next);
    }

    clearActivePlayers(state);
    for (const [key, player] of nextPlayers.entries()) {
      state.playersByKey.set(key, player);
    }
    rebuildIndexes(state);
    core.webStatus.set("playerCount", nextPlayers.size);

    const newComparable = buildComparableSnapshot(state.playersByKey.values());
    const squadChanges = hadPreviousSnapshot ? computeSquadChanges(serverId, oldComparable, newComparable, now) : [];
    for (const change of squadChanges) {
      emitSquadMembershipChange(change, {
        reason: "rconListPlayersDiff",
        sourceEventName: "RCON_LIST_PLAYERS_UPDATED",
      });
    }
    updateCommanderAuthorizationFromSnapshot(serverId, oldComparable, newComparable, now, {
      reason: "rconListPlayersDiff",
      sourceEventName: "RCON_LIST_PLAYERS_UPDATED",
    });
    emitPlayersSnapshotUpdated(serverId, now, [...state.playersByKey.values()].map(materializePlayer), squadChanges, "RCON_LIST_PLAYERS_UPDATED");
  }

  function applyBzssSnapshot(event = {}) {
    const serverId = resolveBzssUpdateTargetServerId(event);
    if (!serverId) return;

    const state = ensureServerState(serverId);
    const now = new Date().toISOString();
    const normalizedEvent = normalizeBzssUpdatePayload(event);
    const status = normalizedEvent.status;
    const oldComparable = buildComparableSnapshot(state.playersByKey.values());

    if (status === "ready") {
      attachBzssCache(state, normalizedEvent.players, now);
    } else if (status === "missing" || status === "unconfigured") {
      clearBzssCache(state);
    } else {
      return;
    }

    const changes = [];
    for (const player of state.playersByKey.values()) {
      const previous = materializePlayer(player);
      setSourceData(player, "bzssCore", resolveBzssMatchForPlayer(state, player));
      mergePlayerFields(player, state, now, previous);

      const previousSquadID = normalizeRconId(previous?.squadID);
      const currentSquadID = normalizeRconId(player.squadID);
      if (previousSquadID === currentSquadID) continue;

      if (!previousSquadID && currentSquadID) {
        if (Boolean(player.isLeader)) continue;
        changes.push({
          type: "joined",
          eventType: "playerJoinedSquad",
          eventName: "module.playerState.playerJoinedSquad",
          serverId,
          playerKey: getCanonicalPlayerKey(player),
          previous,
          current: materializePlayer(player),
          previousTeamID: normalizeRconId(previous?.teamID),
          currentTeamID: normalizeRconId(player.teamID),
          previousSquadID,
          currentSquadID,
          time: now,
        });
        continue;
      }

      if (previousSquadID && !currentSquadID) {
        changes.push({
          type: "left",
          eventType: "playerLeftSquad",
          eventName: "module.playerState.playerLeftSquad",
          serverId,
          playerKey: getCanonicalPlayerKey(player),
          previous,
          current: materializePlayer(player),
          previousTeamID: normalizeRconId(previous?.teamID),
          currentTeamID: normalizeRconId(player.teamID),
          previousSquadID,
          currentSquadID,
          time: now,
        });
        continue;
      }

      if (previousSquadID && currentSquadID && previousSquadID !== currentSquadID) {
        changes.push({
          type: "changed",
          eventType: "playerChangedSquad",
          eventName: "module.playerState.playerChangedSquad",
          serverId,
          playerKey: getCanonicalPlayerKey(player),
          previous,
          current: materializePlayer(player),
          previousTeamID: normalizeRconId(previous?.teamID),
          currentTeamID: normalizeRconId(player.teamID),
          previousSquadID,
          currentSquadID,
          time: now,
        });
      }
    }

    rebuildIndexes(state);
    const newComparable = buildComparableSnapshot(state.playersByKey.values());
    for (const change of changes) {
      emitSquadMembershipChange(change, {
        reason: "bzssCoreSnapshotDiff",
        sourceEventName: "module.bzssCoreMonitor.snapshotUpdated",
      });
    }
    updateCommanderAuthorizationFromSnapshot(serverId, oldComparable, newComparable, now, {
      reason: "bzssCoreSnapshotDiff",
      sourceEventName: "module.bzssCoreMonitor.snapshotUpdated",
    });
    emitPlayersSnapshotUpdated(serverId, now, [...state.playersByKey.values()].map(materializePlayer), changes, "module.bzssCoreMonitor.snapshotUpdated");
  }

  function handleBzssMonitorSnapshot(event = {}) {
    applyBzssSnapshot(event);
  }

  function upsertPlayer(serverId, identity = {}, patch = {}) {
    const state = ensureServerState(serverId);
    const now = new Date().toISOString();
    const existing = resolveExistingPlayer(state, identity);
    const player = existing ?? createBlankPlayer(serverId, identity);
    const previous = materializePlayer(player);

    setSourceData(player, "rcon", {
      ...(player.sourceData?.rcon ?? {}),
      playerID: firstNonEmpty(patch.playerID, identity.playerID, player.playerID),
      name: firstNonEmpty(patch.name, identity.name, player.name),
      steamID: firstNonEmpty(patch.steamID, patch.steam64ID, identity.steamID, identity.steam64ID, player.steamID),
      eosID: firstNonEmpty(patch.eosID, identity.eosID, player.eosID),
      controllerID: firstNonEmpty(patch.controllerID, identity.controllerID, player.controllerID),
      teamID: normalizeRconId(patch.teamID ?? player.teamID),
      squadID: normalizeRconId(patch.squadID ?? player.squadID),
      isLeader: Boolean(patch.isLeader ?? player.isLeader),
      role: firstNonEmpty(patch.role, player.role),
      state: firstNonEmpty(patch.state, player.state),
      raw: firstNonEmpty(patch.raw, player.raw),
      lastSeenTime: patch.lastSeenTime ?? now,
    });
    setSourceData(player, "bzssCore", resolveBzssMatchForPlayer(state, player));
    mergePlayerFields(player, state, now, previous);

    const oldKey = getCanonicalPlayerKey(previous ?? player);
    const newKey = getCanonicalPlayerKey(player);
    if (existing && oldKey !== newKey) {
      state.playersByKey.delete(oldKey);
    }
    state.playersByKey.set(newKey, player);
    rebuildIndexes(state);
    return player;
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

    const bzssGuid = cleanIdentityValue(player?.sourceData?.bzssCore?.playerGuid);
    if (bzssGuid) return `bzss:${bzssGuid}`;

    const normalizedName = normalizeName(player?.name ?? player?.sourceData?.bzssCore?.playerName);
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

  function computeSquadChanges(serverId, oldMap, newMap, now) {
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

  function normalizeBzssRecord(player = {}, now = new Date().toISOString()) {
    const record = clonePlainObject(player) ?? {};
    record.playerName = cleanIdentityValue(record.playerName ?? record.name);
    record.playerGuid = cleanIdentityValue(record.playerGuid ?? record.guid ?? record.playerOnlineID ?? record.playerID);
    record.updatedAt = now;
    return record;
  }

  function attachBzssCache(serverState, players = [], now = new Date().toISOString()) {
    clearBzssCache(serverState);
    for (const rawPlayer of players) {
      const normalized = normalizeBzssRecord(rawPlayer, now);
      if (normalized.playerGuid) serverState.bzssCacheByGuid.set(normalized.playerGuid, normalized);
      if (normalized.playerName) serverState.bzssCacheByName.set(normalizeName(normalized.playerName), normalized);
    }
  }

  function emitPlayersSnapshotUpdated(serverId, now, players, squadChanges, sourceEventName) {
    core.eventBus.emitModuleEvent("module.playerState", "playersSnapshotUpdated", {
      eventId: `module.playerState:${Date.now()}`,
      eventName: "module.playerState.playersSnapshotUpdated",
      layer: "module",
      source: "module.playerState",
      serverId,
      time: now,
      params: [],
      sourceEventName,
      players,
      squadChanges: squadChanges.map((change) => ({
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

  function emitSquadMembershipChange(change, meta = {}) {
    const payload = {
      eventId: `module.playerState:squad:${change.serverId}:${change.playerKey}:${Date.now()}`,
      eventName: change.eventName,
      layer: "module",
      source: "module.playerState",
      serverId: change.serverId,
      time: change.time,
      reason: meta.reason ?? "rconListPlayersDiff",
      sourceEventName: meta.sourceEventName ?? "RCON_LIST_PLAYERS_UPDATED",
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
      if (change.type === "joined") return `[PLAYER_STATE] ${change.current.name} joined squad ${change.currentSquadID}`;
      if (change.type === "left") return `[PLAYER_STATE] ${change.current.name} left squad ${change.previousSquadID}`;
      return `[PLAYER_STATE] ${change.current.name} changed squad ${change.previousSquadID} -> ${change.currentSquadID}`;
    }, { operation: "squadMembershipChanged", data: payload });
  }

  function emitCommanderAuthorized(change, meta = {}) {
    const payload = {
      eventId: `module.playerState:commanderAuthorized:${change.serverId}:${change.playerKey}:${Date.now()}`,
      eventName: "module.playerState.commanderAuthorized",
      layer: "module",
      source: "module.playerState",
      serverId: change.serverId,
      time: change.time,
      reason: meta.reason ?? "rconListPlayersDiff",
      sourceEventName: meta.sourceEventName ?? "RCON_LIST_PLAYERS_UPDATED",
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
    logWithFallback(moduleLogger, "info", () => `[PLAYER_STATE] commander authorized: ${change.current.name} (squad ${change.currentSquadID})`, {
      operation: "commanderAuthorized",
      data: payload,
    });
  }

  function updateCommanderAuthorizationFromSnapshot(serverId, oldMap, newMap, now, meta = {}) {
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
    emitCommanderAuthorized({
      serverId,
      playerKey: candidate.playerKey,
      previous,
      current: candidate.current,
      previousTeamID: normalizeRconId(previous?.teamID),
      currentTeamID: normalizeRconId(candidate.current.teamID),
      previousSquadID: normalizeRconId(previous?.squadID),
      currentSquadID: normalizeRconId(candidate.current.squadID),
      time: now,
    }, meta);
  }

  function applyRconSnapshot(serverId, players = []) {
    const now = new Date().toISOString();
    const state = ensureServerState(serverId);
    const hadPreviousSnapshot = state.playersByKey.size > 0;
    const previousPlayers = new Map(state.playersByKey);
    const oldComparable = buildComparableSnapshot(previousPlayers.values());
    const nextPlayers = new Map();

    for (const rawPlayer of Array.isArray(players) ? players : []) {
      const normalized = normalizeRconPlayer(rawPlayer);
      const previous = resolveExistingPlayer(state, normalized)
        ?? previousPlayers.get(getStablePlayerKey(normalized))
        ?? null;

      const next = previous ?? createBlankPlayer(serverId, normalized);
      const previousPublic = materializePlayer(next);
      setSourceData(next, "rcon", {
        playerID: normalized.playerID,
        name: normalized.name,
        steamID: normalized.steamID,
        eosID: normalized.eosID,
        controllerID: normalized.controllerID,
        teamID: normalized.teamID,
        squadID: normalized.squadID,
        isLeader: normalized.isLeader,
        role: normalized.role,
        raw: normalized.raw,
        lastSeenTime: now,
        state: "online",
      });
      setSourceData(next, "bzssCore", resolveBzssMatchForPlayer(state, next));
      mergePlayerFields(next, state, now, previousPublic);

      next.previousTeamID = previousPublic?.teamID ?? "";
      next.previousSquadID = previousPublic?.squadID ?? "";
      next.firstSeenAt = previousPublic?.firstSeenAt || now;
      next.lastSquadChangeAt = previousPublic
        && (normalizeRconId(previousPublic.teamID) !== normalizeRconId(next.teamID)
          || normalizeRconId(previousPublic.squadID) !== normalizeRconId(next.squadID))
        ? now
        : previousPublic?.lastSquadChangeAt ?? "";
      next.squadJoinedAt = normalizeRconId(next.squadID) && !normalizeRconId(previousPublic?.squadID)
        ? now
        : previousPublic?.squadJoinedAt ?? "";
      next.squadLeftAt = !normalizeRconId(next.squadID) && normalizeRconId(previousPublic?.squadID)
        ? now
        : previousPublic?.squadLeftAt ?? "";

      nextPlayers.set(getCanonicalPlayerKey(next), next);
    }

    clearActivePlayers(state);
    for (const [key, player] of nextPlayers.entries()) {
      state.playersByKey.set(key, player);
    }
    rebuildIndexes(state);
    core.webStatus.set("playerCount", nextPlayers.size);

    const newComparable = buildComparableSnapshot(state.playersByKey.values());
    const squadChanges = hadPreviousSnapshot ? computeSquadChanges(serverId, oldComparable, newComparable, now) : [];
    for (const change of squadChanges) {
      emitSquadMembershipChange(change, {
        reason: "rconListPlayersDiff",
        sourceEventName: "RCON_LIST_PLAYERS_UPDATED",
      });
    }
    updateCommanderAuthorizationFromSnapshot(serverId, oldComparable, newComparable, now, {
      reason: "rconListPlayersDiff",
      sourceEventName: "RCON_LIST_PLAYERS_UPDATED",
    });
    emitPlayersSnapshotUpdated(serverId, now, [...state.playersByKey.values()].map(materializePlayer), squadChanges, "RCON_LIST_PLAYERS_UPDATED");
  }

  function applyBzssSnapshot(event = {}) {
    const serverId = String(event.serverId ?? core.webStatus.serverId ?? "").trim();
    if (!serverId) return;

    const state = ensureServerState(serverId);
    const now = new Date().toISOString();
    const status = String(event.status ?? "").trim();
    const oldComparable = buildComparableSnapshot(state.playersByKey.values());

    if (status && status !== "ready") {
      clearBzssCache(state);
    } else {
      attachBzssCache(state, Array.isArray(event.players) ? event.players : [], now);
    }

    const changes = [];
    for (const player of state.playersByKey.values()) {
      const previous = materializePlayer(player);
      setSourceData(player, "bzssCore", resolveBzssMatchForPlayer(state, player));
      mergePlayerFields(player, state, now, previous);

      const previousSquadID = normalizeRconId(previous?.squadID);
      const currentSquadID = normalizeRconId(player.squadID);
      if (previousSquadID === currentSquadID) continue;

      if (!previousSquadID && currentSquadID) {
        if (Boolean(player.isLeader)) continue;
        changes.push({
          type: "joined",
          eventType: "playerJoinedSquad",
          eventName: "module.playerState.playerJoinedSquad",
          serverId,
          playerKey: getCanonicalPlayerKey(player),
          previous,
          current: materializePlayer(player),
          previousTeamID: normalizeRconId(previous?.teamID),
          currentTeamID: normalizeRconId(player.teamID),
          previousSquadID,
          currentSquadID,
          time: now,
        });
        continue;
      }

      if (previousSquadID && !currentSquadID) {
        changes.push({
          type: "left",
          eventType: "playerLeftSquad",
          eventName: "module.playerState.playerLeftSquad",
          serverId,
          playerKey: getCanonicalPlayerKey(player),
          previous,
          current: materializePlayer(player),
          previousTeamID: normalizeRconId(previous?.teamID),
          currentTeamID: normalizeRconId(player.teamID),
          previousSquadID,
          currentSquadID,
          time: now,
        });
        continue;
      }

      if (previousSquadID && currentSquadID && previousSquadID !== currentSquadID) {
        changes.push({
          type: "changed",
          eventType: "playerChangedSquad",
          eventName: "module.playerState.playerChangedSquad",
          serverId,
          playerKey: getCanonicalPlayerKey(player),
          previous,
          current: materializePlayer(player),
          previousTeamID: normalizeRconId(previous?.teamID),
          currentTeamID: normalizeRconId(player.teamID),
          previousSquadID,
          currentSquadID,
          time: now,
        });
      }
    }

    rebuildIndexes(state);
    const newComparable = buildComparableSnapshot(state.playersByKey.values());
    for (const change of changes) {
      emitSquadMembershipChange(change, {
        reason: "bzssCoreSnapshotDiff",
        sourceEventName: "module.bzssCoreMonitor.snapshotUpdated",
      });
    }
    updateCommanderAuthorizationFromSnapshot(serverId, oldComparable, newComparable, now, {
      reason: "bzssCoreSnapshotDiff",
      sourceEventName: "module.bzssCoreMonitor.snapshotUpdated",
    });
    emitPlayersSnapshotUpdated(serverId, now, [...state.playersByKey.values()].map(materializePlayer), changes, "module.bzssCoreMonitor.snapshotUpdated");
  }

  function handleBzssMonitorSnapshot(event = {}) {
    applyBzssSnapshot(event);
  }

  function emitPlayersSnapshotForState(serverId, sourceEventName = "RCON_LIST_PLAYERS_UPDATED") {
    const state = ensureServerState(serverId);
    emitPlayersSnapshotUpdated(serverId, new Date().toISOString(), [...state.playersByKey.values()].map(materializePlayer), [], sourceEventName);
  }

  function upsertPlayer(serverId, identity = {}, patch = {}) {
    const state = ensureServerState(serverId);
    const now = new Date().toISOString();
    const existing = resolveExistingPlayer(state, identity);
    const player = existing ?? createBlankPlayer(serverId, identity);
    const previous = materializePlayer(player);

    setSourceData(player, "rcon", {
      ...(player.sourceData?.rcon ?? {}),
      playerID: firstNonEmpty(patch.playerID, identity.playerID, player.playerID),
      name: firstNonEmpty(patch.name, identity.name, player.name),
      steamID: firstNonEmpty(patch.steamID, patch.steam64ID, identity.steamID, identity.steam64ID, player.steamID),
      eosID: firstNonEmpty(patch.eosID, identity.eosID, player.eosID),
      controllerID: firstNonEmpty(patch.controllerID, identity.controllerID, player.controllerID),
      teamID: normalizeRconId(patch.teamID ?? player.teamID),
      squadID: normalizeRconId(patch.squadID ?? player.squadID),
      isLeader: Boolean(patch.isLeader ?? player.isLeader),
      role: firstNonEmpty(patch.role, player.role),
      state: firstNonEmpty(patch.state, player.state),
      raw: firstNonEmpty(patch.raw, player.raw),
      lastSeenTime: patch.lastSeenTime ?? now,
    });
    setSourceData(player, "bzssCore", resolveBzssMatchForPlayer(state, player));
    mergePlayerFields(player, state, now, previous);

    const oldKey = getCanonicalPlayerKey(previous ?? player);
    const newKey = getCanonicalPlayerKey(player);
    if (existing && oldKey !== newKey) {
      state.playersByKey.delete(oldKey);
    }
    state.playersByKey.set(newKey, player);
    rebuildIndexes(state);
    return player;
  }

  function getServerSnapshot(serverId) {
    const state = ensureServerState(serverId);
    const players = [...state.playersByKey.values()].map(materializePlayer);
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

    replaceFromRcon(serverId, players) {
      applyRconSnapshot(serverId, players);
    },
  };

  return {
    manifest: {
      id: "module.playerState",
      name: "Player State Module",
      kind: "module",
      version: "0.5.0",
      description: "Canonical global player list module. Maintains one in-memory player list per server with merged identity indexes, team/squad state, role and presence data for reuse by combat, match and database modules.",
    },
    apiName: "playerState",
    api,

    async start() {
      unsubscribers.push(core.eventBus.onCoreEvent("RCON_LIST_PLAYERS_UPDATED", (event) => {
        applyRconSnapshot(event.serverId, event.players ?? []);
      }));

      if (typeof core.eventBus.onModuleEvent === "function") {
        unsubscribers.push(core.eventBus.onModuleEvent("module.bzssCoreMonitor", "snapshotUpdated", (event) => {
          handleBzssMonitorSnapshot(event);
        }));
      }

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

function createEmptyDerivedSoldierInfo() {
  return {
    raw: "",
    fields: [],
    values: {},
    soldierClass: "",
    health: null,
    weaponClass: "",
    ammoValues: [],
    position: null,
    rotation: null,
  };
}

function createEmptyNetworkInfo() {
  return {
    ping: null,
  };
}

function buildDerivedBzssState(bzss = null) {
  const soldierInfo = normalizeDerivedSoldierInfo(bzss?.soldierInfo);
  const vehicleInfo = normalizeDerivedVehicleInfo(bzss?.vehicleInfo);
  const playerScoreboard = clonePlainObject(bzss?.playerScoreboard) ?? null;
  const ping = toFiniteNumber(
    bzss?.ping
    ?? playerScoreboard?.valuesByKey?.Ping
    ?? playerScoreboard?.valuesByKey?.ping
    ?? null,
  );
  const position = soldierInfo.position ?? vehicleInfo.position ?? null;
  const rotation = soldierInfo.rotation ?? vehicleInfo.rotation ?? null;
  const health = soldierInfo.health ?? null;
  const maxHealth = soldierInfo.maxHealth ?? vehicleInfo.maxHealth ?? null;
  const weaponClass = soldierInfo.weaponClass || "";
  const ammoValues = Array.isArray(soldierInfo.ammoValues) ? [...soldierInfo.ammoValues] : [];

  return {
    position,
    rotation,
    health,
    maxHealth,
    weaponClass,
    ammoValues,
    ping,
    soldierInfo: {
      ...soldierInfo,
      position,
      rotation,
      health,
      maxHealth,
      weaponClass,
      ammoValues: [...ammoValues],
    },
    networkInfo: {
      ping,
      playerScoreboard,
    },
    vehicleInfo,
  };
}

function normalizeDerivedSoldierInfo(value) {
  const info = value && typeof value === "object" ? value : {};
  return {
    raw: String(info.raw ?? ""),
    fields: Array.isArray(info.fields) ? [...info.fields] : [],
    values: clonePlainObject(info.values ?? {}) ?? {},
    soldierClass: String(info.soldierClass ?? ""),
    health: toFiniteNumber(info.health),
    maxHealth: toFiniteNumber(info.maxHealth),
    weaponClass: String(info.weaponClass ?? ""),
    ammoValues: Array.isArray(info.ammoValues)
      ? info.ammoValues.map(toFiniteNumber).filter((value) => value != null)
      : [],
    position: normalizeVector(info.position),
    rotation: normalizeVector(info.rotation),
  };
}

function normalizeDerivedVehicleInfo(value) {
  const info = value && typeof value === "object" ? value : {};
  return {
    raw: String(info.raw ?? ""),
    vehicleType: String(info.vehicleType ?? ""),
    healthText: String(info.healthText ?? ""),
    health: toFiniteNumber(info.health),
    maxHealth: toFiniteNumber(info.maxHealth),
    position: normalizeVector(info.position),
    rotation: normalizeVector(info.rotation),
  };
}

function normalizeVector(value) {
  if (!value || typeof value !== "object") return null;
  const x = toFiniteNumber(value.x);
  const y = toFiniteNumber(value.y);
  const z = toFiniteNumber(value.z);
  if (x == null && y == null && z == null) return null;
  return { x, y, z };
}

function toFiniteNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && String(value).trim() === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clonePlainObject(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clonePlayer(player) {
  return player ? clonePlainObject(player) : null;
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

function cleanIdentityValue(value) {
  return String(value ?? "").trim();
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
