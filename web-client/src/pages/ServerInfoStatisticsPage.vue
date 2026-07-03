<template>
  <div class="server-stats-page">
    <!-- ─── 顶部 KPI 光带 ─────────────────────────────────────────── -->
    <header class="stats-header">
      <div class="kpi-hub">
        <div
          v-for="m in kpiMetrics"
          :key="m.label"
          class="kpi-tile"
          :class="`tone-${m.tone}`"
        >
          <span class="kpi-label">{{ m.label }}</span>
          <div class="kpi-number">
            {{ m.value }}<small v-if="m.suffix">{{ m.suffix }}</small>
          </div>
          <div class="kpi-bar" :style="{ background: m.color, width: `${m.pct}%` }" />
        </div>
        <div class="kpi-tile tone-info kpi-meta-tile">
          <span class="kpi-label">WINDOW</span>
          <div class="kpi-number">{{ activeRangeLabel }}</div>
          <span class="kpi-sub">{{ lastUpdatedLabel }}</span>
        </div>
      </div>

      <div class="header-actions">
        <span class="refresh-mode-badge" :class="{ paused: hasCustomSelection }">
          {{ hasCustomSelection ? 'PAUSED' : 'POLLING' }}
        </span>
        <button class="hdr-btn icon" title="选择历史日期" @click="openDateDialog">📅</button>
        <button class="hdr-btn primary" :disabled="loading" @click="refreshAll">
          <span v-if="loading" class="spin">◌</span>
          <span v-else>↺</span>
          {{ loading ? '刷新中' : '刷新' }}
        </button>
      </div>
    </header>

    <div class="stats-body">
      <!-- ─── 左侧控制栏 ───────────────────────────────────────────── -->
      <aside class="stats-sidebar">
        <!-- 时间窗口 -->
        <section class="sidebar-section">
          <div class="section-head">
            <span class="section-icon">🕒</span>
            <span class="section-title">TIME WINDOW</span>
          </div>
          <div class="range-grid">
            <button
              v-for="r in SERVER_METRIC_RANGES"
              :key="r.key"
              class="range-btn"
              :class="{ active: selectedRange === r.key && !hasCustomSelection }"
              @click="setRange(r.key)"
            >
              {{ r.label }}
            </button>
          </div>
        </section>

        <!-- 指标通道 -->
        <section class="sidebar-section">
          <div class="section-head">
            <span class="section-icon">📡</span>
            <span class="section-title">DATA CHANNELS</span>
          </div>
          <div class="channel-list">
            <button
              v-for="c in channels"
              :key="c.key"
              class="channel-strip"
              :class="{ enabled: isChannelEnabled(c.key) }"
              @click="toggleChannel(c.key)"
            >
              <div class="cs-left">
                <span class="cs-dot" :style="{ background: c.color }" />
                <span class="cs-name">{{ c.label }}</span>
              </div>
              <span class="cs-val">
                {{ currentMetrics[c.key]?.toFixed(c.axis === 'tps' ? 1 : 0) ?? '—' }}
              </span>
            </button>
          </div>
        </section>

        <!-- 衍生统计 -->
        <section class="sidebar-section analytics-section">
          <div class="section-head">
            <span class="section-icon">📊</span>
            <span class="section-title">ANALYTICS</span>
          </div>
          <div class="analytics-grid">
            <div class="anlx-item">
              <span class="anlx-label">峰值人数</span>
              <span class="anlx-value">{{ peakPlayers }}</span>
            </div>
            <div class="anlx-item">
              <span class="anlx-label">平均 TPS</span>
              <span class="anlx-value">{{ avgTps.toFixed(2) }}</span>
            </div>
            <div class="anlx-item">
              <span class="anlx-label">数据样本</span>
              <span class="anlx-value">{{ samples.length }}</span>
            </div>
            <div class="anlx-item">
              <span class="anlx-label">运行状态</span>
              <span class="anlx-value status-active">ACTIVE</span>
            </div>
          </div>
        </section>

        <div class="sidebar-footer-tag">
          BZSS PANEL · {{ refreshModeLabel }}
        </div>
      </aside>

      <!-- ─── 主图表区 ─────────────────────────────────────────────── -->
      <main class="chart-stage">
        <DataState
          :loading="loading && !hasData"
          :error="blockingError"
          :empty="!loading && !hasData && !blockingError"
        >
          <div class="chart-wrap">
            <div class="chart-grid-overlay" />
            <ServerMetricsChart
              :samples="samples"
              :channels="channels"
              :enabled-channels="enabledChannels"
              :tooltip-stats-by-timestamp="tooltipStatsByTimestamp"
              class="chart-component"
            />
          </div>
        </DataState>
      </main>
    </div>

    <!-- 日期选择对话框 -->
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
  tooltipStatsByTimestamp,
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

