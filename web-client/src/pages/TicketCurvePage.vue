<template>
  <main class="ticket-curve-page">
    <!-- Header -->
    <header class="page-header">
      <div class="header-main">
        <div class="header-badge-row">
          <span class="eyebrow">LIVE TELEMETRY STREAM</span>
          <span class="auto-refresh-tag">⚡ 2s 自动采样</span>
        </div>
        <h1>双方票数曲线</h1>
        <p class="subtitle">实时监测阵营票数消耗走势 · 采集样本并精准推算阵营天平变化</p>
      </div>

      <div class="header-actions">
        <div class="connection" :class="{ online: history?.source?.online }">
          <span class="connection-dot" />
          <span class="connection-text">{{ history?.source?.online ? "票数源在线" : "票数源离线" }}</span>
        </div>
        <button
          type="button"
          class="refresh-btn"
          :class="{ spinning: query.isFetching.value }"
          :disabled="query.isFetching.value"
          @click="query.refetch()"
        >
          <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
          </svg>
          <span>{{ query.isFetching.value ? "刷新中…" : "立即刷新" }}</span>
        </button>
      </div>
    </header>

    <!-- KPI Telemetry Dashboard Cards -->
    <section class="summary-grid" aria-label="当前票数看板">
      <!-- Team 1 Card -->
      <article class="summary-card team-one">
        <div class="card-top">
          <span class="team-tag t1">
            <svg class="tag-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            TEAM 1 / 蓝方
          </span>
          <span class="share-percent">{{ team1RatioPercent }}% 占比</span>
        </div>
        <div class="ticket-value t1">
          <strong>{{ formatTicket(currentTickets.team1) }}</strong>
          <span class="unit">TICKETS</span>
        </div>
        <div class="card-footer-meta">
          <span class="delta-text">{{ teamOneDeltaText }}</span>
        </div>
      </article>

      <!-- Center Balance & Gap Card -->
      <article class="summary-card balance-card">
        <div class="card-top center">
          <span class="balance-status-tag" :class="gapStatusClass">
            {{ gapStatusLabel }}
          </span>
        </div>

        <div class="gap-display">
          <span class="gap-label">双方票差</span>
          <strong class="gap-value" :class="gapStatusClass">{{ ticketDifferenceText }}</strong>
        </div>

        <!-- Tug of War Progress Bar -->
        <div class="tug-bar-wrapper" title="阵营剩余票数比例">
          <div class="tug-bar-track">
            <div class="tug-bar-fill t1" :style="{ width: `${team1RatioPercent}%` }" />
            <div class="tug-bar-fill t2" :style="{ width: `${team2RatioPercent}%` }" />
          </div>
          <div class="tug-bar-labels">
            <span>T1 {{ team1RatioPercent }}%</span>
            <span>T2 {{ team2RatioPercent }}%</span>
          </div>
        </div>

        <div class="balance-meta">
          <span>有效样本: <strong>{{ sampleCount }}</strong></span>
          <span class="meta-dot">•</span>
          <span>间隔: <strong>{{ formatInterval(history?.sampleIntervalMs) }}</strong></span>
        </div>
      </article>

      <!-- Team 2 Card -->
      <article class="summary-card team-two">
        <div class="card-top">
          <span class="team-tag t2">
            <svg class="tag-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3v3m0 12v3M3 12h3m12 0h3" />
            </svg>
            TEAM 2 / 红方
          </span>
          <span class="share-percent">{{ team2RatioPercent }}% 占比</span>
        </div>
        <div class="ticket-value t2">
          <strong>{{ formatTicket(currentTickets.team2) }}</strong>
          <span class="unit">TICKETS</span>
        </div>
        <div class="card-footer-meta">
          <span class="delta-text">{{ teamTwoDeltaText }}</span>
        </div>
      </article>
    </section>

    <!-- Chart Panel -->
    <section class="chart-panel">
      <div class="chart-toolbar">
        <div class="chart-title-group">
          <h2>本局票数变化曲线</h2>
          <p class="round-meta">{{ roundDescription }}</p>
        </div>

        <!-- Time Range Zoom Toggles -->
        <div class="zoom-presets">
          <span class="zoom-label">时间范围:</span>
          <button type="button" class="zoom-chip" :class="{ active: activeZoom === 'full' }" @click="setTimeRangeZoom(null, 'full')">
            全局
          </button>
          <button type="button" class="zoom-chip" :class="{ active: activeZoom === '15m' }" @click="setTimeRangeZoom(15, '15m')">
            近15分钟
          </button>
          <button type="button" class="zoom-chip" :class="{ active: activeZoom === '5m' }" @click="setTimeRangeZoom(5, '5m')">
            近5分钟
          </button>
        </div>
      </div>

      <div v-if="errorMessage" class="state-message error">{{ errorMessage }}</div>
      <div v-else-if="!sampleCount" class="state-message">
        <div class="waiting-box">
          <span class="spinner-icon">⌛</span>
          <p>正在等待有效票数样本...</p>
          <small>票数读取器上线后，曲线将实时同步展现</small>
        </div>
      </div>
      <div ref="chartRef" class="chart-surface" :class="{ hidden: !sampleCount || Boolean(errorMessage) }" />
    </section>

    <!-- Footer -->
    <footer class="page-footer">
      <div class="footer-item">
        <span class="item-label">最新样本时间:</span>
        <strong class="item-value">{{ lastSampleText }}</strong>
      </div>
      <div class="footer-item">
        <span class="item-label">采样间隔:</span>
        <strong class="item-value">{{ formatInterval(history?.sampleIntervalMs) }}</strong>
      </div>
      <div class="footer-item">
        <span class="item-label">已接收点位:</span>
        <strong class="item-value">{{ sampleCount }} pts</strong>
      </div>
      <div class="footer-tip">
        <span>💡 快捷提示：支持使用鼠标滚轮放大/缩小曲线，或拖拽底部滑动条缩放图表</span>
      </div>
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

