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
        <em>通过规则链汇总后的建队判定</em>
      </article>
      <article class="summary-card">
        <span>合法建队</span>
        <strong>{{ allowedDecisionCount }}</strong>
        <em>最终通过建队规则链</em>
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
        title="建队规则链判定流水"
        description="按队名规范、阶梯式时长、公平建队的最终链路结果生成记录。"
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
            <div class="record-actions">
              <button
                v-if="item.canWhitelist"
                type="button"
                class="btn ghost btn-sm"
                @click="openWhitelistDialog(item)"
              >
                加入白名单
              </button>
              <span v-if="item.squadNatureLabel" class="action-hint">
                当前性质：{{ item.squadNatureLabel }}
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
            <div class="record-actions">
              <button
                v-if="canWhitelistRecord(item)"
                type="button"
                class="btn ghost btn-sm"
                @click="openWhitelistDialog(item)"
              >
                加入白名单
              </button>
              <span v-if="item.squadNatureLabel" class="action-hint">
                当前性质：{{ item.squadNatureLabel }}
              </span>
            </div>
          </article>
        </div>
      </PageCard>

      <PageCard
        title="当前 RCON 小队快照"
        description="结合 RCON 内存快照，仅展示最终通过建队规则链的在场小队。"
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
            <div class="record-actions">
              <button
                v-if="canWhitelistRecord(record)"
                type="button"
                class="btn ghost btn-sm"
                @click="openWhitelistDialog(record)"
              >
                加入白名单
              </button>
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
              <h2>加入白名单</h2>
              <p>选择这个小队应该归入的性质，保存后会写入队名白名单规则。</p>
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
                <option v-for="option in whitelistNatureOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>

            <div class="modal-summary">
              <span>当前白名单状态</span>
              <strong>{{ whitelistCurrentNatureLabel }}</strong>
              <small>重复加入会自动去重，改选性质会把队名移到新的分类里。</small>
            </div>

            <div v-if="whitelistError" class="modal-error">{{ whitelistError }}</div>
          </div>

          <footer class="whitelist-modal-actions">
            <button type="button" class="btn ghost" @click="closeWhitelistDialog">取消</button>
            <button type="button" class="btn primary" :disabled="whitelistSaving" @click="saveWhitelistEntry">
              {{ whitelistSaving ? "保存中.." : "确认加入" }}
            </button>
          </footer>
        </aside>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import { apiGet, apiPost } from "../app/apiClient";
import { canAutoRefreshNow } from "../composables/useAutoRefreshGate";
import WorkspaceToolbar from "../components/common/WorkspaceToolbar.vue";
import PageCard from "../components/common/PageCard.vue";
import { useUiStore } from "../stores/ui.store";

type SquadRuleNature = "infantry" | "vehicle" | "support";

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
  squadNature?: string;
  squadNatureLabel?: string;
  createdAt?: string | null;
  createdAtLabel?: string;
  creationSourceLabel: string;
  sourceLabel: string;
  reason: string;
  canWhitelist?: boolean;
};

type BuildDecisionRecord = {
  id: string;
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
    recentRecords: unknown[];
    summary?: Record<string, unknown>;
  };
  fair: {
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
let autoRefreshTimer: number | null = null;

const finalAllowedKeys = computed(() => {
  const keys = new Set<string>();
  for (const record of trackingRecords.value) {
    if (record.status !== "allowed") continue;
    const key = buildSlotKey(record.teamId, record.squadId);
    if (key) {
      keys.add(key);
    }
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
    else if (record.source === "tiered_squad_time") sourceLabel = "阶梯时长";
    else if (record.source === "fair_squad_creation") sourceLabel = "公平建队";
    else if (record.source === "final_allowed") sourceLabel = "最终通过";

    return {
      id: record.id,
      teamId: record.teamId,
      squadId: record.squadId,
      squadName: record.squadName,
      creatorName: record.creatorName,
      squadNature: record.squadNature,
      squadNatureLabel: record.squadNatureLabel,
      sourceLabel,
      decisionLabel: record.decisionLabel,
      decisionTone: record.decisionTone,
      reason: record.reason || "",
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      actionLabels: Array.isArray(record.actions) ? record.actions : [],
      canWhitelist: Boolean(record.canWhitelist),
    };
  });
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
        squadNature: item.squadNature,
        squadNatureLabel: item.squadNatureLabel,
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
    const [trackingResponse, whitelistResponse] = await Promise.all([
      apiGet<{ ok: boolean; data: SquadNameTrackingState }>("/api/squad-name-tracking/state"),
      apiGet<WhitelistRulesResponse>("/api/squad-name/rules").catch(() => null),
    ]);
    const data = trackingResponse.data;
    lifecycle.value = data.lifecycle ?? { list: [] };
    guardState.value = data.guard ?? { enabled: false, recent: [] };
    patrolState.value = data.patrol ?? { enabled: false, recent: [] };
    trackingRecords.value = data.records ?? [];
    whitelistRules.value = normalizeWhitelistRules(whitelistResponse?.exactRules);
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
      || source === "队名规范"
      || source === "巡逻"
    );
}

function shouldHideDecisionRecord(record: GuardRecord) {
  const status = String(record.status ?? "").trim();
  const reason = String(record.reason ?? "").trim();
  if (status !== "skipped") return false;
  return reason === "missing_required_fields" || reason === "duplicate";
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

.btn-sm {
  min-height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 12px;
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

.record-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.action-hint {
  color: var(--color-text-muted);
  font-size: 11px;
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
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(10, 15, 28, 0.98));
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.36);
  display: grid;
  gap: 16px;
  padding: 18px;
}

.whitelist-modal-head,
.whitelist-modal-actions {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
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
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
  padding: 0 12px;
  outline: none;
}

.modal-summary {
  display: grid;
  gap: 4px;
  border-radius: 12px;
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
  border-radius: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 92, 92, 0.34);
  background: rgba(255, 92, 92, 0.12);
  color: #ffb3b3;
  font-size: 12px;
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

  .whitelist-modal {
    padding: 16px;
  }

  .whitelist-modal-head,
  .whitelist-modal-actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
