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

interface RuntimeSystemStatus {
  system?: {
    uptime?: number;
    memory?: { rss?: number };
    performance?: {
      latest?: {
        timestamp?: number;
        network?: {
          bytesInPerSec?: number | null;
          bytesOutPerSec?: number | null;
          bytesTotalPerSec?: number | null;
        } | null;
        eventLoop?: {
          mean?: number | null;
          p95?: number | null;
          p99?: number | null;
          max?: number | null;
          utilization?: number | null;
          utilizationPercent?: number | null;
          activeMs?: number | null;
          idleMs?: number | null;
        } | null;
      } | null;
    } | null;
  };
}

const systemStatus = shallowRef<RuntimeSystemStatus | null>(null);

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
let systemStatusTimer: number | null = null;
let visibilityListenerAttached = false;
let activeSnapshotController: AbortController | null = null;
let activeSystemStatusController: AbortController | null = null;
let snapshotRequestVersion = 0;
let systemStatusRequestVersion = 0;
let systemStatusInFlight = false;

function isPageHidden() {
  return typeof document !== "undefined" && document.hidden;
}

// The snapshot is the panel's shared data path.  A server that is still
// starting must never be able to leave it permanently in the "in flight"
// state, otherwise every page that depends on it remains on its loading view.
const SNAPSHOT_REQUEST_TIMEOUT_MS = 7_000;

// System telemetry must remain readable while the shared snapshot is slow or
// timing out.  The old implementation only refreshed /api/system/status after
// a successful /api/snapshot/all request, which made MAIN/P95 freeze exactly
// when the panel was overloaded.  Keep a small, independent polling loop.
const SYSTEM_STATUS_REQUEST_TIMEOUT_MS = 4_000;
const SYSTEM_STATUS_REFRESH_MS = 2_000;

export function setRuntimeSyncRefreshPolicy(policy: unknown) {
  runtimeSyncState.refreshPolicy = normalizeRefreshPolicy(policy);
  scheduleRuntimeSync();
}

export function startRuntimeSync() {
  if (runtimeSyncState.started) return;
  runtimeSyncState.started = true;
  attachVisibilityListener();
  void fetchSnapshot({ scheduleNext: true, immediate: true });
  void fetchSharedSystemStatus({ scheduleNext: true, immediate: true });
}
export function stopRuntimeSync() {
  runtimeSyncState.started = false;
  runtimeSyncState.inFlight = false;
  systemStatusInFlight = false;
  snapshotRequestVersion += 1;
  systemStatusRequestVersion += 1;
  activeSnapshotController?.abort("runtime-sync-stopped");
  activeSnapshotController = null;
  activeSystemStatusController?.abort("runtime-sync-stopped");
  activeSystemStatusController = null;
  clearRuntimeTimer();
  clearSystemStatusTimer();
  detachVisibilityListener();
}

export async function syncOnce() {
  await fetchSnapshot({ scheduleNext: false, immediate: true });
}

export function useSnapshot() {
  return snapshot;
}

export function useSystemStatus() {
  return systemStatus;
}

export function getRuntimeSyncState() {
  return runtimeSyncState;
}

