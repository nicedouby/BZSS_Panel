<template>
  <main class="packet-loss-page">
    <header class="page-header panel">
      <div>
        <p class="eyebrow">LOGPOST UDP DELIVERY</p>
        <h1>LogPost 数据包丢包监控</h1>
        <p class="subtitle">按 PacketSessionId + PacketSeq 对比发送窗口与接收窗口，统计本机 UDP 实际丢包。</p>
      </div>
      <div class="header-side">
        <span class="status-pill" :class="`status-${monitor?.status ?? 'waiting'}`">{{ statusLabel }}</span>
        <button type="button" class="refresh-button" :disabled="loading" @click="refresh">
          {{ loading ? "刷新中" : "立即刷新" }}
        </button>
      </div>
    </header>

    <section v-if="error" class="panel error-box">
      <strong>无法读取 UDP 统计</strong>
      <span>{{ error }}</span>
    </section>

    <section class="metric-grid">
      <article class="panel metric-card">
        <span>当前窗口发送</span>
        <strong>{{ formatInteger(current?.sentPackets) }}</strong>
        <small>业务 EVENT 包</small>
      </article>
      <article class="panel metric-card">
        <span>当前窗口接收</span>
        <strong>{{ formatInteger(current?.receivedPackets) }}</strong>
        <small>按 PacketSeq 去重</small>
      </article>
      <article class="panel metric-card" :class="{ danger: numberValue(current?.lostPackets) > 0 }">
        <span>当前窗口丢失</span>
        <strong>{{ formatInteger(current?.lostPackets) }}</strong>
        <small>发送 - 接收</small>
      </article>
      <article class="panel metric-card" :class="lossTone(current?.lossRate)">
        <span>当前丢包率</span>
        <strong>{{ formatLoss(current?.lossRate) }}</strong>
        <small>&lt;1% 正常 · 1–5% 警告 · ≥5% 严重</small>
      </article>
      <article class="panel metric-card">
        <span>最大连续丢包</span>
        <strong>{{ formatInteger(current?.maxConsecutiveLost) }}</strong>
        <small>当前统计窗口</small>
      </article>
      <article class="panel metric-card">
        <span>最后统计</span>
        <strong class="time-value">{{ formatTime(monitor?.lastUpdatedAt) }}</strong>
        <small>{{ current ? `Seq ${current.firstSeq || 0}–${current.lastSeq || 0}` : "等待首个 10 秒统计窗口" }}</small>
      </article>
    </section>

    <section class="aggregate-grid">
      <article class="panel aggregate-card">
        <div class="section-title">
          <div>
            <p class="eyebrow">1 MINUTE</p>
            <h2>最近 1 分钟</h2>
          </div>
          <strong :class="lossTone(monitor?.oneMinute?.lossRate)">{{ formatLoss(monitor?.oneMinute?.lossRate) }}</strong>
        </div>
        <div class="aggregate-values">
          <span>发送 <b>{{ formatInteger(monitor?.oneMinute?.sentPackets) }}</b></span>
          <span>接收 <b>{{ formatInteger(monitor?.oneMinute?.receivedPackets) }}</b></span>
          <span>丢失 <b>{{ formatInteger(monitor?.oneMinute?.lostPackets) }}</b></span>
          <span>连续峰值 <b>{{ formatInteger(monitor?.oneMinute?.maxConsecutiveLost) }}</b></span>
        </div>
      </article>

      <article class="panel aggregate-card">
        <div class="section-title">
          <div>
            <p class="eyebrow">5 MINUTES</p>
            <h2>最近 5 分钟</h2>
          </div>
          <strong :class="lossTone(monitor?.fiveMinutes?.lossRate)">{{ formatLoss(monitor?.fiveMinutes?.lossRate) }}</strong>
        </div>
        <div class="aggregate-values">
          <span>发送 <b>{{ formatInteger(monitor?.fiveMinutes?.sentPackets) }}</b></span>
          <span>接收 <b>{{ formatInteger(monitor?.fiveMinutes?.receivedPackets) }}</b></span>
          <span>丢失 <b>{{ formatInteger(monitor?.fiveMinutes?.lostPackets) }}</b></span>
          <span>连续峰值 <b>{{ formatInteger(monitor?.fiveMinutes?.maxConsecutiveLost) }}</b></span>
        </div>
      </article>
    </section>

    <section class="panel trend-panel">
      <div class="section-title">
        <div>
          <p class="eyebrow">RECENT WINDOWS</p>
          <h2>近期丢包趋势</h2>
        </div>
        <span>每个统计窗口约 10 秒</span>
      </div>

      <div v-if="historyRows.length" class="trend-bars" aria-label="近期丢包率柱状图">
        <div v-for="row in chartRows" :key="`${row.sessionId}-${row.statSeq}-${row.windowEndMs}`" class="trend-item" :title="`${formatTimeMs(row.windowEndMs)} · ${formatLoss(row.lossRate)}`">
          <div class="trend-track">
            <span :class="lossTone(row.lossRate)" :style="{ height: `${barHeight(row.lossRate)}%` }" />
          </div>
          <small>{{ shortTime(row.windowEndMs) }}</small>
        </div>
      </div>
      <div v-else class="empty-state">等待 LogPost 发出首个统计窗口。</div>

      <div v-if="historyRows.length" class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>Seq 范围</th>
              <th>发送</th>
              <th>接收</th>
              <th>丢失</th>
              <th>最大连续</th>
              <th>丢包率</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in historyRows" :key="`${row.sessionId}-${row.statSeq}-${row.windowEndMs}`">
              <td>{{ formatTimeMs(row.windowEndMs) }}</td>
              <td><code>{{ row.firstSeq || 0 }}–{{ row.lastSeq || 0 }}</code></td>
              <td>{{ formatInteger(row.sentPackets) }}</td>
              <td>{{ formatInteger(row.receivedPackets) }}</td>
              <td>{{ formatInteger(row.lostPackets) }}</td>
              <td>{{ formatInteger(row.maxConsecutiveLost) }}</td>
              <td><strong :class="lossTone(row.lossRate)">{{ formatLoss(row.lossRate) }}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel detail-panel">
      <div class="section-title">
        <div>
          <p class="eyebrow">TRANSPORT DETAILS</p>
          <h2>接收端状态</h2>
        </div>
        <span>{{ udp?.status ?? "unknown" }}</span>
      </div>
      <dl>
        <div><dt>UDP 监听</dt><dd>{{ udp?.host ?? "--" }}:{{ udp?.port ?? "--" }}</dd></div>
        <div><dt>UDP 总收包</dt><dd>{{ formatInteger(udp?.packetsReceived) }}</dd></div>
        <div><dt>业务包观测</dt><dd>{{ formatInteger(monitor?.metrics?.businessPacketsObserved) }}</dd></div>
        <div><dt>统计包观测</dt><dd>{{ formatInteger(monitor?.metrics?.statPacketsObserved) }}</dd></div>
        <div><dt>重复业务包</dt><dd>{{ formatInteger(monitor?.metrics?.duplicateBusinessPackets) }}</dd></div>
        <div><dt>750ms 后到达</dt><dd>{{ formatInteger(monitor?.metrics?.latePacketsAfterFinalize) }}</dd></div>
        <div><dt>统计窗口</dt><dd>{{ formatInteger(monitor?.metrics?.finalizedWindows) }}</dd></div>
        <div><dt>活动发送会话</dt><dd>{{ formatInteger(monitor?.sessions?.length) }}</dd></div>
      </dl>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

