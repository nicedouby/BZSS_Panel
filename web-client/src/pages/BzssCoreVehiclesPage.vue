<template>
  <section class="bz-page">
    <header class="page-head">
      <div>
        <p class="eyebrow">BZSS-CORE · VEHICLE RUNTIME</p>
        <h1 class="page-title">载具运行信息</h1>
        <p class="page-subtitle">查看当前载具的阵营、类型、生命值、速度、位置与驾驶员 Player ID。</p>
      </div>
      <div class="actions">
        <span class="live" :class="{ ready: payload?.status === 'ready' }">
          <span class="pulse-dot"></span>
          {{ payload?.status === "ready" ? "实时接收" : "等待数据" }}
        </span>
        <button 
          type="button" 
          class="bz-btn bz-btn-ghost toggle-diag-btn" 
          @click="showDiagnostics = !showDiagnostics"
        >
          {{ showDiagnostics ? "隐藏诊断" : "显示诊断" }}
        </button>
        <button 
          type="button" 
          class="bz-btn bz-btn-primary" 
          :disabled="loading" 
          @click="loadVehicles()"
        >
          {{ loading ? "刷新中…" : "立即刷新" }}
        </button>
      </div>
    </header>

    <div v-if="error" class="error-banner">
      <span class="warning-icon">⚠️</span>
      <div class="error-content">
        <strong>接口错误：</strong><span>{{ error }}</span>
      </div>
    </div>

    <!-- Collapsible Diagnostics Panel -->
    <transition name="slide-fade">
      <section v-if="showDiagnostics" class="bz-card debug-panel">
        <header class="bz-card-header">
          <div>
            <h3 class="bz-card-title">接收与解析诊断</h3>
            <p class="bz-card-desc">用于定位载具日志是否进入面板</p>
          </div>
        </header>
        <div class="bz-card-body">
          <div class="debug-grid">
            <div class="debug-card">
              <span class="lbl">接口状态</span>
              <strong class="val">{{ payload?.status ?? "未连接" }}</strong>
            </div>
            <div class="debug-card">
              <span class="lbl">Node 原始日志事件</span>
              <strong class="val">{{ diagnostics?.rawLogEventCount ?? 0 }}</strong>
              <small class="sub text-muted">{{ timeLabel(diagnostics?.lastRawLogEventAt) }}</small>
            </div>
            <div class="debug-card">
              <span class="lbl">检测到 VRI 文本</span>
              <strong class="val">{{ diagnostics?.vriCandidateLines ?? 0 }}</strong>
              <small class="sub text-muted">{{ timeLabel(diagnostics?.lastVriReceivedAt) }}</small>
            </div>
            <div class="debug-card">
              <span class="lbl">已解析载具帧 / 记录</span>
              <strong class="val">{{ diagnostics?.vriFramesParsed ?? 0 }} / {{ diagnostics?.vehicleRecordsParsed ?? 0 }}</strong>
              <small class="sub text-muted">{{ timeLabel(diagnostics?.lastVriParsedAt) }}</small>
            </div>
          </div>
          <div class="debug-reason-box">
            <span class="reason-label">最近解析状态原因：</span>
            <p class="debug-reason">{{ diagnostics?.lastVriReason ?? "接口尚未提供诊断数据；请确认面板已同步并重启。" }}</p>
          </div>
          <details v-if="diagnostics?.lastVriPreview" class="debug-preview">
            <summary>最近一条 VRI 原始日志摘要</summary>
            <code>{{ diagnostics.lastVriPreview }}</code>
          </details>
        </div>
      </section>
    </transition>

    <!-- Stats Summary Cards -->
    <section class="summary-cards-grid">
      <div class="stat-card total">
        <div class="stat-card-inner">
          <div class="stat-icon">🚙</div>
          <div class="stat-info">
            <span class="lbl">载具总数</span>
            <strong class="val">{{ vehicles.length }}</strong>
            <span class="sub">当前完整输出帧</span>
          </div>
        </div>
      </div>

      <div class="stat-card occupied" :class="{ active: occupiedCount > 0 }">
        <div class="stat-card-inner">
          <div class="stat-icon">👥</div>
          <div class="stat-info">
            <span class="lbl">有人驾驶</span>
            <strong class="val">{{ occupiedCount }}</strong>
            <span class="sub">{{ vehicles.length - occupiedCount }} 辆无人驾驶</span>
          </div>
        </div>
      </div>

      <div class="stat-card damaged" :class="{ warning: damagedCount > 0 }">
        <div class="stat-card-inner">
          <div class="stat-icon">🛠️</div>
          <div class="stat-info">
            <span class="lbl">受损载具</span>
            <strong class="val">{{ damagedCount }}</strong>
            <span class="sub">生命值低于 100%</span>
          </div>
        </div>
      </div>

      <div class="stat-card moving" :class="{ active: movingCount > 0 }">
        <div class="stat-card-inner">
          <div class="stat-icon">⚡</div>
          <div class="stat-info">
            <span class="lbl">运动中</span>
            <strong class="val">{{ movingCount }}</strong>
            <span class="sub">Speed 大于 0.01</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Vehicles List Card -->
    <section class="bz-card list-panel">
      <header class="toolbar-wrapper">
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input v-model.trim="query" type="search" placeholder="搜索载具类型或驾驶员 ID..." />
        </div>
        
        <div class="filter-group">
          <span class="filter-lbl">过滤阵营：</span>
          <div class="team-switch">
            <button 
              v-for="item in teamOptions" 
              :key="String(item.value)" 
              type="button" 
              class="team-btn"
              :class="{ 
                active: selectedTeam === item.value, 
                'btn-neutral': item.value === 0, 
                'btn-team1': item.value === 1, 
                'btn-team2': item.value === 2 
              }" 
              @click="selectedTeam = item.value"
            >
              {{ item.label }}
            </button>
          </div>
        </div>

        <label class="toggle-switch">
          <input v-model="occupiedOnly" type="checkbox" />
          <span class="slider"></span>
          <span class="label-text">仅显示有人</span>
        </label>

        <span class="updated-time">
          <span class="time-icon">🕒</span>
          帧更新：{{ updatedAtLabel }}
        </span>
      </header>

      <div class="table-wrap">
        <table class="vehicles-table">
          <thead>
            <tr>
              <th class="w-index">#</th>
              <th class="w-team">阵营</th>
              <th class="w-type">载具类型</th>
              <th class="w-health">生命值</th>
              <th class="w-speed">速度</th>
              <th class="w-driver">驾驶员</th>
              <th class="w-pos">位置 (X / Y / Z)</th>
              <th class="w-status">状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="vehicle in filteredVehicles" :key="vehicle.trackId ?? `${vehicle.frameIndex}-${vehicle.vehicleType}`" class="vehicle-row">
              <td class="muted mono text-center">{{ vehicle.frameIndex + 1 }}</td>
              <td>
                <span class="team-badge" :class="`team-${vehicle.teamId ?? 0}`">
                  {{ teamLabel(vehicle.teamId) }}
                </span>
              </td>
              <td>
                <strong class="vehicle-type-text">{{ vehicle.vehicleType || "Unknown" }}</strong>
              </td>
              <td>
                <div class="health-container">
                  <div class="health-bar-track">
                    <div 
                      class="health-bar-fill" 
                      :class="healthTone(vehicle.healthPercent)" 
                      :style="{ width: healthWidth(vehicle.healthPercent) }"
                    ></div>
                  </div>
                  <span class="health-val mono" :class="healthTone(vehicle.healthPercent)">
                    {{ numberLabel(vehicle.healthPercent, 1, "%") }}
                  </span>
                </div>
              </td>
              <td class="mono font-semibold">{{ numberLabel(vehicle.speed, 3) }}</td>
              <td>
                <span v-if="vehicle.driverPlayerId != null" class="driver-badge">
                  <span class="driver-icon">👤</span> ID {{ vehicle.driverPlayerId }}
                </span>
                <span v-else class="driver-empty">无人</span>
              </td>
              <td class="position-cell mono">{{ positionLabel(vehicle.position) }}</td>
              <td>
                <span class="status-indicator" :class="{ occupied: vehicle.occupied }">
                  <span class="status-dot"></span>
                  {{ vehicle.occupied ? "已占用" : "空载" }}
                </span>
              </td>
            </tr>
            <tr v-if="filteredVehicles.length === 0">
              <td colspan="8" class="empty-cell">
                <div class="empty-state">
                  <span class="empty-icon">📭</span>
                  <p class="empty-title">{{ vehicles.length ? "没有符合过滤条件的载具" : "尚未收到 VRI 载具输出" }}</p>
                  <p class="empty-desc">请确认服务器处于运行状态，或调整上方过滤选项</p>
                </div>
              </td>
            </tr>
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
const showDiagnostics = ref(false);
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
  try { 
    payload.value = await fetchBzssCoreVehicles(); 
    error.value = payload.value.ok ? "" : "BZSS-Core 载具接口返回错误。"; 
  }
  catch (err: any) { 
    error.value = err?.message ?? "无法读取 BZSS-Core 载具信息。"; 
  }
  finally { 
    loading.value = false; 
  }
}

