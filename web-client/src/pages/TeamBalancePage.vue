<template>
  <main class="tb-page">
    <div class="tb-top-row">
      <section class="tb-card tb-switch-card">
        <header class="tb-header">
          <div>
            <h1>跳边入口</h1>
            <p>统一通过 TeamBalance 模块处理跳边执行和打乱方案记录。</p>
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

    <section class="tb-card tb-shuffle-card">
      <header class="tb-header">
        <div>
          <h2>按时长打乱阵营</h2>
          <p>只生成审核记录，不直接执行跳边。生成后可以直接看到 T1 / T2 的玩家分布。</p>
        </div>
        <button
          type="button"
          class="tb-primary-button"
          :disabled="creatingShufflePlan || !canCreateShufflePlan"
          @click="handleCreateShufflePlan"
        >
          {{ creatingShufflePlan ? "生成中..." : "生成打乱记录" }}
        </button>
      </header>

      <div class="tb-shuffle-hero">
        <article class="tb-shuffle-stat">
          <span>在线玩家</span>
          <strong>{{ shuffleRoster.length }}</strong>
        </article>
        <article class="tb-shuffle-stat">
          <span>已知时长</span>
          <strong>{{ shuffleKnownPlaytimeCount }}</strong>
        </article>
        <article class="tb-shuffle-stat">
          <span>缺失时长</span>
          <strong>{{ shuffleUnknownPlaytimeCount }}</strong>
        </article>
        <article class="tb-shuffle-stat">
          <span>当前 T1 / T2</span>
          <strong>T1 {{ shuffleTeam1Count }} / T2 {{ shuffleTeam2Count }}</strong>
        </article>
      </div>

      <div v-if="latestShufflePlan" class="tb-shuffle-result">
        <div class="tb-shuffle-result-head">
          <div>
            <h3>打乱结果</h3>
            <p>
              计划跳边 {{ latestShufflePlan.summary?.plannedMoveCount ?? 0 }} 人，
              打乱后平均时长差 {{ formatHours(latestShufflePlan.summary?.averageDeltaHours) }}。
            </p>
          </div>
          <span class="tb-shuffle-badge">{{ formatTime(latestShufflePlan.plan?.generatedAt ?? "") }}</span>
        </div>

        <div class="tb-shuffle-grid">
          <article class="tb-shuffle-team">
            <div class="tb-shuffle-team__head">
              <strong>T1</strong>
              <span>{{ formatHours(latestShufflePlan.summary?.after?.team1?.averagePlaytimeHours) }} / {{ latestShufflePlan.summary?.after?.team1?.playerCount ?? 0 }} 人</span>
            </div>
            <div class="tb-shuffle-player-list">
              <div
                v-for="player in latestShuffleTeamPlayers(1)"
                :key="`t1-${player.steamId || player.playerId || player.playerName}`"
                class="tb-shuffle-player"
              >
                <strong>{{ player.playerName }}</strong>
                <span>{{ formatHours(player.playtimeHours) }}</span>
                <span v-if="player.steamId">{{ player.steamId }}</span>
              </div>
            </div>
          </article>

          <article class="tb-shuffle-team">
            <div class="tb-shuffle-team__head">
              <strong>T2</strong>
              <span>{{ formatHours(latestShufflePlan.summary?.after?.team2?.averagePlaytimeHours) }} / {{ latestShufflePlan.summary?.after?.team2?.playerCount ?? 0 }} 人</span>
            </div>
            <div class="tb-shuffle-player-list">
              <div
                v-for="player in latestShuffleTeamPlayers(2)"
                :key="`t2-${player.steamId || player.playerId || player.playerName}`"
                class="tb-shuffle-player"
              >
                <strong>{{ player.playerName }}</strong>
                <span>{{ formatHours(player.playtimeHours) }}</span>
                <span v-if="player.steamId">{{ player.steamId }}</span>
              </div>
            </div>
          </article>
        </div>
      </div>

      <div class="tb-shuffle-note">
        只会写入跳边入口记录，审核通过前不会触发任何实际跳边。当前的目标是让两边平均时长尽量接近。
      </div>
    </section>
    </div>

    <section class="tb-card tb-records-card">
      <header class="tb-header">
        <div>
          <h2>跳边记录</h2>
          <p>这里同时显示实际跳边和“按时长打乱阵营”的审核记录。</p>
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
            <strong>{{ formatRecordTitle(record) }}</strong>
            <span>{{ formatTime(record.timestamp) }}</span>
          </div>

          <div class="tb-record-meta">
            <span>类型: {{ formatRecordType(record) }}</span>
            <span>来源: {{ record.source }}</span>
            <span>执行者: {{ record.executor }}</span>
            <span>结果: {{ record.ok ? "成功" : "失败" }}</span>
          </div>

          <div class="tb-record-detail">
            <span v-if="record.playerName">玩家名: {{ record.playerName }}</span>
            <span v-if="record.reason">原因: {{ record.reason }}</span>
            <span v-if="record.message">{{ record.message }}</span>
            <span v-if="record.error">错误: {{ record.error }}</span>
          </div>

          <div v-if="record.action === 'playtime_shuffle_plan' && record.summary" class="tb-record-plan">
            <div class="tb-record-plan-summary">
              <span>计划跳边: {{ record.summary.plannedMoveCount ?? 0 }} 人</span>
              <span>总玩家: {{ record.summary.totalPlayers ?? 0 }} 人</span>
              <span>已知时长: {{ record.summary.knownPlaytimePlayers ?? 0 }}</span>
              <span>缺失时长: {{ record.summary.unknownPlaytimePlayers ?? 0 }}</span>
              <span>打乱后平均时长差: {{ formatHours(record.summary.averageDeltaHours) }}</span>
              <span>
                打乱后 T1/T2 平均:
                {{ formatHours(record.summary.after?.team1?.averagePlaytimeHours) }}
                /
                {{ formatHours(record.summary.after?.team2?.averagePlaytimeHours) }}
              </span>
            </div>

            <div v-if="record.plan?.players?.length" class="tb-record-plan-groups">
              <article class="tb-record-plan-group">
                <h3>T1</h3>
                <div class="tb-record-plan-player-list">
                  <div
                    v-for="player in recordTeamPlayers(record, 1)"
                    :key="`record-${record.id}-t1-${player.steamId || player.playerId || player.playerName}`"
                    class="tb-record-plan-player"
                  >
                    <strong>{{ player.playerName }}</strong>
                    <span>{{ formatHours(player.playtimeHours) }}</span>
                  </div>
                </div>
              </article>

              <article class="tb-record-plan-group">
                <h3>T2</h3>
                <div class="tb-record-plan-player-list">
                  <div
                    v-for="player in recordTeamPlayers(record, 2)"
                    :key="`record-${record.id}-t2-${player.steamId || player.playerId || player.playerName}`"
                    class="tb-record-plan-player"
                  >
                    <strong>{{ player.playerName }}</strong>
                    <span>{{ formatHours(player.playtimeHours) }}</span>
                  </div>
                </div>
              </article>
            </div>

            <details v-if="record.plan?.moves?.length" class="tb-record-plan-moves">
              <summary>查看计划跳边名单（{{ record.plan.moves.length }}）</summary>
              <div class="tb-record-plan-move-list">
                <div v-for="(move, index) in record.plan.moves" :key="`${record.id}-move-${index}`" class="tb-record-plan-move">
                  <strong>{{ move.playerName || move.steamId || "Unknown" }}</strong>
                  <span>T{{ move.fromTeamId }} -> T{{ move.targetTeamId }}</span>
                  <span>时长: {{ move.hasKnownPlaytime ? formatHours(move.playtimeHours) : "缺失" }}</span>
                  <span v-if="move.steamId">{{ move.steamId }}</span>
                </div>
              </div>
            </details>
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
import { createPlaytimeShufflePlan, type TeamShufflePlanResponse } from "../app/teamBalanceApi";

