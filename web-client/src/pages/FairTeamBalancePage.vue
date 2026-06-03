<template>
  <main class="fair-page">
    <section class="fair-hero">
      <div>
        <p class="fair-kicker">Plugin</p>
        <h1>公平跳边</h1>
        <p class="fair-summary">
          处理聊天触发的 `tb`、`sqtb` 与认领审批。页面仅负责状态查看和管理员审批。
        </p>
      </div>
      <button
        type="button"
        class="fair-refresh"
        :disabled="loadingState || loadingRequests"
        @click="refreshPanel"
      >
        {{ loadingState || loadingRequests ? "刷新中..." : "刷新状态" }}
      </button>
    </section>

    <p v-if="stateError" class="fair-error">{{ stateError }}</p>

    <section v-else class="fair-panel">
      <header class="fair-panel__header">
        <div>
          <h2>当前额度</h2>
          <p>对局公共额度、18 小时周期额度和当前模式。</p>
        </div>
      </header>

      <div class="fair-stats">
        <article class="fair-stat">
          <span>插件状态</span>
          <strong>{{ fairState.active ? "运行中" : fairState.enabled ? "未订阅" : "已禁用" }}</strong>
        </article>
        <article class="fair-stat">
          <span>当前模式</span>
          <strong>{{ fairState.isWarmup ? "暖服模式" : "常规模式" }}</strong>
        </article>
        <article class="fair-stat">
          <span>日志时间</span>
          <strong>{{ fairState.logClockSeconds }}s</strong>
        </article>
        <article class="fair-stat">
          <span>公共 TB 剩余</span>
          <strong>{{ fairState.publicTbRemaining }} / {{ fairState.publicTbLimit }}</strong>
        </article>
        <article class="fair-stat">
          <span>个人 TB 额度</span>
          <strong>{{ fairState.periodTbLimit }} / 18h</strong>
        </article>
        <article class="fair-stat">
          <span>个人 SQTB/认领额度</span>
          <strong>{{ fairState.periodSqtbClaimLimit }} / 18h</strong>
        </article>
        <article class="fair-stat">
          <span>本局已占用人数</span>
          <strong>{{ fairState.roundUsedCount }}</strong>
        </article>
        <article class="fair-stat">
          <span>待认领</span>
          <strong>{{ fairState.pendingClaimCount }}</strong>
        </article>
        <article class="fair-stat">
          <span>待审批</span>
          <strong>{{ fairState.pendingApprovalCount }}</strong>
        </article>
      </div>

      <div class="fair-meta">
        <span>上次对局重置: {{ formatTime(fairState.lastRoundResetAt) }}</span>
        <span>重置原因: {{ fairState.lastRoundResetReason || "-" }}</span>
        <span>日志恢复: {{ formatTime(fairState.recovery.lastRecoveredAt) }}</span>
        <span>恢复条数: {{ fairState.recovery.recoveredLineCount }}</span>
      </div>
    </section>

    <section class="fair-panel">
      <header class="fair-panel__header">
        <div>
          <h2>SQTB 待处理申请</h2>
          <p>发起 `sqtb` 后会在服内广播认领码，认领后进入待审批。</p>
        </div>
        <button
          type="button"
          class="fair-refresh fair-refresh--ghost"
          :disabled="loadingRequests"
          @click="loadRequests"
        >
          {{ loadingRequests ? "刷新中..." : "刷新申请" }}
        </button>
      </header>

      <p v-if="requestsError" class="fair-error">{{ requestsError }}</p>
      <p v-else-if="!requests.length" class="fair-empty">当前没有待处理申请。</p>

      <div v-else class="fair-request-list">
        <article v-for="request in requests" :key="request.id" class="fair-request">
          <div class="fair-request__top">
            <div>
              <strong>{{ request.applicant.playerName || request.applicant.steamId || "未知玩家" }}</strong>
              <span class="fair-request__code">认领码 {{ request.code }}</span>
            </div>
            <span class="fair-request__status" :data-status="request.status">{{ request.statusLabel }}</span>
          </div>

          <div class="fair-request__meta">
            <span>申请时间: {{ formatTime(request.createdAt) }}</span>
            <span>剩余时效: {{ formatDuration(requestRemainingMs(request)) }}</span>
            <span>到期时间: {{ formatTime(request.expiresAt) }}</span>
          </div>

          <div class="fair-request__meta">
            <span>申请者: {{ formatActor(request.applicant) }}</span>
            <span>认领者: {{ formatActor(request.claimant) }}</span>
            <span>直批: {{ request.directApproval ? "是" : "否" }}</span>
          </div>

          <div v-if="request.claimedAt || request.approvedAt || request.rejectedReason" class="fair-request__meta">
            <span v-if="request.claimedAt">认领时间: {{ formatTime(request.claimedAt) }}</span>
            <span v-if="request.approvedAt">审批时间: {{ formatTime(request.approvedAt) }}</span>
            <span v-if="request.rejectedReason">驳回原因: {{ request.rejectedReason }}</span>
          </div>

          <div class="fair-request__actions">
            <button
              v-if="request.canDirectApprove"
              type="button"
              class="fair-action"
              :disabled="actioningRequestId === request.id"
              @click="approveRequest(request, true)"
            >
              直接批准
            </button>
            <button
              v-if="request.canApprove"
              type="button"
              class="fair-action"
              :disabled="actioningRequestId === request.id"
              @click="approveRequest(request, false)"
            >
              批准跳边
            </button>
            <button
              type="button"
              class="fair-action fair-action--danger"
              :disabled="actioningRequestId === request.id"
              @click="rejectRequest(request)"
            >
              驳回
            </button>
          </div>
        </article>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { apiGet, apiPost } from "../app/apiClient";

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

