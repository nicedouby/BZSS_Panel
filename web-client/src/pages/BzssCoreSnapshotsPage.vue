<template>
  <section class="bzss-page">
    <aside class="sample-debug-window" aria-label="样本采样率调试窗口">
      <span class="sample-debug-title">样本采样率</span>
      <strong class="sample-debug-rate">{{ sampleRateLabel }}</strong>
      <div class="sample-debug-meta">
        <span>{{ streamLabel }}</span>
        <span>{{ sampleCountLabel }}</span>
        <span>{{ lastSampleLabel }}</span>
      </div>
    </aside>
    <header class="page-hero">
      <div>
        <h1>BZSS-Core 玩家快照</h1>
        <p>这里展示 `PBI.sav` 当前监控状态，以及本轮在 `BZSS-Marked` 后完成解析的全部玩家数据。</p>
      </div>
      <div class="hero-actions">
        <button type="button" class="refresh-btn" :disabled="loading" @click="fetchData">
          {{ loading ? "刷新中..." : "立即刷新" }}
        </button>
      </div>
    </header>

    <div v-if="error" class="error-banner">
      {{ error }}
    </div>

    <section class="status-grid">
      <article class="status-card">
        <span class="status-label">状态</span>
        <strong :data-status="payload?.status || 'idle'" class="status-value">{{ statusLabel }}</strong>
        <small>{{ statusDetail }}</small>
      </article>
      <article class="status-card">
        <span class="status-label">已解析玩家</span>
        <strong class="status-value">{{ players.length }}</strong>
        <small>仅统计本轮完整写入后数据</small>
      </article>
      <article class="status-card">
        <span class="status-label">文件大小</span>
        <strong class="status-value">{{ formatBytes(payload?.state?.fileSize ?? 0) }}</strong>
        <small>{{ formatDateTime(payload?.state?.lastReadAt) }}</small>
      </article>
      <article class="status-card status-card--wide">
        <span class="status-label">监控文件</span>
        <strong class="status-value status-path">{{ payload?.state?.resolvedPath || "--" }}</strong>
        <small>Configured: {{ payload?.state?.configuredPath || "--" }}</small>
      </article>
    </section>

    <section class="toolbar">
      <input
        v-model.trim="query"
        class="search-input"
        type="text"
        placeholder="搜索玩家名 / GUID / 兵种 / 武器"
      />
      <label class="toggle">
        <input v-model="showRaw" type="checkbox" />
        <span>显示原始块</span>
      </label>
    </section>

    <section class="raw-data-panel">
      <header class="raw-data-head">
        <div>
          <h2>PBI.sav 原始数据</h2>
          <p>{{ rawDataStatusLabel }}</p>
        </div>
        <button type="button" class="raw-refresh-btn" :disabled="rawLoading" @click="fetchRawData">
          {{ rawLoading ? "读取中..." : "读取原始数据" }}
        </button>
      </header>
      <div v-if="rawError" class="raw-error">{{ rawError }}</div>
      <div class="raw-data-meta">
        <span>路径：{{ rawData?.resolvedPath || payload?.state?.resolvedPath || "--" }}</span>
        <span>字符：{{ rawData?.rawTextLength ?? payload?.state?.rawTextLength ?? 0 }}</span>
        <span>标记：{{ rawData?.markerSeen ? "已看到 BZSS-Marked" : "未完成 / 未看到" }}</span>
      </div>
      <pre class="raw-data-block">{{ rawDataText }}</pre>
    </section>

    <section v-if="filteredPlayers.length > 0" class="player-list">
      <article v-for="player in filteredPlayers" :key="player.playerGuid || player.playerName" class="player-card">
        <header class="player-head">
          <div>
            <h2>{{ player.playerName || "Unknown" }}</h2>
            <p class="mono">{{ player.playerGuid || "--" }}</p>
          </div>
          <div class="head-badges">
            <span class="badge">ID {{ player.playerId ?? "--" }}</span>
            <span class="badge">T{{ player.teamId ?? "--" }}</span>
            <span class="badge">S{{ player.squadId ?? "--" }}</span>
            <span class="badge">FT {{ player.ftIndex ?? "--" }} / {{ player.ftPosition ?? "--" }}</span>
            <span v-if="player.isAdmin" class="badge admin">Admin</span>
            <span v-if="player.isCommander" class="badge commander">CMD</span>
            <span class="badge health">HP {{ player.soldierInfo?.health ?? "--" }}</span>
          </div>
        </header>

        <div class="player-grid">
          <div class="field">
            <span>兵种</span>
            <strong class="mono">{{ player.soldierInfo?.soldierClass || "--" }}</strong>
          </div>
          <div class="field">
            <span>武器</span>
            <strong class="mono">{{ player.soldierInfo?.weaponClass || "--" }}</strong>
          </div>
          <div class="field">
            <span>弹药/数值</span>
            <strong class="mono">{{ formatNumberList(player.soldierInfo?.ammoValues ?? []) }}</strong>
          </div>
          <div class="field">
            <span>记分板</span>
            <strong class="mono">{{ formatScoreboardSummary(player) }}</strong>
          </div>
          <div class="field">
            <span>载具</span>
            <strong v-if="getVehicleIconInfo(player)" class="mono vehicle-summary">
              <template v-if="isVehicleIconImage(getVehicleIconInfo(player)?.icon)">
                <img
                  class="vehicle-summary-icon"
                  :src="getVehicleIconInfo(player)?.icon || ''"
                  :alt="formatVehicleInfo(player)"
                >
              </template>
              <span v-else class="vehicle-summary-fallback" aria-hidden="true">{{ getVehicleIconInfo(player)?.icon }}</span>
              <span>{{ formatVehicleInfo(player) }}</span>
            </strong>
            <strong v-else class="mono">--</strong>
          </div>
          <div class="field">
            <span>座位玩家</span>
            <strong class="mono">{{ formatSeatsPlayers(player) }}</strong>
          </div>
          <div class="field field--wide">
            <span>坐标</span>
            <strong class="mono">{{ formatVector(player.soldierInfo?.position) }}</strong>
          </div>
          <div class="field field--wide">
            <span>朝向</span>
            <strong class="mono">{{ formatVector(player.soldierInfo?.rotation) }}</strong>
          </div>
        </div>

        <div class="scoreboard-grid">
          <div
            v-for="item in getScoreboardItems(player)"
            :key="item.key"
            class="scoreboard-item"
          >
            <span>{{ item.label }}</span>
            <strong>{{ item.value ?? "--" }}</strong>
          </div>
        </div>

        <details v-if="showRaw" class="raw-wrap">
          <summary>查看原始解析块</summary>
          <pre>{{ player.rawText }}</pre>
        </details>
      </article>
    </section>

    <section v-else class="empty-state">
      <strong>当前还没有可展示的玩家数据。</strong>
      <p>如果服务端正在写文件，页面会在检测到 `BZSS-Marked` 后自动更新这一轮完整快照。</p>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from "vue";
