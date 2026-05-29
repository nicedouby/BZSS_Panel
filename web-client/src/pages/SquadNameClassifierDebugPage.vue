<template>
  <section class="page squad-classifier-page">
    <PageHeader
      title="小队名称性质分类器调试"
      subtitle="直接调用后端分类接口，查看输入、标准化结果、命中规则、可信度和完整调试信息。"
    >
      <template #actions>
        <button type="button" class="action-btn" @click="fillFromPreset('步兵一队')">步兵示例</button>
        <button type="button" class="action-btn" @click="fillFromPreset('步兵战车')">载具示例</button>
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
            <p class="card-subtitle">输入一个队名，提交给后端分类器。</p>
          </div>
        </template>

        <div class="stack">
          <label class="field">
            <span>队名输入</span>
            <input
              v-model="form.name"
              type="text"
              placeholder="例如：步兵一队 / BTR / 后勤车"
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
            返回字段包括：`nature`、`label`、`confidence`、`normalizedName`、`vehicleClass`、`matchedRule`、`matchedValue`、`reason`、`debug`。
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
            <span>类型</span>
            <StatusBadge :tone="toneForConfidence(currentResult.vehicleClassConfidence)">{{ currentResult.vehicleClassLabel || "--" }}</StatusBadge>
          </div>
          <div class="summary-item">
            <span>类型英文</span>
            <strong class="mono">{{ currentResult.vehicleClass || "--" }}</strong>
          </div>
          <div class="summary-item wide">
            <span>类型原因</span>
            <strong>{{ currentResult.vehicleClassReason || "--" }}</strong>
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
        </div>
        <div v-else class="empty-note">
          还没有执行分类。先输入一个队名并点击“执行分类”。
        </div>
      </PageCard>
    </section>

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
                <th>类型</th>
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
import { computed, ref } from "vue";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import DataState from "../components/common/DataState.vue";
import StatusBadge from "../components/common/StatusBadge.vue";
import { apiGet, apiPost, ApiError } from "../app/apiClient";
import { useUiStore } from "../stores/ui.store";

type SquadClassifierResponse = {
  ok?: boolean;
  nature: "infantry" | "vehicle" | "support" | "other";
  label: string;
  confidence: "high" | "medium" | "low";
  normalizedName: string;
  matchedRule: string | null;
  matchedValue: string | null;
  reason: string;
  vehicleClass: "ifv" | "light_vehicle" | "tank" | "other";
  vehicleClassLabel: string;
  vehicleClassRule: string | null;
  vehicleClassValue: string | null;
  vehicleClassReason: string | null;
  vehicleClassConfidence: "high" | "medium" | "low";
  debug?: Record<string, unknown>;
};

type ResultRow = SquadClassifierResponse & {
  id: string;
  input: string;
  normalizedInput: string;
  payload: Record<string, unknown>;
};

const ui = useUiStore();
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const currentResult = ref<SquadClassifierResponse | null>(null);
const results = ref<ResultRow[]>([]);
const selectedResult = ref<ResultRow | null>(null);

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
    "机械化步兵（bmp2）",
    "bmp2",
    "BTR",
    "matv",
    "99a",
    "SPG 1",
    "后勤车",
    "迫击炮",
    "hello",
  ],
  conflict: [
    "步兵战车",
    "机械化步兵（bmp2）",
    "bmp2",
    "matv",
    "99a",
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

.inline-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
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
.field select {
  width: 100%;
  border-radius: 8px;
  border: 1px solid #2c343d;
  background: #12171d;
  color: #e7eef3;
  padding: 10px 12px;
  outline: none;
}

.field input:focus,
.field select:focus {
  border-color: #4f6979;
}

.button-row,
.sample-list {
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
.batch-card,
.result-card,
.json-card {
  min-width: 0;
}

.summary-card {
  min-height: 100%;
}

@media (max-width: 1100px) {
  .hero-grid {
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
