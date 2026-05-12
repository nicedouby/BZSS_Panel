<template>
  <div class="squad-admin-layout">
    <MatchHeaderBar :data="matchHeaderData" />
    <SquadPageToolbar
      :search-query="pageState.searchQuery"
      :density-mode="pageState.densityMode"
      :refreshing-players="refreshingPlayers"
      :refreshing-squads="refreshingSquads"
      :refreshing-all="refreshingAll"
      :server-status-updated-at="serverStatusUpdatedAt"
      :players-updated-at="playersUpdatedAt"
      :squads-updated-at="squadsUpdatedAt"
      @search="pageState.searchQuery = $event"
      @density-change="pageState.densityMode = $event"
      @refresh-players="refreshPlayers"
      @refresh-squads="refreshSquads"
      @refresh-all="refreshAll"
    />

    <DataState
      :loading="showInitialLoading"
      :error="blockingRuntimeError"
      :stale="showStaleBanner"
      :stale-text="staleText"
    >
      <ErrorBlock v-if="refreshError" :message="refreshError" />

      <ErrorBlock v-if="playtimeError" :message="playtimeError" />

      <div class="squad-main-content" :class="pageState.densityMode">
        <TeamColumn
          v-for="team in viewModels.teams"
          :key="team.teamId"
          :team="team"
          :selected-player-id="pageState.selectedPlayerId"
          @select-player="selectPlayer"
        />
      </div>
    </DataState>

    <PlayerDetailDrawer
      :open="selectedPlayerDetail !== null"
      :player="selectedPlayerDetail"
      @close="closePlayerDetail"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, reactive } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { apiGet, apiPost } from "../app/apiClient";
import { renderApiError } from "../app/errors";
import { getRuntimeSyncState } from "../app/runtimeSync";
import { useAuthStore } from "../stores/auth.store";
import { usePlayerStore } from "../stores/player.store";
import { useSquadStore } from "../stores/squad.store";
import { useServerStore } from "../stores/server.store";
import { useMatchStore } from "../stores/match.store";
import { useJobStore } from "../stores/job.store";
import { useUiStore } from "../stores/ui.store";
import {
  adaptTeam,
  adaptMatchHeader,
} from "../utils/squad-admin-adapter";
import DataState from "../components/common/DataState.vue";
import ErrorBlock from "../components/common/ErrorBlock.vue";
import MatchHeaderBar from "../components/squad-admin/MatchHeaderBar.vue";
import SquadPageToolbar from "../components/squad-admin/SquadPageToolbar.vue";
import TeamColumn from "../components/squad-admin/TeamColumn.vue";
import PlayerDetailDrawer from "../components/squad-admin/PlayerDetailDrawer.vue";
import type {
  PageState,
  PlayerDetailViewModel,
  PlayerRowViewModel,
} from "../types/squad-admin.types";

const auth = useAuthStore();
const server = useServerStore();
const players = usePlayerStore();
const squads = useSquadStore();
const match = useMatchStore();
const jobs = useJobStore();
const ui = useUiStore();
const runtime = getRuntimeSyncState();
const queryClient = useQueryClient();

const refreshingPlaytime = ref(false);
const refreshingPlayers = ref(false);
const refreshingSquads = ref(false);
const refreshingAll = ref(false);
const refreshError = ref("");
const playtimeError = ref("");
const playtimeRequested = ref(false);
const selectedPlayerDetail = ref<PlayerDetailViewModel | null>(null);

const pageState = reactive<PageState>({
  searchQuery: "",
  densityMode: "comfortable",
  selectedPlayerId: null,
});