const requests = ref<FairTeamBalanceRequest[]>([]);
const loadingState = ref(false);
const loadingRequests = ref(false);
const stateError = ref("");
const requestsError = ref("");
const actioningRequestId = ref("");
const nowMs = ref(Date.now());
let timer: number | null = null;

onMounted(() => {
  void refreshPanel();
  timer = window.setInterval(() => {
    nowMs.value = Date.now();
  }, 1000);
});

onBeforeUnmount(() => {
  if (timer != null) {
    window.clearInterval(timer);
    timer = null;
  }
});

async function refreshPanel() {
  await Promise.all([loadState(), loadRequests()]);
}

async function loadState() {
  loadingState.value = true;
  stateError.value = "";
  try {
    const res = await apiGet<{ ok?: boolean; data?: FairTeamBalanceState }>("/api/plugins/fair-team-balance/state");
    fairState.value = normalizeState(res?.data);
  } catch (err: any) {
    stateError.value = String(err?.message || err || "公平跳边状态加载失败");
  } finally {
    loadingState.value = false;
  }
}

async function loadRequests() {
  loadingRequests.value = true;
  requestsError.value = "";
  try {
    const res = await apiGet<{ ok?: boolean; data?: { requests?: FairTeamBalanceRequest[] } }>("/api/plugins/fair-team-balance/requests");
    const list = Array.isArray(res?.data?.requests) ? res.data.requests : [];
    requests.value = list.map(normalizeRequest);
  } catch (err: any) {
    requestsError.value = String(err?.message || err || "公平跳边申请加载失败");
    requests.value = [];
  } finally {
    loadingRequests.value = false;
  }
}

async function approveRequest(request: FairTeamBalanceRequest, direct: boolean) {
  if (!request?.id) return;
  actioningRequestId.value = request.id;
  requestsError.value = "";
  try {
    await apiPost("/api/plugins/fair-team-balance/approve", {
      requestId: request.id,
      direct,
    });
    await refreshPanel();
  } catch (err: any) {
    requestsError.value = String(err?.message || err || "公平跳边审批失败");
  } finally {
    actioningRequestId.value = "";
  }
}

async function rejectRequest(request: FairTeamBalanceRequest) {
  if (!request?.id) return;
  const reason = window.prompt("输入驳回原因", "manual_reject")?.trim() || "manual_reject";
  actioningRequestId.value = request.id;
  requestsError.value = "";
  try {
    await apiPost("/api/plugins/fair-team-balance/reject", {
      requestId: request.id,
      reason,
    });
    await refreshPanel();
  } catch (err: any) {
    requestsError.value = String(err?.message || err || "公平跳边驳回失败");
  } finally {
    actioningRequestId.value = "";
  }
}

