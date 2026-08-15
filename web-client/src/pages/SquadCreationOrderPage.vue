<template>
  <AppPage class="creation-order-page" mode="workspace">
    <WorkspaceToolbar>
      <div class="toolbar-title-section">
        <h1 class="page-title-text">建队顺序</h1>
        <p class="page-subtitle-text">当前对局最终通过建队记录；同一玩家重复建队时只保留最新记录。</p>
      </div>

      <div class="toolbar-status">
        <AppStatusBadge v-if="pollIntervalLabel" tone="idle">
          自动刷新: {{ pollIntervalLabel }}
        </AppStatusBadge>
        <AppStatusBadge :tone="cacheLoaded ? 'ok' : 'warn'">
          {{ cacheLoaded ? "缓存已加载" : "缓存未加载" }}
        </AppStatusBadge>
        <AppStatusBadge v-if="replayStatus" :tone="replayStatus.status === 'failed' ? 'error' : replayStatus.status === 'completed' ? 'ok' : 'warn'">
          {{ replayStatusLabel }}
        </AppStatusBadge>
      </div>

      <template #actions>
        <button
          type="button"
          class="bz-btn bz-btn-ghost"
          :disabled="loading || clearing"
          @click="() => refetch()"
        >
          {{ loading ? "刷新中..." : "手动刷新" }}
        </button>
        <button
          v-if="canClear"
          type="button"
          class="bz-btn bz-btn-danger"
          :disabled="clearing"
          @click="clearCurrentRound"
        >
          {{ clearing ? "清理中..." : "一键清理" }}
        </button>
      </template>
    </WorkspaceToolbar>

    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="replayStatus && replayStatus.status !== 'idle'" class="banner replay-status">
      <span>{{ replayStatusLabel }}</span>
      <span>发现 {{ replayStatus.squadCreatesFound ?? 0 }}</span>
      <span>接受 {{ replayStatus.accepted ?? 0 }}</span>
      <span>违规拒绝 {{ replayStatus.rejectedPolicy ?? 0 }}</span>
      <span>等待阵营解析 {{ replayStatus.pendingTeamResolution ?? 0 }}</span>
    </div>

    <section class="summary-grid">
      <StatCard
        label="总通过建队数"
        :value="allRecords.length"
        tone="success"
        :loading="loading"
      />
      <StatCard
        label="最大顺序码"
        :value="maxOrderCode || '-'"
        tone="info"
        :loading="loading"
      />
      <StatCard
        label="显示/有效记录"
        :value="`${filteredRecords.length} / ${allRecords.length}`"
        tone="neutral"
        :loading="loading"
      />
      <StatCard
        label="当前对局"
        :value="matchLabel"
        tone="warning"
        :loading="loading"
      />
    </section>

    <section class="filter-bar" aria-label="筛选与搜索">
      <div class="filter-group">
        <label class="filter-item">
          <span class="filter-label">搜索</span>
          <input
            v-model.trim="searchQuery"
            type="search"
            placeholder="搜小队名或队长..."
            class="filter-input"
          />
        </label>

        <label class="filter-item">
          <span class="filter-label">阵营</span>
          <select v-model="selectedTeam" class="filter-select">
            <option value="all">全部</option>
            <option :value="1">TEAM 1 (蓝军)</option>
            <option :value="2">TEAM 2 (红军)</option>
          </select>
        </label>
      </div>
    </section>

    <section class="order-panel scrollable-container">
      <EmptyState
        v-if="!filteredRecords.length"
        title="无建队记录"
        :description="allRecords.length ? '没有符合当前筛选条件的建队记录。' : '当前对局暂无最终通过的建队记录。'"
        icon="📳"
      />
      <div v-else class="order-list">
        <article
          v-for="item in filteredRecords"
          :key="item.id"
          class="order-row"
          :class="[
            item.teamId === 1 ? 'team-1-card' : item.teamId === 2 ? 'team-2-card' : 'team-neutral-card',
          ]"
        >
          <div class="order-code-badge">
            <span class="order-hash">#</span>
            <span class="order-num">{{ item.creationOrderCode }}</span>
          </div>

          <div class="order-main">
            <div class="squad-title">
              <strong>{{ item.squadName || `Squad ${item.squadId ?? "?"}` }}</strong>
              <AppStatusBadge
                v-if="item.replacedRecordId"
                tone="warn"
                class="replaced-badge"
              >
                已替换旧记录
              </AppStatusBadge>
            </div>
            <div class="leader-info">
              <span class="leader-icon">👑</span>
              <span class="leader-name">{{ item.leaderName || "未知玩家" }}</span>
            </div>
          </div>

          <div class="order-meta">
            <span class="meta-badge team-badge">
              {{ item.teamId === 1 ? "TEAM 1" : item.teamId === 2 ? "TEAM 2" : `TEAM ${item.teamId ?? "?"}` }}
            </span>
            <span class="meta-badge squad-id-badge">
              小队 ID: {{ item.squadId ?? "?" }}
            </span>
          </div>

          <div class="order-time">
            <span class="time-icon">🕒</span>
            <span class="time-text">{{ formatTime(item.createdAt) }}</span>
          </div>
        </article>
      </div>
    </section>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { apiGet, apiPost } from "../app/apiClient";
