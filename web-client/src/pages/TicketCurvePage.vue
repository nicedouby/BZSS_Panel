<template>
  <main class="ticket-curve-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">LIVE MATCH TELEMETRY</p>
        <h1>双方票数曲线</h1>
        <p class="subtitle">基于现有票数读取器，每 2 秒接收一个样本；新回合开始时自动清空。</p>
      </div>
      <div class="connection" :class="{ online: history?.source?.online }">
        <span class="connection-dot" />
        {{ history?.source?.online ? "票数源在线" : "票数源离线" }}
      </div>
    </header>

    <section class="summary-grid" aria-label="当前票数">
      <article class="summary-card team-one">
        <span class="summary-label">TEAM 1</span>
        <strong>{{ formatTicket(currentTickets.team1) }}</strong>
        <small>{{ teamOneDeltaText }}</small>
      </article>
      <article class="summary-card difference">
        <span class="summary-label">票差</span>
        <strong>{{ ticketDifferenceText }}</strong>
        <small>{{ sampleCount }} 个有效样本</small>
      </article>
      <article class="summary-card team-two">
        <span class="summary-label">TEAM 2</span>
        <strong>{{ formatTicket(currentTickets.team2) }}</strong>
        <small>{{ teamTwoDeltaText }}</small>
      </article>
    </section>

    <section class="chart-panel">
      <div class="chart-toolbar">
        <div>
          <h2>本局票数变化</h2>
          <p>{{ roundDescription }}</p>
        </div>
        <button type="button" :disabled="query.isFetching.value" @click="query.refetch()">
          {{ query.isFetching.value ? "刷新中…" : "立即刷新" }}
        </button>
      </div>

      <div v-if="errorMessage" class="state-message error">{{ errorMessage }}</div>
      <div v-else-if="!sampleCount" class="state-message">
        正在等待有效票数样本。票数读取器上线后，曲线会自动出现。
      </div>
      <div ref="chartRef" class="chart-surface" :class="{ hidden: !sampleCount || Boolean(errorMessage) }" />
    </section>

    <footer class="page-footer">
      <span>最后样本：{{ lastSampleText }}</span>
      <span>采样间隔：{{ formatInterval(history?.sampleIntervalMs) }}</span>
      <span>图表支持滚轮缩放和拖动查看</span>
    </footer>
  </main>
</template>

<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef, watch } from "vue";

import { apiGet } from "../app/apiClient";
import { useAuthStore } from "../stores/auth.store";
import { useUiStore } from "../stores/ui.store";
import { readChartThemeTokens } from "../theme/chartTheme";
import { echarts, type EChartsOption } from "../utils/echarts";

interface TicketHistoryPoint {
  timestamp: string;
  timestampMs: number;
  receivedAt: string;
  team1: number;
  team2: number;
  layer: string;
  map: string;
  matchState: string;
}

interface TicketHistoryResponse {
  ok: boolean;
  source: {
    sourceKey: string;
    online: boolean;
    lastMessageAt: string;
  } | null;
  generatedAt: string;
  revision: number;
  resetAt: string;
  resetReason: string;
  startedAt: string;
  sampleIntervalMs: number;
  maxPoints: number;
  currentTickets: { team1: number | null; team2: number | null };
  points: TicketHistoryPoint[];
}

const TEAM_ONE_COLOR = "#4da3ff";
const TEAM_TWO_COLOR = "#ff647c";

const auth = useAuthStore();
const ui = useUiStore();
const chartRef = ref<HTMLElement | null>(null);
const chartInstance = shallowRef<echarts.ECharts | null>(null);
const points = ref<TicketHistoryPoint[]>([]);
const history = ref<TicketHistoryResponse | null>(null);
const historyIdentity = ref("");
const active = ref(true);
const pageHidden = ref(typeof document !== "undefined" ? document.hidden : false);
let resizeObserver: ResizeObserver | null = null;

