<template>
  <section class="page stepwise-guard-page">
    <PageHeader
      eyebrow="Plugin"
      title="阶梯式建队时长"
      subtitle="查看步兵与载具建队窗口、广播/告警开关和最近判定结果。这里可以直接调整规则并手动模拟一次建队判定，便于确认违规建队是否会广播、解散和告警。"
    >
      <template #actions>
        <div class="header-actions">
          <span class="status-chip" :data-tone="statusTone">{{ statusLabel }}</span>
          <button type="button" class="ghost-btn" :disabled="loading" @click="refreshState">
            {{ loading ? "刷新中..." : "刷新" }}
          </button>
          <button type="button" class="ghost-btn" :disabled="saving" @click="saveSettings">
            {{ saving ? "保存中..." : "保存设置" }}
          </button>
          <button type="button" class="ghost-btn" :disabled="toggling" @click="toggleEnabled">
            {{ toggling ? "切换中..." : (state?.enabled ? "停用插件" : "启用插件") }}
          </button>
        </div>
      </template>
    </PageHeader>

    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="info" class="banner info">{{ info }}</div>

    <div class="hero-grid">
      <PageCard class="hero-card" title="运行概览" description="当前状态、广播策略和最近判定摘要。">
        <div class="chip-row">
          <span class="status-chip" :data-tone="statusTone">{{ statusLabel }}</span>
          <span class="status-chip subtle">订阅: {{ state?.subscribed ? "已订阅" : "未订阅" }}</span>
          <span class="status-chip subtle">最近记录: {{ state?.summary?.total ?? 0 }}</span>
          <span class="status-chip subtle">违规: {{ state?.summary?.violations ?? 0 }}</span>
        </div>

        <dl class="metric-grid">
          <div>
            <dt>通过</dt>
            <dd>{{ state?.summary?.approved ?? 0 }}</dd>
          </div>
          <div>
            <dt>广播</dt>
            <dd>{{ state?.summary?.broadcasts ?? 0 }}</dd>
          </div>
          <div>
            <dt>解散</dt>
            <dd>{{ state?.summary?.disbands ?? 0 }}</dd>
          </div>
          <div>
            <dt>告警</dt>
            <dd>{{ state?.summary?.warns ?? 0 }}</dd>
          </div>
          <div>
            <dt>待查时长</dt>
            <dd>{{ state?.summary?.pendingLookups ?? 0 }}</dd>
          </div>
          <div>
            <dt>待审计日志</dt>
            <dd>{{ state?.pendingLogCount ?? 0 }}</dd>
          </div>
        </dl>

        <div class="rule-summary">
          <article>
            <span>步兵窗口</span>
            <strong>{{ formatRuleSummary(draft.rules.infantry) }}</strong>
          </article>
          <article>
            <span>载具窗口</span>
            <strong>{{ formatRuleSummary(draft.rules.vehicle) }}</strong>
          </article>
        </div>

        <div class="switch-grid">
          <label class="switch-row">
            <input v-model="draft.broadcastOnApproved" type="checkbox" />
            <span>
              <strong>通过时广播</strong>
              <em>满足当前窗口规则时向全服广播建队信息。</em>
            </span>
          </label>
          <label class="switch-row">
            <input v-model="draft.broadcastOnViolation" type="checkbox" />
            <span>
              <strong>违规时广播</strong>
              <em>违规建队、解散和告警时也同步广播提示。</em>
            </span>
          </label>
          <label class="switch-row">
            <input v-model="draft.warnOnMissingPlaytime" type="checkbox" />
            <span>
              <strong>缺时长时告警</strong>
              <em>找不到玩家时长时先告警，再根据策略继续处理。</em>
            </span>
          </label>
          <label class="switch-row">
            <input v-model="draft.liveLookupWhenMissing" type="checkbox" />
            <span>
              <strong>缺失时实时查询</strong>
              <em>缓存里没有时尝试后台刷新 Steam 游戏时长。</em>
            </span>
          </label>
        </div>

        <div class="inline-field">
          <label for="max-recent-records">最近记录上限</label>
          <input id="max-recent-records" v-model.number="draft.maxRecentRecords" type="number" min="0" step="1" />
        </div>
      </PageCard>

      <PageCard class="simulate-card" title="手动模拟" description="用当前规则模拟一次建队判定，方便确认广播、解散和告警是否都触发。">
        <div class="simulate-grid">
          <label class="field">
            <span>玩家名</span>
            <input v-model.trim="simulateForm.playerName" type="text" placeholder="Leader" />
          </label>
          <label class="field">
            <span>SteamID</span>
            <input v-model.trim="simulateForm.steamID" type="text" placeholder="7656119..." />
          </label>
          <label class="field">
            <span>小队名</span>
            <input v-model.trim="simulateForm.squadName" type="text" placeholder="INF 1" />
          </label>
          <label class="field">
            <span>Team ID</span>
            <input v-model.number="simulateForm.teamId" type="number" min="0" step="1" />
          </label>
          <label class="field">
            <span>Squad ID</span>
            <input v-model.number="simulateForm.squadId" type="number" min="0" step="1" />
          </label>
          <label class="field">
            <span>游戏时长</span>
            <input v-model.number="simulateForm.playtimeHours" type="number" min="0" step="0.1" />
          </label>
          <label class="field">
            <span>创建来源</span>
            <select v-model="simulateForm.creationSource">
              <option value="LOG">LOG</option>
              <option value="RCON_SNAPSHOT">RCON_SNAPSHOT</option>
            </select>
          </label>
          <div class="field info-cell">
            <span>当前对局</span>
            <strong>{{ state?.active ? "插件运行中" : "插件未运行" }}</strong>
            <em>实际判定仍以当前服务器日志时钟和暖机状态为准。</em>
          </div>
        </div>

        <div class="action-row">
          <button type="button" class="primary-btn" :disabled="simulating" @click="simulateCreation">
            {{ simulating ? "模拟中..." : "模拟建队" }}
          </button>
          <button type="button" class="ghost-btn" :disabled="simulating" @click="syncDraftFromState">
            还原当前设置
          </button>
        </div>
      </PageCard>
    </div>

    <PageCard class="rules-card" title="规则编辑" description="直接编辑步兵与载具的阶梯窗口。修改后点击保存即可写回插件配置。">
      <div class="rules-layout">
        <section class="rule-group">
          <div class="rule-group__head">
            <div>
              <h3>步兵队</h3>
              <p>识别为步兵队名后，按时间窗逐段提高最低游戏时长要求。</p>
            </div>
            <button type="button" class="ghost-btn ghost-btn--compact" @click="addRule('infantry')">
              添加一行
            </button>
          </div>

          <div class="rule-list">
            <article v-for="(rule, index) in draft.rules.infantry" :key="`inf-${index}`" class="rule-row">
              <label>
                <span>开始秒</span>
                <input v-model.number="rule.startSeconds" type="number" min="0" step="1" />
              </label>
              <label>
                <span>结束秒</span>
                <input v-model.number="rule.endSeconds" type="number" min="0" step="1" />
              </label>
              <label>
                <span>最小时长(h)</span>
                <input v-model.number="rule.minHoursExclusive" type="number" min="0" step="1" />
              </label>
              <button type="button" class="danger-btn danger-btn--compact" @click="removeRule('infantry', index)">
                删除
              </button>
            </article>
          </div>
        </section>

        <section class="rule-group">
          <div class="rule-group__head">
            <div>
              <h3>载具队</h3>
              <p>识别为载具队名后，按更后面的时间窗执行对应门槛。</p>
            </div>
            <button type="button" class="ghost-btn ghost-btn--compact" @click="addRule('vehicle')">
              添加一行
            </button>
          </div>

          <div class="rule-list">
            <article v-for="(rule, index) in draft.rules.vehicle" :key="`veh-${index}`" class="rule-row">
              <label>
                <span>开始秒</span>
                <input v-model.number="rule.startSeconds" type="number" min="0" step="1" />
              </label>
              <label>
                <span>结束秒</span>
                <input v-model.number="rule.endSeconds" type="number" min="0" step="1" />
              </label>
              <label>
                <span>最小时长(h)</span>
                <input v-model.number="rule.minHoursExclusive" type="number" min="0" step="1" />
              </label>
              <button type="button" class="danger-btn danger-btn--compact" @click="removeRule('vehicle', index)">
                删除
              </button>
            </article>
          </div>
        </section>
      </div>
    </PageCard>

    <PageCard class="records-card" title="最近判定" description="按时间倒序展示最近判定、广播、解散和告警的实际结果。">
      <div class="table-wrap">
        <table class="records-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>结果</th>
              <th>窗口</th>
              <th>队伍</th>
              <th>时长</th>
              <th>动作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!records.length">
              <td colspan="6" class="empty-cell">暂无判定记录</td>
            </tr>
            <tr v-for="record in records" :key="record.id">
              <td>{{ formatTime(record.updatedAt || record.createdAt) }}</td>
              <td>
                <span class="pill" :data-tone="record.approved ? 'ok' : 'danger'">
                  {{ record.approved ? "通过" : "违规" }}
                </span>
              </td>
              <td>{{ record.phaseLabel || record.decision || "-" }}</td>
              <td>
                <strong>{{ record.squadName || "未知小队" }}</strong>
                <span>{{ record.squadNatureLabel || record.squadNature || "-" }}</span>
              </td>
              <td>
                <strong>{{ record.playtime?.hoursText || "未知" }}</strong>
                <span>{{ record.playtime?.source || "-" }}</span>
              </td>
              <td class="action-cell">
                <span v-for="action in record.actions || []" :key="`${record.id}-${action.type}`" class="action-pill">
                  {{ action.type }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </PageCard>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { apiGet, apiPost } from "../app/apiClient";
import { setPluginEnabled, updatePluginConfig } from "../features/plugins/plugin.api";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";

const PLUGIN_ID = "plugin.stepwiseSquadPlaytimeGuard";
const STATE_API = "/api/plugins/stepwise-squad-playtime-guard/state";
const SIMULATE_API = "/api/plugins/stepwise-squad-playtime-guard/simulate";

interface RuleItem {
  startSeconds: number;
  endSeconds: number;
  minHoursExclusive: number;
}

interface StepwiseSettings {
  directory: string;
  broadcastOnApproved: boolean;
  broadcastOnViolation: boolean;
  warnOnMissingPlaytime: boolean;
  liveLookupWhenMissing: boolean;
  maxRecentRecords: number;
  rules: {
    infantry: RuleItem[];
    vehicle: RuleItem[];
  };
}

interface StepwiseAction {
  type: string;
}

interface StepwiseRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  squadName: string;
  squadNature: string;
  squadNatureLabel: string;
  phaseLabel: string;
  decision: string;
  approved: boolean;
  violation: boolean;
  playtime: {
    source: string;
    hoursText: string;
  };
  actions: StepwiseAction[];
}

