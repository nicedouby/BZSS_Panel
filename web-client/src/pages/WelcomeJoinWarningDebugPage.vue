<template>
  <section class="welcome-join-warning-page">
    <PageHeader
      eyebrow="Broadcast Ops"
      title="进服警告"
      subtitle="按规则组为进入服务器的玩家自动发送多段 AdminWarn，支持时长分流、名单匹配、冷却和模拟验证。"
    >
      <template #actions>
        <button type="button" class="btn ghost" :disabled="loading" @click="loadState(true)">
          {{ loading ? "刷新中..." : "刷新" }}
        </button>
        <button type="button" :class="['btn', autoRefresh ? 'primary' : 'ghost']" @click="toggleAutoRefresh">
          {{ autoRefresh ? "自动刷新" : "手动刷新" }}
        </button>
        <button type="button" class="btn primary" :disabled="savingConfig" @click="saveConfig">
          {{ savingConfig ? "保存中..." : "保存配置" }}
        </button>
      </template>
    </PageHeader>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <div class="summary-grid">
      <PageCard title="运行状态" compact>
        <div class="status-row">
          <span class="status-chip" :data-tone="draft.enabled ? 'ok' : 'danger'">{{ draft.enabled ? "已启用" : "已停用" }}</span>
          <span class="status-chip" :data-tone="state?.subscribed ? 'ok' : 'danger'">{{ state?.subscribed ? "事件已订阅" : "事件未订阅" }}</span>
          <span class="status-chip subtle">待发送 {{ state?.pendingCount ?? 0 }}</span>
        </div>
        <dl class="metric-grid">
          <div><dt>进服事件</dt><dd>{{ state?.joinEventCount ?? 0 }}</dd></div>
          <div><dt>计划警告</dt><dd>{{ state?.scheduledCount ?? 0 }}</dd></div>
          <div><dt>命中规则</dt><dd>{{ state?.matchedRuleCount ?? 0 }}</dd></div>
          <div><dt>被抑制</dt><dd>{{ state?.suppressedCount ?? 0 }}</dd></div>
          <div><dt>发送成功</dt><dd class="ok-text">{{ state?.warnSuccessCount ?? 0 }}</dd></div>
          <div><dt>发送失败</dt><dd class="danger-text">{{ state?.warnFailedCount ?? 0 }}</dd></div>
        </dl>
      </PageCard>

      <PageCard title="全局策略" compact>
        <div class="compact-form">
          <label class="toggle-row">
            <span>启用进服警告</span>
            <input v-model="draft.enabled" type="checkbox" />
          </label>
          <div class="field-grid">
            <label class="field">
              <span>单次进服上限</span>
              <input v-model.number="draft.maxWarningsPerJoin" class="input" type="number" min="1" max="20" />
            </label>
            <label class="field">
              <span>默认间隔(秒)</span>
              <input v-model.number="defaultIntervalSeconds" class="input" type="number" min="0" max="3600" />
            </label>
            <label class="field">
              <span>历史上限</span>
              <input v-model.number="draft.historyLimit" class="input" type="number" min="20" max="1000" />
            </label>
          </div>
          <p class="hint">所有命中的规则都会按优先级排队发送，超出上限或命中冷却的步骤会记录为抑制。</p>
        </div>
      </PageCard>
    </div>

    <div class="main-grid">
      <PageCard title="规则组" compact class="rules-card">
        <template #actions>
          <button type="button" class="btn ghost" @click="addRule">新增规则组</button>
        </template>
        <div class="rule-list">
          <article
            v-for="rule in sortedRules"
            :key="rule.id"
            :class="['rule-row', selectedRuleId === rule.id ? 'selected' : '']"
            @click="selectRule(rule.id)"
          >
            <div class="rule-main">
              <label class="inline-toggle" @click.stop>
                <input v-model="rule.enabled" type="checkbox" />
                <span>{{ rule.enabled ? "启用" : "停用" }}</span>
              </label>
              <div class="rule-title">
                <strong>{{ rule.name || rule.id }}</strong>
                <small>#{{ rule.priority }} · {{ rule.mode === "any" ? "任一条件" : "全部条件" }}</small>
              </div>
            </div>
            <div class="rule-meta">
              <span>{{ rule.conditions.length }} 条件</span>
              <span>{{ enabledSteps(rule).length }} 消息</span>
              <span>{{ formatSeconds(rule.cooldownMs) }} 冷却</span>
            </div>
          </article>
          <div v-if="!draft.rules.length" class="empty-block">暂无规则组。</div>
        </div>
      </PageCard>

      <PageCard title="规则编辑" compact class="editor-card">
        <div v-if="selectedRule" class="editor-stack">
          <div class="field-grid two">
            <label class="field">
              <span>规则名称</span>
              <input v-model.trim="selectedRule.name" class="input" type="text" />
            </label>
            <label class="field">
              <span>规则 ID</span>
              <input v-model.trim="selectedRule.id" class="input" type="text" />
            </label>
            <label class="field">
              <span>优先级</span>
              <input v-model.number="selectedRule.priority" class="input" type="number" />
            </label>
            <label class="field">
              <span>初始延迟(秒)</span>
              <input v-model.number="selectedInitialDelaySeconds" class="input" type="number" min="0" />
            </label>
            <label class="field">
              <span>组内间隔(秒)</span>
              <input v-model.number="selectedIntervalSeconds" class="input" type="number" min="0" />
            </label>
            <label class="field">
              <span>玩家冷却(秒)</span>
              <input v-model.number="selectedCooldownSeconds" class="input" type="number" min="0" />
            </label>
          </div>

          <div class="segmented">
            <button type="button" :class="{ active: selectedRule.mode === 'all' }" @click="selectedRule.mode = 'all'">全部条件</button>
            <button type="button" :class="{ active: selectedRule.mode === 'any' }" @click="selectedRule.mode = 'any'">任一条件</button>
          </div>

          <section class="editor-section">
            <div class="section-head">
              <h3>匹配条件</h3>
              <button type="button" class="btn ghost small" @click="addCondition">新增条件</button>
            </div>
            <div class="condition-list">
              <div v-for="(condition, index) in selectedRule.conditions" :key="index" class="condition-row">
                <select v-model="condition.type" class="input">
                  <option v-for="option in conditionTypes" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
                <input v-model.trim="condition.value" class="input" :placeholder="conditionPlaceholder(condition.type)" />
                <input v-if="condition.type === 'playtimeHours'" v-model.number="condition.minHours" class="input mini" type="number" placeholder="最小小时" />
                <input v-if="condition.type === 'playtimeHours'" v-model.number="condition.maxHours" class="input mini" type="number" placeholder="最大小时" />
                <input v-if="condition.type === 'fieldExists' || condition.type === 'fieldEquals'" v-model.trim="condition.field" class="input mini" placeholder="字段" />
                <button type="button" class="icon-btn" title="删除条件" @click="selectedRule.conditions.splice(index, 1)">×</button>
              </div>
            </div>
          </section>

          <section class="editor-section">
            <div class="section-head">
              <h3>警告消息</h3>
              <button type="button" class="btn ghost small" @click="addStep">新增消息</button>
            </div>
            <div class="step-list">
              <div v-for="(step, index) in selectedRule.steps" :key="step.id || index" class="step-row">
                <div class="step-head">
                  <label class="inline-toggle">
                    <input v-model="step.enabled" type="checkbox" />
                    <span>第 {{ index + 1 }} 条</span>
                  </label>
                  <label class="override-field">
                    <span>覆盖间隔(秒)</span>
                    <input v-model.number="stepIntervalSeconds[index]" class="input tiny" type="number" min="0" placeholder="默认" @change="syncStepInterval(index)" />
                  </label>
                  <button type="button" class="icon-btn" title="删除消息" @click="selectedRule.steps.splice(index, 1)">×</button>
                </div>
                <textarea v-model="step.message" class="textarea" rows="3" maxlength="180" />
              </div>
            </div>
          </section>

          <div class="editor-actions">
            <button type="button" class="btn danger" @click="deleteSelectedRule">删除规则组</button>
          </div>
        </div>
        <div v-else class="empty-block">选择一个规则组进行编辑。</div>
      </PageCard>
    </div>

    <div class="ops-grid">
      <PageCard title="游戏内预览" compact>
        <div class="mock-game">
          <div class="mock-warning" v-for="item in previewSteps" :key="item.key">
            <div class="mock-title">ADMIN WARNING FROM SERVER</div>
            <div class="mock-message">{{ item.message }}</div>
            <div class="mock-footer">{{ item.ruleName }} · 进服后 {{ Math.round(item.delayMs / 1000) }} 秒</div>
          </div>
          <div v-if="!previewSteps.length" class="empty-block">当前规则没有可预览的启用消息。</div>
        </div>
      </PageCard>

      <PageCard title="模拟命中" compact>
        <div class="compact-form">
          <div class="field-grid two">
            <label class="field"><span>玩家名</span><input v-model.trim="sim.playerName" class="input" type="text" /></label>
            <label class="field"><span>SteamID</span><input v-model.trim="sim.steamID" class="input" type="text" /></label>
            <label class="field"><span>EOSID</span><input v-model.trim="sim.eosID" class="input" type="text" /></label>
            <label class="field"><span>IP</span><input v-model.trim="sim.ip" class="input" type="text" /></label>
            <label class="field"><span>队伍</span><input v-model.trim="sim.teamID" class="input" type="text" /></label>
            <label class="field"><span>小队</span><input v-model.trim="sim.squadID" class="input" type="text" /></label>
            <label class="field"><span>时长(小时)</span><input v-model.number="sim.gameHours" class="input" type="number" min="0" /></label>
          </div>
          <button type="button" class="btn primary" :disabled="busy" @click="simulateJoin">
            {{ busy ? "模拟中..." : "模拟并按规则发送" }}
          </button>
          <div v-if="simulationResult" class="simulation-result">
            <strong>命中 {{ simulationResult.matchedRules?.length ?? 0 }} 组，计划 {{ simulationResult.scheduled?.length ?? 0 }} 条</strong>
            <p v-if="simulationResult.suppressed?.length">抑制：{{ simulationResult.suppressed.map((item: any) => item.reason).join(" / ") }}</p>
          </div>
        </div>
      </PageCard>
    </div>

    <div class="tables-container">
      <PageCard title="发送历史" compact>
        <template #actions>
          <button type="button" class="btn danger small" :disabled="busy" @click="clearHistory">清空历史</button>
        </template>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>类型</th>
                <th>状态</th>
                <th>玩家</th>
                <th>规则</th>
                <th>详情</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!history.length"><td colspan="6" class="empty-cell">暂无发送历史。</td></tr>
              <tr v-for="item in history" :key="item.id">
                <td class="mono">{{ formatTime(item.at) }}</td>
                <td>{{ item.kind === "join" ? "进服调度" : "警告发送" }}</td>
                <td><span class="badge" :data-tone="item.success ? 'ok' : item.skipped ? 'skip' : 'danger'">{{ item.success ? "成功" : item.skipped ? "跳过" : "失败" }}</span></td>
                <td>{{ item.event?.playerName || "-" }}</td>
                <td>{{ item.ruleName || item.ruleId || "-" }}</td>
                <td class="truncate" :title="describeHistory(item)">{{ describeHistory(item) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </PageCard>

      <PageCard title="原始进服事件" compact>
        <template #actions>
          <button type="button" class="btn ghost small" :disabled="busy" @click="clearEvents">清空事件</button>
        </template>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>事件</th>
                <th>玩家</th>
                <th>SteamID</th>
                <th>IP</th>
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!recentEvents.length"><td colspan="6" class="empty-cell">暂无进服事件。</td></tr>
              <tr v-for="item in recentEvents" :key="item.id">
                <td class="mono">{{ formatTime(item.at) }}</td>
                <td>{{ item.eventName || "-" }}</td>
                <td>{{ item.playerName || "-" }}</td>
                <td>{{ item.steamID || "-" }}</td>
                <td>{{ item.ip || "-" }}</td>
                <td>
                  <span v-if="item.hasPayload" class="badge" data-tone="ok">payload</span>
                  <span v-if="item.hasParamMap" class="badge" data-tone="ok">paramMap</span>
                  <span v-if="item.hasParams" class="badge" data-tone="ok">params</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </PageCard>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { apiGet, apiPost } from "../app/apiClient";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import { canAutoRefreshNow } from "../composables/useAutoRefreshGate";
import { useUiStore } from "../stores/ui.store";

type ConditionType = "always" | "playtimeHours" | "playtimeUnknown" | "nameContains" | "nameRegex" | "steamIdIn" | "eosIdIn" | "ipContains" | "ipRegex" | "teamIdIn" | "squadIdIn" | "factionIn" | "fieldExists" | "fieldEquals";

type RuleCondition = {
  type: ConditionType | string;
  label?: string;
  value?: string;
  values?: string[] | string;
  pattern?: string;
  minHours?: number | null;
  maxHours?: number | null;
  field?: string;
};

type RuleStep = {
  id: string;
  enabled: boolean;
  message: string;
  intervalOverrideMs?: number;
};

type WarningRule = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  cooldownMs: number;
  mode: "all" | "any";
  initialDelayMs: number;
  intervalMs: number;
  conditions: RuleCondition[];
  steps: RuleStep[];
};

type WarningConfig = {
  enabled: boolean;
  historyLimit: number;
  maxWarningsPerJoin: number;
  defaultIntervalMs: number;
  rules: WarningRule[];
};

type HistoryItem = {
  id: string;
  at: string;
  kind?: string;
  success?: boolean;
  skipped?: boolean;
  reason?: string;
  message?: string;
  delayMs?: number;
  ruleId?: string;
  ruleName?: string;
  stepIndex?: number;
  errorMessage?: string;
  event?: {
    eventName?: string;
    playerName?: string;
    serverId?: string;
  };
  result?: {
    errorMessage?: string;
    skipReason?: string;
  };
  suppressed?: Array<{ reason?: string }>;
};

type RecentEvent = {
  id: string;
  at: string;
  eventName: string;
  eventId: string;
  serverId: string;
  playerName: string;
  steamID?: string;
  ip?: string;
  hasPayload: boolean;
  hasParams: boolean;
  hasParamMap: boolean;
};

const ui = useUiStore();
const loading = ref(false);
const busy = ref(false);
const savingConfig = ref(false);
const error = ref("");
const state = ref<any>(null);
const autoRefresh = ref(true);
const selectedRuleId = ref("");
const simulationResult = ref<any>(null);
const stepIntervalSeconds = ref<Array<number | undefined>>([]);
const draftDirty = ref(false);
let applyingDraft = false;
let autoRefreshTimer: number | null = null;

const draft = reactive<WarningConfig>({
  enabled: true,
  historyLimit: 100,
  maxWarningsPerJoin: 5,
  defaultIntervalMs: 15000,
  rules: [],
});

const sim = reactive({
  playerName: "DebugPlayer",
  steamID: "",
  eosID: "",
  ip: "",
  teamID: "",
  squadID: "",
  gameHours: 50,
});

const conditionTypes: Array<{ value: ConditionType; label: string }> = [
  { value: "always", label: "全员" },
  { value: "playtimeHours", label: "游玩时长区间" },
  { value: "playtimeUnknown", label: "未知时长" },
  { value: "nameContains", label: "玩家名包含" },
  { value: "nameRegex", label: "玩家名正则" },
  { value: "steamIdIn", label: "SteamID 名单" },
  { value: "eosIdIn", label: "EOSID 名单" },
  { value: "ipContains", label: "IP 包含" },
  { value: "ipRegex", label: "IP 正则" },
  { value: "teamIdIn", label: "队伍 ID" },
  { value: "squadIdIn", label: "小队 ID" },
  { value: "factionIn", label: "阵营字段" },
  { value: "fieldExists", label: "字段存在" },
  { value: "fieldEquals", label: "字段等于" },
];

const history = computed<HistoryItem[]>(() => (Array.isArray(state.value?.history) ? state.value.history : []));
const recentEvents = computed<RecentEvent[]>(() => (Array.isArray(state.value?.recentEvents) ? state.value.recentEvents : []));
const sortedRules = computed(() => draft.rules.slice().sort((a, b) => Number(a.priority) - Number(b.priority)));
const selectedRule = computed(() => draft.rules.find(rule => rule.id === selectedRuleId.value) ?? draft.rules[0] ?? null);

const defaultIntervalSeconds = computed({
  get: () => Math.round(Number(draft.defaultIntervalMs ?? 0) / 1000),
  set: (value: number) => { draft.defaultIntervalMs = Math.max(0, Number(value) || 0) * 1000; },
});

const selectedInitialDelaySeconds = computed({
  get: () => Math.round(Number(selectedRule.value?.initialDelayMs ?? 0) / 1000),
  set: (value: number) => { if (selectedRule.value) selectedRule.value.initialDelayMs = Math.max(0, Number(value) || 0) * 1000; },
});

const selectedIntervalSeconds = computed({
  get: () => Math.round(Number(selectedRule.value?.intervalMs ?? 0) / 1000),
  set: (value: number) => { if (selectedRule.value) selectedRule.value.intervalMs = Math.max(0, Number(value) || 0) * 1000; },
});

const selectedCooldownSeconds = computed({
  get: () => Math.round(Number(selectedRule.value?.cooldownMs ?? 0) / 1000),
  set: (value: number) => { if (selectedRule.value) selectedRule.value.cooldownMs = Math.max(0, Number(value) || 0) * 1000; },
});

const previewSteps = computed(() => {
  const rule = selectedRule.value;
  if (!rule) return [];
  let delayMs = Number(rule.initialDelayMs ?? 0);
  return enabledSteps(rule).map((step, index) => {
    const item = {
      key: `${rule.id}:${step.id}:${index}`,
      ruleName: rule.name,
      message: step.message,
      delayMs,
    };
    delayMs += Number(step.intervalOverrideMs ?? rule.intervalMs ?? draft.defaultIntervalMs ?? 0);
    return item;
  });
});

watch(selectedRule, (rule) => {
  stepIntervalSeconds.value = (rule?.steps ?? []).map(step => step.intervalOverrideMs == null ? undefined : Math.round(Number(step.intervalOverrideMs) / 1000));
}, { immediate: true });

watch(draft, () => {
  if (!applyingDraft) draftDirty.value = true;
}, { deep: true, flush: "sync" });

onMounted(() => {
  void loadState();
  document.addEventListener("visibilitychange", handleVisibilityChange);
  setupAutoRefresh();
});

onUnmounted(() => {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
});

function handleVisibilityChange() {
  setupAutoRefresh();
}

function setupAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  if (!autoRefresh.value) return;
  autoRefreshTimer = window.setInterval(() => {
    if (canAutoRefreshNow()) void loadState();
  }, document.hidden ? 10_000 : 2_000);
}

