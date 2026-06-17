<template>
  <section class="page squad-name-policy-page">
    <PageHeader
      title="队名规范"
      subtitle="独立测试载具队命名规则。这里不会解散小队、不会发送警告、不会调用 RCON。"
    >
      <template #actions>
        <button type="button" class="action-btn" :disabled="loading" @click="loadState">
          {{ loading ? "刷新中.." : "刷新规则" }}
        </button>
        <button
          v-if="canSave"
          type="button"
          class="action-btn primary"
          :disabled="saving || !dirty"
          @click="saveState"
        >
          {{ saving ? "保存中.." : "保存 JSON" }}
        </button>
      </template>
    </PageHeader>

    <div v-if="error" class="banner error">{{ error }}</div>

    <section class="top-grid">
      <PageCard compact title="输入测试" description="输入玩家创建的小队名，返回是否规范以及可能想建立的载具队。">
        <div class="test-form">
          <label class="field">
            <span>小队名</span>
            <input v-model.trim="testName" type="text" placeholder="BMP队 / BMP1 / BPM2" @keyup.enter="runTest" />
          </label>
          <button type="button" class="action-btn primary" :disabled="testing || !testName" @click="runTest">
            {{ testing ? "测试中.." : "测试队名" }}
          </button>
        </div>

        <div v-if="testResult" class="result-panel" :data-valid="testResult.valid">
          <div class="result-head">
            <strong>{{ testResult.valid ? "规范队名" : "违规队名" }}</strong>
            <span>{{ testResult.reason }}</span>
          </div>
          <dl class="result-grid">
            <div>
              <dt>标准化</dt>
              <dd>{{ testResult.normalizedInput || "-" }}</dd>
            </div>
            <div>
              <dt>建议用名</dt>
              <dd>{{ testResult.normalizedStrippedInput || "-" }}</dd>
            </div>
            <div>
              <dt>后缀处理</dt>
              <dd>{{ testResult.suffixStripped ? "已剥离用于建议" : "未剥离" }}</dd>
            </div>
          </dl>

          <div v-if="testResult.matched" class="matched-card">
            <span>命中</span>
            <strong>{{ testResult.matched.name }}</strong>
            <em>{{ testResult.matched.faction || "-" }} / {{ testResult.matched.vehicleType || "-" }} / {{ testResult.matched.matchedKind }}</em>
          </div>

          <div v-if="testResult.warningMessage" class="warning-message">
            {{ testResult.warningMessage }}
          </div>

          <div v-if="testResult.suggestions.length" class="suggestion-list">
            <article v-for="item in testResult.suggestions" :key="`${item.source}:${item.id}`" class="suggestion-card">
              <span>{{ item.source === "keyword" ? "关键字" : "算法" }}</span>
              <strong>{{ item.name }}</strong>
              <em>{{ item.faction || "-" }} / {{ item.vehicleType || "-" }} / {{ formatScore(item.score) }}</em>
            </article>
          </div>
        </div>
      </PageCard>

      <PageCard compact title="规则统计" description="当前 JSON 中的载具队规范规模。">
        <div class="stats-grid">
          <article>
            <span>载具记录</span>
            <strong>{{ state?.stats.entries ?? 0 }}</strong>
          </article>
          <article>
            <span>别名</span>
            <strong>{{ state?.stats.aliases ?? 0 }}</strong>
          </article>
          <article>
            <span>关键字单元</span>
            <strong>{{ state?.stats.keywordCells ?? 0 }}</strong>
          </article>
          <article>
            <span>唯一关键字</span>
            <strong>{{ state?.stats.uniqueKeywords ?? 0 }}</strong>
          </article>
        </div>

        <div class="meta-list">
          <span>来源：{{ state?.source.fileName || "-" }}</span>
          <span>导入：{{ formatTime(state?.importedAt) }}</span>
          <span>更新：{{ formatTime(state?.updatedAt) }}</span>
        </div>

        <label class="field">
          <span>建议数量上限</span>
          <input v-model.number="draft.suggestionLimit" type="number" min="1" max="50" step="1" :disabled="!canSave" @input="markDirty" />
        </label>

        <div class="allow-list-grid">
          <label class="field">
            <span>默认队名正则</span>
            <textarea v-model="draft.defaultNamePatternsText" :disabled="!canSave" @input="markDirty" />
          </label>
          <label class="field">
            <span>步兵队白名单</span>
            <textarea v-model="draft.infantryNamesText" :disabled="!canSave" @input="markDirty" />
          </label>
          <label class="field">
            <span>特种步兵队白名单</span>
            <textarea v-model="draft.specialInfantryNamesText" :disabled="!canSave" @input="markDirty" />
          </label>
        </div>
      </PageCard>
    </section>

    <PageCard compact body-mode="scroll" class="rules-card">
      <template #header>
        <div>
          <h2 class="card-headline">规则维护</h2>
          <p class="card-subtitle">可维护标准名、别名和关键字。普通用户只能查看和测试。</p>
        </div>
      </template>

      <div class="table-toolbar">
        <input v-model.trim="filterText" type="text" placeholder="搜索载具名 / 别名 / 关键字 / 阵营" />
        <button v-if="canSave" type="button" class="action-btn" @click="addEntry">新增载具</button>
        <button
          v-if="filteredEntryCount > visibleEntries.length"
          type="button"
          class="action-btn"
          @click="showMoreEntries"
        >
          显示更多 {{ visibleEntries.length }}/{{ filteredEntryCount }}
        </button>
        <span v-else class="toolbar-note">显示 {{ visibleEntries.length }}/{{ filteredEntryCount }}</span>
      </div>

      <div class="table-wrap">
        <table class="rules-table">
          <thead>
            <tr>
              <th>阵营</th>
              <th>类型</th>
              <th>标准队名</th>
              <th>别名</th>
              <th>关键字</th>
              <th>资产</th>
              <th v-if="canSave">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in visibleEntries" :key="entry.id">
              <td><input v-model="entry.faction" :disabled="!canSave" @input="markDirty" /></td>
              <td><input v-model="entry.vehicleType" :disabled="!canSave" @input="markDirty" /></td>
              <td><input v-model="entry.name" :disabled="!canSave" @input="markDirty" /></td>
              <td><textarea v-model="entry.aliasText" :disabled="!canSave" @input="markDirty" /></td>
              <td><textarea v-model="entry.keywordText" :disabled="!canSave" @input="markDirty" /></td>
              <td><input v-model="entry.asset" :disabled="!canSave" @input="markDirty" /></td>
              <td v-if="canSave">
                <button type="button" class="danger-btn" @click="removeEntry(entry.id)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </PageCard>

    <PageCard compact title="JSON 编辑" description="高级维护入口。保存前会按模块规则重新规范化。">
      <template #actions>
        <button type="button" class="action-btn" @click="toggleJsonEditor">
          {{ showJsonEditor ? "收起 JSON" : "展开 JSON" }}
        </button>
        <button v-if="showJsonEditor && canSave" type="button" class="action-btn" @click="syncJsonText">
          刷新 JSON
        </button>
      </template>
      <textarea
        v-if="showJsonEditor"
        v-model="jsonText"
        class="json-editor"
        :disabled="!canSave"
        @input="onJsonEdited"
      />
      <div v-else class="json-placeholder">
        JSON 内容较大，默认不渲染以保持测试输入流畅；需要直接维护原始 JSON 时再展开。
      </div>
    </PageCard>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";

