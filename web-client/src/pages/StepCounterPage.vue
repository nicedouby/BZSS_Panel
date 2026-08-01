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
};

type Diagnostics = {
  totalSamples?: number;
  validSamples?: number;
  duplicateSamples?: number;
  stationarySamples?: number;
  staleSamples?: number;
  teleportSamples?: number;
  aboveWalkingSpeedSamples?: number;
  missingTimestampSamples?: number;
  missingPositionSamples?: number;
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
const search = ref("");
const statusFilter = ref("ALL");
const showAdvanced = ref(false);
const loading = ref(false);
const resetting = ref(false);
const notice = ref("");
const errorMessage = ref("");
let timer: number | undefined;

async function refresh() {
  if (loading.value) return;
  loading.value = true;
  try {
    const response = await fetch("/api/step-counter/stats");
    if (!response.ok) throw new Error(`读取失败（HTTP ${response.status}）`);
    const data = await response.json();
    players.value = data.players ?? [];
    diagnostics.value = data.sampleDiagnostics ?? {};
    updatedAt.value = data.updatedAt ?? null;
    lastReason.value = data.lastReason ?? "";
    errorMessage.value = "";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "无法读取步数统计";
  } finally {
    loading.value = false;
  }
}

async function resetMatchStats() {
  const confirmed = window.confirm("确定重置本局步数和本局距离吗？累计步数与累计距离会保留。");
  if (!confirmed) return;

  resetting.value = true;
  notice.value = "";
  errorMessage.value = "";
  try {
    const response = await fetch("/api/step-counter/reset-match", { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok !== true) {
      throw new Error(data.message ?? `重置失败（HTTP ${response.status}）`);
    }
    notice.value = `已重置 ${Number(data.playersReset ?? 0)} 名玩家的本局统计，累计数据已保留。`;
    await refresh();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "重置失败";
  } finally {
    resetting.value = false;
  }
}

onMounted(() => {
  void refresh();
  timer = window.setInterval(refresh, 3000);
});
onUnmounted(() => window.clearInterval(timer));

const statusOptions = computed(() => {
  const values = new Set(players.value.map((player) => player.currentStatus || "UNKNOWN"));
  return ["ALL", ...Array.from(values).sort()];
});

const filteredPlayers = computed(() => {
  const query = search.value.trim().toLowerCase();
  return players.value.filter((player) => {
    const matchesQuery = !query
      || player.playerName?.toLowerCase().includes(query)
      || player.steamID.includes(query);
    const matchesStatus = statusFilter.value === "ALL"
      || (player.currentStatus || "UNKNOWN") === statusFilter.value;
    return matchesQuery && matchesStatus;
  }).slice(0, 100);
});

const activePlayers = computed(() => players.value.filter((player) =>
  player.telemetryAgeMs != null && player.telemetryAgeMs < 5000,
).length);

const validRatio = computed(() => {
  const total = Number(diagnostics.value.totalSamples ?? 0);
  if (total <= 0) return "—";
  return `${((Number(diagnostics.value.validSamples ?? 0) / total) * 100).toFixed(1)}%`;
});

const meters = (value?: number) => `${Number(value ?? 0).toFixed(1)} m`;
const speed = (value?: number) => `${Number(value ?? 0).toFixed(2)} m/s`;
const milliseconds = (value?: number | null) => value == null ? "—" : `${Math.round(value)} ms`;
const hertz = (value?: number | null) => value == null ? "—" : `${value.toFixed(2)} Hz`;
const telemetryTime = (value?: string) => value ? new Date(value).toLocaleTimeString() : "—";
const position = (value?: Position) => value
  ? `${Number(value.x ?? 0).toFixed(0)}, ${Number(value.y ?? 0).toFixed(0)}, ${Number(value.z ?? 0).toFixed(0)}`
  : "—";
const statusClass = (status?: string) => String(status ?? "UNKNOWN").toLowerCase().replace(/_/g, "-");
const ageClass = (age?: number | null) => age == null ? "age-missing" : age >= 5000 ? "age-danger" : age >= 1500 ? "age-warning" : "age-good";
</script>

<template>
  <section class="step-counter-page">
    <header class="page-header">
      <div class="title-block">
        <p class="eyebrow">BZSS · TELEMETRY DIAGNOSTICS</p>
        <h1>步数统计</h1>
        <p>实时检查玩家移动、遥测质量与步数累计结果。</p>
      </div>
      <div class="header-actions">
        <div class="update-state">
          <span :class="{ pulse: loading }"></span>
          {{ updatedAt ? `更新于 ${new Date(updatedAt).toLocaleTimeString()}` : "等待数据" }}
        </div>
        <button class="danger-button" :disabled="resetting" @click="resetMatchStats">
          {{ resetting ? "正在重置…" : "重置本局统计" }}
        </button>
      </div>
    </header>

    <div v-if="notice" class="message success">{{ notice }}</div>
    <div v-if="errorMessage" class="message error">{{ errorMessage }}</div>

    <div class="summary-grid">
      <article class="summary-card accent">
        <span>遥测频率</span>
        <strong>{{ hertz(diagnostics.telemetryRateHz) }}</strong>
        <small>平均 {{ milliseconds(diagnostics.averageSampleIntervalMs) }}</small>
      </article>
      <article class="summary-card">
        <span>活跃遥测玩家</span>
        <strong>{{ activePlayers }} / {{ players.length }}</strong>
        <small>最近 5 秒内有数据</small>
      </article>
      <article class="summary-card">
        <span>有效样本比例</span>
        <strong>{{ validRatio }}</strong>
        <small>{{ Number(diagnostics.validSamples ?? 0).toLocaleString() }} 个有效样本</small>
      </article>
      <article class="summary-card warning">
        <span>已忽略重复样本</span>
        <strong>{{ Number(diagnostics.duplicateSamples ?? 0).toLocaleString() }}</strong>
        <small>不会覆盖移动基线</small>
      </article>
    </div>

    <details class="diagnostics-panel">
      <summary>
        <span>采样链路详情</span>
        <small>最近状态：{{ lastReason || "正常" }}</small>
      </summary>
      <div class="diagnostic-grid">
        <div><span>最后间隔</span><strong>{{ milliseconds(diagnostics.lastSampleIntervalMs) }}</strong></div>
        <div><span>P95 间隔</span><strong>{{ milliseconds(diagnostics.p95SampleIntervalMs) }}</strong></div>
        <div><span>最大间隔</span><strong>{{ milliseconds(diagnostics.maxSampleIntervalMs) }}</strong></div>
        <div><span>静止样本</span><strong>{{ Number(diagnostics.stationarySamples ?? 0) }}</strong></div>
        <div><span>陈旧样本</span><strong>{{ Number(diagnostics.staleSamples ?? 0) }}</strong></div>
        <div><span>瞬移样本</span><strong>{{ Number(diagnostics.teleportSamples ?? 0) }}</strong></div>
        <div><span>异常高速</span><strong>{{ Number(diagnostics.aboveWalkingSpeedSamples ?? 0) }}</strong></div>
        <div><span>缺少时间/位置</span><strong>{{ Number(diagnostics.missingTimestampSamples ?? 0) }} / {{ Number(diagnostics.missingPositionSamples ?? 0) }}</strong></div>
      </div>
    </details>

    <div class="table-card">
      <div class="toolbar">
        <div class="filters">
          <label class="search-box">
            <span>搜索</span>
            <input v-model="search" type="search" placeholder="玩家名字或 SteamID" />
          </label>
          <label>
            <span>状态</span>
            <select v-model="statusFilter">
              <option v-for="status in statusOptions" :key="status" :value="status">
                {{ status === "ALL" ? "全部状态" : status }}
              </option>
            </select>
          </label>
          <label class="advanced-toggle">
            <input v-model="showAdvanced" type="checkbox" />
            <span>显示高级遥测字段</span>
          </label>
        </div>
        <span class="result-count">显示 {{ filteredPlayers.length }} / {{ players.length }} 名玩家</span>
      </div>

      <div class="table-shell">
        <table :class="{ advanced: showAdvanced }">
          <thead>
            <tr>
              <th class="rank-column">#</th>
              <th class="player-column">玩家</th>
              <th>状态</th>
              <th>遥测年龄</th>
              <th>瞬时速度</th>
              <th>平滑速度</th>
              <th>本局步数</th>
              <th>本局距离</th>
              <th>累计步数</th>
              <th>累计距离</th>
              <template v-if="showAdvanced">
                <th>位置 (cm)</th>
                <th>Tick</th>
                <th>Seq</th>
                <th>遥测时间</th>
                <th>采样间隔</th>
                <th>距离增量</th>
              </template>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(player, index) in filteredPlayers" :key="player.steamID">
              <td class="rank-column">{{ index + 1 }}</td>
              <td class="player-column">
                <strong>{{ player.playerName || player.steamID }}</strong>
                <small>{{ player.steamID }}</small>
              </td>
              <td><span class="status-pill" :class="statusClass(player.currentStatus)">{{ player.currentStatus ?? "UNKNOWN" }}</span></td>
              <td><span class="age" :class="ageClass(player.telemetryAgeMs)">{{ milliseconds(player.telemetryAgeMs) }}</span></td>
              <td>{{ speed(player.instantSpeedMps) }}</td>
              <td>{{ speed(player.smoothedSpeedMps) }}</td>
              <td class="metric">{{ player.matchSteps.toLocaleString() }}</td>
              <td>{{ meters(player.matchDistanceMeters) }}</td>
              <td class="metric subtle">{{ player.totalSteps.toLocaleString() }}</td>
              <td>{{ meters(player.totalDistanceMeters) }}</td>
              <template v-if="showAdvanced">
                <td class="mono">{{ position(player.currentPosition) }}</td>
                <td class="mono">{{ player.sourceTick ?? "—" }}</td>
                <td class="mono">{{ player.sourceSeq ?? "—" }}</td>
                <td>{{ telemetryTime(player.telemetryObservedAt) }}</td>
                <td>{{ milliseconds(player.sampleIntervalMs) }}</td>
                <td>{{ meters(player.distanceDeltaMeters) }}</td>
              </template>
            </tr>
            <tr v-if="!filteredPlayers.length">
              <td :colspan="showAdvanced ? 16 : 10" class="empty">没有符合当前筛选条件的玩家</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<style scoped>
.step-counter-page { min-height:100%; padding:0 0 32px; color:#d9e5f2; overflow:visible; }
.page-header { display:flex; justify-content:space-between; align-items:center; gap:24px; padding:22px 24px; margin-bottom:14px; border:1px solid #24384e; background:linear-gradient(135deg,rgba(13,28,44,.94),rgba(8,17,29,.86)); border-radius:14px; box-shadow:0 16px 40px rgba(0,0,0,.18); }
.title-block { min-width:0; }
.eyebrow { color:#57d6a0; letter-spacing:.14em; font-size:10px; margin:0 0 7px; }
h1 { margin:0; font-size:25px; }
.title-block > p:last-child { margin:7px 0 0; color:#8da3b8; font-size:13px; }
.header-actions { display:flex; align-items:center; gap:14px; }
.update-state { display:flex; align-items:center; gap:7px; color:#8da3b8; font-size:12px; white-space:nowrap; }
.update-state span { width:7px; height:7px; border-radius:50%; background:#57d6a0; box-shadow:0 0 10px rgba(87,214,160,.65); }
.update-state span.pulse { animation:pulse 1s infinite; }
button { border:0; font:inherit; cursor:pointer; }
.danger-button { padding:10px 14px; border:1px solid #7a3b43; border-radius:9px; color:#ffb1b7; background:rgba(104,30,39,.34); font-size:12px; transition:.18s ease; }
.danger-button:hover:not(:disabled) { border-color:#d45a66; background:rgba(138,38,49,.5); }
.danger-button:disabled { opacity:.55; cursor:wait; }
.message { margin-bottom:12px; padding:11px 14px; border-radius:9px; font-size:12px; }
.message.success { color:#8ce8bb; border:1px solid #2d674e; background:rgba(22,75,53,.34); }
.message.error { color:#ffadb4; border:1px solid #753a42; background:rgba(85,28,36,.38); }
.summary-grid { display:grid; grid-template-columns:repeat(4,minmax(150px,1fr)); gap:11px; margin-bottom:12px; }
.summary-card { padding:15px 17px; border:1px solid #24384e; border-radius:11px; background:rgba(8,16,27,.86); }
.summary-card span,.summary-card small { display:block; color:#71869b; font-size:11px; }
.summary-card strong { display:block; margin:7px 0 5px; color:#e1ebf5; font-size:21px; }
.summary-card.accent strong { color:#66e3ad; }
.summary-card.warning strong { color:#f2c46d; }
.diagnostics-panel { margin-bottom:12px; border:1px solid #24384e; border-radius:10px; background:rgba(8,16,27,.72); }
.diagnostics-panel summary { display:flex; justify-content:space-between; gap:18px; padding:12px 15px; cursor:pointer; color:#b8c9d9; font-size:12px; }
.diagnostics-panel summary small { color:#71869b; }
.diagnostic-grid { display:grid; grid-template-columns:repeat(8,minmax(100px,1fr)); gap:1px; border-top:1px solid #1b2b3c; background:#1b2b3c; }
.diagnostic-grid div { padding:11px 13px; background:#0b1724; }
.diagnostic-grid span { display:block; color:#71869b; font-size:10px; }
.diagnostic-grid strong { display:block; margin-top:5px; font-size:13px; }
.table-card { overflow:hidden; border:1px solid #24384e; border-radius:12px; background:rgba(8,16,27,.9); }
.toolbar { display:flex; justify-content:space-between; align-items:end; gap:16px; padding:12px 14px; border-bottom:1px solid #24384e; }
.filters { display:flex; align-items:end; gap:10px; flex-wrap:wrap; }
.filters label:not(.advanced-toggle) span { display:block; margin-bottom:5px; color:#71869b; font-size:10px; text-transform:uppercase; }
input[type="search"],select { height:34px; border:1px solid #2c4258; border-radius:8px; outline:none; color:#d9e5f2; background:#0c1a28; font-size:12px; }
input[type="search"] { width:230px; padding:0 10px; }
select { min-width:155px; padding:0 28px 0 9px; }
input[type="search"]:focus,select:focus { border-color:#4b8f78; box-shadow:0 0 0 2px rgba(87,214,160,.1); }
.advanced-toggle { display:flex; align-items:center; gap:7px; height:34px; color:#9aafc1; font-size:11px; cursor:pointer; }
.result-count { color:#71869b; font-size:11px; white-space:nowrap; }
.table-shell { max-height:calc(100vh - 365px); min-height:340px; overflow:auto; overscroll-behavior:contain; }
table { width:100%; min-width:1120px; border-collapse:separate; border-spacing:0; }
table.advanced { min-width:1980px; }
th,td { padding:10px 12px; border-bottom:1px solid #192a3a; text-align:left; white-space:nowrap; }
th { position:sticky; top:0; z-index:4; color:#7f9bb2; background:#0d1b29; font-size:10px; text-transform:uppercase; letter-spacing:.03em; }
td { font-size:12px; }
tbody tr:hover td { background:#0e2030; }
.rank-column { position:sticky; left:0; z-index:2; width:34px; min-width:34px; text-align:center; background:#0a1724; }
.player-column { position:sticky; left:58px; z-index:2; min-width:190px; background:#0a1724; box-shadow:8px 0 12px rgba(0,0,0,.12); }
th.rank-column,th.player-column { z-index:6; background:#0d1b29; }
.player-column strong { display:block; max-width:190px; overflow:hidden; text-overflow:ellipsis; }
.player-column small { display:block; margin-top:3px; color:#657c91; font-size:10px; }
.metric { color:#70e2ae; font-weight:700; }
.metric.subtle { color:#a7bed1; }
.mono { color:#9bb2c7; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
.status-pill { display:inline-flex; padding:4px 7px; border:1px solid #35506a; border-radius:999px; color:#9bb2c7; background:#122437; font-size:9px; }
.status-pill.valid { color:#65e5ad; border-color:#24694d; background:#103326; }
.status-pill.duplicate { color:#83b7e5; border-color:#315d82; background:#102a40; }
.status-pill.stationary,.status-pill.warming-up { color:#a7b6c5; }
.status-pill.above-walking-speed,.status-pill.teleport,.status-pill.invalid-interval { color:#ff8b8b; border-color:#7c3838; background:#351818; }
.status-pill.stale,.status-pill.no-timestamp,.status-pill.no-position { color:#f4c76b; border-color:#735b2b; background:#302711; }
.age { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
.age-good { color:#67dba8; }
.age-warning { color:#f1c66d; }
.age-danger,.age-missing { color:#ef858d; }
.empty { position:static; padding:45px; text-align:center; color:#71869b; background:transparent; }
@keyframes pulse { 50% { opacity:.35; transform:scale(.8); } }
@media (max-width:1100px) {
  .summary-grid { grid-template-columns:repeat(2,1fr); }
  .diagnostic-grid { grid-template-columns:repeat(4,1fr); }
  .table-shell { max-height:calc(100vh - 430px); }
}
@media (max-width:720px) {
  .page-header,.toolbar { align-items:stretch; flex-direction:column; }
  .header-actions { justify-content:space-between; }
  .summary-grid { grid-template-columns:1fr 1fr; }
  .diagnostic-grid { grid-template-columns:repeat(2,1fr); }
  .filters { display:grid; grid-template-columns:1fr; }
  input[type="search"],select { width:100%; }
  .table-shell { max-height:calc(100vh - 500px); min-height:300px; }
}
</style>
