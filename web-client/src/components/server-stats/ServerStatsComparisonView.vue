<template>
  <div class="comparison-view">
    <div class="comparison-header">
      <h2 class="view-title">历史曲线对比</h2>
      <div class="controls-bar">
        <!-- Date Selection pills -->
        <div class="compare-dates-list">
          <span class="pills-label">对比日期:</span>
          <button
            v-for="date in availableDates.slice(0, 10)"
            :key="date"
            class="date-pill"
            :class="{ active: compareDates.includes(date) }"
            @click="emit('toggle-compare-date', date)"
          >
            {{ date }}
          </button>
        </div>

        <!-- Align mode controls -->
        <div class="align-segmented-control">
          <button
            v-for="mode in alignModes"
            :key="mode.key"
            class="align-btn"
            :class="{ active: alignMode === mode.key }"
            @click="emit('set-align-mode', mode.key)"
          >
            {{ mode.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- Comparison Chart Container -->
    <div class="chart-section">
      <div v-if="loadingCompare" class="compare-loading">
        <span class="spinner">◌</span> Loading comparison data...
      </div>
      <div v-else-if="compareDates.length === 0" class="compare-empty-tip">
        请在上方勾选最多 3 个日期进行玩家曲线对比。
      </div>
      <div v-else ref="chartRef" class="comparison-canvas" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, shallowRef, watch, computed } from "vue";
import * as echarts from "echarts";
import { STATS_THEME } from "./serverStatsTheme";
import { readChartThemeTokens } from "../../theme/chartTheme";
import { useUiStore } from "../../stores/ui.store";
import type { CompareAlignMode } from "../../composables/useServerMetricsComparison";

const props = defineProps<{
  availableDates: string[];
  compareDates: string[];
  alignMode: CompareAlignMode;
  alignedComparisonSeries: { name: string; data: [number, number][] }[];
  loadingCompare: boolean;
}>();

const emit = defineEmits<{
  (event: "toggle-compare-date", date: string): void;
  (event: "set-align-mode", mode: CompareAlignMode): void;
}>();

const chartRef = ref<HTMLElement | null>(null);
const chartInstance = shallowRef<echarts.ECharts | null>(null);
const ui = useUiStore();
let resizeObserver: ResizeObserver | null = null;

const alignModes = [
  { key: "real", label: "按真实时间对齐" },
  { key: "server", label: "按开服时间对齐" },
  { key: "round", label: "按对局开始对齐" },
] as const;

function ensureChart() {
  if (chartInstance.value || !chartRef.value) return;

  try {
    chartInstance.value = echarts.init(chartRef.value);
    chartInstance.value.setOption(buildOption());

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          chartInstance.value?.resize();
        });
      });
      resizeObserver.observe(chartRef.value);
    }
  } catch (err) {
    console.warn("[ServerStatsComparisonView] Chart failed to init:", err);
  }
}

