import type { RuntimePlayer } from "../stores/player.store";
import type { RuntimeSquad } from "../stores/squad.store";
import type { RuntimeTeam } from "../stores/match.store";
import type {
  PlayerRowViewModel,
  SquadLeaderRowViewModel,
  SquadViewModel,
  TeamViewModel,
  PlayerDetailViewModel,
  MatchHeaderData,
  SquadWarning,
} from "../types/squad-admin.types";

export function adaptPlayerRow(
  player: RuntimePlayer,
  playtimeHours: number | null = null,
): PlayerRowViewModel {
  const steam64 = normalizeSteam64(player.steamID ?? (player as any).steamId ?? (player as any).steam64 ?? (player as any).steam64ID);
  return {
    playerId: player.playerID ?? null,
    name: player.name || "Unknown",
    role: player.role || "Unknown Role",
    isLeader: Boolean(player.isLeader),
    isOnline: Boolean(player.online),
    teamId: player.teamID ?? null,
    squadId: player.squadID ?? null,
    steamId: player.steamID ?? null,
    steam64,
    eosId: player.eosID ?? null,
    ip: (player as any).current_ip || (player as any).ip || null,
    playtimeHours,
    raw: player,
  };
}

export function separateSquadLeader(
  members: RuntimePlayer[],
  playtimes: Record<string, any> = {},
): [SquadLeaderRowViewModel | null, PlayerRowViewModel[]] {
  const leader = members.find((m) => m.isLeader);
  const others = members.filter((m) => !m.isLeader);

  const leaderVm = leader
    ? (adaptPlayerRow(
        leader,
        extractPlaytimeHours(leader.steamID, playtimes),
      ) as SquadLeaderRowViewModel)
    : null;

  const memberVms = others.map((m) =>
    adaptPlayerRow(m, extractPlaytimeHours(m.steamID, playtimes)),
  );

  return [leaderVm, memberVms];
}

export function extractPlaytimeHours(
  steamId: string | null | undefined,
  playtimes: Record<string, any>,
): number | null {
  if (!steamId) return null;
  const playtime = playtimes[steamId];
  if (!playtime) return null;
  const seconds = Number(playtime.gameSeconds ?? 0);
  if (!Number.isFinite(seconds)) return null;
  if (seconds === 0) return 0;
  if (seconds < 0) return null;
  return Math.round((seconds / 3600) * 10) / 10;
}

export function adaptSquad(
  squad: RuntimeSquad,
  members: RuntimePlayer[] = [],
  playtimes: Record<string, any> = {},
  lifecycleByKey: Record<string, SquadLifecycleViewModel> = {},
): SquadViewModel {
  const [leader, otherMembers] = separateSquadLeader(members, playtimes);
  const playtimeSummary = buildPlaytimeSummary(collectSquadPlayers(leader, otherMembers));
  const lifecycle =
    lifecycleByKey[buildSquadLifecycleLookupKey(squad.teamID, squad.squadID, squad.generation)]
    ?? lifecycleByKey[buildSquadLifecycleLookupKey(squad.teamID, squad.squadID)]
    ?? {};

  const warnings: SquadWarning[] = [];
  if (members.length > 0 && !leader) {
    warnings.push({
      type: "no_leader",
      message: "No squad leader",
    });
  }

  const state =
    members.length === 0
      ? "empty"
      : !leader
        ? "no_leader"
        : "normal";

  return {
    squadId: squad.squadID ?? null,
    generation: squad.generation ?? lifecycle.generation ?? null,
    squadName: squad.squadName || squad.name || `Squad ${squad.squadID ?? "?"}`,
    teamId: squad.teamID ?? null,
    creatorName: squad.creatorName || "Unknown Creator",
    createdAt: lifecycle.createdAt ?? squad.createdAt ?? null,
    createdAtMs: lifecycle.createdAtMs ?? squad.createdAtMs ?? null,
    createdAtLabel: lifecycle.createdAtLabel ?? squad.createdAtLabel ?? "",
    createdDisplayText: lifecycle.createdDisplayText ?? squad.createdDisplayText ?? "",
    creationSource: lifecycle.creationSource ?? squad.creationSource ?? "",
    creationConfidence: lifecycle.creationConfidence ?? squad.creationConfidence ?? "",
    sourceLabel: lifecycle.sourceLabel ?? squad.sourceLabel ?? "",
    isLocked: Boolean(squad.locked),
    memberCount: members.length,
    maxMembers: squad.size ?? 9,
    averagePlaytimeHours: playtimeSummary.averagePlaytimeHours,
    publicPlaytimePlayers: playtimeSummary.publicPlaytimePlayers,
    privatePlaytimePlayers: playtimeSummary.privatePlaytimePlayers,
    knownPlaytimePlayers: playtimeSummary.knownPlaytimePlayers,
    leader,
    members: otherMembers,
    warnings,
    state,
  };
}

