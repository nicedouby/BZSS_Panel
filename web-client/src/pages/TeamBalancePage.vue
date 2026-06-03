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

    <section class="tb-card tb-fair-card">
      <header class="tb-header">
        <div>
          <h2>公平跳边状态</h2>
          <p>显示 `tb` / `sqtb` 的公共额度、个人周期额度和当前待处理申请。</p>
        </div>
        <button type="button" class="tb-secondary-button" :disabled="loadingFairState || loadingFairRequests" @click="refreshFairPanel">
          {{ loadingFairState || loadingFairRequests ? "刷新中..." : "刷新状态" }}
        </button>
      </header>

      <p v-if="fairError" class="tb-error">{{ fairError }}</p>

      <div v-else class="tb-fair-grid">
        <article class="tb-fair-stat">
          <span>当前模式</span>
          <strong>{{ fairState.isWarmup ? "暖服" : "常规" }}</strong>
        </article>
        <article class="tb-fair-stat">
          <span>日志时间</span>
          <strong>{{ fairState.logClockSeconds }}s</strong>
        </article>
        <article class="tb-fair-stat">
          <span>公共 TB 剩余</span>
          <strong>{{ fairState.publicTbRemaining }} / {{ fairState.publicTbLimit }}</strong>
        </article>
        <article class="tb-fair-stat">
          <span>个人 TB 额度</span>
          <strong>{{ fairState.periodTbLimit }} 次 / 18h</strong>
        </article>
        <article class="tb-fair-stat">
          <span>个人认领额度</span>
          <strong>{{ fairState.periodSqtbClaimLimit }} 次 / 18h</strong>
        </article>
        <article class="tb-fair-stat">
          <span>当前待处理</span>
          <strong>{{ fairState.activeRequestCount }}</strong>
        </article>
      </div>

      <div class="tb-fair-meta">
        <span>重置时间: {{ fairState.lastRoundResetAt ? formatTime(fairState.lastRoundResetAt) : "-" }}</span>
        <span>重置原因: {{ fairState.lastRoundResetReason || "-" }}</span>
        <span>恢复时间: {{ fairState.recovery.lastRecoveredAt ? formatTime(fairState.recovery.lastRecoveredAt) : "-" }}</span>
      </div>
    </section>

    <section class="tb-card tb-fair-card">
      <header class="tb-header">
        <div>
          <h2>sqtb 待处理申请</h2>
          <p>申请者先发起 `sqtb`，随后会出现认领码；玩家认领后会直接执行，无需管理员再确认。无人认领时，管理员可协助跳边。</p>
        </div>
        <button type="button" class="tb-secondary-button" :disabled="loadingFairRequests" @click="loadFairRequests">
          {{ loadingFairRequests ? "刷新中..." : "刷新申请" }}
        </button>
      </header>

      <p v-if="fairRequestsError" class="tb-error">{{ fairRequestsError }}</p>
      <p v-else-if="!fairRequests.length" class="tb-empty">暂无待处理申请。</p>

      <div v-else class="tb-request-list">
        <article v-for="request in fairRequests" :key="request.id" class="tb-request">
          <div class="tb-request-main">
            <div>
              <strong>{{ request.applicant.playerName || request.applicant.steamId || "未知玩家" }}</strong>
              <span class="tb-request-code">认领码: {{ request.code }}</span>
            </div>
            <span class="tb-request-status" :data-status="request.status">{{ request.statusLabel }}</span>
          </div>

          <div class="tb-request-meta">
            <span>申请时间: {{ formatTime(request.createdAt) }}</span>
            <span>到期: {{ formatTime(request.expiresAt) }}</span>
            <span>剩余: {{ formatDuration(requestRemainingMs(request)) }}</span>
          </div>

          <div class="tb-request-meta">
            <span>申请者: {{ formatActor(request.applicant) }}</span>
            <span>认领者: {{ formatActor(request.claimant) }}</span>
            <span>直批: {{ request.directApproval ? "是" : "否" }}</span>
          </div>

          <div v-if="request.rejectedReason || request.claimedAt || request.approvedAt" class="tb-request-detail">
            <span v-if="request.claimedAt">认领时间: {{ formatTime(request.claimedAt) }}</span>
            <span v-if="request.approvedAt">批准时间: {{ formatTime(request.approvedAt) }}</span>
            <span v-if="request.rejectedReason">驳回原因: {{ request.rejectedReason }}</span>
          </div>

          <div class="tb-request-actions">
            <button
              v-if="request.canDirectApprove"
              type="button"
              class="tb-secondary-button"
              :disabled="actioningRequestId === request.id"
              @click="approveFairRequest(request, true)"
            >
              管理员协助跳边
            </button>
            <button
              v-if="request.canApprove"
              type="button"
              class="tb-secondary-button"
              :disabled="actioningRequestId === request.id"
              @click="approveFairRequest(request, false)"
            >
              执行跳边
            </button>
            <button
              type="button"
              class="tb-secondary-button tb-secondary-button--danger"
              :disabled="actioningRequestId === request.id"
              @click="rejectFairRequest(request)"
            >
              驳回
            </button>
          </div>
        </article>
      </div>
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

