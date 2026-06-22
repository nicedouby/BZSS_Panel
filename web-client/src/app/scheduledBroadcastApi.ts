import { apiGet, apiPost, request } from "./apiClient";

export interface ScheduledBroadcastItem {
  id: string;
  title: string;
  message: string;
  intervalSeconds: number;
  delaySeconds: number;
  enabled: boolean;
  order: number;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastSuccessAt: number | null;
  lastError: string;
  lastResult: "idle" | "success" | "failed";
  runCount: number;
  errorCount: number;
  isCurrent?: boolean;
}

export interface ScheduledBroadcastStateResponse {
  ok: boolean;
  config: {
    enabled: boolean;
    tickMs: number;
    dataFile: string;
  };
  status: {
    running: boolean;
    inTick: boolean;
    lastTickAt: number;
    currentItemId: string | null;
    schedule: {
      nextItemId: string | null;
      nextRunAt: number | null;
      lastAdvancedAt: number | null;
    };
  };
  items: ScheduledBroadcastItem[];
}

export function getScheduledBroadcastState() {
  return apiGet<ScheduledBroadcastStateResponse>("/api/scheduled-broadcasts/state");
}

export function createScheduledBroadcastItem(payload: {
  message: string;
  intervalSeconds?: number;
  delaySeconds?: number;
  enabled?: boolean;
  order?: number;
}) {
  return apiPost<{ ok: boolean; item: ScheduledBroadcastItem }>("/api/scheduled-broadcasts/items", payload);
}

export function updateScheduledBroadcastItem(id: string, payload: Partial<{
  title: string;
  message: string;
  intervalSeconds: number;
  delaySeconds: number;
  enabled: boolean;
  resetSchedule: boolean;
}>) {
  return request<{ ok: boolean; item: ScheduledBroadcastItem }>(`/api/scheduled-broadcasts/items/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function reorderScheduledBroadcastItems(ids: string[]) {
  return apiPost<{ ok: boolean; items: ScheduledBroadcastItem[] }>("/api/scheduled-broadcasts/reorder", {
    ids,
  });
}

export function deleteScheduledBroadcastItem(id: string) {
  return request<{ ok: boolean; item: ScheduledBroadcastItem }>(`/api/scheduled-broadcasts/items/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function runScheduledBroadcastNow(id: string, reason = "manual_run") {
  return apiPost<{ ok: boolean; result: { success: boolean; errorMessage?: string } }>(
    `/api/scheduled-broadcasts/items/${encodeURIComponent(id)}/run`,
    { reason },
  );
}
