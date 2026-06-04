<template>
  <div class="server-stats-page">
    <!-- 第一栏：极简战术顶栏 (人数、TPS、排队) -->
    <header class="tactical-header">
      <div class="h-branding">
        <span class="pulse-dot"></span>
        <h1 class="title">性能审计 <span>AUDIT</span></h1>
      </div>
      
      <div class="kpi-center-hub">
        <div class="kpi-widget" v-for="m in kpiMetrics" :key="m.label" :data-tone="m.tone">
          <div class="k-info">
            <span class="k-lbl">{{ m.label }}</span>
            <span class="k-val">{{ m.value }}<small v-if="m.suffix">{{ m.suffix }}</small></span>
          </div>
          <div class="k-spark" :style="{ background: m.color }"></div>
        </div>
      </div>

      <div class="h-ctrl">
        <div class="sync-pill">
          <span class="l">SYNC</span>
          <span class="v">{{ lastUpdatedLabel }}</span>
        </div>
        <button class="tactical-btn icon" title="选择日期" @click="openDateDialog">📅</button>
        <button class="tactical-btn primary" :disabled="loading" @click="refreshAll">
          {{ loading ? '...' : 'REFRESH' }}
        </button>
      </div>
    </header>

    <div class="layout-main">
      <!-- 左栏：控制与选项 -->
      <aside class="side-command-panel">
        <!-- 块 1：时间范围 -->
        <div class="cmd-block">
          <div class="block-head"><span class="i">🕒</span> TIME WINDOW</div>
          <div class="range-grid">
            <button
              v-for="r in SERVER_METRIC_RANGES"
              :key="r.key"
              class="range-cell"
              :class="{ active: selectedRange === r.key }"
              @click="setRange(r.key)"
            >
              {{ r.label }}
            </button>
          </div>
        </div>

        <!-- 块 2：高级统计 (Enrichment) -->
        <div class="cmd-block technical-stats">
          <div class="block-head"><span class="i">📊</span> ANALYTICS</div>
          <div class="tech-grid">
            <div class="tech-item">
              <span class="tl">PEAK PLAYERS</span>
              <span class="tv">{{ peakPlayers }}</span>
            </div>
            <div class="tech-item">
              <span class="tl">AVG TPS (LOGIC)</span>
              <span class="tv">{{ avgTps.toFixed(2) }}</span>
            </div>
            <div class="tech-item">
              <span class="tl">DATA SAMPLES</span>
              <span class="tv">{{ samples.length }}</span>
            </div>
            <div class="tech-item">
              <span class="tl">UPTIME REF</span>
              <span class="tv">ACTIVE</span>
            </div>
          </div>
        </div>

        <!-- 块 3：通道控制 -->
        <div class="cmd-block channels-manager">
          <div class="block-head"><span class="i">📡</span> DATA CHANNELS</div>
          <div class="channel-list">
            <button
              v-for="c in channels"
              :key="c.key"
              class="channel-strip"
              :class="{ disabled: !Array.isArray(enabledChannels) || !enabledChannels.includes(c.key) }"
              @click="toggleChannel(c.key)"
            >
              <div class="c-left">
                <span class="c-dot" :style="{ background: c.color }"></span>
                <span class="c-name">{{ c.label }}</span>
              </div>
              <div class="c-right">
                <span class="c-val">{{ currentMetrics[c.key]?.toFixed(c.axis === 'tps' ? 1 : 0) ?? '-' }}</span>
              </div>
            </button>
          </div>
        </div>

        <div class="panel-status-tag">
          COMMAND CENTER v2.4 | {{ refreshModeLabel }}
        </div>
      </aside>

      <!-- 其余空间：全屏图表 -->
      <main class="viewport-stage">
        <DataState
          :loading="loading && !hasData"
          :error="blockingError"
          :empty="!loading && !hasData && !blockingError"
        >
          <div class="chart-canvas-container">
            <!-- 视觉点缀：网格底纹 -->
            <div class="grid-overlay"></div>
            <ServerMetricsChart
              :samples="samples"
              :channels="channels"
              :enabled-channels="enabledChannels"
              class="integrated-chart"
            />
          </div>
        </DataState>
      </main>
    </div>

    <ServerMetricsDateDialog
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
import { computed, onMounted, onUnmounted } from "vue";
import DataState from "../components/common/DataState.vue";
import ServerMetricsChart from "../components/server-stats/ServerMetricsChart.vue";
import ServerMetricsDateDialog from "../components/server-stats/ServerMetricsDateDialog.vue";
import {
  SERVER_METRIC_RANGES,
  useServerMetrics,
} from "../composables/useServerMetrics";

const metrics = useServerMetrics();

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

// 计算衍生统计数据用于丰富排版
const peakPlayers = computed(() => {
  if (!samples.value.length) return 0;
  return Math.max(...samples.value.map(s => s.metrics.playerCount ?? 0));
});

const avgTps = computed(() => {
  if (!samples.value.length) return 0;
  const tpsSamples = samples.value.map(s => s.metrics.tps).filter(v => v != null) as number[];
  if (!tpsSamples.length) return 0;
  return tpsSamples.reduce((a, b) => a + b, 0) / tpsSamples.length;
});

const kpiMetrics = computed(() => [
  { label: 'ONLINE', value: currentMetrics.value.playerCount ?? 0, suffix: '/100', color: '#60a5fa', tone: 'info' },
  { label: 'SERVER TPS', value: currentMetrics.value.tps?.toFixed(1) ?? '--', color: '#10b981', tone: tpsTone.value },
  { label: 'QUEUE', value: (currentMetrics.value.publicQueue ?? 0) + (currentMetrics.value.reserveQueue ?? 0), color: '#f59e0b', tone: 'warn' },
]);