import {
  fetchBzssCoreRawData,
  fetchBzssCorePlayerInfoList,
  streamBzssCorePlayerInfoList,
  type BzssCorePlayerInfoResponse,
  type BzssCoreRawDataResponse,
  type BzssCoreTrackedPlayerInfo,
} from "../app/bzssCoreApi";
import { canAutoRefreshNow } from "../composables/useAutoRefreshGate";
import { isVehicleIconImage, resolveVehicleIcon } from "../utils/vehicle-icons";

const payload = ref<BzssCorePlayerInfoResponse | null>(null);
const rawData = ref<BzssCoreRawDataResponse | null>(null);
const loading = ref(false);
const rawLoading = ref(false);
const error = ref("");
const rawError = ref("");
const query = ref("");
const showRaw = ref(false);
const active = ref(true);
const sampleClock = ref(Date.now());
const sampleEvents = ref<number[]>([]);
const isStreaming = ref(false);
let timer: number | null = null;
let closeStream: (() => void) | null = null;
let sampleClockTimer: number | null = null;

const players = computed(() => payload.value?.players ?? []);
const rawDataText = computed(() => {
  const text = rawData.value?.rawText ?? "";
  if (text) return text;
  if (rawLoading.value) return "正在读取 PBI.sav 原始数据...";
  return "暂无可显示的 PBI.sav 原始数据。";
});
const rawDataStatusLabel = computed(() => {
  const data = rawData.value;
  if (!data) return "直接显示从 PBI.sav 中提取到的 PlayerBaseInfo / SoldierInfo / PlayerScoreboard 原始块。";
  if (data.lastError) return data.lastError;
  if (!data.exists) return "PBI.sav 文件不存在或当前路径无法访问。";
  if (!data.rawText) return "已读取文件，但还没有找到可显示的 BZSS-Core 原始数据块。";
  return `最后读取 ${formatDateTime(data.rawTextUpdatedAt || data.lastReadAt)}，共 ${data.playerCount} 名玩家。`;
});
const recentSampleEvents = computed(() => {
  const now = sampleClock.value;
  return sampleEvents.value.filter((timestamp) => now - timestamp <= 1000);
});
const sampleRateLabel = computed(() => `${formatDecimal(recentSampleEvents.value.length)} / s`);
const sampleCountLabel = computed(() => `${recentSampleEvents.value.length} 次 / 1s`);
const lastSampleLabel = computed(() => {
  const last = sampleEvents.value[sampleEvents.value.length - 1];
  if (!last) return "暂无样本";
  const age = Math.max(0, sampleClock.value - last);
  if (age < 1000) return `${age} ms 前`;
  return `${formatDecimal(age / 1000)} s 前`;
});
const streamLabel = computed(() => (isStreaming.value ? "SSE 实时流" : "轮询兜底"));
const filteredPlayers = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return players.value;
  return players.value.filter((player) => {
    return [
      player.playerName,
      player.playerGuid,
      player.soldierInfo?.soldierClass,
      player.soldierInfo?.weaponClass,
    ].some((value) => String(value ?? "").toLowerCase().includes(needle));
  });
});

