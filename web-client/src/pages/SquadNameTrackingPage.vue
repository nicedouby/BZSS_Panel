<template>
  <section class="tracking-page">
    <h1 class="sr-only">建队与违规队名追踪</h1>

    <WorkspaceToolbar>
      <div class="toolbar-main">
        <span class="page-title">建队与违规队名追踪</span>
        <span class="pill" :data-tone="guardState?.enabled ? 'ok' : 'danger'">
          Guard {{ guardState?.enabled ? "开启" : "关闭" }}
        </span>
        <span class="pill" :data-tone="patrolState?.enabled ? 'warning' : 'muted'">
          Patrol {{ patrolState?.enabled ? "开启" : "关闭" }}
        </span>
        <span class="pill" data-tone="muted">建队判定 {{ buildDecisionRecords.length }}</span>
        <span class="pill" data-tone="danger">违规判定 {{ violationDecisionCount }}</span>
      </div>

      <template #actions>
        <button type="button" class="btn ghost" :disabled="loading" @click="refreshNow">
          {{ loading ? "刷新中.." : "刷新" }}
        </button>
        <button type="button" :class="['btn', autoRefresh ? 'primary' : 'ghost']" @click="toggleAutoRefresh">
          {{ autoRefresh ? "自动刷新中" : "开启自动刷新" }}
        </button>
      </template>
    </WorkspaceToolbar>

    <div v-if="error" class="banner error">{{ error }}</div>

    <section class="summary-grid">
      <article class="summary-card">
        <span>建队判定总数</span>
        <strong>{{ buildDecisionRecords.length }}</strong>
        <em>每条日志建队对应一条记录</em>
      </article>
      <article class="summary-card">
        <span>合法建队</span>
        <strong>{{ allowedDecisionCount }}</strong>
        <em>符合队名规范</em>
      </article>
      <article class="summary-card">
        <span>违规建队</span>
        <strong>{{ violationDecisionCount }}</strong>
        <em>触发违规判定</em>
      </article>
      <article class="summary-card">
        <span>最近解散</span>
        <strong>{{ disbandedCount }}</strong>
        <em>内存记录中的已解散次数</em>
      </article>
      <article class="summary-card">
        <span>最近警告</span>
        <strong>{{ warnedCount }}</strong>
        <em>重复广播也会计入</em>
      </article>
      <article class="summary-card">
        <span>待补全/跳过</span>
        <strong>{{ skippedDecisionCount }}</strong>
        <em>缺字段或重复事件</em>
      </article>
      <article class="summary-card">
        <span>巡逻识别违规</span>
        <strong>{{ patrolViolationCount }}</strong>
        <em>仅识别，不解散</em>
      </article>
    </section>

    <section class="content-grid">
      <PageCard
        title="建队日志判定流水"
        description="每出现一条建队日志，就在这里落一条判定记录，并给出是否合法与处置结果。"
        compact
        body-mode="scroll"
      >
        <div v-if="!buildDecisionRecords.length" class="empty-state">暂无建队判定记录。</div>
        <div v-else class="record-list">
          <article
            v-for="item in buildDecisionRecords"
            :key="item.id"
            class="record-card"
            :class="{ danger: item.decisionTone === 'danger' }"
          >
            <div class="record-head">
              <div>
                <strong>{{ item.squadName || `Squad ${item.squadId ?? "?"}` }}</strong>
                <span>T{{ item.teamId ?? "?" }} / S{{ item.squadId ?? "?" }}</span>
              </div>
              <span class="pill" :data-tone="item.decisionTone">{{ item.decisionLabel }}</span>
            </div>
            <div class="record-meta">
              <span>队长: {{ item.creatorName || "-" }}</span>
              <span>来源: {{ item.sourceLabel }}</span>
              <span>时间: {{ formatTime(item.updatedAt || item.createdAt) }}</span>
            </div>
            <p class="reason">{{ item.reason || "未提供原因" }}</p>
            <div v-if="item.actionLabels.length" class="tag-row">
              <span v-for="action in item.actionLabels" :key="`${item.id}-${action}`" class="tag">
                {{ action }}
              </span>
            </div>
          </article>
        </div>
      </PageCard>

      <PageCard
        title="当前疑似违规小队"
        description="这里只保留当前仍在对局快照中的违规队名，方便值班时盯盘。"
        compact
        body-mode="scroll"
      >
        <div v-if="!activeViolations.length" class="empty-state">当前没有仍在场的疑似违规小队。</div>
        <div v-else class="record-list">
          <article
            v-for="item in activeViolations"
            :key="item.key"
            class="record-card danger"
          >
            <div class="record-head">
              <div>
                <strong>{{ item.squadName || `Squad ${item.squadId ?? "?"}` }}</strong>
                <span>T{{ item.teamId ?? "?" }} / S{{ item.squadId ?? "?" }}</span>
              </div>
              <span class="pill danger">{{ item.sourceLabel }}</span>
            </div>
            <div class="record-meta">
              <span>建队: {{ item.createdAtLabel || formatTime(item.createdAt) }}</span>
              <span>创建来源: {{ item.creationSourceLabel }}</span>
              <span>队长: {{ item.creatorName || "-" }}</span>
            </div>
            <p class="reason">{{ item.reason || "未提供原因" }}</p>
          </article>
        </div>
      </PageCard>

      <PageCard
        title="当前建队快照"
        description="按建队时间倒序，结合 Squad Lifecycle 当前快照。"
        compact
        body-mode="scroll"
      >
        <div v-if="!orderedLifecycle.length" class="empty-state">当前没有可展示的小队快照。</div>
        <div v-else class="record-list">
          <article
            v-for="record in orderedLifecycle"
            :key="record.key"
            class="record-card"
          >
            <div class="record-head">
              <div>
                <strong>{{ record.squadName || `Squad ${record.squadId ?? "?"}` }}</strong>
                <span>T{{ record.teamId ?? "?" }} / S{{ record.squadId ?? "?" }}</span>
              </div>
              <span class="pill" :data-tone="record.creationSource === 'LOG' ? 'ok' : 'muted'">
                {{ record.sourceLabel || record.creationSource }}
              </span>
            </div>
            <div class="record-meta">
              <span>{{ record.createdDisplayText || formatTime(record.createdAt) }}</span>
              <span>队长: {{ record.creatorName || "-" }}</span>
              <span>性质: {{ record.squadNatureLabel || record.squadNature || "-" }}</span>
            </div>
          </article>
        </div>
      </PageCard>

      <PageCard
        title="最近巡逻识别"
        description="RCON 巡逻系统只识别当前队名是否合规，暂不解散。"
        compact
        body-mode="scroll"
      >
        <div v-if="!patrolRecords.length" class="empty-state">暂无巡逻记录。</div>
        <div v-else class="record-list">
          <article
            v-for="record in patrolRecords"
            :key="record.id"
            class="record-card"
          >
            <div class="record-head">
              <div>
                <strong>{{ record.event?.squadName || `Squad ${record.event?.squadId ?? "?"}` }}</strong>
                <span>T{{ record.event?.teamId ?? "?" }} / S{{ record.event?.squadId ?? "?" }}</span>
              </div>
              <span class="pill" :data-tone="record.violation ? 'danger' : 'ok'">
                {{ record.violation ? "违规" : "通过" }}
              </span>
            </div>
            <div class="record-meta">
              <span>时间: {{ formatTime(record.updatedAt || record.createdAt) }}</span>
              <span>来源: {{ record.source || "-" }}</span>
            </div>
            <p class="reason">{{ record.reason || "未提供原因" }}</p>
          </article>
        </div>
      </PageCard>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { apiGet } from "../app/apiClient";