export function adaptTeam(
  runtimeTeam: RuntimeTeam,
  playtimes: Record<string, any> = {},
  lifecycleByKey: Record<string, SquadLifecycleViewModel> = {},
): TeamViewModel {
  const squads = runtimeTeam.squads.map((squad) =>
    adaptSquad(squad, squad.members ?? [], playtimes, lifecycleByKey),
  );

  if (runtimeTeam.unassignedPlayers.length > 0) {
    squads.push(
      adaptSquad(
        {
          key: `${runtimeTeam.teamID}:unassigned`,
          teamID: runtimeTeam.teamID,
          squadID: null,
          squadName: "Unassigned",
          name: "Unassigned",
          locked: false,
          creatorName: "",
        },
        runtimeTeam.unassignedPlayers,
        playtimes,
        lifecycleByKey,
      ),
    );
  }

  const teamPlayers = squads.flatMap((squad) => collectSquadPlayers(squad.leader, squad.members));
  const playtimeSummary = buildPlaytimeSummary(teamPlayers);

  return {
    teamId: runtimeTeam.teamID,
    teamName: runtimeTeam.teamName,
    teamColorType: runtimeTeam.teamID === 1 ? "team1" : "team2",
    playerCount: runtimeTeam.playerCount,
    maxPlayers: 50,
    averagePlaytimeHours: playtimeSummary.averagePlaytimeHours,
    publicPlaytimePlayers: playtimeSummary.publicPlaytimePlayers,
    privatePlaytimePlayers: playtimeSummary.privatePlaytimePlayers,
    knownPlaytimePlayers: playtimeSummary.knownPlaytimePlayers,
    squads,
  };
}

export interface SquadLifecycleViewModel {
  key: string;
  serverId: string;
  matchId: string | null;
  teamId: number | null;
  squadId: number | null;
  generation?: number | null;
  squadName: string;
  createdAt?: string | null;
  createdAtMs?: number | null;
  createdAtLabel?: string;
  createdDisplayText?: string;
  creationSource?: string;
  creationConfidence?: string;
  sourceLabel?: string;
}

export function buildSquadLifecycleLookup(current: any): Record<string, SquadLifecycleViewModel> {
  const lookup: Record<string, SquadLifecycleViewModel> = {};
  const list = Array.isArray(current?.list) ? current.list : [];
  const latestBySlot: Record<string, SquadLifecycleViewModel> = {};

  for (const item of list) {
    const teamId = item?.teamId ?? item?.teamID ?? null;
    const squadId = item?.squadId ?? item?.squadID ?? null;
    if (teamId == null || squadId == null) continue;
    const generation = normalizeGeneration(item?.generation);

    const slotKey = buildSquadLifecycleLookupKey(teamId, squadId);
    const recordKey = String(item.key ?? buildSquadLifecycleLookupKey(teamId, squadId, generation) ?? slotKey);
    const record: SquadLifecycleViewModel = {
      key: recordKey,
      serverId: String(item.serverId ?? ""),
      matchId: item.matchId ?? null,
      teamId,
      squadId,
      generation,
      squadName: String(item.squadName ?? "").trim(),
      createdAt: item.createdAt ?? null,
      createdAtMs: Number(item.createdAtMs ?? 0) || null,
      createdAtLabel: String(item.createdAtLabel ?? ""),
      createdDisplayText: String(item.createdDisplayText ?? ""),
      creationSource: String(item.creationSource ?? ""),
      creationConfidence: String(item.creationConfidence ?? ""),
      sourceLabel: String(item.sourceLabel ?? ""),
    };

    if (generation != null) {
      lookup[buildSquadLifecycleLookupKey(teamId, squadId, generation)] = record;
    }

    const currentLatest = latestBySlot[slotKey];
    if (!currentLatest || compareLifecycleRecords(record, currentLatest) >= 0) {
      latestBySlot[slotKey] = record;
    }
  }

  Object.assign(lookup, latestBySlot);
  return lookup;
}

export function buildSquadLifecycleLookupKey(
  teamId: number | string | null | undefined,
  squadId: number | string | null | undefined,
  generation: number | string | null | undefined = null,
) {
  const slotKey = `${String(teamId ?? "")}:${String(squadId ?? "")}`;
  const normalizedGeneration = normalizeGeneration(generation);
  return normalizedGeneration == null ? slotKey : `${slotKey}:G${normalizedGeneration}`;
}

