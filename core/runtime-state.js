// -*- coding: utf-8 -*-

const MAX_EVENT_BUCKET_SIZE = 500;
const MAX_JOB_HISTORY = 200;

export class RuntimeState {
  constructor({ eventBus, webStatus, logger } = {}) {
    this.eventBus = eventBus;
    this.webStatus = webStatus;
    this.logger = logger;
    this.unsubscribers = [];

    this.state = {
      server: {
        updatedAt: 0,
        stale: false,
      },
      players: makePlayersState(),
      squads: makeSquadsState(),
      teams: [],
      rcon: {
        updatedAt: 0,
        stale: false,
      },
      events: {
        console: [],
        raw: [],
        rcon: [],
        round: [],
        combat: [],
        updatedAt: 0,
      },
      jobs: {
        byId: {},
        activeJobs: [],
        updatedAt: 0,
      },
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
  }

  updateRcon(patch = {}) {
    this.state.rcon = {
      ...this.state.rcon,
      ...cloneJsonSafe(patch),
      updatedAt: Date.now(),
      stale: false,
    };
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
    this.deriveTeams();
  }

  markPlayersStale() {
    this.state.players.stale = true;
  }

  markSquadsStale() {
    this.state.squads.stale = true;
  }

  recordEvent(bucket, event) {
    const key = String(bucket || "").trim();
    if (!this.state.events[key]) return;
    this.state.events[key].push(cloneJsonSafe(event));
    if (this.state.events[key].length > MAX_EVENT_BUCKET_SIZE) {
      this.state.events[key].splice(0, this.state.events[key].length - MAX_EVENT_BUCKET_SIZE);
    }
    this.state.events.updatedAt = Date.now();
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
  }

  getServer() {
    return {
      ...cloneJsonSafe(this.state.server),
      webStatus: this.webStatus?.getSnapshot?.() ?? null,
    };
  }

  getPlayers() {
    return cloneJsonSafe(this.state.players);
  }

  getSquads() {
    return cloneJsonSafe(this.state.squads);
  }

  getMatch() {
    return {
      server: this.getServer(),
      players: this.getPlayers(),
      squads: this.getSquads(),
      teams: cloneJsonSafe(this.state.teams),
      updatedAt: Math.max(this.state.players.updatedAt, this.state.squads.updatedAt, this.state.server.updatedAt),
    };
  }

  getEvents() {
    return cloneJsonSafe(this.state.events);
  }

  getJobs() {
    return cloneJsonSafe(this.state.jobs);
  }

  getAll() {
    return {
      server: this.getServer(),
      players: this.getPlayers(),
      squads: this.getSquads(),
      teams: cloneJsonSafe(this.state.teams),
      match: this.getMatch(),
      rcon: cloneJsonSafe(this.state.rcon),
      events: this.getEvents(),
      jobs: this.getJobs(),
      updatedAt: Math.max(
        Number(this.state.server?.updatedAt ?? 0),
        Number(this.state.players?.updatedAt ?? 0),
        Number(this.state.squads?.updatedAt ?? 0),
        Number(this.state.events?.updatedAt ?? 0),
        Number(this.state.jobs?.updatedAt ?? 0),
        Number(this.state.rcon?.updatedAt ?? 0),
      ),
    };
  }

  deriveTeams() {
    this.state.teams = deriveTeams(this.state.players.active, this.state.squads.list);
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
    stale: false,
  };
}

function makeSquadsState() {
  return {
    list: [],
    byKey: {},
    byTeamID: {},
    updatedAt: 0,
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
