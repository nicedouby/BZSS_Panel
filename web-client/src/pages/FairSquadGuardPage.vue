<template>
  <section class="page fair-squad-guard-page">
    <PageHeader
      eyebrow="Plugin"
      title="公平建队"
      subtitle="通过日志和 RCON 双来源检测建队，按开局窗口自动警告、解散违规小队，并统计真实创建者违规次数。"
    >
      <template #actions>
        <div class="header-actions">
          <div class="header-toolbar">
            <span class="status-chip" :data-tone="statusTone">{{ statusLabel }}</span>
            <button type="button" class="ghost-btn" :disabled="loading" @click="load">
              {{ loading ? "刷新中..." : "刷新" }}
            </button>
            <button type="button" class="ghost-btn" @click="settings.openDrawer()">
              打开设置
            </button>
          </div>
          <aside class="header-rules">
            <strong>规则窗口</strong>
            <div class="header-rules-grid">
              <span>0 - {{ status?.settings.noSquadCreationSeconds ?? 20 }}s<br>禁止建队</span>
              <span>{{ status?.settings.noSquadCreationSeconds ?? 20 }} - {{ status?.settings.infantryOnlyUntilSeconds ?? 50 }}s<br>仅默认/白名单步兵队</span>
              <span>{{ status?.settings.infantryOnlyUntilSeconds ?? 50 }}s+<br>开放建队</span>
              <span>{{ status?.settings.maxViolationCountBeforeKick ?? 15 }} 次<br>踢出阈值</span>
            </div>
          </aside>
        </div>
      </template>
    </PageHeader>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <PageCard class="guard-hero" title="运行总览" description="当前阶段、日志时间可信度和执行状态。" compact>
      <template #actions>
        <span class="status-chip subtle">{{ status?.phase.label ?? "--" }}</span>
      </template>

      <div class="hero-grid">
        <div class="hero-main">
          <div class="hero-badges">
            <span class="status-chip" :data-tone="statusTone">{{ statusLabel }}</span>
            <span class="status-chip subtle">日志时间 {{ status?.clock.seconds ?? 0 }}s</span>
            <span class="status-chip subtle">人数 {{ status?.population.count ?? 0 }} / {{ status?.settings.enforcementPlayerThreshold ?? 50 }}</span>
            <span class="status-chip" :data-tone="status?.clock.trusted ? 'ok' : 'danger'">
              {{ status?.clock.trusted ? "可信锚点" : "不可信时间" }}
            </span>
          </div>

          <dl class="metric-grid">
            <div>
              <dt>当前窗口</dt>
              <dd>{{ status?.phase.label ?? "--" }}</dd>
            </div>
            <div>
              <dt>中途锁定</dt>
              <dd>{{ status?.session.midRoundLocked ? "已锁定" : "未锁定" }}</dd>
            </div>
            <div>
              <dt>锁定原因</dt>
              <dd>{{ status?.session.midRoundLockReason || "-" }}</dd>
            </div>
            <div>
              <dt>手动解除</dt>
              <dd>{{ formatTime(status?.session.manualUnlockAt) }}</dd>
            </div>
          </dl>
        </div>

        <aside class="hero-actions">
          <button type="button" class="danger-btn" :disabled="actionBusy" @click="unlockRound">
            解除本局锁定
          </button>
          <button type="button" class="danger-btn" :disabled="actionBusy" @click="resetSession">
            重置会话
          </button>
          <p>解除锁定只影响当前局；下一次真实切图锚点会自动重置状态。</p>
        </aside>
      </div>
    </PageCard>

    <section class="summary-grid">
      <article class="summary-card" data-tone="info">
        <span>判定记录</span>
        <strong>{{ status?.summary.total ?? 0 }}</strong>
        <em>本轮内存记录</em>
      </article>
      <article class="summary-card" data-tone="ok">
        <span>通过</span>
        <strong>{{ status?.summary.approved ?? 0 }}</strong>
        <em>符合窗口规则</em>
      </article>
      <article class="summary-card" data-tone="warning">
        <span>违规</span>
        <strong>{{ status?.summary.violations ?? 0 }}</strong>
        <em>触发警告/解散</em>
      </article>
      <article class="summary-card" data-tone="danger">
        <span>当前违规队伍</span>
        <strong>{{ status?.currentViolatingSquads.length ?? 0 }}</strong>
        <em>仍在 RCON 快照中存在</em>
      </article>
      <article class="summary-card" data-tone="danger">
        <span>已解散</span>
        <strong>{{ status?.summary.disbanded ?? 0 }}</strong>
        <em>RCON 执行成功</em>
      </article>
      <article class="summary-card" data-tone="danger">
        <span>已踢出</span>
        <strong>{{ status?.summary.kicked ?? 0 }}</strong>
        <em>超过违规阈值</em>
      </article>
      <article class="summary-card" data-tone="info">
        <span>Pending 日志</span>
        <strong>{{ status?.pendingLogCount ?? 0 }}</strong>
        <em>等待 RCON 补 teamId</em>
      </article>
    </section>

    <section class="monitor-grid">
      <PageCard class="leaderboard-card" title="违规排行榜" description="只统计日志确认的真实创建者；RCON-only 不处罚玩家。" compact>
        <div v-if="!status?.leaderboard.length" class="empty-state">暂无违规玩家。</div>
        <div v-else class="leaderboard">
          <article v-for="player in status.leaderboard" :key="player.key" class="leader-row">
            <div>
              <strong>{{ player.name || player.steamId || player.eosId || player.key }}</strong>
              <span>{{ player.steamId || player.eosId || "无ID" }}</span>
            </div>
            <div>
              <b>{{ player.violations }}</b>
              <small>{{ player.kicked ? "已踢出" : "未踢出" }}</small>
            </div>
          </article>
        </div>
      </PageCard>

      <PageCard class="current-panel" title="当前违规队伍" description="只展示仍在当前 RCON 快照中存在的违规小队；队伍消失后会自动移出。" compact>
        <div v-if="!status?.currentViolatingSquads.length" class="empty-state">当前没有追踪中的违规队伍。</div>
        <div v-else class="current-grid">
          <article
            v-for="record in status.currentViolatingSquads"
            :key="record.id"
            class="current-card"
          >
            <div>
              <strong>{{ record.squadName || `Squad ${record.squadId ?? "?"}` }}</strong>
              <span>T{{ record.teamId ?? "?" }} / S{{ record.squadId ?? "?" }} · {{ record.creationSource }}</span>
            </div>
            <div>
              <b>{{ record.clockSeconds }}s</b>
              <small>{{ creatorLabel(record) }}</small>
            </div>
            <p v-if="record.reasons.length">{{ record.reasons.join(" / ") }}</p>
          </article>
        </div>
      </PageCard>

      <PageCard class="timeline-panel" title="判定时间轴" description="标明 LOG、RCON_SNAPSHOT 或 RCON_PROMOTED_TO_LOG 来源。" compact>
        <div v-if="!records.length" class="empty-state">暂无建队判定记录。</div>
        <div v-else class="timeline">
          <article v-for="record in records" :key="record.id" class="timeline-item" :data-tone="record.approved ? 'ok' : 'danger'">
            <div class="timeline-head">
              <div>
                <strong>{{ record.squadName || `Squad ${record.squadId ?? "?"}` }}</strong>
                <span>T{{ record.teamId ?? "?" }} / S{{ record.squadId ?? "?" }}</span>
              </div>
              <div class="timeline-badges">
                <span class="status-chip subtle">{{ record.creationSource }}</span>
                <span class="status-chip" :data-tone="record.approved ? 'ok' : 'danger'">
                  {{ record.approved ? "通过" : "违规" }}
                </span>
              </div>
            </div>
            <div class="timeline-meta">
              <span>创建者: {{ creatorLabel(record) }}</span>
              <span>日志时间: {{ record.clockSeconds }}s</span>
              <span>人数: {{ record.population }}</span>
              <span>更新: {{ formatTime(record.updatedAt) }}</span>
            </div>
            <p v-if="record.reasons.length">{{ record.reasons.join(" / ") }}</p>
            <div class="action-line">
              <span v-for="action in record.actions" :key="`${record.id}-${action.type}-${action.count ?? ''}`">
                {{ action.type }}{{ action.count != null ? `(${action.count})` : "" }}
              </span>
            </div>
          </article>
        </div>
      </PageCard>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import {
  fetchFairSquadGuardRecords,
  fetchFairSquadGuardStatus,
  resetFairSquadGuardSession,
  unlockFairSquadGuardRound,
  type FairSquadGuardRecord,
  type FairSquadGuardStatus,
} from "../app/fairSquadGuardApi";
import { useSettingsStore } from "../stores/settings.store";

