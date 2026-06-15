import { request } from "./apiClient";

export interface BlackEdgeCdkBatch {
  id: string;
  codeType: string;
  quantity: number;
  grantCount: number;
  allowMultiActivation: boolean;
  deactivated: boolean;
  deactivatedAt: string | null;
  deactivatedBy: string | null;
  createdAt: string | null;
  createdBy: string | null;
  codes?: string[];
  usedCount: number;
  remainingCount: number;
  activationCount?: number;
  status: "active" | "deactivated";
}

export interface BlackEdgeCdkActivationRecord {
  id: string;
  createdAt: string | null;
  playerName: string;
  steamId: string;
  code: string;
  codeType: string | null;
  batchId: string | null;
  result: string;
  failureReason: string;
  grantedCount: number;
  remainingCount: number | null;
}

export interface BlackEdgeCdkSummary {
  batchCount: number;
  activeBatchCount: number;
  deactivatedBatchCount: number;
  codeCount: number;
  usedCodeCount: number;
  remainingCodeCount: number;
  activationCount: number;
  successCount: number;
  failureCount: number;
  totalGrantedCount: number;
}

export interface BlackEdgeCdkState {
  ok: true;
  batches: BlackEdgeCdkBatch[];
  activations: BlackEdgeCdkActivationRecord[];
  summary: BlackEdgeCdkSummary;
  loadedAt: string | null;
  createdBatchId?: string;
  createdCodes?: string[];
  message?: string;
}

export interface BlackEdgeBatchActivationState {
  ok: true;
  batch: BlackEdgeCdkBatch;
  records: BlackEdgeCdkActivationRecord[];
}

export interface CreateBlackEdgeCdkBatchPayload {
  codeType: string;
  quantity: number;
  grantCount: number;
  allowMultiActivation: boolean;
}

export async function fetchBlackEdgeCdkState() {
  return request<BlackEdgeCdkState>("/api/black-edge-privilege/cdk/state", {
    method: "GET",
  });
}

export async function fetchBlackEdgeBatchActivations(batchId: string, filters: { steamId?: string; result?: string } = {}) {
  const query = new URLSearchParams();
  if (filters.steamId) query.set("steamId", filters.steamId);
  if (filters.result) query.set("result", filters.result);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<BlackEdgeBatchActivationState>(`/api/black-edge-privilege/cdk/batches/${encodeURIComponent(batchId)}/activations${suffix}`, {
    method: "GET",
  });
}

export async function createBlackEdgeCdkBatch(payload: CreateBlackEdgeCdkBatchPayload) {
  return request<BlackEdgeCdkState & { success: boolean }>(
    "/api/black-edge-privilege/cdk/batches",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
}

export async function deactivateBlackEdgeCdkBatch(batchId: string) {
  return request<BlackEdgeCdkState & { success: boolean }>(
    `/api/black-edge-privilege/cdk/batches/${encodeURIComponent(batchId)}/deactivate`,
    {
      method: "POST",
    },
  );
}