const TEAM_ONE_COLOR = "#38bdf8";
const TEAM_TWO_COLOR = "#f97316";

const auth = useAuthStore();
const ui = useUiStore();
const chartRef = ref<HTMLElement | null>(null);
const chartInstance = shallowRef<echarts.ECharts | null>(null);
const points = ref<TicketHistoryPoint[]>([]);
const history = ref<TicketHistoryResponse | null>(null);
const historyIdentity = ref("");
const active = ref(true);
const pageHidden = ref(typeof document !== "undefined" ? document.hidden : false);
const activeZoom = ref<"full" | "15m" | "5m">("full");
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

const totalTickets = computed(() => {
  const t1 = currentTickets.value.team1 ?? 0;
  const t2 = currentTickets.value.team2 ?? 0;
  return t1 + t2;
});

const team1RatioPercent = computed(() => {
  if (!totalTickets.value) return 50;
  const t1 = currentTickets.value.team1 ?? 0;
  return Math.min(100, Math.max(0, Math.round((t1 / totalTickets.value) * 100)));
});

const team2RatioPercent = computed(() => {
  if (!totalTickets.value) return 50;
  return 100 - team1RatioPercent.value;
});

const gapStatusClass = computed(() => {
  const t1 = currentTickets.value.team1;
  const t2 = currentTickets.value.team2;
  if (t1 === null || t2 === null || t1 === t2) return "neutral";
  return t1 > t2 ? "t1-lead" : "t2-lead";
});

