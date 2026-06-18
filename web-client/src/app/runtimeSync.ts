import { markRaw, reactive, shallowRef } from "vue";
import { normalizeRefreshPolicy, resolveRefreshDelay, type RefreshPolicy } from "./refreshPolicy";
import { applyMatchSnapshotResponse, applyRuntimeSnapshotResponse } from "./matchSnapshot";
import { canAutoRefreshNow } from "../composables/useAutoRefreshGate";
import { useAuthStore } from "../stores/auth.store";
import { usePlayerStore } from "../stores/player.store";
import { useServerStore } from "../stores/server.store";
import { useSquadStore } from "../stores/squad.store";

export interface SnapshotStore {
  snapshot: any;
}

const snapshot = shallowRef<any>(null);

const runtimeSyncState = reactive({
  started: false,
  inFlight: false,
  lastSuccessAt: 0,
  lastError: null as string | null,
  errorType: null as "network" | "http" | "parse" | "timeout" | "unauthorized" | null,
  consecutiveFailures: 0,
  refreshPolicy: "polling" as RefreshPolicy,
});

let timer: number | null = null;
let visibilityListenerAttached = false;

export function setRuntimeSyncRefreshPolicy(policy: unknown) {
  runtimeSyncState.refreshPolicy = normalizeRefreshPolicy(policy);
  scheduleRuntimeSync();
}

export function startRuntimeSync() {
  if (runtimeSyncState.started) return;
  runtimeSyncState.started = true;
  attachVisibilityListener();
  void fetchSnapshot({ scheduleNext: true, immediate: true });
}

export function stopRuntimeSync() {
  runtimeSyncState.started = false;
  runtimeSyncState.inFlight = false;
  clearRuntimeTimer();
  detachVisibilityListener();
}

export async function syncOnce() {
  await fetchSnapshot({ scheduleNext: false, immediate: true });
}

export function useSnapshot() {
  return snapshot;
}

export function getRuntimeSyncState() {
  return runtimeSyncState;
}

function handleVisibilityChange() {
  if (!runtimeSyncState.started) return;
  scheduleRuntimeSync();
}

function attachVisibilityListener() {
  if (visibilityListenerAttached || typeof document === "undefined") return;
  document.addEventListener("visibilitychange", handleVisibilityChange);
  visibilityListenerAttached = true;
}

function detachVisibilityListener() {
  if (!visibilityListenerAttached || typeof document === "undefined") return;
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  visibilityListenerAttached = false;
}

function clearRuntimeTimer() {
  if (timer == null) return;
  window.clearTimeout(timer);
  timer = null;
}

function scheduleRuntimeSync() {
  if (!runtimeSyncState.started || runtimeSyncState.inFlight) return;

  clearRuntimeTimer();
  const delay = resolveRuntimeSyncDelay();
  timer = window.setTimeout(() => {
    timer = null;
    if (canAutoRefreshNow()) {
      void fetchSnapshot({ scheduleNext: true, immediate: true });
      return;
    }
    scheduleRuntimeSync();
  }, delay);
}

function resolveRuntimeSyncDelay() {
  return resolveRefreshDelay({
    policy: runtimeSyncState.refreshPolicy,
    playerCount: getCurrentPlayerCount(),
    hidden: typeof document !== "undefined" ? document.hidden : false,
    surface: "auxiliary",
  });
}

function getCurrentPlayerCount() {
  const serverStore = useServerStore();
  const count = Number(serverStore.snapshot?.webStatus?.playerCount ?? serverStore.snapshot?.playerCount ?? Number.NaN);
  if (Number.isFinite(count) && count >= 0) return count;
  return 0;
}

async function fetchSnapshot(options: { scheduleNext: boolean; immediate?: boolean }) {
  if (!runtimeSyncState.started || runtimeSyncState.inFlight) return;
  if (options.immediate) clearRuntimeTimer();

  runtimeSyncState.inFlight = true;
  try {
    const response = await fetch("/api/snapshot/all", {
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
      },
    });

    if (response.status === 401) {
      runtimeSyncState.lastError = "Unauthorized";
      runtimeSyncState.errorType = "unauthorized";
      runtimeSyncState.consecutiveFailures += 1;
      markRuntimeStoresStale();
      useAuthStore().markUnauthorized();
      stopRuntimeSync();
      return;
    }

    if (!response.ok) {
      runtimeSyncState.lastError = `HTTP ${response.status}`;
      runtimeSyncState.errorType = "http";
      runtimeSyncState.consecutiveFailures += 1;
      markRuntimeStoresStale();
      return;
    }

    const data = await response.json();
    if (!runtimeSyncState.started) return;

    const normalized = markRaw(normalizeRuntimeSnapshot(data));
    snapshot.value = normalized;
    applySnapshotToStores(normalized);

    runtimeSyncState.lastSuccessAt = Date.now();
    runtimeSyncState.lastError = null;
    runtimeSyncState.errorType = null;
    runtimeSyncState.consecutiveFailures = 0;
  } catch (error) {
    runtimeSyncState.lastError = error instanceof Error ? error.message : "Runtime snapshot failed";
    runtimeSyncState.errorType = "network";
    runtimeSyncState.consecutiveFailures += 1;
    markRuntimeStoresStale();
  } finally {
    runtimeSyncState.inFlight = false;
    if (options.scheduleNext && runtimeSyncState.started) {
      scheduleRuntimeSync();
    }
  }
}

function applySnapshotToStores(data: any) {
  applyMatchSnapshotResponse(data);
  applyRuntimeSnapshotResponse(data);
}

function markRuntimeStoresStale() {
  useServerStore().markStale();
  usePlayerStore().markStale();
  useSquadStore().markStale();
}

function normalizeRuntimeSnapshot(input: any) {
  const payload = input?.snapshot ?? input ?? {};
  const match = payload?.match ?? {};
  const server = payload?.server ?? match?.server ?? {};
  const players = payload?.players ?? match?.players ?? {};
  const squads = payload?.squads ?? match?.squads ?? {};
  const rcon = payload?.rcon ?? {};
  const webStatus = server?.webStatus ?? {};
  const matchState = payload?.matchState ?? {
    serverStatus: {
      ...(match?.server ?? {}),
      ...webStatus,
      lastUpdatedAt: server?.updatedAt ?? match?.updatedAt ?? payload?.updatedAt ?? Date.now(),
    },
    players: {
      list: Array.isArray(players?.active) ? players.active : [],
      lastUpdatedAt: players?.updatedAt ?? payload?.updatedAt ?? Date.now(),
    },
    squads: {
      list: Array.isArray(squads?.list) ? squads.list : [],
      lastUpdatedAt: squads?.updatedAt ?? payload?.updatedAt ?? Date.now(),
    },
    teams: Array.isArray(match?.teams) ? match.teams : Array.isArray(payload?.teams) ? payload.teams : [],
    rconStatus: {
      ...rcon,
      connected: Boolean(rcon?.connected ?? webStatus?.rconConnected ?? false),
    },
    match: match?.match ?? {},
    updatedAt: match?.updatedAt ?? payload?.updatedAt ?? Date.now(),
  };

  const overview = payload?.overview ?? {
    status: webStatus,
    matchState,
    serverStatus: matchState.serverStatus,
    match: matchState.match,
    players: matchState.players.list,
    squads: matchState.squads.list,
    teams: matchState.teams,
    rconStatus: matchState.rconStatus,
  };

  return {
    ...payload,
    raw: input,
    matchState,
    overview,
    events: payload?.events ?? {},
    jobs: payload?.jobs ?? {},
  };
}