import { apiGet, apiPost, ApiError } from "../app/apiClient";
import PageCard from "../components/common/PageCard.vue";
import PageHeader from "../components/common/PageHeader.vue";
import { useAuthStore } from "../stores/auth.store";
import { useUiStore } from "../stores/ui.store";

type PolicyEntry = {
  id: string;
  faction: string;
  vehicleType: string;
  asset: string;
  name: string;
  aliases: string[];
  keywords: string[];
  searchTokens?: string[];
};

type EditableEntry = PolicyEntry & {
  aliasText: string;
  keywordText: string;
};

type PolicyState = {
  ok: boolean;
  policyPath: string;
  version: number;
  source: { type: string; fileName: string; path: string; sheetName: string };
  importedAt: string | null;
  updatedAt: string | null;
  suggestionLimit: number;
  defaultNamePatterns: string[];
  infantryNames: string[];
  specialInfantryNames: string[];
  stats: {
    entries: number;
    infantryNames: number;
    specialInfantryNames: number;
    defaultNamePatterns: number;
    aliases: number;
    keywordCells: number;
    uniqueKeywords: number;
    factions: number;
    vehicleTypes: number;
  };
  entries: PolicyEntry[];
};

type PolicySuggestion = PolicyEntry & {
  source: "keyword" | "algorithm";
  score: number | null;
  reason: string;
  matchedValue: string | null;
  matchedKind: string | null;
};

