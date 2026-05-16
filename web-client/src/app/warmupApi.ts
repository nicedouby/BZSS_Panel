import { apiGet, apiPost } from "./apiClient";

export interface WarmupState {
  isWarmup: boolean;
  updatedAt: string | null;
  updatedBy?: string | null;
}

export function normalizeWarmupState(value: any): WarmupState {
  return {
    isWarmup: Boolean(value?.isWarmup),
    updatedAt: value?.updatedAt ?? null,
    updatedBy: value?.updatedBy ?? null,
  };
}

export async function fetchWarmupState() {
  return normalizeWarmupState(await apiGet<any>("/api/server/warmup"));
}

export async function updateWarmupState(isWarmup: boolean) {
  return normalizeWarmupState(await apiPost<any>("/api/server/warmup", { isWarmup }));
}