function buildOption(): echarts.EChartsOption {
  const tokens = readChartThemeTokens();

  // Create Series List
  const colors = [STATS_THEME.player, STATS_THEME.queue, STATS_THEME.tpsGood];
  const series = props.alignedComparisonSeries.map((s, idx) => ({
    name: s.name,
    type: "line" as const,
    showSymbol: false,
    smooth: false,
    connectNulls: true,
    data: s.data,
    lineStyle: {
      width: 2,
      color: colors[idx % colors.length],
    },
    itemStyle: {
      color: colors[idx % colors.length],
    },
  }));

  // Decide X-axis Type & Format
  const isTimeType = props.alignMode === "real";

  return {
    backgroundColor: "transparent",
    animation: false,
    grid: {
      left: 16,
      right: 32,
      top: 24,
      bottom: 24,
      containLabel: true,
    },
    legend: {
      show: true,
      textStyle: {
        color: tokens.axis,
        fontSize: 11,
      },
    },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: tokens.tooltipBg,
      borderColor: STATS_THEME.panelBorder,
      borderWidth: 1,
      extraCssText: "box-shadow: 0 4px 12px rgba(0,0,0,0.3); border-radius: 8px; max-width: 280px;",
      textStyle: {
        color: tokens.tooltipText,
        fontSize: 11,
      },
      formatter: (params: any) => {
        if (!params || !params.length) return "";

        let xLabel = "";
        const xVal = params[0].value[0];

        if (isTimeType) {
          xLabel = new Date(xVal).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        } else {
          // Duration format: e.g. 5h 30m
          const mins = Math.floor(xVal / 60000);
          const hrs = Math.floor(mins / 60);
          xLabel = hrs > 0 ? `${hrs}小时 ${mins % 60}分` : `${mins}分钟`;
        }

        let html = `<div style="font-weight: 700; margin-bottom: 4px; font-family: monospace;">对齐点: ${xLabel}</div>`;
        params.forEach((p: any) => {
          html += `
            <div style="display: flex; justify-content: space-between; gap: 16px; align-items: center; margin: 2px 0;">
              <span style="font-size: 11px; display: inline-flex; align-items: center; gap: 4px;">
                <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${p.color};"></span>
                ${p.seriesName}
              </span>
              <strong style="font-family: monospace;">${p.value[1]} 人</strong>
            </div>
          `;
        });
        return html;
      },
    },
    xAxis: {
      type: isTimeType ? "time" : "value",
      axisLine: {
        lineStyle: {
          color: STATS_THEME.panelBorder,
        },
      },
      axisLabel: {
        color: tokens.axis,
        fontSize: 10,
        fontFamily: "monospace",
        formatter: isTimeType
          ? undefined
          : (val: number) => {
              const mins = Math.floor(val / 60000);
              const hrs = Math.floor(mins / 60);
              return hrs > 0 ? `${hrs}h` : `${mins}m`;
            },
      },
      splitLine: {
        show: false, // No vertical lines
      },
    } as any,
    yAxis: {
      type: "value",
      axisLabel: {
        color: tokens.axis,
        fontSize: 10,
        fontFamily: "monospace",
      },
      splitLine: {
        show: true,
        lineStyle: {
          color: STATS_THEME.grid,
          width: 1,
        },
      },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    dataZoom: [
      {
        type: "inside",
        throttle: 50,
      },
    ],
    series,
  };
}

function updateChart() {
  if (!chartInstance.value) return;
  chartInstance.value.setOption(buildOption(), {
    replaceMerge: ["series"],
  });
}

watch(
  [() => props.alignedComparisonSeries, () => props.alignMode],
  () => {
    updateChart();
  }
);

watch(
  () => ui.theme,
  () => {
    if (!chartInstance.value) return;
    chartInstance.value.setOption(buildOption(), true);
    updateChart();
  }
);

onMounted(() => {
  ensureChart();
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  chartInstance.value?.dispose();
  chartInstance.value = null;
});
</script>

<style scoped>
.comparison-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  flex: 1;
  min-height: 0;
}

.comparison-header {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex-shrink: 0;
}

.view-title {
  font-size: 15px;
  font-weight: 800;
  color: var(--color-text-primary);
  margin: 0;
}

.controls-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  background: var(--stats-panel, var(--color-bg-card));
  border: 1px solid var(--stats-panel-border, var(--color-border-soft));
  padding: 12px;
  border-radius: var(--card-radius, 14px);
}

.compare-dates-list {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.pills-label {
  font-size: 11px;
  color: var(--color-text-muted);
  font-weight: 700;
  margin-right: 4px;
}

.date-pill {
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--color-border-default);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.date-pill:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.date-pill.active {
  background: rgba(96, 165, 250, 0.15);
  border-color: rgba(96, 165, 250, 0.4);
  color: #60a5fa;
}

/* Alignment toggle */
.align-segmented-control {
  display: flex;
  background: color-mix(in srgb, var(--color-bg-elevated) 88%, transparent);
  border: 1px solid var(--color-border-soft);
  padding: 2px;
  border-radius: 8px;
}

.align-btn {
  height: 26px;
  padding: 0 12px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s ease;
}

.align-btn:hover {
  color: var(--color-text-primary);
}

.align-btn.active {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}

/* Chart Area */
.chart-section {
  flex: 1;
  background: var(--stats-panel, var(--color-bg-card));
  border: 1px solid var(--stats-panel-border, var(--color-border-soft));
  border-radius: var(--card-radius, 14px);
  padding: 16px;
  min-height: 400px;
  display: flex;
  flex-direction: column;
}

.compare-loading,
.compare-empty-tip {
  display: grid;
  place-items: center;
  flex: 1;
  font-size: 13px;
  color: var(--color-text-muted);
}

.spinner {
  display: inline-block;
  animation: spin 1s linear infinite;
  margin-right: 6px;
}

.comparison-canvas {
  flex: 1;
  width: 100%;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 900px) {
  .controls-bar {
    flex-direction: column;
    align-items: stretch;
  }

  .align-segmented-control {
    justify-content: center;
  }
}
</style>
