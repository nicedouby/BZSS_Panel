<template>
  <section class="page squad-classifier-page">
    <PageHeader
      title="小队名称性质分类器调试"
      subtitle="调试后端分类结果，并维护指定队名的精确性质映射。"
    >
      <template #actions>
        <button type="button" class="action-btn" @click="fillFromPreset('步兵一队')">步兵示例</button>
        <button type="button" class="action-btn" @click="fillFromPreset('BMP2')">载具示例</button>
        <button type="button" class="action-btn" @click="fillFromPreset('后勤车')">支援示例</button>
        <button type="button" class="action-btn primary" :disabled="busy" @click="runCurrent">
          {{ busy ? "分类中..." : "执行分类" }}
        </button>
      </template>
    </PageHeader>

    <section class="hero-grid">
      <PageCard compact class="input-card">
        <template #header>
          <div>
            <h2 class="card-headline">单条测试</h2>
            <p class="card-subtitle">输入一个队名，直接调用后端分类接口。</p>
          </div>
        </template>

        <div class="stack">
          <label class="field">
            <span>队名输入</span>
            <input
              v-model="form.name"
              type="text"
              placeholder="例如：步兵一队 / BMP2 / 后勤车"
              @keyup.enter="runCurrent"
            >
          </label>

          <div class="inline-grid">
            <label class="field">
              <span>请求方式</span>
              <select v-model="form.method">
                <option value="POST">POST</option>
                <option value="GET">GET</option>
              </select>
            </label>

            <label class="field">
              <span>批量样例</span>
              <select v-model="form.sampleSet">
                <option value="basic">基础样例</option>
                <option value="conflict">冲突样例</option>
                <option value="custom">当前输入</option>
              </select>
            </label>
          </div>

          <div class="button-row">
            <button type="button" class="action-btn" @click="runCurrent">测试当前输入</button>
            <button type="button" class="action-btn" @click="runPresetBatch">运行批量样例</button>
            <button type="button" class="action-btn ghost" @click="clearResults">清空结果</button>
          </div>

          <p class="hint">
            返回字段包括：`nature`、`label`、`confidence`、`normalizedName`、`vehicleClass`、
            `matchedRule`、`matchedValue`、`reason`、`debug`。
          </p>
        </div>
      </PageCard>

      <PageCard compact class="summary-card">
        <template #header>
          <div>
            <h2 class="card-headline">当前结果</h2>
            <p class="card-subtitle">最近一次请求的分类输出。</p>
          </div>
        </template>

        <div v-if="currentResult" class="summary-grid">
          <div class="summary-item">
            <span>性质</span>
            <strong>{{ currentResult.label }}</strong>
          </div>
          <div class="summary-item">
            <span>英文枚举</span>
            <strong>{{ currentResult.nature }}</strong>
          </div>
          <div class="summary-item">
            <span>可信度</span>
            <StatusBadge :tone="toneForConfidence(currentResult.confidence)">{{ currentResult.confidence }}</StatusBadge>
          </div>
          <div class="summary-item">
            <span>标准化队名</span>
            <strong class="mono">{{ currentResult.normalizedName || "--" }}</strong>
          </div>
          <div class="summary-item">
            <span>载具子类</span>
            <StatusBadge :tone="toneForConfidence(currentResult.vehicleClassConfidence)">{{ currentResult.vehicleClassLabel || "--" }}</StatusBadge>
          </div>
          <div class="summary-item">
            <span>载具英文</span>
            <strong class="mono">{{ currentResult.vehicleClass || "--" }}</strong>
          </div>
          <div class="summary-item wide">
            <span>命中规则</span>
            <strong class="mono">{{ currentResult.matchedRule || "--" }}</strong>
          </div>
          <div class="summary-item wide">
            <span>命中值</span>
            <strong class="mono">{{ currentResult.matchedValue || "--" }}</strong>
          </div>
          <div class="summary-item wide">
            <span>命中原因</span>
            <strong>{{ currentResult.reason || "--" }}</strong>
          </div>
          <div class="summary-item wide">
            <span>载具原因</span>
            <strong>{{ currentResult.vehicleClassReason || "--" }}</strong>
          </div>
        </div>
        <div v-else class="empty-note">
          还没有执行分类。先输入一个队名并点击“执行分类”。
        </div>
      </PageCard>
    </section>

    <PageCard compact class="rules-editor-card">
      <template #header>
        <div>
          <h2 class="card-headline">指定队名性质</h2>
          <p class="card-subtitle">维护精确匹配白名单，用于把指定队名直接归到固定性质。</p>
        </div>
      </template>

      <div class="stack">
        <div class="button-row">
          <button type="button" class="action-btn" :disabled="exactRulesLoading" @click="loadExactRules">
            {{ exactRulesLoading ? "加载中..." : "重新加载" }}
          </button>
          <button type="button" class="action-btn primary" :disabled="exactRulesSaving || !canEditExactRules" @click="saveExactRules">
            {{ exactRulesSaving ? "保存中..." : "保存指定队名" }}
          </button>
        </div>

        <p class="hint">
          每行一个队名。保存时会自动去重；如果同一个队名同时出现在多个性质里，只保留最后一个性质。
          <span v-if="!canEditExactRules">当前账号只能查看，保存需要超级管理员。</span>
        </p>

        <div class="quick-add-bar">
          <label class="field">
            <span>快速添加队名</span>
            <input v-model.trim="quickAddName" type="text" placeholder="输入队名后选择性质" />
          </label>
          <label class="field">
            <span>队伍性质</span>
            <select v-model="quickAddNature">
              <option v-for="option in quickAddNatureOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
          <button type="button" class="action-btn primary" :disabled="!quickAddName.trim()" @click="appendQuickRule">
            加入规则
          </button>
        </div>

        <div class="rules-grid">
          <label class="field">
            <span>步兵队</span>
            <textarea
              v-model="exactRuleForm.infantryText"
              rows="8"
              :disabled="exactRulesLoading || exactRulesSaving || !canEditExactRules"
            />
          </label>
          <label class="field">
            <span>载具队</span>
            <textarea
              v-model="exactRuleForm.vehicleText"
              rows="8"
              :disabled="exactRulesLoading || exactRulesSaving || !canEditExactRules"
            />
          </label>
          <label class="field">
            <span>支援队</span>
            <textarea
              v-model="exactRuleForm.supportText"
              rows="8"
              :disabled="exactRulesLoading || exactRulesSaving || !canEditExactRules"
            />
          </label>
          <label class="field">
            <span>后勤队</span>
            <textarea
              v-model="exactRuleForm.logisticsText"
              rows="8"
              :disabled="exactRulesLoading || exactRulesSaving || !canEditExactRules"
            />
          </label>
        </div>

        <div class="rules-meta">
          <span>当前指定数：{{ exactRuleEntries.length }}</span>
          <span>最近更新：{{ exactRulesUpdatedAtText }}</span>
        </div>

        <div v-if="exactRuleEntries.length" class="rules-chip-list">
          <button
            v-for="entry in exactRuleEntries"
            :key="`${entry.nature}:${entry.name}`"
            type="button"
            class="sample-pill"
            @click="fillFromPreset(entry.name)"
          >
            {{ entry.label }} · {{ entry.name }}
          </button>
        </div>
      </div>
    </PageCard>

    <PageCard compact class="batch-card">
      <template #header>
        <div>
          <h2 class="card-headline">批量样例</h2>
          <p class="card-subtitle">用于快速回归默认队名、步兵、载具、支援和冲突规则。</p>
        </div>
      </template>

      <div class="sample-list">
        <button
          v-for="sample in activeSamples"
          :key="sample"
          type="button"
          class="sample-pill"
          @click="fillFromPreset(sample)"
        >
          {{ sample }}
        </button>
      </div>
    </PageCard>

    <DataState
      :loading="loading && !results.length"
      :error="error"
      :empty="!loading && !error && !results.length"
      empty-title="暂无分类结果"
      empty-text="运行单条或批量样例后，这里会列出最近请求的所有结果。"
    >
      <PageCard compact class="result-card">
        <template #header>
          <div>
            <h2 class="card-headline">结果列表</h2>
            <p class="card-subtitle">点击行可查看完整 JSON。</p>
          </div>
        </template>

        <div class="table-wrap">
          <table class="result-table">
            <thead>
              <tr>
                <th>输入</th>
                <th>性质</th>
                <th>载具子类</th>
                <th>可信度</th>
                <th>命中规则</th>
                <th>命中值</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in results"
                :key="item.id"
                :class="{ selected: selectedResult?.id === item.id }"
                @click="selectedResult = item"
              >
                <td>
                  <div class="cell-stack">
                    <strong>{{ item.input }}</strong>
                    <span class="mono">{{ item.normalizedInput || "--" }}</span>
                  </div>
                </td>
                <td>{{ item.label }}</td>
                <td><StatusBadge :tone="toneForConfidence(item.vehicleClassConfidence)">{{ item.vehicleClassLabel || "--" }}</StatusBadge></td>
                <td><StatusBadge :tone="toneForConfidence(item.confidence)">{{ item.confidence }}</StatusBadge></td>
                <td class="mono">{{ item.matchedRule || "--" }}</td>
                <td class="mono">{{ item.matchedValue || "--" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </PageCard>
    </DataState>

    <PageCard v-if="selectedResult" compact class="json-card">
      <template #header>
        <div>
          <h2 class="card-headline">完整 JSON</h2>
          <p class="card-subtitle">{{ selectedResult.input }}</p>
        </div>
      </template>

      <pre class="json-block">{{ prettyJson(selectedResult.payload) }}</pre>
    </PageCard>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import DataState from "../components/common/DataState.vue";
import StatusBadge from "../components/common/StatusBadge.vue";
import { apiGet, apiPost, ApiError } from "../app/apiClient";
import { useAuthStore } from "../stores/auth.store";
import { useUiStore } from "../stores/ui.store";

type SquadNature = "infantry" | "vehicle" | "support" | "logistics" | "other";
type SquadRuleNature = Exclude<SquadNature, "other">;

type SquadClassifierResponse = {
  ok?: boolean;
  nature: SquadNature;
  label: string;
  confidence: "high" | "medium" | "low";
  normalizedName: string;
  matchedRule: string | null;
  matchedValue: string | null;
  reason: string;
  vehicleClass: "ifv" | "light_vehicle" | "tank" | "spg" | "other";
  vehicleClassLabel: string;
  subNature?: string;
  subNatureLabel?: string;
  vehicleClassRule: string | null;
  vehicleClassValue: string | null;
  vehicleClassReason: string | null;
  vehicleClassConfidence: "high" | "medium" | "low";
  debug?: Record<string, unknown>;
};

type SquadNameRuleEntry = {
  name: string;
  nature: SquadRuleNature;
  label: string;
};

type SquadNameRulesResponse = {
  ok?: boolean;
  updatedAt: string | null;
  exactRules: Record<SquadRuleNature, string[]>;
  entries: SquadNameRuleEntry[];
};

type ResultRow = SquadClassifierResponse & {
  id: string;
  input: string;
  normalizedInput: string;
  payload: Record<string, unknown>;
};

const auth = useAuthStore();
const ui = useUiStore();

const loading = ref(false);
const busy = ref(false);
const error = ref("");
const currentResult = ref<SquadClassifierResponse | null>(null);
const results = ref<ResultRow[]>([]);
const selectedResult = ref<ResultRow | null>(null);

const exactRulesLoading = ref(false);
const exactRulesSaving = ref(false);
const exactRuleEntries = ref<SquadNameRuleEntry[]>([]);
const exactRulesUpdatedAt = ref<string | null>(null);
const exactRuleForm = reactive({
  infantryText: "",
  vehicleText: "",
  supportText: "",
  logisticsText: "",
});

const quickAddName = ref("");
const quickAddNature = ref<SquadRuleNature>("infantry");
const quickAddNatureOptions: Array<{ value: SquadRuleNature; label: string }> = [
  { value: "infantry", label: "步兵队" },
  { value: "vehicle", label: "载具队" },
  { value: "support", label: "支援队" },
  { value: "logistics", label: "后勤队" },
];

const canEditExactRules = computed(() => Boolean(auth.user?.isSuperAdmin));

const form = ref({
  name: "步兵一队",
  method: "POST" as "GET" | "POST",
  sampleSet: "basic" as "basic" | "conflict" | "custom",
});

const sampleSets: Record<string, string[]> = {
  basic: [
    "Squad 1",
    "步兵一队",
    "步兵战车",
    "机械化步兵(BMP2)",
    "BMP2",
    "BTR",
    "MATV",
    "99A",
    "SPG 1",
    "后勤车",
    "迫击炮",
    "hello",
  ],
  conflict: [
    "步兵战车",
    "机械化步兵(BMP2)",
    "BMP2",
    "MATV",
    "99A",
    "SPG 1",
    "后勤车",
    "logi truck",
    "mortar vehicle",
  ],
};

const activeSamples = computed(() => {
  if (form.value.sampleSet === "custom") {
    return [form.value.name].filter(Boolean);
  }
  return sampleSets[form.value.sampleSet] ?? sampleSets.basic;
});

const exactRulesUpdatedAtText = computed(() => {
  if (!exactRulesUpdatedAt.value) return "--";
  const time = new Date(exactRulesUpdatedAt.value);
  if (Number.isNaN(time.getTime())) return exactRulesUpdatedAt.value;
  return time.toLocaleString();
});

onMounted(() => {
  void loadExactRules();
});

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function toneForConfidence(value?: string) {
  if (value === "high") return "ok";
  if (value === "medium") return "warn";
  if (value === "low") return "error";
  return "idle";
}

function fillFromPreset(name: string) {
  form.value.name = name;
  form.value.sampleSet = "custom";
}

async function runCurrent() {
  const name = form.value.name.trim();
  if (!name) {
    ui.pushToast({ title: "请输入队名", message: "队名不能为空。", tone: "warn" });
    return;
  }

  busy.value = true;
  error.value = "";
  try {
    const payload = await classifyName(name, form.value.method);
    const row = normalizeRow(name, payload);
    currentResult.value = payload;
    results.value = [row, ...results.value].slice(0, 20);
    selectedResult.value = row;
  } catch (err) {
    error.value = formatError(err);
    ui.pushToast({ title: "分类失败", message: error.value, tone: "error" });
  } finally {
    busy.value = false;
  }
}

async function runPresetBatch() {
  const names = activeSamples.value.length ? activeSamples.value : sampleSets.basic;
  loading.value = true;
  error.value = "";
  try {
    const rows: ResultRow[] = [];
    for (const name of names) {
      const payload = await classifyName(name, "POST");
      rows.push(normalizeRow(name, payload));
    }
    results.value = [...rows, ...results.value].slice(0, 30);
    selectedResult.value = rows[0] ?? selectedResult.value;
    currentResult.value = rows[0] ?? currentResult.value;
  } catch (err) {
    error.value = formatError(err);
    ui.pushToast({ title: "批量分类失败", message: error.value, tone: "error" });
  } finally {
    loading.value = false;
  }
}

function clearResults() {
  results.value = [];
  selectedResult.value = null;
  currentResult.value = null;
  error.value = "";
}

async function classifyName(name: string, method: "GET" | "POST") {
  if (method === "GET") {
    return apiGet<SquadClassifierResponse>(`/api/squad-name/classify?name=${encodeURIComponent(name)}`);
  }
  return apiPost<SquadClassifierResponse>("/api/squad-name/classify", { name });
}

async function loadExactRules() {
  exactRulesLoading.value = true;
  try {
    const payload = await apiGet<SquadNameRulesResponse>("/api/squad-name/rules");
    applyExactRules(payload);
  } catch (err) {
    ui.pushToast({
      title: "加载指定队名失败",
      message: formatError(err),
      tone: "error",
    });
  } finally {
    exactRulesLoading.value = false;
  }
}

async function saveExactRules() {
  if (!canEditExactRules.value) {
    ui.pushToast({
      title: "没有权限",
      message: "保存指定队名需要超级管理员权限。",
      tone: "warn",
    });
    return;
  }

  exactRulesSaving.value = true;
  try {
    const payload = await apiPost<SquadNameRulesResponse>("/api/squad-name/rules", {
      exactRules: {
        infantry: parseRuleTextarea(exactRuleForm.infantryText),
        vehicle: parseRuleTextarea(exactRuleForm.vehicleText),
        support: parseRuleTextarea(exactRuleForm.supportText),
        logistics: parseRuleTextarea(exactRuleForm.logisticsText),
      },
    });
    applyExactRules(payload);
    ui.pushToast({
      title: "保存完成",
      message: "指定队名规则已更新。",
      tone: "ok",
    });
  } catch (err) {
    ui.pushToast({
      title: "保存失败",
      message: formatError(err),
      tone: "error",
    });
  } finally {
    exactRulesSaving.value = false;
  }
}

function applyExactRules(payload: SquadNameRulesResponse) {
  exactRuleEntries.value = Array.isArray(payload.entries) ? payload.entries : [];
  exactRulesUpdatedAt.value = payload.updatedAt ?? null;
  exactRuleForm.infantryText = (payload.exactRules?.infantry ?? []).join("\n");
  exactRuleForm.vehicleText = (payload.exactRules?.vehicle ?? []).join("\n");
  exactRuleForm.supportText = (payload.exactRules?.support ?? []).join("\n");
  exactRuleForm.logisticsText = (payload.exactRules?.logistics ?? []).join("\n");
}

function appendQuickRule() {
  const name = quickAddName.value.trim();
  if (!name) return;

  const field = getRuleTextField(quickAddNature.value);
  const current = parseRuleTextarea(exactRuleForm[field]);
  if (!current.some((item) => item.toLowerCase() === name.toLowerCase())) {
    current.push(name);
    exactRuleForm[field] = current.join("\n");
    const label = quickAddNatureOptions.find((item) => item.value === quickAddNature.value)?.label ?? quickAddNature.value;
    exactRuleEntries.value = [...exactRuleEntries.value, { name, nature: quickAddNature.value, label }];
  }
  quickAddName.value = "";
}

function getRuleTextField(nature: SquadRuleNature) {
  if (nature === "vehicle") return "vehicleText";
  if (nature === "support") return "supportText";
  if (nature === "logistics") return "logisticsText";
  return "infantryText";
}

function parseRuleTextarea(text: string) {
  return Array.from(
    new Set(
      String(text ?? "")
        .split(/[\r\n,，]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeRow(input: string, payload: SquadClassifierResponse): ResultRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    input,
    normalizedInput: payload.normalizedName || "",
    ...payload,
    payload: {
      input,
      ...payload,
    },
  };
}

function formatError(err: unknown) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
</script>

<style scoped>
.page {
  display: grid;
  gap: 16px;
  padding: 16px;
}

.hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 16px;
}

.stack {
  display: grid;
  gap: 14px;
}

.quick-add-bar {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(180px, 1fr) auto;
  gap: 12px;
  align-items: end;
}

.inline-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.rules-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.field {
  display: grid;
  gap: 8px;
}

.field span {
  font-size: 12px;
  color: #9aa7b2;
}

.field input,
.field select,
.field textarea {
  width: 100%;
  border-radius: 8px;
  border: 1px solid #2c343d;
  background: #12171d;
  color: #e7eef3;
  padding: 10px 12px;
  outline: none;
}

.field textarea {
  resize: vertical;
  min-height: 140px;
}

.field input:focus,
.field select:focus,
.field textarea:focus {
  border-color: #4f6979;
}

.button-row,
.sample-list,
.rules-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.action-btn,
.sample-pill {
  border: 1px solid #36414b;
  background: #191f25;
  color: #d7e0e5;
  border-radius: 999px;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.action-btn:disabled,
.sample-pill:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.action-btn.primary {
  background: linear-gradient(180deg, #35526a, #2d4559);
  border-color: #4c6a81;
}

.action-btn.ghost {
  background: transparent;
}

.card-headline {
  margin: 0;
  font-size: 16px;
}

.card-subtitle {
  margin: 6px 0 0;
  color: #98a5af;
  font-size: 12px;
}

.hint {
  margin: 0;
  color: #98a5af;
  font-size: 12px;
  line-height: 1.6;
}

.rules-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  color: #98a5af;
  font-size: 12px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.summary-item {
  display: grid;
  gap: 6px;
  padding: 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid #2c343d;
}

.summary-item.wide {
  grid-column: 1 / -1;
}

.summary-item span {
  font-size: 12px;
  color: #98a5af;
}

.summary-item strong {
  font-size: 13px;
  line-height: 1.55;
  word-break: break-word;
}

.empty-note {
  color: #98a5af;
  font-size: 13px;
  line-height: 1.7;
}

.table-wrap {
  overflow-x: auto;
}

.result-table {
  width: 100%;
  border-collapse: collapse;
}

.result-table th,
.result-table td {
  padding: 12px;
  border-bottom: 1px solid #2c343d;
  text-align: left;
  vertical-align: top;
}

.result-table th {
  color: #98a5af;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.result-table tbody tr {
  cursor: pointer;
}

.result-table tbody tr.selected {
  background: rgba(110, 145, 171, 0.09);
}

.cell-stack {
  display: grid;
  gap: 4px;
}

.cell-stack strong {
  font-size: 13px;
}

.cell-stack span,
.mono {
  font-family: Consolas, "Liberation Mono", Menlo, monospace;
}

.json-block {
  margin: 0;
  padding: 14px;
  border-radius: 8px;
  background: #10151a;
  border: 1px solid #2c343d;
  overflow: auto;
  max-height: 360px;
  font-size: 12px;
  line-height: 1.6;
}

.input-card,
.summary-card,
.rules-editor-card,
.batch-card,
.result-card,
.json-card {
  min-width: 0;
}

.summary-card {
  min-height: 100%;
}

@media (max-width: 1100px) {
  .hero-grid,
  .rules-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .inline-grid,
  .summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
