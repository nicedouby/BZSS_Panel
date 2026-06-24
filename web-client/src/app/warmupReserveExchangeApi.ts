import { apiGet, apiPost } from "./apiClient";

export interface WarmupGateState {
  active: boolean;
  reason: string;
  playerCount: number;
}

export interface WarmupReserveProgressItem {
  steamId: string;
  playerName: string;
  totalSeconds: number;
  lifetimeSeconds: number;
  lastSeenAt: number;
  lastTickAt: number;
  lastNotifyBucket: number;
  updatedAt: number;
}

export interface WarmupReserveRewardItem {
  id: number;
  steamId: string;
  playerName: string;
  rewardDays: number;
  costSeconds: number;
  reserveBefore: string | null;
  reserveAfter: string | null;
  createdAt: number;
  roundId: string | null;
}

export interface WarmupReserveWindowItem {
  id: number;
  startedAt: number;
  endedAt: number | null;
  reason: string;
  endReason: string;
}

export interface WarmupReserveExchangeState {
  ok: true;
  gate: WarmupGateState;
  progress: WarmupReserveProgressItem[];
  rewards: WarmupReserveRewardItem[];
  windows: WarmupReserveWindowItem[];
  settings: {
    enabled: boolean;
    requiredSeconds: number;
    rewardReserveDays: number;
    notifyIntervalSeconds: number;
    tickIntervalSeconds: number;
    maxPlayers: number;
    minPlayers: number;
  };
  lastTickAtMs: number | null;
  running: boolean;
  message?: string;
  error?: string;
}

export async function fetchWarmupReserveExchangeState() {
  return apiGet<{ ok: true; data: WarmupReserveExchangeState }>("/api/modules/warmup-reserve-exchange/state");
}

export async function fetchWarmupReserveExchangePlayers() {
  return apiGet<{ ok: true; data: WarmupReserveProgressItem[] }>("/api/modules/warmup-reserve-exchange/players");
}

export async function fetchWarmupReserveExchangeRewards(limit = 200) {
  return apiGet<{ ok: true; data: WarmupReserveRewardItem[] }>(`/api/modules/warmup-reserve-exchange/rewards?limit=${encodeURIComponent(String(limit))}`);
}

export async function tickWarmupReserveExchange() {
  return apiPost<{ ok: true; data: WarmupReserveExchangeState }>("/api/modules/warmup-reserve-exchange/tick", {});
}

export async function resetWarmupReserveProgress() {
  return apiPost<{ ok: true; data: WarmupReserveExchangeState }>("/api/modules/warmup-reserve-exchange/reset-progress", {});
}

export async function resetWarmupReserveAll() {
  return apiPost<{ ok: true; data: WarmupReserveExchangeState }>("/api/modules/warmup-reserve-exchange/reset-all", {});
}

export async function resetLegacyWarmupPoints() {
  return apiPost<{ ok: true; data: { ok: boolean; updated?: number } }>("/api/modules/warmup-reserve-exchange/reset-legacy-warmup-points", {});
}
