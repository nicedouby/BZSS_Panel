<template>
  <div class="server-metrics-chart">
    <div ref="chartRef" class="server-metrics-chart-surface" />
    <div v-if="chartError" class="chart-fallback">
      {{ chartError }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import * as echarts from "echarts";

import type { ServerMetricChannel, ServerMetricSample } from "../../composables/useServerMetrics";
import type { PlayerExtremaStats, PlayerTooltipStats } from "../../composables/serverMetricsAnalytics";
import { readChartThemeTokens } from "../../theme/chartTheme";
import { useUiStore } from "../../stores/ui.store";

const props = defineProps<{
  samples: ServerMetricSample[];
  channels: ServerMetricChannel[];
  enabledChannels: Record<string, boolean>;
  tooltipStatsByTimestamp?: Record<string, PlayerTooltipStats>;
}>();

const chartRef = ref<HTMLElement | null>(null);
const chartInstance = shallowRef<echarts.ECharts | null>(null);
const chartError = ref("");
const ui = useUiStore();

let resizeObserver: ResizeObserver | null = null;
let resizeFallbackHandler: (() => void) | null = null;

function ensureChart() {
  if (chartInstance.value || !chartRef.value) return;

  try {
    chartInstance.value = echarts.init(chartRef.value);
    chartInstance.value.setOption(buildBaseOption());

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        chartInstance.value?.resize();
      });
      resizeObserver.observe(chartRef.value);
    } else if (typeof window !== "undefined") {
      resizeFallbackHandler = () => {
        chartInstance.value?.resize();
      };
      window.addEventListener("resize", resizeFallbackHandler);
    }
  } catch (error) {
    chartError.value = "图表暂时不可用";
    console.warn("[ServerStats] Failed to initialise chart:", error);
  }
}

function buildBaseOption(): echarts.EChartsOption {
  const tokens = readChartThemeTokens();
  const accent = tokens.series[0];

  return {
    backgroundColor: "transparent",
    animation: false,
    grid: {
      left: 56,
      right: 56,
      top: 20,
      bottom: 48,
      containLabel: true,
    },
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: {
        type: "cross",
        lineStyle: {
          color: alphaColor(accent, 0.5),
          width: 1,
          type: "dashed",
        },
        crossStyle: {
          color: alphaColor(accent, 0.3),
          width: 1,
        },
      },
      backgroundColor: tokens.tooltipBg,
      borderColor: tokens.grid,
      borderWidth: 1,
      padding: 0,
      textStyle: {
        color: tokens.tooltipText,
      },
      extraCssText: "box-shadow: 0 12px 36px rgba(0,0,0,0.48); border-radius: 12px; overflow: hidden;",
      formatter: buildTooltip as any,
    } as any,
    xAxis: {
      type: "time",
      boundaryGap: false,
      axisLine: {
        lineStyle: {
          color: tokens.grid,
        },
      },
      axisLabel: {
        color: tokens.axis,
        fontSize: 11,
        fontFamily: "JetBrains Mono, monospace",
      },
      splitLine: {
        show: true,
        lineStyle: {
          color: tokens.grid,
        },
      },
    } as any,
    yAxis: [
      {
        type: "value",
        scale: true,
        axisLabel: {
          color: tokens.axis,
          fontSize: 11,
          fontFamily: "JetBrains Mono, monospace",
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: tokens.grid,
          },
        },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      {
        type: "value",
        min: 0,
        max: 50,
        axisLabel: {
          color: tokens.axis,
          fontSize: 11,
          fontFamily: "JetBrains Mono, monospace",
        },
        splitLine: {
          show: false,
        },
        axisLine: { show: false },
        axisTick: { show: false },
      },
    ],
    dataZoom: [
      {
        type: "inside",
        throttle: 50,
      },
      {
        type: "slider",
        height: 20,
        bottom: 4,
        borderColor: "transparent",
        fillerColor: alphaColor(accent, 0.12),
        handleStyle: {
          color: accent,
          borderColor: "transparent",
        },
        dataBackground: {
          lineStyle: { color: alphaColor(accent, 0.3) },
          areaStyle: { color: alphaColor(accent, 0.05) },
        },
        selectedDataBackground: {
          lineStyle: { color: alphaColor(accent, 0.5) },
          areaStyle: { color: alphaColor(accent, 0.1) },
        },
        textStyle: {
          color: tokens.axis,
          fontFamily: "JetBrains Mono, monospace",
        },
        brushSelect: false,
      },
    ],
    series: [],
  };
}

