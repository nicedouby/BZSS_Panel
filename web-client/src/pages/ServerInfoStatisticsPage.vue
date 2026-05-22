<template>
  <div class="page server-stats-page">
    <div class="page-head">
      <div>
        <h1 class="page-title">服务器信息统计</h1>
        <p class="page-subtitle">智能日志分析与多轴动态监控。</p>
      </div>
      <div class="actions">
        <div class="log-calendar-trigger" @click="showCalendar = !showCalendar">
          <span class="icon">📅</span>
          <span v-if="selectedDates.length === 0">选择日志日期</span>
          <span v-else>已选 {{ selectedDates.length }} 天</span>
        </div>
        <button class="refresh-btn" @click="refreshAll" :disabled="loading">
          <span v-if="loading">同步中...</span>
          <span v-else>刷新数据</span>
        </button>
      </div>
    </div>

    <!-- Available Dates Window -->
    <div v-if="showCalendar" class="log-calendar-overlay" @click.self="showCalendar = false">
      <div class="log-calendar-modal">
        <div class="modal-header">
          <h3>可用日志日期</h3>
          <button @click="showCalendar = false" class="close-btn">×</button>
        </div>
        <div class="modal-body">
          <p class="hint">点击下方日期进行多选对比分析：</p>
          <div class="date-chips">
            <button
              v-for="date in availableDates"
              :key="date"
              class="date-chip"
              :class="{ selected: selectedDates.includes(date) }"
              @click="toggleDate(date)"
            >
              {{ date }}
            </button>
            <div v-if="availableDates.length === 0" class="empty-dates">暂无历史日志</div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="clear-btn" @click="selectedDates = []">清除选择</button>
          <button class="apply-btn" @click="applyDates">开始分析</button>
        </div>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat">
        <span>当前人数</span>
        <strong>{{ currentMetrics.players ?? "-" }}</strong>
      </div>
      <div class="stat">
        <span>当前 TPS</span>
        <strong>{{ currentMetrics.tps ?? "-" }}</strong>
      </div>
      <div class="stat">
        <span>当前排队</span>
        <strong>{{ currentMetrics.queue ?? "-" }}</strong>
      </div>
      <div class="stat">
        <span>最后更新</span>
        <strong>{{ lastUpdatedLabel }}</strong>
      </div>
    </div>

    <div class="panel chart-panel">
      <div class="chart-header">
        <div class="channel-toggles">
          <button
            v-for="channel in channels"
            :key="channel.key"
            class="channel-btn"
            :class="{ enabled: enabledChannels[channel.key] }"
            @click="toggleChannel(channel.key)"
          >
            <span class="color-dot" :style="{ backgroundColor: channel.color }" />
            {{ channel.label }}
          </button>
        </div>
        <div class="range-selector">
          <button
            v-for="range in ranges"
            :key="range.key"
            class="range-btn"
            :class="{ active: selectedRange === range.key }"
            @click="setRange(range.key)"
          >
            {{ range.label }}
          </button>
        </div>
      </div>
      <div ref="chartRef" class="stats-chart" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, watch, reactive, computed } from "vue";
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
  { key: "1h", label: "1小时", hours: 1 },
  { key: "6h", label: "6小时", hours: 6 },
  { key: "12h", label: "12小时", hours: 12 },
  { key: "24h", label: "24小时", hours: 24 },
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

