<template>
  <main class="tb-page">
    <section class="tb-card">
      <header class="tb-header">
        <div>
          <h1>跳边入口</h1>
          <p>统一执行 AdminForceTeamChange 的 Web 入口。</p>
        </div>
      </header>

      <form class="tb-form" @submit.prevent="submit">
        <label>
          <span>SteamID</span>
          <input v-model.trim="steamId" placeholder="7656119..." />
        </label>

        <label>
          <span>玩家名，可选</span>
          <div ref="playerPickerRoot" class="tb-player-picker">
            <input
              v-model.trim="playerName"
              placeholder="PlayerName"
              autocomplete="off"
              @focus="openPlayerPicker"
              @click="openPlayerPicker"
              @keydown.escape.prevent="closePlayerPicker"
            />

            <div v-if="showPlayerPicker" class="tb-player-dropdown" role="listbox" aria-label="当前在线玩家">
              <div v-if="loadingPlayers" class="tb-player-empty">加载中...</div>
              <div v-else-if="playersError" class="tb-player-empty">{{ playersError }}</div>
              <button
                v-for="(player, index) in filteredPlayers"
                :key="playerKey(player, index)"
                type="button"
                class="tb-player-option"
                role="option"
                @mousedown.prevent
                @click="pickPlayer(player)"
              >
                <span class="tb-player-option__name">{{ player.name || "未知玩家" }}</span>
                <span v-if="player.steamID" class="tb-player-option__meta">{{ player.steamID }}</span>
              </button>

              <div v-if="!filteredPlayers.length && !loadingPlayers && !playersError" class="tb-player-empty">
                暂无在线玩家
              </div>
            </div>
          </div>
        </label>

        <button :disabled="submitting || !steamId">
          {{ submitting ? "执行中..." : "执行跳边" }}
        </button>
      </form>

      <pre v-if="result" class="tb-result">{{ result }}</pre>
      <p v-if="error" class="tb-error">{{ error }}</p>
    </section>

    <section class="tb-card tb-records-card">
      <header class="tb-header">
        <div>
          <h2>跳边记录</h2>
          <p>每条记录都会保留来源和执行者。</p>
        </div>
        <button type="button" class="tb-secondary-button" :disabled="loadingRecords" @click="loadRecords">
          {{ loadingRecords ? "刷新中..." : "刷新记录" }}
        </button>
      </header>

      <p v-if="recordsError" class="tb-error">{{ recordsError }}</p>
      <p v-else-if="!records.length" class="tb-empty">暂无跳边记录。</p>

      <div v-else class="tb-record-list">
        <article v-for="record in records" :key="record.id" class="tb-record">
          <div class="tb-record-main">
            <strong>{{ record.steamId }}</strong>
            <span>{{ formatTime(record.timestamp) }}</span>
          </div>
          <div class="tb-record-meta">
            <span>来源: {{ record.source }}</span>
            <span>执行者: {{ record.executor }}</span>
            <span>结果: {{ record.ok ? "成功" : "失败" }}</span>
          </div>
          <div class="tb-record-detail">
            <span v-if="record.playerName">玩家名: {{ record.playerName }}</span>
            <span v-if="record.reason">原因: {{ record.reason }}</span>
            <span v-if="record.error">错误: {{ record.error }}</span>
          </div>
        </article>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { apiGet, apiPost } from "../app/apiClient";
import {
  applyMatchSnapshotResponse,
  hasEmptyMatchLists,
  isMatchSnapshotConnected,
} from "../app/matchSnapshot";
import { usePlayerStore, type RuntimePlayer } from "../stores/player.store";

interface TeamBalanceRecord {
  id: string;
  timestamp: string;
  ok: boolean;
  steamId: string;
  playerName: string | null;
  source: string;
  reason: string;
  executor: string;
  error: string;
}

const steamId = ref("");
const playerName = ref("");
const submitting = ref(false);
const result = ref("");
const error = ref("");
const records = ref<TeamBalanceRecord[]>([]);
const loadingRecords = ref(false);
const recordsError = ref("");

const playerStore = usePlayerStore();
const playerPickerRoot = ref<HTMLElement | null>(null);
const showPlayerPicker = ref(false);
const loadingPlayers = ref(false);
const playersError = ref("");
const lastPlayersFetchAt = ref(0);
const bootstrapRefreshAttempted = ref(false);

const filteredPlayers = computed(() => {
  const query = String(playerName.value || "").trim().toLowerCase();
  const list = Array.isArray(playerStore.active) ? playerStore.active : [];
  const base = list.filter((p) => p && p.online !== false);

  if (!query) return base.slice(0, 40);
  return base
    .filter((p) => String(p.name || "").toLowerCase().includes(query) || String(p.steamID || "").includes(query))
    .slice(0, 40);
});

onMounted(() => {
  loadRecords();
});

onBeforeUnmount(() => {
  detachOutsideListener();
});

function attachOutsideListener() {
  document.addEventListener("pointerdown", onOutsidePointerDown, { capture: true });
}

function detachOutsideListener() {
  document.removeEventListener("pointerdown", onOutsidePointerDown, true);
}

function onOutsidePointerDown(event: Event) {
  if (!showPlayerPicker.value) return;
  const target = event.target as Node | null;
  if (!target) return;
  const root = playerPickerRoot.value;
  if (root && root.contains(target)) return;
  closePlayerPicker();
}

async function openPlayerPicker() {
  if (!showPlayerPicker.value) {
    showPlayerPicker.value = true;
    attachOutsideListener();
  }
  await refreshPlayersIfNeeded();
}

function closePlayerPicker() {
  showPlayerPicker.value = false;
  detachOutsideListener();
}