const settings = useSettingsStore();
const status = ref<FairSquadGuardStatus | null>(null);
const records = ref<FairSquadGuardRecord[]>([]);
const loading = ref(false);
const actionBusy = ref(false);
const error = ref("");

const statusTone = computed(() => {
  if (!status.value?.active) return "danger";
  if (status.value.session.midRoundLocked) return "warning";
  if (!status.value.clock.trusted && !status.value.session.manualUnlockAt) return "danger";
  return "ok";
});

const statusLabel = computed(() => {
  if (!status.value) return "未加载";
  if (!status.value.active) return "未启用";
  if (status.value.session.midRoundLocked) return "本局锁定";
  if (!status.value.clock.trusted && !status.value.session.manualUnlockAt) return "时间不可信";
  return "执行中";
});

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [nextStatus, nextRecords] = await Promise.all([
      fetchFairSquadGuardStatus(),
      fetchFairSquadGuardRecords(300),
    ]);
    status.value = nextStatus;
    records.value = nextRecords.records;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "加载公平建队状态失败。";
  } finally {
    loading.value = false;
  }
}

async function unlockRound() {
  actionBusy.value = true;
  try {
    status.value = await unlockFairSquadGuardRound();
    await load();
  } finally {
    actionBusy.value = false;
  }
}

