import { apiGet, request } from "./apiClient";

export interface PressureZoneRuleGroup {
  id: string;
  label: string;
  fullCount: number;
  innerCount: number;
  maps: string[];
}

export interface PressureZoneRulesState {
  enabled: boolean;
  map: string;
  mapKey: string;
  rule: PressureZoneRuleGroup | null;
  announcement: string;
  updatedAt: string;
  lastBroadcastAt: string;
  lastBroadcastSuccess: boolean | null;
  lastError: string;
  mapRules: PressureZoneRuleGroup[];
  temporaryShrinkRules: string;
}

export async function fetchPressureZoneRulesState() {
  return apiGet<PressureZoneRulesState>("/api/pressure-zone-rules/state");
}

export async function broadcastPressureZoneRule() {
  return request<{ ok: boolean; result: { success?: boolean; skipped?: boolean; errorMessage?: string } }>("/api/pressure-zone-rules/broadcast", {
    method: "POST",
  });
}
