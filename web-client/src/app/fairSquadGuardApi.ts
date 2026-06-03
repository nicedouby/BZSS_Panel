import { apiGet, apiPost } from "./apiClient";

export interface FairSquadGuardRecord {
  id: string;
  serverId: string;
  matchId: string;
  teamId: number | null;
  squadId: number | null;
  squadName: string;
  creatorName: string;
  creatorSteamId: string;
  creatorEosId: string;
  creationSource: string;
  creationConfidence: string;
  phase: string;
  phaseLabel: string;
  approved: boolean;
  violation: boolean;
  reasons: string[];
  actions: Array<{ type: string; reason?: string; error?: string; count?: number }>;
  clockSeconds: number;
  population: number;
  active?: boolean;
  resolvedAt?: string;
  inferredLeader?: { name?: string; steamId?: string; eosId?: string };
  createdAt: string;
  updatedAt: string;
}

export interface FairSquadGuardStatus {
  enabled: boolean;
  subscribed: boolean;
  active: boolean;
  serverId: string;
  settings: {
    enforcementPlayerThreshold: number;
    noSquadCreationSeconds: number;
    infantryOnlyUntilSeconds: number;
    maxViolationCountBeforeKick: number;
    allowedInfantryNames: string[];
    allowedInfantryPatterns: string[];
    defaultInfantryPatterns: string[];
    disbandCommandNameSuffix: string;
  };
  population: { count: number; source: string };
  clock: {
    seconds: number;
    hasAnchor: boolean;
    manual: boolean;
    trusted: boolean;
    reason: string;
    anchorLogTime: string;
    lastResetAt: string;
  };
  phase: { phase: string; label: string };
  session: {
    midRoundLocked: boolean;
    midRoundLockReason: string;
    midRoundLockedAt: string;
    manualUnlockAt: string;
    manualUnlockBy: string;
    lastResetAt: string;
    lastResetReason: string;
  };
  summary: {
    total: number;
    approved: number;
    violations: number;
    warned: number;
    disbanded: number;
    kicked: number;
  };
  recentRecords: FairSquadGuardRecord[];
  currentViolatingSquads: FairSquadGuardRecord[];
  leaderboard: Array<{
    key: string;
    name: string;
    steamId: string;
    eosId: string;
    violations: number;
    kicked: boolean;
    kickedAt: string;
    lastSquadName: string;
    lastViolationAt: string;
  }>;
  pendingLogCount: number;
  seenSlotCount: number;
  recovery: { lastRecoveredAt: string; recoveredLineCount: number };
  dataDir: string;
  lastRecordAt: string;
}

export interface FairSquadGuardRecordsResponse {
  total: number;
  limit: number;
  offset: number;
  records: FairSquadGuardRecord[];
}

export async function fetchFairSquadGuardStatus() {
  const response = await apiGet<{ ok: boolean; data: FairSquadGuardStatus }>("/api/plugins/fair-squad-guard/status");
  return response.data;
}

export async function fetchFairSquadGuardRecords(limit = 300) {
  const response = await apiGet<{ ok: boolean; data: FairSquadGuardRecordsResponse }>(`/api/plugins/fair-squad-guard/records?limit=${limit}`);
  return response.data;
}

export async function unlockFairSquadGuardRound() {
  const response = await apiPost<{ ok: boolean; data: FairSquadGuardStatus }>("/api/plugins/fair-squad-guard/unlock-current-round", {
    reason: "web_unlock",
  });
  return response.data;
}

export async function resetFairSquadGuardSession() {
  const response = await apiPost<{ ok: boolean; data: FairSquadGuardStatus }>("/api/plugins/fair-squad-guard/reset-session", {
    reason: "web_reset",
  });
  return response.data;
}