import { canAutoRefreshNow } from "../composables/useAutoRefreshGate";
import WorkspaceToolbar from "../components/common/WorkspaceToolbar.vue";
import PageCard from "../components/common/PageCard.vue";

type LifecycleRecord = {
  key: string;
  slotKey?: string;
  serverId?: string;
  matchId?: string | null;
  teamId?: number | null;
  squadId?: number | null;
  squadName?: string;
  creatorName?: string;
  creationSource?: string;
  sourceLabel?: string;
  createdAt?: string | null;
  createdAtMs?: number;
  createdAtLabel?: string;
  createdDisplayText?: string;
  squadNature?: string;
  squadNatureLabel?: string;
};

type GuardAction = {
  type?: string;
};

type GuardRecord = {
  id: string;
  source?: string;
  status?: string;
  reason?: string;
  createdAt?: string;
  updatedAt?: string;
  event?: {
    teamId?: number | null;
    squadId?: number | null;
    squadName?: string;
    creatorName?: string;
  };
  actions?: GuardAction[];
};

type GuardState = {
  enabled: boolean;
  recent: GuardRecord[];
};

type PatrolRecord = {
  id: string;
  source?: string;
  status?: string;
  violation?: boolean;
  reason?: string;
  createdAt?: string;
  updatedAt?: string;
  event?: {
    teamId?: number | null;
    squadId?: number | null;
    squadName?: string;
  };
};

type PatrolState = {
  enabled: boolean;
  recent: PatrolRecord[];
};

type LifecycleState = {
  serverId?: string;
  matchId?: string | null;
  updatedAt?: string;
  list: LifecycleRecord[];
};

type ActiveViolation = {
  key: string;
  teamId?: number | null;
  squadId?: number | null;
  squadName?: string;
  creatorName?: string;
  createdAt?: string | null;
  createdAtLabel?: string;
  creationSourceLabel: string;
  sourceLabel: string;
  reason: string;
};

