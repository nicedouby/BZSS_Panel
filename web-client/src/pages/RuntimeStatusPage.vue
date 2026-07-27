<template>
  <div class="runtime-status-page">
    <div class="page-header">
      <div class="header-content">
        <h1>运行状态</h1>
        <p>系统内核、模块与插件的实时运行状态。</p>
      </div>
      <div class="header-actions">
        <button class="refresh-btn" type="button" @click="fetchStatus" :disabled="loading">
          {{ loading ? "刷新中..." : "手动刷新" }}
        </button>
      </div>
    </div>

    <div v-if="error" class="error-banner">
      加载失败: {{ error }}
    </div>

    <div v-if="status" class="status-content">
      <section class="status-section">
        <h2 class="section-title">系统信息</h2>
        <div class="system-grid">
          <div class="system-card">
            <span class="label">Uptime</span>
            <span class="value">{{ formatUptime(status.system.uptime) }}</span>
          </div>
          <div class="system-card">
            <span class="label">Memory (RSS)</span>
            <span class="value">{{ formatMemory(status.system.memory.rss) }}</span>
          </div>
          <div class="system-card">
            <span class="label">Network In</span>
            <span class="value">{{ formatRate(status.system.performance?.latest?.network?.bytesInPerSec) }}</span>
          </div>
          <div class="system-card">
            <span class="label">Network Out</span>
            <span class="value">{{ formatRate(status.system.performance?.latest?.network?.bytesOutPerSec) }}</span>
          </div>
          <div class="system-card">
            <span class="label">Network Total</span>
            <span class="value">{{ formatRate(status.system.performance?.latest?.network?.bytesTotalPerSec) }}</span>
          </div>
          <div class="system-card">
            <span class="label">Node.js</span>
            <span class="value">{{ status.system.nodeVersion }}</span>
          </div>
          <div class="system-card">
            <span class="label">Platform</span>
            <span class="value">{{ status.system.platform }} ({{ status.system.arch }})</span>
          </div>
        </div>
      </section>

      <section class="status-section">
        <h2 class="section-title">内存占用变化趋势</h2>
        <div class="chart-container">
          <div ref="chartRef" class="memory-chart" />
        </div>
      </section>

      <section class="status-section">
        <h2 class="section-title">内置模块 ({{ status.modules.length }})</h2>
        <div class="item-grid">
          <button
            v-for="m in status.modules"
            :key="m.id"
            type="button"
            class="item-card runtime-item-card"
            :title="`查看 ${m.name} 日志`"
            @click="openLogWindow({ ...m, kind: 'module' })"
          >
            <div class="item-header">
              <span class="item-name">{{ m.name }}</span>
              <span class="status-badge running">Running</span>
            </div>
            <div class="item-meta">{{ m.id }} @ {{ m.version }}</div>
            <p class="item-desc">{{ m.description }}</p>
          </button>
        </div>
      </section>

      <section class="status-section">
        <h2 class="section-title">外部插件 ({{ status.plugins.length }})</h2>
        <div class="item-grid">
          <button
            v-for="p in status.plugins"
            :key="p.id"
            type="button"
            class="item-card runtime-item-card"
            :title="`查看 ${p.name} 日志`"
            @click="openLogWindow({ ...p, kind: 'plugin' })"
          >
            <div class="item-header">
              <span class="item-name">{{ p.name }}</span>
              <span class="status-badge running">Running</span>
            </div>
            <div class="item-meta">{{ p.id }} @ {{ p.version }}</div>
            <p class="item-desc">{{ p.description }}</p>
          </button>
        </div>
      </section>
    </div>

    <RuntimeLogModal
      :open="Boolean(selectedTarget)"
      :target="selectedTarget"
      @close="closeLogWindow"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { apiGet } from "../app/apiClient";
import RuntimeLogModal from "../components/runtime/RuntimeLogModal.vue";
import { echarts, type EChartsOption } from "../utils/echarts";
import { canAutoRefreshNow } from "../composables/useAutoRefreshGate";
import { readChartThemeTokens } from "../theme/chartTheme";
import { useUiStore } from "../stores/ui.store";

interface SystemStatus {
  ok: boolean;
  system: {
    uptime: number;
    memory: { rss: number };
    memoryHistory?: Array<{
      timestamp: number;
      rss: number;
      heapUsed: number;
      heapTotal: number;
    }>;
    performance?: {
      latest?: {
        network?: {
          bytesInPerSec: number | null;
          bytesOutPerSec: number | null;
          bytesTotalPerSec: number | null;
        } | null;
      } | null;
    } | null;
    nodeVersion: string;
    platform: string;
    arch: string;
  };
  modules: Array<{
    id: string;
    name: string;
    version: string;
    description: string;
    status: string;
  }>;
  plugins: Array<{
    id: string;
    name: string;
    version: string;
    description: string;
    status: string;
  }>;
}

