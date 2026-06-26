<template>
  <section class="tracking-page">
    <h1 class="sr-only">建队规则链</h1>

    <WorkspaceToolbar sticky>
      <div class="toolbar-main">
        <span class="page-title">建队规则链</span>
        <span class="pill" :data-tone="guardState?.enabled ? 'ok' : 'danger'">队名规范 {{ guardState?.enabled ? "运行" : "关闭" }}</span>
        <span class="pill" :data-tone="stepwiseState?.enabled ? 'ok' : 'danger'">阶梯建队 {{ stepwiseState?.enabled ? "运行" : "关闭" }}</span>
        <span class="pill" :data-tone="fairState?.enabled ? 'ok' : 'danger'">公平建队 {{ fairState?.enabled ? "运行" : "关闭" }}</span>
        <span class="pill" :data-tone="patrolState?.enabled ? 'warning' : 'muted'">巡逻 {{ patrolState?.enabled ? "开启" : "关闭" }}</span>
      </div>

      <template #actions>
        <router-link to="/debug/squad-name-policy/rules" class="btn ghost">队名规则</router-link>
        <router-link to="/debug/squad-name-classifier" class="btn ghost">分类调试</router-link>
        <button type="button" class="btn ghost" :disabled="loading" @click="refreshNow">
          {{ loading ? "刷新中..." : "刷新" }}
        </button>
        <button type="button" :class="['btn', autoRefresh ? 'primary' : 'ghost']" @click="toggleAutoRefresh">
          {{ autoRefresh ? "自动刷新中" : "开启自动刷新" }}
        </button>
      </template>
    </WorkspaceToolbar>

    <div v-if="error" class="banner error">{{ error }}</div>

    <nav class="flow-tabs" aria-label="建队规则链页面">
      <router-link
        v-for="tab in flowTabs"
        :key="tab.path"
        :to="tab.path"
        class="flow-tab"
        :class="{ active: pageMode === tab.mode }"
      >
        <strong>{{ tab.title }}</strong>
        <span>{{ tab.caption }}</span>
      </router-link>
    </nav>

    <section v-if="isOverviewPage" class="overview-hero">
      <article class="health-panel" :data-tone="healthTone">
        <span>链路状态</span>
        <strong>{{ healthLabel }}</strong>
        <em>{{ enabledFlowCount }} / 3 个流程运行中，当前风险 {{ riskTotal }} 条</em>
      </article>
      <article class="hero-metric">
        <span>建队判定</span>
        <strong>{{ buildDecisionRecords.length }}</strong>
        <em>最新链路流水</em>
      </article>
      <article class="hero-metric">
        <span>通过率</span>
        <strong>{{ passRateText }}</strong>
        <em>{{ allowedDecisionCount }} 条最终通过</em>
      </article>
      <article class="hero-metric danger">
        <span>违规判定</span>
        <strong>{{ violationDecisionCount }}</strong>
        <em>需要关注的拒绝结果</em>
      </article>
      <article class="hero-metric warning">
        <span>处置动作</span>
        <strong>{{ disbandedCount + warnedCount }}</strong>
        <em>解散 {{ disbandedCount }} / 警告 {{ warnedCount }}</em>
      </article>
    </section>

    <section v-else class="ops-band">
      <article class="ops-card primary">
        <span>当前风险</span>
        <strong>{{ riskTotal }}</strong>
        <em>违规判定 + 在场疑似违规</em>
      </article>
      <article class="ops-card">
        <span>当前流程判定</span>
        <strong>{{ currentDecisionRecords.length }}</strong>
        <em>{{ currentFlowTitle }}</em>
      </article>
      <article class="ops-card">
        <span>最终通过</span>
        <strong>{{ allowedDecisionCount }}</strong>
        <em>允许保留的小队</em>
      </article>
      <article class="ops-card danger">
        <span>已处置</span>
        <strong>{{ disbandedCount }}</strong>
        <em>解散记录</em>
      </article>
      <article class="ops-card warning">
        <span>已警告</span>
        <strong>{{ warnedCount }}</strong>
        <em>广播或警告动作</em>
      </article>
      <article class="ops-card">
        <span>巡逻命中</span>
        <strong>{{ patrolViolationCount }}</strong>
        <em>仅识别，不直接处置</em>
      </article>
    </section>

    <section v-if="isOverviewPage" class="overview-grid">
      <PageCard title="流程健康" description="三个流程按顺序组成最终建队判定。" compact>
        <div class="flow-stack">
          <article v-for="stage in ruleStages" :key="stage.key" class="flow-stage" :data-tone="stage.tone">
            <div class="flow-stage-index">{{ stage.index }}</div>
            <div class="flow-stage-body">
              <div class="flow-stage-head">
                <strong>{{ stage.title }}</strong>
                <span class="pill" :data-tone="stage.tone">{{ stage.status }}</span>
              </div>
              <p>{{ stage.description }}</p>
              <div class="flow-stage-meta">
                <span>{{ stage.primaryMetric }}</span>
                <span>{{ stage.secondaryMetric }}</span>
              </div>
            </div>
            <router-link :to="stage.path" class="btn ghost btn-sm">进入</router-link>
          </article>
        </div>
      </PageCard>

      <PageCard title="流程对比" description="按规则来源聚合判定量和风险量。" compact>
        <div class="flow-compare">
          <article v-for="item in flowSummaries" :key="item.mode" class="compare-row">
            <div>
              <strong>{{ item.title }}</strong>
              <span>{{ item.description }}</span>
            </div>
            <div class="compare-stats">
              <span>{{ item.total }} 判定</span>
              <span class="danger-text">{{ item.violations }} 违规</span>
              <span>{{ item.allowed }} 通过</span>
            </div>
            <router-link :to="item.path" class="btn ghost btn-sm">查看</router-link>
          </article>
        </div>
      </PageCard>

      <PageCard title="最近风险" description="优先展示最近的违规、错误和在场疑似违规。" compact body-mode="scroll">
        <div v-if="!overviewRiskRecords.length" class="empty-state compact">暂无风险记录。</div>
        <div v-else class="record-list">
          <article v-for="item in overviewRiskRecords" :key="item.id" class="record-card danger">
            <div class="record-head">
              <div>
                <strong>{{ item.squadName || `Squad ${item.squadId ?? "?"}` }}</strong>
                <span>T{{ item.teamId ?? "?" }} / S{{ item.squadId ?? "?" }}</span>
              </div>
              <span class="pill" :data-tone="item.decisionTone">{{ item.sourceLabel }}</span>
            </div>
            <div class="record-meta">
              <span>队长: {{ item.creatorName || "-" }}</span>
              <span>时间: {{ formatTime(item.updatedAt || item.createdAt) }}</span>
            </div>
            <p class="reason">{{ item.reason || "未提供原因" }}</p>
          </article>
        </div>
      </PageCard>

      <PageCard title="当前在场小队" description="仅展示最终通过规则链的 RCON 快照。" compact body-mode="scroll">
        <div v-if="!orderedLifecycle.length" class="empty-state compact">当前没有可展示的小队快照。</div>
        <div v-else class="squad-table">
          <article v-for="record in orderedLifecycle.slice(0, 12)" :key="record.key" class="squad-row">
            <div>
              <strong>{{ record.squadName || `Squad ${record.squadId ?? "?"}` }}</strong>
              <span>T{{ record.teamId ?? "?" }} / S{{ record.squadId ?? "?" }}</span>
            </div>
            <span>{{ record.creatorName || "-" }}</span>
            <span>{{ record.squadNatureLabel || record.squadNature || "-" }}</span>
            <span class="pill" :data-tone="record.creationSource === 'LOG' ? 'ok' : 'muted'">
              {{ record.sourceLabel || record.creationSource || "-" }}
            </span>
          </article>
        </div>
      </PageCard>
    </section>

    <section v-if="!isOverviewPage" class="content-grid" :data-mode="pageMode">
      <PageCard
        class="records-panel"
        :title="currentFlowTitle"
        :description="currentFlowDescription"
        compact
        body-mode="scroll"
      >
        <template #actions>
          <span class="pill" data-tone="muted">{{ currentDecisionRecords.length }} 条</span>
        </template>

        <div v-if="!currentDecisionRecords.length" class="empty-state">暂无该流程判定记录。</div>
        <div v-else class="record-list">
          <article
            v-for="item in currentDecisionRecords"
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
              <span v-for="action in item.actionLabels" :key="`${item.id}-${action}`" class="tag">{{ action }}</span>
            </div>
            <div class="record-actions">
              <button v-if="item.canWhitelist" type="button" class="btn ghost btn-sm" @click="openWhitelistDialog(item)">
                加入白名单
              </button>
              <span v-if="item.squadNatureLabel" class="action-hint">当前性质: {{ item.squadNatureLabel }}</span>
            </div>
          </article>
        </div>
      </PageCard>

      <PageCard
        v-if="isSquadNamePage"
        class="risk-panel"
        title="当前疑似违规小队"
        description="只保留当前仍在 RCON 快照中的疑似违规队名，便于值班盯盘。"
        compact
        body-mode="scroll"
        tone="danger"
      >
        <div v-if="!activeViolations.length" class="empty-state">当前没有仍在场的疑似违规小队。</div>
        <div v-else class="record-list">
          <article v-for="item in activeViolations" :key="item.key" class="record-card danger">
            <div class="record-head">
              <div>
                <strong>{{ item.squadName || `Squad ${item.squadId ?? "?"}` }}</strong>
                <span>T{{ item.teamId ?? "?" }} / S{{ item.squadId ?? "?" }}</span>
              </div>
              <span class="pill danger">{{ item.sourceLabel }}</span>
            </div>
            <div class="record-meta">
              <span>建队: {{ item.createdAtLabel || formatTime(item.createdAt) }}</span>
              <span>来源: {{ item.creationSourceLabel }}</span>
              <span>队长: {{ item.creatorName || "-" }}</span>
            </div>
            <p class="reason">{{ item.reason || "未提供原因" }}</p>
            <div class="record-actions">
              <button v-if="canWhitelistRecord(item)" type="button" class="btn ghost btn-sm" @click="openWhitelistDialog(item)">
                加入白名单
              </button>
              <span v-if="item.squadNatureLabel" class="action-hint">当前性质: {{ item.squadNatureLabel }}</span>
            </div>
          </article>
        </div>
      </PageCard>

      <PageCard title="当前 RCON 小队快照" :description="currentSnapshotDescription" compact body-mode="scroll">
        <div v-if="!orderedLifecycle.length" class="empty-state">当前没有可展示的小队快照。</div>
        <div v-else class="squad-table">
          <article v-for="record in orderedLifecycle" :key="record.key" class="squad-row">
            <div>
              <strong>{{ record.squadName || `Squad ${record.squadId ?? "?"}` }}</strong>
              <span>T{{ record.teamId ?? "?" }} / S{{ record.squadId ?? "?" }}</span>
            </div>
            <span>{{ record.creatorName || "-" }}</span>
            <span>{{ record.squadNatureLabel || record.squadNature || "-" }}</span>
            <span class="pill" :data-tone="record.creationSource === 'LOG' ? 'ok' : 'muted'">
              {{ record.sourceLabel || record.creationSource || "-" }}
            </span>
            <button v-if="canWhitelistRecord(record)" type="button" class="btn ghost btn-sm" @click="openWhitelistDialog(record)">
              白名单
            </button>
          </article>
        </div>
      </PageCard>

      <PageCard
        v-if="isSquadNamePage"
        title="最近巡逻识别"
        description="巡逻系统只识别当前队名是否合规，暂不直接解散。"
        compact
        body-mode="scroll"
      >
        <div v-if="!patrolRecords.length" class="empty-state">暂无巡逻记录。</div>
        <div v-else class="record-list">
          <article v-for="record in patrolRecords" :key="record.id" class="record-card" :class="{ danger: record.violation }">
            <div class="record-head">
              <div>
                <strong>{{ record.event?.squadName || `Squad ${record.event?.squadId ?? "?"}` }}</strong>
                <span>T{{ record.event?.teamId ?? "?" }} / S{{ record.event?.squadId ?? "?" }}</span>
              </div>
              <span class="pill" :data-tone="record.violation ? 'danger' : 'ok'">{{ record.violation ? "违规" : "通过" }}</span>
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

    <Teleport to="body">
      <div
        v-if="whitelistModalOpen"
        class="whitelist-modal-backdrop"
        @click="closeWhitelistDialog"
        v-backdrop-close="closeWhitelistDialog"
      >
        <aside class="whitelist-modal" role="dialog" aria-modal="true" aria-label="加入白名单" @click.stop>
          <header class="whitelist-modal-head">
            <div>
              <h2>加入队名白名单</h2>
              <p>选择这个小队应归入的性质，保存后会写入队名白名单规则。</p>
            </div>
            <button type="button" class="btn ghost btn-sm" @click="closeWhitelistDialog">关闭</button>
          </header>

          <div class="whitelist-modal-body">
            <label class="modal-field">
              <span>小队名称</span>
              <input v-model.trim="whitelistDraft.squadName" type="text" class="modal-input" />
            </label>

            <label class="modal-field">
              <span>队伍性质</span>
              <select v-model="whitelistDraft.nature" class="modal-input">
                <option v-for="option in whitelistNatureOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>

            <div class="modal-summary">
              <span>当前白名单状态</span>
              <strong>{{ whitelistCurrentNatureLabel }}</strong>
              <small>重复加入会自动去重；改选性质会把队名移动到新的分类。</small>
            </div>

            <div v-if="whitelistError" class="modal-error">{{ whitelistError }}</div>
          </div>

          <footer class="whitelist-modal-actions">
            <button type="button" class="btn ghost" @click="closeWhitelistDialog">取消</button>
            <button type="button" class="btn primary" :disabled="whitelistSaving" @click="saveWhitelistEntry">
              {{ whitelistSaving ? "保存中..." : "确认加入" }}
            </button>
          </footer>
        </aside>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { apiGet, apiPost } from "../app/apiClient";
