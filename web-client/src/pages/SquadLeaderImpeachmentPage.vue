<template>
  <section class="impeachment-page">
    <!-- Header -->
    <header class="page-header">
      <div>
        <p class="eyebrow">SQUAD MODERATION</p>
        <h1>弹劾队长</h1>
        <p class="subtitle">实时查看玩家交互、加权投票、执行结果和审计记录。</p>
      </div>
      <div class="header-actions">
        <button type="button" class="btn ghost" :disabled="loading" @click="refresh">
          {{ loading ? "刷新中..." : "刷新" }}
        </button>
        <button type="button" class="btn danger-outline" :disabled="clearingCooldowns" @click="clearCooldowns">
          {{ clearingCooldowns ? "清除中..." : "清除冷却" }}
        </button>
      </div>
    </header>

    <!-- Quick Navigation to Related Player Moderation Features -->
    <nav class="related-features-nav" aria-label="关联玩家管理功能">
      <span class="nav-label">关联功能：</span>
      <div class="pill-group">
        <RouterLink to="/squadbrowser-player-lookup" class="feature-pill">
          <span class="pill-icon">🔍</span>
          <span>查成分</span>
        </RouterLink>
        <RouterLink to="/black-edge-privilege" class="feature-pill">
          <span class="pill-icon">🔑</span>
          <span>黑奴跳边 CDK</span>
        </RouterLink>
        <RouterLink to="/player-session-records" class="feature-pill">
          <span class="pill-icon">🕛</span>
          <span>进出服记录</span>
        </RouterLink>
        <RouterLink to="/squad-management" class="feature-pill">
          <span class="pill-icon">💻</span>
          <span>小队管理</span>
        </RouterLink>
        <RouterLink to="/plugins/group-report" class="feature-pill">
          <span class="pill-icon">🚩</span>
          <span>组队举报</span>
        </RouterLink>
        <RouterLink to="/squad-rule-chain" class="feature-pill">
          <span class="pill-icon">🔗</span>
          <span>建队规则链</span>
        </RouterLink>
        <RouterLink to="/plugins/panel-ban" class="feature-pill">
          <span class="pill-icon">🚫</span>
          <span>面板封禁</span>
        </RouterLink>
      </div>
    </nav>

    <!-- Error Banner -->
    <div v-if="error" class="banner error-banner">
      <span class="banner-icon">⚠️</span>
      <span>{{ error }}</span>
    </div>

    <!-- Summary Metrics -->
    <section class="metrics-grid">
      <article class="metric-card">
        <span class="metric-icon">💬</span>
        <div class="metric-info">
          <span class="metric-label">当前交互</span>
          <strong class="metric-val">{{ data.interactions?.length ?? 0 }}</strong>
        </div>
      </article>
      <article class="metric-card highlight">
        <span class="metric-icon">⚖️</span>
        <div class="metric-info">
          <span class="metric-label">进行中投票</span>
          <strong class="metric-val">{{ data.votes?.length ?? 0 }}</strong>
        </div>
      </article>
      <article class="metric-card">
        <span class="metric-icon">📜</span>
        <div class="metric-info">
          <span class="metric-label">审计记录条目</span>
          <strong class="metric-val">{{ data.audit?.length ?? 0 }}</strong>
        </div>
      </article>
    </section>

    <!-- Section 1: Active Interactions -->
    <section class="panel">
      <header class="panel-head">
        <h3>当前玩家交互 ({{ data.interactions?.length ?? 0 }})</h3>
      </header>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>发起玩家</th>
              <th>阶段 (Stage)</th>
              <th>目标小队</th>
              <th>剩余倒计时</th>
              <th>连续错误输入</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in data.interactions" :key="x.sessionId">
              <td>
                <strong>{{ x.context?.actor?.name || "未知玩家" }}</strong>
              </td>
              <td>
                <span class="stage-badge">{{ x.stageId }}</span>
              </td>
              <td>
                <span class="squad-badge">Squad {{ x.context?.target?.squadId ?? '--' }}</span>
              </td>
              <td>
                <span class="timer-tag">{{ seconds(x.expiresAt) }}</span>
              </td>
              <td>
                <span :class="['invalid-count', x.invalidInputCount > 0 ? 'warn' : '']">
                  {{ x.invalidInputCount }} 次
                </span>
              </td>
            </tr>
            <tr v-if="!data.interactions?.length">
              <td colspan="5" class="empty-cell">暂无活跃的玩家交互</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Section 2: Active Votes -->
    <section class="panel">
      <header class="panel-head">
        <h3>进行中的加权投票 ({{ data.votes?.length ?? 0 }})</h3>
      </header>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>发起人</th>
              <th>目标队长与小队</th>
              <th>弹劾处置方式</th>
              <th>本阵营快照人数</th>
              <th>赞成 / 反对 权重</th>
              <th>剩余时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in data.votes" :key="v.voteId">
              <td>
                <strong>{{ v.initiator?.name || "未知" }}</strong>
              </td>
              <td>
                <span class="target-name">{{ v.target?.name }}</span>
                <span class="squad-pill">{{ v.target?.squadId }} 队</span>
              </td>
              <td>
                <span :class="['action-pill', v.action === 'disband' ? 'danger' : 'warn']">
                  {{ v.action === 'disband' ? '解散整个小队' : '移出队长' }}
                </span>
              </td>
              <td>
                <code>{{ v.teamPlayerCount }} 人</code>
              </td>
              <td>
                <div class="weight-bar-wrap">
                  <span class="weight-text">{{ v.yesWeight }} 赞成 / {{ v.noWeight }} 反对</span>
                </div>
              </td>
              <td>
                <span class="timer-tag highlight">{{ seconds(v.expiresAt) }}</span>
              </td>
              <td>
                <button
                  type="button"
                  class="btn mini-btn danger"
                  :disabled="cancellingVoteId === v.voteId"
                  @click="cancel(v.voteId)"
                >
                  {{ cancellingVoteId === v.voteId ? "取消中..." : "强制取消" }}
                </button>
              </td>
            </tr>
            <tr v-if="!data.votes?.length">
              <td colspan="7" class="empty-cell">暂无进行中的队长弹劾投票</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Section 3: Audit Log -->
    <section class="panel">
      <header class="panel-head">
        <h3>历史与审计记录</h3>
      </header>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>事件类型</th>
              <th>原因 / 说明</th>
              <th>发起人</th>
              <th>目标队长</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in data.audit" :key="`${x.at}-${x.type}`">
              <td class="time-cell">{{ time(x.at) }}</td>
              <td>
                <span class="event-badge">{{ x.type }}</span>
              </td>
              <td class="reason-cell">{{ x.reason ?? '--' }}</td>
              <td>{{ x.initiator?.name ?? x.vote?.initiator?.name ?? '--' }}</td>
              <td>{{ x.target?.name ?? x.vote?.target?.name ?? '--' }}</td>
            </tr>
            <tr v-if="!data.audit?.length">
              <td colspan="5" class="empty-cell">暂无弹劾审计记录</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { RouterLink } from "vue-router";