interface TeamBalancePlanSummary {
  totalPlayers?: number;
  plannedMoveCount?: number;
  knownPlaytimePlayers?: number;
  unknownPlaytimePlayers?: number;
  averageDeltaHours?: number | null;
  before?: any;
  after?: any;
}

interface TeamBalancePlanMove {
  playerId?: string | number | null;
  steamId?: string | null;
  playerName?: string | null;
  fromTeamId?: number;
  targetTeamId?: number;
  playtimeHours?: number | null;
  hasKnownPlaytime?: boolean;
}

interface ShuffleRosterPlayer {
  playerId: number | string | null;
  steamId: string | null;
  eosId: string | null;
  playerName: string;
  role: string | null;
  squadId: number | null;
  teamId: number;
  online: boolean;
  playtimeSeconds: number | null;
  playtimeHours: number | null;
}

interface TeamBalanceRecord {
  id: string;
  timestamp: string;
  type?: string;
  action?: string;
  ok: boolean;
  steamId: string;
  playerName: string | null;
  source: string;
  reason: string;
  executor: string;
  error: string;
  message?: string;
  summary?: TeamBalancePlanSummary | null;
  plan?: {
    generatedAt?: string;
    mode?: string;
    players?: TeamBalancePlanMove[];
    moves?: TeamBalancePlanMove[];
  } | null;
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
const stablePlaytimes = ref<Record<string, any>>({});
const playerPickerRoot = ref<HTMLElement | null>(null);
const showPlayerPicker = ref(false);
const loadingPlayers = ref(false);
const playersError = ref("");
const lastPlayersFetchAt = ref(0);
const bootstrapRefreshAttempted = ref(false);
const creatingShufflePlan = ref(false);
const latestShufflePlan = ref<TeamShufflePlanResponse | null>(null);

const filteredPlayers = computed(() => {
  const query = String(playerName.value || "").trim().toLowerCase();
  const list = Array.isArray(playerStore.active) ? playerStore.active : [];
  const base = list.filter((player) => player && player.online !== false);

  if (!query) return base.slice(0, 40);
  return base
    .filter((player) => String(player.name || "").toLowerCase().includes(query) || String(player.steamID || "").includes(query))
    .slice(0, 40);
});

const shuffleRoster = computed(() => buildShuffleRoster());
const shuffleTeam1Count = computed(() => shuffleRoster.value.filter((player) => player.teamId === 1).length);
const shuffleTeam2Count = computed(() => shuffleRoster.value.filter((player) => player.teamId === 2).length);
const shuffleKnownPlaytimeCount = computed(() => shuffleRoster.value.filter((player) => player.playtimeSeconds != null).length);
const shuffleUnknownPlaytimeCount = computed(() => shuffleRoster.value.length - shuffleKnownPlaytimeCount.value);
const canCreateShufflePlan = computed(() => shuffleTeam1Count.value > 0 && shuffleTeam2Count.value > 0);

onMounted(() => {
  void loadRecords();
  void refreshPlayersIfNeeded();
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
  if (isFresh && hasPlayers) {
    await refreshPlaytimeCache();
    return;
  }

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
    await refreshPlaytimeCache();
  } catch (err: any) {
    playersError.value = String(err?.message || err || "玩家列表加载失败");
  } finally {
    loadingPlayers.value = false;
  }
}

async function refreshPlaytimeCache() {
  const steamIDs = [...new Set(
    (Array.isArray(playerStore.active) ? playerStore.active : [])
      .map((player) => String(player.steamID ?? "").trim())
      .filter(Boolean),
  )];

  if (steamIDs.length === 0) return;

  try {
    const res = await apiGet<{ items?: Record<string, any> }>(
      `/api/query/playtime-cache?steamIDs=${encodeURIComponent(steamIDs.join(","))}`,
    );
    stablePlaytimes.value = {
      ...stablePlaytimes.value,
      ...(res?.items ?? {}),
    };
  } catch {
    // keep the previous cache
  }
}

function buildShuffleRoster(): ShuffleRosterPlayer[] {
  const roster: ShuffleRosterPlayer[] = [];

  for (const player of Array.isArray(playerStore.active) ? playerStore.active : []) {
    if (!player || player.online === false) continue;
    const teamId = Number(player.teamID);
    if (teamId !== 1 && teamId !== 2) continue;

    const steamIdValue = String(player.steamID ?? "").trim();
    const cache = steamIdValue ? stablePlaytimes.value[steamIdValue] : null;
    const seconds = Number(cache?.gameSeconds);
    const playtimeSeconds = Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : null;

    roster.push({
      playerId: player.playerID ?? null,
      steamId: steamIdValue || null,
      eosId: String(player.eosID ?? "").trim() || null,
      playerName: String(player.name ?? "").trim() || "Unknown",
      role: String(player.role ?? "").trim() || null,
      squadId: player.squadID == null ? null : Number(player.squadID),
      teamId,
      online: true,
      playtimeSeconds,
      playtimeHours: playtimeSeconds == null ? null : roundHours(playtimeSeconds / 3600),
    });
  }

  return roster;
}

async function handleCreateShufflePlan() {
  if (creatingShufflePlan.value) return;
  const roster = shuffleRoster.value;
  if (roster.length === 0 || !canCreateShufflePlan.value) return;

  const confirmed = window.confirm(
    `将基于当前 ${roster.length} 名在线玩家的时长生成阵营打乱方案。\n只会写入跳边入口记录，不会执行实际跳边。`,
  );
  if (!confirmed) return;

  creatingShufflePlan.value = true;
  recordsError.value = "";
  try {
    const result = await createPlaytimeShufflePlan({
      source: "web.teamBalance",
      reason: "team_balance_playtime_shuffle_plan",
      players: roster.map((player) => ({
        playerId: player.playerId,
        steamId: player.steamId,
        eosId: player.eosId,
        playerName: player.playerName,
        role: player.role,
        squadId: player.squadId,
        teamId: player.teamId,
        online: player.online,
        playtimeSeconds: player.playtimeSeconds,
      })),
    });

    if (!result.ok) {
      throw new Error(result.message || "生成打乱记录失败");
    }

    latestShufflePlan.value = result;
    await loadRecords();
  } catch (err: any) {
    recordsError.value = String(err?.message || err || "生成打乱记录失败");
  } finally {
    creatingShufflePlan.value = false;
  }
}

function latestShuffleTeamPlayers(teamId: number) {
  const plan = latestShufflePlan.value?.plan;
  if (!plan?.players?.length) return [];
  return [...plan.players]
    .filter((player) => Number(player.targetTeamId) === teamId)
    .sort((left, right) => {
      const diff = Number(right.playtimeHours ?? -1) - Number(left.playtimeHours ?? -1);
      if (diff !== 0) return diff;
      return String(left.playerName ?? "").localeCompare(String(right.playerName ?? ""), "zh-CN");
    });
}

function recordTeamPlayers(record: TeamBalanceRecord, teamId: number) {
  const players = record.plan?.players ?? [];
  return [...players]
    .filter((player) => Number(player.targetTeamId) === teamId)
    .sort((left, right) => {
      const diff = Number(right.playtimeHours ?? -1) - Number(left.playtimeHours ?? -1);
      if (diff !== 0) return diff;
      return String(left.playerName ?? "").localeCompare(String(right.playerName ?? ""), "zh-CN");
    });
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

function formatRecordType(record: TeamBalanceRecord) {
  if (record.action === "playtime_shuffle_plan") return "按时长打乱记录";
  return "跳边执行";
}

function formatRecordTitle(record: TeamBalanceRecord) {
  if (record.action === "playtime_shuffle_plan") {
    return `打乱方案 @ ${formatTime(record.timestamp)}`;
  }
  return record.steamId || record.playerName || "Unknown";
}

function formatHours(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toFixed(1)}h`;
}

function roundHours(value: number) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}
</script>

<style scoped>
.tb-page {
  padding: 0;
  display: grid;
  gap: 16px;
  color: var(--color-text-primary);
}

.tb-top-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr);
  gap: 16px;
  align-items: start;
}

.tb-switch-card {
  /* sticky works only if a true scroll ancestor exists;
     content-shell is the scroller so we just let it flow */
}

.tb-card {
  border: 1px solid var(--color-border-default);
  border-radius: 18px;
  padding: 20px;
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--theme-warn-glow) 70%, transparent), transparent 28%),
    var(--theme-panel-highlight),
    var(--color-bg-card);
  box-shadow: var(--shadow-md), var(--theme-panel-glow);
}

.tb-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
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
  border-radius: 12px;
  background: var(--color-bg-card);
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
  border-radius: 10px;
  padding: 8px 10px;
  background: transparent;
  color: var(--color-text-primary);
  cursor: pointer;
}

.tb-player-option:hover {
  background: var(--color-bg-hover);
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
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--color-border-default);
  border-radius: 10px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.tb-primary-button,
.tb-secondary-button,
.tb-form button {
  width: fit-content;
  min-height: 40px;
  padding: 0 16px;
  border-radius: 999px;
  cursor: pointer;
}

.tb-primary-button {
  border: 1px solid rgba(245, 158, 11, 0.35);
  background: rgba(245, 158, 11, 0.12);
  color: color-mix(in srgb, var(--color-status-warning) 76%, white 24%);
  font-weight: 700;
}

.tb-secondary-button {
  border: 1px solid var(--color-border-default);
  background: color-mix(in srgb, var(--color-bg-elevated) 86%, transparent);
  color: var(--color-text-primary);
}

.tb-result {
  margin-top: 16px;
  padding: 12px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-bg-elevated) 86%, transparent);
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

.tb-shuffle-card {
  display: grid;
  gap: 14px;
}

.tb-shuffle-hero {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.tb-shuffle-stat {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(245, 158, 11, 0.18);
  background: color-mix(in srgb, var(--color-bg-elevated) 88%, transparent);
}

.tb-shuffle-stat span {
  color: var(--color-text-muted);
  font-size: 13px;
}

.tb-shuffle-stat strong {
  font-size: 18px;
  line-height: 1.2;
}

.tb-shuffle-result {
  display: grid;
  gap: 14px;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid rgba(245, 158, 11, 0.18);
  background: color-mix(in srgb, var(--color-bg-card) 92%, transparent);
}

.tb-shuffle-result-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.tb-shuffle-result-head h3 {
  margin: 0;
  font-size: 16px;
}

.tb-shuffle-result-head p {
  margin: 6px 0 0;
  color: var(--color-text-muted);
}

.tb-shuffle-badge {
  min-height: 32px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid rgba(245, 158, 11, 0.22);
  color: color-mix(in srgb, var(--color-status-warning) 76%, white 24%);
  background: rgba(245, 158, 11, 0.08);
}

.tb-shuffle-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.tb-shuffle-team {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid var(--color-border-soft);
  background: color-mix(in srgb, var(--color-bg-card) 90%, transparent);
}

.tb-shuffle-team__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.tb-shuffle-player-list,
.tb-record-plan-player-list,
.tb-record-plan-move-list {
  display: grid;
  gap: 8px;
}

.tb-shuffle-player,
.tb-record-plan-player,
.tb-record-plan-move {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.02);
}

.tb-shuffle-player strong,
.tb-record-plan-player strong,
.tb-record-plan-move strong {
  color: var(--color-text-primary);
}

.tb-shuffle-player span,
.tb-record-plan-player span,
.tb-record-plan-move span {
  color: var(--color-text-muted);
}

.tb-shuffle-note {
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(245, 158, 11, 0.16);
  background: rgba(245, 158, 11, 0.08);
  color: var(--color-text-secondary);
}

.tb-record-list {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.tb-record {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--color-border-default);
  border-radius: 14px;
  background: color-mix(in srgb, var(--color-bg-card) 90%, transparent);
}

.tb-record-main,
.tb-record-meta,
.tb-record-detail,
.tb-record-plan-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
}

.tb-record-main {
  justify-content: space-between;
}

.tb-record-main strong {
  font-size: 15px;
}

.tb-record-main span,
.tb-record-meta span,
.tb-record-detail span,
.tb-record-plan-summary span {
  color: var(--color-text-muted);
}

.tb-record-plan {
  display: grid;
  gap: 12px;
  margin-top: 2px;
}

.tb-record-plan-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.tb-record-plan-group {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid var(--color-border-soft);
  background: color-mix(in srgb, var(--color-bg-elevated) 88%, transparent);
}

.tb-record-plan-group h3 {
  margin: 0;
  font-size: 14px;
}

.tb-record-plan-moves {
  border-top: 1px solid var(--color-border-soft);
  padding-top: 10px;
}

.tb-record-plan-moves summary {
  cursor: pointer;
  color: var(--color-text-primary);
  font-weight: 600;
}

.tb-record-plan-move-list {
  margin-top: 10px;
}

@media (max-width: 1100px) {
  .tb-top-row {
    grid-template-columns: 1fr;
  }

  .tb-switch-card {
    position: static;
  }
}

@media (max-width: 960px) {
  .tb-shuffle-hero,
  .tb-shuffle-grid,
  .tb-record-plan-groups {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .tb-page {
    padding: 16px;
  }

  .tb-card {
    padding: 16px;
  }

  .tb-record-main {
    flex-direction: column;
  }
}
</style>