import { canAutoRefreshNow } from "../composables/useAutoRefreshGate";
import WorkspaceToolbar from "../components/common/WorkspaceToolbar.vue";
import PageCard from "../components/common/PageCard.vue";
import { useUiStore } from "../stores/ui.store";

type SquadRuleNature = "infantry" | "vehicle" | "support";
type FlowMode = "overview" | "squad-name" | "stepwise" | "fair";

const whitelistNatureOptions: Array<{ value: SquadRuleNature; label: string }> = [
  { value: "infantry", label: "普通步兵" },
  { value: "vehicle", label: "载具" },
  { value: "support", label: "支援" },
];

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

type GuardAction = { type?: string };

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
  detectLogCreated?: boolean;
  action?: string;
  stats?: Record<string, unknown>;
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
  squadNature?: string;
  squadNatureLabel?: string;
  createdAt?: string | null;
  createdAtLabel?: string;
  creationSourceLabel: string;
  sourceLabel: string;
  reason: string;
};

type BuildDecisionRecord = {
  id: string;
  source: TrackingRecord["source"];
  teamId?: number | null;
  squadId?: number | null;
  squadName?: string;
  creatorName?: string;
  squadNature?: string;
  squadNatureLabel?: string;
  sourceLabel: string;
  decisionLabel: string;
  decisionTone: "ok" | "warning" | "danger" | "muted";
  reason: string;
  createdAt?: string;
  updatedAt?: string;
  actionLabels: string[];
  canWhitelist: boolean;
};

