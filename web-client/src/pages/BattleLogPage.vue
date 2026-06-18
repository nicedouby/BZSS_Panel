<template>
  <AppPage full-bleed class="battle-log-page">
        <h1 class="sr-only">战绩订阅</h1>

    <WorkspaceToolbar>
      <template #actions>
        <button
          type="button"
          class="refresh-button"
          :disabled="refreshing"
          @click="refreshAll()"
        >
          <span v-if="refreshing" class="spinner button-spinner"></span>
          <span>{{ refreshing ? t("common.refreshing") : t("common.refresh") }}</span>
        </button>
      </template>
    </WorkspaceToolbar><AppPageToolbar>
      <div class="toolbar-row">
        <select v-model="filters.type" class="filter-input">
          <option v-for="option in typeOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <input
          v-model="filters.search"
          class="filter-input search-input"
          :placeholder="t('common.search') + ' 玩家 / 武器 / 来源 / 备注'"
          @keydown.enter.prevent="refreshEvents()"
        >
        <input
          v-model="playerQuery"
          class="filter-input player-input"
          placeholder="玩家查询（名称 / Steam64 / EOS / Controller）"
          @keydown.enter.prevent="refreshPlayer()"
        >
        <select v-model="filters.limit" class="filter-input limit-input">
          <option :value="100">100</option>
          <option :value="200">200</option>
          <option :value="500">500</option>
          <option :value="1000">1000</option>
        </select>
        <button type="button" class="toolbar-button" @click="refreshEvents()">{{ t("common.refresh") }}</button>
        <button type="button" class="toolbar-button" @click="refreshPlayer()" :disabled="!playerQuery.trim()">玩家统计</button>
      </div>
      <div class="summary-row">
        <span class="meta-chip">总数 {{ formatNumber(overview?.count ?? 0) }}</span>
        <span class="meta-chip">击倒 {{ formatNumber(overview?.stats?.down ?? 0) }}</span>
        <span class="meta-chip">击杀 {{ formatNumber(overview?.stats?.kill ?? 0) }}</span>
        <span class="meta-chip">死亡 {{ formatNumber(overview?.stats?.death ?? 0) }}</span>
        <span class="meta-chip">复苏 {{ formatNumber(overview?.stats?.revive ?? 0) }}</span>
        <span class="meta-chip">TK {{ formatNumber(overview?.stats?.tk ?? 0) }}</span>
        <span class="meta-chip">更新时间 {{ formatTime(overview?.lastUpdatedAt) }}</span>
      </div>
    </AppPageToolbar>

    <DataState
      mode="fill"
      :loading="bootLoading"
      :error="bootError"
      :empty="!bootLoading && !bootError && events.length === 0"
      empty-title="暂无战绩"
      empty-text="当前筛选条件下没有战绩记录。"
    >
      <div class="battle-layout">
        <AppCard compact class="battle-summary-card" title="战绩概览">
          <div class="stat-grid">
            <div class="stat-item"><span>总数</span><strong>{{ formatNumber(overview?.count ?? 0) }}</strong></div>
            <div class="stat-item"><span>击倒</span><strong>{{ formatNumber(overview?.stats?.down ?? 0) }}</strong></div>
            <div class="stat-item"><span>击杀</span><strong>{{ formatNumber(overview?.stats?.kill ?? 0) }}</strong></div>
            <div class="stat-item"><span>死亡</span><strong>{{ formatNumber(overview?.stats?.death ?? 0) }}</strong></div>
            <div class="stat-item"><span>复苏</span><strong>{{ formatNumber(overview?.stats?.revive ?? 0) }}</strong></div>
            <div class="stat-item"><span>TK</span><strong>{{ formatNumber(overview?.stats?.tk ?? 0) }}</strong></div>
          </div>
          <div class="summary-meta">
            <span>来源: {{ sourceSummary }}</span>
            <span>最后更新: {{ formatTime(overview?.lastUpdatedAt) }}</span>
          </div>
        </AppCard>

        <AppCard v-if="playerStats" compact class="battle-player-card" title="玩家统计">
          <div class="player-header">
            <strong>{{ playerStats?.player?.displayName || playerStats?.player?.name || playerQuery || "Unknown" }}</strong>
            <span class="meta-chip">{{ playerStats?.query || "已匹配" }}</span>
          </div>
          <div class="stat-grid stat-grid--player">
            <div class="stat-item"><span>击倒</span><strong>{{ formatNumber(playerStats?.stats?.down ?? 0) }}</strong></div>
            <div class="stat-item"><span>击杀</span><strong>{{ formatNumber(playerStats?.stats?.kill ?? 0) }}</strong></div>
            <div class="stat-item"><span>死亡</span><strong>{{ formatNumber(playerStats?.stats?.death ?? 0) }}</strong></div>
            <div class="stat-item"><span>复苏</span><strong>{{ formatNumber(playerStats?.stats?.revive ?? 0) }}</strong></div>
            <div class="stat-item"><span>TK</span><strong>{{ formatNumber(playerStats?.stats?.tk ?? 0) }}</strong></div>
            <div class="stat-item"><span>总数</span><strong>{{ formatNumber(playerStats?.count ?? 0) }}</strong></div>
          </div>
          <div class="player-meta">
            <span v-if="playerStats?.player?.steam64ID">Steam64 {{ playerStats.player.steam64ID }}</span>
            <span v-if="playerStats?.player?.eosID">EOS {{ playerStats.player.eosID }}</span>
            <span v-if="playerStats?.player?.controllerID">Controller {{ playerStats.player.controllerID }}</span>
          </div>
          <div v-if="playerStats?.latest?.length" class="player-events">
            <div v-for="entry in playerStats.latest" :key="entry.id" class="player-event-row">
              <span>{{ formatTime(entry.time) }}</span>
              <strong>{{ eventTypeLabel(entry) }}</strong>
              <span>{{ entry.displayText }}</span>
            </div>
          </div>
        </AppCard>

        <AppCard compact class="battle-table-card" title="战绩事件">
          <DataState
            mode="fill"
            :loading="eventsLoading && !events.length"
            :error="eventsError"
            :empty="!eventsLoading && !eventsError && events.length === 0"
            empty-title="暂无战绩事件"
            empty-text="没有符合当前筛选条件的战绩记录。"
          >
            <div class="table-wrap battle-table-wrap">
              <table class="battle-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>类型</th>
                    <th>玩家</th>
                    <th>对手</th>
                    <th>来源</th>
                    <th>备注</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="event in events" :key="event.id" :class="`battle-row battle-row--${event.statType}`">
                    <td class="time-cell">{{ formatTime(event.time) }}</td>
                    <td><span class="type-pill" :class="event.statType">{{ eventTypeLabel(event) }}</span></td>
                    <td>
                      <div class="player-cell">
                        <strong>{{ event.player?.displayName || event.player?.name || event.playerName || "-" }}</strong>
                        <small v-if="event.player?.steam64ID">Steam64 {{ event.player.steam64ID }}</small>
                      </div>
                    </td>
                    <td>
                      <div class="player-cell">
                        <strong>{{ event.counterparty?.displayName || event.counterparty?.name || event.counterpartyName || "-" }}</strong>
                        <small v-if="event.counterparty?.steam64ID">Steam64 {{ event.counterparty.steam64ID }}</small>
                      </div>
                    </td>
                    <td>
                      <div class="source-cell">
                        <span>{{ event.sourceType === "rcon" ? "RCON" : "combatClean" }}</span>
                        <small>{{ event.sourceEventName || event.sourceModule || "-" }}</small>
                      </div>
                    </td>
                    <td>{{ event.note || event.displayText || "-" }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </DataState>
        </AppCard>
      </div>
    </DataState>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { apiGet } from "../app/apiClient";
import { renderApiError } from "../app/errors";
import { canAutoRefreshNow } from "../composables/useAutoRefreshGate";
import AppPage from "../components/common/AppPage.vue";
import WorkspaceToolbar from "../components/common/WorkspaceToolbar.vue";
import AppPageToolbar from "../components/common/AppPageToolbar.vue";
import AppCard from "../components/common/AppCard.vue";
import DataState from "../components/common/DataState.vue";
import { t } from "../i18n";

interface BattleLogOverview {
  count?: number;
  stats?: Record<string, number>;
  lastUpdatedAt?: string;
  sourceStatus?: Record<string, { enabled?: boolean; subscribed?: boolean; supported?: boolean }>;
}

interface BattleLogEvent {
  id: string;
  statType: string;
  time: string;
  displayText?: string;
  note?: string;
  sourceType?: string;
  sourceEventName?: string;
  sourceModule?: string;
  player?: any;
  counterparty?: any;
  playerName?: string;
  counterpartyName?: string;
}

const filters = reactive({
  type: "all",
  search: "",
  limit: 200,
});
const playerQuery = ref("");
const overview = ref<BattleLogOverview | null>(null);
const events = ref<BattleLogEvent[]>([]);
const playerStats = ref<any | null>(null);
const bootLoading = ref(true);
const bootError = ref("");
const eventsLoading = ref(false);
const eventsError = ref("");
const playerLoading = ref(false);
const refreshing = ref(false);
let refreshTimer: number | null = null;

const typeOptions = [
  { value: "all", label: "全部" },
  { value: "down", label: "击倒" },
  { value: "kill", label: "击杀" },
  { value: "death", label: "死亡" },
  { value: "revive", label: "复苏" },
  { value: "tk", label: "TK" },
];

const sourceSummary = computed(() => {
  const log = overview.value?.sourceStatus?.log;
  const mod = overview.value?.sourceStatus?.mod;
  const logText = log ? `log:${log.enabled ? "on" : "off"}/${log.subscribed ? "sub" : "unsub"}` : "log:--";
  const modText = mod ? `mod:${mod.enabled ? "on" : "off"}` : "mod:--";
  return `${logText} ${modText}`;
});

onMounted(() => {
  void refreshAll();
  refreshTimer = window.setInterval(() => {
    if (canAutoRefreshNow()) void refreshEvents({ silent: true });
  }, 3000);
});

onBeforeUnmount(() => {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
});

async function refreshAll() {
  refreshing.value = true;
  bootLoading.value = true;
  bootError.value = "";
  try {
    await Promise.all([refreshEvents(), refreshPlayer()]);
  } catch (error) {
    bootError.value = renderApiError(error, "战绩页加载失败");
  } finally {
    bootLoading.value = false;
    refreshing.value = false;
  }
}

async function refreshEvents({ silent = false } = {}) {
  eventsLoading.value = true;
  eventsError.value = "";
  try {
    const params = new URLSearchParams({
      type: filters.type,
      search: filters.search,
      limit: String(filters.limit),
    });
    const data = await apiGet<{ events?: BattleLogEvent[]; overview?: BattleLogOverview }>(`/api/battle-log/events?${params.toString()}`);
    events.value = Array.isArray(data.events) ? data.events : [];
    overview.value = data.overview ?? overview.value;
  } catch (error) {
    eventsError.value = silent
      ? String(error instanceof Error ? error.message : error ?? "加载战绩事件失败")
      : renderApiError(error, "加载战绩事件失败");
    events.value = [];
  } finally {
    eventsLoading.value = false;
  }
}

async function refreshPlayer() {
  const query = playerQuery.value.trim();
  if (!query) {
    playerStats.value = null;
    return;
  }

  playerLoading.value = true;
  try {
    const params = new URLSearchParams({ q: query });
    playerStats.value = await apiGet(`/api/battle-log/player?${params.toString()}`);
  } catch (error) {
    playerStats.value = null;
    eventsError.value = renderApiError(error, "加载玩家战绩失败");
  } finally {
    playerLoading.value = false;
  }
}

function eventTypeLabel(event: any) {
  const type = String(event?.statType ?? event?.type ?? "").trim().toLowerCase();
  if (type === "down") return "击倒";
  if (type === "kill") return "击杀";
  if (type === "death") return "死亡";
  if (type === "revive") return "复苏";
  if (type === "tk") return "TK";
  return type || "-";
}

function formatTime(value: unknown) {
  const text = String(value ?? "");
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString();
}

function formatNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.trunc(number)) : "0";
}
</script>