type AnyRecord = Record<string, any>;

const snapshot = ref<AnyRecord | null>(null);
const loading = ref(false);
const error = ref("");
let timer: number | null = null;
let controller: AbortController | null = null;

const udp = computed(() => snapshot.value?.logPostUdpTransport ?? null);
const monitor = computed(() => udp.value?.packetLoss ?? null);
const current = computed(() => monitor.value?.current ?? null);
const historyRows = computed<any[]>(() => {
  const rows = Array.isArray(monitor.value?.history) ? monitor.value.history : [];
  return rows.slice(-30).reverse();
});
const chartRows = computed<any[]>(() => [...historyRows.value].reverse().slice(-24));
const statusLabel = computed(() => {
  const status = String(monitor.value?.status ?? "waiting");
  if (status === "healthy") return "正常";
  if (status === "warning") return "警告";
  if (status === "critical") return "严重丢包";
  return "等待统计";
});

async function refresh() {
  loading.value = true;
  controller?.abort();
  controller = new AbortController();
  const timeout = window.setTimeout(() => controller?.abort("timeout"), 4000);
  try {
    const response = await fetch("/api/web/status", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    snapshot.value = await response.json();
    error.value = "";
  } catch (cause: any) {
    if (cause?.name !== "AbortError") error.value = cause?.message ?? String(cause);
  } finally {
    window.clearTimeout(timeout);
    loading.value = false;
  }
}

onMounted(() => {
  void refresh();
  timer = window.setInterval(() => void refresh(), 2000);
});

onBeforeUnmount(() => {
  if (timer != null) window.clearInterval(timer);
  controller?.abort();
});

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatInteger(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number).toLocaleString() : "--";
}