type TrackingRecord = {
  id: string;
  serverId: string;
  matchId: string;
  teamId: number | null;
  squadId: number | null;
  squadName: string;
  creatorName: string;
  creatorSteamId: string;
  createdAt: string;
  updatedAt: string;
  stage: "squad_name" | "stepwise" | "fair" | "final";
  status: "allowed" | "violation" | "passed" | "skipped";
  source: "squad_name_rule" | "tiered_squad_time" | "fair_squad_creation" | "final_allowed";
  decisionLabel: string;
  decisionTone: "ok" | "warning" | "danger" | "muted";
  reason: string;
  squadNature: string;
  squadNatureLabel: string;
  actions: string[];
  canWhitelist?: boolean;
};

type SquadNameTrackingState = {
  lifecycle: LifecycleState;
  guard: GuardState;
  patrol: PatrolState;
  ruleChain: {
    recent: unknown[];
    stats: Record<string, unknown>;
  };
  stepwise: {
    enabled?: boolean;
    active?: boolean;
    settings?: Record<string, unknown>;
    recentRecords: unknown[];
    summary?: Record<string, unknown>;
  };
  fair: {
    enabled?: boolean;
    active?: boolean;
    settings?: Record<string, unknown>;
    phase?: {
      label?: string;
      phase?: string;
    };
    population?: {
      count?: number;
    };
    recentRecords: unknown[];
    summary?: Record<string, unknown>;
  };
  records: TrackingRecord[];
};

