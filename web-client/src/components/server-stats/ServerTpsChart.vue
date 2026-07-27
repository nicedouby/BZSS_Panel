<template>
  <div class="tps-chart">
    <div class="chart-header">
      <h3 class="chart-title">TPS 稳定性</h3>
      <div class="chart-summary-badges">
        <div class="summary-badge">
          <span class="badge-label">平均</span>
          <span class="badge-value">{{ summary.averageTps !== null ? summary.averageTps.toFixed(1) : '--' }}</span>
        </div>
        <div class="summary-badge">
          <span class="badge-label">最低</span>
          <span class="badge-value text-red">{{ summary.minimumTps !== null ? summary.minimumTps.toFixed(1) : '--' }}</span>
        </div>
        <div class="summary-badge">
          <span class="badge-label">低于 28 TPS 累计</span>
          <span class="badge-value" :class="{ 'text-red': summary.lowTpsDurationMs > 0 }">{{ formatDuration(summary.lowTpsDurationMs) }}</span>
        </div>
      </div>
    </div>
    <div ref="chartRef" class="chart-surface" />
    <div v-if="chartError" class="chart-fallback">{{ chartError }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onActivated, onDeactivated, onMounted, onUnmounted, shallowRef, watch } from "vue";
import * as echarts from "echarts";
import { STATS_THEME } from "./serverStatsTheme";
import { readChartThemeTokens } from "../../theme/chartTheme";
import { useUiStore } from "../../stores/ui.store";
import type { ServerStatsSummary } from "../../composables/useServerMetricsAnalytics";
import type { ServerMetricSample } from "../../composables/useServerMetrics";

const props = defineProps<{
  samples: ServerMetricSample[];
  summary: ServerStatsSummary;
}>();

const chartRef = ref<HTMLElement | null>(null);
const chartInstance = shallowRef<echarts.ECharts | null>(null);
const chartError = ref("");
const ui = useUiStore();

let resizeObserver: ResizeObserver | null = null;

function formatDuration(ms: number) {
  if (ms <= 0) return "0 秒";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  if (remSec === 0) return `${minutes} 分`;
  return `${minutes} 分 ${remSec} 秒`;
}

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
  } catch (error) {
    chartError.value = "TPS 图表初始化失败";
    console.warn("[ServerTpsChart] Init failed:", error);
  }
}

function buildOption(): echarts.EChartsOption {
  const tokens = readChartThemeTokens();
  const tpsData = props.samples
    .filter((s) => s.metrics.tps != null)
    .map((s) => [s.timestamp_ms, s.metrics.tps]);

  const timestamps = props.samples.map((s) => s.timestamp_ms);

  return {
    backgroundColor: "transparent",
    animation: false,
    grid: {
      left: 16,
      right: 48,
      top: 24,
      bottom: 24,
      containLabel: true,
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
        const time = new Date(params[0].value[0]).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        const val = params[0].value[1];
        let stateText = "稳定";
        let dotColor = STATS_THEME.tpsGood;

        if (val < 28) {
          stateText = "异常";
          dotColor = STATS_THEME.tpsCritical;
        } else if (val < 35) {
          stateText = "注意";
          dotColor = STATS_THEME.tpsWarning;
        }

        return `
          <div style="font-weight: 700; margin-bottom: 4px; font-family: monospace;">${time}</div>
          <div style="display: flex; justify-content: space-between; gap: 16px; align-items: center;">
            <span style="font-size: 11px; display: inline-flex; align-items: center; gap: 4px;">
              <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${dotColor};"></span>
              帧率 (TPS)
            </span>
            <strong style="font-family: monospace;">${val.toFixed(1)} (${stateText})</strong>
          </div>
        `;
      },
    },
    xAxis: {
      type: "time",
      boundaryGap: false,
      min: timestamps.length > 0 ? timestamps[0] : undefined,
      max: timestamps.length > 0 ? timestamps[timestamps.length - 1] : undefined,
      axisLine: {
        lineStyle: {
          color: STATS_THEME.panelBorder,
        },
      },
      axisLabel: {
        color: tokens.axis,
        fontSize: 10,
        fontFamily: "monospace",
      },
      splitLine: {
        show: false, // Remove vertical splitLines
      },
    } as any,
    yAxis: {
      type: "value",
      min: 0,
      max: 50, // Fixed 0-50 bounds
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
    series: [
      {
        name: "TPS",
        type: "line",
        showSymbol: false,
        smooth: false,
        connectNulls: false,
        data: tpsData,
        lineStyle: {
          width: 2,
          color: STATS_THEME.tpsGood,
        },
        itemStyle: {
          color: STATS_THEME.tpsGood,
        },
        // Background colored bands: Green >= 35, Yellow 28-35, Red < 28
        markArea: {
          silent: true,
          data: [
            // Normal range (Green)
            [
              {
                yAxis: 35,
                itemStyle: {
                  color: "rgba(64, 185, 131, 0.035)",
                },
              },
              {
                yAxis: 50,
              },
            ],
            // Warning range (Yellow)
            [
              {
                yAxis: 28,
                itemStyle: {
                  color: "rgba(231, 184, 75, 0.035)",
                },
              },
              {
                yAxis: 35,
              },
            ],
            // Critical range (Red)
            [
              {
                yAxis: 0,
                itemStyle: {
                  color: "rgba(229, 104, 104, 0.035)",
                },
              },
              {
                yAxis: 28,
              },
            ],
          ],
        },
      },
    ],
  };
}

function updateChart() {
  if (!chartInstance.value) return;
  chartInstance.value.setOption(buildOption(), {
    replaceMerge: ["series"],
  });
}

watch(
  [() => props.samples, () => props.summary],
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

function activateChart() {
  ensureChart();
}

function deactivateChart() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  chartInstance.value?.dispose();
  chartInstance.value = null;
}

onMounted(activateChart);
onActivated(activateChart);
onDeactivated(deactivateChart);
onUnmounted(deactivateChart);
</script>

<style scoped>
.tps-chart {
  background: var(--stats-panel, var(--color-bg-card));
  border: 1px solid var(--stats-panel-border, var(--color-border-soft));
  border-radius: var(--card-radius, 14px);
  padding: 16px;
  display: flex;
  flex-direction: column;
  height: 320px;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.chart-title {
  font-size: 13px;
  font-weight: 800;
  color: var(--color-text-primary);
  margin: 0;
}

.chart-summary-badges {
  display: flex;
  gap: 12px;
}

.summary-badge {
  background: color-mix(in srgb, var(--color-bg-elevated) 86%, transparent);
  border: 1px solid var(--color-border-soft);
  padding: 4px 10px;
  border-radius: 8px;
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.badge-label {
  font-size: 10px;
  color: var(--color-text-muted);
  font-weight: 600;
}

.badge-value {
  font-size: 12px;
  font-weight: 800;
  font-family: 'JetBrains Mono', monospace;
  color: var(--color-text-primary);
}

.text-red {
  color: var(--stats-tps-critical, #e56868);
}

.chart-surface {
  flex: 1;
  min-height: 0;
  width: 100%;
}

.chart-fallback {
  display: grid;
  place-items: center;
  flex: 1;
  color: var(--color-text-muted);
  font-size: 13px;
}
</style>
