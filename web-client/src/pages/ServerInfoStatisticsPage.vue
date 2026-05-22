<template>
  <div class="page server-stats-page full-bleed">
    <!-- Top Global Header -->
    <header class="stats-header">
      <div class="header-left">
        <div class="status-indicator" :class="{ loading }">
          <div class="pulse-dot"></div>
          <span class="status-text">{{ loading ? "SYNCING" : "LIVE MONITOR" }}</span>
        </div>
        <h1 class="page-title">系统效能概览 <small>Server Metrics Dashboard</small></h1>
      </div>
      
      <div class="header-actions">
        <div class="log-calendar-trigger" @click="showCalendar = !showCalendar">
          <span class="icon">📅</span>
          <span>{{ selectedDates.length === 0 ? "所有日志" : `已选 ${selectedDates.length} 天` }}</span>
        </div>
        <button class="action-btn primary" @click="refreshAll" :disabled="loading">
          {{ loading ? "同步中..." : "手动刷新" }}
        </button>
      </div>
    </header>

    <div class="dashboard-body">
      <!-- Sidebar Controls -->
      <aside class="dashboard-sidebar">
        <div class="control-group">
          <label>视图跨度 <small>View Range</small></label>
          <div class="range-selector-vertical">
            <button
              v-for="range in ranges"
              :key="range.key"
              class="range-btn-v"
              :class="{ active: selectedRange === range.key }"
              @click="setRange(range.key)"
            >
              {{ range.label }}
            </button>
          </div>
        </div>

        <div class="control-group">
          <label>数据通道 <small>Metrics</small></label>
          <div class="channel-list-v">
            <button
              v-for="channel in channels"
              :key="channel.key"
              class="channel-btn-v"
              :class="{ enabled: enabledChannels[channel.key] }"
              @click="toggleChannel(channel.key)"
            >
              <div class="channel-info">
                <span class="color-indicator" :style="{ backgroundColor: channel.color }" />
                <span class="label">{{ channel.label }}</span>
              </div>
              <span class="value">{{ currentMetrics[channel.key] ?? "-" }}</span>
            </button>
          </div>
        </div>

        <div class="sidebar-footer">
          <div class="update-info">
            <span class="label">最后心跳</span>
            <span class="value">{{ lastUpdatedLabel }}</span>
          </div>
        </div>
      </aside>

      <!-- Main Chart Area -->
      <main class="chart-container">
        <!-- Live Metrics Ribbon -->
        <div class="metrics-ribbon">
          <div class="metric-item">
            <span class="m-label">在线人数</span>
            <span class="m-value">{{ currentMetrics.players ?? "-" }} <small>pax</small></span>
          </div>
          <div class="metric-divider"></div>
          <div class="metric-item" :class="tpsTone">
            <span class="m-label">核心帧率</span>
            <span class="m-value">{{ currentMetrics.tps ?? "-" }} <small>tps</small></span>
          </div>
          <div class="metric-divider"></div>
          <div class="metric-item">
            <span class="m-label">队列积压</span>
            <span class="m-value">{{ currentMetrics.queue ?? "-" }} <small>queue</small></span>
          </div>
        </div>

        <div class="chart-wrapper">
          <div ref="chartRef" class="stats-chart-main" />
        </div>
      </main>
    </div>

    <!-- Date Picker Overlay -->
    <div v-if="showCalendar" class="modal-overlay" @click.self="showCalendar = false">
      <div class="modal-window compact">
        <header class="modal-head">
          <h3>日志历史库</h3>
          <button @click="showCalendar = false" class="close-icon">×</button>
        </header>
        <div class="modal-main">
          <div class="date-grid">
            <button
              v-for="date in availableDates"
              :key="date"
              class="date-cell"
              :class="{ active: selectedDates.includes(date) }"
              @click="toggleDate(date)"
            >
              {{ date }}
            </button>
          </div>
          <div v-if="availableDates.length === 0" class="empty-hint">暂无历史归档</div>
        </div>
        <footer class="modal-foot">
          <button class="ghost-btn" @click="selectedDates = []">重置</button>
          <button class="solid-btn" @click="applyDates">载入分析</button>
        </footer>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, reactive, computed } from "vue";
import * as echarts from "echarts";

interface MetricSample {
  timestamp_ms: number;
  metrics: Record<string, number>;
  virtual?: boolean;
}

interface Channel {
  key: string;
  label: string;
  unit: string;
  color: string;
  axis: string;
  enabledByDefault: boolean;
}