function teamLabel(id: number | null) { 
  return id === 1 ? "Team 1" : id === 2 ? "Team 2" : "中立"; 
}

function numberLabel(value: number | null, digits = 1, suffix = "") { 
  return value == null ? "--" : `${value.toFixed(digits)}${suffix}`; 
}

function positionLabel(position: BzssCoreTrackedVector | null) { 
  return !position || position.x == null || position.y == null || position.z == null 
    ? "--" 
    : `${position.x.toFixed(1)} / ${position.y.toFixed(1)} / ${position.z.toFixed(1)}`; 
}

function healthWidth(value: number | null) { 
  return `${Math.max(0, Math.min(100, value ?? 0))}%`; 
}

function healthTone(value: number | null) { 
  return value == null ? "unknown" : value < 30 ? "danger" : value < 70 ? "warning" : "healthy"; 
}

function timeLabel(raw: string | undefined | null) { 
  if (!raw) return "--"; 
  const value = new Date(raw); 
  return Number.isNaN(value.getTime()) ? raw : value.toLocaleTimeString(); 
}

onMounted(() => { 
  void loadVehicles(); 
  refreshTimer = setInterval(() => { 
    if (!document.hidden) void loadVehicles(true); 
  }, 1500); 
});

onUnmounted(() => { 
  if (refreshTimer) clearInterval(refreshTimer); 
});
</script>

