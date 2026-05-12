<template>
  <div class="squad-admin-layout">
    <MatchHeaderBar :data="matchHeaderData" />
    <SquadPageToolbar
      :search-query="pageState.searchQuery"
      :density-mode="pageState.densityMode"
      :can-refresh="canRefresh"
      :refreshing-type="refreshingType"
      :refreshing-playtime="refreshingPlaytime"
      :server-status-updated-at="serverStatusUpdatedAt"
      :players-updated-at="playersUpdatedAt"
      :squads-updated-at="squadsUpdatedAt"
      @search="pageState.searchQuery = $event"
      @density-change="pageState.densityMode = $event"
      @refresh="handleToolbarRefresh"
      @refresh-playtime="refreshOnlinePlaytime"
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
import { computed, ref, reactive, watch } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { apiGet, apiPost } from "../app/apiClient";
import { renderApiError } from "../app/errors";
import { getRuntimeSyncState } from "../app/runtimeSync";
import { applyMatchSnapshotResponse } from "../app/matchSnapshot";
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
  filterTeamsBySearch,
} from "../utils/squad-admin-adapter";
import DataState from "../components/common/DataState.vue";
import ErrorBlock from "../components/common/ErrorBlock.vue";
import MatchHeaderBar from "../components/squad-admin/MatchHeaderBar.vue";
import SquadPageToolbar from "../components/squad-admin/SquadPageToolbar.vue";
import TeamColumn from "../components/squad-admin/TeamColumn.vue";
import PlayerDetailDrawer from "../components/squad-admin/PlayerDetailDrawer.vue";
import { t } from "../i18n";
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
const playtimeRequested = ref(true);
const selectedPlayerDetail = ref<PlayerDetailViewModel | null>(null);

const pageState = reactive<PageState>({
  searchQuery: "",
  densityMode: "comfortable",
  selectedPlayerId: null,
});

const canRefresh = computed(() => Boolean(auth.user?.isSuperAdmin));
const refreshingType = computed(() => {
  if (refreshingPlayers.value) return "players";
  if (refreshingSquads.value) return "squads";
  if (refreshingAll.value) return "all";
  return "";
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
const showStaleBanner = computed(() => hasSnapshotData.value && (Boolean(runtime.lastError) || server.stale || players.stale || squads.stale));
const staleText = computed(() => {
  if (runtime.lastError) return `${t("dataState.staleText")} ${runtime.lastError}`;
  if (refreshError.value) return `${t("dataState.staleText")} ${refreshError.value}`;
  return t("dataState.staleText");
});

const steamIDs = computed(() => [...new Set(players.active.map((player) => player.steamID).filter(Boolean))] as string[]);
const steamIDParam = computed(() => steamIDs.value.join(","));

const playtimeQuery = useQuery({
  queryKey: computed(() => ["playtime-cache", steamIDParam.value, playtimeRequested.value]),
  enabled: computed(() => auth.authenticated && playtimeRequested.value && steamIDs.value.length > 0),
  queryFn: async () => apiGet<{ items: Record<string, any> }>(`/api/query/playtime-cache?steamIDs=${encodeURIComponent(steamIDParam.value)}`),
});

const playtimes = computed(() => playtimeQuery.data.value?.items ?? {});

const viewModels = computed(() => {
  const teams = match.teams.map((team) => adaptTeam(team, playtimes.value));
  return {
    teams: filterTeamsBySearch(teams, pageState.searchQuery),
  };
});

const matchHeaderData = computed(() => {
  return adaptMatchHeader(server, runtime, match, matchSnapshot.value);
});

watch(
  () => matchSnapshotQuery.data.value,
  (data) => {
    if (!data?.matchState) return;
    applyMatchSnapshotResponse(data);
  },
  { immediate: true },
);

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
      throw new Error(finalJob.error?.message ?? t("common.error"));
    }

    await playtimeQuery.refetch();
    ui.pushToast({
      title: t("common.updated"),
      message: t("common.updated"),
      tone: "ok",
    });
  } catch (error) {
    playtimeError.value = renderApiError(error, t("common.error"));
    ui.pushToast({
      title: t("common.error"),
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

function handleToolbarRefresh(type: "players" | "squads" | "all") {
  if (type === "players") {
    void refreshPlayers();
    return;
  }
  if (type === "squads") {
    void refreshSquads();
    return;
  }
  void refreshAll();
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
    const endpoint = type === "players"
      ? "/api/match/refresh/players"
      : type === "squads"
        ? "/api/match/refresh/squads"
        : "/api/match/refresh/all";
    const result = await apiPost<any>(endpoint, {});
    applyMatchRefreshResult(result);
    if (!result?.ok) {
      refreshError.value = result?.errors?.[0]?.message ?? t("common.error");
      server.markStale();
      players.markStale();
      squads.markStale();
      ui.pushToast({
        title: t("common.error"),
        message: refreshError.value,
        tone: "error",
      });
      return;
    }
    ui.pushToast({
      title: t("common.updated"),
      message: type === "all" ? t("match.refreshAll") : type === "players" ? t("match.refreshPlayers") : t("match.refreshSquads"),
      tone: "ok",
    });
  } catch (error) {
    refreshError.value = renderApiError(error, t("common.error"));
    ui.pushToast({
      title: t("common.error"),
      message: refreshError.value,
      tone: "error",
    });
  } finally {
    loadingState.value = false;
  }
}

function applyMatchRefreshResult(result: any) {
  if (!result) return;

  if (!result.ok) return;

  queryClient.setQueryData(["match-snapshot", auth.authenticated], result);
  applyMatchSnapshotResponse(result);
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
    return `${t("common.apiOffline")}: ${runtimeError}`;
  }
  if (runtime.errorType === "unauthorized") {
    return t("common.unauthorized");
  }
  return `${t("common.error")}: ${runtimeError}`;
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