const query = useQuery({
  queryKey: ["remote-telemetry-ticket-history"],
  enabled: computed(() => active.value && !pageHidden.value && auth.authenticated),
  queryFn: async () => {
    const sinceMs = historyIdentity.value === buildHistoryIdentity(history.value)
      ? Number(points.value.at(-1)?.timestampMs ?? 0)
      : 0;
    const queryString = sinceMs > 0 ? "?since=" + encodeURIComponent(String(sinceMs)) : "";
    return apiGet<TicketHistoryResponse>("/api/remote-telemetry/ticket-history" + queryString);
  },
  refetchInterval: computed(() => active.value && !pageHidden.value ? 2_000 : false),
  refetchIntervalInBackground: false,
  retry: 1,
});

watch(() => query.data.value, (payload) => {
  if (!payload) return;
  const nextIdentity = buildHistoryIdentity(payload);
  const mustReplace = historyIdentity.value !== nextIdentity;
  historyIdentity.value = nextIdentity;
  history.value = payload;
  points.value = mustReplace
    ? payload.points.slice()
    : mergePoints(points.value, payload.points);
});

const sampleCount = computed(() => points.value.length);
const currentTickets = computed(() => {
  const latest = points.value.at(-1);
  return {
    team1: latest?.team1 ?? history.value?.currentTickets?.team1 ?? null,
    team2: latest?.team2 ?? history.value?.currentTickets?.team2 ?? null,
  };
});
const ticketDifferenceText = computed(() => {
  const team1 = currentTickets.value.team1;
  const team2 = currentTickets.value.team2;
  if (team1 === null || team2 === null) return "--";
  const difference = team1 - team2;
  if (difference === 0) return "持平";
  return (difference > 0 ? "T1 +" : "T2 +") + Math.abs(difference);
});
const teamOneDeltaText = computed(() => formatLoss("T1", "team1"));
const teamTwoDeltaText = computed(() => formatLoss("T2", "team2"));
const errorMessage = computed(() => query.error.value
  ? "票数曲线读取失败：" + String((query.error.value as Error)?.message || query.error.value)
  : "");
const roundDescription = computed(() => {
  const latest = points.value.at(-1);
  const identity = latest?.layer || latest?.map || "当前对局";
  return identity + " · " + (history.value?.startedAt ? "记录始于 " + formatTime(history.value.startedAt) : "等待首个样本");
});
const lastSampleText = computed(() => {
  const latest = points.value.at(-1);
  return latest ? formatTime(latest.receivedAt || latest.timestamp) : "--";
});

function mergePoints(current: TicketHistoryPoint[], incoming: TicketHistoryPoint[]) {
  if (!incoming.length) return current;
  const byTimestamp = new Map(current.map((point) => [point.timestampMs, point]));
  incoming.forEach((point) => byTimestamp.set(point.timestampMs, point));
  return [...byTimestamp.values()].sort((left, right) => left.timestampMs - right.timestampMs);
}

function buildHistoryIdentity(payload: TicketHistoryResponse | null) {
  return payload ? String(payload.revision) + ":" + String(payload.resetAt || "") : "";
}

function formatTicket(value: number | null) {
  return value !== null && Number.isFinite(value) ? String(value) : "--";
}

function formatLoss(label: string, key: "team1" | "team2") {
  if (points.value.length < 2) return label + " 本局变化 --";
  const first = points.value[0][key];
  const latest = points.value.at(-1)![key];
  const difference = latest - first;
  return label + " 本局变化 " + (difference > 0 ? "+" : "") + difference;
}

function formatTime(value: string) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return "--";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatInterval(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return "--";
  return Number(value) >= 1_000 ? (Number(value) / 1_000).toFixed(Number(value) % 1_000 ? 1 : 0) + " 秒" : value + " ms";
}

