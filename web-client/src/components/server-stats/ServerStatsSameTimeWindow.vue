<template>
  <section class="same-time-window">
    <header class="window-header">
      <div>
        <span class="eyebrow">HISTORICAL SAME-TIME WINDOW</span>
        <h2>同一时刻，服务器表现如何？</h2>
        <p>把不同日期的相同时刻自动叠在一起，直接判断当前人数是否高于历史同期。</p>
      </div>

      <div class="window-controls">
        <label class="control-field time-field">
          <span>对比时刻</span>
          <input
            type="time"
            :value="targetTime"
            @input="emit('update:target-time', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <button class="now-button" type="button" @click="emit('set-now')">回到现在</button>
        <label class="control-field">
          <span>前后窗口</span>
          <select
            :value="windowMinutes"
            @change="emit('update:window-minutes', Number(($event.target as HTMLSelectElement).value) as SameTimeWindowMinutes)"
          >
            <option :value="15">±15 分钟</option>
            <option :value="30">±30 分钟</option>
            <option :value="60">±60 分钟</option>
          </select>
        </label>
        <label class="control-field">
          <span>历史样本</span>
          <select
            :value="lookbackDays"
            :disabled="usingCustomDates"
            @change="emit('update:lookback-days', Number(($event.target as HTMLSelectElement).value) as SameTimeLookbackDays)"
          >
            <option :value="3">最近 3 天</option>
            <option :value="7">最近 7 天</option>
            <option :value="14">最近 14 天</option>
          </select>
        </label>
        <label class="weekday-toggle">
          <input
            type="checkbox"
            :checked="sameWeekdayOnly"
            @change="emit('update:same-weekday-only', ($event.target as HTMLInputElement).checked)"
          />
          仅同星期
        </label>
        <button
          class="now-button dates-button"
          :class="{ active: usingCustomDates }"
          type="button"
          @click="emit('open-dates')"
        >
          {{ usingCustomDates ? `已自选 ${selectedDateCount} 天` : "自选日期" }}
        </button>
        <button class="refresh-button" type="button" :disabled="loading" @click="emit('refresh')">
          {{ loading ? "分析中…" : "重新分析" }}
        </button>
      </div>
    </header>

    <div class="window-body">
      <div class="chart-card">
        <div class="chart-heading">
          <div>
            <span class="chart-kicker">人数曲线主视图</span>
            <strong>{{ targetTime }} 前后 {{ windowMinutes }} 分钟</strong>
          </div>
          <div class="chart-key">
            <span><i class="today-line" />今天</span>
            <span><i class="history-line" />历史日期</span>
            <span>{{ summary.sampleDays }} 个有效历史样本</span>
          </div>
        </div>
        <div ref="chartRef" class="same-time-chart" />
        <div v-if="!loading && series.length === 0" class="chart-empty">
          所选时刻附近暂无数据，请扩大窗口或更换时刻。
        </div>
      </div>

      <aside class="intelligence-card" :class="`tone-${summary.tone}`">
        <div class="intelligence-label">智能窗口 / SMART READ</div>
        <div class="current-number">
          <strong>{{ summary.currentPlayers ?? "—" }}</strong>
          <span>人</span>
        </div>
        <div
          v-if="summary.delta !== null"
          class="delta-badge"
          :class="`tone-${summary.tone}`"
        >
          历史同期 {{ summary.delta > 0 ? "+" : "" }}{{ summary.delta }} 人
          <template v-if="summary.deltaPercent !== null">
            · {{ summary.deltaPercent > 0 ? "+" : "" }}{{ summary.deltaPercent }}%
          </template>
        </div>

        <h3>{{ summary.headline }}</h3>
        <p class="intelligence-message">{{ summary.message }}</p>

        <div class="stat-grid">
          <div>
            <span>历史平均</span>
            <strong>{{ formatPeople(summary.historicalAverage) }}</strong>
          </div>
          <div>
            <span>历史中位数</span>
            <strong>{{ formatPeople(summary.historicalMedian) }}</strong>
          </div>
          <div>
            <span>通常区间</span>
            <strong>{{ formatRange(summary.typicalLow, summary.typicalHigh) }}</strong>
          </div>
          <div>
            <span>判断置信度</span>
            <strong>{{ confidenceLabel }}</strong>
          </div>
        </div>

        <div class="date-breakdown">
          <div class="breakdown-title">
            <span>逐日同期人数</span>
            <span>离目标时刻最近的记录</span>
          </div>
          <div class="date-rows">
            <div
              v-for="item in representativeRows"
              :key="item.date"
              class="date-row"
              :class="{ today: item.isToday }"
            >
              <div class="date-name">
                <strong>{{ item.label }}</strong>
                <span>{{ item.date }}</span>
              </div>
              <div class="people-bar">
                <i :style="{ width: `${item.barPercent}%` }" />
              </div>
              <strong class="row-value">{{ item.players }} 人</strong>
              <span class="row-time">{{ item.time }}</span>
            </div>
          </div>
        </div>

        <p v-if="error" class="inline-error">{{ error }}</p>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import * as echarts from "echarts";