import { normalizeRefreshPolicy, resolveRefreshDelay } from "../app/refreshPolicy";
import { usePageActivity } from "../composables/usePageActivity";
import { useAuthStore } from "../stores/auth.store";
import { useUiStore } from "../stores/ui.store";

import AppPage from "../components/common/AppPage.vue";
import WorkspaceToolbar from "../components/common/WorkspaceToolbar.vue";
import AppStatusBadge from "../components/common/AppStatusBadge.vue";
import StatCard from "../components/ui/StatCard.vue";
import EmptyState from "../components/ui/EmptyState.vue";

type FinalPassRecord = {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  creationOrderCode?: number;
  replacedRecordId?: string;
  event?: {
    matchId?: string;
    teamId?: number | null;
    squadId?: number | null;
    squadName?: string;
    leaderName?: string;
    createdAt?: string;
  };
};

type TrackingStateResponse = {
  ok?: boolean;
  data?: {
    lifecycle?: {
      matchId?: string | null;
      list?: LifecycleRecord[];
      replay?: ReplayStatus | null;
    };
    ruleChain?: {
      finalPassRecords?: FinalPassRecord[];
      finalPassCache?: { loaded?: boolean; cacheKey?: string };
    };
  };
};

type ReplayStatus = {
  status?: string;
  progress?: number;
  squadCreatesFound?: number;
  accepted?: number;
  rejectedPolicy?: number;
  pendingTeamResolution?: number;
};

type LifecycleRecord = {
  key?: string;
  order?: number;
  matchId?: string;
  teamId?: number | null;
  squadId?: number | null;
  squadName?: string;
  creatorName?: string;
  createdAt?: string;
  createdAtMs?: number;
  sourceOffset?: number;
  sourceMode?: string;
  replayAccepted?: boolean | null;
};

type OrderRecord = {
  id: string;
  creationOrderCode: number;
  matchId?: string;
  teamId?: number | null;
  squadId?: number | null;
  squadName?: string;
  leaderName?: string;
  createdAt?: string;
  replacedRecordId?: string;
};

const route = useRoute();
const pageActivity = usePageActivity();
const auth = useAuthStore();
const ui = useUiStore();

const searchQuery = ref("");
const selectedTeam = ref<number | string>("all");
const clearing = ref(false);

const routeRefreshPolicy = computed(() => normalizeRefreshPolicy(route.meta.refreshPolicy));
const recordsRefetchInterval = computed(() => resolveRefreshDelay({
  policy: routeRefreshPolicy.value,
  hidden: !pageActivity.isDocumentVisible.value,
  surface: "page",
}));
const pollIntervalLabel = computed(() => `${Math.round(recordsRefetchInterval.value / 1000)}s`);

const { data: stateData, isLoading: loading, error: queryError, refetch } = useQuery<TrackingStateResponse>({
  queryKey: ["squad-creation-order-state"],
  queryFn: async () => apiGet<TrackingStateResponse>("/api/squad-name-tracking/state"),
  refetchInterval: computed(() => (pageActivity.canAutoRefresh.value ? recordsRefetchInterval.value : false)),
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: false,
});

const error = computed(() => {
  if (queryError.value) {
    return queryError.value instanceof Error ? queryError.value.message : "加载数据失败";
  }
  return "";
});

const rawRecords = computed<FinalPassRecord[]>(() => stateData.value?.data?.ruleChain?.finalPassRecords ?? []);
const replayStatus = computed<ReplayStatus | null>(() => stateData.value?.data?.lifecycle?.replay ?? null);
const replayStatusLabel = computed(() => {
  const status = replayStatus.value?.status ?? "idle";
  if (status === "completed") return "建队顺序已根据日志恢复";
  if (status === "failed") return "建队日志回溯失败";
  if (["scanning", "resolving", "rebuilding"].includes(status)) {
    return `建队日志回溯中 ${Math.round(Number(replayStatus.value?.progress ?? 0))}%`;
  }
  return "等待建队日志回溯";
});
const cacheLoaded = computed(() => Boolean(stateData.value?.data?.ruleChain?.finalPassCache?.loaded));
const cacheKey = computed(() => String(stateData.value?.data?.ruleChain?.finalPassCache?.cacheKey ?? ""));
const matchId = computed(() => String(stateData.value?.data?.lifecycle?.matchId ?? ""));
const matchLabel = computed(() => matchId.value || cacheKey.value || "-");
const canClear = computed(() => auth.user?.isSuperAdmin === true);