const gapStatusLabel = computed(() => {
  const t1 = currentTickets.value.team1;
  const t2 = currentTickets.value.team2;
  if (t1 === null || t2 === null) return "等待数据";
  if (t1 === t2) return "双方战平";
  return t1 > t2 ? "TEAM 1 优势" : "TEAM 2 优势";
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

function setTimeRangeZoom(minutes: number | null, mode: "full" | "15m" | "5m") {
  activeZoom.value = mode;
  if (!chartInstance.value || !points.value.length) return;
  if (minutes === null) {
    chartInstance.value.dispatchAction({
      type: "dataZoom",
      start: 0,
      end: 100,
    });
    return;
  }

  const latestMs = points.value.at(-1)?.timestampMs || Date.now();
  const startMs = latestMs - minutes * 60 * 1000;
  const firstMs = points.value[0]?.timestampMs || latestMs;

  let startPercent = 0;
  if (latestMs > firstMs) {
    startPercent = Math.max(0, Math.round(((startMs - firstMs) / (latestMs - firstMs)) * 100));
  }

  chartInstance.value.dispatchAction({
    type: "dataZoom",
    start: startPercent,
    end: 100,
  });
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
    grid: { left: 16, right: 36, top: 40, bottom: 60, containLabel: true },
    legend: {
      top: 4,
      right: 16,
      textStyle: { color: tokens.axis, fontSize: 12, fontFamily: "'JetBrains Mono', monospace" },
      data: ["TEAM 1", "TEAM 2"],
    },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: "rgba(10, 15, 26, 0.95)",
      borderColor: "rgba(56, 189, 248, 0.3)",
      borderWidth: 1,
      padding: [10, 14],
      textStyle: { color: "#f8fafc", fontSize: 12, fontFamily: "'JetBrains Mono', monospace" },
      extraCssText: "box-shadow: 0 16px 40px rgba(0,0,0,0.6); backdrop-filter: blur(12px); border-radius: 10px;",
      formatter: (items: any) => {
        if (!Array.isArray(items) || !items.length) return "";
        const timestampMs = items[0].value[0];
        const time = new Date(timestampMs).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        const values = new Map(items.map((item: any) => [item.seriesName, Number(item.value[1])]));
        const team1 = values.get("TEAM 1");
        const team2 = values.get("TEAM 2");
        const difference = Number.isFinite(team1) && Number.isFinite(team2) ? Number(team1) - Number(team2) : null;
        
        let diffLabel = "双方持平";
        let diffColor = "#94a3b8";
        if (difference !== null && difference !== 0) {
          diffLabel = difference > 0 ? `T1 领先 +${difference}` : `T2 领先 +${Math.abs(difference)}`;
          diffColor = difference > 0 ? TEAM_ONE_COLOR : TEAM_TWO_COLOR;
        }

        return `
          <div style="font-family:'JetBrains Mono', monospace; font-size:12px; font-weight:700; color:#94a3b8; margin-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:4px;">
            ⏱️ ${time}
          </div>
          <div style="display:flex; justify-content:space-between; gap:16px; margin-bottom:4px;">
            <span style="color:${TEAM_ONE_COLOR}; font-weight:700;">● TEAM 1</span>
            <strong style="color:#f8fafc;">${team1 ?? "--"} 票</strong>
          </div>
          <div style="display:flex; justify-content:space-between; gap:16px; margin-bottom:6px;">
            <span style="color:${TEAM_TWO_COLOR}; font-weight:700;">● TEAM 2</span>
            <strong style="color:#f8fafc;">${team2 ?? "--"} 票</strong>
          </div>
          ${difference !== null ? `
          <div style="margin-top:4px; padding-top:4px; border-top:1px dashed rgba(255,255,255,0.1); display:flex; justify-content:space-between; gap:16px;">
            <span style="color:#94a3b8;">票差天平</span>
            <strong style="color:${diffColor};">${diffLabel}</strong>
          </div>
          ` : ''}
        `;
      },
    },
    xAxis: {
      type: "time",
      boundaryGap: false as boolean,
      axisLabel: { color: tokens.axis, hideOverlap: true, fontFamily: "'JetBrains Mono', monospace", fontSize: 11 },
      axisLine: { lineStyle: { color: "rgba(148, 163, 184, 0.25)" } },
      splitLine: { show: true, lineStyle: { color: "rgba(148, 163, 184, 0.06)", type: "dashed" } },
    },
    yAxis: {
      type: "value",
      min: 0,
      scale: true,
      axisLabel: { color: tokens.axis, fontFamily: "'JetBrains Mono', monospace", fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: "rgba(148, 163, 184, 0.08)" } },
    },
    dataZoom: [
      { type: "inside", filterMode: "none", throttle: 50 },
      {
        type: "slider",
        height: 22,
        bottom: 10,
        borderColor: "rgba(56, 189, 248, 0.2)",
        backgroundColor: "rgba(15, 23, 42, 0.6)",
        fillerColor: "rgba(56, 189, 248, 0.15)",
        handleStyle: { color: "#38bdf8", borderColor: "#0284c7" },
        textStyle: { color: "#94a3b8", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 },
      },
    ],
    series: [
      {
        name: "TEAM 1",
        type: "line",
        step: "end",
        showSymbol: false,
        symbol: "circle",
        symbolSize: 6,
        data: teamOneData,
        lineStyle: { width: 2.8, color: TEAM_ONE_COLOR },
        itemStyle: { color: TEAM_ONE_COLOR },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(56, 189, 248, 0.22)" },
            { offset: 1, color: "rgba(56, 189, 248, 0.0)" },
          ]),
        },
      },
      {
        name: "TEAM 2",
        type: "line",
        step: "end",
        showSymbol: false,
        symbol: "circle",
        symbolSize: 6,
        data: teamTwoData,
        lineStyle: { width: 2.8, color: TEAM_TWO_COLOR },
        itemStyle: { color: TEAM_TWO_COLOR },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(249, 115, 22, 0.22)" },
            { offset: 1, color: "rgba(249, 115, 22, 0.0)" },
          ]),
        },
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
.ticket-curve-page {
  min-height: 100%;
  padding: 20px 24px 24px;
  color: var(--color-text-primary);
  background: var(--color-bg-page);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}

