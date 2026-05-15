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

export interface TeamBalancePlayer {
  playerID: number | null;
  name: string;
  steamID?: string;
  eosID?: string;
  teamID: number | null;
  squadID: number | null;
  online: boolean;
}

export interface TeamBalanceContainer {
  id: string;
  name: string;
  targetTeam: 1 | 2 | null;
  locked: boolean;
  players: TeamBalancePlayer[];
}

export interface TeamBalancePlanContainer {
  containerId: string;
  name: string;
  size: number;
  targetTeam: 1 | 2;
  locked?: boolean;
  playerIDs: number[];
}

export interface TeamBalancePlan {
  id: string;
  mode: "groupTogether" | "balanceOnly" | "singleContainer" | "manualTargets";
  execute: boolean;
  containers: TeamBalancePlanContainer[];
  totals: {
    team1: number;
    team2: number;
  };
  createdAt: string;
}

export interface TeamBalanceExecutionItem {
  playerID: number | null;
  name: string;
  fromTeam: number;
  targetTeam: number;
  action: "switch" | "skip";
  success: boolean;
  message: string;
  rconExecuted?: boolean;
  rconResponse?: string;
}

export interface TeamBalanceExecution {
  planId: string;
  executedAt: string;
  totalPlayers: number;
  switched: number;
  skipped: number;
  failed: number;
  results: TeamBalanceExecutionItem[];
}

export interface TeamBalanceState {
  containers: TeamBalanceContainer[];
  lastPlan: TeamBalancePlan | null;
  lastExecution: TeamBalanceExecution | null;
  updatedAt: string;
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

export function getTeamBalanceState() {
  return apiGet<{ ok: boolean; state: TeamBalanceState }>("/api/team-balance/state");
}

export function setTeamBalanceContainers(containers: TeamBalanceContainer[]) {
  return apiPost<{ ok: boolean; state: TeamBalanceState }>("/api/team-balance/containers", {
    containers,
  });
}

export function runTeamBalanceOnly() {
  return apiPost<{ ok: boolean; plan: TeamBalancePlan; state: TeamBalanceState }>("/api/team-balance/balance-only", {});
}

export function runTeamGroupTogether() {
  return apiPost<{ ok: boolean; plan: TeamBalancePlan; result: TeamBalanceExecution; state: TeamBalanceState }>(
    "/api/team-balance/group-together",
    {},
  );
}

export function executeCurrentTeamBalancePlan(planId?: string | null) {
  return apiPost<{ ok: boolean; result: TeamBalanceExecution; state: TeamBalanceState }>("/api/team-balance/execute-plan", {
    planId: planId ?? null,
  });
}

export function balanceTeamContainer(containerId: string, targetTeam?: 1 | 2 | null) {
  return apiPost<{ ok: boolean; container: TeamBalanceContainer; plan: TeamBalancePlan; state: TeamBalanceState }>(
    `/api/team-balance/container/${encodeURIComponent(containerId)}/balance`,
    { targetTeam: targetTeam ?? null },
  );
}

export function executeTeamContainer(containerId: string) {
  return apiPost<{ ok: boolean; result: TeamBalanceExecution; state: TeamBalanceState }>(
    `/api/team-balance/container/${encodeURIComponent(containerId)}/execute`,
    {},
  );
}
