import { apiPost } from "./apiClient";

export interface TeamBalanceForceTeamChangeResponse {
  ok: boolean;
  type: string;
  action: string;
  steamId: string;
  playerName: string;
  source: string;
  reason: string;
  operator: {
    id?: string;
    name?: string;
    username?: string;
    role?: string;
    isSuperAdmin?: boolean;
    permissions?: string[];
  } | null;
  system: boolean;
  error: string;
  message: string;
  command: string;
  rconExecuted: boolean;
  rconResponse: string;
}

export type TeamBalanceSwitchResponse = TeamBalanceForceTeamChangeResponse;

export interface TeamShufflePlanPlayer {
  playerId?: string | number | null;
  steamId?: string | null;
  eosId?: string | null;
  playerName: string;
  role?: string | null;
  squadId?: number | null;
  fromTeamId: number;
  targetTeamId: number;
  playtimeSeconds: number | null;
  playtimeHours: number | null;
  hasKnownPlaytime: boolean;
  switchRequired: boolean;
  online: boolean;
}

export interface TeamShufflePlanSummaryTeam {
  teamId: number;
  playerCount: number;
  knownPlaytimePlayers: number;
  unknownPlaytimePlayers: number;
  totalPlaytimeSeconds: number;
  averagePlaytimeHours: number | null;
}

export interface TeamShufflePlanResponse {
  ok: boolean;
  type: string;
  action: string;
  source: string;
  reason: string;
  operator: TeamBalanceForceTeamChangeResponse["operator"];
  system: boolean;
  error: string;
  message: string;
  command: string;
  rconExecuted: boolean;
  rconResponse: string;
  summary: {
    totalPlayers: number;
    plannedMoveCount: number;
    knownPlaytimePlayers: number;
    unknownPlaytimePlayers: number;
    averageDeltaHours: number | null;
    before: {
      team1: TeamShufflePlanSummaryTeam;
      team2: TeamShufflePlanSummaryTeam;
    };
    after: {
      team1: TeamShufflePlanSummaryTeam;
      team2: TeamShufflePlanSummaryTeam;
    };
  } | null;
  plan: {
    generatedAt: string;
    mode: string;
    players: TeamShufflePlanPlayer[];
    moves: TeamShufflePlanPlayer[];
  } | null;
}

export function forceTeamChange(payload: {
  steamId?: string;
  playerName?: string;
  source?: string;
  reason?: string;
  operator?: TeamBalanceForceTeamChangeResponse["operator"];
  anyId?: string;
  playerKey?: string;
  playerId?: string | number | null;
  eosId?: string;
  name?: string;
}) {
  return apiPost<TeamBalanceForceTeamChangeResponse>("/api/tb/force-team-change", payload);
}

export function requestSwitchTeam(payload: {
  steamId?: string;
  playerName?: string;
  source?: string;
  reason?: string;
  operator?: TeamBalanceForceTeamChangeResponse["operator"];
  anyId?: string;
  playerKey?: string;
  playerId?: string | number | null;
  eosId?: string;
  name?: string;
}) {
  return forceTeamChange(payload);
}

export function createPlaytimeShufflePlan(payload: {
  source?: string;
  reason?: string;
  players: Array<{
    playerId?: string | number | null;
    steamId?: string | null;
    eosId?: string | null;
    playerName?: string;
    name?: string;
    role?: string | null;
    squadId?: number | null;
    teamId: number;
    online?: boolean;
    playtimeSeconds?: number | null;
  }>;
}) {
  return apiPost<TeamShufflePlanResponse>("/api/tb/shuffle-plan", payload);
}