const statusLabel = computed(() => {
  const status = String(payload.value?.status ?? "").trim();
  if (status === "ready") return "已完成";
  if (status === "writing") return "写入中";
  if (status === "waiting") return "等待下一轮";
  if (status === "missing") return "文件不存在";
  if (status === "unconfigured") return "未配置路径";
  if (status === "error") return "读取失败";
  return "空闲";
});

const statusDetail = computed(() => {
  const state = payload.value?.state;
  if (!state) return "--";
  if (state.lastError) return state.lastError;
  if (state.lastCompletedAt) return `最后完成: ${formatDateTime(state.lastCompletedAt)}`;
  if (state.lastReadAt) return `最后读取: ${formatDateTime(state.lastReadAt)}`;
  return "--";
});

async function fetchData() {
  if (!active.value) return;
  loading.value = true;
  error.value = "";
  try {
    const [nextPayload] = await Promise.all([
      fetchBzssCorePlayerInfoList(),
      fetchRawData(),
    ]);
    payload.value = nextPayload;
    recordSample();
  } catch (err: any) {
    error.value = err?.message ?? "加载 BZSS-Core 玩家快照失败。";
  } finally {
    loading.value = false;
  }
}

async function fetchRawData() {
  rawLoading.value = true;
  rawError.value = "";
  try {
    rawData.value = await fetchBzssCoreRawData();
  } catch (err: any) {
    rawError.value = err?.message ?? "读取 PBI.sav 原始数据失败。";
  } finally {
    rawLoading.value = false;
  }
}

function scheduleRefresh() {
  clearRefresh();
  timer = window.setTimeout(async () => {
    if (active.value && canAutoRefreshNow() && !closeStream) {
      await fetchData();
    }
    scheduleRefresh();
  }, closeStream ? 1000 : 100);
}

function recordSample() {
  const now = Date.now();
  sampleEvents.value = [...sampleEvents.value, now]
    .filter((timestamp) => now - timestamp <= 5000)
    .slice(-120);
  sampleClock.value = now;
}

function clearRefresh() {
  if (timer != null) {
    window.clearTimeout(timer);
    timer = null;
  }
}

function startStream() {
  if (closeStream || typeof EventSource === "undefined") return;
  isStreaming.value = true;
  closeStream = streamBzssCorePlayerInfoList(
    (data) => {
      if (!active.value) return;
      payload.value = data;
      recordSample();
      error.value = "";
      loading.value = false;
    },
    (_err, source) => {
      if (!active.value) return;
      if (source.readyState === EventSource.CLOSED) {
        error.value = "BZSS-Core 实时连接中断，正在使用轮询兜底。";
        stopStream();
        scheduleRefresh();
      }
    },
  );
}

function stopStream() {
  if (!closeStream) return;
  closeStream();
  closeStream = null;
  isStreaming.value = false;
}

