<template>
  <section class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">对局状态</h1>
        <p class="page-subtitle">Vue 版首阶段页面，只读取 RuntimeState 快照。</p>
      </div>
      <div class="actions">
        <StatusBadge :tone="players.stale || squads.stale ? 'warn' : 'ok'">
          {{ players.stale || squads.stale ? "stale" : "synced" }}
        </StatusBadge>
        <button type="button" :disabled="refreshingPlaytime" @click="refreshOnlinePlaytime">
          {{ refreshingPlaytime ? "检测中..." : "检测在场玩家时长" }}
        </button>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat"><span>在线玩家</span><strong>{{ players.active.length }}</strong></div>
      <div class="stat"><span>最近离线</span><strong>{{ players.recentlyDisconnected.length }}</strong></div>
      <div class="stat"><span>小队</span><strong>{{ squads.list.length }}</strong></div>
      <div class="stat"><span>队长</span><strong>{{ match.leaderList.length }}</strong></div>
    </div>

    <ErrorBlock v-if="playtimeError" :message="playtimeError" />
    <LoadingBlock v-if="!players.updatedAt && !squads.updatedAt" />

    <div class="teams">
      <TeamPanel
        v-for="team in match.teams"
        :key="team.teamID"
        :team="team"
        :playtimes="playtimes"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiGet, apiPost } from "../app/apiClient";
import { usePlayerStore } from "../stores/player.store";
import { useSquadStore } from "../stores/squad.store";
import { useMatchStore } from "../stores/match.store";
import { useJobStore } from "../stores/job.store";
import StatusBadge from "../components/common/StatusBadge.vue";
import ErrorBlock from "../components/common/ErrorBlock.vue";
import LoadingBlock from "../components/common/LoadingBlock.vue";
import TeamPanel from "../components/match/TeamPanel.vue";

const players = usePlayerStore();
const squads = useSquadStore();
const match = useMatchStore();
const jobs = useJobStore();

const refreshingPlaytime = ref(false);
const playtimeError = ref("");

const steamIDs = computed(() => [...new Set(players.active.map((player) => player.steamID).filter(Boolean))] as string[]);
const steamIDParam = computed(() => steamIDs.value.join(","));

const playtimeQuery = useQuery({
  queryKey: computed(() => ["playtime-cache", steamIDParam.value]),
  enabled: computed(() => steamIDs.value.length > 0),
  queryFn: async () => apiGet<{ items: Record<string, any> }>(`/api/query/playtime-cache?steamIDs=${encodeURIComponent(steamIDParam.value)}`),
});

const playtimes = computed(() => playtimeQuery.data.value?.items ?? {});

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
    playtimeError.value = error?.message ?? "Steam 时长检测失败";
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
  throw new Error("等待 Steam 时长任务超时");
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
