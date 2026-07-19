<template>
  <section class="vehicles-page">
    <header class="page-head">
      <div>
        <p class="eyebrow">BZSS-CORE · VEHICLE RUNTIME</p>
        <h1>载具运行信息</h1>
        <p>查看当前载具的阵营、类型、生命值、速度、位置与驾驶员 Player ID。</p>
      </div>
      <div class="actions">
        <span class="live" :class="{ ready: payload?.status === 'ready' }"><i></i>{{ payload?.status === "ready" ? "实时接收" : "等待数据" }}</span>
        <button type="button" :disabled="loading" @click="loadVehicles()">{{ loading ? "刷新中…" : "立即刷新" }}</button>
      </div>
    </header>

    <div v-if="error" class="error">{{ error }}</div>

    <section class="debug-panel">
      <header><strong>接收与解析诊断</strong><span>用于定位载具日志是否进入面板</span></header>
      <div class="debug-grid">
        <div><span>接口状态</span><b>{{ payload?.status ?? "未连接" }}</b></div>
        <div><span>Node 原始日志事件</span><b>{{ diagnostics?.rawLogEventCount ?? 0 }}</b><small>{{ timeLabel(diagnostics?.lastRawLogEventAt) }}</small></div>
        <div><span>检测到 VRI 文本</span><b>{{ diagnostics?.vriCandidateLines ?? 0 }}</b><small>{{ timeLabel(diagnostics?.lastVriReceivedAt) }}</small></div>
        <div><span>已解析载具帧 / 记录</span><b>{{ diagnostics?.vriFramesParsed ?? 0 }} / {{ diagnostics?.vehicleRecordsParsed ?? 0 }}</b><small>{{ timeLabel(diagnostics?.lastVriParsedAt) }}</small></div>
      </div>
      <p class="debug-reason">{{ diagnostics?.lastVriReason ?? "接口尚未提供诊断数据；请确认面板已同步并重启。" }}</p>
      <details v-if="diagnostics?.lastVriPreview" class="debug-preview"><summary>最近一条 VRI 原始日志摘要</summary><code>{{ diagnostics.lastVriPreview }}</code></details>
    </section>

    <section class="summary">
      <article><span>载具总数</span><strong>{{ vehicles.length }}</strong><small>当前完整输出帧</small></article>
      <article><span>有人驾驶</span><strong>{{ occupiedCount }}</strong><small>{{ vehicles.length - occupiedCount }} 辆无人驾驶</small></article>
      <article><span>受损载具</span><strong>{{ damagedCount }}</strong><small>生命值低于 100%</small></article>
      <article><span>运动中</span><strong>{{ movingCount }}</strong><small>Speed 大于 0.01</small></article>
    </section>

    <section class="panel">
      <header class="toolbar">
        <input v-model.trim="query" type="search" placeholder="搜索载具类型或驾驶员 ID" />
        <div class="teams">
          <button v-for="item in teamOptions" :key="String(item.value)" type="button" :class="{ active: selectedTeam === item.value }" @click="selectedTeam = item.value">{{ item.label }}</button>
        </div>
        <label><input v-model="occupiedOnly" type="checkbox" /> 仅显示有人载具</label>
        <span class="updated">帧时间：{{ updatedAtLabel }}</span>
      </header>

      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>阵营</th><th>载具类型</th><th>生命值</th><th>速度</th><th>驾驶员</th><th>位置 (X / Y / Z)</th><th>状态</th></tr></thead>
          <tbody>
            <tr v-for="vehicle in filteredVehicles" :key="`${payload?.updatedAt}-${vehicle.frameIndex}`">
              <td class="muted">{{ vehicle.frameIndex + 1 }}</td>
              <td><span class="team" :class="`team-${vehicle.teamId ?? 0}`">{{ teamLabel(vehicle.teamId) }}</span></td>
              <td><strong>{{ vehicle.vehicleType || "Unknown" }}</strong></td>
              <td><div class="health"><div><i :class="healthTone(vehicle.healthPercent)" :style="{ width: healthWidth(vehicle.healthPercent) }"></i></div><span>{{ numberLabel(vehicle.healthPercent, 1, "%") }}</span></div></td>
              <td>{{ numberLabel(vehicle.speed, 3) }}</td>
              <td><span v-if="vehicle.driverPlayerId != null" class="driver">ID {{ vehicle.driverPlayerId }}</span><span v-else class="muted">无人</span></td>
              <td class="position">{{ positionLabel(vehicle.position) }}</td>
              <td><i class="state" :class="{ occupied: vehicle.occupied }"></i>{{ vehicle.occupied ? "已占用" : "空载" }}</td>
            </tr>
            <tr v-if="filteredVehicles.length === 0"><td colspan="8" class="empty">{{ vehicles.length ? "没有符合筛选条件的载具" : "尚未收到 VRI 载具输出" }}</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { fetchBzssCoreVehicles, type BzssCoreTrackedVector, type BzssCoreVehiclesResponse } from "../app/bzssCoreApi";