const lastUpdatedLabel = computed(() => {
  if (!lastUpdated.value) return "从未";
  const date = new Date(lastUpdated.value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
        if (samples.value.length > 5000) {
          samples.value.shift();
        }
        updateChart();
        lastUpdated.value = Date.now();
      }
    }
  } catch (error) {
    console.error("Failed to refresh current metrics:", error);
  }
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
        left: 60,
        right: 60, // Equal space for dual axes
        top: 20,
        bottom: 50,
      },
      tooltip: {
        trigger: "axis",
        confine: true,
        appendToBody: true,
        renderMode: "html",
        axisPointer: { type: "cross" },
        formatter: (params: any[]) => {
          if (!params || params.length === 0) return "";
          const date = new Date(params[0].axisValue);
          const time = date.toLocaleString([], {
            month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit"
          });
          const rows = params.map((p) => `
            <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
              <span style="width:10px;height:10px;border-radius:50%;background:${p.color};"></span>
              <span style="flex:1;">${p.seriesName}</span>
              <b style="font-family:monospace;">${p.data[1] ?? "-"}</b>
            </div>
          `).join("");
          return `
            <div style="min-width:180px; padding: 4px;">
              <div style="font-weight:600;margin-bottom:8px;border-bottom:1px solid #444;padding-bottom:4px;">${time}</div>
              ${rows}
            </div>
          `;
        },
      },
      xAxis: {
        type: "time",
        boundaryGap: false,
        axisLine: { lineStyle: { color: "#444" } },
        splitLine: { show: true, lineStyle: { color: "#222" } },
      },
      yAxis: [
        {
          name: "人数/排队",
          type: "value",
          scale: true,
          axisLine: { lineStyle: { color: "#444" } },
          splitLine: { show: true, lineStyle: { color: "#222" } },
        },
        {
          name: "TPS",
          type: "value",
          min: 0,
          max: 60, // Standard Squad TPS
          splitLine: { show: false }, // Only show split lines for left axis
          axisLine: { lineStyle: { color: "#444" } },
        }
      ],
      dataZoom: [
        { type: "inside", throttle: 50 },
        { type: "slider", height: 25, bottom: 5 },
      ],
      series: [],
    });

    window.addEventListener("resize", () => chartInstance.value?.resize());
  }

  void loadHistory();
  void fetchAvailableDates();
  pollTimer = window.setInterval(() => refreshCurrent(), 3000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  chartInstance.value?.dispose();
});
</script>

<style scoped>
.server-stats-page {
  max-width: 1600px;
  margin: 0 auto;
  padding: 20px;
}

.actions {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}

.log-calendar-trigger {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #1d252d;
  border: 1px solid #38414c;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  color: #fff;
  font-size: 14px;
  transition: border-color 0.2s;
}

.log-calendar-trigger:hover {
  border-color: #60a5fa;
}

.log-calendar-trigger .icon {
  font-size: 16px;
}

/* Modal Styling */
.log-calendar-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: grid;
  place-items: center;
  z-index: 1000;
}

.log-calendar-modal {
  background: #151a20;
  border: 1px solid #38414c;
  border-radius: 12px;
  width: 90%;
  max-width: 500px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
}

.modal-header {
  padding: 16px 20px;
  border-bottom: 1px solid #273039;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header h3 {
  margin: 0;
  font-size: 18px;
}

.close-btn {
  background: transparent;
  border: none;
  color: #9aa7b2;
  font-size: 24px;
  cursor: pointer;
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
}

.hint {
  color: #9aa7b2;
  font-size: 13px;
  margin-bottom: 16px;
}

.date-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.date-chip {
  background: #1d252d;
  border: 1px solid #38414c;
  color: #dce4e8;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}

.date-chip:hover {
  background: #262f38;
}

.date-chip.selected {
  background: #2563eb;
  border-color: #3b82f6;
  color: #fff;
}

.empty-dates {
  padding: 20px;
  text-align: center;
  color: #9aa7b2;
  width: 100%;
}

.modal-footer {
  padding: 16px 20px;
  border-top: 1px solid #273039;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.clear-btn {
  background: transparent;
  border: 1px solid #38414c;
  color: #9aa7b2;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
}

.apply-btn {
  background: #2563eb;
  color: #fff;
  border: none;
  padding: 8px 24px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
}

.refresh-btn {
  background: #2563eb;
  color: #fff;
  border: none;
  padding: 10px 20px;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
}

.refresh-btn:hover {
  background: #3b82f6;
}

.refresh-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.chart-panel {
  margin-top: 24px;
  padding: 24px;
  background: #151a20;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 20px;
}

.channel-toggles {
  display: flex;
  gap: 10px;
}

.channel-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #1d252d;
  border: 1px solid #38414c;
  color: #9aa7b2;
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 14px;
  transition: all 0.2s;
  cursor: pointer;
}

.channel-btn.enabled {
  background: #262f38;
  color: #fff;
  border-color: #60a5fa;
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.2);
}

.color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.range-selector {
  display: flex;
  background: #1d252d;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid #38414c;
}

.range-btn {
  background: transparent;
  border: none;
  color: #9aa7b2;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  border-right: 1px solid #38414c;
}

.range-btn:last-child {
  border-right: none;
}

.range-btn.active {
  background: #38414c;
  color: #fff;
}

.stats-chart {
  height: 600px;
  width: 100%;
}

@media (max-width: 1024px) {
  .chart-header {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