import { useUiStore } from "../../stores/ui.store";
import { readChartThemeTokens } from "../../theme/chartTheme";
import { STATS_THEME } from "./serverStatsTheme";
import type {
  SameTimeLookbackDays,
  SameTimeSeries,
  SameTimeSummary,
  SameTimeWindowMinutes,
} from "../../composables/useServerMetricsSameTime";

const props = defineProps<{
  targetTime: string;
  windowMinutes: SameTimeWindowMinutes;
  lookbackDays: SameTimeLookbackDays;
  sameWeekdayOnly: boolean;
  series: SameTimeSeries[];
  summary: SameTimeSummary;
  loading: boolean;
  error: string;
  maxPlayers: number;
  usingCustomDates: boolean;
  selectedDateCount: number;
}>();

const emit = defineEmits<{
  (event: "update:target-time", value: string): void;
  (event: "update:window-minutes", value: SameTimeWindowMinutes): void;
  (event: "update:lookback-days", value: SameTimeLookbackDays): void;
  (event: "update:same-weekday-only", value: boolean): void;
  (event: "set-now"): void;
  (event: "open-dates"): void;
  (event: "refresh"): void;
}>();

const chartRef = ref<HTMLElement | null>(null);
const chartInstance = shallowRef<echarts.ECharts | null>(null);
const ui = useUiStore();
let resizeObserver: ResizeObserver | null = null;

const historyColors = ["#7796c8", "#8d7fc4", "#5f9e91", "#ad8661", "#896f97", "#7088a1", "#7d9275"];

const confidenceLabel = computed(() => ({
  none: "无样本",
  low: "较低",
  medium: "中等",
  high: "较高",
})[props.summary.confidence]);

const representativeRows = computed(() => {
  const values = props.series
    .filter((item) => item.representative)
    .map((item) => Number(item.representative?.players ?? 0));
  const maxValue = Math.max(props.maxPlayers || 100, ...values, 1);
  return props.series
    .filter((item) => item.representative)
    .map((item) => {
      const point = item.representative!;
      return {
        date: item.date,
        label: item.label,
        isToday: item.isToday,
        players: point.players,
        time: new Date(point.timestampMs).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
        barPercent: Math.max(3, Math.min(100, (point.players / maxValue) * 100)),
      };
    });
});

function formatPeople(value: number | null) {
  return value === null ? "—" : `${value} 人`;
}

function formatRange(low: number | null, high: number | null) {
  return low === null || high === null ? "—" : `${low}–${high} 人`;
}