const allRecords = computed<OrderRecord[]>(() => {
  const liveRecords = rawRecords.value.map((record, index) => ({
    id: record.id || `creation-order-${index}`,
    creationOrderCode: Number(record.creationOrderCode ?? 0) || 0,
    matchId: record.event?.matchId ?? "",
    teamId: record.event?.teamId ?? null,
    squadId: record.event?.squadId ?? null,
    squadName: record.event?.squadName ?? "",
    leaderName: record.event?.leaderName ?? "",
    createdAt: record.event?.createdAt || record.createdAt || record.updatedAt || "",
    replacedRecordId: record.replacedRecordId,
    sourceOffset: Number.MAX_SAFE_INTEGER,
  }));
  const replayRecords = (stateData.value?.data?.lifecycle?.list ?? [])
    .filter((record) => record.sourceMode === "replay" && record.replayAccepted === true)
    .map((record, index) => ({
      id: record.key || `replay-creation-${index}`,
      creationOrderCode: Number(record.order ?? 0) || 0,
      matchId: record.matchId ?? "",
      teamId: record.teamId ?? null,
      squadId: record.squadId ?? null,
      squadName: record.squadName ?? "",
      leaderName: record.creatorName ?? "",
      createdAt: record.createdAt ?? "",
      sourceOffset: Number.isFinite(Number(record.sourceOffset)) ? Number(record.sourceOffset) : Number.MAX_SAFE_INTEGER,
    }));
  const byCreation = new Map<string, OrderRecord & { sourceOffset?: number }>();
  for (const record of [...liveRecords, ...replayRecords]) {
    const timeBucket = Math.floor((Date.parse(record.createdAt || "") || 0) / 10_000);
    const key = [record.matchId, record.teamId, record.squadId, record.squadName, record.leaderName, timeBucket].join("|");
    if (!byCreation.has(key)) byCreation.set(key, record);
  }
  return [...byCreation.values()]
    .sort((left, right) => (Date.parse(left.createdAt || "") || 0) - (Date.parse(right.createdAt || "") || 0)
      || Number(left.sourceOffset ?? Number.MAX_SAFE_INTEGER) - Number(right.sourceOffset ?? Number.MAX_SAFE_INTEGER)
      || Number(left.squadId ?? 0) - Number(right.squadId ?? 0))
    .map((record, index) => ({ ...record, creationOrderCode: index + 1 }));
});

const filteredRecords = computed<OrderRecord[]>(() => allRecords.value.filter((record) => {
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    const sName = (record.squadName ?? "").toLowerCase();
    const lName = (record.leaderName ?? "").toLowerCase();
    if (!sName.includes(q) && !lName.includes(q)) {
      return false;
    }
  }

  if (selectedTeam.value !== "all") {
    const tId = Number(selectedTeam.value);
    if (record.teamId !== tId) {
      return false;
    }
  }

  return true;
}));

const maxOrderCode = computed(() => allRecords.value.reduce((max, item) => Math.max(max, item.creationOrderCode), 0));

function formatTime(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "-";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

async function clearCurrentRound() {
  if (!canClear.value || clearing.value) return;

  const confirmed = await ui.openConfirm({
    title: "清空建队顺序",
    message: "将清空当前局建队顺序记录，包括建队周期和最终通过记录。",
    confirmText: "立即清空",
    cancelText: "取消",
    tone: "warn",
  });
  if (!confirmed) return;

  clearing.value = true;
  try {
    await apiPost("/api/squad-creation-order/clear", {});
    ui.pushToast({
      title: "已清空",
      message: "当前对局建队顺序记录已清空。",
      tone: "ok",
    });
    await refetch();
  } catch (err) {
    ui.pushToast({
      title: "清空失败",
      message: err instanceof Error ? err.message : String(err),
      tone: "error",
    });
  } finally {
    clearing.value = false;
  }
}
</script>

<style scoped>
.creation-order-page {
  height: 100%;
}

.toolbar-title-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.page-title-text {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.page-subtitle-text {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-muted);
}

.toolbar-status {
  display: flex;
  gap: 8px;
}

.banner.error {
  border-radius: 8px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 92, 92, 0.34);
  background: rgba(255, 92, 92, 0.14);
  color: #ffb3b3;
  font-size: 13px;
}