interface RangeKey {
  key: string;
  label: string;
  hours: number;
}

const ranges: RangeKey[] = [
  { key: "1h", label: "1 小时", hours: 1 },
  { key: "6h", label: "6 小时", hours: 6 },
  { key: "12h", label: "12 小时", hours: 12 },
  { key: "24h", label: "24 小时", hours: 24 },
];

const chartRef = ref<HTMLElement | null>(null);
const chartInstance = shallowRef<echarts.ECharts | null>(null);
const loading = ref(false);
const samples = ref<MetricSample[]>([]);
const channels = ref<Channel[]>([]);
const availableDates = ref<string[]>([]);
const selectedRange = ref("24h");
const showCalendar = ref(false);
const selectedDates = ref<string[]>([]);
const lastUpdated = ref<number | null>(null);

const enabledChannels = reactive<Record<string, boolean>>({});

const currentMetrics = computed(() => {
  if (samples.value.length === 0) return {};
  return samples.value[samples.value.length - 1].metrics;
});

const tpsTone = computed(() => {
  const tps = currentMetrics.value.tps;
  if (tps == null) return "idle";
  if (tps < 20) return "critical";
  if (tps < 28) return "warn";
  return "ok";
});

const lastUpdatedLabel = computed(() => {
  if (!lastUpdated.value) return "--:--:--";
  const date = new Date(lastUpdated.value);
  return date.toLocaleTimeString([], { hour12: false });
});

let pollTimer: number | null = null;

async function fetchAvailableDates() {
  try {
    const res = await fetch("/api/server-stats/dates");
    const data = await res.json();
    availableDates.value = data.dates || [];
  } catch (error) {
    console.error("Failed to fetch available dates:", error);
  }
}

async function loadHistory() {
  loading.value = true;
  try {
    let url = "/api/server-stats/history?include_current=1";

    if (selectedDates.value.length > 0) {
      const sorted = [...selectedDates.value].sort();
      const fromMs = Date.parse(`${sorted[0]}T00:00:00Z`);
      const toMs = Date.parse(`${sorted[sorted.length - 1]}T23:59:59Z`);
      url += `&from_ms=${fromMs}&to_ms=${toMs}`;
      selectedRange.value = "";
    } else {
      const range = ranges.find((r) => r.key === selectedRange.value) || ranges[3];
      const toMs = Date.now();
      const fromMs = toMs - range.hours * 60 * 60 * 1000;
      url += `&from_ms=${fromMs}&to_ms=${toMs}`;
    }

    const res = await fetch(url);
    const data = await res.json();

    samples.value = data.samples || [];
    channels.value = data.channels || [];

    channels.value.forEach((c) => {
      if (enabledChannels[c.key] === undefined) {
        enabledChannels[c.key] = c.enabledByDefault;
      }
    });

    updateChart();
    lastUpdated.value = Date.now();
  } catch (error) {
    console.error("Failed to load history:", error);
  } finally {
    loading.value = false;
  }
}

function toggleDate(date: string) {
  const index = selectedDates.value.indexOf(date);
  if (index === -1) {
    selectedDates.value.push(date);
  } else {
    selectedDates.value.splice(index, 1);
  }
}

function applyDates() {
  showCalendar.value = false;
  void loadHistory();
}

async function refreshCurrent() {
  try {
    const res = await fetch("/api/server-stats/current");
    const data = await res.json();

    if (data && data.metrics) {
      const newSample: MetricSample = {
        timestamp_ms: data.timestamp_ms,
        metrics: data.metrics,
      };

      const last = samples.value[samples.value.length - 1];
      if (!last || newSample.timestamp_ms > last.timestamp_ms) {
        samples.value.push(newSample);
        if (samples.value.length > 8000) samples.value.shift();
        updateChart();
        lastUpdated.value = Date.now();
      }
    }
  } catch {}
}

function updateChart() {
  if (!chartInstance.value) return;

  const series = channels.value
    .filter((c) => enabledChannels[c.key])
    .map((c) => ({
      name: c.label,
      type: "line",
      showSymbol: false,
      smooth: true,
      connectNulls: true,
      yAxisIndex: c.key === "tps" ? 1 : 0,
      data: samples.value.map((s) => [s.timestamp_ms, s.metrics[c.key]]),
      lineStyle: { width: 2, color: c.color },
      itemStyle: { color: c.color },
    }));

  chartInstance.value.setOption({
    series,
    xAxis: {
      min: samples.value.length > 0 ? samples.value[0].timestamp_ms : undefined,
      max: samples.value.length > 0 ? samples.value[samples.value.length - 1].timestamp_ms : undefined,
    },
  }, { replaceMerge: ["series"] });
}