function buildTooltip(params: any[]) {
  if (!params || params.length === 0) return "";
  const tokens = readChartThemeTokens();
  const accent = tokens.series[0];

  const first = params[0];
  const timestamp = Number(first.axisValue ?? first.value?.[0] ?? Date.now());
  const time = formatTooltipTime(timestamp);
  const playerStats = props.tooltipStatsByTimestamp?.[String(timestamp)] ?? null;

  const rows = params.map((item) => {
    const value = Array.isArray(item.data) ? item.data[1] : item.data;
    const unit = getUnit(item.seriesName);
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:4px 0;">
        <span style="width:3px;height:16px;border-radius:2px;background:${item.color};flex:none;border-radius:1px;"></span>
        <span style="flex:1;font-size:11px;color:${tokens.axis};font-weight:500;">${escapeHtml(String(item.seriesName ?? ""))}</span>
        <strong style="font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:800;color:${tokens.tooltipText};">${escapeHtml(formatTooltipValue(value))}${unit ? `<span style="margin-left:3px;color:${tokens.axis};font-size:10px;font-weight:600;">${escapeHtml(unit)}</span>` : ""}</strong>
      </div>
    `;
  }).join("");

  const summaryRows = playerStats ? `
    <div style="margin-top:10px;padding:8px 13px 12px;border-top:1px solid ${alphaColor(tokens.grid, 0.8)};">
      <div style="margin-bottom:7px;font-size:10px;font-weight:800;letter-spacing:0.08em;color:${tokens.axis};text-transform:uppercase;">玩家统计</div>
      ${buildSummaryRow("往期此刻", playerStats.sameMoment, tokens.tooltipText)}
      ${buildSummaryRow("最近 7 天", playerStats.recent7d, tokens.tooltipText)}
      ${buildSummaryRow("最近 15 天", playerStats.recent15d, tokens.tooltipText)}
    </div>
  ` : "";

  return `
    <div style="min-width:240px;">
      <div style="padding:9px 13px 7px;background:${alphaColor(accent, 0.08)};border-bottom:1px solid ${alphaColor(accent, 0.16)};font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:${accent};letter-spacing:0.04em;">${escapeHtml(time)}</div>
      <div style="padding:6px 13px 0;">${rows}</div>
      ${summaryRows}
    </div>
  `;
}

function updateChart() {
  if (!chartInstance.value) return;

  try {
    const visibleSeries = props.channels
      .filter((channel) => props.enabledChannels[channel.key] !== false)
      .map((channel) => {
        const isPlayerCount = channel.key === "players";
        const seriesData = props.samples.map((sample) => [sample.timestamp_ms, sample.metrics[channel.key] ?? null]);

        const hexToRgb = (hex: string) => {
          const r = parseInt(hex.slice(1, 3), 16);
          const g = parseInt(hex.slice(3, 5), 16);
          const b = parseInt(hex.slice(5, 7), 16);
          return `${r},${g},${b}`;
        };

        let rgb = "148,163,184";
        try {
          rgb = hexToRgb(channel.color);
        } catch {
          // ignore
        }

        const series: any = {
          name: channel.label,
          type: "line",
          showSymbol: false,
          smooth: props.samples.length <= 1000 ? 0.35 : false,
          sampling: "lttb",
          connectNulls: true,
          yAxisIndex: channel.axis === "tps" ? 1 : 0,
          data: seriesData,
          lineStyle: {
            width: 2.5,
            color: channel.color,
            shadowColor: props.samples.length <= 1000 ? `rgba(${rgb}, 0.35)` : undefined,
            shadowBlur: props.samples.length <= 1000 ? 6 : undefined,
          },
          itemStyle: {
            color: channel.color,
          },
          areaStyle: {
            color: {
              type: "linear",
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: `rgba(${rgb}, 0.18)` },
                { offset: 0.6, color: `rgba(${rgb}, 0.05)` },
                { offset: 1, color: `rgba(${rgb}, 0)` },
              ],
            },
          },
          emphasis: {
            lineStyle: { width: 3 },
          },
        };

        if (isPlayerCount) {
          series.markPoint = {
            data: calculateSingularities(props.samples),
            symbol: "pin",
            symbolSize: 22,
            label: {
              fontSize: 9,
              fontWeight: "900",
              offset: [0, -2],
            },
          };
        }

        return series;
      });

    const timestamps = props.samples.map((sample) => sample.timestamp_ms);
    chartInstance.value.setOption({
      xAxis: {
        min: timestamps.length > 0 ? timestamps[0] : undefined,
        max: timestamps.length > 0 ? timestamps[timestamps.length - 1] : undefined,
      },
      series: visibleSeries,
    }, {
      replaceMerge: ["series"],
    });
  } catch (error) {
    chartError.value = "图表渲染失败";
    console.warn("[ServerStats] Failed to update chart:", error);
  }
}

function calculateSingularities(samples: ServerMetricSample[]) {
  const thresholds = [10, 20, 30, 40, 50, 60, 80, 98];
  const results: any[] = [];
  const reachedByDay = new Map<string, Set<number>>();

  for (const sample of samples) {
    const val = sample.metrics.players;
    if (val == null) continue;

    const date = new Date(sample.timestamp_ms);
    const hour = date.getHours();
    if (hour < 8) continue;

    const dayKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    if (!reachedByDay.has(dayKey)) {
      reachedByDay.set(dayKey, new Set());
    }

    const reached = reachedByDay.get(dayKey)!;
    for (const t of thresholds) {
      if (val >= t && !reached.has(t)) {
        reached.add(t);
        results.push({
          name: `P${t}`,
          value: t,
          xAxis: sample.timestamp_ms,
          yAxis: val,
          itemStyle: {
            color: t >= 80 ? "#ef4444" : t >= 40 ? "#f59e0b" : "#3b82f6",
          },
        });
      }
    }
  }

  return results;
}

function formatTooltipTime(timestamp: number) {
  if (!Number.isFinite(timestamp)) return "--";
  const date = new Date(timestamp);
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatTooltipValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
  return String(value);
}

function getUnit(seriesName: string) {
  const channel = props.channels.find((item) => item.label === seriesName || item.key === seriesName);
  if (!channel) return "";
  if (channel.axis === "tps") return "TPS";
  if (channel.key === "queue") return "队列";
  return "人数";
}

function buildSummaryRow(label: string, stats: PlayerExtremaStats | null, valueColor: string) {
  const value = stats ? `最少 ${formatTooltipValue(stats.min)} / 最多 ${formatTooltipValue(stats.max)}` : "--";
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0;">
      <span style="font-size:11px;font-weight:600;color:${readChartThemeTokens().axis};">${escapeHtml(label)}</span>
      <strong style="font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:800;color:${valueColor};">${escapeHtml(value)}</strong>
    </div>
  `;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function alphaColor(color: string, alpha: number) {
  const normalized = color.trim().startsWith("#") ? color.trim().slice(1) : color.trim();
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return color;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

onMounted(() => {
  ensureChart();
  updateChart();
});

watch(
  [
    () => props.samples,
    () => props.channels,
    () => ({ ...props.enabledChannels }),
    () => props.tooltipStatsByTimestamp,
  ],
  () => {
    updateChart();
  }
);

watch(() => ui.theme, () => {
  if (!chartInstance.value) return;
  chartInstance.value.setOption(buildBaseOption(), true);
  updateChart();
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (resizeFallbackHandler) {
    window.removeEventListener("resize", resizeFallbackHandler);
    resizeFallbackHandler = null;
  }
  chartInstance.value?.dispose();
  chartInstance.value = null;
});
</script>

<style scoped>
.server-metrics-chart {
  position: relative;
  width: 100%;
  height: 100%;
}

.server-metrics-chart-surface {
  width: 100%;
  height: 100%;
}

.chart-fallback {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  border-radius: 16px;
  background: color-mix(in srgb, var(--color-bg-card) 90%, transparent);
  color: var(--color-text-muted);
  font-size: 13px;
  pointer-events: none;
}
</style>