// 辅助：通道是否已启用（兼容 boolean 和 Record）
function isChannelEnabled(key: string): boolean {
  const v = (enabledChannels as any)[key];
  return v !== false;
}

// 衍生统计
const peakPlayers = computed(() => {
  if (!samples.value.length) return 0;
  return Math.max(...samples.value.map((s) => s.metrics.players ?? 0));
});

const avgTps = computed(() => {
  if (!samples.value.length) return 0;
  const tpsSamples = samples.value.map((s) => s.metrics.tps).filter((v) => v != null) as number[];
  if (!tpsSamples.length) return 0;
  return tpsSamples.reduce((a, b) => a + b, 0) / tpsSamples.length;
});

const playerCount = computed(() => currentMetrics.value.players ?? 0);
const maxPlayers = 100;

const kpiMetrics = computed(() => [
  {
    label: "ONLINE",
    value: playerCount.value,
    suffix: "/100",
    color: "#38bdf8",
    tone: "info",
    pct: Math.min(100, (playerCount.value / maxPlayers) * 100),
  },
  {
    label: "SERVER TPS",
    value: currentMetrics.value.tps?.toFixed(1) ?? "--",
    suffix: "",
    color: "#10b981",
    tone: tpsTone.value,
    pct: Math.min(100, ((currentMetrics.value.tps ?? 0) / 50) * 100),
  },
  {
    label: "QUEUE",
    value: currentMetrics.value.queue ?? 0,
    suffix: "",
    color: "#f59e0b",
    tone: "warn",
    pct: Math.min(
      100,
      ((currentMetrics.value.queue ?? 0) / 50) * 100,
    ),
  },
]);

const refreshModeLabel = computed(() => (hasCustomSelection.value ? "PAUSED" : "POLLING"));
const blockingError = computed(() => (historyError.value && !hasData.value ? historyError.value : ""));

onMounted(() => {
  void start();
});
onUnmounted(() => {
  stop();
});
</script>

<style scoped>
/* ─── 页面根容器 ─────────────────────────────────────────────────── */
.server-stats-page {
  /* 占满内容区，不让 body 滚动 */
  height: 100%;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(ellipse 60% 30% at 50% 0%, color-mix(in srgb, var(--theme-brand-glow) 70%, transparent), transparent),
    radial-gradient(ellipse 40% 40% at 80% 60%, color-mix(in srgb, var(--theme-warn-glow) 52%, transparent), transparent),
    var(--theme-background-flat);
  color: var(--color-text-primary);
  overflow: hidden;
  font-family: "Segoe UI Variable Text", "Inter", "PingFang SC", "Microsoft YaHei", sans-serif;
}

/* ─── 顶部 Header ────────────────────────────────────────────────── */
.stats-header {
  height: 58px;
  padding: 0 20px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  background:
    var(--theme-panel-highlight),
    color-mix(in srgb, var(--color-bg-card) 94%, transparent);
  border-bottom: 1px solid var(--color-border-default);
  backdrop-filter: blur(12px);
}

/* 品牌区 */
.header-branding {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}

.live-indicator {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #475569;
  flex-shrink: 0;
}

