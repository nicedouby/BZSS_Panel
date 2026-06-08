<template>
  <section class="page fair-team-balance-page">
    <PageHeader
      eyebrow="Plugin"
      title="均衡组队系统"
      subtitle="管理公平组队插件的状态与请求。系统将自动平衡小队实力并记录所有 TB/SQTB 变更。"
    >
      <template #actions>
        <button
          type="button"
          class="ghost-btn"
          @click="refreshPanel"
        >
          刷新面板
        </button>
      </template>
    </PageHeader>

    <div v-if="stateError" class="error-banner">
      {{ stateError }}
    </div>

    <PageCard class="hero-card" title="系统概览" description="实时监控均衡组队系统的运行状态与核心指标。" compact>
      <template #actions>
        <span class="status-chip subtle">{{ modeLabel }}</span>
      </template>

      <div class="hero-grid">
        <div class="hero-main">
          <div class="hero-badges">
            <span class="status-chip" :data-tone="systemTone">{{ systemStatusLabel }}</span>
            <span class="status-chip subtle">同步延迟: {{ fairState.logClockSeconds }}s</span>
            <span class="status-chip subtle">数据恢复: {{ fairState.recovery.recoveredLineCount }} 条</span>
          </div>

          <dl class="hero-metrics">
            <div>
              <dt>系统状态</dt>
              <dd>{{ systemStatusLabel }}</dd>
            </div>
            <div>
              <dt>当前模式</dt>
              <dd>{{ modeLabel }}</dd>
            </div>
            <div>
              <dt>上次重置时间</dt>
              <dd>{{ formatTime(fairState.lastRoundResetAt) }}</dd>
            </div>
            <div>
              <dt>重置原因</dt>
              <dd>{{ fairState.lastRoundResetReason || "-" }}</dd>
            </div>
          </dl>

          <div class="hero-meta">
            <span>数据更新: {{ formatTime(fairState.recovery.lastRecoveredAt) }}</span>
            <span>公共 TB: {{ fairState.publicTbRemaining }} / {{ fairState.publicTbLimit }}</span>
            <span>待认领: {{ fairState.pendingClaimCount }}</span>
            <span>待审批: {{ fairState.pendingApprovalCount }}</span>
          </div>
        </div>

        <div class="hero-side">
          <div class="broadcast-card">
            <div class="broadcast-card__head">
              <p class="hero-side__label">定时广播记录</p>
              <span class="status-chip subtle">{{ loadingBroadcasts ? "..." : broadcastItems.length }}</span>
            </div>

            <div v-if="broadcastError" class="mini-banner">
              {{ broadcastError }}
            </div>
            <p v-else-if="loadingBroadcasts" class="mini-empty">正在加载定时广播...</p>
            <p v-else-if="!broadcastItems.length" class="mini-empty">暂无定时广播记录</p>
            <div v-else class="broadcast-list">
              <article v-for="item in broadcastItems" :key="item.id" class="broadcast-item">
                <div class="broadcast-item__head">
                  <strong>{{ item.title || "未命名广播" }}</strong>
                  <span :data-tone="item.enabled ? 'ok' : 'muted'">
                    {{ item.enabled ? "已启用" : "已停用" }}
                  </span>
                </div>
                <div class="broadcast-item__meta">
                  <span>上次: {{ formatBroadcastTime(item.lastRunAt) }}</span>
                  <span>下次: {{ formatBroadcastTime(item.nextRunAt) }}</span>
                  <span>成功: {{ item.runCount ?? 0 }}</span>
                </div>
                <p class="broadcast-item__message">{{ item.message || "未配置内容" }}</p>
              </article>
            </div>
          </div>
        </div>
      </div>
    </PageCard>

    <section class="summary-grid" aria-label="均衡组队核心数据概览">
      <article class="summary-card" data-tone="info">
        <span>公共 TB 剩余</span>
        <strong>{{ fairState.publicTbRemaining }} / {{ fairState.publicTbLimit }}</strong>
        <em>当前本局剩余可用 TB 总额</em>
      </article>
      <article class="summary-card" data-tone="info">
        <span>周期 TB 限制</span>
        <strong>{{ fairState.periodTbLimit }}</strong>
        <em>每个滚动周期内允许的 TB 数</em>
      </article>
      <article class="summary-card" data-tone="warning">
        <span>周期 SQTB 限制</span>
        <strong>{{ fairState.periodSqtbClaimLimit }}</strong>
        <em>周期内允许发起的 SQTB 认领数</em>
      </article>
      <article class="summary-card" data-tone="ok">
        <span>本局已用名额</span>
        <strong>{{ fairState.roundUsedCount }}</strong>
        <em>本局已执行的 TB/SQTB 变更</em>
      </article>
      <article class="summary-card" data-tone="warning">
        <span>待认领请求</span>
        <strong>{{ fairState.pendingClaimCount }}</strong>
        <em>玩家已发起但未被管理员认领的请求</em>
      </article>
      <article class="summary-card" data-tone="danger">
        <span>待审批请求</span>
        <strong>{{ fairState.pendingApprovalCount }}</strong>
        <em>管理员已认领但未最终确认的请求</em>
      </article>
    </section>

    <section class="detail-grid">
      <PageCard class="quota-card" title="玩家配额审计" description="监控所有在周期内活跃过的玩家配额使用情况。" compact>
        <template #actions>
          <div class="quota-actions">
            <button
              type="button"
              class="ghost-btn"
              :disabled="resettingAction !== ''"
              @click="resetPeriodQuotas"
            >
              {{ resettingAction === "period" ? "重置中..." : "重置周期额度" }}
            </button>
            <button
              type="button"
              class="ghost-btn"
              :disabled="resettingAction !== ''"
              @click="resetRoundQuota"
            >
              {{ resettingAction === "round" ? "重置中..." : "重置当局额度" }}
            </button>
            <span class="status-chip subtle">总计 {{ sortedPlayerQuotas.length }}</span>
          </div>
        </template>

        <div v-if="quotaError" class="error-banner">
          {{ quotaError }}
        </div>
        <p v-else-if="!sortedPlayerQuotas.length" class="empty-state">暂无活跃玩家配额数据。</p>

        <div v-else class="quota-list">
          <article v-for="quota in sortedPlayerQuotas" :key="quota.playerKey" class="quota-item">
            <div class="quota-item__head">
              <div>
                <strong>{{ quota.playerName || quota.steamId || quota.eosId || "未知玩家" }}</strong>
                <span>{{ quota.steamId || quota.eosId || quota.playerKey }}</span>
              </div>
              <div class="quota-item__head-actions">
                <span class="quota-badge" :data-tone="quota.hasRoundUse ? 'ok' : 'muted'">
                  {{ quota.hasRoundUse ? "本局已使用" : "本局未使用" }}
                </span>
                <button
                  type="button"
                  class="ghost-btn ghost-btn--compact"
                  :disabled="playerResettingKey === quota.playerKey"
                  @click="resetPlayerQuota(quota)"
                >
                  {{ playerResettingKey === quota.playerKey ? "重置中..." : "重置个人额度" }}
                </button>
              </div>
            </div>

            <dl class="quota-grid">
              <div>
                <dt>已用周期 TB</dt>
                <dd>{{ quota.tbUsed }} / {{ fairState.periodTbLimit }}</dd>
              </div>
              <div>
                <dt>已用周期 SQTB</dt>
                <dd>{{ quota.sqtbClaimUsed }} / {{ fairState.periodSqtbClaimLimit }}</dd>
              </div>
              <div>
                <dt>周期起始</dt>
                <dd>{{ formatTime(quota.periodStartedAt) }}</dd>
              </div>
              <div>
                <dt>最近活动</dt>
                <dd>{{ formatTime(quota.lastActivityAt) }}</dd>
              </div>
            </dl>
          </article>
        </div>
      </PageCard>

      <PageCard class="request-card" title="SQTB 实时认领" description="管理所有待处理的 SQTB 认领请求。支持直接审批或认领后审批。" compact>
        <template #actions>
          <button
            type="button"
            class="ghost-btn"
            :disabled="loadingRequests"
            @click="loadRequests"
          >
            {{ loadingRequests ? "同步中..." : "刷新列表" }}
          </button>
        </template>

        <div v-if="requestsError" class="error-banner">
          {{ requestsError }}
        </div>
        <p v-else-if="!requests.length" class="empty-state">暂无待处理的认领请求。</p>

        <div v-else class="request-list">
          <article v-for="request in requests" :key="request.id" class="request-item">
            <div class="request-item__head">
              <div>
                <strong>{{ request.applicant.playerName || request.applicant.steamId || "未知玩家" }}</strong>
                <span>申请码: {{ request.code }}</span>
              </div>
              <span class="request-status" :data-status="request.status">{{ request.statusLabel }}</span>
            </div>

            <dl class="request-grid">
              <div>
                <dt>发起时间</dt>
                <dd>{{ formatTime(request.createdAt) }}</dd>
              </div>
              <div>
                <dt>剩余有效时间</dt>
                <dd>{{ formatDuration(requestRemainingMs(request)) }}</dd>
              </div>
              <div>
                <dt>过期时间</dt>
                <dd>{{ formatTime(request.expiresAt) }}</dd>
              </div>
              <div>
                <dt>发起人</dt>
                <dd>{{ formatActor(request.applicant) }}</dd>
              </div>
              <div>
                <dt>认领人</dt>
                <dd>{{ formatActor(request.claimant) }}</dd>
              </div>
              <div>
                <dt>直接审批</dt>
                <dd>{{ request.directApproval ? "是" : "否" }}</dd>
              </div>
            </dl>

            <div v-if="request.claimedAt || request.approvedAt || request.rejectedReason" class="request-meta">
              <span v-if="request.claimedAt">认领时间: {{ formatTime(request.claimedAt) }}</span>
              <span v-if="request.approvedAt">完成时间: {{ formatTime(request.approvedAt) }}</span>
              <span v-if="request.rejectedReason">拒绝原因: {{ request.rejectedReason }}</span>
            </div>

            <div class="request-actions">
              <button
                v-if="request.canDirectApprove"
                type="button"
                class="action-btn"
                :disabled="actioningRequestId === request.id"
                @click="approveRequest(request, true)"
              >
                直接审批通过
              </button>
              <button
                v-if="request.canApprove"
                type="button"
                class="action-btn"
                :disabled="actioningRequestId === request.id"
                @click="approveRequest(request, false)"
              >
                认领并审批
              </button>
              <button
                type="button"
                class="action-btn danger"
                :disabled="actioningRequestId === request.id"
                @click="rejectRequest(request)"
              >
                拒绝申请
              </button>
            </div>
          </article>
        </div>
      </PageCard>

      <PageCard class="history-card" title="近期变更日志" description="展示最近执行的周期重置与名额消耗记录。" compact>
        <template #actions>
          <div class="history-actions">
            <button
              type="button"
              class="ghost-btn"
              :disabled="loadingHistory"
              @click="loadHistory"
            >
              {{ loadingHistory ? "刷新中..." : "查看历史" }}
            </button>
            <button
              type="button"
              class="danger-btn"
              :disabled="historyClearing"
              @click="clearHistory"
            >
              {{ historyClearing ? "清理中..." : "清理日志" }}
            </button>
          </div>
        </template>

        <div v-if="historyError" class="error-banner">
          {{ historyError }}
        </div>
        <p v-else-if="!history.length" class="empty-state">暂无近期历史记录。</p>

        <div v-else class="history-list">
          <article v-for="(entry, index) in history" :key="index" class="history-item">
            <div class="history-item__head">
              <div>
                <strong>{{ entry.actorName }}</strong>
                <span>{{ formatTime(entry.at) }}</span>
              </div>
              <span class="history-status" :data-status="entry.statusClass">{{ entry.typeLabel }}</span>
            </div>

            <div v-if="entry.reason || entry.message" class="history-meta">
              <span v-if="entry.reason" class="history-reason">原因: {{ entry.reason }}</span>
              <span v-if="entry.message" class="history-message">消息: {{ entry.message }}</span>
            </div>
          </article>
        </div>
      </PageCard>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { apiGet, apiPost } from "../app/apiClient";
