<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

type Position = { x?: number; y?: number; z?: number } | null;

type Player = {
  steamID: string;
  playerName: string;
  totalSteps: number;
  matchSteps: number;
  totalDistanceMeters: number;
  matchDistanceMeters: number;
  currentPosition?: Position;
  sourceTick?: string | number | null;
  sourceSeq?: string | number | null;
  telemetryObservedAt?: string;
  telemetryAgeMs?: number | null;
  sampleIntervalMs?: number | null;
  distanceDeltaMeters?: number;
  instantSpeedMps?: number;
  smoothedSpeedMps?: number;
  currentStatus?: string;
  lastReason?: string;
};

type Diagnostics = {
  totalSamples?: number;
  validSamples?: number;
  duplicateSamples?: number;
  staleSamples?: number;
  teleportSamples?: number;
  lastSampleIntervalMs?: number | null;
  averageSampleIntervalMs?: number | null;
  maxSampleIntervalMs?: number | null;
  p95SampleIntervalMs?: number | null;
  telemetryRateHz?: number | null;
};

const players = ref<Player[]>([]);
const diagnostics = ref<Diagnostics>({});
const updatedAt = ref<string | null>(null);
const lastReason = ref("");
let timer: number | undefined;

async function refresh() {
  const response = await fetch("/api/step-counter/stats");
  if (!response.ok) return;
  const data = await response.json();
  players.value = data.players ?? [];
  diagnostics.value = data.sampleDiagnostics ?? {};
  updatedAt.value = data.updatedAt ?? null;
  lastReason.value = data.lastReason ?? "";
}

onMounted(() => {
  void refresh();
  timer = window.setInterval(refresh, 3000);
});
onUnmounted(() => window.clearInterval(timer));

const topPlayers = computed(() => players.value.slice(0, 100));
const meters = (value?: number) => `${Number(value ?? 0).toFixed(1)} m`;
const speed = (value?: number) => `${Number(value ?? 0).toFixed(2)} m/s`;
const milliseconds = (value?: number | null) => value == null ? "—" : `${Math.round(value)} ms`;
const hertz = (value?: number | null) => value == null ? "—" : `${value.toFixed(2)} Hz`;
const telemetryTime = (value?: string) => value ? new Date(value).toLocaleTimeString() : "—";
const position = (value?: Position) => value
  ? `${Number(value.x ?? 0).toFixed(0)}, ${Number(value.y ?? 0).toFixed(0)}, ${Number(value.z ?? 0).toFixed(0)}`
  : "—";
const statusClass = (status?: string) => String(status ?? "UNKNOWN").toLowerCase().replace(/_/g, "-");
</script>