.live-indicator.polling {
  background: #ef4444;
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.6);
  animation: pulse-dot 2s infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; box-shadow: 0 0 8px rgba(239, 68, 68, 0.6); }
  50% { opacity: 0.5; box-shadow: 0 0 3px rgba(239, 68, 68, 0.3); }
}

.header-titles {
  display: grid;
  gap: 1px;
}

.header-title {
  margin: 0;
  font-size: 14px;
  font-weight: 900;
  color: var(--color-text-primary);
  letter-spacing: 0.5px;
  line-height: 1.1;
}

.header-sub {
  font-size: 10px;
  color: var(--color-text-muted);
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;
  white-space: nowrap;
}

/* KPI Hub */
.kpi-hub {
  display: flex;
  gap: 6px;
  flex: 1;
  justify-content: center;
  align-items: stretch;
}

.kpi-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 110px;
  padding: 5px 14px 7px;
  border-radius: 10px;
  border: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--theme-panel-rim) 85%, transparent), transparent),
    color-mix(in srgb, var(--color-bg-elevated) 88%, transparent);
  overflow: hidden;
  transition: border-color 0.2s ease;
}

.kpi-tile:hover {
  border-color: var(--color-border-highlight);
}

.kpi-label {
  font-size: 8px;
  font-weight: 900;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 2px;
}

.kpi-number {
  font-size: 22px;
  font-weight: 950;
  font-family: 'JetBrains Mono', monospace;
  line-height: 1;
  color: var(--color-text-primary);
}

.kpi-number small {
  font-size: 10px;
  color: var(--color-text-secondary);
  margin-left: 2px;
  font-weight: 500;
}

.kpi-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2px;
  border-radius: 1px;
  opacity: 0.7;
  transition: width 0.5s ease;
}