function requestRemainingMs(request: FairTeamBalanceRequest) {
  const expiresAt = Date.parse(String(request?.expiresAt ?? ""));
  if (!Number.isFinite(expiresAt)) return 0;
  return Math.max(0, expiresAt - nowMs.value);
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

function formatActor(actor: FairTeamBalanceActor | null) {
  if (!actor) return "-";
  const parts = [actor.playerName || actor.steamId || actor.eosId].filter(Boolean);
  if (actor.steamId) parts.push(actor.steamId);
  return parts.join(" / ");
}

function normalizeState(value?: Partial<FairTeamBalanceState> | null): FairTeamBalanceState {
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

function normalizeRequest(value: FairTeamBalanceRequest): FairTeamBalanceRequest {
  const status = String(value?.status ?? "").trim() || "pending_claim";
  return {
    id: String(value?.id ?? ""),
    code: String(value?.code ?? ""),
    status,
    statusLabel: normalizeStatusLabel(status),
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

function normalizeActor(value?: Partial<FairTeamBalanceActor> | null): FairTeamBalanceActor {
  return {
    playerKey: String(value?.playerKey ?? ""),
    playerName: String(value?.playerName ?? ""),
    steamId: String(value?.steamId ?? ""),
    eosId: String(value?.eosId ?? ""),
    teamId: value?.teamId == null ? null : Number(value.teamId) || null,
    squadId: value?.squadId == null ? null : Number(value.squadId) || null,
  };
}

function normalizeStatusLabel(status: string) {
  switch (status) {
    case "pending_claim":
      return "待认领";
    case "pending_approval":
      return "待审批";
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
.fair-page {
  padding: 24px;
  display: grid;
  gap: 18px;
}

.fair-hero,
.fair-panel {
  border: 1px solid var(--color-border-default);
  border-radius: 18px;
  background:
    radial-gradient(circle at top right, rgba(56, 189, 248, 0.14), transparent 32%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.02));
  padding: 22px;
}

.fair-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.fair-kicker {
  margin: 0 0 8px;
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #7dd3fc;
}

.fair-hero h1,
.fair-panel h2 {
  margin: 0;
}

.fair-summary,
.fair-panel__header p,
.fair-meta,
.fair-request__meta {
  color: var(--color-text-muted);
}

.fair-summary {
  margin: 10px 0 0;
  max-width: 680px;
}

.fair-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.fair-panel__header p {
  margin: 8px 0 0;
}

.fair-refresh,
.fair-action {
  min-height: 38px;
  padding: 0 16px;
  border-radius: 10px;
  border: 1px solid var(--color-border-default);
  background: rgba(125, 211, 252, 0.08);
  color: var(--color-text-main);
  cursor: pointer;
}

.fair-refresh--ghost {
  background: transparent;
}

.fair-stats {
  margin-top: 18px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.fair-stat {
  display: grid;
  gap: 6px;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid rgba(125, 211, 252, 0.18);
  background: rgba(15, 23, 42, 0.22);
}

.fair-stat span {
  font-size: 13px;
  color: var(--color-text-muted);
}

.fair-stat strong {
  font-size: 18px;
}

.fair-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 16px;
  margin-top: 14px;
}

.fair-request-list {
  margin-top: 18px;
  display: grid;
  gap: 12px;
}

.fair-request {
  display: grid;
  gap: 10px;
  padding: 16px;
  border-radius: 14px;
  border: 1px solid rgba(125, 211, 252, 0.16);
  background: rgba(15, 23, 42, 0.18);
}

.fair-request__top,
.fair-request__actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.fair-request__top > div {
  display: grid;
  gap: 4px;
}

.fair-request__code {
  color: var(--color-text-muted);
  font-size: 13px;
}

.fair-request__status {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  white-space: nowrap;
  background: rgba(255, 255, 255, 0.08);
}

.fair-request__status[data-status="pending_claim"],
.fair-request__status[data-status="pending_approval"] {
  background: rgba(59, 130, 246, 0.18);
  color: #cfe2ff;
}

.fair-request__status[data-status="approved"] {
  background: rgba(34, 197, 94, 0.18);
  color: #bbf7d0;
}

.fair-request__status[data-status="rejected"],
.fair-request__status[data-status="expired"] {
  background: rgba(239, 68, 68, 0.18);
  color: #fecaca;
}

.fair-request__meta,
.fair-request__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
}

.fair-action--danger {
  border-color: rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.08);
  color: #fecaca;
}

.fair-empty,
.fair-error {
  margin-top: 16px;
}

.fair-error {
  color: #fca5a5;
}

@media (max-width: 860px) {
  .fair-stats {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 720px) {
  .fair-page {
    padding: 16px;
  }

  .fair-hero,
  .fair-panel,
  .fair-panel__header,
  .fair-request__top {
    display: grid;
  }

  .fair-stats {
    grid-template-columns: 1fr;
  }
}
</style>