interface RuntimeTarget {
  id: string;
  name: string;
  version?: string;
  description?: string;
  status?: string;
  kind: "module" | "plugin";
}

const status = ref<SystemStatus | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const selectedTarget = ref<RuntimeTarget | null>(null);
let timer: number | null = null;

const chartRef = ref<HTMLElement | null>(null);
const chartInstance = shallowRef<echarts.ECharts | null>(null);
let resizeObserver: ResizeObserver | null = null;
const ui = useUiStore();

function initChartIfNeeded() {
  if (chartInstance.value || !chartRef.value) return;

  try {
    chartInstance.value = echarts.init(chartRef.value);
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        chartInstance.value?.resize();
      });
      resizeObserver.observe(chartRef.value);
    }
  } catch (err) {
    console.error("Failed to initialize memory chart:", err);
  }
}

function updateChart(history: NonNullable<SystemStatus["system"]["memoryHistory"]>) {
  if (!chartInstance.value) return;
  const tokens = readChartThemeTokens();
  const rssColor = tokens.series[0];
  const heapTotalColor = tokens.series[4] ?? tokens.series[1];
  const heapUsedColor = tokens.series[5] ?? tokens.series[2];

  const rssData = history.map(h => [h.timestamp, h.rss / 1024 / 1024]);
  const heapTotalData = history.map(h => [h.timestamp, h.heapTotal / 1024 / 1024]);
  const heapUsedData = history.map(h => [h.timestamp, h.heapUsed / 1024 / 1024]);

  const option: EChartsOption = {
    backgroundColor: "transparent",
    animation: false,
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: tokens.tooltipBg,
      borderColor: tokens.grid,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: {
        color: tokens.tooltipText
      },
      extraCssText: "box-shadow: 0 8px 24px rgba(0,0,0,0.3); border-radius: 8px;",
      valueFormatter: (value: any) => `${Number(value).toFixed(1)} MB`
    },
    legend: {
      data: ["RSS", "Heap Total", "Heap Used"],
      textStyle: {
        color: tokens.axis
      },
      bottom: 0
    },
    grid: {
      top: 35,
      left: "3%",
      right: "4%",
      bottom: 45,
      containLabel: true
    },
    xAxis: {
      type: "time",
      axisLabel: {
        color: tokens.axis,
        fontSize: 10,
        formatter: (value: any) => {
          const date = new Date(value);
          const min = String(date.getMinutes()).padStart(2, "0");
          const sec = String(date.getSeconds()).padStart(2, "0");
          return `${date.getHours()}:${min}:${sec}`;
        }
      },
      axisLine: {
        lineStyle: {
          color: tokens.grid
        }
      },
      splitLine: {
        show: true,
        lineStyle: {
          color: tokens.grid
        }
      }
    },
    yAxis: {
      type: "value",
      name: "MB",
      nameTextStyle: {
        color: tokens.axis,
        align: "right"
      },
      axisLabel: {
        color: tokens.axis,
        fontSize: 10
      },
      axisLine: {
        lineStyle: {
          color: tokens.grid
        }
      },
      splitLine: {
        show: true,
        lineStyle: {
          color: tokens.grid
        }
      }
    },
    series: [
      {
        name: "RSS",
        type: "line",
        data: rssData,
        showSymbol: false,
        smooth: 0.35,
        lineStyle: {
          color: rssColor,
          width: 2.5
        },
        itemStyle: {
          color: rssColor
        },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: alphaColor(rssColor, 0.2) },
              { offset: 0.6, color: alphaColor(rssColor, 0.06) },
              { offset: 1, color: alphaColor(rssColor, 0) }
            ]
          }
        }
      },
      {
        name: "Heap Total",
        type: "line",
        data: heapTotalData,
        showSymbol: false,
        smooth: 0.35,
        lineStyle: {
          color: heapTotalColor,
          width: 1.5,
          type: "dashed"
        },
        itemStyle: {
          color: heapTotalColor
        }
      },
      {
        name: "Heap Used",
        type: "line",
        data: heapUsedData,
        showSymbol: false,
        smooth: 0.35,
        lineStyle: {
          color: heapUsedColor,
          width: 2.5
        },
        itemStyle: {
          color: heapUsedColor
        },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: alphaColor(heapUsedColor, 0.18) },
              { offset: 0.6, color: alphaColor(heapUsedColor, 0.05) },
              { offset: 1, color: alphaColor(heapUsedColor, 0) }
            ]
          }
        }
      }
    ]
  };

  chartInstance.value.setOption(option);
}

