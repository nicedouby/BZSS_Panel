import { apiGet, apiPost } from "./apiClient";

export interface TeamBalanceTarget {
  playerId?: string | number | null;
  name?: string | null;
  steamId?: string | null;
  eosId?: string | null;
  teamId?: number | null;
  squadId?: number | null;
}

export interface TeamBalanceTbObject {
  type: "switch-team";
  serverId?: string;
  source: string;
  reason?: string;
  target: TeamBalanceTarget;
}

export interface TeamBalanceExecuteResponse {
  ok: boolean;
  result?: any;
  error?: string;
  message?: string;
}

export interface TeamBalanceStatusResponse {
  ok: boolean;
  status: {
    enabled: boolean;
    permission: string;
    commandTemplate: string;
    historySize: number;
  };
  viewer: {
    username: string;
    role: string;
    isSuperAdmin: boolean;
    canUseTb: boolean;
    permissions: string[];
  };
}

export function getTeamBalanceStatus() {
  return apiGet<TeamBalanceStatusResponse>("/api/team-balance/status");
}

export function executeTeamBalance(tb: TeamBalanceTbObject) {
  return apiPost<TeamBalanceExecuteResponse>("/api/team-balance/execute", {
    tb,
  });
}