<style scoped>
/* Layout & Page wrapper */
.bz-page {
  padding: 24px;
  animation: fadeIn 0.4s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Header elements */
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 24px;
}
.eyebrow {
  margin: 0 0 6px;
  color: var(--color-brand-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-shadow: 0 0 10px rgba(55, 200, 255, 0.2);
}
.page-title {
  margin: 0;
  font-size: 28px;
  font-weight: 800;
  color: var(--color-text-primary);
  letter-spacing: -0.02em;
}
.page-subtitle {
  margin: 8px 0 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.5;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* Live Badge */
.live {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: rgba(31, 45, 63, 0.6);
  border: 1px solid var(--color-border-default);
  border-radius: 999px;
  font-size: 12px;
  color: var(--color-text-secondary);
  font-weight: 600;
}
.pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-disabled);
  position: relative;
}
.live.ready .pulse-dot {
  background: var(--color-status-success);
  box-shadow: 0 0 8px var(--color-status-success);
  animation: pulse 2s infinite;
}
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.7); }
  70% { box-shadow: 0 0 0 6px rgba(52, 211, 153, 0); }
  100% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0); }
}

/* Error Banner */
.error-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  margin-bottom: 20px;
  border-radius: 12px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
  color: #fca5a5;
  animation: slideDown 0.3s ease-out;
}
@keyframes slideDown {
  from { transform: translateY(-10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* Collapsible Diagnostics Panel */
.debug-panel {
  margin-bottom: 24px;
  background: rgba(11, 23, 39, 0.75);
  border: 1px solid rgba(56, 189, 248, 0.15);
  box-shadow: var(--shadow-lg), 0 0 20px rgba(56, 189, 248, 0.03);
}
.debug-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  background: var(--color-border-default);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 16px;
}
.debug-card {
  padding: 14px;
  background: rgba(9, 17, 30, 0.6);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.debug-card .lbl {
  font-size: 11px;
  color: var(--color-text-muted);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.debug-card .val {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text-primary);
}
.debug-card .sub {
  font-size: 11px;
}
.debug-reason-box {
  background: rgba(9, 17, 30, 0.4);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
}
.reason-label {
  display: block;
  font-size: 11px;
  color: var(--color-text-muted);
  margin-bottom: 4px;
  font-weight: 600;
}
.debug-reason {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.4;
}
.debug-preview {
  margin-top: 12px;
}
.debug-preview summary {
  font-size: 12px;
  color: var(--color-brand-primary);
  cursor: pointer;
  user-select: none;
  font-weight: 600;
  outline: none;
}
.debug-preview summary:hover {
  text-decoration: underline;
}
.debug-preview code {
  display: block;
  margin-top: 8px;
  padding: 12px;
  border-radius: 6px;
  background: #050b14;
  color: #c9d1d9;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  max-height: 150px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  border: 1px solid rgba(255,255,255,0.05);
}

/* Slide-Fade transition */
.slide-fade-enter-active, .slide-fade-leave-active {
  transition: all 0.3s ease;
}
.slide-fade-enter-from, .slide-fade-leave-to {
  transform: translateY(-10px);
  opacity: 0;
}

/* Stats Cards Grid */
.summary-cards-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}
.stat-card {
  border: 1px solid var(--color-border-default);
  background: var(--theme-panel-highlight), var(--color-bg-card);
  border-radius: 16px;
  box-shadow: var(--shadow-md), var(--theme-panel-glow);
  backdrop-filter: blur(12px);
  overflow: hidden;
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}
.stat-card:hover {
  transform: translateY(-2px);
  border-color: var(--color-border-highlight);
  box-shadow: var(--shadow-lg), 0 0 15px rgba(56, 189, 248, 0.08);
}
.stat-card-inner {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 18px 20px;
}
.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-size: 22px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
  transition: transform 0.3s ease;
}
.stat-card:hover .stat-icon {
  transform: scale(1.1) rotate(5deg);
}

/* Custom themed styles for stat cards */
.stat-card.total {
  border-left: 4px solid var(--color-brand-primary);
}
.stat-card.total .stat-icon {
  background: rgba(55, 200, 255, 0.08);
  border-color: rgba(55, 200, 255, 0.2);
}
.stat-card.occupied.active {
  border-left: 4px solid var(--color-status-info);
}
.stat-card.occupied.active .stat-icon {
  background: rgba(96, 165, 250, 0.08);
  border-color: rgba(96, 165, 250, 0.2);
}
.stat-card.damaged.warning {
  border-left: 4px solid var(--color-status-danger);
}
.stat-card.damaged.warning .stat-icon {
  background: rgba(248, 113, 113, 0.08);
  border-color: rgba(248, 113, 113, 0.2);
}
.stat-card.moving.active {
  border-left: 4px solid var(--color-status-success);
}
.stat-card.moving.active .stat-icon {
  background: rgba(52, 211, 153, 0.08);
  border-color: rgba(52, 211, 153, 0.2);
}

.stat-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.stat-info .lbl {
  font-size: 12px;
  color: var(--color-text-muted);
  font-weight: 600;
}
.stat-info .val {
  font-size: 26px;
  font-weight: 800;
  color: var(--color-text-primary);
  line-height: 1.2;
  margin: 2px 0;
}
.stat-info .sub {
  font-size: 11px;
  color: var(--color-text-disabled);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Vehicles List Card & Toolbar */
.list-panel {
  background: var(--theme-panel-highlight), var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  box-shadow: var(--shadow-lg), var(--theme-panel-glow);
  border-radius: 16px;
}
.toolbar-wrapper {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border-soft);
  background: rgba(11, 22, 37, 0.4);
  flex-wrap: wrap;
}

/* Search input styling */
.search-box {
  position: relative;
  min-width: 260px;
  flex-grow: 1;
}
.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 14px;
  color: var(--color-text-muted);
  pointer-events: none;
}
.search-box input {
  width: 100%;
  padding: 8px 12px 8px 36px;
  border-radius: 10px;
  border: 1px solid var(--color-border-default);
  background: rgba(6, 9, 15, 0.6);
  color: var(--color-text-primary);
  font-size: 13px;
  transition: all 0.2s ease;
}
.search-box input:focus {
  border-color: var(--color-border-highlight);
  background: rgba(6, 9, 15, 0.85);
  box-shadow: var(--theme-field-glow);
  outline: none;
}