function ensureChart() {
  if (chartInstance.value || !chartRef.value) return;
  chartInstance.value = echarts.init(chartRef.value);
  chartInstance.value.setOption(buildOption());
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => chartInstance.value?.resize()));
    resizeObserver.observe(chartRef.value);
  }
}

function buildOption(): EChartsOption {
  const tokens = readChartThemeTokens();
  const teamOneData = points.value.map((point) => [point.timestampMs, point.team1]);
  const teamTwoData = points.value.map((point) => [point.timestampMs, point.team2]);
  return {
    backgroundColor: "transparent",
    animation: false,
    grid: { left: 18, right: 28, top: 42, bottom: 62, containLabel: true },
    legend: {
      top: 4,
      textStyle: { color: tokens.axis, fontSize: 12 },
      data: ["TEAM 1", "TEAM 2"],
    },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: tokens.tooltipBg,
      borderColor: "rgba(148, 163, 184, 0.28)",
      textStyle: { color: tokens.tooltipText },
      formatter: (items: any) => {
        if (!Array.isArray(items) || !items.length) return "";
        const time = new Date(items[0].value[0]).toLocaleTimeString([], {
          hour: "2-digit", minute: "2-digit", second: "2-digit",
        });
        const values = new Map(items.map((item: any) => [item.seriesName, Number(item.value[1])]));
        const team1 = values.get("TEAM 1");
        const team2 = values.get("TEAM 2");
        const difference = Number.isFinite(team1) && Number.isFinite(team2) ? Number(team1) - Number(team2) : null;
        return [
          "<strong>" + time + "</strong>",
          "<span style='color:" + TEAM_ONE_COLOR + "'>●</span> TEAM 1　<b>" + (team1 ?? "--") + "</b>",
          "<span style='color:" + TEAM_TWO_COLOR + "'>●</span> TEAM 2　<b>" + (team2 ?? "--") + "</b>",
          difference === null ? "" : "票差　<b>" + (difference > 0 ? "T1 +" : difference < 0 ? "T2 +" : "") + Math.abs(difference) + "</b>",
        ].filter(Boolean).join("<br>");
      },
    },
    xAxis: {
      type: "time",
      boundaryGap: false,
      axisLabel: { color: tokens.axis, hideOverlap: true },
      axisLine: { lineStyle: { color: "rgba(148, 163, 184, 0.25)" } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      min: 0,
      scale: true,
      axisLabel: { color: tokens.axis },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: "rgba(148, 163, 184, 0.12)" } },
    },
    dataZoom: [
      { type: "inside", filterMode: "none", throttle: 50 },
      { type: "slider", height: 20, bottom: 12, borderColor: "transparent", backgroundColor: "rgba(148, 163, 184, 0.08)", fillerColor: "rgba(77, 163, 255, 0.16)" },
    ],
    series: [
      {
        name: "TEAM 1", type: "line", step: "end", showSymbol: false, symbol: "none", data: teamOneData,
        lineStyle: { width: 2.5, color: TEAM_ONE_COLOR }, itemStyle: { color: TEAM_ONE_COLOR },
        areaStyle: { color: "rgba(77, 163, 255, 0.06)" },
      },
      {
        name: "TEAM 2", type: "line", step: "end", showSymbol: false, symbol: "none", data: teamTwoData,
        lineStyle: { width: 2.5, color: TEAM_TWO_COLOR }, itemStyle: { color: TEAM_TWO_COLOR },
        areaStyle: { color: "rgba(255, 100, 124, 0.05)" },
      },
    ],
  };
}

watch(points, () => chartInstance.value?.setOption(buildOption(), { replaceMerge: ["series"] }));
watch(() => ui.theme, () => chartInstance.value?.setOption(buildOption(), true));

function handleVisibilityChange() {
  pageHidden.value = document.hidden;
  if (!pageHidden.value) void query.refetch();
}

function activate() {
  active.value = true;
  ensureChart();
  void query.refetch();
}

function deactivate() {
  active.value = false;
  resizeObserver?.disconnect();
  resizeObserver = null;
  chartInstance.value?.dispose();
  chartInstance.value = null;
}