interface FairTeamBalanceActor {
  playerKey: string;
  playerName: string;
  steamId: string;
  eosId: string;
  teamId: number | null;
  squadId: number | null;
}

interface FairTeamBalanceRequest {
  id: string;
  code: string;
  status: string;
  statusLabel: string;
  createdAt: string;
  expiresAt: string;
  applicant: FairTeamBalanceActor;
  claimant: FairTeamBalanceActor | null;
  claimedAt: string;
  approvedAt: string;
  rejectedAt: string;
  rejectedReason: string;
  directApproval: boolean;
  serverId: string;
  canDirectApprove: boolean;
  canApprove: boolean;
}

interface FairTeamBalanceState {
  enabled: boolean;
  subscribed: boolean;
  active: boolean;
  isWarmup: boolean;
  logClockSeconds: number;
  publicTbLimit: number;
  publicTbRemaining: number;
  periodMs: number;
  periodTbLimit: number;
  periodSqtbClaimLimit: number;
  requestTtlMs: number;
  roundUsedCount: number;
  activeRequestCount: number;
  pendingClaimCount: number;
  pendingApprovalCount: number;
  lastRoundResetAt: string;
  lastRoundResetReason: string;
  recovery: {
    lastRecoveredAt: string;
    recoveredLineCount: number;
  };
}

const steamId = ref("");
const playerName = ref("");
const submitting = ref(false);
const result = ref("");
const error = ref("");
const records = ref<TeamBalanceRecord[]>([]);
const loadingRecords = ref(false);
const recordsError = ref("");
const fairState = ref<FairTeamBalanceState>({
  enabled: false,
  subscribed: false,
  active: false,
  isWarmup: false,
  logClockSeconds: 0,
  publicTbLimit: 0,
  publicTbRemaining: 0,
  periodMs: 0,
  periodTbLimit: 0,
  periodSqtbClaimLimit: 0,
  requestTtlMs: 0,
  roundUsedCount: 0,
  activeRequestCount: 0,
  pendingClaimCount: 0,
  pendingApprovalCount: 0,
  lastRoundResetAt: "",
  lastRoundResetReason: "",
  recovery: {
    lastRecoveredAt: "",
    recoveredLineCount: 0,
  },
});
const fairRequests = ref<FairTeamBalanceRequest[]>([]);
const loadingFairState = ref(false);
const loadingFairRequests = ref(false);
const fairError = ref("");
const fairRequestsError = ref("");
const actioningRequestId = ref("");
const nowMs = ref(Date.now());
let nowTimer: number | null = null;

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
  void refreshFairPanel();
  startClock();
});

