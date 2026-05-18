import { apiGet, apiPost } from "./apiClient";

export interface SquadManagementViewer {
  username: string;
  role: string;
  isSuperAdmin: boolean;
  canDisband: boolean;
  canKick: boolean;
  permissions: string[];
}

export interface SquadManagementSquad {
  serverId: string;
  matchId: string;
  teamId: number | null;
  squadId: number | null;
  squadName: string;
  creatorName: string;
  creatorSteamId: string;
  creatorEosId: string;
  anyId: string;
  teamName: string;
  createdAtMs: number;
  createdAt: string;
  createdSeconds: number | null;
  creationSignature: string;
  creatorKey: string;
  allowedInfantry: boolean;
  violationType: string;
  violationReason: string;
  shouldDisband: boolean;
  currentCreatorCount: number;
  disbanded: boolean;
  recordKey?: string;
  creationSource?: string;
  creationConfidence?: string;
  raw?: string;
}

export interface SquadManagementCreator {
  creatorKey: string;
  count: number;
  creatorName: string;
  steamId: string;
  eosId: string;
  anyId: string;
  firstSeenAtMs: number;
  firstSeenAt: string;
  lastSeenAtMs: number;
  lastSeenAt: string;
  lastKickAt: string;
  lastKickResult: string;
  lastKickAttemptedCount: number;
  latestSquadName: string;
  lastActionAt: string;
}

export interface SquadManagementActionTarget {
  teamId?: number | null;
  squadId?: number | null;
  anyId?: string;
  creatorKey?: string;
  creatorName?: string;
  steamId?: string;
  eosId?: string;
  count?: number;
}

export interface SquadManagementActionResult {
  ok: boolean;
  action: string;
  source: string;
  system: boolean;
  target: SquadManagementActionTarget;
  reason: string;
  time: string;
  error?: string;
  message?: string;
  command?: string;
  rconExecuted?: boolean;
  rconResponse?: string;
}

export interface SquadManagementState {
  serverId: string;
  roundKey: string;
  roundStartedAtMs: number;
  roundStartedAt: string;
  logClockSeconds: number;
  logClockHasAnchor: boolean;
  logClockManual: boolean;
  logClockLastResetAt: string;
  logClockLastResetReason: string;
  isWarmup: boolean;
  activationPlayerThreshold: number;
  activationPopulation: number;
  activationPopulationSource: string;
  activationEnabled: boolean;
  window: "waiting" | "warmup" | "no-build" | "infantry-only" | "open";
  enforcementEnabled: boolean;
  disbandPermission: string;
  kickPermission: string;
  kickThreshold: number;
  noBuildUntilSeconds: number;
  infantryOnlyUntilSeconds: number;
  allowedInfantryNames: string[];
  defaultSquadNamePattern: string;
  currentMatchId: string;
  squads: SquadManagementSquad[];
  violations: SquadManagementSquad[];
  creators: SquadManagementCreator[];
  summary: {
    currentSquads: number;
    violations: number;
    creators: number;
    trackedCreations: number;
  };
  lastBootstrapAt: string;
  lastSweepAt: string;
  lastSweepReason: string;
  lastStateUpdatedAt: string;
  lastResetAt: string;
  lastResetReason: string;
  recentActions: Array<{
    time: string;
    action: string;
    source: string;
    ok: boolean;
    error: string;
    message: string;
    reason: string;
    command: string;
    system: boolean;
    target: Record<string, unknown> | null;
  }>;
}

export interface SquadManagementStateResponse {
  ok: boolean;
  state: SquadManagementState;
  viewer: SquadManagementViewer;
}

export interface SquadManagementActionResponse {
  ok: boolean;
  result: SquadManagementActionResult;
  state: SquadManagementState;
}

export interface SquadManagementRecord {
  id: number;
  recordKey: string;
  kind: "squad_created" | "disband" | "kick" | string;
  time: string;
  logTime: string;
  serverId: string;
  matchId: string;
  source: string;
  operatorName: string;
  teamId: number | null;
  squadId: number | null;
  squadName: string;
  creatorName: string;
  playerName: string;
  steamId: string;
  eosId: string;
  reason: string;
  result: string;
  error: string;
  command: string;
  payload: Record<string, unknown>;
}

export interface SquadManagementRecordSummary {
  total: number;
  created: number;
  disbanded: number;
  kicked: number;
  actions: number;
  success: number;
  failed: number;
  lastEventAt: string;
}

export interface SquadManagementRecordsResponse {
  ok: boolean;
  kind: string;
  limit: number;
  offset: number;
  total: number;
  summary: SquadManagementRecordSummary;
  records: SquadManagementRecord[];
  viewer: SquadManagementViewer;
  policy: {
    enforcementEnabled: boolean;
    disbandPermission: string;
    kickPermission: string;
    kickThreshold: number;
  };
}

export function getSquadManagementState() {
  return apiGet<SquadManagementStateResponse>("/api/squad-management/state");
}

export function disbandSquad(payload: {
  teamId?: number | null;
  squadId?: number | null;
  reason?: string;
}) {
  return apiPost<SquadManagementActionResponse>("/api/squad-management/disband", payload);
}

export function kickSquadCreator(payload: {
  anyId?: string;
  reason?: string;
  creatorKey?: string;
  creatorName?: string;
  steamId?: string;
  eosId?: string;
  count?: number;
}) {
  return apiPost<SquadManagementActionResponse>("/api/squad-management/kick", payload);
}

export function getSquadManagementRecords(params: {
  kind?: string;
  limit?: number | string;
  offset?: number | string;
} = {}) {
  const search = new URLSearchParams();
  if (params.kind && params.kind !== "all") search.set("kind", String(params.kind));
  if (params.limit != null) search.set("limit", String(params.limit));
  if (params.offset != null) search.set("offset", String(params.offset));
  const query = search.toString();
  return apiGet<SquadManagementRecordsResponse>(`/api/squad-management/records${query ? `?${query}` : ""}`);
}
