<template>
  <section class="bzss-page">
    <header class="page-hero">
      <div>
        <h1>BZSS-Core 玩家快照</h1>
        <p>这里展示日志驱动的实时解析结果。`playerIndex` 是对准玩家的唯一标准，页面优先显示它。</p>
      </div>
      <div class="hero-actions">
        <button type="button" class="refresh-btn" :disabled="loading" @click="fetchData">
          {{ loading ? "刷新中..." : "立即刷新" }}
        </button>
      </div>
    </header>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <section class="status-grid">
      <article class="status-card">
        <span class="status-label">状态</span>
        <strong :data-status="payload?.status || 'idle'" class="status-value">{{ statusLabel }}</strong>
        <small>{{ statusDetail }}</small>
      </article>
      <article class="status-card">
        <span class="status-label">玩家数</span>
        <strong class="status-value">{{ players.length }}</strong>
        <small>{{ payload?.state?.sourceMode || "log" }}</small>
      </article>
      <article class="status-card">
        <span class="status-label">最新更新</span>
        <strong class="status-value">{{ formatDateTime(payload?.state?.updatedAt) }}</strong>
        <small>{{ payload?.state?.lastRawLineHash ? `hash ${payload.state.lastRawLineHash.slice(0, 8)}` : "--" }}</small>
      </article>
      <article class="status-card">
        <span class="status-label">原始长度</span>
        <strong class="status-value">{{ payload?.state?.rawTextLength ?? 0 }}</strong>
        <small>{{ payload?.state?.markerSeen ? "已见 BZSS-Marked" : "未见标记" }}</small>
      </article>
    </section>

    <section class="toolbar">
      <input
        v-model.trim="query"
        class="search-input"
        type="text"
        placeholder="搜索玩家名 / GUID / 武器 / 兵种"
      />
      <label class="toggle">
        <input v-model="showRaw" type="checkbox" />
        <span>显示原始块</span>
      </label>
    </section>

    <section class="raw-data-panel">
      <header class="raw-data-head">
        <div>
          <h2>日志原始数据</h2>
          <p>{{ rawDataStatusLabel }}</p>
        </div>
        <button type="button" class="raw-refresh-btn" :disabled="rawLoading" @click="fetchRawData">
          {{ rawLoading ? "读取中..." : "读取原始数据" }}
        </button>
      </header>
      <div v-if="rawError" class="raw-error">{{ rawError }}</div>
      <div class="raw-data-meta">
        <span>来源：{{ rawData?.sourceMode || payload?.state?.sourceMode || "log" }}</span>
        <span>长度：{{ rawData?.rawTextLength ?? payload?.state?.rawTextLength ?? 0 }}</span>
        <span>标记：{{ rawData?.markerSeen ? "已见 BZSS-Marked" : "未见标记" }}</span>
      </div>
      <pre class="raw-data-block">{{ rawDataText }}</pre>
    </section>

    <section v-if="filteredPlayers.length > 0" class="player-list">
      <article v-for="player in filteredPlayers" :key="player.playerGuid || `${player.playerIndex ?? player.playerId ?? player.playerName}`" class="player-card">
        <header class="player-head">
          <div>
            <h2>{{ player.playerName || "Unknown" }}</h2>
            <p class="mono">{{ player.playerGuid || "--" }}</p>
          </div>
          <div class="head-badges">
            <span class="badge badge--primary">IDX {{ player.playerIndex ?? "--" }}</span>
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
            <span>弹药</span>
            <strong class="mono">{{ formatNumberList(player.soldierInfo?.ammoValues ?? []) }}</strong>
          </div>
          <div class="field">
            <span>战绩</span>
            <strong class="mono">{{ formatScoreboardSummary(player) }}</strong>
          </div>
          <div class="field">
            <span>载具</span>
            <strong class="mono">{{ formatVehicleInfo(player) }}</strong>
          </div>
          <div class="field">
            <span>坐席</span>
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
          <div v-for="item in getScoreboardItems(player)" :key="item.key" class="scoreboard-item">
            <span>{{ item.label }}</span>
            <strong>{{ item.value ?? "--" }}</strong>
          </div>
        </div>

        <details v-if="showRaw" class="raw-wrap">
          <summary>查看原始块</summary>
          <pre>{{ player.rawText }}</pre>
        </details>
      </article>
    </section>

    <section v-else class="empty-state">
      <strong>当前没有可显示的玩家数据。</strong>
      <p>页面依赖 BZSS-Core 日志流；收到 `PlayerBaseInfo` 或 `PlayerScoreboard` 后会自动更新。</p>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from "vue";
