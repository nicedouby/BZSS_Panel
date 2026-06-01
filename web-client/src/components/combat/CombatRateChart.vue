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
        <div class="bz-empty-icon">∅</div>
        <div class="bz-empty-title">暂无趋势数据</div>
        <div class="bz-empty-desc">
          至少需要两个有效时间点后，才会显示伤害、击倒、击杀趋势图。
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import * as echarts from "echarts";

const props = defineProps<{
  serverId?: string;
  refreshKey?: number;
  endpoint?: string;
}>();

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

  chartInstance.value.setOption({
    xAxis: {
      data: labels,
    },
    series: [
      {
        name: "伤害",
        data: damageData,
      },
      {
        name: "击倒",
        data: woundData,
      },
      {
        name: "击杀",
        data: killData,
      },
    ],
  });
}

onMounted(() => {
  if (!chartRef.value) return;

  chartInstance.value = echarts.init(chartRef.value, "dark");
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
      backgroundColor: "#1a2128",
      borderColor: "#38414c",
      textStyle: { color: "#fff" },
      formatter: (params: any[]) => {
        if (!params || params.length === 0) return "";
        const timeStr = formatTooltipTime(params[0].axisValue);
        const rows = params
          .map((p) => {
            const label = p.seriesName === "伤害" ? "DPM" : p.seriesName === "击倒" ? "WPM" : "KPM";
            return `
            <div style="display:flex;align-items:center;gap:16px;margin-top:8px;">
              <span style="width:8px;height:8px;border-radius:2px;background:${p.color};"></span>
              <div style="flex:1;display:flex;flex-direction:column;">
                <span style="font-size:12px;color:#fff;line-height:1.2;font-weight:600;">${p.seriesName}</span>
                <span style="font-size:10px;color:#666;">频率</span>
              </div>
              <div style="text-align:right;min-width:60px;">
                <b style="font-family:JetBrains Mono, monospace;font-size:15px;color:#fff;">${p.data}</b>
                <span style="font-size:10px;color:#3b82f6;margin-left:4px;font-weight:700;">${label}</span>
              </div>
            </div>
          `;
          })
          .join("");
        return `
          <div style="min-width:210px; padding: 12px; background: #161b22; border: 1px solid #38414c; border-radius: 8px; box-shadow: 0 10px 20px rgba(0,0,0,0.4);">
            <div style="font-weight:700;margin-bottom:12px;border-bottom:1px solid #38414c;padding-bottom:10px;font-size:13px;color:#f0f6fc;display:flex;justify-content:space-between;">
              <span>战斗趋势</span>
              <span style="color:#8b949e;font-weight:400;">${timeStr}</span>
            </div>
            ${rows}
          </div>
        `;
      },
    },
    legend: {
      data: ["伤害", "击倒", "击杀"],
      textStyle: { color: "#9aa7b2" },
      top: 0,
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      axisLine: { lineStyle: { color: "#2d3748" } },
      axisLabel: {
        color: "#718096",
        fontSize: 10,
        formatter: (value: number) => formatShortTime(value),
      },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: "#1a212c" } },
      axisLabel: { color: "#718096", fontSize: 10 },
    },
    series: [
      {
        name: "伤害",
        type: "line",
        smooth: true,
        showSymbol: false,
        areaStyle: { opacity: 0.1 },
        lineStyle: { width: 2, color: "#3b82f6" },
        itemStyle: { color: "#3b82f6" },
        data: [],
      },
      {
        name: "击倒",
        type: "line",
        smooth: true,
        showSymbol: false,
        areaStyle: { opacity: 0.1 },
        lineStyle: { width: 2, color: "#f59e0b" },
        itemStyle: { color: "#f59e0b" },
        data: [],
      },
      {
        name: "击杀",
        type: "line",
        smooth: true,
        showSymbol: false,
        areaStyle: { opacity: 0.1 },
        lineStyle: { width: 2, color: "#ef4444" },
        itemStyle: { color: "#ef4444" },
        data: [],
      },
    ],
  });

  window.addEventListener("resize", () => chartInstance.value?.resize());
  void fetchRates();
});

watch(() => props.refreshKey, () => {
  void fetchRates();
});

onUnmounted(() => {
  chartInstance.value?.dispose();
});

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
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
</script>

<style scoped>
.combat-rate-chart-shell {
  min-height: 180px;
}

.combat-rate-chart-container {
  position: relative;
  width: 100%;
  height: 128px;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 12px;
}

.combat-rate-chart {
  width: 100%;
  height: 100%;
}

.combat-rate-chart-empty {
  min-height: 128px;
}

.chart-loader {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(13, 17, 23, 0.5);
  border-radius: 8px;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
