// -*- coding: utf-8 -*-

const MAX_JOB_HISTORY = 200;

export class RuntimeState {
  constructor({ eventBus, webStatus, logger, config } = {}) {
    this.eventBus = eventBus;
    this.webStatus = webStatus;
    this.logger = logger;
    this.config = config;
    this.unsubscribers = [];

    this.limits = {
      raw: this.config?.get?.("runtimeState.eventHistory.raw", 100) ?? 100,
      rcon: this.config?.get?.("runtimeState.eventHistory.rcon", 100) ?? 100,
      round: this.config?.get?.("runtimeState.eventHistory.round", 50) ?? 50,
      combat: this.config?.get?.("runtimeState.eventHistory.combat", 200) ?? 200,
      console: 500,
    };
    this.includeEventsInAllSnapshot = this.config?.get?.("runtimeState.includeEventsInAllSnapshot", false) ?? false;

    this.state = {
      server: {
        updatedAt: 0,
        revision: 0,
        stale: false,
      },
      players: makePlayersState(),
      squads: makeSquadsState(),
      teams: [],
      rcon: {
        updatedAt: 0,
        revision: 0,
        stale: false,
      },
      events: {
        console: [],
        raw: [],
        rcon: [],
        round: [],
        combat: [],
        updatedAt: 0,
        revision: 0,
      },
      jobs: {
        byId: {},
        activeJobs: [],
        updatedAt: 0,
        revision: 0,
      },
    };

    this.cache = {
      server: { key: "", value: null },
      players: { key: "", value: null },
      squads: { key: "", value: null },
      match: { key: "", value: null },
      events: { key: "", value: null },
      jobs: { key: "", value: null },
      all: { key: "", value: null },
    };

    if (this.eventBus) this.attachEventBus(this.eventBus);
  }

  attachEventBus(eventBus) {
    this.unsubscribers.push(eventBus.onCoreEvent("RCON_LIST_PLAYERS_UPDATED", (event) => {
      this.updatePlayers(event?.players ?? []);
    }));

    this.unsubscribers.push(eventBus.onCoreEvent("RCON_LIST_SQUADS_UPDATED", (event) => {
      this.updateSquads(event?.squads ?? []);
    }));

    this.unsubscribers.push(eventBus.onCoreEvent("*", (event) => {
      this.recordEvent("raw", event);
      if (String(event?.eventName ?? "").startsWith("RCON_")) this.recordEvent("rcon", event);
      if (String(event?.eventName ?? "") === "round.world_bring_up") this.recordEvent("round", event);
    }));

    this.unsubscribers.push(eventBus.onModuleEvent("module.combatClean", "*", (event) => {
      this.recordEvent("combat", event);
    }));
  }

