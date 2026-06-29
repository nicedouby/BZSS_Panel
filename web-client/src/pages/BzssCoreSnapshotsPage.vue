<template>
  <section class="bzss-page">
    <header class="page-hero">
      <div>
        <h1>BZSS-Core Snapshots</h1>
        <p>页面只看 runtimePlayers、scoreboardPlayers 和 scene 原始块，并以 playerIndex 关联。</p>
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
        <span class="status-label">Runtime</span>
        <strong class="status-value">{{ runtimePlayers.length }}</strong>
        <small>playerIndex {{ payload?.state?.runtimePlayerCount ?? 0 }}</small>
      </article>
      <article class="status-card">
        <span class="status-label">Scoreboard</span>
        <strong class="status-value">{{ scoreboardPlayers.length }}</strong>
        <small>playerIndex {{ payload?.state?.scoreboardPlayerCount ?? 0 }}</small>
      </article>
      <article class="status-card">
        <span class="status-label">Scene</span>
        <strong class="status-value">{{ (payload?.captureZones?.length ?? 0) + (payload?.fobs?.length ?? 0) + (payload?.mainZones?.length ?? 0) }}</strong>
        <small>{{ payload?.state?.mainZoneCount ?? 0 }} MainZone</small>
      </article>
    </section>

    <section class="toolbar">
      <input
        v-model.trim="query"
        class="search-input"
        type="text"
        placeholder="搜索 playerIndex / playerId / combatInfo"
      />
      <label class="toggle">
        <input v-model="showRaw" type="checkbox" />
        <span>显示 JSON</span>
      </label>
    </section>

    <section class="raw-data-panel">
      <header class="raw-data-head">
        <div>
          <h2>原始块</h2>
          <p>{{ rawDataStatusLabel }}</p>
        </div>
        <button type="button" class="raw-refresh-btn" :disabled="rawLoading" @click="fetchRawData">
          {{ rawLoading ? "读取中..." : "读取原始块" }}
        </button>
      </header>
      <div v-if="rawError" class="raw-error">{{ rawError }}</div>
      <div class="raw-data-meta">
        <span>Runtime: {{ rawData?.runtimePlayerCount ?? 0 }}</span>
        <span>Scoreboard: {{ rawData?.scoreboardPlayerCount ?? 0 }}</span>
        <span>Scene: {{ rawData?.mainZoneCount ?? 0 }}</span>
      </div>
      <div class="raw-blocks">
        <pre class="raw-data-block">{{ runtimeRawBlock }}</pre>
        <pre class="raw-data-block">{{ scoreboardRawBlock }}</pre>
        <pre class="raw-data-block">{{ sceneRawBlock }}</pre>
      </div>
    </section>

    <section v-if="filteredPairs.length > 0" class="player-list">
      <article v-for="pair in filteredPairs" :key="pair.playerIndex" class="player-card">
        <header class="player-head">
          <div>
            <h2>Player {{ pair.playerIndex }}</h2>
            <p class="mono">playerId {{ pair.runtime?.playerId ?? pair.scoreboard?.playerId ?? "--" }}</p>
          </div>
          <div class="head-badges">
            <span class="badge badge--primary">IDX {{ pair.playerIndex }}</span>
            <span class="badge">Yaw {{ pair.runtime?.yaw ?? "--" }}</span>
            <span class="badge">T{{ pair.scoreboard?.teamId ?? "--" }}</span>
            <span class="badge">S{{ pair.scoreboard?.squadId ?? "--" }}</span>
            <span class="badge" :data-tone="pair.runtime?.stale ? 'warning' : 'success'">
              {{ pair.runtime?.stale ? "stale" : "live" }}
            </span>
          </div>
        </header>

        <div class="player-grid">
          <div class="field">
            <span>Position</span>
            <strong class="mono">{{ formatVector(pair.runtime?.position) }}</strong>
          </div>
          <div class="field">
            <span>Combat</span>
            <strong class="mono">{{ pair.runtime?.combatInfo || "--" }}</strong>
          </div>
          <div class="field">
            <span>ObservedAt</span>
            <strong class="mono">{{ formatDateTime(pair.runtime?.observedAt) }}</strong>
          </div>
          <div class="field field--wide">
            <span>playerIndex</span>
            <strong class="mono">{{ pair.playerIndex }}</strong>
          </div>
        </div>

        <div class="scoreboard-grid">
          <div v-for="item in getScoreboardItems(pair.scoreboard)" :key="item.key" class="scoreboard-item">
            <span>{{ item.label }}</span>
            <strong>{{ item.value ?? "--" }}</strong>
          </div>
        </div>

        <details v-if="showRaw" class="raw-wrap">
          <summary>查看 JSON</summary>
          <pre>{{ pair.runtime ?? pair.scoreboard ?? {} }}</pre>
        </details>
      </article>
    </section>

    <section v-else class="empty-state">
      <strong>当前没有可显示的玩家数据。</strong>
      <p>页面只消费 runtime / scoreboard 原始块，并以 playerIndex 关联。</p>
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
  type BzssCoreRuntimePlayerInfo,
  type BzssCoreScoreboardPlayerInfo,
} from "../app/bzssCoreApi";
import { canAutoRefreshNow } from "../composables/useAutoRefreshGate";