import {
  fetchBzssCorePlayerInfoList,
  fetchBzssCoreRawData,
  streamBzssCorePlayerInfoList,
  type BzssCorePlayerInfoResponse,
  type BzssCoreRawDataResponse,
  type BzssCoreTrackedPlayerInfo,
} from "../app/bzssCoreApi";
import { canAutoRefreshNow } from "../composables/useAutoRefreshGate";

const payload = ref<BzssCorePlayerInfoResponse | null>(null);
const rawData = ref<BzssCoreRawDataResponse | null>(null);
const loading = ref(false);
const rawLoading = ref(false);
const error = ref("");
const rawError = ref("");
const query = ref("");
const showRaw = ref(false);
const active = ref(true);
const isStreaming = ref(false);

let refreshTimer: number | null = null;
let closeStream: (() => void) | null = null;

const players = computed(() => payload.value?.players ?? []);
const filteredPlayers = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return players.value;
  return players.value.filter((player) => {
    return [
      player.playerName,
      player.playerGuid,
      player.soldierInfo?.soldierClass,
      player.soldierInfo?.weaponClass,
      String(player.playerIndex ?? ""),
    ].some((value) => String(value ?? "").toLowerCase().includes(needle));
  });
});

const rawDataText = computed(() => {
  const text = rawData.value?.rawText ?? "";
  if (text) return text;
  if (rawLoading.value) return "正在读取日志原始数据...";
  return "暂无可显示的日志原始数据。";
});

const rawDataStatusLabel = computed(() => {
  const data = rawData.value;
  if (!data) return "直接显示日志解析到的 PlayerBaseInfo / SoldierInfo / PlayerScoreboard 原始块。";
  if (data.lastError) return data.lastError;
  if (!data.rawText) return "日志里还没有可展示的原始块。";
  return `最后更新 ${formatDateTime(data.updatedAt)}，共 ${data.playerCount} 名玩家。`;
});

const statusLabel = computed(() => {
  const status = String(payload.value?.status ?? "").trim();
  if (status === "ready") return "已解析";
  if (status === "error") return "解析失败";
  if (status === "unavailable") return "不可用";
  return "空闲";
});

const statusDetail = computed(() => {
  const state = payload.value?.state;
  if (!state) return "--";
  if (state.lastError) return state.lastError;
  if (state.updatedAt) return `最后更新 ${formatDateTime(state.updatedAt)}`;
  return "--";
});

async function fetchData() {
  if (!active.value) return;
  loading.value = true;
  error.value = "";
  try {
    payload.value = await fetchBzssCorePlayerInfoList();
    recordStreamTick();
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
    rawError.value = err?.message ?? "读取日志原始数据失败。";
  } finally {
    rawLoading.value = false;
  }
}

function scheduleRefresh() {
  clearRefresh();
  refreshTimer = window.setTimeout(async () => {
    if (active.value && canAutoRefreshNow() && !closeStream) {
      await fetchData();
    }
    scheduleRefresh();
  }, closeStream ? 1000 : 150);
}

