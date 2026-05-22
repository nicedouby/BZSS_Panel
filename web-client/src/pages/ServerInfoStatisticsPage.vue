<template>
  <div class="page server-stats-page">
    <div class="page-head">
      <div>
        <h1 class="page-title">服务器信息统计</h1>
        <p class="page-subtitle">实时监控在线人数、TPS 和排队情况。</p>
      </div>
      <div class="actions">
        <div class="date-selector">
          <select v-model="selectedDate" @change="loadHistory">
            <option value="">最近 24 小时</option>
            <option v-for="date in availableDates" :key="date" :value="date">
              {{ date }}
            </option>
          </select>
        </div>
        <button class="refresh-btn" @click="refreshAll" :disabled="loading">
          {{ loading ? "同步中..." : "刷新" }}
        </button>
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
const selectedDate = ref("");
const selectedRange = ref("24h");
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

async function loadHistory() {
  loading.value = true;
  try {
    let fromMs: number;
    let toMs = Date.now();

    if (selectedDate.value) {
      fromMs = Date.parse(`${selectedDate.value}T00:00:00Z`);
      toMs = Date.parse(`${selectedDate.value}T23:59:59Z`);
    } else {
      const range = ranges.find((r) => r.key === selectedRange.value) || ranges[3];
      fromMs = toMs - range.hours * 60 * 60 * 1000;
    }

    const res = await fetch(`/api/server-stats/history?from_ms=${fromMs}&to_ms=${toMs}&include_current=1`);
    const data = await res.json();

    samples.value = data.samples || [];
    channels.value = data.channels || [];
    availableDates.value = data.availableDates || [];

    // Initialize channel toggles if not set
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

async function refreshCurrent() {
  try {
    const res = await fetch("/api/server-stats/current");
    const data = await res.json();

    if (data && data.metrics) {
      const newSample: MetricSample = {
        timestamp_ms: data.timestamp_ms,
        metrics: data.metrics,
      };

      // Only append if it's actually newer and different
      const last = samples.value[samples.value.length - 1];
      if (!last || newSample.timestamp_ms > last.timestamp_ms) {
        samples.value.push(newSample);
        // Trim old samples if they are outside the current view range
        // (Simplified for now, just keep the last 5000)
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
  selectedDate.value = ""; // Clear date if range is selected
  void loadHistory();
}

function refreshAll() {
  void loadHistory();
}

onMounted(() => {
  if (chartRef.value) {
    chartInstance.value = echarts.init(chartRef.value, "dark");
    chartInstance.value.setOption({
      backgroundColor: "transparent",
      animation: false,
      grid: {
        left: 50,
        right: 20,
        top: 20,
        bottom: 40,
      },
      tooltip: {
        trigger: "axis",
        confine: true,
        appendToBody: true,
        renderMode: "html",
        axisPointer: { type: "cross" },
        formatter: (params: any[]) => {
          if (!params || params.length === 0) return "";
          const time = new Date(params[0].axisValue).toLocaleTimeString();
          const rows = params.map((p) => `
            <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
              <span style="width:10px;height:10px;border-radius:50%;background:${p.color};"></span>
              <span style="flex:1;">${p.seriesName}</span>
              <b style="font-family:monospace;">${p.data[1] ?? "-"}</b>
            </div>
          `).join("");
          return `
            <div style="min-width:160px; padding: 4px;">
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
      yAxis: {
        type: "value",
        scale: true,
        axisLine: { lineStyle: { color: "#444" } },
        splitLine: { show: true, lineStyle: { color: "#222" } },
      },
      dataZoom: [
        { type: "inside", throttle: 50 },
        { type: "slider", height: 20, bottom: 0 },
      ],
      series: [],
    });

    window.addEventListener("resize", () => chartInstance.value?.resize());
  }

  void loadHistory();
  pollTimer = window.setInterval(() => refreshCurrent(), 3000);
});

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
  chartInstance.value?.dispose();
});
</script>

<style scoped>
.server-stats-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

.actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.date-selector select {
  background: #1d252d;
  color: #fff;
  border: 1px solid #38414c;
  border-radius: 6px;
  padding: 8px 12px;
  cursor: pointer;
}

.refresh-btn {
  background: #2563eb;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
}

.refresh-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.chart-panel {
  margin-top: 24px;
  padding: 20px;
  background: #151a20;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 16px;
}

.channel-toggles {
  display: flex;
  gap: 8px;
}

.channel-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #1d252d;
  border: 1px solid #38414c;
  color: #9aa7b2;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 13px;
  transition: all 0.2s;
}

.channel-btn.enabled {
  background: #262f38;
  color: #fff;
  border-color: #4b5563;
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
  padding: 6px 12px;
  font-size: 12px;
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
  height: 450px;
  width: 100%;
}

@media (max-width: 768px) {
  .chart-header {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
