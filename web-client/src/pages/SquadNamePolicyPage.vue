<template>
  <section class="page squad-name-policy-page">
    <PageHeader
      title="队名规范"
      subtitle="独立测试载具队命名规则。这里不会解散小队、不会发送警告、不会调用 RCON。"
    >
      <template #actions>
        <button type="button" class="action-btn" :disabled="loading" @click="loadState">
          {{ loading ? "刷新中.." : "刷新" }}
        </button>
        <router-link to="/debug/squad-name-policy/rules" class="action-btn primary">
          {{ canSave ? "规则维护" : "查看规则" }}
        </router-link>
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
            <div>
              <dt>分类</dt>
              <dd>{{ testResult.classification?.label || "-" }}</dd>
            </div>
          </dl>

          <div v-if="testResult.matched" class="matched-card">
            <span>命中</span>
            <strong>{{ testResult.matched.name }}</strong>
            <em>{{ testResult.matched.faction || "-" }} / {{ testResult.matched.vehicleType || "-" }} / {{ testResult.matched.matchedKind }}</em>
          </div>

          <div v-if="testResult.classification" class="classification-card">
            <span>判定</span>
            <strong>{{ testResult.classification.label }}</strong>
            <em>{{ testResult.classification.reason }}</em>
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
      </PageCard>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

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
  classification?: {
    nature: string;
    label: string;
    reason: string;
  } | null;
};

const auth = useAuthStore();
const ui = useUiStore();
const canSave = computed(() => Boolean(auth.user?.isSuperAdmin));

const loading = ref(false);
const testing = ref(false);
const error = ref("");
const state = ref<PolicyState | null>(null);
const testName = ref("BMP队");
const testResult = ref<PolicyTestResult | null>(null);

onMounted(() => {
  void loadState();
});

async function loadState() {
  loading.value = true;
  error.value = "";
  try {
    state.value = await apiGet<PolicyState>("/api/squad-name-policy/state");
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

input {
  width: 100%;
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  background: var(--color-bg-input, rgba(10, 14, 18, 0.72));
  color: var(--color-text-primary);
  padding: 9px 10px;
  font: inherit;
}

.action-btn {
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  padding: 9px 12px;
  cursor: pointer;
  text-decoration: none;
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.action-btn.primary {
  border-color: color-mix(in srgb, var(--color-status-info) 46%, var(--color-border-default));
  background: color-mix(in srgb, var(--color-status-info) 18%, var(--color-bg-card));
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
.classification-card,
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
.classification-card,
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

@media (max-width: 900px) {
  .top-grid,
  .test-form,
  .result-grid,
  .stats-grid {
    grid-template-columns: 1fr;
  }
}
</style>