export function adaptPlayerDetail(
  player: RuntimePlayer,
  playtimeHours: number | null = null,
): PlayerDetailViewModel {
  const currentIp = (player as any).current_ip || (player as any).ip || null;
  const steam64 = normalizeSteam64(player.steamID ?? (player as any).steamId ?? (player as any).steam64 ?? (player as any).steam64ID);
  return {
    playerId: player.playerID ?? null,
    name: player.name || "Unknown",
    role: player.role || "Unknown Role",
    isLeader: Boolean(player.isLeader),
    isOnline: Boolean(player.online),
    teamId: player.teamID ?? null,
    squadId: player.squadID ?? null,
    steamId: player.steamID ?? null,
    steam64,
    eosId: player.eosID ?? null,
    ip: currentIp,
    lastIp: null,
    resolvedIp: currentIp,
    ipSource: currentIp ? "current" : "none",
    ipLookupLoading: false,
    playtimeHours,
    source: (player as any).source || "unknown",
    controller: (player as any).controllerID || (player as any).controller || "",
    raw: player,
  };
}

export function adaptMatchHeader(
  server: Record<string, any>,
  runtimeState: any,
  matchStore: any,
  matchSnapshot: any = null,
): MatchHeaderData {
  const snapshot = server.snapshot ?? server ?? {};
  const backendServerStatus = matchSnapshot?.serverStatus ?? {};
  const backendMatch = matchSnapshot?.match ?? {};
  const backendPlayers = matchSnapshot?.players ?? {};
  const backendSquads = matchSnapshot?.squads ?? {};
  const team1 = matchStore.team1Players?.length ?? 0;
  const team2 = matchStore.team2Players?.length ?? 0;
  const serverStatusUpdatedAt = toTimestamp(backendServerStatus.lastUpdatedAt);
  const playersUpdatedAt = toTimestamp(backendPlayers.lastUpdatedAt);
  const squadsUpdatedAt = toTimestamp(backendSquads.lastUpdatedAt);
  const runtimeUpdatedAt = Number(server.updatedAt ?? 0);
  const lastUpdateTime = Math.max(serverStatusUpdatedAt, playersUpdatedAt, squadsUpdatedAt, runtimeUpdatedAt);
  const tps = firstPositiveNumber(
    backendServerStatus.tps,
    snapshot.tps,
    snapshot.webStatus?.tps,
  );

  return {
    serverName: firstDisplayValue(
      backendServerStatus.serverName,
      backendServerStatus.name,
      snapshot.serverName,
      snapshot.name,
      snapshot.webStatus?.serverName,
      "BZSS Panel",
    ) ?? "BZSS Panel",
    mapName: firstDisplayValue(
      backendServerStatus.mapName,
      backendServerStatus.map,
      snapshot.mapName,
      snapshot.map,
      snapshot.layerName,
      snapshot.layer,
      snapshot.webStatus?.mapName,
      snapshot.webStatus?.map,
      backendMatch.map,
      "Unknown Map",
    ) ?? "Unknown Map",
    currentLayer: firstDisplayValue(
      backendServerStatus.currentLayer,
      backendServerStatus.layer,
      snapshot.currentLayer,
      snapshot.layer,
      snapshot.webStatus?.currentLayer,
      snapshot.webStatus?.layer,
      backendMatch.layer,
      "Unknown Layer",
    ) ?? "Unknown Layer",
    currentMode: deriveMatchMode(
      backendServerStatus.gameMode,
      backendServerStatus.mode,
      snapshot.gameMode,
      snapshot.mode,
      snapshot.webStatus?.gameMode,
      snapshot.webStatus?.mode,
      backendMatch.mode,
      backendServerStatus.currentLayer,
      backendServerStatus.layer,
      snapshot.currentLayer,
      snapshot.layer,
      backendMatch.layer,
    ),
    nextLayer: firstDisplayValue(
      backendServerStatus.nextLayer,
      snapshot.nextLayer,
      snapshot.webStatus?.nextLayer,
      backendMatch.nextLayer,
      "Unknown Layer",
    ) ?? "Unknown Layer",
    queueCount: firstFiniteNumber(
      backendServerStatus.queueCount,
      snapshot.queueCount,
      snapshot.webStatus?.queueCount,
    ) ?? 0,
    gameMode: firstDisplayValue(
      backendServerStatus.gameMode,
      backendServerStatus.mode,
      snapshot.gameMode,
      snapshot.mode,
      snapshot.webStatus?.gameMode,
      snapshot.webStatus?.mode,
      backendMatch.mode,
      "Unknown",
    ) ?? "Unknown",
    totalPlayers: team1 + team2,
    maxPlayers: firstFiniteNumber(
      backendServerStatus.maxPlayers,
      snapshot.maxPlayers,
      snapshot.webStatus?.maxPlayers,
    ) ?? 100,
    team1Count: team1,
    team2Count: team2,
    matchTimeSeconds: firstFiniteNumber(
      backendServerStatus.playtime,
      backendServerStatus.matchTimeSeconds,
      snapshot.playtime,
      snapshot.matchTimeSeconds,
      backendMatch.playtime,
    ) ?? 0,
    tps,
    rconStatus: (matchSnapshot?.rconStatus?.status ?? snapshot.webStatus?.rcon ?? snapshot.rconStatus ?? "unknown") as any,
    logsStatus: runtimeState?.lastError ? "stale" : "live",
    lastUpdateTime,
    serverStatusUpdatedAt,
    playersUpdatedAt,
    squadsUpdatedAt,
  };
}