function formatDateTime(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDecimal(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function startSampleClock() {
  if (sampleClockTimer != null) return;
  sampleClockTimer = window.setInterval(() => {
    sampleClock.value = Date.now();
  }, 250);
}

function stopSampleClock() {
  if (sampleClockTimer != null) {
    window.clearInterval(sampleClockTimer);
    sampleClockTimer = null;
  }
}

function formatVector(vector: BzssCoreTrackedPlayerInfo["soldierInfo"]["position"]) {
  if (!vector) return "--";
  return `X=${vector.x ?? "?"}  Y=${vector.y ?? "?"}  Z=${vector.z ?? "?"}`;
}

function formatNumberList(values: number[]) {
  return values.length > 0 ? values.join(" / ") : "--";
}

function getScoreboardItems(player: BzssCoreTrackedPlayerInfo) {
  const labeled = player.playerScoreboard?.labeledValues ?? [];
  if (labeled.length > 0) return labeled;
  const labels = [
    ["dataLives", "Data lives"],
    ["numKills", "Num kills"],
    ["numDeaths", "Num death"],
    ["numWoundeds", "Num woundeds"],
    ["numWounds", "Num wounds"],
    ["numTeamKills", "Num TK"],
    ["healPoints", "Heal point"],
    ["revivedPoints", "Revived points"],
    ["teamworkScore", "Team work score"],
    ["objectiveScore", "Objective score"],
    ["combatScore", "Combat score"],
  ];
  const values = player.playerScoreboard?.numericValues ?? [];
  return labels.map(([key, label], index) => ({
    key,
    label,
    value: values[index] ?? null,
  }));
}

function formatScoreboardSummary(player: BzssCoreTrackedPlayerInfo) {
  const stats = player.playerScoreboard?.stats;
  if (!stats) return formatNumberList((player.playerScoreboard?.numericValues ?? []).filter((value) => value != null) as number[]);
  return `K ${stats.numKills ?? "--"} / D ${stats.numDeaths ?? "--"} / W ${stats.numWoundeds ?? "--"} / C ${stats.combatScore ?? "--"}`;
}

function formatVehicleInfo(player: BzssCoreTrackedPlayerInfo) {
  const info = player.vehicleInfo;
  if (!info?.vehicleType) return "--";
  return info.healthText ? `${info.vehicleType} ${info.healthText}` : info.vehicleType;
}

function getVehicleIconInfo(player: BzssCoreTrackedPlayerInfo) {
  const info = player.vehicleInfo;
  if (!info?.vehicleType || info.vehicleType === "None") return null;
  return resolveVehicleIcon(info.vehicleType);
}

function formatSeatsPlayers(player: BzssCoreTrackedPlayerInfo) {
  const seats = player.seatsPlayers ?? [];
  return seats.length > 0 ? seats.join(" / ") : "--";
}

onMounted(async () => {
  startSampleClock();
  await fetchData();
  startStream();
  scheduleRefresh();
});

onActivated(() => {
  active.value = true;
  startStream();
  scheduleRefresh();
});

onDeactivated(() => {
  active.value = false;
  stopStream();
  clearRefresh();
  stopSampleClock();
});

onBeforeUnmount(() => {
  active.value = false;
  stopStream();
  clearRefresh();
  stopSampleClock();
});
</script>

<style scoped>
.bzss-page {
  position: relative;
  height: 100%;
  min-height: 100%;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  padding: 24px 24px 24px 284px;
  background:
    radial-gradient(circle at top left, rgba(34, 197, 94, 0.12), transparent 26%),
    radial-gradient(circle at top right, rgba(14, 165, 233, 0.14), transparent 28%),
    linear-gradient(180deg, #08111f 0%, #0f172a 100%);
  color: #e2e8f0;
}

.sample-debug-window {
  position: fixed;
  top: 18px;
  left: 18px;
  z-index: 40;
  width: 232px;
  padding: 12px 12px 10px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 12px;
  background: rgba(2, 6, 23, 0.9);
  box-shadow: 0 18px 36px rgba(2, 6, 23, 0.32);
  backdrop-filter: blur(12px);
}

.sample-debug-title {
  display: block;
  margin-bottom: 6px;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #94a3b8;
}

.sample-debug-rate {
  display: block;
  font-size: 28px;
  line-height: 1;
  color: #86efac;
}

.sample-debug-meta {
  display: grid;
  gap: 4px;
  margin-top: 10px;
  font-size: 12px;
  color: #cbd5e1;
}

.page-hero {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 18px;
}

.page-hero h1 {
  margin: 0 0 6px;
  font-size: 30px;
  line-height: 1.1;
}

.page-hero p {
  margin: 0;
  max-width: 820px;
  color: #94a3b8;
}

.vehicle-summary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.vehicle-summary-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  object-fit: contain;
}

.vehicle-summary-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  font-size: 14px;
  line-height: 1;
}

.refresh-btn {
  border: 0;
  border-radius: 999px;
  padding: 10px 16px;
  font-weight: 700;
  color: #08111f;
  background: linear-gradient(135deg, #38bdf8, #86efac);
  cursor: pointer;
}

.refresh-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.error-banner {
  margin-bottom: 14px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(248, 113, 113, 0.35);
  background: rgba(127, 29, 29, 0.28);
  color: #fecaca;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.status-card {
  padding: 14px;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(15, 23, 42, 0.78);
  backdrop-filter: blur(10px);
}

.status-card--wide {
  grid-column: span 2;
}

.status-label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  color: #94a3b8;
}

.status-value {
  display: block;
  margin-bottom: 6px;
  font-size: 20px;
  color: #f8fafc;
}

.status-value[data-status="ready"] {
  color: #86efac;
}

.status-value[data-status="writing"] {
  color: #facc15;
}

.status-value[data-status="error"],
.status-value[data-status="missing"] {
  color: #fca5a5;
}

.status-card small {
  color: #94a3b8;
}

.status-path {
  font-size: 15px;
  word-break: break-all;
}

.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
}

