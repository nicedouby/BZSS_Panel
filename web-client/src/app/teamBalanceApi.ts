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
