<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">对局状态</h1>
        <p class="page-subtitle">Vue 版首阶段页面，只读取 RuntimeState 快照。</p>
      </div>
      <div class="actions">
        <StatusBadge :tone="pageBadgeTone">{{ pageBadgeText }}</StatusBadge>
        <button type="button" :disabled="refreshingPlaytime || !hasRuntimeData" @click="refreshOnlinePlaytime">
          {{ refreshingPlaytime ? "检测中..." : "检测在场玩家时长" }}
        </button>
      </div>
    </div>

    <LoadingBlock v-if="!auth.checked" />
    <ErrorBlock v-else-if="!auth.authenticated" message="未登录，请先登录。" />
    <ErrorBlock v-else-if="blockingRuntimeError" :message="blockingRuntimeError" />

    <template v-else>
      <ErrorBlock v-if="playtimeError" :message="playtimeError" />
      <ErrorBlock v-if="nonBlockingRuntimeError" :message="nonBlockingRuntimeError" />

      <div class="stat-grid">
        <div class="stat"><span>在线玩家</span><strong>{{ players.active.length }}</strong></div>
        <div class="stat"><span>最近离线</span><strong>{{ players.recentlyDisconnected.length }}</strong></div>
        <div class="stat"><span>小队</span><strong>{{ squads.list.length }}</strong></div>
        <div class="stat"><span>队长</span><strong>{{ match.leaderList.length }}</strong></div>
      </div>

      <LoadingBlock v-if="!hasRuntimeData && runtime.inFlight" />

      <div class="teams">
        <TeamPanel
          v-for="team in match.teams"
          :key="team.teamID"
          :team="team"
          :playtimes="playtimes"
          @select-player="openPlayerDialog"
        />
      </div>
    </template>

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
import { apiGet, apiPost, ApiError } from "../app/apiClient";
import { getRuntimeSyncState } from "../app/runtimeSync";
import { useAuthStore } from "../stores/auth.store";
import { usePlayerStore, type RuntimePlayer } from "../stores/player.store";
import { useSquadStore } from "../stores/squad.store";
import { useMatchStore } from "../stores/match.store";
import { useJobStore } from "../stores/job.store";
import StatusBadge from "../components/common/StatusBadge.vue";
import ErrorBlock from "../components/common/ErrorBlock.vue";
import LoadingBlock from "../components/common/LoadingBlock.vue";
import TeamPanel from "../components/match/TeamPanel.vue";
import PlayerDetailDialog from "../components/match/PlayerDetailDialog.vue";

const auth = useAuthStore();
const players = usePlayerStore();
const squads = useSquadStore();
const match = useMatchStore();
const jobs = useJobStore();
const runtime = getRuntimeSyncState();

const refreshingPlaytime = ref(false);
const playtimeError = ref("");
const selectedPlayer = ref<RuntimePlayer | null>(null);

const hasRuntimeData = computed(() => Boolean(players.updatedAt || squads.updatedAt));
const steamIDs = computed(() => [...new Set(players.active.map((player) => player.steamID).filter(Boolean))] as string[]);
const steamIDParam = computed(() => steamIDs.value.join(","));

const playtimeQuery = useQuery({
  queryKey: computed(() => ["playtime-cache", steamIDParam.value]),
  enabled: computed(() => auth.authenticated && steamIDs.value.length > 0),
  queryFn: async () => apiGet<{ items: Record<string, any> }>(`/api/query/playtime-cache?steamIDs=${encodeURIComponent(steamIDParam.value)}`),
});

const playtimes = computed(() => playtimeQuery.data.value?.items ?? {});
const blockingRuntimeError = computed(() => {
  if (!auth.authenticated || hasRuntimeData.value || !runtime.lastError) return "";
  if (runtime.errorType === "network" || runtime.errorType === "timeout") {
    return `API 未连接：${runtime.lastError}`;
  }
  if (runtime.errorType === "unauthorized") return "登录状态已失效，请重新登录。";
  return `请求失败：${runtime.lastError}`;
});
const nonBlockingRuntimeError = computed(() => {
  if (!hasRuntimeData.value || !runtime.lastError) return "";
  return `当前显示旧快照，最新同步失败：${runtime.lastError}`;
});
const pageBadgeText = computed(() => {
  if (runtime.inFlight) return "syncing";
  if (runtime.errorType === "unauthorized") return "unauthorized";
  if (runtime.errorType === "network" || runtime.errorType === "timeout") return "api offline";
  if (players.stale || squads.stale || runtime.lastError) return "stale";
  return "synced";
});
const pageBadgeTone = computed(() => pageBadgeText.value === "synced" ? "ok" : pageBadgeText.value === "stale" ? "warn" : "error");

async function refreshOnlinePlaytime() {
  refreshingPlaytime.value = true;
  playtimeError.value = "";
  try {
    const job = await apiPost<any>("/api/jobs/playtime-refresh-online", { waitMs: 0 });
    jobs.upsert(job);
    const finalJob = await waitForJob(job.id, 45_000);
    jobs.upsert(finalJob);
    if (finalJob.status !== "completed") {
      throw new Error(finalJob.error?.message ?? "Steam 时长任务失败");
    }
    await playtimeQuery.refetch();
  } catch (error: any) {
    playtimeError.value = renderPageError(error, "Steam 时长检测失败");
  } finally {
    refreshingPlaytime.value = false;
  }
}

function openPlayerDialog(player: RuntimePlayer) {
  selectedPlayer.value = player;
}

async function waitForJob(jobId: string, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const job = await apiGet<any>(`/api/jobs/${encodeURIComponent(jobId)}?waitMs=3000`);
    jobs.upsert(job);
    if (job.status === "completed" || job.status === "failed") return job;
  }
  throw new Error("等待 Steam 时长任务超时");
}

function renderPageError(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    if (error.status === 401) return "登录状态已失效，请重新登录。";
    if (error.type === "network") return "API 未连接。";
    if (error.type === "timeout") return "请求超时。";
    return error.message;
  }
  return error instanceof Error ? error.message : fallback;
}
</script>

<style scoped>
.actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.teams {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

@media (max-width: 1100px) {
  .teams {
    grid-template-columns: 1fr;
  }
}
</style>