function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value;
  setupAutoRefresh();
}

async function loadState(force = false) {
  if (loading.value && !force) return;
  loading.value = true;
  error.value = "";
  try {
    const response = await apiGet<{ ok: boolean; data: any }>("/api/plugins/welcome-join-warning/state");
    state.value = response.data ?? null;
    if (force || !draftDirty.value) {
      applyStateToDraft(response.data?.config ?? response.data);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function applyStateToDraft(config: Partial<WarningConfig> | null | undefined) {
  if (!config || !Array.isArray(config.rules)) return;
  applyingDraft = true;
  try {
    draft.enabled = config.enabled !== false;
    draft.historyLimit = Number(config.historyLimit ?? 100);
    draft.maxWarningsPerJoin = Number(config.maxWarningsPerJoin ?? 5);
    draft.defaultIntervalMs = Number(config.defaultIntervalMs ?? 15000);
    draft.rules.splice(0, draft.rules.length, ...clone(config.rules));
    if (!selectedRuleId.value || !draft.rules.some(rule => rule.id === selectedRuleId.value)) {
      selectedRuleId.value = draft.rules[0]?.id ?? "";
    }
    draftDirty.value = false;
  } finally {
    applyingDraft = false;
  }
}

async function saveConfig() {
  const validation = validateDraft();
  if (validation) {
    ui.pushToast({ title: "配置校验失败", message: validation, tone: "warn" });
    return;
  }

  savingConfig.value = true;
  try {
    const response = await apiPost<{ ok: boolean; data: any }>("/api/plugins/welcome-join-warning/config", clone(draft));
    state.value = response.data ?? null;
    applyStateToDraft(response.data?.config ?? response.data);
    ui.pushToast({ title: "保存成功", message: "进服警告规则已保存。", tone: "ok" });
  } catch (err) {
    ui.pushToast({ title: "保存失败", message: err instanceof Error ? err.message : String(err), tone: "error" });
  } finally {
    savingConfig.value = false;
  }
}

function validateDraft() {
  if (draft.historyLimit < 20) return "历史上限不能小于 20。";
  if (draft.maxWarningsPerJoin < 1) return "单次进服上限不能小于 1。";
  const ids = new Set<string>();
  for (const rule of draft.rules) {
    if (!rule.id.trim()) return "规则 ID 不能为空。";
    if (ids.has(rule.id)) return `规则 ID 重复：${rule.id}`;
    ids.add(rule.id);
    if (!rule.steps.some(step => step.enabled !== false && step.message.trim())) return `规则 ${rule.name || rule.id} 至少需要一条启用消息。`;
  }
  return "";
}

function addRule() {
  const id = `rule-${Date.now().toString(36)}`;
  draft.rules.push({
    id,
    name: "新规则组",
    enabled: true,
    priority: (draft.rules.length + 1) * 10,
    cooldownMs: 0,
    mode: "all",
    initialDelayMs: 15000,
    intervalMs: draft.defaultIntervalMs,
    conditions: [{ type: "always" }],
    steps: [{ id: "step-1", enabled: true, message: "欢迎来到服务器，请遵守规则。" }],
  });
  draftDirty.value = true;
  selectedRuleId.value = id;
}

function selectRule(id: string) {
  selectedRuleId.value = id;
}

function deleteSelectedRule() {
  const rule = selectedRule.value;
  if (!rule) return;
  const index = draft.rules.findIndex(item => item.id === rule.id);
  if (index >= 0) draft.rules.splice(index, 1);
  draftDirty.value = true;
  selectedRuleId.value = draft.rules[Math.max(0, index - 1)]?.id ?? draft.rules[0]?.id ?? "";
}

function addCondition() {
  selectedRule.value?.conditions.push({ type: "always" });
  draftDirty.value = true;
}

function addStep() {
  const rule = selectedRule.value;
  if (!rule) return;
  rule.steps.push({
    id: `step-${rule.steps.length + 1}`,
    enabled: true,
    message: "请输入警告内容。",
  });
  draftDirty.value = true;
  void nextTick(() => {
    stepIntervalSeconds.value = rule.steps.map(step => step.intervalOverrideMs == null ? undefined : Math.round(Number(step.intervalOverrideMs) / 1000));
  });
}

function syncStepInterval(index: number) {
  const rule = selectedRule.value;
  if (!rule?.steps[index]) return;
  const value = stepIntervalSeconds.value[index];
  if (value == null || Number.isNaN(Number(value))) {
    delete rule.steps[index].intervalOverrideMs;
    draftDirty.value = true;
    return;
  }
  rule.steps[index].intervalOverrideMs = Math.max(0, Number(value) || 0) * 1000;
  draftDirty.value = true;
}

async function simulateJoin() {
  busy.value = true;
  simulationResult.value = null;
  try {
    const response = await apiPost<{ ok: boolean; data: any }>("/api/plugins/welcome-join-warning/simulate", {
      playerName: sim.playerName || "DebugPlayer",
      steamID: sim.steamID || undefined,
      eosID: sim.eosID || undefined,
      ip: sim.ip || undefined,
      teamID: sim.teamID || undefined,
      squadID: sim.squadID || undefined,
      gameHours: sim.gameHours === null || sim.gameHours === undefined ? undefined : sim.gameHours,
    });
    simulationResult.value = response.data ?? null;
    ui.pushToast({ title: "模拟已提交", message: "命中结果已返回，发送记录会按延迟进入历史。", tone: "ok" });
    await loadState(true);
  } catch (err) {
    ui.pushToast({ title: "模拟失败", message: err instanceof Error ? err.message : String(err), tone: "error" });
  } finally {
    busy.value = false;
  }
}

async function clearHistory() {
  busy.value = true;
  try {
    await apiPost("/api/plugins/welcome-join-warning/clear", {});
    await loadState(true);
    ui.pushToast({ title: "历史已清空", message: "发送历史已清空。", tone: "ok" });
  } catch (err) {
    ui.pushToast({ title: "清空失败", message: err instanceof Error ? err.message : String(err), tone: "error" });
  } finally {
    busy.value = false;
  }
}

async function clearEvents() {
  busy.value = true;
  try {
    await apiPost("/api/plugins/welcome-join-warning/clear-events", {});
    await loadState(true);
    ui.pushToast({ title: "事件已清空", message: "原始事件记录已清空。", tone: "ok" });
  } catch (err) {
    ui.pushToast({ title: "清空失败", message: err instanceof Error ? err.message : String(err), tone: "error" });
  } finally {
    busy.value = false;
  }
}

function enabledSteps(rule: WarningRule) {
  return rule.steps.filter(step => step.enabled !== false && step.message.trim());
}

function conditionPlaceholder(type: string) {
  if (type === "steamIdIn" || type === "eosIdIn") return "每行或逗号分隔名单";
  if (type === "nameRegex" || type === "ipRegex") return "正则表达式";
  if (type === "nameContains" || type === "ipContains") return "包含文本";
  if (type === "teamIdIn" || type === "squadIdIn" || type === "factionIn") return "多个值用逗号分隔";
  if (type === "fieldEquals") return "目标值";
  return "可选";
}

function formatSeconds(ms: number | undefined) {
  return `${Math.round(Number(ms ?? 0) / 1000)}s`;
}

function formatTime(value: string | number | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function describeHistory(item: HistoryItem) {
  if (item.kind === "join") {
    const suppressed = item.suppressed?.length ? `，抑制 ${item.suppressed.length} 条` : "";
    return `${item.reason || "join"}${suppressed}`;
  }
  return item.result?.errorMessage || item.result?.skipReason || item.errorMessage || item.message || item.reason || "-";
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
</script>

<style scoped>
.welcome-join-warning-page {
  display: grid;
  gap: 16px;
  padding: 16px;
  min-width: 0;
}

.error-banner {
  border: 1px solid rgba(248, 113, 113, 0.35);
  background: rgba(248, 113, 113, 0.1);
  color: rgb(252, 165, 165);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
}

.summary-grid,
.ops-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.main-grid {
  display: grid;
  grid-template-columns: minmax(320px, 0.8fr) minmax(0, 1.2fr);
  gap: 16px;
  align-items: start;
}

.rules-card,
.editor-card {
  min-width: 0;
}

.status-row,
.rule-meta,
.section-head,
.editor-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.status-chip,
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border-soft);
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-secondary);
}

.status-chip[data-tone="ok"],
.badge[data-tone="ok"] {
  border-color: rgba(52, 211, 153, 0.3);
  color: #34d399;
  background: rgba(52, 211, 153, 0.08);
}

.status-chip[data-tone="danger"],
.badge[data-tone="danger"] {
  border-color: rgba(248, 113, 113, 0.34);
  color: #f87171;
  background: rgba(248, 113, 113, 0.08);
}

.badge[data-tone="skip"] {
  border-color: rgba(245, 158, 11, 0.32);
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.08);
}

.status-chip.subtle {
  color: var(--color-text-muted);
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 14px 0 0;
}

.metric-grid div {
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--color-bg-elevated) 70%, transparent);
}