/* Faction Filter buttons */
.filter-group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.filter-lbl {
  font-size: 12px;
  color: var(--color-text-secondary);
  font-weight: 500;
}
.team-switch {
  display: inline-flex;
  background: rgba(6, 9, 15, 0.6);
  border: 1px solid var(--color-border-default);
  padding: 3px;
  border-radius: 10px;
  gap: 2px;
}
.team-btn {
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  padding: 5px 12px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: none;
}
.team-btn:hover {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.03);
  transform: none;
}
.team-btn.active {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  box-shadow: var(--shadow-sm);
}

/* Customized specific active styles for faction buttons */
.team-btn.active.btn-team1 {
  background: rgba(59, 130, 246, 0.2);
  color: #93c5fd;
  border: 1px solid rgba(59, 130, 246, 0.3);
}
.team-btn.active.btn-team2 {
  background: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
  border: 1px solid rgba(239, 68, 68, 0.3);
}
.team-btn.active.btn-neutral {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text-primary);
  border: 1px solid rgba(255, 255, 255, 0.15);
}

/* Custom Toggle Switch styling */
.toggle-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.toggle-switch input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.slider {
  position: relative;
  display: inline-block;
  width: 34px;
  height: 18px;
  background-color: rgba(255, 255, 255, 0.1);
  border: 1px solid var(--color-border-default);
  border-radius: 99px;
  transition: all 0.3s ease;
}
.slider:before {
  position: absolute;
  content: "";
  height: 12px;
  width: 12px;
  left: 2px;
  bottom: 2px;
  background-color: #90a1b2;
  border-radius: 50%;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.toggle-switch input:checked + .slider {
  background-color: rgba(56, 189, 248, 0.2);
  border-color: var(--color-brand-primary);
}
.toggle-switch input:checked + .slider:before {
  transform: translateX(16px);
  background-color: var(--color-brand-primary);
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.6);
}
.label-text {
  font-size: 12px;
  color: var(--color-text-secondary);
  font-weight: 500;
}