interface StepwiseState {
  enabled: boolean;
  subscribed: boolean;
  active: boolean;
  pendingLogCount: number;
  summary: {
    total: number;
    approved: number;
    violations: number;
    broadcasts: number;
    disbands: number;
    warns: number;
    pendingLookups: number;
  };
  settings: StepwiseSettings;
  recentRecords: StepwiseRecord[];
}

interface DraftSettings {
  broadcastOnApproved: boolean;
  broadcastOnViolation: boolean;
  warnOnMissingPlaytime: boolean;
  liveLookupWhenMissing: boolean;
  maxRecentRecords: number;
  rules: {
    infantry: RuleItem[];
    vehicle: RuleItem[];
  };
}

const loading = ref(false);
const saving = ref(false);
const simulating = ref(false);
const toggling = ref(false);
const error = ref("");
const info = ref("");
const state = ref<StepwiseState | null>(null);
const draft = reactive<DraftSettings>(createDraft());
const simulateForm = reactive({
  playerName: "Leader",
  steamID: "",
  squadName: "INF 1",
  teamId: 1,
  squadId: 1,
  playtimeHours: 0,
  creationSource: "LOG",
});

const records = computed(() => {
  return [...(state.value?.recentRecords ?? [])].sort((left, right) => {
    return String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt));
  });
});