function alphaColor(color: string, alpha: number) {
  const hex = color.trim();
  const normalized = hex.startsWith("#") ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return color;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

watch(() => status.value?.system?.memoryHistory, (newHistory) => {
  if (newHistory && newHistory.length > 0) {
    nextTick(() => {
      initChartIfNeeded();
      updateChart(newHistory);
    });
  }
}, { immediate: true });

watch(() => ui.theme, () => {
  const history = status.value?.system?.memoryHistory;
  if (!history?.length) return;
  nextTick(() => updateChart(history));
});

const hasSelection = computed(() => Boolean(selectedTarget.value));

async function fetchStatus() {
  loading.value = true;
  error.value = null;
  try {
    status.value = await apiGet<SystemStatus>("/api/system/status");
  } catch (err: any) {
    error.value = err?.message || "未知错误";
  } finally {
    loading.value = false;
  }
}

function openLogWindow(target: RuntimeTarget) {
  selectedTarget.value = target;
}

function closeLogWindow() {
  selectedTarget.value = null;
}

function formatUptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

function formatMemory(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatRate(bytesPerSec?: number | null) {
  if (!Number.isFinite(Number(bytesPerSec))) return "--";
  const value = Number(bytesPerSec);
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let size = Math.max(0, value);
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function onWindowKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape" && hasSelection.value) {
    closeLogWindow();
  }
}

onMounted(() => {
  void fetchStatus();
  timer = window.setInterval(() => {
    if (canAutoRefreshNow()) void fetchStatus();
  }, 5000);
  window.addEventListener("keydown", onWindowKeyDown);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
  window.removeEventListener("keydown", onWindowKeyDown);
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (chartInstance.value) {
    chartInstance.value.dispose();
    chartInstance.value = null;
  }
});
</script>

<style scoped>
.runtime-status-page {
  padding: 24px;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  scrollbar-gutter: stable;
  color: var(--color-text-primary);
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 32px;
}

.header-content h1 {
  font-size: 24px;
  margin: 0 0 8px 0;
}

.header-content p {
  color: var(--color-text-muted);
  margin: 0;
}

.refresh-btn {
  padding: 8px 16px;
  background:
    var(--theme-panel-highlight),
    color-mix(in srgb, var(--color-bg-elevated) 90%, transparent);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
  border-radius: 6px;
  cursor: pointer;
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error-banner {
  padding: 12px 16px;
  background: rgba(255, 107, 107, 0.1);
  border: 1px solid #ff6b6b;
  color: #ff6b6b;
  border-radius: 8px;
  margin-bottom: 24px;
}

.status-section {
  margin-bottom: 40px;
}

.section-title {
  font-size: 18px;
  margin-bottom: 16px;
  color: var(--color-text-primary);
}

.system-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
}

.system-card {
  padding: 16px;
  background:
    var(--theme-panel-highlight),
    color-mix(in srgb, var(--color-bg-card) 92%, transparent);
  border: 1px solid var(--color-border-default);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.system-card .label {
  font-size: 12px;
  color: var(--color-text-muted);
}

.system-card .value {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.item-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.item-card {
  padding: 16px;
  background:
    var(--theme-panel-highlight),
    color-mix(in srgb, var(--color-bg-card) 92%, transparent);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
}

.runtime-item-card {
  width: 100%;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.15s ease, background-color 0.15s ease;
}

.runtime-item-card:hover {
  border-color: var(--color-border-highlight);
  background: var(--color-bg-hover);
}

.runtime-item-card:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
  gap: 12px;
}

.item-name {
  font-weight: 600;
  color: var(--color-text-primary);
}

.status-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  text-transform: uppercase;
  font-weight: 700;
  flex: 0 0 auto;
}

.status-badge.running {
  background: rgba(46, 204, 113, 0.1);
  color: #2ecc71;
}

.item-meta {
  font-size: 11px;
  color: var(--color-text-muted);
  font-family: monospace;
  margin-bottom: 8px;
}

.item-desc {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin: 0;
  line-height: 1.4;
}

.chart-container {
  background:
    var(--theme-panel-highlight),
    color-mix(in srgb, var(--color-bg-card) 92%, transparent);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  padding: 20px;
  height: 320px;
  position: relative;
}

.memory-chart {
  width: 100%;
  height: 100%;
}
</style>
