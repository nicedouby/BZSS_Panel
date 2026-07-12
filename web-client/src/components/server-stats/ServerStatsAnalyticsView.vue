<template>
  <div class="analytics-view">
    <div class="analytics-header">
      <h2 class="view-title">多日趋势分析</h2>
      <div v-if="samples.length === 0" class="no-data-tip">
        提示：请切换时间范围至「7 天」以加载完整的分析数据。
      </div>
    </div>

    <!-- Heatmap Section -->
    <div class="heatmap-section">
      <h3 class="section-title">每日小时热力图（平均在线人数）</h3>
      <div ref="heatmapRef" class="heatmap-canvas" />
    </div>

    <!-- Daily Metrics Table -->
    <div class="metrics-table-section">
      <h3 class="section-title">每日核心统计指标</h3>
      <div class="table-wrap">
        <table class="metrics-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>峰值人数</th>
              <th>首次达到 50 人</th>
              <th>满服时间</th>
              <th>满服时长</th>
              <th>队列峰值</th>
              <th>平均 TPS</th>
              <th>TPS 异常时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in dailyStats" :key="row.date">
              <td class="cell-date font-bold">{{ row.date }}</td>
              <td class="cell-number font-mono">{{ row.peakPlayers }} 人</td>
              <td class="cell-time font-mono">{{ row.reached50At || '—' }}</td>
              <td class="cell-time font-mono">{{ row.fullAt || '—' }}</td>
              <td class="cell-time font-mono">{{ formatDuration(row.fullDurationMs) }}</td>
              <td class="cell-number font-mono text-orange">{{ row.peakQueue }} 人</td>
              <td class="cell-number font-mono" :class="getTpsClass(row.avgTps)">{{ row.avgTps !== null ? row.avgTps.toFixed(1) : '—' }}</td>
              <td class="cell-time font-mono text-red">{{ formatSeconds(row.lowTpsDurationMs) }}</td>
            </tr>
            <tr v-if="dailyStats.length === 0">
              <td colspan="8" class="table-empty">暂无可用统计数据，请加载历史范围。</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, shallowRef, watch, computed } from "vue";
import * as echarts from "echarts";
import { STATS_THEME } from "./serverStatsTheme";
import { readChartThemeTokens } from "../../theme/chartTheme";
import { useUiStore } from "../../stores/ui.store";
import type { ServerMetricSample } from "../../composables/useServerMetrics";

const props = defineProps<{
  samples: ServerMetricSample[];
}>();

const heatmapRef = ref<HTMLElement | null>(null);
const heatmapInstance = shallowRef<echarts.ECharts | null>(null);
const ui = useUiStore();
let resizeObserver: ResizeObserver | null = null;

// Group samples by local date string
const groupedByDate = computed(() => {
  const groups: Record<string, ServerMetricSample[]> = {};
  props.samples.forEach((s) => {
    const dateStr = new Date(s.timestamp_ms).toLocaleDateString([], { month: "2-digit", day: "2-digit" });
    if (!groups[dateStr]) groups[dateStr] = [];
    groups[dateStr].push(s);
  });
  return groups;
});

// Daily operational stats compilation
const dailyStats = computed(() => {
  const dates = Object.keys(groupedByDate.value).sort();
  return dates.map((date) => {
    const daySamples = groupedByDate.value[date].sort((a, b) => a.timestamp_ms - b.timestamp_ms);

    let peakPlayers = 0;
    let peakQueue = 0;
    let totalTps = 0;
    let tpsCount = 0;

    let reached50At: string | null = null;
    let fullAt: string | null = null;

    let fullDurationMs = 0;
    let lowTpsDurationMs = 0;

    for (let i = 0; i < daySamples.length; i++) {
      const s = daySamples[i];
      const p = s.metrics.players ?? 0;
      const q = s.metrics.queue ?? 0;
      const t = s.metrics.tps;

      if (p > peakPlayers) peakPlayers = p;
      if (q > peakQueue) peakQueue = q;

      if (t != null) {
        tpsCount++;
        totalTps += t;
      }

      const timeStr = new Date(s.timestamp_ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (reached50At === null && p >= 50) {
        reached50At = timeStr;
      }
      if (fullAt === null && p >= 100) {
        fullAt = timeStr;
      }
    }

    // Accumulate durations
    for (let i = 1; i < daySamples.length; i++) {
      const prev = daySamples[i - 1];
      const curr = daySamples[i];
      const diff = curr.timestamp_ms - prev.timestamp_ms;
      if (diff > 5 * 60 * 1000) continue; // Skip large offline gaps

      if (curr.metrics.players >= 100) {
        fullDurationMs += diff;
      }
      if (curr.metrics.tps != null && curr.metrics.tps < 28) {
        lowTpsDurationMs += diff;
      }
    }

    const avgTps = tpsCount > 0 ? totalTps / tpsCount : null;

    return {
      date,
      peakPlayers,
      reached50At,
      fullAt,
      fullDurationMs,
      peakQueue,
      avgTps,
      lowTpsDurationMs,
    };
  });
});

function formatDuration(ms: number) {
  if (ms <= 0) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} 分钟`;
  return `${Math.floor(mins / 60)} 小时 ${mins % 60} 分`;
}

function formatSeconds(ms: number) {
  if (ms <= 0) return "—";
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs} 秒`;
  return `${Math.floor(secs / 60)} 分 ${secs % 60} 秒`;
}

function getTpsClass(avgTps: number | null) {
  if (avgTps === null) return "";
  if (avgTps < 28) return "text-red";
  if (avgTps < 35) return "text-orange";
  return "text-green";
}