  stop() {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch {}
    }
  }

  updateServer(patch = {}) {
    this.state.server = {
      ...this.state.server,
      ...cloneJsonSafe(patch),
      updatedAt: Date.now(),
      stale: false,
    };
    this.state.server.revision += 1;
  }

  updateRcon(patch = {}) {
    this.state.rcon = {
      ...this.state.rcon,
      ...cloneJsonSafe(patch),
      updatedAt: Date.now(),
      stale: false,
    };
    this.state.rcon.revision += 1;
  }

  updatePlayers(input = []) {
    const active = normalizePlayers(input.active ?? input);
    const recentlyDisconnected = normalizePlayers(input.recentlyDisconnected ?? []);
    const next = makePlayersState();
    next.active = active;
    next.recentlyDisconnected = recentlyDisconnected;
    next.updatedAt = Date.now();
    next.stale = false;

    for (const player of [...active, ...recentlyDisconnected]) {
      if (player.steamID && !next.bySteamID[player.steamID]) next.bySteamID[player.steamID] = player;
      if (player.eosID && !next.byEOSID[player.eosID]) next.byEOSID[player.eosID] = player;
      if (player.playerID != null && !next.byPlayerID[player.playerID]) next.byPlayerID[player.playerID] = player;
      if (player.name && !next.byName[player.name]) next.byName[player.name] = player;
    }

    this.state.players = next;
    this.state.players.revision += 1;
    this.deriveTeams();
  }

  updateSquads(squads = []) {
    const list = normalizeSquads(squads);
    const next = makeSquadsState();
    next.list = list;
    next.updatedAt = Date.now();
    next.stale = false;

    for (const squad of list) {
      if (squad.key) next.byKey[squad.key] = squad;
      if (squad.teamID != null) {
        const teamKey = String(squad.teamID);
        if (!next.byTeamID[teamKey]) next.byTeamID[teamKey] = [];
        next.byTeamID[teamKey].push(squad);
      }
    }

    this.state.squads = next;
    this.state.squads.revision += 1;
    this.deriveTeams();
  }

  markPlayersStale() {
    this.state.players.stale = true;
    this.state.players.revision += 1;
  }

  markSquadsStale() {
    this.state.squads.stale = true;
    this.state.squads.revision += 1;
  }

  recordEvent(bucket, event) {
    const key = String(bucket || "").trim();
    if (!this.state.events[key]) return;

    // Avoid retaining full player/squad lists in event logs
    const cleanedEvent = cloneJsonSafe(event);
    if (cleanedEvent && typeof cleanedEvent === "object") {
      if (cleanedEvent.players) {
        cleanedEvent.playerCount = Array.isArray(cleanedEvent.players) ? cleanedEvent.players.length : 0;
        delete cleanedEvent.players;
      }
      if (cleanedEvent.squads) {
        cleanedEvent.squadCount = Array.isArray(cleanedEvent.squads) ? cleanedEvent.squads.length : 0;
        delete cleanedEvent.squads;
      }
    }

    this.state.events[key].push(cleanedEvent);
    const limit = this.limits[key] ?? 500;
    if (this.state.events[key].length > limit) {
      this.state.events[key].splice(0, this.state.events[key].length - limit);
    }
    this.state.events.updatedAt = Date.now();
    this.state.events.revision += 1;
  }
  updateJob(job) {
    if (!job?.id) return;
    const publicJob = cloneJsonSafe(job);
    this.state.jobs.byId[publicJob.id] = publicJob;

    const entries = Object.values(this.state.jobs.byId)
      .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
    for (const stale of entries.slice(MAX_JOB_HISTORY)) {
      delete this.state.jobs.byId[stale.id];
    }

    this.state.jobs.activeJobs = Object.values(this.state.jobs.byId)
      .filter((item) => item.status === "queued" || item.status === "running")
      .map((item) => item.id);
    this.state.jobs.updatedAt = Date.now();
    this.state.jobs.revision += 1;
  }

  getServer() {
    const webStatusUpdatedAt = String(this.webStatus?.state?.updatedAt ?? this.webStatus?.getSnapshot?.()?.updatedAt ?? "");
    const key = this.getServerCacheKey(webStatusUpdatedAt);
    const cached = this.cache.server;
    if (cached.key === key && cached.value) return cached.value;

    const webStatus = this.webStatus?.getSnapshot?.() ?? null;
    const value = {
      ...cloneJsonSafe(this.state.server),
      webStatus: webStatus ? cloneJsonSafe(webStatus) : null,
    };
    cached.key = key;
    cached.value = value;
    return value;
  }

  getPlayers() {
    const key = this.getPlayersCacheKey();
    const cached = this.cache.players;
    if (cached.key === key && cached.value) return cached.value;

    const value = cloneJsonSafe(this.state.players);
    cached.key = key;
    cached.value = value;
    return value;
  }

  getSquads() {
    const key = this.getSquadsCacheKey();
    const cached = this.cache.squads;
    if (cached.key === key && cached.value) return cached.value;

    const value = cloneJsonSafe(this.state.squads);
    cached.key = key;
    cached.value = value;
    return value;
  }

  getMatch() {
    const server = this.getServer();
    const players = this.getPlayers();
    const squads = this.getSquads();
    const key = this.getMatchCacheKey(server, players, squads);
    const cached = this.cache.match;
    if (cached.key === key && cached.value) return cached.value;

    const value = {
      server,
      players,
      squads,
      teams: cloneJsonSafe(this.state.teams),
      updatedAt: Math.max(this.state.players.updatedAt, this.state.squads.updatedAt, this.state.server.updatedAt),
    };
    cached.key = key;
    cached.value = value;
    return value;
  }

  getEvents() {
    const key = this.getEventsCacheKey();
    const cached = this.cache.events;
    if (cached.key === key && cached.value) return cached.value;

    const value = cloneJsonSafe(this.state.events);
    cached.key = key;
    cached.value = value;
    return value;
  }

  getJobs() {
    const key = this.getJobsCacheKey();
    const cached = this.cache.jobs;
    if (cached.key === key && cached.value) return cached.value;

    const value = cloneJsonSafe(this.state.jobs);
    cached.key = key;
    cached.value = value;
    return value;
  }

  getAll() {
    const server = this.getServer();
    const players = this.getPlayers();
    const squads = this.getSquads();
    const match = this.getMatch();
    const events = this.includeEventsInAllSnapshot
      ? this.getEvents()
      : { console: [], raw: [], rcon: [], round: [], combat: [] };
    const jobs = this.getJobs();
    const key = this.getAllCacheKey(server, players, squads, match, events, jobs);
    const cached = this.cache.all;
    if (cached.key === key && cached.value) return cached.value;

    const value = {
      server,
      players,
      squads,
      teams: cloneJsonSafe(this.state.teams),
      match,
      rcon: cloneJsonSafe(this.state.rcon),
      events,
      jobs,
      updatedAt: Math.max(
        Number(this.state.server?.updatedAt ?? 0),
        Number(this.state.players?.updatedAt ?? 0),
        Number(this.state.squads?.updatedAt ?? 0),
        this.includeEventsInAllSnapshot ? Number(this.state.events?.updatedAt ?? 0) : 0,
        Number(this.state.jobs?.updatedAt ?? 0),
        Number(this.state.rcon?.updatedAt ?? 0),
      ),
    };
    cached.key = key;
    cached.value = value;
    return value;
  }

  deriveTeams() {
    this.state.teams = deriveTeams(this.state.players.active, this.state.squads.list);
  }

  getServerCacheKey(webStatusUpdatedAt = "") {
    return [
      this.state.server.revision,
      this.state.server.updatedAt,
      this.state.server.stale ? "stale" : "fresh",
      String(webStatusUpdatedAt ?? ""),
    ].join("|");
  }

  getPlayersCacheKey() {
    return [
      this.state.players.revision,
      this.state.players.updatedAt,
      this.state.players.stale ? "stale" : "fresh",
    ].join("|");
  }

  getSquadsCacheKey() {
    return [
      this.state.squads.revision,
      this.state.squads.updatedAt,
      this.state.squads.stale ? "stale" : "fresh",
    ].join("|");
  }

  getMatchCacheKey(server, players, squads) {
    return [
      this.getServerCacheKey(server?.webStatus?.updatedAt ?? ""),
      this.getPlayersCacheKey(),
      this.getSquadsCacheKey(),
      server?.updatedAt ?? "",
      players?.updatedAt ?? "",
      squads?.updatedAt ?? "",
    ].join("|");
  }

  getEventsCacheKey() {
    return [
      this.state.events.revision,
      this.state.events.updatedAt,
      this.state.events.console.length,
      this.state.events.raw.length,
      this.state.events.rcon.length,
      this.state.events.round.length,
      this.state.events.combat.length,
    ].join("|");
  }

  getJobsCacheKey() {
    return [
      this.state.jobs.revision,
      this.state.jobs.updatedAt,
      this.state.jobs.activeJobs.length,
      Object.keys(this.state.jobs.byId).length,
    ].join("|");
  }

  getAllCacheKey(server, players, squads, match, events, jobs) {
    const eventsKey = this.includeEventsInAllSnapshot ? this.getEventsCacheKey() : "no-events";
    const eventsUpdatedAt = this.includeEventsInAllSnapshot ? (events?.updatedAt ?? "") : "";
    return [
      this.getServerCacheKey(server?.webStatus?.updatedAt ?? ""),
      this.getPlayersCacheKey(),
      this.getSquadsCacheKey(),
      this.getMatchCacheKey(server, players, squads),
      eventsKey,
      this.getJobsKey ? this.getJobsKey() : this.getJobsCacheKey(), // handle compatibility safely
      this.state.rcon.revision,
      this.state.rcon.updatedAt,
      this.state.rcon.stale ? "stale" : "fresh",
      match?.updatedAt ?? "",
      eventsUpdatedAt,
      jobs?.updatedAt ?? "",
    ].join("|");
  }
}

