import { apiGet, apiPost } from "./apiClient";

export type DataRisk = "low" | "medium" | "protected";

export interface DataCategory {
  id: string;
  label: string;
  relativePath: string;
  kind: string;
  risk: DataRisk;
  cleanable: boolean;
  protectedReason: string;
  bytes: number;
  fileCount: number;
  directoryCount: number;
  activeFileCount: number;
  oldestModifiedAt: string | null;
  newestModifiedAt: string | null;
  partial: boolean;
  error: string;
}

export interface DataManagerOverview {
  ok: boolean;
  scannedAt: string;
  cleanupInProgress: boolean;
  summary: {
    totalBytes: number;
    cleanableBytes: number;
    fileCount: number;
    categoryCount: number;
    partialCategoryCount: number;
  };
  categories: DataCategory[];
}

export interface DataCleanupResult {
  ok: boolean;
  startedAt: string;
  completedAt: string;
  olderThanDays: number | null;
  deletedBytes: number;
  deletedFiles: number;
  deletedDirectories: number;
  skippedActiveFiles: number;
  skippedRecentFiles: number;
  failedFiles: number;
}

export function fetchDataManagerOverview() {
  return apiGet<DataManagerOverview>("/api/data-manager/overview", {}, { timeoutMs: 120_000 });
}

export function cleanupDataCategories(ids: string[], olderThanDays: number | null) {
  return apiPost<DataCleanupResult>("/api/data-manager/cleanup", {
    ids,
    olderThanDays,
    confirmation: "CLEAN_DATA",
  }, {}, { timeoutMs: 120_000 });
}

