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

const props = defineProps<{
  samples: ServerMetricSample[];
  channels: ServerMetricChannel[];
  enabledChannels: Record<string, boolean>;
}>();

const chartRef = ref<HTMLElement | null>(null);
const chartInstance = shallowRef<echarts.ECharts | null>(null);
const chartError = ref("");

let resizeObserver: ResizeObserver | null = null;
let resizeFallbackHandler: (() => void) | null = null;

function ensureChart() {
  if (chartInstance.value || !chartRef.value) return;

  try {
    chartInstance.value = echarts.init(chartRef.value, "dark");
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
  return {
    backgroundColor: "transparent",
    animation: false,
    grid: {
      left: 48,
      right: 48,
      top: 28,
      bottom: 44,
      containLabel: true,
    },
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: {
        type: "cross",
        lineStyle: {
          color: "#60a5fa",
          width: 1,
        },
      },
      backgroundColor: "#10151b",
      borderColor: "#2d3748",
      textStyle: {
        color: "#e5eef7",
      },
      formatter: buildTooltip as any,
    } as any,
    xAxis: {
      type: "time",
      boundaryGap: false,
      axisLine: {
        lineStyle: {
          color: "#2d3748",
        },
      },
      axisLabel: {
        color: "#7c8b99",
        fontSize: 11,
      },
      splitLine: {
        show: true,
        lineStyle: {
          color: "#18202a",
        },
      },
    } as any,
    yAxis: [
      {
        type: "value",
        scale: true,
        axisLabel: {
          color: "#7c8b99",
          fontSize: 11,
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: "#18202a",
          },
        },
      },
      {
        type: "value",
        min: 0,
        max: 60,
        axisLabel: {
          color: "#7c8b99",
          fontSize: 11,
        },
        splitLine: {
          show: false,
        },
      },
    ],
    dataZoom: [
      {
        type: "inside",
        throttle: 50,
      },
      {
        type: "slider",
        height: 18,
        bottom: 2,
        borderColor: "transparent",
        fillerColor: "rgba(96, 165, 250, 0.14)",
        handleStyle: {
          color: "#60a5fa",
        },
        textStyle: {
          color: "#7c8b99",
        },
      },
    ],
    series: [],
  };
}

function buildTooltip(params: any[]) {
  if (!params || params.length === 0) return "";

  const first = params[0];
  const time = formatTooltipTime(Number(first.axisValue ?? first.value?.[0] ?? Date.now()));
  const rows = params.map((item) => {
    const value = Array.isArray(item.data) ? item.data[1] : item.data;
    const unit = getUnit(item.seriesName);
    return `
      <div style="display:flex;align-items:center;gap:10px;margin-top:6px;">
        <span style="width:8px;height:8px;border-radius:2px;background:${item.color};flex:none;"></span>
        <span style="flex:1;font-size:12px;color:#a8b4bf;">${escapeHtml(String(item.seriesName ?? ""))}</span>
        <strong style="font-family:JetBrains Mono, monospace;font-size:13px;color:#f8fafc;">${escapeHtml(formatTooltipValue(value))}${unit ? `<span style="margin-left:4px;color:#7c8b99;font-size:11px;">${escapeHtml(unit)}</span>` : ""}</strong>
      </div>
    `;
  }).join("");

  return `
    <div style="min-width:220px;padding:10px 12px;">
      <div style="padding-bottom:8px;margin-bottom:8px;border-bottom:1px solid #2d3748;font-size:12px;font-weight:700;color:#f8fafc;">${escapeHtml(time)}</div>
      ${rows}
    </div>
  `;
}

function updateChart() {
  if (!chartInstance.value) return;

  try {
    const visibleSeries = props.channels
      .filter((channel) => props.enabledChannels[channel.key] !== false)
      .map((channel) => ({
        name: channel.label,
        type: "line",
        showSymbol: false,
        smooth: true,
        connectNulls: true,
        yAxisIndex: channel.axis === "tps" ? 1 : 0,
        data: props.samples.map((sample) => [sample.timestamp_ms, sample.metrics[channel.key] ?? null]),
        lineStyle: {
          width: 2,
          color: channel.color,
        },
        itemStyle: {
          color: channel.color,
        },
      }));

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
  if (channel.key === "queue") return "queue";
  return "pax";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

onMounted(() => {
  ensureChart();
  updateChart();
});

watch(
  () => [props.samples, props.channels, props.enabledChannels],
  () => {
    updateChart();
  },
  { deep: true },
);

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
  min-height: 420px;
}

.server-metrics-chart-surface {
  width: 100%;
  height: 100%;
  min-height: 420px;
}

.chart-fallback {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-muted);
  font-size: 13px;
  pointer-events: none;
}
</style>