<style scoped>
.battle-log-page {
  display: grid;
  gap: 12px;
}

.toolbar-row,
.summary-row,
.player-header,
.player-meta {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.filter-input,
.toolbar-button {
  min-height: 34px;
  border-radius: 8px;
  border: 1px solid #35404c;
  background: #11161c;
  color: #edf2f4;
  padding: 7px 10px;
}

.search-input {
  flex: 1 1 280px;
}

.player-input {
  flex: 1 1 260px;
}

.limit-input {
  width: 120px;
}

.toolbar-button {
  cursor: pointer;
}

.battle-layout {
  display: grid;
  gap: 12px;
}

.battle-summary-card,
.battle-player-card,
.battle-table-card {
  min-height: 0;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
}

.stat-grid--player {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.stat-item {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--color-border-default);
  border-radius: 10px;
  background:
    var(--theme-panel-highlight),
    color-mix(in srgb, var(--color-bg-card) 92%, transparent);
}

.stat-item span {
  color: var(--color-text-muted);
  font-size: 12px;
}

.stat-item strong {
  font-size: 20px;
}

.summary-meta,
.player-meta {
  margin-top: 10px;
  color: var(--color-text-muted);
  font-size: 12px;
}

.player-events {
  margin-top: 12px;
  display: grid;
  gap: 8px;
}

.player-event-row {
  display: grid;
  grid-template-columns: 160px 80px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-bg-elevated) 90%, transparent);
}