/* KPI 颜色语义 */
.kpi-tile.tone-info .kpi-number { color: #38bdf8; }
.kpi-tile.tone-ok .kpi-number { color: #10b981; }
.kpi-tile.tone-warn .kpi-number { color: #f59e0b; }
.kpi-tile.tone-critical .kpi-number { color: #ef4444; }

.kpi-meta-tile {
  min-width: 140px;
}

.kpi-meta-tile .kpi-number {
  font-size: 14px;
  margin-top: 2px;
}

.kpi-sub {
  font-size: 9px;
  color: var(--color-text-muted);
  font-family: 'JetBrains Mono', monospace;
  margin-top: 1px;
}

/* 右侧操作区 */
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.refresh-mode-badge {
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid rgba(52, 211, 153, 0.3);
  background: rgba(52, 211, 153, 0.08);
  color: #34d399;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.08em;
  display: inline-flex;
  align-items: center;
}

.refresh-mode-badge.paused {
  border-color: rgba(245, 158, 11, 0.3);
  background: rgba(245, 158, 11, 0.08);
  color: #f59e0b;
}

.hdr-btn {
  height: 30px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: color-mix(in srgb, var(--color-bg-elevated) 88%, transparent);
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: all 0.14s ease;
}

.hdr-btn:hover:not(:disabled) {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.hdr-btn.icon {
  width: 30px;
  padding: 0;
  justify-content: center;
}

.hdr-btn.primary {
  background: rgba(37, 99, 235, 0.2);
  color: #93c5fd;
  border-color: rgba(37, 99, 235, 0.35);
  min-width: 72px;
}

.hdr-btn.primary:hover:not(:disabled) {
  background: rgba(37, 99, 235, 0.32);
  color: #bfdbfe;
}

.hdr-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.spin {
  display: inline-block;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ─── Body 区：左栏 + 图表 ───────────────────────────────────────── */
.stats-body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

/* ─── 左侧栏 ─────────────────────────────────────────────────────── */
.stats-sidebar {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 14px 14px 10px;
  border-right: 1px solid var(--color-border-soft);
  background:
    var(--theme-panel-highlight),
    color-mix(in srgb, var(--color-bg-card) 94%, transparent);
  overflow-y: auto;
  overflow-x: hidden;
}

.stats-sidebar::-webkit-scrollbar { width: 4px; }
.stats-sidebar::-webkit-scrollbar-thumb { border-radius: 2px; background: color-mix(in srgb, var(--color-border-default) 90%, transparent); }

.sidebar-section {
  margin-bottom: 18px;
}

.section-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 9px;
}

.section-icon {
  font-size: 11px;
  opacity: 0.45;
}

.section-title {
  font-size: 9px;
  font-weight: 900;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
}

/* 时间窗口格子 */
.range-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
}

.range-btn {
  height: 30px;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid var(--color-border-soft);
  background: color-mix(in srgb, var(--color-bg-elevated) 86%, transparent);
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.range-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
  border-color: var(--color-border-default);
}

.range-btn.active {
  background: rgba(56, 189, 248, 0.14);
  color: #38bdf8;
  border-color: rgba(56, 189, 248, 0.35);
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.1);
}

/* 指标通道列表 */
.channel-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.channel-strip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 34px;
  padding: 0 10px;
  border-radius: 7px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.14s ease;
}

.channel-strip:hover {
  background: color-mix(in srgb, var(--color-bg-elevated) 84%, transparent);
  color: var(--color-text-secondary);
}

.channel-strip.enabled {
  color: var(--color-text-primary);
  border-color: var(--color-border-default);
  background: color-mix(in srgb, var(--color-bg-elevated) 88%, transparent);
}

.cs-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.cs-dot {
  width: 4px;
  height: 14px;
  border-radius: 2px;
  flex-shrink: 0;
  opacity: 0.85;
}

.channel-strip:not(.enabled) .cs-dot {
  opacity: 0.2;
}

.cs-name {
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cs-val {
  font-size: 12px;
  font-weight: 800;
  font-family: 'JetBrains Mono', monospace;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.channel-strip.enabled .cs-val {
  color: var(--color-text-secondary);
}

/* 衍生分析区 */
.analytics-section {
  padding: 11px;
  border-radius: 10px;
  border: 1px solid var(--color-border-soft);
  background: color-mix(in srgb, var(--color-bg-card) 90%, transparent);
}

.analytics-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.anlx-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.anlx-label {
  font-size: 8px;
  font-weight: 800;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.anlx-value {
  font-size: 13px;
  font-weight: 900;
  color: var(--color-text-secondary);
  font-family: 'JetBrains Mono', monospace;
}

.anlx-value.status-active {
  color: #34d399;
  font-size: 10px;
}

/* 底部版本标签 */
.sidebar-footer-tag {
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--color-border-soft);
  font-size: 8px;
  color: var(--color-text-muted);
  font-weight: 800;
  letter-spacing: 0.5px;
}

/* ─── 图表区 ──────────────────────────────────────────────────────── */
.chart-stage {
  flex: 1;
  min-width: 0;
  height: 100%;
  background: color-mix(in srgb, var(--color-bg-page) 96%, transparent);
  position: relative;
}

.chart-wrap {
  position: relative;
  width: 100%;
  height: 100%;
}

/* 细网格底纹 */
.chart-grid-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(var(--theme-grid-color) 1px, transparent 1px),
    linear-gradient(90deg, var(--theme-grid-color) 1px, transparent 1px);
  background-size: 60px 60px;
  mask-image: linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.35) 15%, rgba(0,0,0,0.35) 85%, transparent 100%);
}

.chart-component {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

:deep(.bz-data-state),
:deep(.state-shell),
:deep(.state-content) {
  height: 100% !important;
  display: flex !important;
  flex-direction: column !important;
}

/* ─── 响应式 ─────────────────────────────────────────────────────── */
@media (max-width: 1000px) {
  .stats-body {
    flex-direction: column;
    overflow-y: auto;
  }

  .stats-sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--color-border-soft);
    padding: 12px 16px;
  }

  .kpi-hub {
    gap: 4px;
  }

  .kpi-tile {
    min-width: 90px;
  }
}

@media (max-width: 680px) {
  .stats-header {
    flex-wrap: wrap;
    height: auto;
    padding: 10px 14px;
    gap: 10px;
  }

  .kpi-hub {
    order: 3;
    width: 100%;
  }
}
</style>