type PolicyTestResult = {
  ok: boolean;
  input: string;
  normalizedInput: string;
  normalizedStrippedInput: string;
  suffixStripped: boolean;
  valid: boolean;
  reason: string;
  matched: (PolicyEntry & { matchedKind: string; matchedValue: string }) | null;
  suggestions: PolicySuggestion[];
  keywordSuggestions: PolicySuggestion[];
  algorithmSuggestions: PolicySuggestion[];
  warningMessage: string;
};

const auth = useAuthStore();
const ui = useUiStore();
const canSave = computed(() => Boolean(auth.user?.isSuperAdmin));

const loading = ref(false);
const saving = ref(false);
const testing = ref(false);
const error = ref("");
const dirty = ref(false);
const state = ref<PolicyState | null>(null);
const entries = ref<EditableEntry[]>([]);
const jsonText = ref("");
const showJsonEditor = ref(false);
const filterText = ref("");
const testName = ref("BMP队");
const testResult = ref<PolicyTestResult | null>(null);
const entryRenderLimit = ref(80);
const draft = reactive({
  suggestionLimit: 5,
  defaultNamePatternsText: "",
  infantryNamesText: "",
  specialInfantryNamesText: "",
});

const matchingEntries = computed(() => {
  const keyword = filterText.value.toLowerCase();
  const source = entries.value;
  if (!keyword) return source;
  return source.filter((entry) => [
    entry.faction,
    entry.vehicleType,
    entry.name,
    entry.aliasText,
    entry.keywordText,
    entry.asset,
  ].join(" ").toLowerCase().includes(keyword));
});

const filteredEntryCount = computed(() => matchingEntries.value.length);
const visibleEntries = computed(() => matchingEntries.value.slice(0, entryRenderLimit.value));

onMounted(() => {
  void loadState();
});

async function loadState() {
  loading.value = true;
  error.value = "";
  try {
    const payload = await apiGet<PolicyState>("/api/squad-name-policy/state");
    applyState(payload);
  } catch (err) {
    error.value = formatError(err);
  } finally {
    loading.value = false;
  }
}

async function runTest() {
  if (!testName.value) return;
  testing.value = true;
  try {
    testResult.value = await apiPost<PolicyTestResult>("/api/squad-name-policy/test", { name: testName.value });
  } catch (err) {
    ui.pushToast({ title: "测试失败", message: formatError(err), tone: "error" });
  } finally {
    testing.value = false;
  }
}

async function saveState() {
  if (!canSave.value) return;
  saving.value = true;
  try {
    const saved = await apiPost<PolicyState>("/api/squad-name-policy/state", buildSavePayload());
    applyState(saved);
    ui.pushToast({ title: "保存完成", message: "队名规范 JSON 已更新。", tone: "ok" });
  } catch (err) {
    ui.pushToast({ title: "保存失败", message: formatError(err), tone: "error" });
  } finally {
    saving.value = false;
  }
}

