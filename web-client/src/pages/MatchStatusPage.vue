<template>
  <section class="page">
    <PageHeader
      title="Match Status"
      subtitle="Reads only from runtimeSync snapshots and Pinia runtime stores."
    >
      <template #actions>
        <StatusBadge :tone="pageBadgeTone">{{ pageBadgeText }}</StatusBadge>
        <button type="button" :disabled="refreshingPlaytime || !hasOnlinePlayers" @click="refreshOnlinePlaytime">
          {{ refreshingPlaytime ? "Refreshing..." : "Refresh Online Playtime" }}
        </button>
      </template>
    </PageHeader>

    <DataState
      :loading="showInitialLoading"
      :error="blockingRuntimeError"
      :stale="showStaleBanner"
      :stale-text="staleText"
    >
      <ErrorBlock v-if="playtimeError" :message="playtimeError" />

      <div class="stat-grid">
        <div class="stat"><span>Online Players</span><strong>{{ players.active.length }}</strong></div>
        <div class="stat"><span>Recent Disconnects</span><strong>{{ players.recentlyDisconnected.length }}</strong></div>
        <div class="stat"><span>Squads</span><strong>{{ squads.list.length }}</strong></div>
        <div class="stat"><span>Leaders</span><strong>{{ match.leaderList.length }}</strong></div>
      </div>

      <PageCard v-if="showRuntimeHint" compact>
        <div class="hint-grid">
          <div class="hint-item">
            <span>RCON</span>
            <strong>{{ rconLabel }}</strong>
          </div>
          <div class="hint-item">
            <span>Players</span>
            <strong>{{ players.active.length ? `${players.active.length} online` : "No online players" }}</strong>
          </div>
          <div class="hint-item">
            <span>Squads</span>
            <strong>{{ squads.list.length ? `${squads.list.length} squads` : "No squad data" }}</strong>
          </div>
        </div>
      </PageCard>

      <div class="teams">
        <TeamPanel
          v-for="team in match.teams"
          :key="team.teamID"
          :team="team"
          :playtimes="playtimes"
          @select-player="openPlayerDialog"
        />
      </div>
    </DataState>

    <PlayerDetailDialog
      v-if="selectedPlayer"
      :player="selectedPlayer"
      :playtime="selectedPlayer.steamID ? playtimes[selectedPlayer.steamID] : null"
      @close="selectedPlayer = null"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiGet, apiPost } from "../app/apiClient";
import { renderApiError } from "../app/errors";
import { getRuntimeSyncState } from "../app/runtimeSync";
import { useAuthStore } from "../stores/auth.store";
import { usePlayerStore, type RuntimePlayer } from "../stores/player.store";
import { useSquadStore } from "../stores/squad.store";
import { useServerStore } from "../stores/server.store";
import { useMatchStore } from "../stores/match.store";
import { useJobStore } from "../stores/job.store";
import { useUiStore } from "../stores/ui.store";
import StatusBadge from "../components/common/StatusBadge.vue";
import ErrorBlock from "../components/common/ErrorBlock.vue";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import DataState from "../components/common/DataState.vue";
import TeamPanel from "../components/match/TeamPanel.vue";
import PlayerDetailDialog from "../components/match/PlayerDetailDialog.vue";

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
const selectedPlayer = ref<RuntimePlayer | null>(null);
const playtimeRequested = ref(false);

const snapshotUpdatedAt = computed(() => Math.max(server.updatedAt, players.updatedAt, squads.updatedAt));
const hasSnapshotData = computed(() => snapshotUpdatedAt.value > 0);
const hasOnlinePlayers = computed(() => players.active.length > 0);
const runtimeWebStatus = computed(() => server.snapshot.webStatus ?? server.snapshot ?? {});
const rconStatus = computed(() => String(runtimeWebStatus.value.rcon ?? "unknown"));
const rconConnected = computed(() => rconStatus.value === "connected");
const showInitialLoading = computed(() => auth.authenticated && !hasSnapshotData.value && runtime.inFlight && !runtime.lastError);
const blockingRuntimeError = computed(() => {
  if (!auth.authenticated || hasSnapshotData.value || !runtime.lastError) return "";
  return renderApiErrorText(runtime.lastError);
});
const showStaleBanner = computed(() => hasSnapshotData.value && Boolean(runtime.lastError));
const staleText = computed(() => `Showing cached runtime data. Latest sync failed: ${runtime.lastError}`);
const showRuntimeHint = computed(() => !showInitialLoading.value && !blockingRuntimeError.value && !rconConnected.value);
const rconLabel = computed(() => {
  if (rconStatus.value === "connected") return "Connected";
  if (rconStatus.value === "disabled") return "Disabled";
  if (rconStatus.value === "disconnected") return "Not connected";
  if (rconStatus.value === "error") return "Error";
  return "Unknown";
});
const pageBadgeText = computed(() => {
  if (runtime.inFlight && !hasSnapshotData.value) return "syncing";
  if (runtime.errorType === "unauthorized") return "unauthorized";
  if (showStaleBanner.value) return "stale";
  if (!rconConnected.value) return "api only";
  return "live";
});
const pageBadgeTone = computed(() => {
  if (pageBadgeText.value === "live") return "ok";
  if (pageBadgeText.value === "stale" || pageBadgeText.value === "api only") return "warn";
  return "error";
});

const steamIDs = computed(() => [...new Set(players.active.map((player) => player.steamID).filter(Boolean))] as string[]);
const steamIDParam = computed(() => steamIDs.value.join(","));

const playtimeQuery = useQuery({
  queryKey: computed(() => ["playtime-cache", steamIDParam.value, playtimeRequested.value]),
  enabled: computed(() => auth.authenticated && playtimeRequested.value && steamIDs.value.length > 0),
  queryFn: async () => apiGet<{ items: Record<string, any> }>(`/api/query/playtime-cache?steamIDs=${encodeURIComponent(steamIDParam.value)}`),
});

const playtimes = computed(() => playtimeQuery.data.value?.items ?? {});

function openPlayerDialog(player: RuntimePlayer) {
  selectedPlayer.value = player;
  if (player.steamID) playtimeRequested.value = true;
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
.teams {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.hint-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.hint-item {
  display: grid;
  gap: 4px;
}

.hint-item span {
  font-size: 12px;
  color: #98a5af;
}

.hint-item strong {
  font-size: 14px;
}

@media (max-width: 1100px) {
  .teams,
  .hint-grid {
    grid-template-columns: 1fr;
  }
}
</style>