.metric-grid dt {
  color: var(--color-text-muted);
  font-size: 11px;
}

.metric-grid dd {
  margin: 4px 0 0;
  color: var(--color-text-primary);
  font-size: 17px;
  font-weight: 800;
}

.ok-text { color: #34d399 !important; }
.danger-text { color: #f87171 !important; }

.compact-form,
.editor-stack {
  display: grid;
  gap: 12px;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.field-grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.field {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.field span,
.override-field span {
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 700;
}

.input,
.textarea,
select.input {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-bg-elevated) 88%, transparent);
  color: var(--color-text-primary);
  padding: 8px 10px;
  font-size: 13px;
  outline: none;
}

.textarea {
  resize: vertical;
  line-height: 1.45;
}

.input:focus,
.textarea:focus {
  border-color: rgba(96, 165, 250, 0.5);
  box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.12);
}

.hint {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.toggle-row,
.inline-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.toggle-row {
  justify-content: space-between;
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  padding: 9px 10px;
}

.rule-list,
.condition-list,
.step-list,
.tables-container {
  display: grid;
  gap: 10px;
}

.rule-row {
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  padding: 10px;
  cursor: pointer;
  background: color-mix(in srgb, var(--color-bg-elevated) 70%, transparent);
}

.rule-row.selected {
  border-color: rgba(96, 165, 250, 0.5);
  background: rgba(96, 165, 250, 0.08);
}

.rule-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.rule-title {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.rule-title strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rule-title small,
.rule-meta {
  color: var(--color-text-muted);
  font-size: 11px;
}

.rule-meta {
  margin-top: 8px;
}

.segmented {
  display: inline-grid;
  grid-template-columns: repeat(2, 1fr);
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  overflow: hidden;
  width: max-content;
}

.segmented button {
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  padding: 7px 12px;
  cursor: pointer;
}

.segmented button.active {
  background: rgba(96, 165, 250, 0.16);
  color: #93c5fd;
}

.editor-section {
  display: grid;
  gap: 10px;
  border-top: 1px solid var(--color-border-soft);
  padding-top: 12px;
}

.section-head {
  justify-content: space-between;
}

.section-head h3 {
  margin: 0;
  font-size: 14px;
}

.condition-row {
  display: grid;
  grid-template-columns: 160px minmax(140px, 1fr) repeat(2, minmax(90px, 120px)) 32px;
  gap: 8px;
  align-items: center;
}

.condition-row .mini {
  min-width: 90px;
}

.step-row {
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  padding: 10px;
  display: grid;
  gap: 8px;
}

.step-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.override-field {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

.tiny {
  width: 90px;
}

.icon-btn {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid var(--color-border-soft);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.mock-game {
  min-height: 260px;
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.82), rgba(3, 7, 18, 0.96)),
    radial-gradient(circle at 50% 30%, rgba(148, 163, 184, 0.18), transparent 48%);
  padding: 14px;
  display: grid;
  align-content: start;
  gap: 10px;
}

.mock-warning {
  max-width: 520px;
  justify-self: center;
  width: 92%;
  border: 1px solid rgba(239, 68, 68, 0.42);
  border-radius: 6px;
  background: rgba(127, 29, 29, 0.42);
  padding: 9px 12px;
  text-align: center;
}

.mock-title {
  color: #fca5a5;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.mock-message {
  margin-top: 5px;
  color: white;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.45;
  font-size: 13px;
  font-weight: 700;
}

.mock-footer {
  margin-top: 5px;
  color: rgba(255, 255, 255, 0.45);
  font-size: 10px;
}

.simulation-result {
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  padding: 10px;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.simulation-result p {
  margin: 6px 0 0;
}

.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 780px;
  font-size: 12px;
}

.data-table th,
.data-table td {
  border-bottom: 1px solid var(--color-border-soft);
  padding: 9px 10px;
  text-align: left;
}

.data-table th {
  color: var(--color-text-muted);
  font-size: 11px;
  background: rgba(255, 255, 255, 0.03);
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  color: var(--color-text-muted);
}

.truncate {
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-block,
.empty-cell {
  color: var(--color-text-muted);
  text-align: center;
  padding: 18px;
}

.btn {
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
}

.btn.small {
  padding: 6px 10px;
  font-size: 12px;
}

.btn.ghost {
  background: transparent;
}

.btn.primary {
  border-color: rgba(96, 165, 250, 0.45);
  background: rgba(96, 165, 250, 0.14);
  color: #93c5fd;
}

.btn.danger {
  border-color: rgba(248, 113, 113, 0.38);
  background: rgba(248, 113, 113, 0.08);
  color: #fca5a5;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

@media (max-width: 1100px) {
  .summary-grid,
  .main-grid,
  .ops-grid {
    grid-template-columns: 1fr;
  }

  .condition-row {
    grid-template-columns: 1fr;
  }

  .field-grid,
  .field-grid.two {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .welcome-join-warning-page {
    gap: 10px;
    padding: 10px;
  }

  .page-header,
  .panel-head,
  .actions-row {
    align-items: stretch;
    flex-direction: column;
  }

  .summary-grid,
  .main-grid,
  .ops-grid,
  .field-grid,
  .field-grid.two {
    gap: 10px;
  }
}
</style>