function applyState(payload: PolicyState) {
  state.value = payload;
  draft.suggestionLimit = Number(payload.suggestionLimit || 5);
  draft.infantryNamesText = (payload.infantryNames ?? []).join("\n");
  draft.specialInfantryNamesText = (payload.specialInfantryNames ?? []).join("\n");
  draft.defaultNamePatternsText = (payload.defaultNamePatterns ?? []).join("\n");
  entries.value = payload.entries.map(toEditableEntry);
  entryRenderLimit.value = 80;
  jsonText.value = "";
  showJsonEditor.value = false;
  dirty.value = false;
}

function toEditableEntry(entry: PolicyEntry): EditableEntry {
  return {
    ...entry,
    aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
    keywords: Array.isArray(entry.keywords) ? entry.keywords : [],
    aliasText: (entry.aliases ?? []).join("\n"),
    keywordText: (entry.keywords ?? []).join("\n"),
  };
}

function buildSavePayload() {
  const parsed = showJsonEditor.value ? parseJsonText() : null;
  if (parsed) return { ...parsed, suggestionLimit: draft.suggestionLimit };
  return {
    version: state.value?.version ?? 1,
    source: state.value?.source ?? { type: "manual", fileName: "", path: "", sheetName: "" },
    importedAt: state.value?.importedAt ?? null,
    suggestionLimit: draft.suggestionLimit,
    defaultNamePatterns: parseList(draft.defaultNamePatternsText),
    infantryNames: parseList(draft.infantryNamesText),
    specialInfantryNames: parseList(draft.specialInfantryNamesText),
    entries: entries.value.map((entry) => ({
      id: entry.id,
      faction: entry.faction,
      vehicleType: entry.vehicleType,
      asset: entry.asset,
      name: entry.name,
      aliases: parseList(entry.aliasText),
      keywords: parseList(entry.keywordText),
      searchTokens: entry.searchTokens ?? [],
    })),
  };
}

function parseJsonText() {
  try {
    const parsed = JSON.parse(jsonText.value);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.entries)) return parsed;
  } catch {
    return null;
  }
  return null;
}

function syncJsonText() {
  jsonText.value = JSON.stringify({
    version: state.value?.version ?? 1,
    source: state.value?.source ?? { type: "manual", fileName: "", path: "", sheetName: "" },
    importedAt: state.value?.importedAt ?? null,
    updatedAt: state.value?.updatedAt ?? null,
    suggestionLimit: draft.suggestionLimit,
    defaultNamePatterns: parseList(draft.defaultNamePatternsText),
    infantryNames: parseList(draft.infantryNamesText),
    specialInfantryNames: parseList(draft.specialInfantryNamesText),
    entries: entries.value.map((entry) => ({
      id: entry.id,
      faction: entry.faction,
      vehicleType: entry.vehicleType,
      asset: entry.asset,
      name: entry.name,
      aliases: parseList(entry.aliasText),
      keywords: parseList(entry.keywordText),
      searchTokens: entry.searchTokens ?? [],
    })),
  }, null, 2);
}

function addEntry() {
  entries.value.unshift(toEditableEntry({
    id: `manual:${Date.now().toString(36)}`,
    faction: "",
    vehicleType: "",
    asset: "",
    name: "New Vehicle",
    aliases: [],
    keywords: [],
    searchTokens: [],
  }));
  markDirty();
}

function removeEntry(id: string) {
  entries.value = entries.value.filter((entry) => entry.id !== id);
  markDirty();
}

function markDirty() {
  dirty.value = true;
}

function showMoreEntries() {
  entryRenderLimit.value = Math.min(filteredEntryCount.value, entryRenderLimit.value + 80);
}

function toggleJsonEditor() {
  showJsonEditor.value = !showJsonEditor.value;
  if (showJsonEditor.value && !jsonText.value) {
    syncJsonText();
  }
}

function onJsonEdited() {
  dirty.value = true;
}