.search-input {
  flex: 1;
  min-width: 0;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  padding: 12px 14px;
  background: rgba(15, 23, 42, 0.72);
  color: #e2e8f0;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #cbd5e1;
}

.raw-data-panel {
  margin-bottom: 16px;
  padding: 16px;
  border-radius: 16px;
  border: 1px solid rgba(125, 211, 252, 0.18);
  background: rgba(2, 6, 23, 0.72);
}

.raw-data-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 12px;
}

.raw-data-head h2 {
  margin: 0 0 4px;
  font-size: 18px;
}

.raw-data-head p {
  margin: 0;
  color: #94a3b8;
}

.raw-refresh-btn {
  flex: 0 0 auto;
  border: 1px solid rgba(125, 211, 252, 0.28);
  border-radius: 10px;
  padding: 9px 12px;
  font-weight: 700;
  color: #dff6ff;
  background: rgba(14, 165, 233, 0.16);
  cursor: pointer;
}

.raw-refresh-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.raw-error {
  margin-bottom: 10px;
  color: #fecaca;
}

.raw-data-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
  color: #cbd5e1;
  font-size: 12px;
}

.raw-data-meta span {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  padding: 5px 8px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.08);
}

.raw-data-block {
  max-height: 460px;
  margin: 0;
  padding: 12px;
  overflow: auto;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(2, 6, 23, 0.9);
  color: #d1fae5;
  font-family: "Consolas", "SFMono-Regular", monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.player-list {
  display: grid;
  gap: 14px;
}

.player-card {
  padding: 16px;
  border-radius: 18px;
  border: 1px solid rgba(56, 189, 248, 0.14);
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(2, 6, 23, 0.92));
  box-shadow: 0 18px 36px rgba(2, 6, 23, 0.22);
}

.player-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 14px;
}

.player-head h2 {
  margin: 0 0 4px;
  font-size: 22px;
}

.mono {
  font-family: "Consolas", "SFMono-Regular", monospace;
}

.head-badges {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.badge {
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.14);
  color: #bfdbfe;
  font-size: 12px;
  font-weight: 700;
}

.badge.health {
  background: rgba(34, 197, 94, 0.14);
  color: #bbf7d0;
}

.player-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.field {
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(148, 163, 184, 0.08);
}

.field--wide {
  grid-column: 1 / -1;
}

.field span {
  display: block;
  margin-bottom: 6px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #94a3b8;
}

.field strong {
  overflow-wrap: anywhere;
}

.scoreboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.scoreboard-item {
  min-width: 0;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.08);
  background: rgba(15, 23, 42, 0.48);
}

.scoreboard-item span {
  display: block;
  margin-bottom: 4px;
  color: #94a3b8;
  font-size: 11px;
}

.scoreboard-item strong {
  display: block;
  color: #e2e8f0;
  font-family: "Consolas", "SFMono-Regular", monospace;
  font-size: 15px;
  line-height: 1.1;
}

.raw-wrap {
  margin-top: 14px;
}

.raw-wrap summary {
  cursor: pointer;
  color: #7dd3fc;
}

.raw-wrap pre {
  margin: 10px 0 0;
  padding: 12px;
  border-radius: 12px;
  overflow: auto;
  background: rgba(2, 6, 23, 0.8);
  color: #a7f3d0;
  white-space: pre-wrap;
  word-break: break-word;
}

.empty-state {
  padding: 24px;
  border-radius: 18px;
  border: 1px dashed rgba(148, 163, 184, 0.28);
  background: rgba(15, 23, 42, 0.55);
  color: #cbd5e1;
}

.empty-state p {
  margin: 8px 0 0;
  color: #94a3b8;
}

@media (max-width: 1100px) {
  .status-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 780px) {
  .bzss-page {
    padding: 232px 16px 16px;
  }

  .sample-debug-window {
    top: 12px;
    left: 12px;
    right: 12px;
    width: auto;
  }

  .page-hero,
  .toolbar,
  .player-head {
    flex-direction: column;
  }

  .status-grid,
  .player-grid {
    grid-template-columns: 1fr;
  }

  .status-card--wide,
  .field--wide {
    grid-column: auto;
  }
}
</style>
