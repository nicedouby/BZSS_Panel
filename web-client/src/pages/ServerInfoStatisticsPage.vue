<template>
  <AppPage full-bleed>
    <AppPageHeader
      eyebrow="插件 · 服务器监控"
      title="服务器信息统计"
      subtitle="实时玩家、TPS 与队列走势，支持当前对局和历史日期切换。"
      :status-items="statusItems"
    />

    <AppPageToolbar>
      <div class="toolbar-summary">
        <span class="toolbar-label">当前窗口</span>
        <strong class="toolbar-value">{{ activeRangeLabel }}</strong>
        <span class="toolbar-detail">{{ toolbarSummaryLabel }}</span>
      </div>

      <div class="toolbar-actions">
        <button type="button" class="toolbar-button secondary" @click="openDateDialog">
          {{ toolbarActionLabel }}
        </button>
        <button type="button" class="toolbar-button primary" :disabled="loading" @click="refreshAll">
          {{ loading ? "同步中..." : "手动刷新" }}
        </button>
      </div>
    </AppPageToolbar>

    <AppSplitLayout>
      <template #left>
        <ServerMetricsSidebar
          :ranges="SERVER_METRIC_RANGES"
          :selected-range="selectedRange"
          :current-metrics="currentMetrics"
          :channels="channels"
          :enabled-channels="enabledChannels"
          :last-updated-label="lastUpdatedLabel"
          :range-hint="rangeHint"
          :refresh-mode-label="refreshModeLabel"
          :has-custom-selection="hasCustomSelection"
          @select-range="setRange"
          @toggle-channel="toggleChannel"
        />
      </template>

      <template #right>
        <DataState
          :loading="loading && !hasData"
          :error="blockingError"
          :empty="!loading && !hasData && !blockingError"
          :stale="showStaleBanner"
          :stale-text="staleText"
        >
          <div class="server-metrics-main">
            <ServerMetricsRibbon
              :metrics="currentMetrics"
              :tps-tone="tpsTone"
              :range-label="activeRangeLabel"
              :last-updated-label="lastUpdatedLabel"
            />

            <AppCard class="server-metrics-chart-card" compact>
              <ServerMetricsChart
                :samples="samples"
                :channels="channels"
                :enabled-channels="enabledChannels"
              />
            </AppCard>
          </div>
        </DataState>
      </template>
    </AppSplitLayout>

    <ServerMetricsDateDialog
      :open="showDateDialog"
      :available-dates="availableDates"
      :selected-dates="selectedDates"
      @close="closeDateDialog"
      @toggle-date="toggleDate"
      @reset="resetSelectedDates"
      @apply="applySelectedDates"
    />
  </AppPage>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";

import AppPage from "../components/common/AppPage.vue";
import AppPageHeader from "../components/common/AppPageHeader.vue";
import AppPageToolbar from "../components/common/AppPageToolbar.vue";
import AppSplitLayout from "../components/common/AppSplitLayout.vue";
import AppCard from "../components/common/AppCard.vue";
import DataState from "../components/common/DataState.vue";
import ServerMetricsChart from "../components/server-stats/ServerMetricsChart.vue";
import ServerMetricsDateDialog from "../components/server-stats/ServerMetricsDateDialog.vue";
import ServerMetricsRibbon from "../components/server-stats/ServerMetricsRibbon.vue";
import ServerMetricsSidebar from "../components/server-stats/ServerMetricsSidebar.vue";
import {
  SERVER_METRIC_RANGES,
  useServerMetrics,
} from "../composables/useServerMetrics";

const metrics = useServerMetrics();
type StatusTone = "ok" | "warn" | "error" | "idle";

const {
  loading,
  historyError,
  availableDates,
  samples,
  channels,
  selectedRange,
  selectedDates,
  showDateDialog,
  lastUpdatedLabel,
  enabledChannels,
  currentMetrics,
  hasData,
  hasCustomSelection,
  activeRangeLabel,
  rangeHint,
  tpsTone,
  start,
  stop,
  openDateDialog,
  closeDateDialog,
  toggleDate,
  resetSelectedDates,
  toggleChannel,
  applySelectedDates,
  setRange,
  refreshAll,
} = metrics;

const headerTone = computed<StatusTone>(() => {
  if (loading.value) return "warn";
  if (historyError.value && !hasData.value) return "error";
  if (historyError.value && hasData.value) return "warn";
  return "ok";
});

const headerLabel = computed(() => {
  if (loading.value) return "同步中";
  if (historyError.value && !hasData.value) return "加载失败";
  if (historyError.value && hasData.value) return "已降级";
  return "实时在线";
});

const statusItems = computed<Array<{ label: string; tone: StatusTone }>>(() => [
  { label: headerLabel.value, tone: headerTone.value },
  { label: activeRangeLabel.value, tone: hasCustomSelection.value ? "warn" : "idle" },
  { label: lastUpdatedLabel.value === "--:--:--" ? "等待更新" : `更新 ${lastUpdatedLabel.value}`, tone: "idle" },
]);

const toolbarActionLabel = computed(() => {
  if (selectedDates.value.length > 0) {
    return `历史日期 (${selectedDates.value.length})`;
  }
  return "历史日期";
});

const toolbarSummaryLabel = computed(() => {
  if (rangeHint.value) return rangeHint.value;
  return hasCustomSelection.value ? "轮询暂停" : "每 2 秒刷新";
});

const refreshModeLabel = computed(() => (hasCustomSelection.value ? "轮询暂停" : "每 2 秒刷新"));

const blockingError = computed(() => (historyError.value && !hasData.value ? historyError.value : ""));
const showStaleBanner = computed(() => Boolean(historyError.value && hasData.value));
const staleText = computed(() => (hasCustomSelection.value
  ? "当前显示自定义日期，实时轮询已暂停。"
  : "实时刷新失败，正在显示最近一次成功同步的数据。"));

onMounted(() => {
  void start();
});

onUnmounted(() => {
  stop();
});
</script>

<style scoped>
.toolbar-summary {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.toolbar-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--color-text-muted);
}

.toolbar-value {
  font-size: 15px;
  font-weight: 800;
  color: var(--color-text-primary);
}

.toolbar-detail {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.45;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.toolbar-button {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.16s ease, border-color 0.16s ease, background-color 0.16s ease, opacity 0.16s ease;
}

.toolbar-button:hover:not(:disabled) {
  transform: translateY(-1px);
}

.toolbar-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.toolbar-button.secondary {
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-secondary);
  border-color: var(--color-border-default);
}

.toolbar-button.secondary:hover:not(:disabled) {
  color: var(--color-text-primary);
  border-color: rgba(96, 165, 250, 0.32);
}

.toolbar-button.primary {
  color: #fff;
  background: linear-gradient(180deg, rgba(96, 165, 250, 0.96), rgba(59, 130, 246, 0.96));
  border-color: rgba(96, 165, 250, 0.34);
}

.server-metrics-main {
  display: grid;
  gap: 16px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  align-content: start;
  overflow: auto;
  scrollbar-gutter: stable both-edges;
}

.server-metrics-chart-card {
  min-height: 420px;
}

:deep(.server-metrics-chart-card .card-body) {
  min-height: 420px;
}

@media (max-width: 1100px) {
  .toolbar-summary {
    width: 100%;
  }
}
</style>