function handleVisibilityChange() {
  if (!runtimeSyncState.started) return;

  if (isPageHidden()) {
    clearRuntimeTimer();
    clearSystemStatusTimer();
    if (activeSnapshotController) {
      snapshotRequestVersion += 1;
      activeSnapshotController.abort("runtime-sync-hidden");
      activeSnapshotController = null;
      runtimeSyncState.inFlight = false;
    }
    if (activeSystemStatusController) {
      systemStatusRequestVersion += 1;
      activeSystemStatusController.abort("runtime-sync-hidden");
      activeSystemStatusController = null;
      systemStatusInFlight = false;
    }
    return;
  }

  // Do one coalesced refresh after returning to the tab; do not replay
  // refreshes that would have happened while the page was hidden.
  clearRuntimeTimer();
  clearSystemStatusTimer();
  void fetchSnapshot({ scheduleNext: true, immediate: true });
  void fetchSharedSystemStatus({ scheduleNext: true, immediate: true });
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

function clearSystemStatusTimer() {
  if (systemStatusTimer == null) return;
  window.clearTimeout(systemStatusTimer);
  systemStatusTimer = null;
}

function scheduleRuntimeSync() {
  if (!runtimeSyncState.started || runtimeSyncState.inFlight || isPageHidden()) return;

  clearRuntimeTimer();
  const delay = resolveRuntimeSyncDelay();
  timer = window.setTimeout(() => {
    timer = null;
    void fetchSnapshot({ scheduleNext: true, immediate: true });
  }, delay);
}

function scheduleSystemStatusSync() {
  if (!runtimeSyncState.started || systemStatusInFlight || isPageHidden()) return;

  clearSystemStatusTimer();
  systemStatusTimer = window.setTimeout(() => {
    systemStatusTimer = null;
    void fetchSharedSystemStatus({ scheduleNext: true, immediate: true });
  }, SYSTEM_STATUS_REFRESH_MS);
}

function resolveRuntimeSyncDelay() {
  const baseDelay = resolveRefreshDelay({
    policy: runtimeSyncState.refreshPolicy,
    playerCount: getCurrentPlayerCount(),
    hidden: false,
    // Realtime pages carry live roster/squad state, so the shared snapshot
    // must use the primary cadence. Slower routes retain the auxiliary cadence.
    surface: runtimeSyncState.refreshPolicy === "realtime" ? "primary" : "auxiliary",
  });
  const failureFactor = Math.pow(2, Math.min(runtimeSyncState.consecutiveFailures, 4));
  const jitterFactor = 1 + Math.random() * 0.2;
  return Math.min(180_000, Math.round(baseDelay * failureFactor * jitterFactor));
}

function getCurrentPlayerCount() {
  const serverStore = useServerStore();
  const count = Number(serverStore.snapshot?.webStatus?.playerCount ?? serverStore.snapshot?.playerCount ?? Number.NaN);
  if (Number.isFinite(count) && count >= 0) return count;
  return 0;
}

async function fetchSnapshot(options: { scheduleNext: boolean; immediate?: boolean }) {
  if (!runtimeSyncState.started || runtimeSyncState.inFlight || isPageHidden()) return;
  if (options.immediate) clearRuntimeTimer();

  const requestVersion = ++snapshotRequestVersion;
  const controller = new AbortController();
  activeSnapshotController = controller;
  const timeoutId = window.setTimeout(() => controller.abort("timeout"), SNAPSHOT_REQUEST_TIMEOUT_MS);
  const isCurrentRequest = () => requestVersion === snapshotRequestVersion;

  runtimeSyncState.inFlight = true;
  try {
    const response = await fetch("/api/snapshot/all", {
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!isCurrentRequest() || !runtimeSyncState.started) return;

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
    if (!isCurrentRequest() || !runtimeSyncState.started) return;

    const normalized = markRaw(normalizeRuntimeSnapshot(data));
    snapshot.value = normalized;
    applySnapshotToStores(normalized);

    // Manual one-shot synchronization still includes system status so callers
    // retain the old syncOnce() contract. Recurring telemetry is handled by an
    // independent loop and therefore cannot be stalled by this snapshot path.
    if (!options.scheduleNext) {
      await fetchSharedSystemStatus({ scheduleNext: false, immediate: true });
    }

    runtimeSyncState.lastSuccessAt = Date.now();
    runtimeSyncState.lastError = null;
    runtimeSyncState.errorType = null;
    runtimeSyncState.consecutiveFailures = 0;
  } catch (error) {
    if (!isCurrentRequest() || !runtimeSyncState.started) return;
    const timedOut = controller.signal.aborted && controller.signal.reason === "timeout";
    runtimeSyncState.lastError = timedOut
      ? `Snapshot request timed out after ${SNAPSHOT_REQUEST_TIMEOUT_MS}ms`
      : error instanceof Error ? error.message : "Runtime snapshot failed";
    runtimeSyncState.errorType = timedOut ? "timeout" : "network";
    runtimeSyncState.consecutiveFailures += 1;
    markRuntimeStoresStale();
  } finally {
    window.clearTimeout(timeoutId);
    if (isCurrentRequest()) {
      activeSnapshotController = null;
      runtimeSyncState.inFlight = false;
      if (options.scheduleNext && runtimeSyncState.started) {
        scheduleRuntimeSync();
      }
    }
  }
}

async function fetchSharedSystemStatus(options: { scheduleNext: boolean; immediate?: boolean }) {
  if (!runtimeSyncState.started || systemStatusInFlight || isPageHidden()) return;
  if (options.immediate) clearSystemStatusTimer();

  const requestVersion = ++systemStatusRequestVersion;
  const controller = new AbortController();
  activeSystemStatusController = controller;
  const timeoutId = window.setTimeout(() => controller.abort("timeout"), SYSTEM_STATUS_REQUEST_TIMEOUT_MS);
  const isCurrentRequest = () => requestVersion === systemStatusRequestVersion;

  systemStatusInFlight = true;
  try {
    const response = await fetch(`/api/system/status?_=${Date.now()}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
      signal: controller.signal,
    });
    if (!isCurrentRequest() || !runtimeSyncState.started || !response.ok || controller.signal.aborted) return;
    systemStatus.value = await response.json() as RuntimeSystemStatus;
  } catch {
    // System metrics are auxiliary; keep the last known value on failure.
  } finally {
    window.clearTimeout(timeoutId);
    if (isCurrentRequest()) {
      activeSystemStatusController = null;
      systemStatusInFlight = false;
      if (options.scheduleNext && runtimeSyncState.started) {
        scheduleSystemStatusSync();
      }
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
  const activePlayers = Array.isArray(players?.active) ? players.active : [];
  const squadList = Array.isArray(squads?.list) ? squads.list : [];
  const suppliedTeams = Array.isArray(match?.teams)
    ? match.teams
    : Array.isArray(payload?.teams)
      ? payload.teams
      : [];
  const teams = suppliedTeams.length > 0
    ? suppliedTeams
    : deriveRuntimeTeams(activePlayers, squadList);
  const providedMatchState = payload?.matchState;
  const matchState = providedMatchState
    ? {
      ...providedMatchState,
      teams: Array.isArray(providedMatchState.teams) && providedMatchState.teams.length > 0
        ? providedMatchState.teams
        : teams,
    }
    : {
    serverStatus: {
      ...(match?.server ?? {}),
      ...webStatus,
      lastUpdatedAt: server?.updatedAt ?? match?.updatedAt ?? payload?.updatedAt ?? Date.now(),
    },
    players: {
      list: activePlayers,
      lastUpdatedAt: players?.updatedAt ?? payload?.updatedAt ?? Date.now(),
    },
    squads: {
      list: squadList,
      lastUpdatedAt: squads?.updatedAt ?? payload?.updatedAt ?? Date.now(),
    },
    teams,
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

  const normalized = {
    ...payload,
    matchState,
    overview,
    events: payload?.events ?? {},
    jobs: payload?.jobs ?? {},
  };

  // Keep the normalized snapshot as the only shared reference in production.
  // The raw response can be very large and is only useful while diagnosing
  // payload-shape problems locally.
  if (import.meta.env?.DEV && import.meta.env?.VITE_DEBUG_RUNTIME_SNAPSHOT === "true") {
    (normalized as any).raw = input;
  }

  return normalized;
}


function deriveRuntimeTeams(players: any[], squads: any[]) {
  const teams = new Map<any, any>();
  const squadMap = new Map<string, any>();

  for (const teamID of [1, 2]) {
    teams.set(teamID, {
      teamID,
      teamName: `Team ${teamID}`,
      squads: [],
      unassignedPlayers: [],
      playerCount: 0,
    });
  }

  for (const squad of squads) {
    const teamID = squad?.teamID;
    const squadID = squad?.squadID;
    if (teamID == null || squadID == null) continue;
    if (!teams.has(teamID)) {
      teams.set(teamID, {
        teamID,
        teamName: squad?.teamName || `Team ${teamID}`,
        squads: [],
        unassignedPlayers: [],
        playerCount: 0,
      });
    }
    const entry = { ...squad, members: [] as any[] };
    teams.get(teamID).squads.push(entry);
    squadMap.set(`${teamID}:${squadID}`, entry);
  }

  for (const player of players) {
    const teamID = player?.teamID ?? "unknown";
    if (!teams.has(teamID)) {
      teams.set(teamID, {
        teamID,
        teamName: teamID === "unknown" ? "Unknown / Unassigned" : `Team ${teamID}`,
        squads: [],
        unassignedPlayers: [],
        playerCount: 0,
      });
    }
    const team = teams.get(teamID);
    const squad = player?.squadID == null ? null : squadMap.get(`${teamID}:${player.squadID}`);
    if (squad) squad.members.push(player);
    else team.unassignedPlayers.push(player);
    team.playerCount += 1;
  }

  return [...teams.values()].map((team) => ({
    ...team,
    squads: [...team.squads].sort((left, right) => Number(left.squadID) - Number(right.squadID)),
  }));
}
