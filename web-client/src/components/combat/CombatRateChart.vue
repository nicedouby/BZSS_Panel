<template>
  <div class="combat-rate-chart-container">
    <div ref="chartRef" class="combat-rate-chart" />
    <div v-if="loading" class="chart-loader">
      <div class="spinner"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import * as echarts from "echarts";

const props = defineProps<{
  serverId?: string;
  refreshKey?: number;
}>();

const chartRef = ref<HTMLElement | null>(null);
const chartInstance = shallowRef<echarts.ECharts | null>(null);
const loading = ref(false);

async function fetchRates() {
  loading.value = true;
  try {
    const serverIdParam = props.serverId ? `&serverId=${props.serverId}` : "";
    const res = await fetch(`/api/combat-clean/rates?window=60${serverIdParam}`);
    const data = await res.json();
    updateChart(data.rates || []);
  } catch (error) {
    console.error("Failed to fetch combat rates:", error);
  } finally {
    loading.value = false;
  }
}

function updateChart(rates: any[]) {
  if (!chartInstance.value) return;

  const timestamps = rates.map((r) => r.timestamp);
  const damageData = rates.map((r) => r.damage);
  const woundData = rates.map((r) => r.wound);
  const killData = rates.map((r) => r.kill);

  chartInstance.value.setOption({
    xAxis: {
      data: timestamps,
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
  if (chartRef.value) {
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
          const date = new Date(Number(params[0].axisValue));
          const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
          const rows = params.map((p) => {
            const label = p.seriesName === "伤害" ? "DPM" : p.seriesName === "击倒" ? "WPM" : "KPM";
            const desc = p.seriesName === "伤害" ? "频率" : p.seriesName === "击倒" ? "频率" : "频率";
            return `
            <div style="display:flex;align-items:center;gap:16px;margin-top:8px;">
              <span style="width:8px;height:8px;border-radius:2px;background:${p.color};"></span>
              <div style="flex:1;display:flex;flex-direction:column;">
                <span style="font-size:12px;color:#fff;line-height:1.2;font-weight:600;">${p.seriesName}</span>
                <span style="font-size:10px;color:#666;">${desc}</span>
              </div>
              <div style="text-align:right;min-width:60px;">
                <b style="font-family:JetBrains Mono, monospace;font-size:15px;color:#fff;">${p.data}</b>
                <span style="font-size:10px;color:#3b82f6;margin-left:4px;font-weight:700;">${label}</span>
              </div>
            </div>
          `;
          }).join("");
          return `
            <div style="min-width:210px; padding: 12px; background: #161b22; border: 1px solid #38414c; border-radius: 8px; box-shadow: 0 10px 20px rgba(0,0,0,0.4);">
              <div style="font-weight:700;margin-bottom:12px;border-bottom:1px solid #38414c;padding-bottom:10px;font-size:13px;color:#f0f6fc;display:flex;justify-content:space-between;">
                <span>战术效能分析</span>
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
          formatter: (value: number) => {
            const date = new Date(value);
            return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
          },
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
  }
});

watch(() => props.refreshKey, () => {
  void fetchRates();
});

onUnmounted(() => {
  chartInstance.value?.dispose();
});
</script>

<style scoped>
.combat-rate-chart-container {
  position: relative;
  width: 100%;
  height: 180px;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 8px;
}

.combat-rate-chart {
  width: 100%;
  height: 100%;
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
  to { transform: rotate(360deg); }
}
</style>