async function resetSession() {
  actionBusy.value = true;
  try {
    status.value = await resetFairSquadGuardSession();
    await load();
  } finally {
    actionBusy.value = false;
  }
}

function formatTime(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function creatorLabel(record: FairSquadGuardRecord) {
  if (record.creatorName || record.creatorSteamId || record.creatorEosId) {
    return record.creatorName || record.creatorSteamId || record.creatorEosId;
  }
  const leader = record.inferredLeader;
  if (leader?.name || leader?.steamId || leader?.eosId) {
    return `队长推断: ${leader.name || leader.steamId || leader.eosId}`;
  }
  return "未知";
}

onMounted(() => {
  void load();
});
</script>

<style scoped>
.fair-squad-guard-page {
  position: relative;
  display: grid;
  gap: 16px;
  padding: 16px;
  overflow: visible;
}

.fair-squad-guard-page::before {
  content: "";
  position: absolute;
  inset: -80px auto auto -120px;
  width: 280px;
  height: 280px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(56, 189, 248, 0.16), transparent 68%);
  pointer-events: none;
  filter: blur(8px);
}

.fair-squad-guard-page::after {
  content: "";
  position: absolute;
  inset: auto -100px -120px auto;
  width: 320px;
  height: 320px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(34, 197, 94, 0.1), transparent 68%);
  pointer-events: none;
  filter: blur(10px);
}

.fair-squad-guard-page > * {
  position: relative;
  z-index: 1;
}

.fair-squad-guard-page :deep(.page-card) {
  border-color: rgba(148, 163, 184, 0.16);
  background:
    radial-gradient(circle at top right, rgba(56, 189, 248, 0.1), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.02)), rgba(255, 255, 255, 0.01)),
    var(--color-bg-card);
  box-shadow: 0 18px 36px rgba(2, 6, 23, 0.26);
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.fair-squad-guard-page :deep(.page-card:hover) {
  transform: translateY(-1px);
  border-color: rgba(96, 165, 250, 0.28);
  box-shadow: 0 22px 42px rgba(2, 6, 23, 0.3);
}

.fair-squad-guard-page :deep(.card-header) {
  padding: 16px 18px 0;
}

.fair-squad-guard-page :deep(.card-body) {
  padding: 18px;
}

.error-banner,
.empty-state {
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 14px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-muted);
}

.error-banner {
  border-color: rgba(255, 92, 92, 0.38);
  color: #ffb3b3;
}

.hero-grid,
.detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(240px, 0.78fr);
  gap: 12px;
}

.detail-grid {
  align-items: start;
}

.hero-main,
.hero-actions {
  min-width: 0;
}

.monitor-grid {
  display: grid;
  grid-template-columns: minmax(250px, 0.82fr) minmax(320px, 1fr) minmax(360px, 1.2fr);
  gap: 12px;
  align-items: start;
}

.header-actions {
  display: grid;
  justify-items: end;
  gap: 8px;
  min-width: min(420px, 100%);
}

.header-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.header-rules {
  width: min(420px, 100%);
  padding: 10px 12px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.24);
}

.header-rules strong {
  display: block;
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--color-text-primary);
}

.header-rules-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.header-rules-grid span {
  display: block;
  padding: 8px 9px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-muted);
  font-size: 11px;
  line-height: 1.35;
}

.hero-badges,
.timeline-badges,
.action-line {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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
  border-color: rgba(69, 214, 148, 0.38);
  color: #83f0bb;
}

.status-chip[data-tone="warning"] {
  border-color: rgba(245, 190, 80, 0.42);
  color: #ffd27a;
}

.status-chip[data-tone="danger"] {
  border-color: rgba(255, 92, 92, 0.38);
  color: #ffadad;
}

.metric-grid,
.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
  gap: 6px;
  margin-top: 8px;
}

.metric-grid div,
.summary-card,
.rule-list div,
.leader-row,
.current-card,
.timeline-item {
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 16px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.025));
}