function formatLoss(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(number >= 0.01 ? 2 : 3)}%` : "--";
}

function lossTone(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "tone-waiting";
  if (number >= 0.05) return "tone-critical";
  if (number >= 0.01) return "tone-warning";
  return "tone-healthy";
}

function barHeight(value: unknown) {
  const number = Math.max(0, Number(value) || 0);
  if (number <= 0) return 3;
  return Math.min(100, Math.max(8, number * 1000));
}

function formatTime(value: unknown) {
  const ms = Date.parse(String(value ?? ""));
  return Number.isFinite(ms) ? new Date(ms).toLocaleTimeString() : "--";
}

function formatTimeMs(value: unknown) {
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toLocaleTimeString() : "--";
}

function shortTime(value: unknown) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return "--";
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}
</script>

<style scoped>
.packet-loss-page { min-height: 100%; padding: 18px; display: grid; gap: 14px; background: var(--app-bg, #0b0f14); color: var(--text-primary, #eef3f8); }
.panel { background: var(--panel-bg, rgba(20, 27, 36, .94)); border: 1px solid rgba(148, 163, 184, .16); border-radius: 12px; box-shadow: 0 10px 30px rgba(0, 0, 0, .16); }
.page-header { padding: 18px 20px; display: flex; justify-content: space-between; gap: 20px; align-items: center; }
.eyebrow { margin: 0 0 5px; color: #7f93a8; font-size: 11px; font-weight: 800; letter-spacing: .14em; }
h1, h2 { margin: 0; }
h1 { font-size: 24px; }
h2 { font-size: 16px; }
.subtitle { margin: 7px 0 0; color: #91a0af; font-size: 13px; }
.header-side { display: flex; gap: 10px; align-items: center; }
.status-pill, .refresh-button { border-radius: 8px; padding: 8px 12px; font-size: 12px; font-weight: 800; }
.status-pill { border: 1px solid rgba(148, 163, 184, .18); }
.status-healthy { color: #75d99b; background: rgba(34, 197, 94, .1); }
.status-warning { color: #f2c66d; background: rgba(245, 158, 11, .1); }
.status-critical { color: #ff8080; background: rgba(239, 68, 68, .12); }
.status-waiting { color: #9aa9b8; background: rgba(148, 163, 184, .08); }
.refresh-button { color: inherit; background: rgba(148, 163, 184, .08); border: 1px solid rgba(148, 163, 184, .18); cursor: pointer; }
.metric-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
.metric-card { min-height: 108px; padding: 14px; display: flex; flex-direction: column; justify-content: center; gap: 5px; }
.metric-card > span, .metric-card small { color: #8393a3; font-size: 12px; }
.metric-card > strong { font-size: 27px; font-variant-numeric: tabular-nums; }
.metric-card .time-value { font-size: 16px; }
.aggregate-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.aggregate-card, .trend-panel, .detail-panel { padding: 16px; }
.section-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
.section-title > strong { font-size: 22px; }
.section-title > span { color: #8191a1; font-size: 12px; }
.aggregate-values { margin-top: 14px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.aggregate-values span { padding: 10px; background: rgba(148, 163, 184, .05); border-radius: 8px; color: #8d9baa; font-size: 12px; }
.aggregate-values b { display: block; margin-top: 4px; color: #e9f0f6; font-size: 18px; }
.trend-bars { height: 132px; margin: 18px 0; display: flex; gap: 5px; align-items: stretch; }
.trend-item { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 5px; align-items: center; }
.trend-track { width: 100%; flex: 1; display: flex; align-items: flex-end; border-radius: 5px; overflow: hidden; background: rgba(148, 163, 184, .05); }
.trend-track span { width: 100%; min-height: 3px; opacity: .85; }
.trend-item small { color: #647587; font-size: 9px; writing-mode: vertical-rl; max-height: 40px; overflow: hidden; }
.tone-healthy { color: #75d99b !important; }
.tone-warning { color: #f2c66d !important; }
.tone-critical, .danger { color: #ff8080 !important; }
.trend-track .tone-healthy { background: #58c983; }
.trend-track .tone-warning { background: #e8b950; }
.trend-track .tone-critical { background: #ee6969; }
.tone-waiting { color: #8d9baa !important; }
.table-wrap { overflow: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th, td { padding: 9px 10px; text-align: left; border-top: 1px solid rgba(148, 163, 184, .1); white-space: nowrap; }
th { color: #748597; font-weight: 700; }
td { color: #c8d3de; font-variant-numeric: tabular-nums; }
code { color: #9fb1c2; }
.detail-panel dl { margin: 14px 0 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.detail-panel dl div { padding: 10px 12px; border-radius: 8px; background: rgba(148, 163, 184, .05); }
dt { color: #7c8d9e; font-size: 11px; }
dd { margin: 5px 0 0; font-size: 14px; font-weight: 700; }
.empty-state { margin-top: 16px; padding: 24px; text-align: center; color: #8292a2; border: 1px dashed rgba(148, 163, 184, .16); border-radius: 8px; }
.error-box { padding: 12px 16px; display: flex; gap: 10px; color: #ff8c8c; }
@media (max-width: 1200px) { .metric-grid { grid-template-columns: repeat(3, 1fr); } .detail-panel dl { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 760px) { .packet-loss-page { padding: 10px; } .page-header { align-items: flex-start; flex-direction: column; } .metric-grid, .aggregate-grid { grid-template-columns: 1fr; } .detail-panel dl, .aggregate-values { grid-template-columns: repeat(2, 1fr); } }
</style>