function makePlayersState() {
  return {
    active: [],
    recentlyDisconnected: [],
    bySteamID: {},
    byEOSID: {},
    byPlayerID: {},
    byName: {},
    updatedAt: 0,
    revision: 0,
    stale: false,
  };
}

function makeSquadsState() {
  return {
    list: [],
    byKey: {},
    byTeamID: {},
    updatedAt: 0,
    revision: 0,
    stale: false,
  };
}

function normalizePlayers(players) {
  return (Array.isArray(players) ? players : []).map((player) => ({
    ...cloneJsonSafe(player),
    name: String(player?.name ?? "").trim(),
    role: String(player?.role ?? "").trim(),
    playerID: numberOrNull(player?.playerID),
    teamID: numberOrNull(player?.teamID),
    squadID: numberOrNull(player?.squadID),
    isLeader: Boolean(player?.isLeader),
    online: player?.online !== false,
  }));
}

function normalizeSquads(squads) {
  return (Array.isArray(squads) ? squads : []).map((squad) => {
    const teamID = numberOrNull(squad?.teamID);
    const squadID = numberOrNull(squad?.squadID);
    return {
      ...cloneJsonSafe(squad),
      teamID,
      squadID,
      key: teamID != null && squadID != null ? `${teamID}:${squadID}` : "",
    };
  });
}