const payload = ref<BzssCoreVehiclesResponse | null>(null);
const loading = ref(false);
const error = ref("");
const query = ref("");
const selectedTeam = ref<number | null>(null);
const occupiedOnly = ref(false);
let refreshTimer: ReturnType<typeof setInterval> | null = null;
const teamOptions: Array<{ label: string; value: number | null }> = [
  { label: "全部", value: null }, { label: "中立", value: 0 }, { label: "Team 1", value: 1 }, { label: "Team 2", value: 2 },
];
const vehicles = computed(() => payload.value?.vehicles ?? []);
const occupiedCount = computed(() => vehicles.value.filter((item) => item.occupied).length);
const damagedCount = computed(() => vehicles.value.filter((item) => item.healthPercent != null && item.healthPercent < 100).length);
const movingCount = computed(() => vehicles.value.filter((item) => Math.abs(item.speed ?? 0) > 0.01).length);
const diagnostics = computed(() => payload.value?.diagnostics ?? null);
const filteredVehicles = computed(() => {
  const needle = query.value.toLowerCase();
  return vehicles.value.filter((item) => {
    if (selectedTeam.value != null && item.teamId !== selectedTeam.value) return false;
    if (occupiedOnly.value && !item.occupied) return false;
    return !needle || item.vehicleType.toLowerCase().includes(needle) || String(item.driverPlayerId ?? "").includes(needle);
  });
});
const updatedAtLabel = computed(() => {
  return timeLabel(payload.value?.updatedAt);
});
async function loadVehicles(silent = false) {
  if (!silent) loading.value = true;
  try { payload.value = await fetchBzssCoreVehicles(); error.value = payload.value.ok ? "" : "BZSS-Core 载具接口返回错误。"; }
  catch (err: any) { error.value = err?.message ?? "无法读取 BZSS-Core 载具信息。"; }
  finally { loading.value = false; }
}
function teamLabel(id: number | null) { return id === 1 ? "Team 1" : id === 2 ? "Team 2" : "中立"; }
function numberLabel(value: number | null, digits = 1, suffix = "") { return value == null ? "--" : `${value.toFixed(digits)}${suffix}`; }
function positionLabel(position: BzssCoreTrackedVector | null) { return !position || position.x == null || position.y == null || position.z == null ? "--" : `${position.x.toFixed(1)} / ${position.y.toFixed(1)} / ${position.z.toFixed(1)}`; }
function healthWidth(value: number | null) { return `${Math.max(0, Math.min(100, value ?? 0))}%`; }
function healthTone(value: number | null) { return value == null ? "unknown" : value < 30 ? "danger" : value < 70 ? "warning" : "healthy"; }
function timeLabel(raw: string | undefined | null) { if (!raw) return "--"; const value = new Date(raw); return Number.isNaN(value.getTime()) ? raw : value.toLocaleTimeString(); }
onMounted(() => { void loadVehicles(); refreshTimer = setInterval(() => { if (!document.hidden) void loadVehicles(true); }, 1500); });
onUnmounted(() => { if (refreshTimer) clearInterval(refreshTimer); });
</script>