type BuildDecisionRecord = {
  id: string;
  teamId?: number | null;
  squadId?: number | null;
  squadName?: string;
  creatorName?: string;
  sourceLabel: string;
  decisionLabel: string;
  decisionTone: "ok" | "warning" | "danger" | "muted";
  reason: string;
  createdAt?: string;
  updatedAt?: string;
  actionLabels: string[];
};

const loading = ref(false);
const error = ref("");
const autoRefresh = ref(true);
const lifecycle = ref<LifecycleState | null>(null);
const guardState = ref<GuardState | null>(null);
const patrolState = ref<PatrolState | null>(null);
let autoRefreshTimer: number | null = null;

const orderedLifecycle = computed(() => {
  const list = Array.isArray(lifecycle.value?.list) ? lifecycle.value!.list : [];
  return list.slice().sort((left, right) => {
    return Number(right.createdAtMs ?? 0) - Number(left.createdAtMs ?? 0);
  });
});

const guardViolations = computed(() => {
  const list = Array.isArray(guardState.value?.recent) ? guardState.value!.recent : [];
  return list.filter((item) => item.status === "violation" || item.status === "handled" || item.status === "error");
});

const buildDecisionRecords = computed<BuildDecisionRecord[]>(() => {
  const list = Array.isArray(guardState.value?.recent) ? guardState.value!.recent : [];
  return list
    .filter((record) => !shouldHideDecisionRecord(record))
    .map((record) => {
      const status = String(record.status ?? "").trim();
      return {
        id: record.id,
        teamId: record.event?.teamId,
        squadId: record.event?.squadId,
        squadName: record.event?.squadName,
        creatorName: record.event?.creatorName,
        sourceLabel: record.source || "-",
        decisionLabel: buildDecisionLabel(status),
        decisionTone: buildDecisionTone(status),
        reason: record.reason || "",
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        actionLabels: Array.isArray(record.actions) ? record.actions.map((item) => String(item?.type ?? "").trim()).filter(Boolean) : [],
      };
    })
    .filter((item) => item.sourceLabel === "LOG" || item.sourceLabel === "simulate");
});

const patrolRecords = computed(() => {
  return Array.isArray(patrolState.value?.recent) ? patrolState.value!.recent : [];
});

const allowedDecisionCount = computed(() => buildDecisionRecords.value.filter((item) => item.decisionTone === "ok").length);
const violationDecisionCount = computed(() => buildDecisionRecords.value.filter((item) => item.decisionTone === "danger").length);
const skippedDecisionCount = computed(() => buildDecisionRecords.value.filter((item) => item.decisionTone === "muted").length);

const disbandedCount = computed(() => {
  return guardViolations.value.reduce((count, record) => {
    return count + (record.actions?.filter((action) => action.type === "disbanded").length ?? 0);
  }, 0);
});

const warnedCount = computed(() => {
  return guardViolations.value.reduce((count, record) => {
    return count + (record.actions?.filter((action) => action.type === "warned").length ?? 0);
  }, 0);
});

const patrolViolationCount = computed(() => {
  return patrolRecords.value.filter((item) => item.violation).length;
});