.header-badge-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.eyebrow {
  color: var(--color-accent, #38bdf8);
  font: 800 11px/1 'JetBrains Mono', monospace;
  letter-spacing: 0.14em;
}

.auto-refresh-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(56, 189, 248, 0.12);
  color: #7dd3fc;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 700;
}

h1 {
  margin: 0;
  font-size: clamp(22px, 2.5vw, 32px);
  font-weight: 800;
  letter-spacing: -0.02em;
}

.subtitle {
  margin: 6px 0 0;
  color: var(--color-text-muted);
  font-size: 13px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.connection {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  padding: 6px 12px;
  border: 1px solid var(--color-border-soft);
  border-radius: 999px;
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 700;
  background: rgba(15, 23, 42, 0.4);
}

.connection-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #94a3b8;
  box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.15);
}

.connection.online {
  color: #34d399;
  border-color: rgba(52, 211, 153, 0.3);
}

.connection.online .connection-dot {
  background: #34d399;
  box-shadow: 0 0 0 4px rgba(52, 211, 153, 0.2);
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}

.refresh-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(56, 189, 248, 0.4);
}

.refresh-btn.spinning .icon-svg {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.icon-svg {
  width: 14px;
  height: 14px;
}

/* Summary Grid */
.summary-grid {
  display: grid;
  grid-template-columns: 1fr 1.2fr 1fr;
  gap: 14px;
}

.summary-card {
  position: relative;
  overflow: hidden;
  padding: 16px 20px;
  border: 1px solid var(--color-border-soft);
  background: var(--color-bg-card);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(10px);
}

.summary-card::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: #94a3b8;
}