function parseList(text: string) {
  return Array.from(new Set(String(text ?? "").split(/[\r\n,，]+/).map((item) => item.trim()).filter(Boolean)));
}

function formatScore(value: number | null) {
  if (value == null) return "-";
  return `${Math.round(value * 100)}%`;
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString();
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
  height: 100%;
  min-height: 0;
  overflow: auto;
}

.top-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(300px, 0.7fr);
  gap: 16px;
}

.test-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: end;
}

.field {
  display: grid;
  gap: 8px;
}

.field span,
.result-head span,
.matched-card em,
.suggestion-card em,
.meta-list,
.stats-grid span {
  color: var(--color-text-muted);
  font-size: 12px;
}

input,
textarea {
  width: 100%;
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  background: var(--color-bg-input, rgba(10, 14, 18, 0.72));
  color: var(--color-text-primary);
  padding: 9px 10px;
  font: inherit;
}

textarea {
  min-height: 58px;
  resize: vertical;
}

.action-btn,
.danger-btn {
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  padding: 9px 12px;
  cursor: pointer;
}

.action-btn.primary {
  border-color: color-mix(in srgb, var(--color-status-info) 46%, var(--color-border-default));
  background: color-mix(in srgb, var(--color-status-info) 18%, var(--color-bg-card));
}

.danger-btn {
  border-color: color-mix(in srgb, var(--color-status-error) 44%, var(--color-border-default));
  color: var(--color-status-error);
}

button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.banner.error {
  border: 1px solid color-mix(in srgb, var(--color-status-error) 40%, var(--color-border-default));
  background: color-mix(in srgb, var(--color-status-error) 12%, transparent);
  border-radius: 8px;
  padding: 10px 12px;
}

.result-panel {
  display: grid;
  gap: 12px;
  margin-top: 14px;
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  padding: 12px;
}

.result-panel[data-valid="true"] {
  border-color: color-mix(in srgb, var(--color-status-success, #22c55e) 36%, var(--color-border-default));
}

.result-panel[data-valid="false"] {
  border-color: color-mix(in srgb, var(--color-status-warning) 42%, var(--color-border-default));
}

.result-head,
.matched-card,
.warning-message,
.suggestion-card,
.stats-grid article {
  display: grid;
  gap: 4px;
}

.result-grid,
.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.result-grid div,
.stats-grid article,
.matched-card,
.warning-message,
.suggestion-card {
  border: 1px solid var(--color-border-subtle, var(--color-border-default));
  border-radius: 8px;
  padding: 10px;
}

.result-grid dt {
  color: var(--color-text-muted);
  font-size: 12px;
}

.result-grid dd {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
}

.suggestion-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
}

.meta-list {
  display: grid;
  gap: 6px;
  margin: 14px 0;
}

.allow-list-grid {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.allow-list-grid textarea {
  min-height: 86px;
  font-size: 12px;
  line-height: 1.45;
}

.rules-card {
  min-height: 420px;
}

.table-toolbar {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.table-toolbar input {
  max-width: 420px;
}

.toolbar-note,
.json-placeholder {
  color: var(--color-text-muted);
  font-size: 12px;
}

.table-wrap {
  overflow: auto;
  max-height: 520px;
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
}

.rules-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 1120px;
}

.rules-table th,
.rules-table td {
  border-bottom: 1px solid var(--color-border-subtle, var(--color-border-default));
  padding: 8px;
  vertical-align: top;
}

.rules-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--color-bg-card);
  text-align: left;
  font-size: 12px;
  color: var(--color-text-muted);
}

.json-editor {
  min-height: 280px;
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.45;
}

.json-placeholder {
  border: 1px dashed var(--color-border-default);
  border-radius: 8px;
  padding: 14px;
}

.card-headline {
  margin: 0;
  font-size: 16px;
}

.card-subtitle {
  margin: 6px 0 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

@media (max-width: 900px) {
  .top-grid,
  .test-form,
  .result-grid,
  .stats-grid {
    grid-template-columns: 1fr;
  }
}
</style>
