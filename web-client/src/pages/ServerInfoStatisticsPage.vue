<template>
  <div class="server-stats-page">
    <!-- Toolbar -->
    <ServerStatsToolbar
      :current-server="currentServer"
      :current-match="currentMatch"
      :selected-range="selectedRange"
      :has-custom-selection="hasCustomSelection"
      :is-polling="isPolling"
      :is-stale="summary.stale"
      :loading="loading"
      @set-range="setRange"
      @open-dates="openDateDialog"
      @refresh="refreshAll"
    />

    <!-- Navigation Tabs -->
    <div class="tabs-nav">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="tab-btn"
        :class="{ active: activeTab === t.key }"
        @click="activeTab = t.key"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- Main Content Stage -->
    <div class="stage-content">
      <DataState
        :loading="loading && !hasData"
        :error="blockingError"
        :empty="!loading && !hasData && !blockingError"
      >
        <!-- 1. Overview Tab -->
        <div v-if="activeTab === 'overview'" class="tab-pane overview-pane">
          <ServerStatsSameTimeWindow
            :target-time="targetTime"
            :window-minutes="windowMinutes"
            :lookback-days="lookbackDays"
            :same-weekday-only="sameWeekdayOnly"
            :series="sameTimeSeries"
            :summary="sameTimeSummary"
            :loading="loadingSameTime"
            :error="sameTimeError"
            :max-players="currentServer?.maxPlayers ?? 100"
            :using-custom-dates="usingCustomSameTimeDates"
            :selected-date-count="selectedDates.length"
            @update:target-time="targetTime = $event"
            @update:window-minutes="windowMinutes = $event"
            @update:lookback-days="lookbackDays = $event"
            @update:same-weekday-only="sameWeekdayOnly = $event"
            @set-now="setTargetToNow"
            @open-dates="openDateDialog"
            @refresh="loadSameTime"
          />

          <ServerStatsKpiGrid
            :current-metrics="currentMetrics"
            :samples="samples"
            :summary="summary"
            :max-players="currentServer?.maxPlayers ?? 100"
            :max-queue="currentServer?.maxQueue ?? 50"
          />

          <div class="live-chart-stage">
            <ServerPopulationChart
              v-if="chartStage >= 1"
              :samples="samples"
              :max-players="currentServer?.maxPlayers ?? 100"
              :match-started-at="currentMatch?.startedAt ?? null"
            />
          </div>

          <div class="secondary-grid">
            <ServerStatsInsightPanel :summary="summary" />
            <div class="tps-stage">
              <ServerTpsChart v-if="chartStage >= 2" :samples="samples" :summary="summary" />
            </div>
          </div>
        </div>

        <!-- 2. Trend Analysis Tab -->
        <div v-else-if="activeTab === 'trend'" class="tab-pane">
          <ServerStatsAnalyticsView :samples="samples" />
        </div>

        <!-- 3. Historical Comparison Tab -->
        <div v-else-if="activeTab === 'compare'" class="tab-pane">
          <ServerStatsComparisonView
            :available-dates="availableDates"
            :compare-dates="compareDates"
            :align-mode="alignMode"
            :aligned-comparison-series="alignedComparisonSeries"
            :loading-compare="loadingCompare"
            @toggle-compare-date="toggleCompareDate"
            @set-align-mode="alignMode = $event"
          />
        </div>
      </DataState>
    </div>

    <!-- Custom Date Range Dialog -->
    <ServerStatsDateRangePicker
      :open="showDateDialog"
      :available-dates="availableDates"
      :selected-dates="selectedDates"
      @close="closeDateDialog"
      @toggle-date="toggleDate"
      @reset="resetSelectedDates"
      @apply="applySelectedDates"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from "vue";
import DataState from "../components/common/DataState.vue";
import ServerStatsToolbar from "../components/server-stats/ServerStatsToolbar.vue";
import ServerStatsKpiGrid from "../components/server-stats/ServerStatsKpiGrid.vue";
import ServerStatsSameTimeWindow from "../components/server-stats/ServerStatsSameTimeWindow.vue";
import ServerPopulationChart from "../components/server-stats/ServerPopulationChart.vue";
import ServerTpsChart from "../components/server-stats/ServerTpsChart.vue";
import ServerStatsInsightPanel from "../components/server-stats/ServerStatsInsightPanel.vue";
import ServerStatsAnalyticsView from "../components/server-stats/ServerStatsAnalyticsView.vue";
import ServerStatsComparisonView from "../components/server-stats/ServerStatsComparisonView.vue";
import ServerStatsDateRangePicker from "../components/server-stats/ServerStatsDateRangePicker.vue";
import { useServerMetrics } from "../composables/useServerMetrics";