/* Time Indicator */
.updated-time {
  margin-left: auto;
  font-size: 12px;
  color: var(--color-text-muted);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.03);
}
.time-icon {
  font-size: 13px;
}

/* Table styling */
.table-wrap {
  overflow-x: auto;
  max-height: calc(100vh - 320px);
}
.vehicles-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  text-align: left;
}
.vehicles-table th {
  position: sticky;
  top: 0;
  z-index: 10;
  padding: 12px 16px;
  color: var(--color-text-muted);
  background: rgba(15, 23, 34, 0.95);
  border-bottom: 2px solid var(--color-border-default);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.vehicle-row {
  border-bottom: 1px solid var(--color-border-soft);
  transition: background-color 0.15s ease;
}
.vehicle-row:hover {
  background: rgba(255, 255, 255, 0.02);
}
.vehicle-row td {
  padding: 12px 16px;
  vertical-align: middle;
  white-space: nowrap;
}

/* Fixed column widths for layout grid preservation */
.w-index { width: 50px; }
.w-team { width: 100px; }
.w-type { width: 220px; }
.w-health { width: 150px; }
.w-speed { width: 100px; }
.w-driver { width: 150px; }
.w-pos { width: 220px; }
.w-status { width: 100px; }

/* Cell Content Custom Styling */
.mono {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}
.font-semibold {
  font-weight: 600;
}
.text-center {
  text-align: center;
}
.text-muted {
  color: var(--color-text-muted);
}
.vehicle-type-text {
  font-weight: 700;
  color: var(--color-text-primary);
  font-size: 13.5px;
}

/* Faction Badges */
.team-badge {
  display: inline-flex;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.team-badge.team-0 {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-secondary);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.team-badge.team-1 {
  background: rgba(59, 130, 246, 0.12);
  color: #60a5fa;
  border: 1px solid rgba(59, 130, 246, 0.2);
}
.team-badge.team-2 {
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

/* Health Bar Columns */
.health-container {
  display: flex;
  align-items: center;
  gap: 10px;
}
.health-bar-track {
  width: 72px;
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.03);
}
.health-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}
.health-bar-fill.healthy {
  background: linear-gradient(90deg, #10b981, #34d399);
  box-shadow: 0 0 6px rgba(52, 211, 153, 0.3);
}
.health-bar-fill.warning {
  background: linear-gradient(90deg, #d97706, #fbbf24);
}
.health-bar-fill.danger {
  background: linear-gradient(90deg, #dc2626, #f87171);
  box-shadow: 0 0 6px rgba(248, 113, 113, 0.3);
}
.health-bar-fill.unknown {
  background: #6b7280;
}
.health-val {
  font-size: 12px;
  font-weight: 700;
  min-width: 44px;
}
.health-val.healthy { color: var(--color-status-success); }
.health-val.warning { color: var(--color-status-warning); }
.health-val.danger { color: var(--color-status-error); }
.health-val.unknown { color: var(--color-text-disabled); }

/* Driver Tags */
.driver-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(55, 200, 255, 0.08);
  border: 1px solid rgba(55, 200, 255, 0.2);
  color: #7dd3fc;
  font-size: 11.5px;
  font-weight: 600;
}
.driver-icon {
  font-size: 12px;
}
.driver-empty {
  color: var(--color-text-disabled);
  font-style: italic;
  font-size: 12px;
}

/* Position cell spacing format */
.position-cell {
  color: var(--color-text-secondary);
  font-size: 12px;
  letter-spacing: 0.02em;
}

/* Status occupied / empty column */
.status-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-text-muted);
}
.status-indicator .status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-disabled);
  border: 1px solid rgba(255,255,255,0.05);
}
.status-indicator.occupied {
  color: var(--color-status-success);
}
.status-indicator.occupied .status-dot {
  background: var(--color-status-success);
  box-shadow: 0 0 6px var(--color-status-success);
}

/* Empty Table state */
.empty-cell {
  padding: 0 !important;
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
}
.empty-icon {
  font-size: 32px;
  margin-bottom: 12px;
}
.empty-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 6px;
}
.empty-desc {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 0;
}

/* Responsive adjustments */
@media (max-width: 1024px) {
  .summary-cards-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 768px) {
  .page-head {
    flex-direction: column;
    align-items: stretch;
  }
  .actions {
    justify-content: space-between;
    margin-top: 12px;
  }
  .summary-cards-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .debug-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .toolbar-wrapper {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
  .search-box {
    min-width: 100%;
  }
  .filter-group {
    justify-content: space-between;
  }
  .updated-time {
    margin-left: 0;
    justify-content: center;
  }
}
</style>