const snapshotUpdatedAt = computed(() => Math.max(server.updatedAt, players.updatedAt, squads.updatedAt));
const hasSnapshotData = computed(() => snapshotUpdatedAt.value > 0);
const runtimeWebStatus = computed(() => server.snapshot?.webStatus ?? server.snapshot ?? {});
const rconStatus = computed(() => String(runtimeWebStatus.value.rcon ?? "unknown"));
const matchSnapshotQuery = useQuery({
  queryKey: computed(() => ["match-snapshot", auth.authenticated]),
  enabled: computed(() => auth.authenticated),
  queryFn: async () => apiGet<any>("/api/match/snapshot"),
  refetchOnWindowFocus: false,
});
const matchSnapshot = computed(() => matchSnapshotQuery.data.value?.matchState ?? null);
const serverStatusUpdatedAt = computed(() => toMillis(matchSnapshot.value?.serverStatus?.lastUpdatedAt));
const playersUpdatedAt = computed(() => toMillis(matchSnapshot.value?.players?.lastUpdatedAt));
const squadsUpdatedAt = computed(() => toMillis(matchSnapshot.value?.squads?.lastUpdatedAt));
const showInitialLoading = computed(() => auth.authenticated && !hasSnapshotData.value && runtime.inFlight && !runtime.lastError);
const blockingRuntimeError = computed(() => {
  if (!auth.authenticated || hasSnapshotData.value || !runtime.lastError) return "";
  return renderApiErrorText(runtime.lastError);
});
const showStaleBanner = computed(() => hasSnapshotData.value && Boolean(runtime.lastError));
const staleText = computed(() => `Showing cached runtime data. Latest sync failed: ${runtime.lastError}`);

const steamIDs = computed(() => [...new Set(players.active.map((player) => player.steamID).filter(Boolean))] as string[]);
const steamIDParam = computed(() => steamIDs.value.join(","));

const playtimeQuery = useQuery({
  queryKey: computed(() => ["playtime-cache", steamIDParam.value, playtimeRequested.value]),
  enabled: computed(() => auth.authenticated && playtimeRequested.value && steamIDs.value.length > 0),
  queryFn: async () => apiGet<{ items: Record<string, any> }>(`/api/query/playtime-cache?steamIDs=${encodeURIComponent(steamIDParam.value)}`),
});

const playtimes = computed(() => playtimeQuery.data.value?.items ?? {});

const viewModels = computed(() => {
  return {
    teams: match.teams.map((team) => adaptTeam(team, playtimes.value)),
  };
});

const matchHeaderData = computed(() => {
  return adaptMatchHeader(server, runtime, match, matchSnapshot.value);
});

function selectPlayer(player: PlayerRowViewModel) {
  pageState.selectedPlayerId = player.playerId;

  selectedPlayerDetail.value = {
    playerId: player.playerId,
    name: player.name,
    role: player.role,
    isLeader: player.isLeader,
    isOnline: player.isOnline,
    teamId: player.teamId,
    squadId: player.squadId,
    steamId: player.steamId,
    eosId: player.eosId,
    ip: player.ip,
    playtimeHours: player.playtimeHours,
    source: "row",
    controller: "",
    raw: player,
  };

  if (player.steamId) {
    playtimeRequested.value = true;
  }
}

function closePlayerDetail() {
  pageState.selectedPlayerId = null;
  selectedPlayerDetail.value = null;
}

async function refreshOnlinePlaytime() {
  refreshingPlaytime.value = true;
  playtimeError.value = "";
  playtimeRequested.value = true;

  try {
    const job = await apiPost<any>("/api/jobs/playtime-refresh-online", { waitMs: 0 });
    jobs.upsert(job);
    const finalJob = await waitForJob(job.id, 45_000);
    jobs.upsert(finalJob);

    if (finalJob.status !== "completed") {
      throw new Error(finalJob.error?.message ?? "Playtime refresh failed.");
    }

    await playtimeQuery.refetch();
    ui.pushToast({
      title: "Playtime refreshed",
      message: "Cached playtime for currently online players has been updated.",
      tone: "ok",
    });
  } catch (error) {
    playtimeError.value = renderApiError(error, "Playtime refresh failed.");
    ui.pushToast({
      title: "Playtime refresh failed",
      message: playtimeError.value,
      tone: "error",
    });
  } finally {
    refreshingPlaytime.value = false;
  }
}

async function refreshPlayers() {
  await refreshMatchState("players");
}

async function refreshSquads() {
  await refreshMatchState("squads");
}

async function refreshAll() {
  await refreshMatchState("all");
}

async function refreshMatchState(type: "players" | "squads" | "all") {
  const loadingState = type === "players"
    ? refreshingPlayers
    : type === "squads"
      ? refreshingSquads
      : refreshingAll;

  loadingState.value = true;
  refreshError.value = "";

  try {
    const result = await apiPost<any>("/api/match/refresh", { type });
    applyMatchRefreshResult(result);
    if (!result?.ok) {
      refreshError.value = result?.errors?.[0]?.message ?? "Match refresh completed with errors.";
      ui.pushToast({
        title: "Match refresh had errors",
        message: refreshError.value,
        tone: "error",
      });
      return;
    }
    ui.pushToast({
      title: "Match state refreshed",
      message: type === "all" ? "Players, squads, and server info were refreshed." : `Match ${type} refreshed.`,
      tone: "ok",
    });
  } catch (error) {
    refreshError.value = renderApiError(error, "Match refresh failed.");
    ui.pushToast({
      title: "Match refresh failed",
      message: refreshError.value,
      tone: "error",
    });
  } finally {
    loadingState.value = false;
  }
}

