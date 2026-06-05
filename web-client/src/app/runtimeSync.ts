import { reactive } from "vue";
import { apiGet, apiPost, ApiError, type ApiErrorType } from "./apiClient";
import { useServerStore } from "../stores/server.store";
import { usePlayerStore } from "../stores/player.store";
import { useSquadStore } from "../stores/squad.store";
import { useAuthStore } from "../stores/auth.store";
import { normalizeRefreshPolicy, resolveRefreshDelay } from "./refreshPolicy";
import {
  applyMatchSnapshotResponse,
  applyRuntimeSnapshotResponse,
  hasEmptyMatchLists,
  isMatchSnapshotConnected,
} from "./matchSnapshot";

const runtimeSyncState = reactive({
  started: false,
  inFlight: false,
  lastSuccessAt: 0,
  lastError: null as string | null,
  errorType: null as ApiErrorType | "unauthorized" | null,
  consecutiveFailures: 0,
  bootstrapRefreshAttempted: false,
  refreshPolicy: "polling" as "realtime" | "polling" | "manual",
  lastRuntimeSnapshotAttemptAt: 0,
  lastRuntimeSnapshotAt: 0,
});

let timer: number | null = null;

export function setRuntimeSyncRefreshPolicy(policy: unknown) {
  runtimeSyncState.refreshPolicy = normalizeRefreshPolicy(policy);
  scheduleRuntimeSync();
}

export function startRuntimeSync() {
  if (runtimeSyncState.started) return;
  runtimeSyncState.started = true;
  document.addEventListener("visibilitychange", handleVisibilityChange);
  void performRuntimeSync({ scheduleNext: true });
}

export function stopRuntimeSync() {
  runtimeSyncState.started = false;
  runtimeSyncState.inFlight = false;
  runtimeSyncState.bootstrapRefreshAttempted = false;
  runtimeSyncState.lastRuntimeSnapshotAttemptAt = 0;
  runtimeSyncState.lastRuntimeSnapshotAt = 0;
  if (timer != null) {
    window.clearTimeout(timer);
    timer = null;
  }
  document.removeEventListener("visibilitychange", handleVisibilityChange);
}

export function restartRuntimeSync() {
  stopRuntimeSync();
  startRuntimeSync();
}

export async function syncOnce() {
  return performRuntimeSync({ scheduleNext: false });
}

export function getRuntimeSyncState() {
  return runtimeSyncState;
}

function handleVisibilityChange() {
  scheduleRuntimeSync();
}

async function performRuntimeSync({ scheduleNext }: { scheduleNext: boolean }) {
  if (!runtimeSyncState.started || runtimeSyncState.inFlight) return;

  runtimeSyncState.inFlight = true;
  try {
    const matchSnapshot = await apiGet<any>("/api/match/snapshot");
    if (!runtimeSyncState.started) return;
    applyMatchSnapshotResponse(matchSnapshot);

    const playerCount = getPlayerCount(matchSnapshot);
    if (shouldRefreshRuntimeSnapshot(playerCount)) {
      runtimeSyncState.lastRuntimeSnapshotAttemptAt = Date.now();
      const snapshot = await apiGet<any>("/api/snapshot/all");
      if (!runtimeSyncState.started) return;
      applyRuntimeSnapshotResponse(snapshot);
      runtimeSyncState.lastRuntimeSnapshotAt = Date.now();
    }

    await maybeBootstrapMatchRefresh(matchSnapshot);

    runtimeSyncState.lastSuccessAt = Date.now();
    runtimeSyncState.lastError = null;
    runtimeSyncState.errorType = null;
    runtimeSyncState.consecutiveFailures = 0;
  } catch (error) {
    handleSyncError(error);
  } finally {
    runtimeSyncState.inFlight = false;
    if (scheduleNext) {
      scheduleRuntimeSync();
    }
  }
}

function scheduleRuntimeSync() {
  if (!runtimeSyncState.started) return;
  if (runtimeSyncState.inFlight) return;
  if (timer != null) window.clearTimeout(timer);

  const delay = resolveRuntimeSyncDelay("primary");
  timer = window.setTimeout(() => {
    timer = null;
    void performRuntimeSync({ scheduleNext: true });
  }, delay);
}

function handleSyncError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.type === "abort") return;

    if (error.type === "http" && error.status === 401) {
      runtimeSyncState.lastError = "Unauthorized";
      runtimeSyncState.errorType = "unauthorized";
      runtimeSyncState.consecutiveFailures += 1;
      markRuntimeStoresStale();
      useAuthStore().markUnauthorized();
      stopRuntimeSync();
      return;
    }

    runtimeSyncState.lastError = error.message;
    runtimeSyncState.errorType = error.type;
    runtimeSyncState.consecutiveFailures += 1;
    markRuntimeStoresStale();
    return;
  }

  runtimeSyncState.lastError = "Runtime snapshot failed";
  runtimeSyncState.errorType = "network";
  runtimeSyncState.consecutiveFailures += 1;
  markRuntimeStoresStale();
}

function markRuntimeStoresStale() {
  useServerStore().markStale();
  usePlayerStore().markStale();
  useSquadStore().markStale();
}

function getPlayerCount(matchSnapshot: any) {
  const serverStore = useServerStore();
  const storeCount = Number(serverStore.snapshot?.webStatus?.playerCount ?? serverStore.snapshot?.playerCount ?? Number.NaN);
  if (Number.isFinite(storeCount) && storeCount >= 0) return storeCount;

  const fromSnapshot = Number(matchSnapshot?.matchState?.serverStatus?.playerCount ?? matchSnapshot?.matchState?.players?.list?.length ?? 0);
  if (Number.isFinite(fromSnapshot) && fromSnapshot >= 0) return fromSnapshot;

  return 0;
}

function resolveRuntimeSyncDelay(surface: "primary" | "auxiliary") {
  return resolveRefreshDelay({
    policy: runtimeSyncState.refreshPolicy,
    playerCount: getCurrentPlayerCount(),
    hidden: typeof document !== "undefined" ? document.hidden : false,
    surface,
  });
}

function getCurrentPlayerCount() {
  const serverStore = useServerStore();
  const storeCount = Number(serverStore.snapshot?.webStatus?.playerCount ?? serverStore.snapshot?.playerCount ?? Number.NaN);
  if (Number.isFinite(storeCount) && storeCount >= 0) return storeCount;
  return 0;
}

function shouldRefreshRuntimeSnapshot(playerCount: number) {
  if (!runtimeSyncState.lastRuntimeSnapshotAttemptAt) return true;
  const interval = resolveRefreshDelay({
    policy: runtimeSyncState.refreshPolicy,
    playerCount,
    hidden: typeof document !== "undefined" ? document.hidden : false,
    surface: "auxiliary",
  });
  return Date.now() - runtimeSyncState.lastRuntimeSnapshotAttemptAt >= interval;
}

async function maybeBootstrapMatchRefresh(matchSnapshot: any) {
  const auth = useAuthStore();
  if (!auth.user?.isSuperAdmin) return;
  if (!isMatchSnapshotConnected(matchSnapshot)) return;
  if (!hasEmptyMatchLists(matchSnapshot)) return;

  if (runtimeSyncState.bootstrapRefreshAttempted) return;
  runtimeSyncState.bootstrapRefreshAttempted = true;

  try {
    const refreshed = await apiPost<any>("/api/match/refresh/all", {});
    if (!runtimeSyncState.started || !refreshed?.ok) return;
    applyMatchSnapshotResponse(refreshed);
  } catch {
    return;
  }
}