function deriveTeams(players, squads) {
  const teamMap = new Map();
  const unknownTeamID = "unknown";
  for (const teamID of [1, 2]) {
    teamMap.set(String(teamID), {
      teamID,
      teamName: `Team ${teamID}`,
      squads: [],
      unassignedPlayers: [],
      playerCount: 0,
    });
  }
  teamMap.set(unknownTeamID, {
    teamID: unknownTeamID,
    teamName: "Unknown / Unassigned",
    squads: [],
    unassignedPlayers: [],
    playerCount: 0,
  });

  const squadMap = new Map();
  for (const squad of squads) {
    if (squad.teamID == null || squad.squadID == null) continue;
    const team = ensureTeam(teamMap, squad.teamID, squad.teamName);
    const entry = {
      ...squad,
      members: [],
    };
    team.squads.push(entry);
    squadMap.set(`${squad.teamID}:${squad.squadID}`, entry);
  }

  for (const player of players) {
    const teamID = player.teamID == null ? unknownTeamID : player.teamID;
    const team = ensureTeam(teamMap, teamID);
    const key = player.squadID != null ? `${teamID}:${player.squadID}` : "";
    const squad = key ? squadMap.get(key) : null;
    if (squad) {
      squad.members.push(player);
    } else {
      team.unassignedPlayers.push(player);
    }
    team.playerCount += 1;
  }

  return [...teamMap.values()].map((team) => ({
    ...team,
    squads: team.squads.sort((a, b) => Number(a.squadID) - Number(b.squadID)),
  }));
}

function ensureTeam(teamMap, teamID, teamName = "") {
  const key = String(teamID);
  if (!teamMap.has(key)) {
    teamMap.set(key, {
      teamID,
      teamName: teamName || `Team ${teamID}`,
      squads: [],
      unassignedPlayers: [],
      playerCount: 0,
    });
  }
  const team = teamMap.get(key);
  if (teamName) team.teamName = teamName;
  return team;
}

function numberOrNull(value) {
  if (value == null || value === "" || value === "N/A") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cloneJsonSafe(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}