.metric-grid div,
.summary-card,
.rule-list div {
  padding: 9px 10px;
}

.metric-grid dt,
.summary-card span,
.rule-list span {
  color: var(--color-text-muted);
  font-size: 11px;
}

.metric-grid dd,
.summary-card strong,
.rule-list strong {
  display: block;
  margin: 2px 0 0;
  color: var(--color-text-primary);
  font-size: 15px;
}

.summary-card em {
  display: block;
  margin-top: 2px;
  color: var(--color-text-muted);
  font-style: normal;
  font-size: 10px;
  line-height: 1.35;
}

.summary-card {
  display: grid;
  gap: 1px;
  min-height: 0;
}

.hero-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: stretch;
  padding: 14px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.22);
}

.hero-actions p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.ghost-btn,
.danger-btn {
  min-height: 36px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  padding: 0 12px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-primary);
  cursor: pointer;
  font-weight: 700;
}

.danger-btn {
  border-color: rgba(255, 92, 92, 0.38);
  color: #ffb3b3;
}

.ghost-btn:disabled,
.danger-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.leaderboard-card,
.current-panel,
.timeline-panel {
  min-width: 0;
}

.leaderboard-card :deep(.page-card) {
  height: auto;
}

.leaderboard-card :deep(.card-body) {
  height: auto;
  min-height: 0;
  overflow: visible;
}

.action-line span {
  border-radius: 999px;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.07);
  color: var(--color-text-muted);
  font-size: 11px;
}

.leaderboard {
  display: grid;
  gap: 6px;
  max-height: 288px;
  overflow: auto;
  padding-right: 4px;
  scrollbar-gutter: stable;
}

.leader-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 10px;
}

.leader-row strong,
.leader-row span,
.leader-row small {
  display: block;
}

.leader-row span,
.leader-row small {
  color: var(--color-text-muted);
  font-size: 12px;
}

.leader-row b {
  display: block;
  text-align: right;
  font-size: 18px;
}

.current-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  max-height: 560px;
  overflow: auto;
  padding-right: 4px;
  scrollbar-gutter: stable;
}

.current-panel :deep(.page-card),
.timeline-panel :deep(.page-card) {
  height: auto;
}

.current-panel :deep(.card-body),
.timeline-panel :deep(.card-body) {
  min-height: 0;
  height: auto;
  overflow: visible;
}

.current-panel :deep(.card-body) {
  padding-right: 18px;
}

.timeline-panel :deep(.card-body) {
  padding-right: 18px;
}

.current-card {
  display: grid;
  gap: 6px;
  padding: 9px 10px;
  border-color: rgba(255, 92, 92, 0.28);
}

.current-card strong,
.current-card span,
.current-card small {
  display: block;
}

.current-card span,
.current-card small,
.current-card p {
  color: var(--color-text-muted);
  font-size: 12px;
}

.current-card b {
  color: #ffadad;
  font-size: 18px;
}

.current-card p {
  margin: 0;
}

.timeline {
  display: grid;
  gap: 6px;
  max-height: 560px;
  overflow: auto;
  padding-right: 4px;
  scrollbar-gutter: stable;
}

.timeline-item {
  padding: 9px 10px;
}

.timeline-item[data-tone="danger"] {
  border-color: rgba(255, 92, 92, 0.26);
}

.timeline-head,
.timeline-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.timeline-head strong,
.timeline-head span {
  display: block;
}

.timeline-meta {
  margin-top: 6px;
  color: var(--color-text-muted);
  font-size: 11px;
}

.timeline-item p {
  margin: 6px 0;
  color: var(--color-text);
}

@media (max-width: 980px) {
  .hero-grid,
  .detail-grid,
  .monitor-grid,
  .current-grid,
  .metric-grid,
  .summary-grid {
    grid-template-columns: 1fr;
  }

  .current-card,
  .leader-row,
  .timeline-item {
    padding: 12px;
  }

  .header-actions {
    min-width: 0;
    justify-items: stretch;
  }

  .header-toolbar {
    justify-content: flex-start;
  }

  .header-rules {
    width: 100%;
  }

  .header-rules-grid {
    grid-template-columns: 1fr;
  }

  .leaderboard,
  .current-grid,
  .timeline {
    max-height: none;
    overflow: visible;
    padding-right: 0;
  }

  .fair-squad-guard-page {
    padding: 12px;
  }

  .summary-card {
    gap: 2px;
  }

  .leaderboard-card :deep(.card-body),
  .current-panel :deep(.card-body),
  .timeline-panel :deep(.card-body) {
    height: auto;
    overflow: visible;
  }
}
</style>