type PlayerPair = {
  playerIndex: number | string;
  runtime: BzssCoreRuntimePlayerInfo | null;
  scoreboard: BzssCoreScoreboardPlayerInfo | null;
};

const payload = ref<BzssCorePlayerInfoResponse | null>(null);
const rawData = ref<BzssCoreRawDataResponse | null>(null);
const loading = ref(false);
const rawLoading = ref(false);
const error = ref("");
const rawError = ref("");
const query = ref("");
const showRaw = ref(false);
const active = ref(true);

let refreshTimer: number | null = null;
let closeStream: (() => void) | null = null;

const runtimePlayers = computed(() => payload.value?.runtimePlayers ?? []);
const scoreboardPlayers = computed(() => payload.value?.scoreboardPlayers ?? []);

const playerPairs = computed<PlayerPair[]>(() => {
  const map = new Map<string, PlayerPair>();
  const addPlayer = (player: BzssCoreRuntimePlayerInfo | BzssCoreScoreboardPlayerInfo | undefined, side: "runtime" | "scoreboard") => {
    if (!player) return;
    const key = String(player.playerIndex ?? player.playerId ?? "");
    if (!key) return;
    const current = map.get(key) ?? { playerIndex: player.playerIndex ?? player.playerId ?? key, runtime: null, scoreboard: null };
    if (side === "runtime") current.runtime = player as BzssCoreRuntimePlayerInfo;
    if (side === "scoreboard") current.scoreboard = player as BzssCoreScoreboardPlayerInfo;
    map.set(key, current);
  };
  runtimePlayers.value.forEach((player) => addPlayer(player, "runtime"));
  scoreboardPlayers.value.forEach((player) => addPlayer(player, "scoreboard"));
  return [...map.values()].sort((a, b) => Number(a.playerIndex) - Number(b.playerIndex));
});

const filteredPairs = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return playerPairs.value;
  return playerPairs.value.filter((pair) => {
    const values = [
      pair.playerIndex,
      pair.runtime?.playerId,
      pair.runtime?.combatInfo,
      pair.scoreboard?.playerId,
      pair.scoreboard?.teamId,
      pair.scoreboard?.squadId,
    ];
    return values.some((value) => String(value ?? "").toLowerCase().includes(needle));
  });
});

const runtimeRawBlock = computed(() => JSON.stringify(runtimePlayers.value, null, 2));
const scoreboardRawBlock = computed(() => JSON.stringify(scoreboardPlayers.value, null, 2));
const sceneRawBlock = computed(() => JSON.stringify({
  captureZones: payload.value?.captureZones ?? [],
  fobs: payload.value?.fobs ?? [],
  mainZones: payload.value?.mainZones ?? [],
}, null, 2));