type WhitelistRulesResponse = {
  updatedAt?: string | null;
  exactRules?: Record<SquadRuleNature, string[]>;
};

type WhitelistSource = {
  squadName?: string;
  squadNature?: string;
  squadNatureLabel?: string;
};

const loading = ref(false);
const error = ref("");
const autoRefresh = ref(true);
const lifecycle = ref<LifecycleState | null>(null);
const guardState = ref<GuardState | null>(null);
const patrolState = ref<PatrolState | null>(null);
const stepwiseState = ref<SquadNameTrackingState["stepwise"] | null>(null);
const fairState = ref<SquadNameTrackingState["fair"] | null>(null);
const trackingRecords = ref<TrackingRecord[]>([]);
const whitelistRules = ref<Record<SquadRuleNature, string[]> | null>(null);
const whitelistModalOpen = ref(false);
const whitelistSaving = ref(false);
const whitelistError = ref("");
const whitelistDraft = reactive({
  squadName: "",
  nature: "infantry" as SquadRuleNature,
});
const ui = useUiStore();
const route = useRoute();
let autoRefreshTimer: number | null = null;

const pageMode = computed<FlowMode>(() => {
  const path = String(route.fullPath || route.path || "");
  if (path.includes("/squad-rule-chain/stepwise") || path.includes("stepwise-squad-playtime-guard")) return "stepwise";
  if (path.includes("/squad-rule-chain/fair") || path.includes("fair-squad-guard")) return "fair";
  if (path.includes("/squad-rule-chain/squad-name") || path.includes("squad-name-policy")) return "squad-name";
  return "overview";
});

const isOverviewPage = computed(() => pageMode.value === "overview");
const isSquadNamePage = computed(() => pageMode.value === "squad-name");

const flowTabs = [
  { mode: "overview", path: "/squad-rule-chain", title: "主统计", caption: "全链路概览" },
  { mode: "squad-name", path: "/squad-rule-chain/squad-name", title: "队名规范", caption: "命名与白名单" },
  { mode: "stepwise", path: "/squad-rule-chain/stepwise", title: "阶梯建队", caption: "时长门槛" },
  { mode: "fair", path: "/squad-rule-chain/fair", title: "公平建队", caption: "开局窗口" },
] satisfies Array<{ mode: FlowMode; path: string; title: string; caption: string }>;

const currentFlowTitle = computed(() => {
  if (pageMode.value === "squad-name") return "队名规范判定";
  if (pageMode.value === "stepwise") return "阶梯式建队判定";
  if (pageMode.value === "fair") return "公平建队判定";
  return "建队判定流水";
});

const currentFlowDescription = computed(() => {
  if (pageMode.value === "squad-name") return "检查默认名、白名单、载具命名规范和疑似违规队名。";
  if (pageMode.value === "stepwise") return "队名通过后，按开局时间段、小队性质和队长游戏时长放行或拦截。";
  if (pageMode.value === "fair") return "最后检查开局禁建、仅步兵窗口和当前人数阈值。";
  return "按队名规范、阶梯式时长、公平建队汇总后的最终链路结果。";
});

const currentSnapshotDescription = computed(() => {
  if (pageMode.value === "stepwise") return "结合内存快照，辅助核对阶梯式建队通过后仍在场的小队。";
  if (pageMode.value === "fair") return "结合内存快照，辅助核对公平建队通过后仍在场的小队。";
  return "结合内存快照，仅展示最终通过建队规则链的在场小队。";
});

const finalAllowedKeys = computed(() => {
  const keys = new Set<string>();
  for (const record of trackingRecords.value) {
    if (record.status !== "allowed") continue;
    const key = buildSlotKey(record.teamId, record.squadId);
    if (key) keys.add(key);
  }
  return keys;
});