const activeViolations = computed<ActiveViolation[]>(() => {
  const current = orderedLifecycle.value;
  if (!current.length) return [];

  // Find the latest patrol record for each squad key (teamId:squadId)
  const latestPatrolByKey = new Map<string, PatrolRecord>();
  for (const record of patrolRecords.value) {
    const key = buildSlotKey(record.event?.teamId, record.event?.squadId);
    if (!key) continue;
    if (!latestPatrolByKey.has(key)) {
      latestPatrolByKey.set(key, record);
    }
  }

  const items = current
    .map((item) => {
      const key = buildSlotKey(item.teamId, item.squadId);
      const patrol = latestPatrolByKey.get(key);
      if (!patrol) return null;
      if (!patrol.violation) return null;

      // Ensure the squad's name in the current snapshot still matches the violating squad name from the patrol check
      const patrolName = String(patrol.event?.squadName ?? "").trim().toLowerCase();
      const currentName = String(item.squadName ?? "").trim().toLowerCase();
      if (patrolName !== currentName) return null;

      return {
        key: item.key,
        teamId: item.teamId,
        squadId: item.squadId,
        squadName: item.squadName,
        creatorName: item.creatorName,
        createdAt: item.createdAt,
        createdAtLabel: item.createdAtLabel,
        creationSourceLabel: item.sourceLabel || item.creationSource || "-",
        sourceLabel: "Patrol",
        reason: patrol.reason || "巡逻识别为违规队名",
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return items;
});

onMounted(() => {
  void loadAll();
  setupAutoRefresh();
});

onUnmounted(() => {
  if (autoRefreshTimer != null) {
    window.clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
});

function setupAutoRefresh() {
  if (autoRefreshTimer != null) {
    window.clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }

  if (!autoRefresh.value) return;
  autoRefreshTimer = window.setInterval(() => {
    if (canAutoRefreshNow()) void loadAll(false);
  }, 2500);
}

function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value;
  setupAutoRefresh();
}

function refreshNow() {
  void loadAll();
}

async function loadAll(showSpinner = true) {
  if (showSpinner) loading.value = true;
  error.value = "";

  try {
    const [lifecycleResponse, guardResponse, patrolResponse] = await Promise.all([
      apiGet<{ current: LifecycleState }>("/api/squad-lifecycle/current"),
      apiGet<{ ok: boolean; data: GuardState }>("/api/modules/squad-name-policy-guard/state"),
      apiGet<{ ok: boolean; data: PatrolState }>("/api/modules/squad-name-policy-patrol/state"),
    ]);
    lifecycle.value = lifecycleResponse.current ?? { list: [] };
    guardState.value = guardResponse.data ?? { enabled: false, recent: [] };
    patrolState.value = patrolResponse.data ?? { enabled: false, recent: [] };
  } catch (err) {
    error.value = err instanceof Error ? err.message : "加载建队追踪失败。";
  } finally {
    if (showSpinner) loading.value = false;
  }
}

function buildSlotKey(teamId: unknown, squadId: unknown) {
  const team = Number(teamId);
  const squad = Number(squadId);
  if (!Number.isFinite(team) || !Number.isFinite(squad)) return "";
  return `${team}:${squad}`;
}

function formatTime(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function buildDecisionLabel(status: string) {
  if (status === "allowed") return "合法";
  if (status === "handled" || status === "violation" || status === "error") return "违规";
  if (status === "skipped") return "跳过";
  return status || "未知";
}

function buildDecisionTone(status: string): "ok" | "warning" | "danger" | "muted" {
  if (status === "allowed") return "ok";
  if (status === "handled" || status === "error") return "danger";
  if (status === "violation") return "warning";
  return "muted";
}

function shouldHideDecisionRecord(record: GuardRecord) {
  const status = String(record.status ?? "").trim();
  const reason = String(record.reason ?? "").trim();
  if (status !== "skipped") return false;
  return reason === "missing_required_fields" || reason === "duplicate";
}
</script>

<style scoped>
.tracking-page {
  display: grid;
  gap: 16px;
  padding: 16px;
  min-height: 100%;
}

.toolbar-main {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.page-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin-right: 8px;
}

.btn {
  min-height: 36px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  padding: 0 12px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn.primary {
  border-color: rgba(82, 196, 26, 0.4);
  background: rgba(82, 196, 26, 0.16);
}

.btn.ghost {
  background: rgba(255, 255, 255, 0.03);
}

.banner {
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 13px;
}

.banner.error {
  border: 1px solid rgba(255, 92, 92, 0.34);
  background: rgba(255, 92, 92, 0.14);
  color: #ffb3b3;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}

.summary-card {
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 16px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.03);
  display: grid;
  gap: 4px;
}

.summary-card span,
.summary-card em {
  color: var(--color-text-muted);
  font-size: 11px;
  font-style: normal;
}

.summary-card strong {
  font-size: 24px;
  color: var(--color-text-primary);
  line-height: 1.1;
}

.content-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  min-height: 0;
}

.record-list {
  display: grid;
  gap: 8px;
}

.record-card {
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 14px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.025);
  display: grid;
  gap: 8px;
}

.record-card.danger {
  border-color: rgba(255, 92, 92, 0.28);
}

.record-head,
.record-meta,
.tag-row {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  flex-wrap: wrap;
  align-items: center;
}

.record-head strong,
.record-head span,
.record-meta span {
  display: block;
}

.record-head strong {
  color: var(--color-text-primary);
}

.record-head span,
.record-meta span {
  color: var(--color-text-muted);
  font-size: 12px;
}

.reason {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-line;
}

.empty-state {
  display: grid;
  place-items: center;
  min-height: 160px;
  color: var(--color-text-muted);
  text-align: center;
}

.pill,
.tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
  font-size: 11px;
  white-space: nowrap;
}

.pill[data-tone="ok"] {
  border-color: rgba(69, 214, 148, 0.38);
  color: #83f0bb;
}

.pill[data-tone="warning"] {
  border-color: rgba(245, 190, 80, 0.42);
  color: #ffd27a;
}

.pill[data-tone="danger"],
.pill.danger {
  border-color: rgba(255, 92, 92, 0.38);
  color: #ffadad;
}

.pill[data-tone="muted"] {
  color: var(--color-text-muted);
}

.tag {
  color: var(--color-text-muted);
}

@media (max-width: 1100px) {
  .content-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .tracking-page {
    padding: 12px;
  }
}
</style>