import { getScheduledBroadcastState, type ScheduledBroadcastItem } from "../app/scheduledBroadcastApi";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";

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

interface FairTeamBalanceHistoryEntry {
  type: string;
  typeLabel: string;
  statusClass: string;
  at: string;
  actorName: string;
  reason: string;
  message: string;
}

interface FairTeamBalancePlayerQuota {
  playerKey: string;
  playerName: string;
  steamId: string;
  eosId: string;
  periodStartedAt: string;
  periodStartedAtMs: number;
  lastActivityAt: string;
  lastActivityAtMs: number;
  tbUsed: number;
  sqtbClaimUsed: number;
  hasRoundUse: boolean;
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
  playerQuotas: FairTeamBalancePlayerQuota[];
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
  playerQuotas: [],
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
const history = ref<FairTeamBalanceHistoryEntry[]>([]);
const broadcastItems = ref<ScheduledBroadcastItem[]>([]);
const loadingState = ref(false);
const loadingRequests = ref(false);
const loadingHistory = ref(false);
const loadingBroadcasts = ref(false);
const stateError = ref("");
const requestsError = ref("");
const historyError = ref("");
const broadcastError = ref("");
const quotaError = ref("");
const actioningRequestId = ref("");
const playerResettingKey = ref("");
const historyClearing = ref(false);
const resettingAction = ref<"" | "period" | "round">("");
const nowMs = ref(Date.now());
let timer: number | null = null;
let requestsTimer: number | null = null;
let visibilityRefreshHandler: (() => void) | null = null;

const systemStatusLabel = computed(() => {
  if (!fairState.value.enabled) return "禁用中";
  if (!fairState.value.subscribed) return "同步延迟";
  if (fairState.value.active) return "运行中";
  return "准备就绪";
});

const systemTone = computed(() => {
  if (fairState.value.active) return "ok";
  if (!fairState.value.enabled) return "danger";
  if (!fairState.value.subscribed) return "warning";
  return "info";
});

const modeLabel = computed(() => (fairState.value.isWarmup ? "准备阶段" : "正式阶段"));

const sortedPlayerQuotas = computed(() => {
  return [...fairState.value.playerQuotas].sort((left, right) => {
    const leftRecent = Math.max(Number(left.lastActivityAtMs ?? 0), Number(left.periodStartedAtMs ?? 0));
    const rightRecent = Math.max(Number(right.lastActivityAtMs ?? 0), Number(right.periodStartedAtMs ?? 0));
    if (rightRecent !== leftRecent) return rightRecent - leftRecent;

    const leftUsage = Number(left.tbUsed ?? 0) + Number(left.sqtbClaimUsed ?? 0);
    const rightUsage = Number(right.tbUsed ?? 0) + Number(right.sqtbClaimUsed ?? 0);
    if (rightUsage !== leftUsage) return rightUsage - leftUsage;

    return String(left.playerName || left.steamId || left.eosId || left.playerKey).localeCompare(
      String(right.playerName || right.steamId || right.eosId || right.playerKey),
    );
  });
});

onMounted(() => {
  void refreshPanel();
  timer = window.setInterval(() => {
    nowMs.value = Date.now();
  }, 1000);
  requestsTimer = window.setInterval(() => {
    if (document.visibilityState === "visible" && !loadingRequests.value) {
      void loadRequests();
    }
  }, 1200);
  visibilityRefreshHandler = () => {
    if (document.visibilityState === "visible" && !loadingRequests.value) {
      void loadRequests();
    }
  };
  document.addEventListener("visibilitychange", visibilityRefreshHandler);
  window.addEventListener("focus", visibilityRefreshHandler);
});

onBeforeUnmount(() => {
  if (timer != null) {
    window.clearInterval(timer);
    timer = null;
  }
  if (requestsTimer != null) {
    window.clearInterval(requestsTimer);
    requestsTimer = null;
  }
  if (visibilityRefreshHandler) {
    document.removeEventListener("visibilitychange", visibilityRefreshHandler);
    window.removeEventListener("focus", visibilityRefreshHandler);
    visibilityRefreshHandler = null;
  }
});

async function refreshPanel() {
  quotaError.value = "";
  await Promise.all([loadState(), loadRequests(), loadHistory(), loadBroadcastState()]);
}

async function loadState() {
  loadingState.value = true;
  stateError.value = "";
  try {
    const res = await apiGet<{ ok?: boolean; data?: FairTeamBalanceState }>("/api/plugins/fair-team-balance/state");
    fairState.value = normalizeState(res?.data);
  } catch (err: any) {
    stateError.value = String(err?.message || err || "加载系统状态失败");
  } finally {
    loadingState.value = false;
  }
}

async function loadRequests() {
  if (loadingRequests.value) return;
  loadingRequests.value = true;
  requestsError.value = "";
  try {
    const res = await apiGet<{ ok?: boolean; data?: { requests?: FairTeamBalanceRequest[] } }>("/api/plugins/fair-team-balance/requests");
    const list = Array.isArray(res?.data?.requests) ? res.data.requests : [];
    requests.value = list.map(normalizeRequest);
  } catch (err: any) {
    requestsError.value = String(err?.message || err || "加载认领请求失败");
    requests.value = [];
  } finally {
    loadingRequests.value = false;
  }
}

async function loadHistory() {
  loadingHistory.value = true;
  historyError.value = "";
  try {
    const res = await apiGet<{ ok?: boolean; data?: { history?: any[] } }>("/api/plugins/fair-team-balance/history?limit=50");
    const list = Array.isArray(res?.data?.history) ? res.data.history : [];
    history.value = list.map(normalizeHistoryEntry);
  } catch (err: any) {
    historyError.value = String(err?.message || err || "加载历史记录失败");
    history.value = [];
  } finally {
    loadingHistory.value = false;
  }
}

async function loadBroadcastState() {
  loadingBroadcasts.value = true;
  broadcastError.value = "";
  try {
    const res = await getScheduledBroadcastState();
    const list = Array.isArray(res?.items) ? res.items : [];
    broadcastItems.value = [...list]
      .sort((left, right) => {
        const leftTime = Math.max(Number(left.lastRunAt ?? 0), Number(left.updatedAt ?? 0), Number(left.createdAt ?? 0));
        const rightTime = Math.max(Number(right.lastRunAt ?? 0), Number(right.updatedAt ?? 0), Number(right.createdAt ?? 0));
        return rightTime - leftTime;
      })
      .slice(0, 4);
  } catch (err: any) {
    broadcastError.value = String(err?.message || err || "加载定时广播记录失败");
    broadcastItems.value = [];
  } finally {
    loadingBroadcasts.value = false;
  }
}

async function resetPeriodQuotas() {
  if (!window.confirm("确定重置所有周期额度吗？这将同时清空个人额度和当局额度。")) return;
  resettingAction.value = "period";
  quotaError.value = "";
  try {
    await apiPost("/api/plugins/fair-team-balance/reset-period-quotas", {});
    await refreshPanel();
  } catch (err: any) {
    quotaError.value = String(err?.message || err || "重置周期配额失败");
  } finally {
    resettingAction.value = "";
  }
}

async function resetRoundQuota() {
  if (!window.confirm("确定重置当局额度吗？")) return;
  resettingAction.value = "round";
  quotaError.value = "";
  try {
    await apiPost("/api/plugins/fair-team-balance/reset-round", {});
    await refreshPanel();
  } catch (err: any) {
    quotaError.value = String(err?.message || err || "重置单局配额失败");
  } finally {
    resettingAction.value = "";
  }
}

async function resetPlayerQuota(quota: FairTeamBalancePlayerQuota) {
  if (!quota?.playerKey) return;
  if (!window.confirm(`确定重置 ${quota.playerName || quota.steamId || quota.playerKey} 的个人额度吗？`)) return;
  playerResettingKey.value = quota.playerKey;
  quotaError.value = "";
  try {
    await apiPost("/api/plugins/fair-team-balance/reset-player-quota", {
      playerKey: quota.playerKey,
    });
    await refreshPanel();
  } catch (err: any) {
    quotaError.value = String(err?.message || err || "重置个人额度失败");
  } finally {
    playerResettingKey.value = "";
  }
}

async function clearHistory() {
  if (!window.confirm("确定清理近期变更日志吗？这会删除当前插件历史记录文件。")) return;
  historyClearing.value = true;
  historyError.value = "";
  try {
    await apiPost("/api/plugins/fair-team-balance/clear-history", {});
    await loadHistory();
  } catch (err: any) {
    historyError.value = String(err?.message || err || "清理日志失败");
  } finally {
    historyClearing.value = false;
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
    requestsError.value = String(err?.message || err || "审批请求失败");
  } finally {
    actioningRequestId.value = "";
  }
}

async function rejectRequest(request: FairTeamBalanceRequest) {
  if (!request?.id) return;
  const reason = window.prompt("请输入拒绝原因", "manual_reject")?.trim() || "manual_reject";
  actioningRequestId.value = request.id;
  requestsError.value = "";
  try {
    await apiPost("/api/plugins/fair-team-balance/reject", {
      requestId: request.id,
      reason,
    });
    await refreshPanel();
  } catch (err: any) {
    requestsError.value = String(err?.message || err || "拒绝请求失败");
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

function formatBroadcastTime(value: number | null | undefined) {
  const time = Number(value ?? 0);
  if (!Number.isFinite(time) || time <= 0) return "-";
  return new Date(time).toLocaleString();
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
    playerQuotas: Array.isArray(value?.playerQuotas) ? value.playerQuotas.map(normalizePlayerQuota) : [],
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

function normalizePlayerQuota(value: Partial<FairTeamBalancePlayerQuota>): FairTeamBalancePlayerQuota {
  return {
    playerKey: String(value?.playerKey ?? ""),
    playerName: String(value?.playerName ?? ""),
    steamId: String(value?.steamId ?? ""),
    eosId: String(value?.eosId ?? ""),
    periodStartedAt: String(value?.periodStartedAt ?? ""),
    periodStartedAtMs: Number(value?.periodStartedAtMs ?? 0) || 0,
    lastActivityAt: String(value?.lastActivityAt ?? ""),
    lastActivityAtMs: Number(value?.lastActivityAtMs ?? 0) || 0,
    tbUsed: Number(value?.tbUsed ?? 0) || 0,
    sqtbClaimUsed: Number(value?.sqtbClaimUsed ?? 0) || 0,
    hasRoundUse: Boolean(value?.hasRoundUse),
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

function normalizeHistoryEntry(value: any): FairTeamBalanceHistoryEntry {
  const type = String(value?.type ?? "");
  const applicantName = value?.applicant?.playerName || value?.applicant?.steamId || "";
  const claimantName = value?.claimant?.playerName || value?.claimant?.steamId || "";
  const approverName = value?.approvedBy?.name || value?.approvedBy?.username || value?.approvedBy?.id || "";
  const rejectorName = value?.rejectedBy?.name || value?.rejectedBy?.username || value?.rejectedBy?.id || "";
  let actorName = value?.playerName || applicantName || value?.steamId || value?.applicant?.steamId || "未知玩家";

  let typeLabel = type;
  let statusClass = "info";

  switch(type) {
    case "TB_REQUESTED": typeLabel = "请求 TB"; statusClass = "info"; break;
    case "TB_EXECUTED": typeLabel = "TB 执行完成"; statusClass = "ok"; break;
    case "TB_REJECTED": typeLabel = "TB 被拒绝"; statusClass = "danger"; break;
    case "SQTB_CREATED": typeLabel = "发起 SQTB"; statusClass = "info"; break;
    case "SQTB_CLAIMED": typeLabel = "认领 SQTB"; statusClass = "info"; actorName = claimantName || actorName; break;
    case "SQTB_CLAIM_REJECTED": typeLabel = "认领被拒绝"; statusClass = "danger"; actorName = claimantName || actorName; break;
    case "SQTB_APPROVAL_REJECTED": typeLabel = "准许被拒绝"; statusClass = "danger"; actorName = approverName || actorName; break;
    case "SQTB_APPROVED": typeLabel = "准许 SQTB"; statusClass = "ok"; actorName = approverName || claimantName || actorName; break;
    case "SQTB_REJECTED": typeLabel = "SQTB 被拒绝"; statusClass = "danger"; break;
    case "SQTB_EXPIRED": typeLabel = "SQTB 已过期"; statusClass = "warning"; break;
  }

  if (type === "SQTB_REJECTED") {
    actorName = rejectorName || approverName || claimantName || actorName;
  }

  return {
    type,
    typeLabel,
    statusClass,
    at: String(value?.at ?? value?.time ?? ""),
    actorName: String(actorName),
    reason: String(value?.reason ?? value?.rejectedReason ?? ""),
    message: String(value?.message ?? ""),
  };
}

function normalizeStatusLabel(status: string) {
  switch (status) {
    case "pending_claim":
      return "待认领";
    case "pending_approval":
      return "审批中";
    case "approved":
      return "已审批";
    case "rejected":
      return "已拒绝";
    case "expired":
      return "已过期";
    default:
      return status || "未知";
  }
}
</script>

<style scoped>
.fair-team-balance-page {
  position: relative;
  display: grid;
  gap: 18px;
  padding: 16px;
  overflow: visible;
}

.fair-team-balance-page::before {
  content: "";
  position: absolute;
  inset: -80px auto auto -120px;
  width: 280px;
  height: 280px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(56, 189, 248, 0.18), transparent 68%);
  pointer-events: none;
  filter: blur(8px);
}

.fair-team-balance-page::after {
  content: "";
  position: absolute;
  inset: auto -100px -120px auto;
  width: 320px;
  height: 320px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(34, 197, 94, 0.12), transparent 68%);
  pointer-events: none;
  filter: blur(10px);
}

.fair-team-balance-page > * {
  position: relative;
  z-index: 1;
}

.fair-team-balance-page :deep(.page-card) {
  border-color: rgba(148, 163, 184, 0.16);
  background:
    radial-gradient(circle at top right, rgba(56, 189, 248, 0.12), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.024)), rgba(255, 255, 255, 0.01)),
    var(--color-bg-card);
  box-shadow: 0 18px 36px rgba(2, 6, 23, 0.28);
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.fair-team-balance-page :deep(.page-card:hover) {
  transform: translateY(-1px);
  border-color: rgba(96, 165, 250, 0.28);
  box-shadow: 0 22px 42px rgba(2, 6, 23, 0.32);
}

.fair-team-balance-page :deep(.card-header) {
  padding: 16px 18px 0;
}

.fair-team-balance-page :deep(.card-body) {
  padding: 18px;
}

.hero-card,
.quota-card,
.request-card {
  min-width: 0;
}

.request-card {
}

.hero-grid,
.detail-grid {
  display: grid;
  gap: 16px;
}

.hero-grid {
  grid-template-columns: minmax(0, 1.55fr) minmax(260px, 0.85fr);
  align-items: start;
}

.hero-main,
.hero-side {
  min-width: 0;
}

.hero-badges {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.status-chip.subtle {
  color: var(--color-text-muted);
}

.status-chip[data-tone="ok"] {
  border-color: rgba(34, 197, 94, 0.36);
  background: rgba(34, 197, 94, 0.12);
  color: #bbf7d0;
}

.status-chip[data-tone="info"] {
  border-color: rgba(59, 130, 246, 0.32);
  background: rgba(59, 130, 246, 0.12);
  color: #cfe2ff;
}

.status-chip[data-tone="warning"] {
  border-color: rgba(245, 158, 11, 0.32);
  background: rgba(245, 158, 11, 0.12);
  color: #fde68a;
}

.status-chip[data-tone="danger"] {
  border-color: rgba(239, 68, 68, 0.32);
  background: rgba(239, 68, 68, 0.12);
  color: #fecaca;
}

.hero-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.hero-metrics > div {
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 16px;
  padding: 12px 14px;
  background: rgba(15, 23, 42, 0.24);
}

.hero-metrics dt,
.quota-grid dt,
.request-grid dt {
  font-size: 11px;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.hero-metrics dd,
.quota-grid dd,
.request-grid dd {
  margin: 6px 0 0;
  color: var(--color-text-primary);
  line-height: 1.45;
}

.hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-top: 12px;
  color: var(--color-text-secondary);
  font-size: 11px;
}

.hero-side {
  display: grid;
  gap: 12px;
  align-content: start;
  padding: 14px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.22);
}

.hero-side__label {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.action-stack {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.hero-side__note,
.empty-state,
.request-meta {
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.broadcast-card {
  display: grid;
  gap: 8px;
  padding-top: 4px;
}

.broadcast-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.broadcast-list {
  display: grid;
  gap: 8px;
}

.broadcast-item {
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 12px;
  padding: 10px 12px;
  background: rgba(15, 23, 42, 0.18);
  display: grid;
  gap: 6px;
}

.broadcast-item__head,
.broadcast-item__meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: space-between;
}

.broadcast-item__head strong {
  font-size: 13px;
}

.broadcast-item__head span {
  font-size: 11px;
  color: var(--color-text-muted);
}

.broadcast-item__meta {
  color: var(--color-text-muted);
  font-size: 11px;
  line-height: 1.4;
}

.broadcast-item__message {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.mini-banner,
.mini-empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}

.summary-card {
  display: grid;
  gap: 6px;
  padding: 14px 15px;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background:
    radial-gradient(circle at top right, rgba(56, 189, 248, 0.08), transparent 36%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.018));
  box-shadow: 0 16px 28px rgba(2, 6, 23, 0.2);
  min-height: 96px;
}

.summary-card[data-tone="ok"] {
  border-color: rgba(34, 197, 94, 0.2);
}

.summary-card[data-tone="warning"] {
  border-color: rgba(245, 158, 11, 0.22);
}

.summary-card[data-tone="danger"] {
  border-color: rgba(239, 68, 68, 0.22);
}

.summary-card span {
  font-size: 12px;
  color: var(--color-text-muted);
}

.summary-card strong {
  font-size: 26px;
  line-height: 1.05;
  letter-spacing: -0.03em;
}

.summary-card em {
  font-style: normal;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.detail-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: stretch;
  min-height: 0;
}

.detail-grid :deep(.page-card) {
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.detail-grid :deep(.card-body) {
  min-height: 0;
  height: 100%;
  overflow: hidden;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
}

.quota-list,
.request-list,
.history-list {
  display: grid;
  gap: 12px;
  min-height: 0;
}

.detail-grid {
  height: clamp(580px, calc(100vh - 360px), 940px);
  max-height: calc(100vh - 360px);
}

.quota-card,
.request-card,
.history-card {
  min-height: 0;
}

.quota-card :deep(.card-body),
.request-card :deep(.card-body),
.history-card :deep(.card-body) {
  min-height: 0;
}

.quota-list,
.request-list,
.history-list {
  overflow: auto;
  scrollbar-gutter: stable;
  padding-right: 4px;
  overscroll-behavior: contain;
}

.quota-item,
.request-item,
.history-item {
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 12px;
  padding: 12px;
  background: rgba(15, 23, 42, 0.18);
}

.quota-item__head,
.request-item__head,
.history-item__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}

.quota-item__head > div,
.request-item__head > div,
.history-item__head > div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.quota-item__head strong,
.request-item__head strong,
.history-item__head strong {
  font-size: 15px;
}

.quota-item__head span,
.request-item__head span,
.history-item__head span {
  color: var(--color-text-muted);
  font-size: 12px;
  word-break: break-all;
}

.quota-badge,
.request-status,
.history-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(255, 255, 255, 0.05);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.quota-badge[data-tone="ok"],
.request-status[data-status="approved"],
.history-status[data-status="ok"] {
  border-color: rgba(34, 197, 94, 0.28);
  background: rgba(34, 197, 94, 0.12);
  color: #bbf7d0;
}

.quota-badge[data-tone="muted"],
.history-status[data-status="info"] {
  color: var(--color-text-muted);
}

.request-status[data-status="pending_claim"],
.request-status[data-status="pending_approval"] {
  border-color: rgba(59, 130, 246, 0.24);
  background: rgba(59, 130, 246, 0.12);
  color: #cfe2ff;
}

.request-status[data-status="rejected"],
.request-status[data-status="expired"],
.history-status[data-status="danger"] {
  border-color: rgba(239, 68, 68, 0.24);
  background: rgba(239, 68, 68, 0.12);
  color: #fecaca;
}

.history-status[data-status="warning"] {
  border-color: rgba(245, 158, 11, 0.24);
  background: rgba(245, 158, 11, 0.12);
  color: #fde68a;
}

.quota-grid,
.request-grid {
  display: grid;
  gap: 12px;
  margin: 0;
}

.quota-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.request-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.request-meta,
.history-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
}

.history-meta span {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.request-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}

.quota-actions,
.history-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.quota-item__head-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}

.ghost-btn,
.danger-btn,
.action-btn {
  min-height: 36px;
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  cursor: pointer;
  font-weight: 700;
  transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease, opacity 0.15s ease;
}

.ghost-btn {
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
}

.ghost-btn--compact {
  min-height: 32px;
  padding: 0 10px;
  border-radius: 10px;
}

.danger-btn,
.action-btn.danger {
  border-color: rgba(239, 68, 68, 0.28);
  background: rgba(239, 68, 68, 0.1);
  color: #fecaca;
}

.action-btn {
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
}

.ghost-btn:hover:not(:disabled),
.danger-btn:hover:not(:disabled),
.action-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: rgba(96, 165, 250, 0.32);
}

.ghost-btn:disabled,
.danger-btn:disabled,
.action-btn:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.error-banner {
  border-radius: 14px;
  padding: 12px 14px;
  border: 1px solid rgba(239, 68, 68, 0.22);
  background: rgba(239, 68, 68, 0.12);
  color: #fecaca;
}

.empty-state {
  margin: 0;
  padding: 12px 0 4px;
}

@media (max-width: 1280px) {
  .hero-grid {
    grid-template-columns: minmax(0, 1.3fr) minmax(240px, 0.9fr);
  }
}

@media (max-width: 900px) {
  .hero-grid,
  .detail-grid {
    grid-template-columns: 1fr;
  }

  .action-stack {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .fair-team-balance-page {
    padding: 12px;
  }

  .summary-grid,
  .hero-metrics,
  .quota-grid,
  .request-grid {
    grid-template-columns: 1fr;
  }

  .quota-item__head,
  .request-item__head {
    display: grid;
  }

  .request-actions,
  .hero-meta {
    gap: 8px 10px;
  }
}
</style>