const metrics = useServerMetrics();

const {
  loading,
  historyError,
  availableDates,
  samples,
  selectedRange,
  selectedDates,
  showDateDialog,
  currentMetrics,
  hasData,
  hasCustomSelection,
  summary,
  isPolling,
  currentServer,
  currentMatch,
  targetTime,
  windowMinutes,
  lookbackDays,
  sameWeekdayOnly,
  loadingSameTime,
  sameTimeError,
  sameTimeSeries,
  sameTimeSummary,
  usingCustomSameTimeDates,
  loadSameTime,
  setTargetToNow,

  // Compare bindings
  compareDates,
  alignMode,
  loadingCompare,
  alignedComparisonSeries,
  toggleCompareDate,

  start,
  stop,
  openDateDialog,
  closeDateDialog,
  toggleDate,
  resetSelectedDates,
  applySelectedDates,
  setRange,
  refreshAll,
} = metrics;

const activeTab = ref<"overview" | "trend" | "compare">("overview");

const tabs = [
  { key: "overview", label: "实时与历史同期" },
  { key: "trend", label: "全天趋势" },
  { key: "compare", label: "自选日期对比" },
] as const;

const blockingError = computed(() => (historyError.value && !hasData.value ? historyError.value : ""));

const chartStage = ref(0);
let chartFrameOne: number | null = null;
let chartFrameTwo: number | null = null;
let pageActive = false;

function cancelChartFrames() {
  if (chartFrameOne !== null) cancelAnimationFrame(chartFrameOne);
  if (chartFrameTwo !== null) cancelAnimationFrame(chartFrameTwo);
  chartFrameOne = null;
  chartFrameTwo = null;
}

async function scheduleCharts() {
  cancelChartFrames();
  chartStage.value = 0;
  if (!pageActive || activeTab.value !== "overview" || !hasData.value) return;
  await nextTick();
  chartFrameOne = requestAnimationFrame(() => {
    chartFrameOne = null;
    if (!pageActive || activeTab.value !== "overview") return;
    chartStage.value = 1;
    chartFrameTwo = requestAnimationFrame(() => {
      chartFrameTwo = null;
      if (pageActive && activeTab.value === "overview") chartStage.value = 2;
    });
  });
}

function activateStatsPage() {
  if (pageActive) return;
  pageActive = true;
  void start();
  void scheduleCharts();
}

function deactivateStatsPage() {
  if (!pageActive) return;
  pageActive = false;
  cancelChartFrames();
  chartStage.value = 0;
  stop();
}

watch([hasData, activeTab], () => {
  void scheduleCharts();
});

onMounted(activateStatsPage);
onActivated(activateStatsPage);
onDeactivated(deactivateStatsPage);
onUnmounted(deactivateStatsPage);
</script>

<style scoped>
.server-stats-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--theme-background-flat);
  color: var(--color-text-primary);
  overflow: hidden;
  font-family: "Segoe UI Variable Text", "Inter", "PingFang SC", "Microsoft YaHei", sans-serif;
}

/* Tabs Navigation Styling */
.tabs-nav {
  display: flex;
  padding: 0 20px;
  background: var(--stats-panel, var(--color-bg-card));
  border-bottom: 1px solid var(--stats-panel-border, var(--color-border-soft));
  gap: 16px;
  flex-shrink: 0;
}

.tab-btn {
  height: 40px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--color-text-muted);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  padding: 0 4px;
  transition: all 0.15s ease;
}

.tab-btn:hover {
  color: var(--color-text-primary);
}

.tab-btn.active {
  color: var(--color-brand-primary);
  border-bottom-color: var(--color-brand-primary);
}

/* Content Container styling */
.stage-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

.tab-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.overview-pane {
  padding: 16px;
  overflow-y: auto;
}

.live-chart-stage {
  margin-bottom: 16px;
}

.secondary-grid {
  display: grid;
  grid-template-columns: minmax(300px, 0.36fr) minmax(0, 0.64fr);
  gap: 16px;
}

.tps-stage {
  min-width: 0;
}

@media (max-width: 1024px) {
  .secondary-grid {
    grid-template-columns: 1fr;
  }
}

/* Deep wrappers to ensure loading/error states match layout bounds */
:deep(.bz-data-state),
:deep(.state-shell),
:deep(.state-content) {
  height: 100% !important;
  display: flex !important;
  flex-direction: column !important;
}
</style>