.banner.replay-status {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  border-radius: 8px;
  padding: 10px 12px;
  border: 1px solid rgba(78, 167, 255, 0.3);
  background: rgba(78, 167, 255, 0.1);
  color: var(--color-text-secondary);
  font-size: 12px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.filter-bar {
  padding: 12px;
  border: 1px solid var(--color-border-soft);
  border-radius: var(--control-radius, 10px);
  background: color-mix(in srgb, var(--color-bg-card) 92%, transparent);
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.filter-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-label {
  font-size: 12px;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.filter-input,
.filter-select {
  height: var(--control-height-sm, 30px);
  padding: 0 10px;
  font-size: 13px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-page);
  min-width: 140px;
}

.filter-input:focus,
.filter-select:focus {
  border-color: var(--color-border-highlight);
  outline: none;
}

.filter-checkbox-item {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.filter-checkbox {
  cursor: pointer;
}

.filter-checkbox-label {
  font-size: 13px;
}

.order-panel {
  flex: 1;
  min-height: 0;
}

.scrollable-container {
  overflow-y: auto;
  padding-right: 4px;
}

.order-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.order-row {
  display: grid;
  grid-template-columns: 80px 1fr auto 120px;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border-radius: 12px;
  border: 1px solid var(--color-border-default);
  background: color-mix(in srgb, var(--color-bg-card) 96%, transparent);
  box-shadow: var(--shadow-sm);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.order-row:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md), 0 0 12px rgba(255, 255, 255, 0.03);
}

.team-1-card {
  border-color: rgba(55, 200, 255, 0.16);
  background: linear-gradient(90deg, rgba(55, 200, 255, 0.03) 0%, rgba(15, 23, 34, 0.94) 100%);
}

.team-1-card:hover {
  border-color: rgba(55, 200, 255, 0.4);
  box-shadow: var(--shadow-md), 0 0 15px rgba(55, 200, 255, 0.08);
}

.team-1-card .order-code-badge {
  border-color: rgba(55, 200, 255, 0.35);
  background: rgba(55, 200, 255, 0.1);
  color: var(--color-team1-primary, #37c8ff);
}

.team-1-card .team-badge {
  background: rgba(55, 200, 255, 0.12);
  border: 1px solid rgba(55, 200, 255, 0.25);
  color: var(--color-team1-primary, #37c8ff);
}

.team-2-card {
  border-color: rgba(255, 155, 69, 0.16);
  background: linear-gradient(90deg, rgba(255, 155, 69, 0.03) 0%, rgba(15, 23, 34, 0.94) 100%);
}

.team-2-card:hover {
  border-color: rgba(255, 155, 69, 0.4);
  box-shadow: var(--shadow-md), 0 0 15px rgba(255, 155, 69, 0.08);
}

.team-2-card .order-code-badge {
  border-color: rgba(255, 155, 69, 0.35);
  background: rgba(255, 155, 69, 0.1);
  color: var(--color-team2-primary, #ff9b45);
}

.team-2-card .team-badge {
  background: rgba(255, 155, 69, 0.12);
  border: 1px solid rgba(255, 155, 69, 0.25);
  color: var(--color-team2-primary, #ff9b45);
}

.team-neutral-card {
  border-color: var(--color-border-default);
}

.team-neutral-card .order-code-badge {
  border-color: var(--color-border-highlight);
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
}

.team-neutral-card .team-badge {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-secondary);
}

.order-code-badge {
  width: 54px;
  height: 38px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: monospace, monospace;
}

.order-hash {
  font-size: 12px;
  opacity: 0.6;
  margin-right: 1px;
}

.order-num {
  font-size: 16px;
  font-weight: 800;
}

.order-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.squad-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.squad-title strong {
  font-size: 15px;
  color: var(--color-text-primary);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.leader-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.leader-icon {
  font-size: 12px;
  opacity: 0.7;
}

.leader-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.order-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.meta-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 6px;
  white-space: nowrap;
}

.squad-id-badge {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-muted);
}

.order-time {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-muted);
  text-align: right;
}

.time-icon {
  font-size: 11px;
  opacity: 0.7;
}

.time-text {
  font-family: monospace;
}

@media (max-width: 1000px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .order-row {
    grid-template-columns: 60px 1fr;
    gap: 12px;
    padding: 10px 12px;
  }

  .order-meta {
    grid-column: 2;
    margin-top: 2px;
  }

  .order-time {
    grid-column: 2;
    justify-content: flex-start;
    margin-top: 2px;
  }
}
</style>