<style scoped>
.debug-panel{margin-bottom:16px;border:1px solid #28445d;border-radius:12px;background:#0d1c2a}.debug-panel>header{display:flex;gap:10px;align-items:baseline;padding:12px 15px;border-bottom:1px solid #1c3247}.debug-panel>header strong{font-size:13px;color:#cce5ff}.debug-panel>header span{color:#738ba3;font-size:12px}.debug-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:#1b3043}.debug-grid>div{min-height:70px;padding:11px 14px;background:#0d1c2a}.debug-grid span,.debug-grid small{display:block;color:#7288a0;font-size:11px}.debug-grid b{display:block;margin:5px 0 2px;color:#e4f2ff;font-size:16px}.debug-reason{margin:0;padding:11px 15px;color:#a6bdd2;font-size:12px}.debug-preview{padding:0 15px 13px;color:#8ca6c0;font-size:12px}.debug-preview summary{cursor:pointer}.debug-preview code{display:block;max-height:110px;margin-top:9px;overflow:auto;white-space:pre-wrap;word-break:break-all;color:#b6cce0;font-size:11px}
.vehicles-page{min-height:100%;padding:24px;color:#e8eef8;background:radial-gradient(circle at 80% -20%,rgba(43,110,180,.2),transparent 34%),#08101a}.page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:20px}.eyebrow{margin:0 0 7px;color:#5ea8e8;font-size:11px;font-weight:800;letter-spacing:.16em}.page-head h1{margin:0;font-size:28px}.page-head p:not(.eyebrow){margin:8px 0 0;color:#8494a8}.actions{display:flex;align-items:center;gap:10px}.actions button,.teams button{border:1px solid #263a50;border-radius:8px;background:#101d2b;color:#cfdae8;padding:9px 13px;cursor:pointer}.live{display:flex;align-items:center;gap:7px;color:#8795a6;font-size:12px}.live i,.state{display:inline-block;width:7px;height:7px;border-radius:50%;background:#647487}.live.ready i,.state.occupied{background:#38d39f;box-shadow:0 0 10px rgba(56,211,159,.7)}.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}.summary article{display:grid;grid-template-columns:1fr auto;padding:17px 18px;border:1px solid #1d3043;border-radius:12px;background:#0f1d2b}.summary span{color:#8293a7;font-size:12px}.summary strong{grid-row:1/3;grid-column:2;font-size:29px}.summary small{margin-top:8px;color:#53677d}.panel{overflow:hidden;border:1px solid #1e3348;border-radius:12px;background:#0c1723}.toolbar{display:flex;align-items:center;gap:12px;padding:13px 15px;border-bottom:1px solid #1b2b3c;background:#101d2a}.toolbar>input{min-width:260px;padding:9px 11px;border:1px solid #273c51;border-radius:8px;background:#09131e;color:#e8eef8}.teams{display:flex;gap:5px}.teams button{padding:7px 10px}.teams button.active{border-color:#3c8ed4;background:#153c5d;color:#fff}.toolbar label{color:#9bacbf;font-size:12px}.updated{margin-left:auto;color:#657a91;font-size:12px}.table-wrap{overflow:auto;max-height:calc(100vh - 300px)}table{width:100%;border-collapse:collapse;font-size:13px}th{position:sticky;top:0;padding:11px 13px;text-align:left;color:#75889e;background:#0b1622;border-bottom:1px solid #1d3043;font-size:11px}td{padding:12px 13px;border-bottom:1px solid #142638;white-space:nowrap}tbody tr:hover{background:#102234}.muted{color:#65778c}.team,.driver{display:inline-flex;padding:4px 8px;border-radius:6px;background:#172839;color:#a9bbce;font-size:11px}.team-1{background:rgba(47,133,211,.17);color:#65b5fa}.team-2{background:rgba(220,77,83,.16);color:#ff7c83}.health{display:flex;align-items:center;gap:9px}.health>div{width:72px;height:5px;overflow:hidden;border-radius:9px;background:#253442}.health i{display:block;height:100%}.healthy{background:#38d39f}.warning{background:#edb84d}.danger{background:#ef5e64}.unknown{background:#657487}.position{font-variant-numeric:tabular-nums;color:#9bb0c7}.state{margin-right:7px}.empty{text-align:center;color:#65778c;padding:44px}.error{margin-bottom:12px;padding:10px;border:1px solid #753b41;border-radius:8px;background:#32171c;color:#ff9ba0}@media(max-width:900px){.vehicles-page{padding:14px}.page-head{align-items:flex-start;flex-direction:column}.summary{grid-template-columns:repeat(2,1fr)}.toolbar{align-items:stretch;flex-direction:column}.updated{margin-left:0}.toolbar>input{min-width:0}}
</style>