export function filterSquadsBySearch(
  squads: SquadViewModel[],
  query: string,
  options: { forceKeepAllSquads?: boolean } = {},
): SquadViewModel[] {
  const terms = normalizeSearchTerms(query);
  if (!terms.length) return squads;

  return squads.flatMap((squad) => {
    if (options.forceKeepAllSquads) {
      return [squad];
    }

    const squadMatched = isSquadMetaMatch(squad, terms);
    const leaderMatched = squad.leader ? isPlayerMatch(squad.leader, terms) : false;
    const matchedMembers = squad.members.filter((member) => isPlayerMatch(member, terms));

    if (!squadMatched && !leaderMatched && matchedMembers.length === 0) {
      return [];
    }

    if (squadMatched) {
      return [squad];
    }

    const filteredSquad = {
      ...squad,
      leader: leaderMatched ? squad.leader : null,
      members: matchedMembers,
      state: leaderMatched || matchedMembers.length > 0 ? "normal" : squad.state,
    };
    const summary = buildPlaytimeSummary(collectSquadPlayers(filteredSquad.leader, filteredSquad.members));

    return [{
      ...filteredSquad,
      averagePlaytimeHours: summary.averagePlaytimeHours,
      publicPlaytimePlayers: summary.publicPlaytimePlayers,
      privatePlaytimePlayers: summary.privatePlaytimePlayers,
      knownPlaytimePlayers: summary.knownPlaytimePlayers,
    }];
  });
}

export function filterTeamsBySearch(
  teams: TeamViewModel[],
  query: string,
): TeamViewModel[] {
  const terms = normalizeSearchTerms(query);
  if (!terms.length) return teams;

  return teams.flatMap((team) => {
    const teamText = compactSearchText([
      team.teamId,
      team.teamName,
      team.teamColorType,
      team.playerCount,
      team.maxPlayers,
    ]);

    const teamMetaMatched = includesAllTerms(teamText, terms);
    const squads = filterSquadsBySearch(team.squads, query, {
      forceKeepAllSquads: teamMetaMatched,
    });

    const teamPlayers = squads.flatMap((squad) => collectSquadPlayers(squad.leader, squad.members));
    const playtimeSummary = buildPlaytimeSummary(teamPlayers);
    const visiblePlayers = squads.reduce((sum, squad) => {
      return sum + (squad.leader ? 1 : 0) + squad.members.length;
    }, 0);

    if (!teamMetaMatched && visiblePlayers === 0) {
      return [];
    }

    return [{
      ...team,
      playerCount: teamMetaMatched ? team.playerCount : visiblePlayers,
      averagePlaytimeHours: playtimeSummary.averagePlaytimeHours,
      publicPlaytimePlayers: playtimeSummary.publicPlaytimePlayers,
      privatePlaytimePlayers: playtimeSummary.privatePlaytimePlayers,
      knownPlaytimePlayers: playtimeSummary.knownPlaytimePlayers,
      squads,
    }];
  });
}

