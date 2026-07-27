<template>
  <div class="population-chart">
    <div class="chart-header">
      <h3 class="chart-title">人数与队列趋势</h3>
      <div class="chart-legend">
        <label class="legend-item">
          <input type="checkbox" v-model="showPlayers" />
          <span class="legend-dot player" />
          显示人数
        </label>
        <label class="legend-item">
          <input type="checkbox" v-model="showQueue" />
          <span class="legend-dot queue" />
          显示队列
        </label>
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
import type { ServerMetricSample } from "../../composables/useServerMetrics";

const props = defineProps<{
  samples: ServerMetricSample[];
  maxPlayers: number;
  matchStartedAt: number | null;
}>();

const chartRef = ref<HTMLElement | null>(null);
const chartInstance = shallowRef<echarts.ECharts | null>(null);
const chartError = ref("");
const ui = useUiStore();

const showPlayers = ref(true);
const showQueue = ref(true);

let resizeObserver: ResizeObserver | null = null;

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
    chartError.value = "人数图表初始化失败";
    console.warn("[ServerPopulationChart] Init failed:", error);
  }
}

function buildOption(): echarts.EChartsOption {
  const tokens = readChartThemeTokens();

  // Create Series
  const series: any[] = [];
  const maxVal = props.maxPlayers || 100;

  if (showPlayers.value) {
    const playersData = props.samples.map((s) => [s.timestamp_ms, s.metrics.players ?? 0]);
    series.push({
      name: "在线人数",
      type: "line",
      showSymbol: false,
      smooth: false,
      connectNulls: false, // Default false to avoid faking data
      data: playersData,
      lineStyle: {
        width: 2,
        color: STATS_THEME.player,
      },
      itemStyle: {
        color: STATS_THEME.player,
      },
      // Capacity line & full server area
      markLine: {
        symbol: "none",
        data: [
          {
            name: "服务器满载",
            yAxis: maxVal,
            lineStyle: {
              color: STATS_THEME.tpsCritical,
              type: "dashed",
              width: 1,
            },
            label: {
              formatter: `满人线: ${maxVal}人`,
              position: "end",
              fontSize: 10,
              color: tokens.axis,
            },
          },
          ...(props.matchStartedAt
            ? [
                {
                  name: "对局切换",
                  xAxis: props.matchStartedAt,
                  lineStyle: {
                    color: STATS_THEME.player,
                    type: "solid",
                    width: 1,
                  },
                  label: {
                    formatter: "本局开始",
                    position: "end",
                    fontSize: 10,
                    color: tokens.axis,
                  },
                },
              ]
            : []),
        ],
      },
      // Highlight full server zone on top
      markArea: {
        silent: true,
        itemStyle: {
          color: "rgba(229, 104, 104, 0.04)", // very light critical red
        },
        data: [
          [
            {
              yAxis: maxVal,
            },
            {
              yAxis: maxVal + 20,
            },
          ],
        ],
      },
    });
  }

  if (showQueue.value) {
    const queueData = props.samples.map((s) => [s.timestamp_ms, s.metrics.queue ?? 0]);
    series.push({
      name: "排队人数",
      type: "line",
      showSymbol: false,
      smooth: false,
      connectNulls: false,
      data: queueData,
      lineStyle: {
        width: 2,
        color: STATS_THEME.queue,
      },
      itemStyle: {
        color: STATS_THEME.queue,
      },
      areaStyle: {
        // Light fill area
        color: "rgba(240, 168, 75, 0.08)",
      },
    });
  }

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
        let html = `<div style="font-weight: 700; margin-bottom: 4px; font-family: monospace;">${time}</div>`;
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
        show: false, // Remove vertical grid splitLines
      },
    } as any,
    yAxis: {
      type: "value",
      scale: true,
      axisLabel: {
        color: tokens.axis,
        fontSize: 10,
        fontFamily: "monospace",
      },
      splitLine: {
        show: true, // Only keep horizontal grid
        lineStyle: {
          color: STATS_THEME.grid,
          width: 1,
        },
      },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    // Hidden slider zoom bar (drag & wheel zoom enabled)
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
  [
    () => props.samples,
    () => props.maxPlayers,
    () => props.matchStartedAt,
    showPlayers,
    showQueue,
  ],
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
.population-chart {
  background: var(--stats-panel, var(--color-bg-card));
  border: 1px solid var(--stats-panel-border, var(--color-border-soft));
  border-radius: var(--card-radius, 14px);
  padding: 16px;
  display: flex;
  flex-direction: column;
  height: 400px;
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

.chart-legend {
  display: flex;
  gap: 16px;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--color-text-secondary);
  font-weight: 600;
  cursor: pointer;
}

.legend-item input {
  cursor: pointer;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.legend-dot.player {
  background: var(--stats-player, #4da3ff);
}

.legend-dot.queue {
  background: var(--stats-queue, #f0a84b);
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