.summary-card.team-one::before { background: #38bdf8; }
.summary-card.team-two::before { background: #f97316; }
.summary-card.balance-card::before { background: #a855f7; }

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-top.center {
  justify-content: center;
}

.team-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  font-weight: 800;
  padding: 2px 8px;
  border-radius: 4px;
  letter-spacing: 0.5px;
}

.team-tag.t1 {
  background: rgba(56, 189, 248, 0.15);
  color: #7dd3fc;
  border: 1px solid rgba(56, 189, 248, 0.3);
}

.team-tag.t2 {
  background: rgba(249, 115, 22, 0.15);
  color: #fdba74;
  border: 1px solid rgba(249, 115, 22, 0.3);
}

.tag-svg {
  width: 13px;
  height: 13px;
}

.share-percent {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--color-text-muted);
  font-weight: 700;
}

.ticket-value {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.ticket-value strong {
  font-family: 'JetBrains Mono', monospace;
  font-size: 34px;
  font-weight: 800;
  line-height: 1;
}

.ticket-value.t1 strong { color: #38bdf8; text-shadow: 0 0 16px rgba(56, 189, 248, 0.3); }
.ticket-value.t2 strong { color: #f97316; text-shadow: 0 0 16px rgba(249, 115, 22, 0.3); }

.unit {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 700;
  color: var(--color-text-muted);
}

.card-footer-meta {
  font-size: 12px;
  color: var(--color-text-muted);
}

.delta-text {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  font-weight: 700;
}

/* Balance Card */
.balance-card {
  align-items: center;
  text-align: center;
}

.balance-status-tag {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  font-weight: 800;
  padding: 3px 10px;
  border-radius: 999px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.balance-status-tag.neutral {
  background: rgba(148, 163, 184, 0.15);
  color: #cbd5e1;
  border: 1px solid rgba(148, 163, 184, 0.3);
}

.balance-status-tag.t1-lead {
  background: rgba(56, 189, 248, 0.15);
  color: #7dd3fc;
  border: 1px solid rgba(56, 189, 248, 0.3);
}

.balance-status-tag.t2-lead {
  background: rgba(249, 115, 22, 0.15);
  color: #fdba74;
  border: 1px solid rgba(249, 115, 22, 0.3);
}

.gap-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.gap-label {
  font-size: 11px;
  color: var(--color-text-muted);
  font-weight: 700;
}

.gap-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 26px;
  font-weight: 800;
  line-height: 1.1;
}

.gap-value.t1-lead { color: #38bdf8; }
.gap-value.t2-lead { color: #f97316; }
.gap-value.neutral { color: #cbd5e1; }

/* Tug Bar */
.tug-bar-wrapper {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tug-bar-track {
  height: 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  display: flex;
  overflow: hidden;
}

.tug-bar-fill {
  height: 100%;
  transition: width 0.3s ease;
}

.tug-bar-fill.t1 { background: linear-gradient(90deg, #0284c7, #38bdf8); }
.tug-bar-fill.t2 { background: linear-gradient(90deg, #f97316, #ea580c); }

.tug-bar-labels {
  display: flex;
  justify-content: space-between;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: var(--color-text-muted);
  font-weight: 700;
}

.balance-meta {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: 8px;
}

.balance-meta strong {
  color: var(--color-text-primary);
}

.meta-dot {
  opacity: 0.4;
}

/* Chart Panel */
.chart-panel {
  min-height: 540px;
  padding: 16px 20px;
  border: 1px solid var(--color-border-soft);
  background: var(--color-bg-card);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
}

.chart-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.chart-title-group h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}

.round-meta {
  margin: 4px 0 0;
  color: var(--color-text-muted);
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
}

.zoom-presets {
  display: flex;
  align-items: center;
  gap: 6px;
}

.zoom-label {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-right: 4px;
}

.zoom-chip {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-secondary);
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}

.zoom-chip:hover,
.zoom-chip.active {
  background: rgba(56, 189, 248, 0.15);
  color: #7dd3fc;
  border-color: rgba(56, 189, 248, 0.4);
}

.chart-surface {
  flex: 1;
  width: 100%;
  min-height: 440px;
}

.chart-surface.hidden {
  visibility: hidden;
  height: 0;
  min-height: 0;
}

.state-message {
  flex: 1;
  display: grid;
  place-items: center;
  min-height: 380px;
  color: var(--color-text-muted);
}

.waiting-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.spinner-icon {
  font-size: 24px;
}

.state-message.error {
  color: #f87171;
}

/* Page Footer */
.page-footer {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 4px 6px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.footer-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'JetBrains Mono', monospace;
}

.item-label {
  opacity: 0.7;
}

.item-value {
  color: var(--color-text-primary);
}

.footer-tip {
  margin-left: auto;
  font-size: 11px;
  opacity: 0.7;
}

@media (max-width: 900px) {
  .summary-grid {
    grid-template-columns: 1fr 1fr;
  }
  .summary-card.balance-card {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}

@media (max-width: 600px) {
  .ticket-curve-page {
    padding: 14px;
  }
  .summary-grid {
    grid-template-columns: 1fr;
  }
  .summary-card.balance-card {
    grid-column: 1;
  }
  .chart-toolbar {
    flex-direction: column;
    align-items: flex-start;
  }
  .footer-tip {
    margin-left: 0;
  }
}
</style>