import { apiGet, apiPost } from "../app/apiClient";

const data: any = reactive({ interactions: [], votes: [], history: [], audit: [] });
const error = ref("");
const loading = ref(false);
const cancellingVoteId = ref("");
const clearingCooldowns = ref(false);
let timer: number | undefined;

async function refresh() {
  loading.value = true;
  try {
    const r: any = await apiGet("/api/plugins/squad-leader-impeachment/debug");
    Object.assign(data, r?.data ?? r ?? {});
    error.value = "";
  } catch (e: any) {
    error.value = e?.message ?? "读取弹劾状态失败";
  } finally {
    loading.value = false;
  }
}

async function cancel(voteId: string) {
  cancellingVoteId.value = voteId;
  try {
    await apiPost("/api/plugins/squad-leader-impeachment/cancel", { voteId });
    await refresh();
  } finally {
    cancellingVoteId.value = "";
  }
}

async function clearCooldowns() {
  clearingCooldowns.value = true;
  try {
    await apiPost("/api/plugins/squad-leader-impeachment/cooldowns/clear");
    await refresh();
  } finally {
    clearingCooldowns.value = false;
  }
}

function seconds(at: number) {
  const diff = Math.max(0, Math.ceil((Number(at) - Date.now()) / 1000));
  return `${diff} 秒`;
}

function time(v: string) {
  return v ? new Date(v).toLocaleTimeString("zh-CN", { hour12: false }) : "--";
}

onMounted(() => {
  void refresh();
  timer = window.setInterval(() => void refresh(), 2000);
});

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
});
</script>

<style scoped>
.impeachment-page {
  max-width: 1480px;
  margin: 0 auto;
  padding: 24px 28px 64px;
  color: #e7eef8;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 20px;
  margin-bottom: 18px;
}

.eyebrow {
  margin: 0 0 6px;
  color: #38bdf8;
  font: 800 11px/1.2 ui-monospace, SFMono-Regular, monospace;
  letter-spacing: 0.18em;
}