<template>
  <section class="step-counter-page">
    <header class="page-header">
      <div>
        <p class="eyebrow">BZSS · TELEMETRY DIAGNOSTICS</p>
        <h1>步数统计</h1>
        <p class="muted">每个 BZSS-Core 遥测样本只消费一次；重复 Tactical Snapshot 不再生成 0 或异常高速。</p>
      </div>
      <div class="status">
        <span>存储更新：{{ updatedAt ? new Date(updatedAt).toLocaleTimeString() : "尚未写入" }}</span>
        <span v-if="lastReason">最近状态：{{ lastReason }}</span>
      </div>
    </header>

    <div class="diagnostic-grid">
      <article><span>Telemetry Rate</span><strong>{{ hertz(diagnostics.telemetryRateHz) }}</strong></article>
      <article><span>Valid Samples</span><strong>{{ Number(diagnostics.validSamples ?? 0).toLocaleString() }}</strong></article>
      <article><span>Duplicates Ignored</span><strong>{{ Number(diagnostics.duplicateSamples ?? 0).toLocaleString() }}</strong></article>
      <article><span>Last Interval</span><strong>{{ milliseconds(diagnostics.lastSampleIntervalMs) }}</strong></article>
      <article><span>Average Interval</span><strong>{{ milliseconds(diagnostics.averageSampleIntervalMs) }}</strong></article>
      <article><span>P95 / Max</span><strong>{{ milliseconds(diagnostics.p95SampleIntervalMs) }} / {{ milliseconds(diagnostics.maxSampleIntervalMs) }}</strong></article>
      <article><span>Stale / Teleport</span><strong>{{ Number(diagnostics.staleSamples ?? 0) }} / {{ Number(diagnostics.teleportSamples ?? 0) }}</strong></article>
      <article><span>Total Observations</span><strong>{{ Number(diagnostics.totalSamples ?? 0).toLocaleString() }}</strong></article>
    </div>

    <div class="table-shell">
      <table>
        <thead>
          <tr>
            <th>#</th><th>玩家</th><th>位置 (cm)</th><th>Tick</th><th>Seq</th>
            <th>遥测时间</th><th>遥测年龄</th><th>采样间隔</th><th>距离增量</th>
            <th>瞬时速度</th><th>平滑速度</th><th>状态</th>
            <th>本局步数</th><th>本局距离</th><th>累计步数</th><th>累计距离</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(player, index) in topPlayers" :key="player.steamID">
            <td>{{ index + 1 }}</td>
            <td class="player-cell"><strong>{{ player.playerName || player.steamID }}</strong><small>{{ player.steamID }}</small></td>
            <td class="mono">{{ position(player.currentPosition) }}</td>
            <td class="mono">{{ player.sourceTick ?? "—" }}</td>
            <td class="mono">{{ player.sourceSeq ?? "—" }}</td>
            <td>{{ telemetryTime(player.telemetryObservedAt) }}</td>
            <td>{{ milliseconds(player.telemetryAgeMs) }}</td>
            <td>{{ milliseconds(player.sampleIntervalMs) }}</td>
            <td>{{ meters(player.distanceDeltaMeters) }}</td>
            <td>{{ speed(player.instantSpeedMps) }}</td>
            <td>{{ speed(player.smoothedSpeedMps) }}</td>
            <td><span class="status-pill" :class="statusClass(player.currentStatus)">{{ player.currentStatus ?? "UNKNOWN" }}</span></td>
            <td>{{ player.matchSteps.toLocaleString() }}</td>
            <td>{{ meters(player.matchDistanceMeters) }}</td>
            <td>{{ player.totalSteps.toLocaleString() }}</td>
            <td>{{ meters(player.totalDistanceMeters) }}</td>
          </tr>
          <tr v-if="!topPlayers.length"><td colspan="16" class="empty">暂无可统计玩家</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.step-counter-page { min-height:100%; padding-bottom:28px; color:#d9e5f2; }
.page-header { display:flex; justify-content:space-between; gap:24px; padding:22px; margin-bottom:14px; border:1px solid #24384e; background:rgba(10,20,32,.82); border-radius:12px; }
.eyebrow { color:#57d6a0; letter-spacing:.12em; font-size:11px; margin:0 0 6px; }
h1 { margin:0 0 6px; }
.muted, .status { color:#8da3b8; font-size:13px; }
.status { display:flex; flex-direction:column; gap:8px; text-align:right; }
.diagnostic-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(155px,1fr)); gap:10px; margin-bottom:14px; }
.diagnostic-grid article { padding:13px 15px; border:1px solid #24384e; border-radius:10px; background:rgba(8,16,27,.86); }
.diagnostic-grid span { display:block; margin-bottom:7px; color:#71869b; font-size:11px; text-transform:uppercase; }
.diagnostic-grid strong { color:#d9e5f2; font-size:16px; }
.table-shell { max-height:calc(100vh - 315px); min-height:280px; overflow:auto; overscroll-behavior:contain; border:1px solid #24384e; border-radius:12px; background:rgba(8,16,27,.86); }
table { width:100%; border-collapse:separate; border-spacing:0; min-width:2180px; }
th, td { padding:10px 12px; border-bottom:1px solid #1b2b3c; text-align:left; white-space:nowrap; }
th { position:sticky; top:0; z-index:2; color:#80a0ba; background:#0c1927; font-size:11px; text-transform:uppercase; }
td { font-size:12px; }
.player-cell { min-width:190px; }
td small { display:block; color:#71869b; font-size:10px; margin-top:3px; }
.mono { color:#9bb2c7; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
.status-pill { display:inline-flex; padding:4px 7px; border:1px solid #35506a; border-radius:999px; color:#9bb2c7; background:#122437; font-size:10px; }
.status-pill.valid { color:#65e5ad; border-color:#24694d; background:#103326; }
.status-pill.duplicate { color:#83b7e5; border-color:#315d82; background:#102a40; }
.status-pill.stationary, .status-pill.warming-up { color:#a7b6c5; }
.status-pill.above-walking-speed, .status-pill.teleport, .status-pill.invalid-interval { color:#ff8b8b; border-color:#7c3838; background:#351818; }
.status-pill.stale, .status-pill.no-timestamp, .status-pill.no-position { color:#f4c76b; border-color:#735b2b; background:#302711; }
.empty { text-align:center; padding:35px; color:#71869b; }
@media (max-width:800px) {
  .page-header { flex-direction:column; }
  .status { text-align:left; }
  .table-shell { max-height:calc(100vh - 390px); }
}
</style>