const orderedLifecycle = computed(() => {
  const list = Array.isArray(lifecycle.value?.list) ? lifecycle.value!.list : [];
  return list
    .filter((item) => finalAllowedKeys.value.has(buildSlotKey(item.teamId, item.squadId)))
    .slice()
    .sort((left, right) => Number(right.createdAtMs ?? 0) - Number(left.createdAtMs ?? 0));
});

const guardViolations = computed(() => {
  const list = Array.isArray(guardState.value?.recent) ? guardState.value!.recent : [];
  return list.filter((item) => item.status === "violation" || item.status === "handled" || item.status === "error");
});

const buildDecisionRecords = computed<BuildDecisionRecord[]>(() => {
  return trackingRecords.value.map((record) => {
    let sourceLabel: string = record.source || "-";
    if (record.source === "squad_name_rule") sourceLabel = "队名规范";
    else if (record.source === "tiered_squad_time") sourceLabel = "阶梯建队";
    else if (record.source === "fair_squad_creation") sourceLabel = "公平建队";
    else if (record.source === "final_allowed") sourceLabel = "最终通过";

    return {
      id: record.id,
      source: record.source,
      teamId: record.teamId,
      squadId: record.squadId,
      squadName: record.squadName,
      creatorName: record.creatorName,
      squadNature: record.squadNature,
      squadNatureLabel: record.squadNatureLabel,
      sourceLabel,
      decisionLabel: record.decisionLabel || buildDecisionLabel(record.status),
      decisionTone: record.decisionTone || buildDecisionTone(record.status),
      reason: record.reason || "",
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      actionLabels: Array.isArray(record.actions) ? record.actions : [],
      canWhitelist: Boolean(record.canWhitelist),
    };
  });
});