function applyMatchRefreshResult(result: any) {
  if (!result) return;

  queryClient.setQueryData(["match-snapshot", auth.authenticated], result);

  const matchState = result.matchState ?? null;
  const overview = result.overview ?? null;
  if (!matchState) return;

  server.applySnapshot(buildServerSnapshot(matchState, overview));
  players.applySnapshot(buildPlayersSnapshot(matchState.players));
  squads.applySnapshot(buildSquadsSnapshot(matchState.squads));
}

async function waitForJob(jobId: string, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const job = await apiGet<any>(`/api/jobs/${encodeURIComponent(jobId)}?waitMs=3000`);
    jobs.upsert(job);
    if (job.status === "completed" || job.status === "failed") return job;
  }
  throw new Error("Timed out while waiting for the playtime refresh job.");
}

function renderApiErrorText(runtimeError: string) {
  if (runtime.errorType === "network" || runtime.errorType === "timeout") {
    return `Runtime sync could not reach the API: ${runtimeError}`;
  }
  if (runtime.errorType === "unauthorized") {
    return "Session expired. Please sign in again.";
  }
  return `Runtime sync failed: ${runtimeError}`;
}

function buildServerSnapshot(matchState: any, overview: any) {
  const serverStatus = matchState?.serverStatus ?? {};
  const status = overview?.status ?? {};

  return {
    ...serverStatus,
    updatedAt: toMillis(serverStatus.lastUpdatedAt) || Date.now(),
    webStatus: status,
    stale: false,
  };
}

function buildPlayersSnapshot(matchPlayers: any) {
  const list = Array.isArray(matchPlayers?.list) ? matchPlayers.list : [];
  const snapshot = {
    active: [...list],
    recentlyDisconnected: [],
    bySteamID: {} as Record<string, any>,
    byEOSID: {} as Record<string, any>,
    byPlayerID: {} as Record<string, any>,
    byName: {} as Record<string, any>,
    updatedAt: toMillis(matchPlayers?.lastUpdatedAt) || Date.now(),
    stale: false,
  };

  for (const player of list) {
    if (player?.steamID && !snapshot.bySteamID[player.steamID]) snapshot.bySteamID[player.steamID] = player;
    if (player?.eosID && !snapshot.byEOSID[player.eosID]) snapshot.byEOSID[player.eosID] = player;
    if (player?.playerID != null && !snapshot.byPlayerID[player.playerID]) snapshot.byPlayerID[player.playerID] = player;
    if (player?.name && !snapshot.byName[player.name]) snapshot.byName[player.name] = player;
  }

  return snapshot;
}

function buildSquadsSnapshot(matchSquads: any) {
  const list = Array.isArray(matchSquads?.list) ? matchSquads.list : [];
  const snapshot = {
    list: [...list],
    byKey: {} as Record<string, any>,
    byTeamID: {} as Record<string, any[]>,
    updatedAt: toMillis(matchSquads?.lastUpdatedAt) || Date.now(),
    stale: false,
  };

  for (const squad of list) {
    if (squad?.key) snapshot.byKey[squad.key] = squad;
    const teamKey = squad?.teamID != null ? String(squad.teamID) : "";
    if (!teamKey) continue;
    if (!snapshot.byTeamID[teamKey]) snapshot.byTeamID[teamKey] = [];
    snapshot.byTeamID[teamKey].push(squad);
  }

  return snapshot;
}

function toMillis(value: string | number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value) return 0;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}
</script>

<style scoped>
@import "../styles/squad-admin.css";

.squad-admin-layout {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  height: 100dvh;
  gap: 0;
  overflow: hidden;
}

.squad-main-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--spacing-lg);
  padding: var(--spacing-lg);
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

@media (max-width: 1366px) {
  .squad-main-content {
    grid-template-columns: 1fr;
  }
}
</style>