async function refreshPlayersIfNeeded() {
  const now = Date.now();
  const isFresh = now - (lastPlayersFetchAt.value || 0) < 8_000;
  const hasPlayers = Array.isArray(playerStore.active) && playerStore.active.length > 0;
  if (isFresh && hasPlayers) return;

  loadingPlayers.value = true;
  playersError.value = "";
  try {
    const snapshot = await apiGet<any>("/api/match/snapshot", {}, { timeoutMs: 5_000 });
    applyMatchSnapshotResponse(snapshot);

    if (!bootstrapRefreshAttempted.value && isMatchSnapshotConnected(snapshot) && hasEmptyMatchLists(snapshot)) {
      bootstrapRefreshAttempted.value = true;
      try {
        const refreshed = await apiPost<any>("/api/match/refresh/all", {});
        if (refreshed?.ok) applyMatchSnapshotResponse(refreshed);
      } catch {
        // ignore
      }
    }

    lastPlayersFetchAt.value = Date.now();
  } catch (err: any) {
    playersError.value = String(err?.message || err || "玩家列表加载失败");
  } finally {
    loadingPlayers.value = false;
  }
}

function pickPlayer(player: RuntimePlayer) {
  playerName.value = String(player?.name || "");
  if (player?.steamID) steamId.value = String(player.steamID);
  closePlayerPicker();
}

function playerKey(player: RuntimePlayer, index: number) {
  const pid = player?.playerID != null ? `pid:${player.playerID}` : "pid:null";
  const steam = player?.steamID ? `steam:${player.steamID}` : "steam:";
  const eos = player?.eosID ? `eos:${player.eosID}` : "eos:";
  const name = player?.name ? `name:${player.name}` : "name:";
  return `${pid}|${steam}|${eos}|${name}|i:${index}`;
}

async function submit() {
  if (!steamId.value) return;

  submitting.value = true;
  result.value = "";
  error.value = "";

  try {
    const res = await apiPost("/api/tb/force-team-change", {
      steamId: steamId.value,
      playerName: playerName.value,
      source: "web.tb",
      reason: "manual_tb_page",
    });

    result.value = JSON.stringify(res, null, 2);
    await loadRecords();
  } catch (err: any) {
    error.value = String(err?.message || err || "跳边失败");
  } finally {
    submitting.value = false;
  }
}

async function loadRecords() {
  loadingRecords.value = true;
  recordsError.value = "";

  try {
    const res = await apiGet<{ ok?: boolean; records?: TeamBalanceRecord[] }>("/api/tb/records?limit=20");
    records.value = Array.isArray(res?.records) ? res.records : [];
  } catch (err: any) {
    recordsError.value = String(err?.message || err || "记录加载失败");
    records.value = [];
  } finally {
    loadingRecords.value = false;
  }
}

function formatTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
</script>

<style scoped>
.tb-page {
  padding: 24px;
  display: grid;
  gap: 16px;
}

.tb-card {
  max-width: 720px;
  border: 1px solid var(--color-border-default);
  border-radius: 16px;
  padding: 20px;
  background: var(--color-surface-panel);
}

.tb-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.tb-header h1,
.tb-header h2 {
  margin: 0;
  font-size: 22px;
}

.tb-header p {
  margin: 8px 0 0;
  color: var(--color-text-muted);
}

.tb-form {
  display: grid;
  gap: 14px;
  margin-top: 20px;
}

.tb-form label {
  display: grid;
  gap: 6px;
}

.tb-player-picker {
  position: relative;
}

.tb-player-dropdown {
  position: absolute;
  z-index: 20;
  left: 0;
  right: 0;
  top: calc(100% + 6px);
  max-height: 280px;
  overflow: auto;
  border: 1px solid var(--color-border-default);
  border-radius: 10px;
  background: var(--color-surface-panel);
  padding: 6px;
  display: grid;
  gap: 4px;
}

.tb-player-option {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 8px 10px;
  background: transparent;
  color: var(--color-text-main);
  cursor: pointer;
}

.tb-player-option:hover {
  background: rgba(255, 255, 255, 0.04);
  border-color: var(--color-border-default);
}

.tb-player-option__name {
  font-weight: 600;
}

.tb-player-option__meta {
  color: var(--color-text-muted);
  font-size: 12px;
}

.tb-player-empty {
  padding: 10px;
  color: var(--color-text-muted);
}

.tb-form input {
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  background: var(--color-surface-input);
  color: var(--color-text-main);
}

.tb-form button,
.tb-secondary-button {
  width: fit-content;
  min-height: 36px;
  padding: 0 16px;
  border-radius: 8px;
  cursor: pointer;
}

.tb-secondary-button {
  border: 1px solid var(--color-border-default);
  background: transparent;
  color: var(--color-text-main);
}

.tb-result {
  margin-top: 16px;
  padding: 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  white-space: pre-wrap;
}

.tb-error {
  margin-top: 16px;
  color: #ff6b6b;
}

.tb-empty {
  margin-top: 16px;
  color: var(--color-text-muted);
}

.tb-record-list {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.tb-record {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
}

.tb-record-main,
.tb-record-meta,
.tb-record-detail {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.tb-record-main {
  justify-content: space-between;
}

.tb-record-main strong {
  font-size: 15px;
}

.tb-record-main span,
.tb-record-meta span,
.tb-record-detail span {
  color: var(--color-text-muted);
}

@media (max-width: 720px) {
  .tb-page {
    padding: 16px;
  }

  .tb-card {
    padding: 16px;
  }

  .tb-header {
    flex-direction: column;
  }
}
</style>
