import { apiGet, apiPost } from "./apiClient";
import type {
  SquadManagementActionResponse,
  SquadManagementActionType,
  SquadManagementCreator,
  SquadManagementRecord,
  SquadManagementRecordSummary,
  SquadManagementSquad,
  SquadManagementViewer,
} from "./squadManagementApi";

export interface FairSquadBuildingPluginState {
  id: string;
  apiName: string;
  route: string;
  enabled: boolean;
  subscribed: boolean;
  active: boolean;
  dependencyAvailable: boolean;
}

export interface FairSquadBuildingPolicy {
  enforcementEnabled: boolean;
  window: string;
  logClockSeconds: number | null;
  noBuildUntilSeconds: number;
  infantryOnlyUntilSeconds: number;
  kickThreshold: number;
  allowedInfantryNames: string[];
}

export interface FairSquadBuildingCreator extends SquadManagementCreator {
  threshold: number;
  overThreshold: boolean;
  excessCount: number;
}

export interface FairSquadBuildingViolation {
  id: string;
  kind: "no_build" | "infantry_only" | "creator_threshold";
  title: string;
  reason: string;
  teamId: number | null;
  squadId: number | null;
  squadName: string;
  creatorName: string;
  creatorKey: string;
  steamId: string;
  eosId: string;
  createdLogSeconds: number | null;
  threshold: number | null;
  squad: SquadManagementSquad | null;
  creator: FairSquadBuildingCreator | null;
}

export interface FairSquadBuildingSummary {
  currentSquads: number;
  trackedCreations: number;
  violations: number;
  creatorsOverThreshold: number;
}

export interface FairSquadBuildingPageState {
  plugin: FairSquadBuildingPluginState;
  serverId: string;
  viewer: SquadManagementViewer;
  policy: FairSquadBuildingPolicy;
  summary: FairSquadBuildingSummary;
  currentMatchId: string;
  squads: SquadManagementSquad[];
  violations: FairSquadBuildingViolation[];
  creators: FairSquadBuildingCreator[];
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

export interface FairSquadBuildingStateResponse {
  ok: boolean;
  data: FairSquadBuildingPageState;
}

export interface FairSquadBuildingRecordsResponse {
  ok: boolean;
  kind: string;
  limit: number;
  offset: number;
  total: number;
  summary: SquadManagementRecordSummary;
  records: SquadManagementRecord[];
}

export function getFairSquadBuildingState(serverId?: string) {
  const search = new URLSearchParams();
  if (serverId) search.set("serverId", String(serverId));
  const query = search.toString();
  return apiGet<FairSquadBuildingStateResponse>(`/api/plugins/fair-squad-building/state${query ? `?${query}` : ""}`);
}

export function getFairSquadBuildingRecords(params: {
  serverId?: string;
  matchId?: string;
  kind?: string;
  limit?: number | string;
  offset?: number | string;
} = {}) {
  const search = new URLSearchParams();
  if (params.serverId) search.set("serverId", String(params.serverId));
  if (params.matchId) search.set("matchId", String(params.matchId));
  if (params.kind && params.kind !== "all") search.set("kind", String(params.kind));
  if (params.limit != null) search.set("limit", String(params.limit));
  if (params.offset != null) search.set("offset", String(params.offset));
  const query = search.toString();
  return apiGet<FairSquadBuildingRecordsResponse>(`/api/plugins/fair-squad-building/records${query ? `?${query}` : ""}`);
}

export function executeFairSquadBuildingAction(payload: {
  type: SquadManagementActionType;
  serverId?: string;
  teamId?: number | null;
  squadId?: number | null;
  playerId?: string | number | null;
  playerKey?: string;
  steamId?: string;
  eosId?: string;
  name?: string;
  anyId?: string;
  reason?: string;
  source?: string;
}) {
  return apiPost<SquadManagementActionResponse>("/api/plugins/fair-squad-building/actions", payload);
}