const refreshModeLabel = computed(() => (hasCustomSelection.value ? "PAUSED" : "POLLING"));
const blockingError = computed(() => (historyError.value && !hasData.value ? historyError.value : ""));

onMounted(() => { void start(); });
onUnmounted(() => { stop(); });
</script>

<style scoped>
.server-stats-page {
  height: calc(100vh - 48px);
  margin: -24px;
  display: flex;
  flex-direction: column;
  background: #05070a;
  color: #f1f5f9;
  overflow: hidden;
  font-family: 'Inter', -apple-system, sans-serif;
}

/* Header */
.tactical-header {
  height: 52px;
  background: rgba(10, 15, 26, 0.95);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  padding: 0 24px;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.h-branding { display: flex; align-items: center; gap: 12px; }
.pulse-dot { width: 6px; height: 6px; background: #ef4444; border-radius: 50%; box-shadow: 0 0 8px #ef4444; animation: pulse 2s infinite; }
@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }
.title { font-size: 14px; font-weight: 900; color: #fff; margin: 0; letter-spacing: 1px; }
.title span { color: #475569; font-weight: 500; }

.kpi-center-hub { display: flex; gap: 32px; flex: 1; justify-content: center; }
.kpi-widget { display: flex; flex-direction: column; min-width: 100px; position: relative; padding: 4px 0; }
.k-lbl { font-size: 8px; font-weight: 900; color: #475569; text-transform: uppercase; letter-spacing: 1px; }
.k-val { font-size: 22px; font-weight: 950; font-family: 'JetBrains Mono', monospace; line-height: 1; color: #fff; }
.k-val small { font-size: 11px; color: #334155; margin-left: 2px; }
.k-spark { position: absolute; bottom: 0; left: 0; width: 20px; height: 2px; border-radius: 1px; opacity: 0.6; }

.kpi-widget[data-tone="ok"] .k-val { color: #10b981; }
.kpi-widget[data-tone="warn"] .k-val { color: #f59e0b; }
.kpi-widget[data-tone="error"] .k-val { color: #ef4444; }
.kpi-widget[data-tone="info"] .k-val { color: #38bdf8; }

.h-ctrl { display: flex; align-items: center; gap: 16px; }
.sync-pill { display: flex; align-items: baseline; gap: 6px; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 800; color: #334155; }
.sync-pill .v { color: #38bdf8; }
.tactical-btn { background: rgba(51, 65, 85, 0.4); border: 1px solid rgba(255, 255, 255, 0.1); color: #94a3b8; padding: 4px 12px; border-radius: 4px; font-size: 10px; font-weight: 900; cursor: pointer; }
.tactical-btn.primary { background: #2563eb; color: #fff; border-color: transparent; }

/* Main Layout */
.layout-main { flex: 1; display: flex; min-height: 0; }

/* Sidebar */
.side-command-panel {
  width: 240px;
  background: #080a0f;
  border-right: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  padding: 24px;
  gap: 32px;
  flex-shrink: 0;
}

.block-head { font-size: 10px; font-weight: 900; color: #475569; display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.block-head .i { opacity: 0.5; }

.range-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.range-cell { background: rgba(30, 41, 59, 0.5); border: 1px solid rgba(255, 255, 255, 0.05); color: #64748b; font-size: 11px; font-weight: 800; padding: 8px; border-radius: 4px; cursor: pointer; transition: all 0.2s; }
.range-cell.active { background: #38bdf8; color: #000; border-color: transparent; }

.tech-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.tech-item { display: flex; flex-direction: column; }
.tl { font-size: 8px; font-weight: 800; color: #334155; }
.tv { font-size: 13px; font-weight: 900; color: #cbd5e1; font-family: 'JetBrains Mono', monospace; }

.channel-list { display: flex; flex-direction: column; gap: 2px; }
.channel-strip { 
  display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-radius: 6px;
  background: transparent; border: 1px solid transparent; cursor: pointer; color: #cbd5e1; transition: all 0.2s;
}
.channel-strip:hover { background: rgba(255,255,255,0.02); }
.c-left { display: flex; align-items: center; gap: 10px; }
.c-dot { width: 4px; height: 12px; border-radius: 1px; }
.c-name { font-size: 12px; font-weight: 700; }
.c-val { font-size: 12px; font-weight: 800; font-family: 'JetBrains Mono', monospace; color: #475569; }
.channel-strip.disabled { opacity: 0.15; filter: grayscale(1); }

.panel-status-tag { margin-top: auto; font-size: 9px; color: #2d3748; font-weight: 800; letter-spacing: 0.5px; border-top: 1px solid rgba(255,255,255,0.03); padding-top: 16px; }

/* Chart Area */
.viewport-stage { 
  flex: 1; 
  display: flex; 
  flex-direction: column; 
  min-width: 0; 
  background: #05070a; 
  height: 100%;
}

.chart-canvas-container {
  flex: 1;
  position: relative;
  height: 100%;
  display: block;
}

:deep(.bz-data-state),
:deep(.state-shell),
:deep(.state-content) {
  height: 100% !important;
  display: flex !important;
  flex-direction: column !important;
}

.integrated-chart { 
  width: 100%; 
  height: 100% !important;
  position: absolute;
  top: 0;
  left: 0;
}

:deep(.integrated-chart .server-metrics-chart-surface) {
  height: 100% !important;
}

@media (max-width: 1000px) {
  .server-stats-page { margin: 0; height: 100vh; }
  .layout-main { flex-direction: column; overflow-y: auto; }
  .side-command-panel { width: 100%; height: auto; border-right: none; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
}
</style>