const rawDataStatusLabel = computed(() => {
  const data = rawData.value;
  if (!data) return "直接显示 runtime / scoreboard / scene 原始块。";
  if (data.lastError) return data.lastError;
  return `更新于 ${formatDateTime(data.updatedAt)}，runtime ${data.runtimePlayerCount} / scoreboard ${data.scoreboardPlayerCount}`;
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
  } catch (err: any) {
    error.value = err?.message ?? "加载 BZSS-Core 快照失败。";
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
    rawError.value = err?.message ?? "读取原始块失败。";
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
  closeStream = streamBzssCorePlayerInfoList(
    (data) => {
      if (!active.value) return;
      payload.value = data;
      error.value = "";
      loading.value = false;
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
}

function formatDateTime(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatVector(value?: BzssCoreRuntimePlayerInfo["position"]) {
  if (!value) return "--";
  const x = value.x ?? "--";
  const y = value.y ?? "--";
  const z = value.z ?? "--";
  return `X=${x} Y=${y} Z=${z}`;
}

function getScoreboardItems(player?: BzssCoreScoreboardPlayerInfo | null) {
  const values: Array<[string, string, number | null | undefined]> = [
    ["lives", "Lives", player?.lives],
    ["kills", "Kills", player?.kills],
    ["vehicleKills", "Vehicle kills", player?.vehicleKills],
    ["deaths", "Deaths", player?.deaths],
    ["woundeds", "Woundeds", player?.woundeds],
    ["wounds", "Wounds", player?.wounds],
    ["teamKills", "Team kills", player?.teamKills],
    ["healPoints", "Heal points", player?.healPoints],
    ["revivedPoints", "Revived points", player?.revivedPoints],
    ["teamworkScore", "Teamwork", player?.teamworkScore],
    ["objectiveScore", "Objective", player?.objectiveScore],
    ["combatScore", "Combat", player?.combatScore],
  ];
  return values.map(([key, label, value]) => ({ key, label, value }));
}

onMounted(async () => {
  await fetchData();
  await fetchRawData();
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
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}

.page-hero,
.status-grid,
.toolbar,
.raw-data-panel,
.player-list,
.empty-state {
  min-width: 0;
}

.page-hero,
.raw-data-head,
.player-head,
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.status-card,
.player-card,
.raw-data-panel,
.empty-state {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(12, 16, 24, 0.88);
}

.status-card {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.status-label,
.field span,
.scoreboard-item span {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
}

.status-value {
  font-size: 20px;
  font-weight: 700;
}

.toolbar {
  flex-wrap: wrap;
}

.search-input {
  flex: 1 1 280px;
  min-width: 240px;
}

.raw-data-panel {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.raw-data-meta,
.head-badges,
.scoreboard-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.raw-blocks {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.raw-data-block {
  margin: 0;
  padding: 12px;
  min-height: 180px;
  overflow: auto;
  background: rgba(0, 0, 0, 0.22);
  border-radius: 8px;
  font-size: 12px;
}

.player-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.player-card {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.player-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field--wide {
  grid-column: 1 / -1;
}

.scoreboard-item {
  min-width: 120px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.badge {
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 12px;
}

.badge--primary {
  background: rgba(88, 161, 255, 0.2);
}

.raw-wrap summary {
  cursor: pointer;
}

.raw-wrap pre {
  margin: 8px 0 0;
  padding: 12px;
  overflow: auto;
  background: rgba(0, 0, 0, 0.22);
  border-radius: 8px;
}

.empty-state {
  padding: 20px;
}

@media (max-width: 1200px) {
  .status-grid,
  .raw-blocks,
  .player-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .status-grid,
  .raw-blocks,
  .player-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