const statusTone = computed(() => {
  if (!state.value) return "info";
  if (!state.value?.subscribed) return "warning";
  if (!state.value?.enabled) return "danger";
  if (state.value.active) return "ok";
  return "info";
});

const statusLabel = computed(() => {
  if (!state.value) return "未加载";
  if (!state.value.subscribed) return "未订阅";
  if (!state.value.enabled) return "已停用";
  if (state.value.active) return "运行中";
  return "就绪";
});

onMounted(() => {
  void refreshState();
});

async function refreshState() {
  loading.value = true;
  error.value = "";
  try {
    const response = await apiGet<{ ok: boolean; data: StepwiseState }>(STATE_API);
    state.value = response.data ?? null;
    syncDraftFromState();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function syncDraftFromState() {
  const settings = state.value?.settings;
  if (!settings) return;

  draft.broadcastOnApproved = Boolean(settings.broadcastOnApproved);
  draft.broadcastOnViolation = Boolean(settings.broadcastOnViolation);
  draft.warnOnMissingPlaytime = Boolean(settings.warnOnMissingPlaytime);
  draft.liveLookupWhenMissing = Boolean(settings.liveLookupWhenMissing);
  draft.maxRecentRecords = Number(settings.maxRecentRecords ?? 0) || 0;
  draft.rules = cloneRules(settings.rules);
}

async function saveSettings() {
  saving.value = true;
  error.value = "";
  info.value = "";

  try {
    await updatePluginConfig(PLUGIN_ID, {
      broadcastOnApproved: draft.broadcastOnApproved,
      broadcastOnViolation: draft.broadcastOnViolation,
      warnOnMissingPlaytime: draft.warnOnMissingPlaytime,
      liveLookupWhenMissing: draft.liveLookupWhenMissing,
      maxRecentRecords: normalizeInt(draft.maxRecentRecords),
      rules: cloneRules(draft.rules),
    });
    info.value = "设置已保存。";
    await refreshState();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

async function toggleEnabled() {
  if (!state.value) return;
  toggling.value = true;
  error.value = "";
  info.value = "";

  try {
    const updated = await setPluginEnabled(PLUGIN_ID, !state.value.enabled);
    state.value = { ...state.value, enabled: Boolean(updated.enabled), active: Boolean(updated.enabled) };
    info.value = updated.enabled ? "插件已启用。" : "插件已停用。";
    await refreshState();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    toggling.value = false;
  }
}

async function simulateCreation() {
  simulating.value = true;
  error.value = "";
  info.value = "";

  try {
    const response = await apiPost<{ ok: boolean; data: StepwiseRecord | null }>(SIMULATE_API, {
      creatorName: simulateForm.playerName || "Leader",
      creatorSteamId: simulateForm.steamID || undefined,
      squadName: simulateForm.squadName || "INF 1",
      teamId: normalizeOptionalInt(simulateForm.teamId),
      squadId: normalizeOptionalInt(simulateForm.squadId),
      creationSource: simulateForm.creationSource || "LOG",
      playtime: {
        known: true,
        gameSeconds: Math.max(0, Math.round(Number(simulateForm.playtimeHours ?? 0) * 3600)),
      },
    });

    const result = response.data;
    info.value = result
      ? `模拟完成：${result.approved ? "通过" : "违规"}，${result.actions?.map((action) => action.type).join(" / ") || "无动作"}。`
      : "模拟完成。";
    await refreshState();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    simulating.value = false;
  }
}

function addRule(kind: "infantry" | "vehicle") {
  draft.rules[kind].push({
    startSeconds: 0,
    endSeconds: 0,
    minHoursExclusive: 0,
  });
}

function removeRule(kind: "infantry" | "vehicle", index: number) {
  draft.rules[kind].splice(index, 1);
}

function createDraft(settings?: StepwiseSettings | null): DraftSettings {
  return {
    broadcastOnApproved: Boolean(settings?.broadcastOnApproved ?? true),
    broadcastOnViolation: Boolean(settings?.broadcastOnViolation ?? true),
    warnOnMissingPlaytime: Boolean(settings?.warnOnMissingPlaytime ?? true),
    liveLookupWhenMissing: Boolean(settings?.liveLookupWhenMissing ?? true),
    maxRecentRecords: Number(settings?.maxRecentRecords ?? 300) || 300,
    rules: cloneRules(settings?.rules),
  };
}

function cloneRules(source?: StepwiseSettings["rules"] | DraftSettings["rules"] | null): DraftSettings["rules"] {
  return {
    infantry: Array.isArray(source?.infantry) ? source.infantry.map(cloneRule) : [],
    vehicle: Array.isArray(source?.vehicle) ? source.vehicle.map(cloneRule) : [],
  };
}

function cloneRule(rule?: Partial<RuleItem> | null): RuleItem {
  return {
    startSeconds: normalizeInt(rule?.startSeconds),
    endSeconds: normalizeInt(rule?.endSeconds),
    minHoursExclusive: normalizeInt(rule?.minHoursExclusive),
  };
}

function normalizeInt(value: unknown) {
  const number = Math.floor(Number(value ?? 0));
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizeOptionalInt(value: unknown) {
  if (value == null || value === "") return null;
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? number : null;
}

function formatTime(value: string | number | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatRuleSummary(list: RuleItem[]) {
  if (!list.length) return "暂无规则";
  return list
    .map((rule) => `${normalizeInt(rule.startSeconds)}-${normalizeInt(rule.endSeconds)}s > ${normalizeInt(rule.minHoursExclusive)}h`)
    .join(" / ");
}
</script>

<style scoped>
.stepwise-guard-page {
  position: relative;
  display: grid;
  gap: 18px;
  padding: 18px;
  overflow: visible;
}

.stepwise-guard-page::before {
  content: "";
  position: absolute;
  inset: -90px auto auto -120px;
  width: 280px;
  height: 280px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(56, 189, 248, 0.16), transparent 68%);
  pointer-events: none;
  filter: blur(8px);
}

.stepwise-guard-page::after {
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

.stepwise-guard-page > * {
  position: relative;
  z-index: 1;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.banner {
  border-radius: 14px;
  padding: 12px 14px;
  border: 1px solid transparent;
}

.banner.error {
  border-color: rgba(239, 68, 68, 0.24);
  background: rgba(239, 68, 68, 0.12);
  color: #fecaca;
}

.banner.info {
  border-color: rgba(59, 130, 246, 0.24);
  background: rgba(59, 130, 246, 0.12);
  color: #bfdbfe;
}

.hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.9fr);
  gap: 16px;
}

.hero-card,
.simulate-card,
.rules-card,
.records-card {
  min-width: 0;
}

.chip-row,
.action-row {
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
  border-color: rgba(34, 197, 94, 0.34);
  background: rgba(34, 197, 94, 0.12);
  color: #bbf7d0;
}

.status-chip[data-tone="warning"] {
  border-color: rgba(245, 158, 11, 0.34);
  background: rgba(245, 158, 11, 0.12);
  color: #fde68a;
}

.status-chip[data-tone="danger"] {
  border-color: rgba(239, 68, 68, 0.34);
  background: rgba(239, 68, 68, 0.12);
  color: #fecaca;
}

.status-chip[data-tone="info"] {
  border-color: rgba(59, 130, 246, 0.34);
  background: rgba(59, 130, 246, 0.12);
  color: #cfe2ff;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 14px 0 0;
}

.metric-grid > div,
.rule-summary article {
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 14px;
  padding: 10px 12px;
  background: rgba(15, 23, 42, 0.24);
}

.metric-grid dt,
.rule-summary span {
  margin: 0;
  font-size: 11px;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.metric-grid dd,
.rule-summary strong {
  margin: 6px 0 0;
  font-size: 15px;
  color: var(--color-text-primary);
}

.rule-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.switch-grid {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.switch-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.22);
}

.switch-row input {
  margin-top: 4px;
}

.switch-row strong {
  display: block;
  color: var(--color-text-primary);
}

.switch-row em {
  display: block;
  margin-top: 4px;
  font-style: normal;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.inline-field {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}

.inline-field label,
.field span,
.rule-row span {
  color: var(--color-text-muted);
  font-size: 12px;
}

.inline-field input,
.field input,
.field select,
.rule-row input {
  width: 100%;
  min-height: 38px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
  padding: 8px 10px;
  outline: none;
}

.simulate-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.field {
  display: grid;
  gap: 6px;
}

.info-cell {
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 14px;
  padding: 12px;
  background: rgba(15, 23, 42, 0.2);
}

.info-cell strong {
  color: var(--color-text-primary);
  font-size: 16px;
}

.info-cell em {
  font-style: normal;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.primary-btn,
.ghost-btn,
.danger-btn {
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

.ghost-btn--compact,
.danger-btn--compact {
  min-height: 32px;
  padding: 0 10px;
  border-radius: 10px;
}

.primary-btn {
  border-color: rgba(59, 130, 246, 0.32);
  background: rgba(59, 130, 246, 0.14);
  color: #cfe2ff;
}

.danger-btn {
  border-color: rgba(239, 68, 68, 0.28);
  background: rgba(239, 68, 68, 0.1);
  color: #fecaca;
}

.primary-btn:hover:not(:disabled),
.ghost-btn:hover:not(:disabled),
.danger-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: rgba(96, 165, 250, 0.32);
}

.primary-btn:disabled,
.ghost-btn:disabled,
.danger-btn:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.rules-layout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.rule-group {
  display: grid;
  gap: 12px;
}

.rule-group__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.rule-group__head h3 {
  margin: 0;
  font-size: 16px;
}

.rule-group__head p {
  margin: 6px 0 0;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.rule-list {
  display: grid;
  gap: 10px;
}

.rule-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
  gap: 10px;
  align-items: end;
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.2);
}

.rule-row label {
  display: grid;
  gap: 6px;
}

.table-wrap {
  overflow-x: auto;
}

.records-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 920px;
}

.records-table th,
.records-table td {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
  text-align: left;
  vertical-align: top;
}

.records-table th {
  font-size: 11px;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.records-table td strong,
.records-table td span {
  display: block;
}

.records-table td span {
  color: var(--color-text-muted);
  font-size: 12px;
}

.pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(255, 255, 255, 0.04);
  font-size: 12px;
  font-weight: 700;
}

.pill[data-tone="ok"] {
  border-color: rgba(34, 197, 94, 0.24);
  background: rgba(34, 197, 94, 0.12);
  color: #bbf7d0;
}

.pill[data-tone="danger"] {
  border-color: rgba(239, 68, 68, 0.24);
  background: rgba(239, 68, 68, 0.12);
  color: #fecaca;
}

.action-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.action-pill {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-muted);
  font-size: 11px;
}

.empty-cell {
  color: var(--color-text-muted);
  text-align: center;
  padding: 18px 12px;
}

@media (max-width: 1200px) {
  .hero-grid,
  .rules-layout,
  .simulate-grid,
  .metric-grid,
  .rule-summary {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 780px) {
  .stepwise-guard-page {
    padding: 12px;
  }

  .rule-row {
    grid-template-columns: 1fr;
  }
}
</style>