const currentDecisionRecords = computed(() => {
  if (pageMode.value === "squad-name") return buildDecisionRecords.value.filter((item) => item.source === "squad_name_rule");
  if (pageMode.value === "stepwise") return buildDecisionRecords.value.filter((item) => item.source === "tiered_squad_time");
  if (pageMode.value === "fair") return buildDecisionRecords.value.filter((item) => item.source === "fair_squad_creation");
  return buildDecisionRecords.value;
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

const patrolViolationCount = computed(() => patrolRecords.value.filter((item) => item.violation).length);
const riskTotal = computed(() => violationDecisionCount.value + activeViolations.value.length);
const enabledFlowCount = computed(() => [guardState.value?.enabled, stepwiseState.value?.enabled, fairState.value?.enabled].filter(Boolean).length);
const passRateText = computed(() => {
  const total = buildDecisionRecords.value.length;
  if (!total) return "0%";
  return `${Math.round((allowedDecisionCount.value / total) * 100)}%`;
});
const healthTone = computed(() => {
  if (riskTotal.value > 0) return "danger";
  if (enabledFlowCount.value < 3) return "warning";
  return "ok";
});
const healthLabel = computed(() => {
  if (riskTotal.value > 0) return "需要关注";
  if (enabledFlowCount.value < 3) return "部分运行";
  return "运行正常";
});

const flowSummaries = computed(() => {
  return [
    buildFlowSummary("squad-name", "队名规范", "命名、白名单、巡逻识别", "/squad-rule-chain/squad-name", "squad_name_rule"),
    buildFlowSummary("stepwise", "阶梯式建队", "时间段与时长门槛", "/squad-rule-chain/stepwise", "tiered_squad_time"),
    buildFlowSummary("fair", "公平建队", "开局禁建与人数阈值", "/squad-rule-chain/fair", "fair_squad_creation"),
  ];
});

const overviewRiskRecords = computed(() => {
  return buildDecisionRecords.value
    .filter((item) => item.decisionTone === "danger" || item.decisionTone === "warning")
    .slice(0, 8);
});

const ruleStages = computed(() => {
  const guardStats = guardState.value?.stats ?? {};
  const stepwiseSummary = stepwiseState.value?.summary ?? {};
  const fairSummary = fairState.value?.summary ?? {};
  const fairPhase = fairState.value?.phase?.label || fairState.value?.phase?.phase || "未同步";
  const fairPopulation = numberText(fairState.value?.population?.count);

  return [
    {
      key: "squad-name",
      index: "01",
      path: "/squad-rule-chain/squad-name",
      title: "队名规范",
      status: guardState.value?.enabled ? "运行中" : "关闭",
      tone: guardState.value?.enabled ? "ok" : "danger",
      description: "先校验默认名、白名单、载具命名规范和疑似违规队名。",
      primaryMetric: `已判定 ${numberText(guardStats.evaluated)} 次`,
      secondaryMetric: `违规 ${numberText(guardStats.violations)} 次`,
    },
    {
      key: "stepwise",
      index: "02",
      path: "/squad-rule-chain/stepwise",
      title: "阶梯式建队",
      status: stepwiseState.value?.enabled ? "运行中" : "关闭",
      tone: stepwiseState.value?.enabled ? "ok" : "danger",
      description: "队名通过后，再按开局时间段、小队性质和队长游戏时长放行或拦截。",
      primaryMetric: `已判定 ${numberText(stepwiseSummary.total ?? stepwiseState.value?.recentRecords?.length)} 次`,
      secondaryMetric: `违规 ${numberText(stepwiseSummary.violations)} 次`,
    },
    {
      key: "fair",
      index: "03",
      path: "/squad-rule-chain/fair",
      title: "公平建队",
      status: fairState.value?.enabled ? "运行中" : "关闭",
      tone: fairState.value?.enabled ? "ok" : "danger",
      description: "最后检查开局禁建、仅步兵窗口和当前人数阈值。",
      primaryMetric: `阶段 ${fairPhase}`,
      secondaryMetric: `人数 ${fairPopulation} / 违规 ${numberText(fairSummary.violations)}`,
    },
  ] as const;
});

const activeViolations = computed<ActiveViolation[]>(() => {
  const current = orderedLifecycle.value;
  if (!current.length) return [];

  const latestPatrolByKey = new Map<string, PatrolRecord>();
  for (const record of patrolRecords.value) {
    const key = buildSlotKey(record.event?.teamId, record.event?.squadId);
    if (!key) continue;
    if (!latestPatrolByKey.has(key)) latestPatrolByKey.set(key, record);
  }

  return current
    .map((item) => {
      const key = buildSlotKey(item.teamId, item.squadId);
      const patrol = latestPatrolByKey.get(key);
      if (!patrol?.violation) return null;

      const patrolName = String(patrol.event?.squadName ?? "").trim().toLowerCase();
      const currentName = String(item.squadName ?? "").trim().toLowerCase();
      if (patrolName !== currentName) return null;

      return {
        key: item.key,
        teamId: item.teamId,
        squadId: item.squadId,
        squadName: item.squadName,
        creatorName: item.creatorName,
        squadNature: item.squadNature,
        squadNatureLabel: item.squadNatureLabel,
        createdAt: item.createdAt,
        createdAtLabel: item.createdAtLabel,
        creationSourceLabel: item.sourceLabel || item.creationSource || "-",
        sourceLabel: "巡逻识别",
        reason: patrol.reason || "巡逻识别为违规队名",
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
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
    const [trackingResponse, whitelistResponse] = await Promise.all([
      apiGet<{ ok: boolean; data: SquadNameTrackingState }>("/api/squad-name-tracking/state"),
      apiGet<WhitelistRulesResponse>("/api/squad-name/rules").catch(() => null),
    ]);
    const data = trackingResponse.data;
    lifecycle.value = data.lifecycle ?? { list: [] };
    guardState.value = data.guard ?? { enabled: false, recent: [] };
    patrolState.value = data.patrol ?? { enabled: false, recent: [] };
    stepwiseState.value = data.stepwise ?? { enabled: false, recentRecords: [] };
    fairState.value = data.fair ?? { enabled: false, recentRecords: [] };
    trackingRecords.value = data.records ?? [];
    whitelistRules.value = normalizeWhitelistRules(whitelistResponse?.exactRules);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "加载建队追踪失败。";
  } finally {
    if (showSpinner) loading.value = false;
  }
}

function buildFlowSummary(
  mode: FlowMode,
  title: string,
  description: string,
  path: string,
  source: TrackingRecord["source"],
) {
  const records = buildDecisionRecords.value.filter((item) => item.source === source);
  return {
    mode,
    title,
    description,
    path,
    total: records.length,
    violations: records.filter((item) => item.decisionTone === "danger" || item.decisionTone === "warning").length,
    allowed: records.filter((item) => item.decisionTone === "ok").length,
  };
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
  return new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function numberText(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return String(Math.max(0, Math.floor(number)));
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

function canWhitelistRecord(item: BuildDecisionRecord | ActiveViolation | LifecycleRecord) {
  const source = String((item as any).source ?? (item as any).sourceLabel ?? "").trim();
  return Boolean((item as any).squadName)
    && (
      source === "squad_name_rule"
      || source === "Patrol"
      || source === "巡逻识别"
      || source === "队名规范"
    );
}

async function openWhitelistDialog(source: WhitelistSource) {
  const squadName = String(source.squadName ?? "").trim();
  if (!squadName) {
    ui.pushToast({ title: "无法加入白名单", message: "缺少小队名称。", tone: "warn" });
    return;
  }

  whitelistError.value = "";
  try {
    await ensureWhitelistRulesLoaded();
    whitelistDraft.squadName = squadName;
    whitelistDraft.nature = getWhitelistNature(squadName)
      ?? normalizeNature(source.squadNature)
      ?? "infantry";
    whitelistModalOpen.value = true;
  } catch (err) {
    whitelistError.value = err instanceof Error ? err.message : "加载白名单失败。";
    ui.pushToast({ title: "加载失败", message: whitelistError.value, tone: "error" });
  }
}

function closeWhitelistDialog() {
  if (whitelistSaving.value) return;
  whitelistModalOpen.value = false;
  whitelistError.value = "";
}

async function ensureWhitelistRulesLoaded() {
  if (whitelistRules.value) return whitelistRules.value;

  const payload = await apiGet<WhitelistRulesResponse>("/api/squad-name/rules");
  whitelistRules.value = normalizeWhitelistRules(payload.exactRules);
  return whitelistRules.value;
}

async function saveWhitelistEntry() {
  const squadName = String(whitelistDraft.squadName ?? "").trim();
  if (!squadName) {
    whitelistError.value = "请输入小队名称。";
    return;
  }

  whitelistSaving.value = true;
  whitelistError.value = "";

  try {
    const nextRules = normalizeWhitelistRules(whitelistRules.value ?? undefined);
    removeWhitelistName(nextRules, squadName);
    nextRules[whitelistDraft.nature].push(squadName);

    const payload = await apiPost<WhitelistRulesResponse>("/api/squad-name/rules", {
      exactRules: nextRules,
    });

    whitelistRules.value = normalizeWhitelistRules(payload.exactRules ?? nextRules);
    whitelistModalOpen.value = false;
    ui.pushToast({
      title: "白名单已更新",
      message: `${squadName} 已加入 ${getNatureLabel(whitelistDraft.nature)} 白名单。`,
      tone: "ok",
    });
  } catch (err) {
    whitelistError.value = err instanceof Error ? err.message : "保存白名单失败。";
    ui.pushToast({
      title: "保存失败",
      message: whitelistError.value,
      tone: "error",
    });
  } finally {
    whitelistSaving.value = false;
  }
}

function normalizeWhitelistRules(exactRules?: Partial<Record<SquadRuleNature, string[]>> | null) {
  return {
    infantry: normalizeWhitelistNames(exactRules?.infantry),
    vehicle: normalizeWhitelistNames(exactRules?.vehicle),
    support: normalizeWhitelistNames(exactRules?.support),
  };
}

function normalizeWhitelistNames(values: unknown) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of Array.isArray(values) ? values : []) {
    const name = String(item ?? "").trim();
    if (!name) continue;
    const key = normalizeSquadNameKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

function removeWhitelistName(rules: Record<SquadRuleNature, string[]>, squadName: string) {
  const target = normalizeSquadNameKey(squadName);
  for (const nature of whitelistNatureOptions) {
    rules[nature.value] = rules[nature.value].filter((item) => normalizeSquadNameKey(item) !== target);
  }
}

function getWhitelistNature(squadName: string) {
  const target = normalizeSquadNameKey(squadName);
  if (!target || !whitelistRules.value) return null;

  for (const nature of whitelistNatureOptions) {
    if (whitelistRules.value[nature.value].some((item) => normalizeSquadNameKey(item) === target)) {
      return nature.value;
    }
  }
  return null;
}

function normalizeSquadNameKey(value: string) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeNature(value?: string) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "infantry" || normalized === "vehicle" || normalized === "support") return normalized;
  return null;
}

function getNatureLabel(nature?: string) {
  if (nature === "infantry") return "普通步兵";
  if (nature === "vehicle") return "载具";
  if (nature === "support") return "支援";
  return "未知";
}

const whitelistCurrentNatureLabel = computed(() => {
  const current = getWhitelistNature(whitelistDraft.squadName);
  if (current) return `当前已在 ${getNatureLabel(current)} 白名单`;
  return "当前未在白名单中";
});
</script>

<style scoped>
.tracking-page {
  display: grid;
  gap: 14px;
  padding: 14px;
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
  min-height: 34px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  padding: 0 12px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn.primary {
  border-color: rgba(69, 214, 148, 0.42);
  background: rgba(69, 214, 148, 0.16);
}

.btn.ghost {
  background: rgba(255, 255, 255, 0.03);
}

.btn-sm {
  min-height: 28px;
  padding: 0 9px;
  font-size: 12px;
}

.banner {
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
}

.banner.error {
  border: 1px solid rgba(255, 92, 92, 0.34);
  background: rgba(255, 92, 92, 0.14);
  color: #ffb3b3;
}

.flow-tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.flow-tab {
  min-width: 0;
  min-height: 54px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  padding: 9px 11px;
  background: rgba(255, 255, 255, 0.028);
  display: grid;
  gap: 3px;
  color: var(--color-text-primary);
  text-decoration: none;
}

.flow-tab.active {
  border-color: rgba(82, 145, 255, 0.42);
  background: rgba(82, 145, 255, 0.12);
}

.flow-tab strong,
.flow-tab span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-tab strong {
  font-size: 13px;
}

.flow-tab span {
  color: var(--color-text-muted);
  font-size: 11px;
}

.overview-hero {
  display: grid;
  grid-template-columns: minmax(260px, 1.3fr) repeat(4, minmax(140px, 1fr));
  gap: 10px;
}

.health-panel,
.hero-metric,
.ops-card {
  min-width: 0;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.032);
  display: grid;
  gap: 4px;
}

.health-panel {
  padding: 14px;
}

.health-panel[data-tone="ok"] {
  border-color: rgba(69, 214, 148, 0.34);
  background: rgba(69, 214, 148, 0.08);
}

.health-panel[data-tone="warning"] {
  border-color: rgba(245, 190, 80, 0.34);
  background: rgba(245, 190, 80, 0.08);
}

.health-panel[data-tone="danger"],
.hero-metric.danger,
.ops-card.danger {
  border-color: rgba(255, 92, 92, 0.3);
  background: rgba(255, 92, 92, 0.055);
}

.hero-metric.warning,
.ops-card.warning {
  border-color: rgba(245, 190, 80, 0.28);
}

.ops-band {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}

.ops-card.primary {
  border-color: rgba(82, 145, 255, 0.34);
  background: rgba(82, 145, 255, 0.11);
}

.health-panel span,
.health-panel em,
.hero-metric span,
.hero-metric em,
.ops-card span,
.ops-card em {
  color: var(--color-text-muted);
  font-size: 11px;
  font-style: normal;
  line-height: 1.35;
}

.health-panel strong {
  font-size: 30px;
  color: var(--color-text-primary);
  line-height: 1.05;
}

.hero-metric strong,
.ops-card strong {
  font-size: 26px;
  color: var(--color-text-primary);
  line-height: 1.05;
}

.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(360px, 0.9fr);
  grid-auto-rows: minmax(280px, 42vh);
  gap: 12px;
  min-height: 0;
}

.flow-stack,
.flow-compare,
.record-list,
.squad-table {
  display: grid;
  gap: 8px;
}

.flow-stage {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  min-height: 96px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.024);
}

.flow-stage[data-tone="ok"] {
  border-color: rgba(69, 214, 148, 0.22);
}

.flow-stage[data-tone="danger"] {
  border-color: rgba(255, 92, 92, 0.24);
}

.flow-stage-index {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(148, 163, 184, 0.22);
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 700;
}

.flow-stage-body {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.flow-stage-head,
.flow-stage-meta,
.compare-row,
.compare-stats,
.record-head,
.record-meta,
.tag-row,
.record-actions,
.whitelist-modal-head,
.whitelist-modal-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}

.flow-stage-head strong,
.compare-row strong,
.record-head strong {
  color: var(--color-text-primary);
}

.flow-stage-body p,
.reason {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.flow-stage-meta span,
.compare-row span,
.record-head span,
.record-meta span,
.action-hint {
  color: var(--color-text-muted);
  font-size: 12px;
}

.compare-row {
  min-height: 72px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.024);
}

.compare-row > div:first-child {
  min-width: 160px;
  display: grid;
  gap: 3px;
}

.compare-stats {
  justify-content: flex-start;
}

.danger-text {
  color: #ffadad !important;
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.14fr) minmax(360px, 0.86fr);
  grid-auto-rows: minmax(360px, 46vh);
  gap: 12px;
  min-height: 0;
}

.records-panel {
  grid-row: span 2;
}

.record-card {
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.024);
  display: grid;
  gap: 8px;
}

.record-card.danger {
  border-color: rgba(255, 92, 92, 0.28);
  background: rgba(255, 92, 92, 0.045);
}

.record-head strong,
.record-head span,
.record-meta span {
  display: block;
}

.record-head strong {
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reason {
  white-space: pre-line;
}

.squad-row {
  min-height: 48px;
  display: grid;
  grid-template-columns: minmax(160px, 1.2fr) minmax(90px, 0.8fr) minmax(70px, 0.5fr) auto auto;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.022);
}

.squad-row strong,
.squad-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.squad-row strong {
  display: block;
  color: var(--color-text-primary);
  font-size: 13px;
}

.squad-row span {
  color: var(--color-text-muted);
  font-size: 12px;
}

.empty-state {
  display: grid;
  place-items: center;
  min-height: 160px;
  color: var(--color-text-muted);
  text-align: center;
}

.empty-state.compact {
  min-height: 100px;
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

.whitelist-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(3, 7, 18, 0.72);
  backdrop-filter: blur(12px);
}

.whitelist-modal {
  width: min(560px, 100%);
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(10, 15, 28, 0.98));
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.36);
  display: grid;
  gap: 16px;
  padding: 18px;
}

