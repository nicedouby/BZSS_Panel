<template>
  <div class="squad-admin-layout">
    <MatchHeaderBar :data="matchHeaderData" />
    <SquadPageToolbar
      :search-query="pageState.searchQuery"
      :density-mode="pageState.densityMode"
      @search="pageState.searchQuery = $event"
      @density-change="pageState.densityMode = $event"
    />

    <DataState
      :loading="showInitialLoading"
      :error="blockingRuntimeError"
      :stale="showStaleBanner"
      :stale-text="staleText"
    >
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
      :open="!!selectedPlayerDetail"
      :player="selectedPlayerDetail"
      @close="pageState.selectedPlayerId = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, reactive } from "vue";
import { useQuery } from "@tanstack/vue-query";
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
  adaptPlayerDetail, 
  adaptMatchHeader,
  extractPlaytimeHours,
} from "../utils/squad-admin-adapter";
import type { PageState, PlayerDetailViewModel } from "../types/squad-admin.types";
import DataState from "../components/common/DataState.vue";
import ErrorBlock from "../components/common/ErrorBlock.vue";
import MatchHeaderBar from "../components/squad-admin/MatchHeaderBar.vue";
import SquadPageToolbar from "../components/squad-admin/SquadPageToolbar.vue";
import TeamColumn from "../components/squad-admin/TeamColumn.vue";
import PlayerDetailDrawer from "../components/squad-admin/PlayerDetailDrawer.vue";

const auth = useAuthStore();
const server = useServerStore();
const players = usePlayerStore();
const squads = useSquadStore();
const match = useMatchStore();
const jobs = useJobStore();
const ui = useUiStore();
const runtime = getRuntimeSyncState();

const refreshingPlaytime = ref(false);
const playtimeError = ref("");
const playtimeRequested = ref(false);

const pageState = reactive<PageState>({
  searchQuery: "",
  densityMode: "comfortable",
  selectedPlayerId: null,
});

const snapshotUpdatedAt = computed(() => Math.max(server.updatedAt, players.updatedAt, squads.updatedAt));
const hasSnapshotData = computed(() => snapshotUpdatedAt.value > 0);
const runtimeWebStatus = computed(() => server.snapshot?.webStatus ?? server.snapshot ?? {});
const rconStatus = computed(() => String(runtimeWebStatus.value.rcon ?? "unknown"));
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

// ViewModel 层
const viewModels = computed(() => {
  return {
    teams: match.teams.map((team) => adaptTeam(team, playtimes.value)),
  };
});

// MatchHeaderBar 数据
const matchHeaderData = computed(() => {
  const snapshot = server.snapshot ?? {};
  return adaptMatchHeader(server, runtime, match);
});

// 找出当前选中的玩家
const selectedPlayer = computed(() => {
  if (!pageState.selectedPlayerId) return null;
  return players.active.find((p) => String(p.playerID) === String(pageState.selectedPlayerId));
});

// 将 RuntimePlayer 转换为 PlayerDetailViewModel
const selectedPlayerDetail = computed(() => {
  if (!selectedPlayer.value) return null;
  const hours = extractPlaytimeHours(selectedPlayer.value.steamID, playtimes.value);
  return adaptPlayerDetail(selectedPlayer.value, hours);
});

function selectPlayer(player: any) {
  pageState.selectedPlayerId = player.playerId;
  if (player.steamId) playtimeRequested.value = true;
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