onBeforeUnmount(() => {
  stopClock();
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

async function refreshFairPanel() {
  await Promise.all([loadFairState(), loadFairRequests()]);
}

async function loadFairState() {
  loadingFairState.value = true;
  fairError.value = "";
  try {
    const res = await apiGet<{ ok?: boolean; data?: FairTeamBalanceState }>("/api/plugins/fair-team-balance/state");
    if (res?.data) {
      fairState.value = normalizeFairState(res.data);
    }
  } catch (err: any) {
    fairError.value = String(err?.message || err || "公平跳边状态加载失败");
  } finally {
    loadingFairState.value = false;
  }
}

async function loadFairRequests() {
  loadingFairRequests.value = true;
  fairRequestsError.value = "";
  try {
    const res = await apiGet<{ ok?: boolean; data?: { requests?: FairTeamBalanceRequest[] } }>("/api/plugins/fair-team-balance/requests");
    const requests = Array.isArray(res?.data?.requests) ? res.data.requests : [];
    fairRequests.value = requests.map(normalizeFairRequest);
  } catch (err: any) {
    fairRequestsError.value = String(err?.message || err || "公平跳边申请加载失败");
    fairRequests.value = [];
  } finally {
    loadingFairRequests.value = false;
  }
}

async function approveFairRequest(request: FairTeamBalanceRequest, direct: boolean) {
  if (!request?.id) return;
  actioningRequestId.value = request.id;
  fairRequestsError.value = "";
  try {
    await apiPost("/api/plugins/fair-team-balance/approve", {
      requestId: request.id,
      direct,
    });
    await refreshFairPanel();
    await loadRecords();
  } catch (err: any) {
    fairRequestsError.value = String(err?.message || err || "批准失败");
  } finally {
    actioningRequestId.value = "";
  }
}

async function rejectFairRequest(request: FairTeamBalanceRequest) {
  if (!request?.id) return;
  const reason = window.prompt("输入驳回原因", "manual_reject")?.trim() || "manual_reject";
  actioningRequestId.value = request.id;
  fairRequestsError.value = "";
  try {
    await apiPost("/api/plugins/fair-team-balance/reject", {
      requestId: request.id,
      reason,
    });
    await refreshFairPanel();
    await loadRecords();
  } catch (err: any) {
    fairRequestsError.value = String(err?.message || err || "驳回失败");
  } finally {
    actioningRequestId.value = "";
  }
}

function startClock() {
  stopClock();
  nowTimer = window.setInterval(() => {
    nowMs.value = Date.now();
  }, 1000);
}

function stopClock() {
  if (nowTimer != null) {
    window.clearInterval(nowTimer);
    nowTimer = null;
  }
}

function formatTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function requestRemainingMs(request: FairTeamBalanceRequest) {
  const expiresAt = Date.parse(request?.expiresAt ?? "");
  if (!Number.isFinite(expiresAt)) return 0;
  return Math.max(0, expiresAt - nowMs.value);
}

function formatActor(actor: FairTeamBalanceActor | null) {
  if (!actor) return "-";
  const parts = [actor.playerName || actor.steamId || actor.eosId].filter(Boolean);
  if (actor.steamId) parts.push(actor.steamId);
  return parts.join(" / ");
}

function normalizeFairState(value: FairTeamBalanceState): FairTeamBalanceState {
  return {
    enabled: Boolean(value?.enabled),
    subscribed: Boolean(value?.subscribed),
    active: Boolean(value?.active),
    isWarmup: Boolean(value?.isWarmup),
    logClockSeconds: Number(value?.logClockSeconds ?? 0) || 0,
    publicTbLimit: Number(value?.publicTbLimit ?? 0) || 0,
    publicTbRemaining: Number(value?.publicTbRemaining ?? 0) || 0,
    periodMs: Number(value?.periodMs ?? 0) || 0,
    periodTbLimit: Number(value?.periodTbLimit ?? 0) || 0,
    periodSqtbClaimLimit: Number(value?.periodSqtbClaimLimit ?? 0) || 0,
    requestTtlMs: Number(value?.requestTtlMs ?? 0) || 0,
    roundUsedCount: Number(value?.roundUsedCount ?? 0) || 0,
    activeRequestCount: Number(value?.activeRequestCount ?? 0) || 0,
    pendingClaimCount: Number(value?.pendingClaimCount ?? 0) || 0,
    pendingApprovalCount: Number(value?.pendingApprovalCount ?? 0) || 0,
    lastRoundResetAt: String(value?.lastRoundResetAt ?? ""),
    lastRoundResetReason: String(value?.lastRoundResetReason ?? ""),
    recovery: {
      lastRecoveredAt: String(value?.recovery?.lastRecoveredAt ?? ""),
      recoveredLineCount: Number(value?.recovery?.recoveredLineCount ?? 0) || 0,
    },
  };
}

function normalizeFairRequest(value: FairTeamBalanceRequest): FairTeamBalanceRequest {
  const status = String(value?.status ?? "").trim() || "pending_claim";
  return {
    id: String(value?.id ?? ""),
    code: String(value?.code ?? ""),
    status,
    statusLabel: normalizeRequestStatusLabel(status),
    createdAt: String(value?.createdAt ?? ""),
    expiresAt: String(value?.expiresAt ?? ""),
    applicant: normalizeActor(value?.applicant),
    claimant: value?.claimant ? normalizeActor(value.claimant) : null,
    claimedAt: String(value?.claimedAt ?? ""),
    approvedAt: String(value?.approvedAt ?? ""),
    rejectedAt: String(value?.rejectedAt ?? ""),
    rejectedReason: String(value?.rejectedReason ?? ""),
    directApproval: Boolean(value?.directApproval),
    serverId: String(value?.serverId ?? ""),
    canDirectApprove: Boolean(value?.canDirectApprove),
    canApprove: Boolean(value?.canApprove),
  };
}

function normalizeActor(value: FairTeamBalanceActor | null): FairTeamBalanceActor {
  return {
    playerKey: String(value?.playerKey ?? ""),
    playerName: String(value?.playerName ?? ""),
    steamId: String(value?.steamId ?? ""),
    eosId: String(value?.eosId ?? ""),
    teamId: value?.teamId == null ? null : Number(value.teamId) || null,
    squadId: value?.squadId == null ? null : Number(value.squadId) || null,
  };
}

function normalizeRequestStatusLabel(status: string) {
  switch (status) {
    case "pending_claim":
      return "待认领";
    case "pending_approval":
      return "认领处理中";
    case "approved":
      return "已批准";
    case "rejected":
      return "已驳回";
    case "expired":
      return "已过期";
    default:
      return status || "未知";
  }
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

.tb-fair-card {
  max-width: 1024px;
}

.tb-fair-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 18px;
}

.tb-fair-stat {
  display: grid;
  gap: 6px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.03);
}

.tb-fair-stat span {
  color: var(--color-text-muted);
  font-size: 13px;
}

.tb-fair-stat strong {
  font-size: 18px;
}

.tb-fair-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
  margin-top: 14px;
  color: var(--color-text-muted);
  font-size: 13px;
}