function toggleChannel(key: string) {
  enabledChannels[key] = !enabledChannels[key];
  updateChart();
}

function setRange(range: string) {
  selectedRange.value = range;
  selectedDates.value = [];
  void loadHistory();
}

function refreshAll() {
  void loadHistory();
  void fetchAvailableDates();
}

onMounted(() => {
  if (chartRef.value) {
    chartInstance.value = echarts.init(chartRef.value, "dark");
    chartInstance.value.setOption({
      backgroundColor: "transparent",
      animation: false,
      grid: {
        left: 40,
        right: 40,
        top: 30,
        bottom: 40,
        containLabel: true,
      },
      tooltip: {
        trigger: "axis",
        confine: true,
        appendToBody: true,
        backgroundColor: "#1a2128",
        borderColor: "#38414c",
        textStyle: { color: "#fff" },
        axisPointer: { type: "cross", lineStyle: { color: "#3b82f6", width: 1 } },
        formatter: (params: any[]) => {
          if (!params || params.length === 0) return "";
          const date = new Date(params[0].axisValue);
          const timeStr = date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
          const rows = params.map((p) => `
            <div style="display:flex;align-items:center;gap:12px;margin-top:6px;">
              <span style="width:8px;height:8px;border-radius:2px;background:${p.color};"></span>
              <span style="flex:1;font-size:12px;color:#9aa7b2;">${p.seriesName}</span>
              <b style="font-family:JetBrains Mono, monospace;font-size:13px;">${p.data[1] ?? "-"}</b>
            </div>
          `).join("");
          return `
            <div style="min-width:180px; padding: 8px;">
              <div style="font-weight:600;margin-bottom:8px;border-bottom:1px solid #38414c;padding-bottom:6px;font-size:12px;">${timeStr}</div>
              ${rows}
            </div>
          `;
        },
      },
      xAxis: {
        type: "time",
        boundaryGap: false,
        axisLine: { lineStyle: { color: "#2d3748" } },
        axisLabel: { color: "#718096", fontSize: 11 },
        splitLine: { show: true, lineStyle: { color: "#1a212c" } },
      },
      yAxis: [
        {
          type: "value",
          scale: true,
          axisLabel: { color: "#718096", fontSize: 11 },
          splitLine: { show: true, lineStyle: { color: "#1a212c" } },
        },
        {
          type: "value",
          min: 0, max: 60,
          axisLabel: { color: "#718096", fontSize: 11 },
          splitLine: { show: false },
        }
      ],
      dataZoom: [
        { type: "inside", throttle: 50 },
        { type: "slider", height: 20, bottom: 0, borderColor: "transparent", fillerColor: "rgba(59, 130, 246, 0.1)", handleStyle: { color: "#3b82f6" }, textStyle: { color: "#718096" } },
      ],
      series: [],
    });

    window.addEventListener("resize", () => chartInstance.value?.resize());
  }

  void loadHistory();
  void fetchAvailableDates();
  pollTimer = window.setInterval(() => refreshCurrent(), 2000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  chartInstance.value?.dispose();
});
</script>

<style scoped>
/* Base Theme */
.server-stats-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #0d1117;
  color: #c9d1d9;
  font-family: "Inter", -apple-system, sans-serif;
  overflow: hidden;
}

