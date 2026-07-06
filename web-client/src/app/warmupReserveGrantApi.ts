import { request } from "./apiClient";

export interface WarmupReserveGrantTimeWindow {
  enabled: boolean;
  start: string;
  end: string;
}

export interface WarmupReserveGrantSettings {
  enabled: boolean;
  grantEveryMinutes: number;
  grantDays: number;
  reminderEveryMinutes: number;
  maxEligiblePlayers: number;
  requireWarmupMode: boolean;
  requireSquad: boolean;
  requireUnlockedSquad: boolean;
  group: string;
  countMode: string;
  timeWindows: WarmupReserveGrantTimeWindow[];
  clearOfflineAfterHours: number;
  maxRecentRecords: number;
}

export interface WarmupReserveGrantConditions {
  eligible: boolean;
  isWarmup: boolean;
  playerCount: number;
  maxEligiblePlayers: number;
  belowPlayerLimit: boolean;
  matchedTimeWindow: boolean;
  pauseReason: string | null;
  checkedAt: string;
}

export interface WarmupReserveGrantProgress {
  steamId: string;
  name: string;
  playerId: string | number | null;
  eligibleSeconds: number;
  lastSeenAt: string | null;
  lastTickAt: string | null;
  lastReminderAt: string | null;
  grantCount: number;
  totalGrantedDays: number;
  lastGrantedAt: string | null;
  lastGrantFailedAt?: string | null;
  status: "active" | "paused" | "granted" | "offline";
  pauseReason?: string | null;
}

export interface WarmupReserveGrantRecord {
  type: "grant" | "grant_failed" | "reminder" | "pause" | "offline" | string;
  steamId?: string;
  name?: string;
  playerId?: string | number | null;
  grantedDays?: number;
  eligibleSeconds?: number;
  expireAt?: string | null;
  pauseReason?: string;
  error?: string;
  result?: string;
  createdAt: string;
}

export interface WarmupReserveGrantState {
  ok: true;
  config: WarmupReserveGrantSettings;
  paths: {
    storeFilePath: string;
    grantsFilePath: string;
  };
  status: {
    running: boolean;
    enabled: boolean;
    inTick: boolean;
    lastTickAt: string | null;
    lastError: string | null;
    conditions: WarmupReserveGrantConditions;
    accumulatingCount: number;
    todayGrantCount: number;
  };
  progress: WarmupReserveGrantProgress[];
  records: WarmupReserveGrantRecord[];
  summary: {
    progressCount: number;
    activeCount: number;
    pausedCount: number;
    offlineCount: number;
    grantCount: number;
    totalGrantedDays: number;
  };
  message?: string;
}

export async function fetchWarmupReserveGrantState() {
  return request<WarmupReserveGrantState>("/api/warmup-reserve-grant/state", {
    method: "GET",
  });
}

export async function updateWarmupReserveGrantSettings(payload: Partial<WarmupReserveGrantSettings>) {
  return request<WarmupReserveGrantState>("/api/warmup-reserve-grant/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function clearWarmupReserveGrantRecords() {
  return request<WarmupReserveGrantState>("/api/warmup-reserve-grant/clear-records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export async function clearWarmupReserveGrantProgress() {
  return request<WarmupReserveGrantState>("/api/warmup-reserve-grant/clear-progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export async function grantWarmupReserveNow(payload: { steamId: string; name?: string; durationDays?: number }) {
  return request<{ ok: true; success: true; message?: string; state: WarmupReserveGrantState }>("/api/warmup-reserve-grant/grant-now", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
