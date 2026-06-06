<template>
  <section class="page stepwise-page">
    <PageHeader
      eyebrow="Plugin"
      title="阶梯式建队时长"
      subtitle="围绕日志时钟判定步兵队与载具队的建队门槛，并把收到的建队事件、判定结果和实际动作放到同一页里。"
    >
      <template #actions>
        <div class="header-actions">
          <span class="status-pill" :data-tone="statusTone">{{ statusLabel }}</span>
          <button type="button" class="ghost-btn" :disabled="loading" @click="refreshState">
            {{ loading ? "刷新中..." : "刷新" }}
          </button>
          <button type="button" class="ghost-btn" :disabled="saving" @click="saveSettings">
            {{ saving ? "保存中..." : "保存规则" }}
          </button>
          <button type="button" class="ghost-btn" :disabled="toggling" @click="toggleEnabled">
            {{ toggling ? "切换中..." : (state?.enabled ? "停用插件" : "启用插件") }}
          </button>
        </div>
      </template>
    </PageHeader>

    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="info" class="banner info">{{ info }}</div>

    <div class="main-layout">
      <!-- 左列：配置与控制 -->
      <div class="control-col">
        <!-- 运行状态与配置 (Merged overview & settings) -->
        <PageCard
          compact
          class="overview-settings-card"
          title="运行状态与核心开关"
          description="监控插件各项运行指标，配置行为开关和记录上限。"
        >
          <div class="overview-settings-layout">
            <!-- 运行概览 -->
            <div class="overview-section">
              <div class="overview-topline">
                <span class="status-pill" :data-tone="statusTone">{{ statusLabel }}</span>
                <span class="mini-pill">订阅：{{ state?.subscribed ? "已订阅" : "未订阅" }}</span>
                <span class="mini-pill">插件：{{ state?.enabled ? "启用" : "停用" }}</span>
                <span class="mini-pill">日志时钟：{{ currentClockText }}</span>
              </div>

              <dl class="stats-grid">
                <div>
                  <dt>最近记录</dt>
                  <dd>{{ state?.summary?.total ?? 0 }}</dd>
                </div>
                <div>
                  <dt>通过</dt>
                  <dd>{{ state?.summary?.approved ?? 0 }}</dd>
                </div>
                <div>
                  <dt>违规</dt>
                  <dd>{{ state?.summary?.violations ?? 0 }}</dd>
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
                  <dt>待补日志</dt>
                  <dd>{{ state?.pendingLogCount ?? 0 }}</dd>
                </div>
              </dl>

              <div class="summary-grid">
                <article class="summary-card">
                  <span>步兵窗口</span>
                  <strong>{{ formatRuleSummary(draft.rules.infantry) }}</strong>
                </article>
                <article class="summary-card">
                  <span>载具窗口</span>
                  <strong>{{ formatRuleSummary(draft.rules.vehicle) }}</strong>
                </article>
              </div>
            </div>

            <!-- 执行开关 -->
            <div class="settings-section">
              <div class="switch-list">
                <label class="switch-row">
                  <input v-model="draft.broadcastOnApproved" type="checkbox" />
                  <span>
                    <strong>通过时广播</strong>
                    <em>满足当前窗口门槛时向全服广播。</em>
                  </span>
                </label>
                <label class="switch-row">
                  <input v-model="draft.broadcastOnViolation" type="checkbox" />
                  <span>
                    <strong>违规时广播</strong>
                    <em>违规建队被解散时同步广播。</em>
                  </span>
                </label>
                <label class="switch-row">
                  <input v-model="draft.warnOnMissingPlaytime" type="checkbox" />
                  <span>
                    <strong>缺时长也告警</strong>
                    <em>缓存里没有时长时，仍然提示玩家。</em>
                  </span>
                </label>
                <label class="switch-row">
                  <input v-model="draft.liveLookupWhenMissing" type="checkbox" />
                  <span>
                    <strong>后台补查时长</strong>
                    <em>缺时长时触发后台 Steam 时长查询。</em>
                  </span>
                </label>
              </div>

              <label class="inline-field">
                <span>最近记录上限</span>
                <input v-model.number="draft.maxRecentRecords" type="number" min="0" step="1" />
              </label>
            </div>
          </div>
        </PageCard>

        <!-- 规则与模拟 (Tabbed rules & simulation) -->
        <PageCard
          compact
          class="workbench-card"
          title="配置与仿真"
          description="编辑建队时长规则，或使用仿真工具测试特定配置判定。"
        >
          <template #actions>
            <div class="tabs-header">
              <button
                type="button"
                class="tab-btn"
                :class="{ active: workbenchTab === 'rules' }"
                @click="workbenchTab = 'rules'"
              >
                规则编辑
              </button>
              <button
                type="button"
                class="tab-btn"
                :class="{ active: workbenchTab === 'simulate' }"
                @click="workbenchTab = 'simulate'"
              >
                手动模拟
              </button>
            </div>
          </template>

          <div v-if="workbenchTab === 'rules'" class="rules-tab-content">
            <div class="rules-layout">
              <section class="rule-group">
                <div class="rule-group__head">
                  <div>
                    <h3>步兵队</h3>
                    <p>常见命名如 INF、Squad、步兵。通常开局更严格，越往后逐步放开。</p>
                  </div>
                  <button type="button" class="ghost-btn ghost-btn--compact" @click="addRule('infantry')">
                    新增一行
                  </button>
                </div>
                <div class="rule-list">
                  <article v-for="(rule, index) in draft.rules.infantry" :key="`inf-${index}`" class="rule-row">
                    <label>
                      <span>开始秒数</span>
                      <input v-model.number="rule.startSeconds" type="number" min="0" step="1" />
                    </label>
                    <label>
                      <span>结束秒数</span>
                      <input v-model.number="rule.endSeconds" type="number" min="0" step="1" />
                    </label>
                    <label>
                      <span>最小时长（h）</span>
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
                    <p>常见命名如 Armor、Tank、IFV、CAS。通常在步兵开放后再进入载具窗口。</p>
                  </div>
                  <button type="button" class="ghost-btn ghost-btn--compact" @click="addRule('vehicle')">
                    新增一行
                  </button>
                </div>
                <div class="rule-list">
                  <article v-for="(rule, index) in draft.rules.vehicle" :key="`veh-${index}`" class="rule-row">
                    <label>
                      <span>开始秒数</span>
                      <input v-model.number="rule.startSeconds" type="number" min="0" step="1" />
                    </label>
                    <label>
                      <span>结束秒数</span>
                      <input v-model.number="rule.endSeconds" type="number" min="0" step="1" />
                    </label>
                    <label>
                      <span>最小时长（h）</span>
                      <input v-model.number="rule.minHoursExclusive" type="number" min="0" step="1" />
                    </label>
                    <button type="button" class="danger-btn danger-btn--compact" @click="removeRule('vehicle', index)">
                      删除
                    </button>
                  </article>
                </div>
              </section>
            </div>
          </div>

          <div v-else class="simulate-tab-content">
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
                <input v-model.trim="simulateForm.squadName" type="text" placeholder="INF 1 / Armor" />
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
                <span>游戏时长（小时）</span>
                <input v-model.number="simulateForm.playtimeHours" type="number" min="0" step="0.1" />
              </label>
              <label class="field">
                <span>事件来源</span>
                <select v-model="simulateForm.creationSource">
                  <option value="LOG">LOG</option>
                  <option value="RCON_SNAPSHOT">RCON_SNAPSHOT</option>
                </select>
              </label>
              <div class="notice-card">
                <span>判定基准</span>
                <strong>{{ currentClockText }}</strong>
                <em>服务器日志时钟与暖机状态。</em>
              </div>
            </div>

            <div class="action-row" style="margin-top: 12px;">
              <button type="button" class="primary-btn" :disabled="simulating" @click="simulateCreation">
                {{ simulating ? "模拟中..." : "模拟建队" }}
              </button>
              <button type="button" class="ghost-btn" :disabled="simulating" @click="syncDraftFromState">
                恢复当前配置
              </button>
            </div>
          </div>
        </PageCard>
      </div>

      <!-- 右列：数据日志与判定 -->
      <div class="data-col">
        <PageCard
          compact
          class="monitor-card"
          title="实时判定与日志"
          description="监控历史判定决策，并分析收到的底层建队日志事件流。"
        >
          <template #actions>
            <div class="tabs-header">
              <button
                type="button"
                class="tab-btn"
                :class="{ active: dataTab === 'records' }"
                @click="dataTab = 'records'"
              >
                判定结果 ({{ records.length }})
              </button>
              <button
                type="button"
                class="tab-btn"
                :class="{ active: dataTab === 'logs' }"
                @click="dataTab = 'logs'"
              >
                建队日志 ({{ creationLogs.length }})
              </button>
            </div>
          </template>

          <div v-if="dataTab === 'records'" class="records-tab-content">
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
                      <span class="pill" :data-tone="recordDecisionTone(record)">
                        {{ recordDecisionLabel(record) }}
                      </span>
                    </td>
                    <td>{{ record.phaseLabel || record.decision || "-" }}</td>
                    <td>
                      <strong>{{ record.squadName || "未知小队" }}</strong>
                      <span>{{ record.squadNatureLabel || record.squadNature || "-" }}</span>
                    </td>
                    <td>
                      <strong>{{ record.playtime?.hoursText || "未知h" }}</strong>
                      <span>{{ record.playtime?.source || "-" }}</span>
                    </td>
                    <td class="action-cell">
                      <strong>{{ record.decisionReason || "-" }}</strong>
                      <div class="action-list">
                        <span v-for="action in record.actions || []" :key="`${record.id}-${action.type}`" class="action-pill">
                          {{ action.type }}
                        </span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-else class="logs-tab-content">
            <div class="table-wrap">
              <table class="records-table records-table--logs">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>阶段</th>
                    <th>来源</th>
                    <th>玩家 / 小队</th>
                    <th>时长</th>
                    <th>日志时钟</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="!creationLogs.length">
                    <td colspan="7" class="empty-cell">暂无建队日志</td>
                  </tr>
                  <tr v-for="log in creationLogs" :key="log.id">
                    <td>{{ formatTime(log.at) }}</td>
                    <td>
                      <span class="pill" :data-tone="creationLogTone(log)">
                        {{ creationLogStageLabel(log.stage) }}
                      </span>
                    </td>
                    <td>{{ log.source || "-" }}</td>
                    <td>
                      <strong>{{ log.creatorName || log.leaderName || "未知玩家" }}</strong>
                      <span>{{ log.squadName || "未知小队" }} / {{ log.squadNatureLabel || log.squadNature || "-" }}</span>
                    </td>
                    <td>
                      <strong>{{ log.playtimeHoursText || "未知h" }}</strong>
                      <span>{{ log.playtimeSource || "-" }}</span>
                    </td>
                    <td>
                      <strong>{{ log.clockSeconds ?? 0 }}s</strong>
                      <span>{{ log.isWarmup ? "Warmup / 日志时钟" : "Live / 日志时钟" }}</span>
                    </td>
                    <td>
                      <strong>{{ log.message || "-" }}</strong>
                      <span v-if="log.decisionReason">{{ log.decisionReason }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </PageCard>
      </div>
    </div>
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

interface StepwiseCreationLog {
  id: string;
  at: string;
  stage: string;
  source: string;
  message: string;
  creatorName: string;
  leaderName?: string;
  squadName: string;
  squadNature: string;
  squadNatureLabel: string;
  playtimeHoursText?: string;
  playtimeSource?: string;
  clockSeconds: number;
  isWarmup: boolean;
  decisionReason?: string;
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
  decisionReason?: string;
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
  recentLogs: StepwiseCreationLog[];
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
const workbenchTab = ref<"rules" | "simulate">("rules");
const dataTab = ref<"records" | "logs">("records");
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

const creationLogs = computed(() => {
  return [...(state.value?.recentLogs ?? [])].sort((left, right) => {
    return String(right.at).localeCompare(String(left.at));
  });
});

const statusTone = computed(() => {
  if (!state.value) return "info";
  if (!state.value.subscribed) return "warning";
  if (!state.value.enabled) return "danger";
  if (state.value.active) return "ok";
  return "info";
});

const statusLabel = computed(() => {
  if (!state.value) return "加载中";
  if (!state.value.subscribed) return "未订阅";
  if (!state.value.enabled) return "已停用";
  if (state.value.active) return "运行中";
  return "就绪";
});

const currentClockText = computed(() => {
  const latestLog = creationLogs.value[0];
  if (!latestLog) return "暂无日志时钟";
  return `${latestLog.clockSeconds ?? 0}s / ${latestLog.isWarmup ? "Warmup" : "Live"}`;
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
  draft.maxRecentRecords = Number(settings.maxRecentRecords ?? 300) || 300;
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
    info.value = "规则已保存。";
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
      ? `模拟完成：${result.approved ? "通过" : "违规"} / ${result.actions?.map((action) => action.type).join(" / ") || "无动作"}`
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

function creationLogStageLabel(stage: string) {
  switch (stage) {
    case "received":
      return "收到日志";
    case "observed":
      return "RCON 看到";
    case "evaluated":
      return "已判定";
    case "dropped":
      return "已丢弃";
    default:
      return stage || "-";
  }
}

function creationLogTone(log: StepwiseCreationLog) {
  if (log.stage === "dropped") return "danger";
  if (log.stage === "evaluated") return log.decisionReason ? "ok" : "info";
  return "info";
}

function recordDecisionLabel(record: StepwiseRecord) {
  if (record.decision === "warmup_skipped") return "Warmup 跳过";
  if (record.approved) return "通过";
  if (record.decision === "missing_playtime") return "缺时长";
  return "违规";
}

function recordDecisionTone(record: StepwiseRecord) {
  if (record.decision === "warmup_skipped") return "info";
  if (record.approved) return "ok";
  return "danger";
}
</script>

<style scoped>
.stepwise-page {
  --panel-bg: linear-gradient(180deg, rgba(8, 15, 28, 0.86), rgba(10, 22, 34, 0.92));
  --panel-border: rgba(148, 163, 184, 0.16);
  --panel-soft: rgba(15, 23, 42, 0.42);
  --accent-cyan: #67e8f9;
  --accent-lime: #bef264;
  --accent-salmon: #fca5a5;
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  overflow: hidden;
}

.stepwise-page::before,
.stepwise-page::after {
  content: "";
  position: absolute;
  border-radius: 999px;
  pointer-events: none;
  filter: blur(14px);
}

.stepwise-page::before {
  inset: -80px auto auto -80px;
  width: 240px;
  height: 240px;
  background: radial-gradient(circle, rgba(103, 232, 249, 0.16), transparent 70%);
}

.stepwise-page::after {
  inset: auto -120px -120px auto;
  width: 280px;
  height: 280px;
  background: radial-gradient(circle, rgba(190, 242, 100, 0.12), transparent 70%);
}

.stepwise-page > * {
  position: relative;
  z-index: 1;
}

.header-actions,
.overview-topline,
.action-row,
.action-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.banner {
  border-radius: 16px;
  padding: 10px 12px;
  border: 1px solid transparent;
  font-size: 13px;
  flex-shrink: 0;
}

.banner.error {
  border-color: rgba(239, 68, 68, 0.24);
  background: rgba(127, 29, 29, 0.28);
  color: #fecaca;
}

.banner.info {
  border-color: rgba(59, 130, 246, 0.24);
  background: rgba(30, 64, 175, 0.2);
  color: #dbeafe;
}

.main-layout {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(360px, 1fr) minmax(480px, 1.35fr);
  gap: 12px;
  min-height: 0;
  overflow: hidden;
}

.control-col,
.data-col {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  height: 100%;
  min-height: 0;
}

.overview-settings-card,
.workbench-card,
.monitor-card {
  min-width: 0;
}

.overview-settings-card :deep(.card-body) {
  display: grid;
  gap: 12px;
}

.workbench-card,
.monitor-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.workbench-card :deep(.card-body),
.monitor-card :deep(.card-body) {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.overview-settings-layout {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 16px;
}

.overview-section,
.settings-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.tabs-header {
  display: flex;
  background: rgba(255, 255, 255, 0.04);
  padding: 3px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.tab-btn {
  background: transparent;
  border: 0;
  color: var(--color-text-muted);
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s ease;
}

.tab-btn:hover {
  color: var(--color-text-primary);
}

.tab-btn.active {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.rules-tab-content,
.records-tab-content,
.logs-tab-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.simulate-tab-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.status-pill,
.mini-pill,
.pill,
.action-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(255, 255, 255, 0.04);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.status-pill[data-tone="ok"],
.pill[data-tone="ok"] {
  border-color: rgba(52, 211, 153, 0.28);
  background: rgba(20, 83, 45, 0.35);
  color: #d1fae5;
}

.status-pill[data-tone="warning"] {
  border-color: rgba(251, 191, 36, 0.26);
  background: rgba(120, 53, 15, 0.28);
  color: #fde68a;
}

.status-pill[data-tone="danger"],
.pill[data-tone="danger"] {
  border-color: rgba(248, 113, 113, 0.28);
  background: rgba(127, 29, 29, 0.28);
  color: #fecaca;
}

.status-pill[data-tone="info"],
.pill[data-tone="info"] {
  border-color: rgba(96, 165, 250, 0.26);
  background: rgba(30, 58, 138, 0.25);
  color: #dbeafe;
}

.mini-pill {
  color: var(--color-text-muted);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.stats-grid > div,
.summary-card,
.notice-card,
.switch-row,
.rule-row {
  border: 1px solid var(--panel-border);
  border-radius: 12px;
  background: var(--panel-bg);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}

.stats-grid > div {
  padding: 8px 10px;
}

.stats-grid dt,
.summary-card span,
.field span,
.inline-field span,
.notice-card span,
.records-table th {
  color: var(--color-text-muted);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.stats-grid dd,
.summary-card strong,
.notice-card strong {
  margin: 4px 0 0;
  color: var(--color-text-primary);
  font-size: 15px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.summary-card {
  padding: 8px 10px;
}

.summary-card strong {
  display: block;
  font-size: 13px;
  line-height: 1.45;
}

.switch-list {
  display: grid;
  gap: 8px;
}

.switch-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  padding: 8px 10px;
}

.switch-row input {
  margin-top: 3px;
}

.switch-row strong {
  display: block;
  color: var(--color-text-primary);
  font-size: 13px;
}

.switch-row em,
.notice-card em,
.rule-group__head p,
.records-table td span {
  display: block;
  margin-top: 2px;
  color: var(--color-text-muted);
  font-size: 11px;
  line-height: 1.45;
  font-style: normal;
}

.inline-field,
.field {
  display: grid;
  gap: 4px;
}

.inline-field input,
.field input,
.field select,
.rule-row input {
  width: 100%;
  min-height: 32px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
  padding: 6px 10px;
  font-size: 13px;
  outline: none;
}

.inline-field input:focus,
.field input:focus,
.field select:focus,
.rule-row input:focus {
  border-color: rgba(103, 232, 249, 0.42);
  box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.12);
}

.simulate-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.notice-card {
  display: grid;
  gap: 4px;
  padding: 8px 10px;
  grid-column: span 2;
}

.primary-btn,
.ghost-btn,
.danger-btn {
  min-height: 32px;
  border-radius: 8px;
  padding: 0 10px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  cursor: pointer;
  font-weight: 700;
  font-size: 13px;
  transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease, opacity 0.15s ease;
}

.primary-btn {
  border-color: rgba(103, 232, 249, 0.3);
  background: linear-gradient(135deg, rgba(8, 145, 178, 0.34), rgba(14, 116, 144, 0.2));
  color: #ecfeff;
}

.ghost-btn {
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
}

.danger-btn {
  border-color: rgba(248, 113, 113, 0.26);
  background: rgba(127, 29, 29, 0.24);
  color: var(--accent-salmon);
}

.ghost-btn--compact,
.danger-btn--compact {
  min-height: 28px;
  border-radius: 6px;
}

.primary-btn:hover:not(:disabled),
.ghost-btn:hover:not(:disabled),
.danger-btn:hover:not(:disabled) {
  transform: translateY(-1px);
}

.primary-btn:disabled,
.ghost-btn:disabled,
.danger-btn:disabled {
  opacity: 0.62;
  cursor: not-allowed;
}

.rules-layout {
  display: grid;
  grid-template-rows: 1fr 1fr;
  gap: 12px;
  flex: 1;
  min-height: 0;
}

.rule-group {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.rule-group__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.rule-group__head h3 {
  margin: 0;
  font-size: 16px;
}

.rule-list {
  flex: 1;
  overflow-y: auto;
  display: grid;
  gap: 8px;
  padding-right: 4px;
  scrollbar-width: thin;
  scrollbar-gutter: stable;
}

.rule-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
  gap: 8px;
  align-items: end;
  padding: 8px 10px;
  border-radius: 12px;
}

.rule-row label {
  display: grid;
  gap: 4px;
}

.table-wrap {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  border-radius: 10px;
  border: 1px solid var(--panel-border);
  background: rgba(3, 7, 18, 0.28);
}

.records-table {
  width: 100%;
  min-width: 960px;
  border-collapse: collapse;
}

.records-table--logs {
  min-width: 1100px;
}

.records-table th,
.records-table td {
  padding: 8px 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  text-align: left;
  vertical-align: top;
  font-size: 13px;
}

.records-table th {
  position: sticky;
  top: 0;
  background: #09111e;
  z-index: 1;
  border-bottom: 2px solid rgba(148, 163, 184, 0.22);
}

.records-table td strong {
  display: block;
  color: var(--color-text-primary);
}

.action-cell {
  min-width: 260px;
}

.action-pill {
  min-height: 24px;
  padding: 0 8px;
  color: var(--accent-cyan);
}

.empty-cell {
  text-align: center;
  color: var(--color-text-muted);
  padding: 20px 12px;
}

@media (max-width: 1180px) {
  .stepwise-page {
    height: auto;
    overflow: visible;
  }

  .main-layout {
    grid-template-columns: 1fr;
    height: auto;
    overflow: visible;
  }

  .control-col,
  .data-col {
    height: auto;
    overflow: visible;
  }

  .workbench-card,
  .monitor-card {
    height: auto;
    flex: none;
  }

  .rules-layout {
    grid-template-rows: auto auto;
    height: auto;
  }

  .rule-group {
    height: auto;
  }

  .rule-list {
    max-height: 300px;
    flex: none;
  }

  .table-wrap {
    max-height: 400px;
    flex: none;
  }

  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .overview-settings-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .stepwise-page {
    padding: 14px;
  }

  .simulate-grid,
  .summary-grid {
    grid-template-columns: 1fr;
  }

  .stats-grid {
    grid-template-columns: 1fr 1fr;
  }

  .rule-row {
    grid-template-columns: 1fr;
  }

  .header-actions {
    width: 100%;
  }

  .header-actions > * {
    flex: 1 1 auto;
  }

  .notice-card {
    grid-column: auto;
  }
}
</style>