function offsetToClock(offsetMinutes: number) {
  const [hours, minutes] = props.targetTime.split(":").map(Number);
  const totalMinutes = ((hours * 60 + minutes + Math.round(offsetMinutes)) % 1440 + 1440) % 1440;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function buildOption(): echarts.EChartsOption {
  const tokens = readChartThemeTokens();
  const chartSeries = props.series.map((item, index) => {
    const color = item.isToday ? STATS_THEME.player : historyColors[index % historyColors.length];
    return {
      name: item.isToday ? "今天" : item.date,
      type: "line" as const,
      data: item.points.map((point) => [point.offsetMinutes, point.players]),
      showSymbol: false,
      smooth: 0.18,
      connectNulls: false,
      z: item.isToday ? 10 : 2,
      lineStyle: {
        color,
        width: item.isToday ? 4 : 1.5,
        opacity: item.isToday ? 1 : 0.66,
      },
      itemStyle: { color },
      areaStyle: item.isToday ? { color: "rgba(77, 163, 255, 0.12)" } : undefined,
      emphasis: {
        focus: "series" as const,
        lineStyle: { width: item.isToday ? 5 : 3, opacity: 1 },
      },
    };
  });

  return {
    backgroundColor: "transparent",
    animation: false,
    color: [STATS_THEME.player, ...historyColors],
    grid: {
      left: 18,
      right: 26,
      top: 42,
      bottom: 18,
      containLabel: true,
    },
    legend: {
      type: "scroll",
      top: 4,
      left: 0,
      right: 0,
      itemWidth: 18,
      itemHeight: 3,
      textStyle: { color: tokens.axis, fontSize: 10 },
      pageTextStyle: { color: tokens.axis },
    },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: tokens.tooltipBg,
      borderColor: STATS_THEME.panelBorder,
      borderWidth: 1,
      textStyle: { color: tokens.tooltipText, fontSize: 11 },
      formatter: (params: any) => {
        if (!params?.length) return "";
        const offset = Number(params[0].value[0]);
        const rows = params
          .sort((left: any, right: any) => Number(right.value[1]) - Number(left.value[1]))
          .map((item: any) => (
            `<div style="display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:4px">`
            + `<span>${item.marker}${item.seriesName}</span><strong>${item.value[1]} 人</strong></div>`
          ))
          .join("");
        return `<strong>${offsetToClock(offset)}</strong><span style="margin-left:8px;color:${tokens.axis}">${offset > 0 ? "+" : ""}${Math.round(offset)} 分钟</span>${rows}`;
      },
    },
    xAxis: {
      type: "value",
      min: -props.windowMinutes,
      max: props.windowMinutes,
      interval: props.windowMinutes <= 15 ? 5 : props.windowMinutes <= 30 ? 10 : 20,
      axisLine: { lineStyle: { color: STATS_THEME.panelBorder } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: {
        color: tokens.axis,
        fontSize: 10,
        formatter: (value: number) => offsetToClock(value),
      },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: Math.max(props.maxPlayers || 100, ...props.series.flatMap((item) => item.points.map((point) => point.players))) + 5,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: tokens.axis,
        fontSize: 10,
        formatter: "{value} 人",
      },
      splitLine: {
        lineStyle: { color: STATS_THEME.grid, width: 1 },
      },
    },
    series: chartSeries,
    graphic: [
      {
        type: "line",
        silent: true,
        shape: { x1: "50%", y1: 44, x2: "50%", y2: "92%" },
        style: { stroke: STATS_THEME.player, lineWidth: 1, lineDash: [5, 5], opacity: 0.65 },
      },
    ],
  };
}

function ensureChart() {
  if (chartInstance.value || !chartRef.value) return;
  chartInstance.value = echarts.init(chartRef.value);
  chartInstance.value.setOption(buildOption());
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => chartInstance.value?.resize());
    resizeObserver.observe(chartRef.value);
  }
}

function updateChart(replace = false) {
  if (!chartInstance.value) {
    ensureChart();
    return;
  }
  chartInstance.value.setOption(buildOption(), replace);
}

function deactivateChart() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  chartInstance.value?.dispose();
  chartInstance.value = null;
}

