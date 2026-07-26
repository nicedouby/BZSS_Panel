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
  groupId?: string | null;
  groupName?: string | null;
  groupColor?: string | null;
  anchorPlayerKey?: string | null;
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
  algorithm?: string;
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
    groups?: Array<{
      id: string;
      name: string;
      color?: string | null;
      anchorPlayerKey: string;
      memberCount: number;
    }>;
  } | null;
}

export interface TeamShuffleExecuteResponse {
  ok: boolean;
  type: string;
  action: string;
  source: string;
  reason: string;
  operator: TeamBalanceForceTeamChangeResponse["operator"];
  system: boolean;
  algorithm?: string;
  error: string;
  message: string;
  rconExecuted: boolean;
  summary: {
    plannedMoveCount: number;
    executedCount: number;
    failedCount: number;
  } | null;
  plan: {
    generatedAt: string;
    mode: string;
    moves: Array<{
      playerId?: string | number | null;
      steamId?: string | null;
      eosId?: string | null;
      playerName?: string | null;
      fromTeamId?: number;
      targetTeamId?: number;
      ok?: boolean;
      error?: string;
      message?: string;
      command?: string;
      rconResponse?: string;
    }>;
    executed?: unknown[];
    failed?: unknown[];
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
  algorithm?: string;
  mode?: string;
  groups?: Array<{
    id?: string;
    name?: string;
    color?: string | null;
    anchorPlayerKey?: string;
    members?: Array<{
      playerKey?: string;
      steamId?: string | null;
      eosId?: string | null;
    }>;
  }>;
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

export function executeTeamShufflePlan(payload: {
  source?: string;
  reason?: string;
  algorithm?: string;
  mode?: string;
  players: Array<{
    playerId?: string | number | null;
    steamId?: string | null;
    eosId?: string | null;
    playerName?: string;
    name?: string;
    role?: string | null;
    squadId?: number | null;
    teamId: number;
    targetTeamId: number;
    online?: boolean;
    playtimeSeconds?: number | null;
  }>;
}) {
  return apiPost<TeamShuffleExecuteResponse>("/api/tb/shuffle-execute", payload);
}


export type TeamBalanceBatchItemStatus =
  | "queued"
  | "running"
  | "success"
  | "already_applied"
  | "skipped_offline"
  | "invalid_steam_id"
  | "permission_denied"
  | "rcon_failed"
  | "unknown_result"
  | "failed_state_unknown"
  | "cancelled";

export interface TeamBalanceBatchPlayer {
  playerId?: string | number | null;
  steamId: string;
  playerName?: string;
  fromTeamId: number;
  targetTeamId: number;
}

export interface TeamBalanceBatchResult extends TeamBalanceBatchPlayer {
  status: TeamBalanceBatchItemStatus;
  ok: boolean;
  message?: string;
  error?: string;
  command?: string;
  rconResponse?: string;
  completedAt?: string;
}

export interface TeamBalanceBatch {
  id: string;
  clientRequestId: string;
  status: "queued" | "running" | "completed" | "partial" | "cancelled";
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  currentPlayer?: { steamId?: string | null; playerName?: string | null } | null;
  cancelRequested?: boolean;
  players?: TeamBalanceBatchPlayer[];
  results?: TeamBalanceBatchResult[];
}

export interface TeamBalanceBatchResponse {
  ok: boolean;
  duplicate?: boolean;
  batch: TeamBalanceBatch;
}

export function createForceTeamChangeBatch(payload: {
  clientRequestId: string;
  source?: string;
  reason?: string;
  players: TeamBalanceBatchPlayer[];
}) {
  return apiPost<TeamBalanceBatchResponse>("/api/tb/force-team-change-batches", payload);
}

export function listForceTeamChangeBatches() {
  return apiGet<{ ok: boolean; batches: TeamBalanceBatch[] }>("/api/tb/force-team-change-batches");
}

export function getForceTeamChangeBatch(batchId: string) {
  return apiGet<{ ok: boolean; batch: TeamBalanceBatch }>(
    `/api/tb/force-team-change-batches/${encodeURIComponent(batchId)}`,
  );
}

export function cancelForceTeamChangeBatch(batchId: string) {
  return apiPost<{
    ok: boolean;
    status: string;
    completed?: number;
    remaining?: number;
    batch?: TeamBalanceBatch;
  }>(`/api/tb/force-team-change-batches/${encodeURIComponent(batchId)}/cancel`, {});
}
