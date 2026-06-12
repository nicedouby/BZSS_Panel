<template>
  <section class="combat-rate-chart-shell">
    <div v-if="hasChartData" class="combat-rate-chart-container">
      <div ref="chartRef" class="combat-rate-chart" />
      <div v-if="loading" class="chart-loader">
        <div class="spinner"></div>
      </div>
    </div>

    <div v-else class="bz-empty bz-empty--compact combat-rate-chart-empty">
      <div class="bz-empty-inner">
        <div class="bz-empty-icon">∿</div>
        <div class="bz-empty-title">暂无趋势数据</div>
        <div class="bz-empty-desc">至少需要两个有效时间点后，才会显示伤害、击倒、击杀趋势图。</div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import * as echarts from "echarts";
import { readChartThemeTokens } from "../../theme/chartTheme";
import { useUiStore } from "../../stores/ui.store";

const props = defineProps<{
  serverId?: string;
  refreshKey?: number;
  endpoint?: string;
}>();

const ui = useUiStore();
const chartRef = ref<HTMLElement | null>(null);
const chartInstance = shallowRef<echarts.ECharts | null>(null);
const loading = ref(false);
const rates = ref<Array<Record<string, unknown>>>([]);

const safeRates = computed(() => rates.value.filter((rate) => isValidTimestamp(rate.timestamp)));
const hasChartData = computed(() => safeRates.value.length >= 2);

async function fetchRates() {
  loading.value = true;
  try {
    const serverIdParam = props.serverId ? `&serverId=${props.serverId}` : "";
    const endpoint = props.endpoint || "/api/combat-clean/rates";
    const res = await fetch(`${endpoint}?window=60${serverIdParam}`);
    const data = await res.json();
    rates.value = Array.isArray(data.rates) ? data.rates : [];
    updateChart();
  } catch (error) {
    console.error("Failed to fetch combat rates:", error);
    rates.value = [];
    updateChart();
  } finally {
    loading.value = false;
  }
}

function updateChart() {
  if (!chartInstance.value) return;
  if (!hasChartData.value) {
    chartInstance.value.clear();
    return;
  }

  const labels = safeRates.value.map((rate) => formatShortTime(rate.timestamp));
  const damageData = safeRates.value.map((rate) => toNumber(rate.damage));
  const woundData = safeRates.value.map((rate) => toNumber(rate.wound));
  const killData = safeRates.value.map((rate) => toNumber(rate.kill));
  const tokens = readChartThemeTokens();

  chartInstance.value.setOption({
    backgroundColor: "transparent",
    animation: false,
    grid: {
      left: "3%",
      right: "4%",
      bottom: "3%",
      top: "15%",
      containLabel: true,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: tokens.tooltipBg,
      borderColor: tokens.grid,
      textStyle: { color: tokens.tooltipText },
      formatter: (params: any[]) => formatTooltip(params, tokens),
    },
    legend: {
      data: ["伤害", "击倒", "击杀"],
      textStyle: { color: tokens.axis },
      top: 0,
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: labels,
      axisLine: { lineStyle: { color: tokens.grid } },
      axisLabel: {
        color: tokens.axis,
        fontSize: 10,
        formatter: (value: number) => formatShortTime(value),
      },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: tokens.grid } },
      axisLabel: { color: tokens.axis, fontSize: 10 },
    },
    series: [
      { name: "伤害", type: "line", smooth: true, showSymbol: false, areaStyle: { opacity: 0.1 }, lineStyle: { width: 2, color: tokens.series[0] }, itemStyle: { color: tokens.series[0] }, data: damageData },
      { name: "击倒", type: "line", smooth: true, showSymbol: false, areaStyle: { opacity: 0.1 }, lineStyle: { width: 2, color: tokens.series[1] }, itemStyle: { color: tokens.series[1] }, data: woundData },
      { name: "击杀", type: "line", smooth: true, showSymbol: false, areaStyle: { opacity: 0.1 }, lineStyle: { width: 2, color: tokens.series[2] }, itemStyle: { color: tokens.series[2] }, data: killData },
    ],
  }, true);
}

function formatTooltip(params: any[], tokens: ReturnType<typeof readChartThemeTokens>) {
  if (!params || params.length === 0) return "";
  const timeStr = formatTooltipTime(params[0].axisValue);
  const rows = params.map((point) => {
    const label = point.seriesName === "伤害" ? "DPM" : point.seriesName === "击倒" ? "WPM" : "KPM";
    return `
      <div style="display:flex;align-items:center;gap:16px;margin-top:8px;">
        <span style="width:8px;height:8px;border-radius:2px;background:${point.color};"></span>
        <div style="flex:1;display:flex;flex-direction:column;">
          <span style="font-size:12px;color:${tokens.tooltipText};line-height:1.2;font-weight:600;">${point.seriesName}</span>
          <span style="font-size:10px;color:${tokens.axis};">频率</span>
        </div>
        <div style="text-align:right;min-width:60px;">
          <b style="font-family:JetBrains Mono, monospace;font-size:15px;color:${tokens.tooltipText};">${point.data}</b>
          <span style="font-size:10px;color:${point.color};margin-left:4px;font-weight:700;">${label}</span>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div style="min-width:210px;padding:12px;background:${tokens.tooltipBg};border:1px solid ${tokens.grid};border-radius:8px;box-shadow:0 10px 20px rgba(0,0,0,0.22);">
      <div style="font-weight:700;margin-bottom:12px;border-bottom:1px solid ${tokens.grid};padding-bottom:10px;font-size:13px;color:${tokens.tooltipText};display:flex;justify-content:space-between;">
        <span>战斗趋势</span>
        <span style="color:${tokens.axis};font-weight:400;">${timeStr}</span>
      </div>
      ${rows}
    </div>
  `;
}

onMounted(() => {
  if (!chartRef.value) return;
  chartInstance.value = echarts.init(chartRef.value);
  window.addEventListener("resize", handleResize);
  updateChart();
  void fetchRates();
});

watch(() => props.refreshKey, () => {
  void fetchRates();
});

watch(() => ui.theme, () => {
  updateChart();
});

onUnmounted(() => {
  window.removeEventListener("resize", handleResize);
  chartInstance.value?.dispose();
});

function handleResize() {
  chartInstance.value?.resize();
}

function isValidTimestamp(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function formatShortTime(value: unknown) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "--:--";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--:--";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatTooltipTime(value: unknown) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "--:--";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
</script>

<style scoped>
.combat-rate-chart-shell {
  min-height: 108px;
}

.combat-rate-chart-container {
  position: relative;
  width: 100%;
  height: 108px;
  background: color-mix(in srgb, var(--color-bg-elevated) 85%, transparent);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  padding: 10px;
}

.combat-rate-chart {
  width: 100%;
  height: 100%;
}

.combat-rate-chart-empty {
  min-height: 108px;
}

.chart-loader {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--color-bg-page) 55%, transparent);
  border-radius: 8px;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid color-mix(in srgb, var(--color-border-default) 60%, transparent);
  border-top-color: var(--chart-series-1);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