watch(
  [() => props.series, () => props.windowMinutes, () => props.targetTime, () => props.maxPlayers],
  () => updateChart(),
  { deep: false },
);

watch(() => ui.theme, () => updateChart(true));

onMounted(ensureChart);
onActivated(ensureChart);
onDeactivated(deactivateChart);
onUnmounted(deactivateChart);
</script>

<style scoped>
.same-time-window {
  background:
    linear-gradient(145deg, color-mix(in srgb, var(--color-brand-primary) 7%, transparent), transparent 38%),
    var(--stats-panel, var(--color-bg-card));
  border: 1px solid var(--stats-panel-border, var(--color-border-soft));
  border-radius: var(--card-radius, 14px);
  padding: 18px;
  margin-bottom: 16px;
  flex-shrink: 0;
}

.window-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 16px;
}

.eyebrow,
.chart-kicker,
.intelligence-label {
  color: var(--color-brand-primary);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: 0.14em;
}

.window-header h2 {
  margin: 4px 0 3px;
  color: var(--color-text-primary);
  font-size: 20px;
  line-height: 1.15;
}

.window-header p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.window-controls {
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.control-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.control-field > span {
  color: var(--color-text-muted);
  font-size: 9px;
  font-weight: 800;
}

.control-field input,
.control-field select,
.now-button,
.refresh-button {
  height: 32px;
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-size: 11px;
  font-weight: 700;
  padding: 0 10px;
}

.dates-button.active {
  border-color: color-mix(in srgb, var(--color-brand-primary) 55%, var(--color-border-default));
  background: color-mix(in srgb, var(--color-brand-primary) 12%, var(--color-bg-elevated));
  color: var(--color-brand-primary);
}

.control-field select:disabled {
  opacity: 0.55;
}

.time-field input {
  font-family: "JetBrains Mono", monospace;
}

.now-button,
.refresh-button {
  cursor: pointer;
}

.refresh-button {
  border-color: color-mix(in srgb, var(--color-brand-primary) 45%, var(--color-border-default));
  color: var(--color-brand-primary);
}

.refresh-button:disabled {
  cursor: wait;
  opacity: 0.65;
}

.weekday-toggle {
  height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 700;
}

.weekday-toggle input {
  accent-color: var(--color-brand-primary);
}

.window-body {
  display: grid;
  grid-template-columns: minmax(0, 2.1fr) minmax(310px, 0.9fr);
  gap: 14px;
  min-height: 490px;
}

.chart-card,
.intelligence-card {
  position: relative;
  min-width: 0;
  border: 1px solid var(--color-border-soft);
  border-radius: 12px;
  background: color-mix(in srgb, var(--color-bg-elevated) 91%, transparent);
  overflow: hidden;
}

.chart-card {
  padding: 14px;
  display: flex;
  flex-direction: column;
}

.chart-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 34px;
}

.chart-heading > div:first-child {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chart-heading strong {
  color: var(--color-text-primary);
  font-size: 13px;
}

.chart-key {
  display: flex;
  align-items: center;
  gap: 13px;
  color: var(--color-text-muted);
  font-size: 10px;
  font-weight: 700;
}

.chart-key span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.chart-key i {
  width: 17px;
  height: 3px;
  display: inline-block;
}

.today-line {
  background: var(--stats-player, #4da3ff);
}

.history-line {
  background: #7796c8;
  opacity: 0.65;
}

.same-time-chart {
  flex: 1;
  min-height: 420px;
  width: 100%;
}

.chart-empty {
  position: absolute;
  inset: 70px 14px 14px;
  display: grid;
  place-items: center;
  color: var(--color-text-muted);
  font-size: 12px;
  pointer-events: none;
}

.intelligence-card {
  padding: 18px;
  display: flex;
  flex-direction: column;
}

.intelligence-card::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--color-border-highlight);
}