.tb-request-list {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.tb-request {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
}

.tb-request-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.tb-request-main > div {
  display: grid;
  gap: 4px;
}

.tb-request-code {
  color: var(--color-text-muted);
  font-size: 13px;
}

.tb-request-status {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-main);
  font-size: 12px;
  white-space: nowrap;
}

.tb-request-status[data-status="pending_claim"],
.tb-request-status[data-status="pending_approval"] {
  background: rgba(59, 130, 246, 0.16);
  color: #cfe2ff;
}

.tb-request-status[data-status="approved"] {
  background: rgba(34, 197, 94, 0.16);
  color: #bbf7d0;
}

.tb-request-status[data-status="rejected"],
.tb-request-status[data-status="expired"] {
  background: rgba(239, 68, 68, 0.16);
  color: #fecaca;
}

.tb-request-meta,
.tb-request-detail,
.tb-request-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
}

.tb-request-meta span,
.tb-request-detail span {
  color: var(--color-text-muted);
}

.tb-request-actions {
  margin-top: 2px;
}

.tb-secondary-button--danger {
  border-color: rgba(239, 68, 68, 0.45);
  color: #fecaca;
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

  .tb-fair-grid {
    grid-template-columns: 1fr;
  }

  .tb-request-main {
    flex-direction: column;
  }
}
</style>
