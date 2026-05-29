import { apiPost } from "./apiClient";

export interface TeamBalanceSwitchResponse {
  ok: boolean;
  type: string;
  action: string;
  serverId: string;
  source: string;
  operatorName: string;
  system: boolean;
  target: {
    playerId?: number | null;
    playerKey?: string;
    steamId?: string;
    eosId?: string;
    name?: string;
    anyId?: string;
  } | null;
  reason: string;
  error: string;
  message: string;
  command: string;
  rconExecuted: boolean;
  rconResponse: string;
  record?: Record<string, unknown> | null;
}

export function requestSwitchTeam(payload: {
  serverId?: string;
  playerId?: number | string | null;
  playerKey?: string;
  anyId?: string;
  steamId?: string;
  eosId?: string;
  name?: string;
  source?: string;
  operatorName?: string;
  reason?: string;
  system?: boolean;
  matchId?: string;
}) {
  return apiPost<TeamBalanceSwitchResponse>("/api/team-balance/switch", payload);
}