.battle-table-wrap {
  overflow: auto;
}

.battle-table {
  width: 100%;
  border-collapse: collapse;
}

.battle-table th,
.battle-table td {
  padding: 10px 8px;
  border-bottom: 1px solid var(--color-border-soft);
  vertical-align: top;
}

.battle-table th {
  position: sticky;
  top: 0;
  background:
    var(--theme-panel-highlight),
    color-mix(in srgb, var(--color-bg-elevated) 96%, transparent);
  z-index: 1;
  text-align: left;
  color: var(--color-text-muted);
}

.battle-row--tk {
  background: rgba(239, 68, 68, 0.06);
}

.battle-row--kill,
.battle-row--death {
  background: rgba(245, 158, 11, 0.03);
}

.battle-row--down {
  background: rgba(59, 130, 246, 0.04);
}

.battle-row--revive {
  background: rgba(16, 185, 129, 0.04);
}

.type-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 52px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.type-pill.down {
  background: rgba(59, 130, 246, 0.18);
  color: #93c5fd;
}

.type-pill.kill,
.type-pill.death,
.type-pill.tk {
  background: rgba(239, 68, 68, 0.18);
  color: #fca5a5;
}

.type-pill.revive {
  background: rgba(16, 185, 129, 0.18);
  color: #6ee7b7;
}

.player-cell,
.source-cell {
  display: grid;
  gap: 4px;
}

.player-cell small,
.source-cell small {
  color: var(--color-text-muted);
}

.meta-chip {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--color-border-default);
  background: color-mix(in srgb, var(--color-bg-elevated) 90%, transparent);
  color: var(--color-text-secondary);
  font-size: 12px;
}

@media (max-width: 1200px) {
  .stat-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 800px) {
  .stat-grid,
  .stat-grid--player {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .player-event-row {
    grid-template-columns: 1fr;
  }
}
</style>