// Heatmap Option configuration
function buildHeatmapOption(): echarts.EChartsOption {
  const tokens = readChartThemeTokens();
  const dates = Object.keys(groupedByDate.value).sort();
  const data: [number, number, number][] = [];

  // Hours: 0 to 23
  const hours = Array.from({ length: 24 }, (_, i) => `${i}时`);

  dates.forEach((dateStr, dateIdx) => {
    const daySamples = groupedByDate.value[dateStr];
    const hourValues: Record<number, number[]> = {};
    for (let h = 0; h < 24; h++) hourValues[h] = [];

    daySamples.forEach((s) => {
      const hr = new Date(s.timestamp_ms).getHours();
      hourValues[hr].push(s.metrics.players ?? 0);
    });

    for (let h = 0; h < 24; h++) {
      const arr = hourValues[h];
      const avgVal = arr.length > 0
        ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
        : 0;
      data.push([h, dateIdx, avgVal]);
    }
  });

  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: {
      position: "top",
      backgroundColor: tokens.tooltipBg,
      borderColor: STATS_THEME.panelBorder,
      borderWidth: 1,
      formatter: (params: any) => {
        const hour = params.value[0];
        const dateName = dates[params.value[1]];
        const avgPlayers = params.value[2];
        return `
          <div style="font-size: 11px; padding: 4px;">
            日期: <b>${dateName}</b><br/>
            时间段: <b>${hour}:00 - ${hour}:59</b><br/>
            平均在线: <b>${avgPlayers} 人</b>
          </div>
        `;
      },
    },
    grid: {
      left: 16,
      right: 16,
      top: 10,
      bottom: 24,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      data: hours,
      splitArea: {
        show: true,
      },
      axisLabel: {
        color: tokens.axis,
        fontSize: 10,
      },
      axisLine: {
        lineStyle: {
          color: STATS_THEME.panelBorder,
        },
      },
    },
    yAxis: {
      type: "category",
      data: dates,
      splitArea: {
        show: true,
      },
      axisLabel: {
        color: tokens.axis,
        fontSize: 10,
      },
      axisLine: {
        lineStyle: {
          color: STATS_THEME.panelBorder,
        },
      },
    },
    visualMap: {
      min: 0,
      max: 100,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemHeight: 120,
      textStyle: {
        color: tokens.axis,
        fontSize: 10,
      },
      // Blue heat spectrum mapping
      inRange: {
        color: ["rgba(96, 165, 250, 0.05)", "rgba(96, 165, 250, 0.4)", "#2563eb"],
      },
    },
    series: [
      {
        name: "平均人数",
        type: "heatmap",
        data,
        label: {
          show: false,
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 8,
            shadowColor: "rgba(0, 0, 0, 0.3)",
          },
        },
      },
    ],
  };
}

function ensureHeatmap() {
  if (heatmapInstance.value || !heatmapRef.value) return;
  try {
    heatmapInstance.value = echarts.init(heatmapRef.value);
    heatmapInstance.value.setOption(buildHeatmapOption());

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        heatmapInstance.value?.resize();
      });
      resizeObserver.observe(heatmapRef.value);
    }
  } catch (err) {
    console.warn("[ServerStatsAnalyticsView] Heatmap failed to init:", err);
  }
}

function updateHeatmap() {
  if (!heatmapInstance.value) return;
  heatmapInstance.value.setOption(buildHeatmapOption(), true);
}

watch(
  () => props.samples,
  () => {
    updateHeatmap();
  }
);

watch(
  () => ui.theme,
  () => {
    if (!heatmapInstance.value) return;
    heatmapInstance.value.setOption(buildHeatmapOption(), true);
    updateHeatmap();
  }
);

onMounted(() => {
  ensureHeatmap();
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  heatmapInstance.value?.dispose();
  heatmapInstance.value = null;
});
</script>

<style scoped>
.analytics-view {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}

.analytics-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.view-title {
  font-size: 15px;
  font-weight: 800;
  color: var(--color-text-primary);
  margin: 0;
}

.no-data-tip {
  font-size: 11px;
  color: var(--stats-queue, #f0a84b);
  background: rgba(240, 168, 75, 0.08);
  border: 1px solid rgba(240, 168, 75, 0.2);
  padding: 6px 12px;
  border-radius: 8px;
}

.section-title {
  font-size: 13px;
  font-weight: 800;
  color: var(--color-text-primary);
  margin: 0 0 12px;
}

.heatmap-section {
  background: var(--stats-panel, var(--color-bg-card));
  border: 1px solid var(--stats-panel-border, var(--color-border-soft));
  border-radius: var(--card-radius, 14px);
  padding: 16px;
}

.heatmap-canvas {
  height: 260px;
  width: 100%;
}

.metrics-table-section {
  background: var(--stats-panel, var(--color-bg-card));
  border: 1px solid var(--stats-panel-border, var(--color-border-soft));
  border-radius: var(--card-radius, 14px);
  padding: 16px;
}

.table-wrap {
  overflow-x: auto;
}

.metrics-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 12px;
}

.metrics-table th {
  color: var(--color-text-muted);
  font-weight: 700;
  padding: 10px 12px;
  border-bottom: 1.5px solid var(--color-border-default);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.metrics-table td {
  padding: 12px;
  border-bottom: 1px solid var(--color-border-soft);
  color: var(--color-text-secondary);
}

.metrics-table tr:hover td {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.cell-date {
  color: var(--color-text-primary);
}

.font-bold {
  font-weight: 700;
}

.font-mono {
  font-family: 'JetBrains Mono', monospace;
}

.text-red {
  color: var(--stats-tps-critical, #e56868);
}

.text-orange {
  color: var(--stats-queue, #f0a84b);
}

.text-green {
  color: var(--stats-tps-good, #40b983);
}

.table-empty {
  text-align: center;
  color: var(--color-text-muted);
  padding: 32px 0;
  font-style: italic;
}
</style>