function clearRefresh() {
  if (refreshTimer != null) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function startStream() {
  if (closeStream || typeof EventSource === "undefined") return;
  isStreaming.value = true;
  closeStream = streamBzssCorePlayerInfoList(
    (data) => {
      if (!active.value) return;
      payload.value = data;
      error.value = "";
      loading.value = false;
      recordStreamTick();
    },
    (_err, source) => {
      if (!active.value) return;
      if (source.readyState === EventSource.CLOSED) {
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

function recordStreamTick() {
  // 只需要保留一个轻量的流状态信号，避免引入额外的历史数据结构。
  void isStreaming.value;
}

function formatDateTime(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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
  if (!stats) {
    return formatNumberList((player.playerScoreboard?.numericValues ?? []).filter((value): value is number => value != null));
  }
  return `K ${stats.numKills ?? "--"} / D ${stats.numDeaths ?? "--"} / W ${stats.numWoundeds ?? "--"} / C ${stats.combatScore ?? "--"}`;
}

function formatVehicleInfo(player: BzssCoreTrackedPlayerInfo) {
  const info = player.vehicleInfo;
  if (!info?.vehicleType) return "--";
  return info.healthText ? `${info.vehicleType} ${info.healthText}` : info.vehicleType;
}

function formatSeatsPlayers(player: BzssCoreTrackedPlayerInfo) {
  const seats = player.seatsPlayers ?? [];
  return seats.length > 0 ? seats.join(" / ") : "--";
}

function formatVector(vector: BzssCoreTrackedPlayerInfo["soldierInfo"]["position"]) {
  if (!vector) return "--";
  return `X=${vector.x ?? "?"}  Y=${vector.y ?? "?"}  Z=${vector.z ?? "?"}`;
}

onMounted(async () => {
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
});

onBeforeUnmount(() => {
  active.value = false;
  stopStream();
  clearRefresh();
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

.refresh-btn,
.raw-refresh-btn {
  border: 0;
  border-radius: 999px;
  padding: 10px 16px;
  font-weight: 700;
  color: #08111f;
  background: linear-gradient(135deg, #38bdf8, #86efac);
  cursor: pointer;
}

.refresh-btn:disabled,
.raw-refresh-btn:disabled {
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

.status-value[data-status="error"] {
  color: #fca5a5;
}

.status-card small {
  color: #94a3b8;
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
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.12);
  color: #dbeafe;
  font-size: 12px;
  font-weight: 700;
}

.badge--primary {
  background: rgba(34, 197, 94, 0.18);
  color: #bbf7d0;
}

.badge.admin {
  background: rgba(249, 115, 22, 0.16);
  color: #fed7aa;
}

.badge.commander {
  background: rgba(168, 85, 247, 0.16);
  color: #e9d5ff;
}

.badge.health {
  background: rgba(244, 114, 182, 0.16);
  color: #fbcfe8;
}

.player-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.field,
.scoreboard-item {
  min-width: 0;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  background: rgba(15, 23, 42, 0.56);
}

.field--wide {
  grid-column: span 2;
}

.field span,
.scoreboard-item span {
  display: block;
  margin-bottom: 4px;
  color: #94a3b8;
  font-size: 12px;
}

.field strong,
.scoreboard-item strong {
  display: block;
  min-width: 0;
  overflow-wrap: anywhere;
  color: #f8fafc;
}

.scoreboard-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.raw-wrap {
  margin-top: 12px;
}

.raw-wrap summary {
  cursor: pointer;
  color: #cbd5e1;
}

.raw-wrap pre {
  margin: 10px 0 0;
  padding: 12px;
  overflow: auto;
  border-radius: 12px;
  background: rgba(2, 6, 23, 0.9);
  color: #cbd5e1;
  white-space: pre-wrap;
  word-break: break-word;
}

.empty-state {
  padding: 20px;
  border-radius: 16px;
  border: 1px dashed rgba(148, 163, 184, 0.22);
  color: #cbd5e1;
  background: rgba(15, 23, 42, 0.4);
}

.empty-state strong {
  display: block;
  margin-bottom: 6px;
  color: #f8fafc;
}

.empty-state p {
  margin: 0;
  color: #94a3b8;
}

@media (max-width: 1200px) {
  .status-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .bzss-page {
    padding: 18px;
  }

  .page-hero,
  .raw-data-head,
  .player-head,
  .toolbar {
    flex-direction: column;
  }

  .player-grid,
  .scoreboard-grid {
    grid-template-columns: 1fr;
  }

  .field--wide {
    grid-column: auto;
  }
}
</style>