/* Global Header */
.stats-header {
  padding: 16px 24px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 20px;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(16, 185, 129, 0.1);
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.status-indicator.loading {
  background: rgba(59, 130, 246, 0.1);
  border-color: rgba(59, 130, 246, 0.2);
}

.pulse-dot {
  width: 8px;
  height: 8px;
  background: #10b981;
  border-radius: 50%;
  animation: pulse-simple 2s infinite;
}

.loading .pulse-dot {
  background: #3b82f6;
}

@keyframes pulse-simple {
  0% { opacity: 1; }
  50% { opacity: 0.4; }
  100% { opacity: 1; }
}

.status-text {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
  color: #10b981;
}

.loading .status-text { color: #3b82f6; }

.page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #f0f6fc;
}

.page-title small {
  display: block;
  font-size: 11px;
  font-weight: 400;
  color: #8b949e;
  text-transform: uppercase;
  margin-top: 2px;
}

.header-actions {
  display: flex;
  gap: 12px;
}

/* Dashboard Layout */
.dashboard-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* Sidebar */
.dashboard-sidebar {
  width: 280px;
  background: #0d1117;
  border-right: 1px solid #30363d;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 32px;
  flex-shrink: 0;
}

.control-group label {
  display: block;
  font-size: 11px;
  font-weight: 700;
  color: #8b949e;
  text-transform: uppercase;
  margin-bottom: 12px;
  letter-spacing: 0.05em;
}

.range-selector-vertical {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.range-btn-v {
  background: #161b22;
  border: 1px solid #30363d;
  color: #c9d1d9;
  padding: 8px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.range-btn-v.active {
  background: #21262d;
  border-color: #3b82f6;
  color: #58a6ff;
  box-shadow: inset 0 0 0 1px #3b82f6;
}

.channel-list-v {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.channel-btn-v {
  background: #161b22;
  border: 1px solid #30363d;
  padding: 12px;
  border-radius: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  transition: all 0.2s;
}

.channel-btn-v.enabled {
  border-color: #30363d;
  background: #1c2128;
}

.channel-btn-v:not(.enabled) {
  opacity: 0.4;
  filter: grayscale(1);
}

.channel-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.color-indicator {
  width: 4px;
  height: 16px;
  border-radius: 2px;
}

.channel-btn-v .label {
  font-size: 13px;
  font-weight: 500;
}

.channel-btn-v .value {
  font-family: "JetBrains Mono", monospace;
  font-size: 14px;
  font-weight: 700;
}

.sidebar-footer {
  margin-top: auto;
  padding-top: 20px;
  border-top: 1px solid #30363d;
}

.update-info {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #8b949e;
}

/* Main Chart Area */
.chart-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 24px;
  background: #0d1117;
  overflow: hidden;
}

.metrics-ribbon {
  display: flex;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 12px;
  padding: 20px 40px;
  margin-bottom: 24px;
  justify-content: space-between;
}

.metric-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric-divider {
  width: 1px;
  background: #30363d;
}

.m-label {
  font-size: 11px;
  text-transform: uppercase;
  color: #8b949e;
  letter-spacing: 0.1em;
}

.m-value {
  font-size: 32px;
  font-weight: 800;
  color: #f0f6fc;
  font-family: "JetBrains Mono", monospace;
}

.m-value small {
  font-size: 12px;
  font-weight: 400;
  color: #8b949e;
  margin-left: 4px;
}

.metric-item.critical .m-value { color: #f85149; }
.metric-item.warn .m-value { color: #d29922; }
.metric-item.ok .m-value { color: #3fb950; }

.chart-wrapper {
  flex: 1;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 12px;
  position: relative;
}

.stats-chart-main {
  position: absolute;
  inset: 10px;
}

/* Modal UI */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(1, 4, 9, 0.8);
  backdrop-filter: blur(8px);
  z-index: 2000;
  display: grid;
  place-items: center;
}

.modal-window {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 12px;
  width: 480px;
  box-shadow: 0 24px 48px rgba(0,0,0,0.5);
}

.modal-head {
  padding: 16px 24px;
  border-bottom: 1px solid #30363d;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-head h3 { margin: 0; font-size: 16px; }

.close-icon { background: none; border: none; color: #8b949e; font-size: 24px; cursor: pointer; }

.modal-main { padding: 24px; max-height: 400px; overflow-y: auto; }

.date-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.date-cell {
  background: #0d1117;
  border: 1px solid #30363d;
  color: #c9d1d9;
  padding: 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.date-cell.active {
  border-color: #388bfd;
  background: rgba(56, 139, 253, 0.1);
  color: #58a6ff;
}

.modal-foot {
  padding: 16px 24px;
  border-top: 1px solid #30363d;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.action-btn, .solid-btn {
  background: #238636;
  color: #fff;
  border: 1px solid rgba(240,246,252,0.1);
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}

.action-btn:hover, .solid-btn:hover { background: #2ea043; }

.ghost-btn {
  background: transparent;
  border: 1px solid #30363d;
  color: #c9d1d9;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
}

.log-calendar-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #21262d;
  border: 1px solid #30363d;
  padding: 6px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #c9d1d9;
}

@media (max-width: 1200px) {
  .dashboard-sidebar { width: 220px; }
  .m-value { font-size: 24px; }
}
</style>