.whitelist-modal-head h2 {
  margin: 0;
  font-size: 18px;
  color: var(--color-text-primary);
}

.whitelist-modal-head p {
  margin: 6px 0 0;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.whitelist-modal-body {
  display: grid;
  gap: 12px;
}

.modal-field {
  display: grid;
  gap: 8px;
}

.modal-field span {
  font-size: 12px;
  color: var(--color-text-muted);
}

.modal-input {
  width: 100%;
  min-height: 40px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
  padding: 0 12px;
  outline: none;
}

.modal-summary {
  display: grid;
  gap: 4px;
  border-radius: 8px;
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(255, 255, 255, 0.03);
}

.modal-summary span,
.modal-summary small {
  color: var(--color-text-muted);
  font-size: 11px;
}

.modal-summary strong {
  color: var(--color-text-primary);
  font-size: 14px;
}

.modal-error {
  border-radius: 8px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 92, 92, 0.34);
  background: rgba(255, 92, 92, 0.12);
  color: #ffb3b3;
  font-size: 12px;
}

@media (max-width: 1320px) {
  .overview-hero {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .health-panel {
    grid-column: span 2;
  }

  .ops-band {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 1180px) {
  .overview-grid,
  .content-grid {
    grid-template-columns: 1fr;
    grid-auto-rows: minmax(280px, auto);
  }

  .records-panel {
    grid-row: auto;
  }

  .flow-tabs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .overview-hero,
  .ops-band {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .health-panel {
    grid-column: 1 / -1;
  }

  .flow-stage,
  .squad-row {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .tracking-page {
    padding: 10px;
  }

  .overview-hero,
  .ops-band,
  .flow-tabs {
    grid-template-columns: 1fr;
  }

  .whitelist-modal {
    max-height: calc(100vh - 24px);
    overflow: auto;
  }
}
</style>
