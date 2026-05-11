import { reactive } from "vue";
import { apiGet, ApiError, type ApiErrorType } from "./apiClient";
import { useServerStore } from "../stores/server.store";
import { usePlayerStore } from "../stores/player.store";
import { useSquadStore } from "../stores/squad.store";
import { useEventStore } from "../stores/event.store";
import { useJobStore } from "../stores/job.store";
import { useAuthStore } from "../stores/auth.store";

const runtimeSyncState = reactive({
  started: false,
  inFlight: false,
  lastSuccessAt: 0,
  lastError: null as string | null,
  errorType: null as ApiErrorType | "unauthorized" | null,
  consecutiveFailures: 0,
});

let timer: number | null = null;

export function startRuntimeSync() {
  if (runtimeSyncState.started) return;
  runtimeSyncState.started = true;
  document.addEventListener("visibilitychange", rescheduleRuntimeSync);
  void syncOnce();
  rescheduleRuntimeSync();
}

export function stopRuntimeSync() {
  runtimeSyncState.started = false;
  runtimeSyncState.inFlight = false;
  if (timer != null) {
    window.clearInterval(timer);
    timer = null;
  }
  document.removeEventListener("visibilitychange", rescheduleRuntimeSync);
}

export function restartRuntimeSync() {
  stopRuntimeSync();
  startRuntimeSync();
}

export async function syncOnce() {
  if (!runtimeSyncState.started || runtimeSyncState.inFlight) return;

  runtimeSyncState.inFlight = true;
  try {
    const snapshot = await apiGet<any>("/api/snapshot/all");
    if (!runtimeSyncState.started) return;
    useServerStore().applySnapshot(snapshot.server);
    usePlayerStore().applySnapshot(snapshot.players);
    useSquadStore().applySnapshot(snapshot.squads);
    useEventStore().applySnapshot(snapshot.events);
    useJobStore().applySnapshot(snapshot.jobs);

    runtimeSyncState.lastSuccessAt = Date.now();
    runtimeSyncState.lastError = null;
    runtimeSyncState.errorType = null;
    runtimeSyncState.consecutiveFailures = 0;
  } catch (error) {
    handleSyncError(error);
  } finally {
    runtimeSyncState.inFlight = false;
  }
}

export function getRuntimeSyncState() {
  return runtimeSyncState;
}

function rescheduleRuntimeSync() {
  if (!runtimeSyncState.started) return;
  if (timer != null) window.clearInterval(timer);
  timer = window.setInterval(() => {
    void syncOnce();
  }, document.hidden ? 7_000 : 2_000);
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