.intelligence-card.tone-positive::before {
  background: var(--stats-tps-good, #40b983);
}

.intelligence-card.tone-negative::before {
  background: var(--stats-tps-critical, #e56868);
}

.current-number {
  display: flex;
  align-items: baseline;
  gap: 7px;
  margin-top: 9px;
}

.current-number strong {
  color: var(--color-text-primary);
  font: 900 64px/0.95 "JetBrains Mono", monospace;
  letter-spacing: -0.06em;
}

.current-number span {
  color: var(--color-text-secondary);
  font-size: 15px;
  font-weight: 800;
}

.delta-badge {
  align-self: flex-start;
  margin-top: 9px;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
  font: 800 10px "JetBrains Mono", monospace;
}

.delta-badge.tone-positive {
  background: color-mix(in srgb, var(--stats-tps-good, #40b983) 14%, transparent);
  color: var(--stats-tps-good, #40b983);
}

.delta-badge.tone-negative {
  background: color-mix(in srgb, var(--stats-tps-critical, #e56868) 14%, transparent);
  color: var(--stats-tps-critical, #e56868);
}

.intelligence-card h3 {
  margin: 17px 0 7px;
  color: var(--color-text-primary);
  font-size: 15px;
  line-height: 1.35;
}

.intelligence-message {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 11px;
  line-height: 1.7;
}

.stat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  margin: 16px 0;
  background: var(--color-border-soft);
  border: 1px solid var(--color-border-soft);
  border-radius: 9px;
  overflow: hidden;
}

.stat-grid > div {
  min-height: 55px;
  padding: 9px 10px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  background: var(--color-bg-card);
}

.stat-grid span,
.breakdown-title,
.date-name span,
.row-time {
  color: var(--color-text-muted);
  font-size: 9px;
}

.stat-grid strong {
  color: var(--color-text-primary);
  font: 800 12px "JetBrains Mono", monospace;
}

.date-breakdown {
  min-height: 0;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.breakdown-title {
  display: flex;
  justify-content: space-between;
  margin-bottom: 7px;
  font-weight: 800;
}

.date-rows {
  min-height: 0;
  overflow-y: auto;
  padding-right: 3px;
}

.date-row {
  display: grid;
  grid-template-columns: 80px minmax(45px, 1fr) 48px 34px;
  align-items: center;
  gap: 8px;
  min-height: 33px;
  border-top: 1px solid var(--color-border-soft);
}

.date-row.today {
  color: var(--color-brand-primary);
}

.date-name {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.date-name strong {
  color: var(--color-text-secondary);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.date-row.today .date-name strong,
.date-row.today .row-value {
  color: var(--color-brand-primary);
}

.people-bar {
  height: 3px;
  border-radius: 3px;
  background: var(--color-border-soft);
  overflow: hidden;
}

.people-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #7796c8;
}

.date-row.today .people-bar i {
  background: var(--stats-player, #4da3ff);
}

.row-value {
  color: var(--color-text-primary);
  font: 800 10px "JetBrains Mono", monospace;
  text-align: right;
}

.row-time {
  font-family: "JetBrains Mono", monospace;
  text-align: right;
}

.inline-error {
  margin: 8px 0 0;
  color: var(--stats-tps-warning, #e7b84b);
  font-size: 10px;
}

@media (max-width: 1280px) {
  .window-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .window-controls {
    justify-content: flex-start;
  }

  .window-body {
    grid-template-columns: minmax(0, 1.55fr) minmax(300px, 0.85fr);
  }
}

@media (max-width: 940px) {
  .window-body {
    grid-template-columns: 1fr;
  }

  .intelligence-card {
    max-height: 520px;
  }
}

@media (max-width: 640px) {
  .same-time-window {
    padding: 12px;
  }

  .window-controls {
    display: grid;
    grid-template-columns: 1fr 1fr;
    width: 100%;
  }

  .control-field input,
  .control-field select,
  .now-button,
  .refresh-button {
    width: 100%;
  }

  .chart-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .chart-key {
    flex-wrap: wrap;
  }

  .same-time-chart {
    min-height: 340px;
  }
}
</style>