.page-header h1 {
  margin: 0;
  font-size: 30px;
  font-weight: 800;
  letter-spacing: -0.025em;
  background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.subtitle {
  margin: 6px 0 0;
  color: #94a3b8;
  font-size: 13.5px;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.btn {
  padding: 8px 16px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s ease;
}

.btn.ghost {
  background: rgba(30, 41, 59, 0.6);
  border-color: rgba(148, 163, 184, 0.18);
  color: #cbd5e1;
}

.btn.ghost:hover:not(:disabled) {
  background: rgba(56, 189, 248, 0.12);
  border-color: rgba(56, 189, 248, 0.3);
  color: #f1f5f9;
}

.btn.danger-outline {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.3);
  color: #fca5a5;
}

.btn.danger-outline:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.18);
  border-color: rgba(239, 68, 68, 0.5);
}

.btn.mini-btn {
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 6px;
}

.btn.danger {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.35);
  color: #fca5a5;
}

.btn.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.28);
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Related Nav Strip */
.related-features-nav {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  margin-bottom: 20px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.75), rgba(11, 18, 32, 0.65));
  backdrop-filter: blur(12px);
  overflow-x: auto;
}

.nav-label {
  font-size: 12px;
  font-weight: 700;
  color: #64748b;
  white-space: nowrap;
}

.pill-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.feature-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(30, 41, 59, 0.6);
  color: #cbd5e1;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.feature-pill:hover {
  background: rgba(56, 189, 248, 0.14);
  border-color: rgba(56, 189, 248, 0.35);
  color: #f1f5f9;
  transform: translateY(-1px);
}

.pill-icon {
  font-size: 13px;
}

/* Banner */
.error-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  margin-bottom: 18px;
  border-radius: 12px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #fca5a5;
  font-size: 13px;
}

/* Metrics Grid */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin-bottom: 20px;
}

.metric-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: linear-gradient(145deg, rgba(15, 23, 42, 0.8), rgba(11, 18, 32, 0.85));
}

.metric-card.highlight {
  border-color: rgba(56, 189, 248, 0.3);
  background: linear-gradient(145deg, rgba(14, 165, 233, 0.12), rgba(11, 18, 32, 0.85));
}

.metric-icon {
  font-size: 24px;
}

.metric-info {
  display: flex;
  flex-direction: column;
}

.metric-label {
  color: #94a3b8;
  font-size: 12.5px;
}

.metric-val {
  margin-top: 4px;
  color: #f8fafc;
  font-size: 24px;
  font-weight: 800;
}

/* Panels & Tables */
.panel {
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: linear-gradient(145deg, rgba(15, 23, 42, 0.8), rgba(11, 18, 32, 0.85));
  border-radius: 16px;
  padding: 20px;
  margin-bottom: 20px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
}

.panel-head {
  margin-bottom: 14px;
}

.panel-head h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 750;
  color: #f1f5f9;
}

.table-wrap {
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.data-table th,
.data-table td {
  padding: 11px 12px;
  text-align: left;
  border-bottom: 1px solid rgba(148, 163, 184, 0.08);
  white-space: nowrap;
}

.data-table th {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.data-table td {
  color: #cbd5e1;
}

.stage-badge {
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(56, 189, 248, 0.12);
  color: #38bdf8;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11.5px;
}

.squad-badge,
.squad-pill {
  padding: 2px 7px;
  border-radius: 6px;
  background: rgba(148, 163, 184, 0.12);
  color: #e2e8f0;
  font-size: 12px;
}

.timer-tag {
  color: #fbbf24;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, monospace;
}

.timer-tag.highlight {
  color: #f87171;
}

.invalid-count.warn {
  color: #f87171;
  font-weight: 700;
}

.target-name {
  font-weight: 700;
  color: #f1f5f9;
  margin-right: 6px;
}

.action-pill {
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 700;
}

.action-pill.danger {
  background: rgba(239, 68, 68, 0.15);
  color: #fca5a5;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.action-pill.warn {
  background: rgba(245, 158, 11, 0.15);
  color: #fde68a;
  border: 1px solid rgba(245, 158, 11, 0.3);
}

.weight-text {
  font-weight: 700;
  color: #38bdf8;
}

.time-cell {
  font-family: ui-monospace, SFMono-Regular, monospace;
  color: #94a3b8;
}

.event-badge {
  padding: 2px 7px;
  border-radius: 5px;
  background: rgba(148, 163, 184, 0.12);
  color: #cbd5e1;
  font-size: 11.5px;
}

.reason-cell {
  max-width: 320px;
  white-space: normal;
  word-break: break-word;
}

.empty-cell {
  text-align: center;
  padding: 24px;
  color: #64748b;
}

@media (max-width: 860px) {
  .metrics-grid {
    grid-template-columns: 1fr;
  }
  .page-header {
    flex-direction: column;
    align-items: flex-start;
  }
}

@media (max-width: 640px) {
  .impeachment-page {
    padding: 12px 10px calc(24px + var(--safe-bottom));
  }

  .page-header h1 {
    font-size: 24px;
  }

  .metrics-grid,
  .content-grid {
    gap: 10px;
  }
}
</style>