onMounted(() => {
  document.addEventListener("visibilitychange", handleVisibilityChange);
  activate();
});
onActivated(activate);
onDeactivated(deactivate);
onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  deactivate();
});
</script>

<style scoped>
.ticket-curve-page { min-height: 100%; padding: 24px; color: var(--color-text-primary); background: var(--color-bg-page); }
.page-header, .chart-toolbar, .page-footer { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.page-header { margin-bottom: 20px; }
.eyebrow { margin: 0 0 6px; color: var(--color-accent, #4da3ff); font: 700 11px/1.2 'JetBrains Mono', monospace; letter-spacing: .14em; }
h1 { margin: 0; font-size: clamp(24px, 3vw, 38px); letter-spacing: -.03em; }
.subtitle, .chart-toolbar p { margin: 7px 0 0; color: var(--color-text-muted); font-size: 13px; }
.connection { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; padding: 8px 12px; border: 1px solid var(--color-border-soft); border-radius: 999px; color: var(--color-text-muted); font-size: 12px; font-weight: 700; }
.connection-dot { width: 8px; height: 8px; border-radius: 50%; background: #94a3b8; box-shadow: 0 0 0 4px rgba(148,163,184,.12); }
.connection.online { color: #42c78a; }
.connection.online .connection-dot { background: #42c78a; box-shadow: 0 0 0 4px rgba(66,199,138,.12); }
.summary-grid { display: grid; grid-template-columns: 1fr minmax(180px,.72fr) 1fr; gap: 14px; margin-bottom: 14px; }
.summary-card, .chart-panel { border: 1px solid var(--color-border-soft); background: var(--color-bg-card); border-radius: 16px; }
.summary-card { position: relative; overflow: hidden; padding: 18px 20px; display: grid; gap: 5px; }
.summary-card::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 3px; background: #94a3b8; }
.summary-card.team-one::before { background: #4da3ff; }
.summary-card.team-two::before { background: #ff647c; }
.summary-label { color: var(--color-text-muted); font: 700 11px/1.2 'JetBrains Mono', monospace; letter-spacing: .08em; }
.summary-card strong { font: 800 30px/1.1 'JetBrains Mono', monospace; }
.team-one strong { color: #4da3ff; }
.team-two strong { color: #ff647c; }
.summary-card small { color: var(--color-text-muted); font-size: 11px; }
.chart-panel { min-height: 520px; padding: 18px; display: flex; flex-direction: column; }
.chart-toolbar { padding: 2px 4px 12px; }
.chart-toolbar h2 { margin: 0; font-size: 15px; }
.chart-toolbar button { border: 1px solid var(--color-border-soft); border-radius: 9px; padding: 7px 12px; color: var(--color-text-primary); background: var(--color-bg-elevated); cursor: pointer; }
.chart-toolbar button:disabled { opacity: .55; cursor: wait; }
.chart-surface { flex: 1; width: 100%; min-height: 430px; }
.chart-surface.hidden { visibility: hidden; height: 0; min-height: 0; }
.state-message { flex: 1; display: grid; place-items: center; min-height: 360px; color: var(--color-text-muted); text-align: center; }
.state-message.error { color: #ff647c; }
.page-footer { padding: 12px 5px 0; justify-content: flex-start; flex-wrap: wrap; color: var(--color-text-muted); font-size: 11px; }
.page-footer span + span::before { content: '•'; margin-right: 20px; }
@media (max-width: 760px) {
  .ticket-curve-page { padding: 14px; }
  .page-header { align-items: flex-start; flex-direction: column; }
  .summary-grid { grid-template-columns: 1fr 1fr; }
  .summary-card.difference { grid-column: 1 / -1; grid-row: 2; }
  .chart-panel { min-height: 460px; padding: 12px; }
  .chart-surface { min-height: 370px; }
}
</style>