function normalizeSearchTerms(query: string): string[] {
  return String(query ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function includesAllTerms(haystack: string, terms: string[]): boolean {
  const text = haystack.toLowerCase();
  return terms.every((term) => text.includes(term));
}

function compactSearchText(parts: unknown[]): string {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isSquadMetaMatch(squad: SquadViewModel, terms: string[]): boolean {
  const text = compactSearchText([
    squad.squadId,
    squad.squadName,
    squad.teamId,
    squad.creatorName,
    squad.memberCount,
    squad.maxMembers,
    squad.averagePlaytimeHours,
    squad.publicPlaytimePlayers,
    squad.privatePlaytimePlayers,
    squad.isLocked ? "locked 锁定 已锁" : "open unlocked 未锁 开放",
    squad.state,
    squad.state === "empty" ? "empty 空 无成员" : "",
    squad.state === "no_leader" ? "no_leader no leader 无队长 没队长" : "",
  ]);

  return includesAllTerms(text, terms);
}

function isPlayerMatch(player: PlayerRowViewModel, terms: string[]): boolean {
  const text = compactSearchText([
    player.playerId,
    player.name,
    player.role,
    player.isLeader ? "leader squadleader sl 队长 小队长" : "member 队员",
    player.isOnline ? "online 在线" : "offline 离线",
    player.teamId,
    player.squadId,
    player.steamId,
    player.eosId,
    player.ip,
    player.playtimeHours,
    player.playtimeHours === 0 ? "未公开 private hidden 0" : "",
  ]);

  return includesAllTerms(text, terms);
}

function collectSquadPlayers(
  leader: SquadLeaderRowViewModel | null,
  members: PlayerRowViewModel[],
): PlayerRowViewModel[] {
  return [
    ...(leader ? [leader] : []),
    ...members,
  ];
}

function buildPlaytimeSummary(players: PlayerRowViewModel[]) {
  const known = players.filter((player) => player.playtimeHours != null);
  const publicPlayers = known.filter((player) => Number(player.playtimeHours) > 0);
  const privatePlayers = known.filter((player) => Number(player.playtimeHours) === 0);

  const totalHours = publicPlayers.reduce((sum, player) => {
    return sum + Number(player.playtimeHours ?? 0);
  }, 0);

  const average = publicPlayers.length > 0
    ? Math.round((totalHours / publicPlayers.length) * 10) / 10
    : null;

  return {
    averagePlaytimeHours: average,
    publicPlaytimePlayers: publicPlayers.length,
    privatePlaytimePlayers: privatePlayers.length,
    knownPlaytimePlayers: known.length,
  };
}

function toTimestamp(value: string | number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value) return 0;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstPositiveNumber(...values: unknown[]) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function firstDisplayValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) continue;
      if (text === "Unknown" || text === "Unknown Server" || text === "Unknown Map" || text === "Unknown Layer") continue;
      return text;
    }
    if (value !== undefined && value !== null) {
      return String(value);
    }
  }
  return undefined;
}

function firstFiniteNumber(...values: unknown[]) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function normalizeGeneration(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.trunc(number);
}

function compareLifecycleRecords(left: SquadLifecycleViewModel, right: SquadLifecycleViewModel) {
  const leftGeneration = Number(left.generation ?? 0);
  const rightGeneration = Number(right.generation ?? 0);
  if (leftGeneration !== rightGeneration) return leftGeneration - rightGeneration;

  const leftCreatedAtMs = Number(left.createdAtMs ?? 0);
  const rightCreatedAtMs = Number(right.createdAtMs ?? 0);
  if (leftCreatedAtMs !== rightCreatedAtMs) return leftCreatedAtMs - rightCreatedAtMs;

  return String(left.key ?? "").localeCompare(String(right.key ?? ""));
}

function normalizeSteam64(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^\d{17}$/.test(text) ? text : "";
}

function deriveMatchMode(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) continue;
      if (isKnownModeLabel(text)) return text.toUpperCase();

      const derived = deriveModeFromLayer(text);
      if (derived) return derived;
    }
  }
  return "Unknown";
}

function isKnownModeLabel(value: string): boolean {
  return /^(?:AAS|RAAS|INS|POV|TT|TC|INV|RAID|SKIRMISH|CONQUEST|SEED|PVP|PVE)$/i.test(value);
}

function deriveModeFromLayer(layer: string): string {
  const text = String(layer ?? "").trim();
  if (!text) return "";

  const tokens = text.split(/[_\s-]+/).filter(Boolean);
  if (tokens.length < 2) return "";

  const lastToken = tokens[tokens.length - 1];
  const modeToken = /^(?:v?\d+|pve|pvp|seed)$/i.test(lastToken) ? tokens[tokens.length - 2] : lastToken;
  if (!modeToken) return "";

  const mode = String(modeToken).trim();
  return isKnownModeLabel(mode) ? mode.toUpperCase() : (/^[A-Za-z]+$/.test(mode) ? mode.toUpperCase() : "");
}
