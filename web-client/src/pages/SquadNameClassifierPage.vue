<template>
  <section class="page squad-name-classifier-page">
    <PageHeader
      title="队名判定"
      subtitle="输入小队名称，查看系统会把它归类为步兵队、载具队、支援队或其他。"
      eyebrow="Debug Tool"
    >
      <template #actions>
        <button type="button" class="ghost-btn" @click="fillSample('步兵队')">步兵队</button>
        <button type="button" class="ghost-btn" @click="fillSample('载具队')">载具队</button>
        <button type="button" class="ghost-btn" @click="fillSample('支援队')">支援队</button>
        <button type="button" class="ghost-btn" @click="fillSample('Squad 3')">默认队名</button>
      </template>
    </PageHeader>

    <section class="hero-grid">
      <PageCard class="query-card" compact>
        <form class="query-form" @submit.prevent="classify">
          <label class="field-label" for="squad-name-input">队名</label>
          <div class="input-row">
            <input
              id="squad-name-input"
              v-model="name"
              type="text"
              autocomplete="off"
              spellcheck="false"
              placeholder="例如：步兵队 / 载具队 / 支援队 / Squad 3"
              :disabled="loading"
            >
            <button type="submit" class="primary-btn" :disabled="loading || !name.trim()">
              {{ loading ? "判定中..." : "开始判定" }}
            </button>
          </div>
          <p class="field-hint">支持 GET/POST 调试接口，页面会显示完整判定结果和命中的规则。</p>
        </form>
      </PageCard>

      <PageCard class="result-card" compact>
        <template #header>
          <div class="result-head">
            <div>
              <h2 class="card-title">判定结果</h2>
              <p class="card-description">{{ result ? `输入：${result.rawName || "空"}` : "等待输入队名" }}</p>
            </div>
            <span class="category-pill" :data-category="result?.category || 'other'">
              {{ result?.label || "未判定" }}
            </span>
          </div>
        </template>

        <div v-if="error" class="error-banner">
          {{ error }}
        </div>

        <div v-if="result" class="result-grid">
          <div class="metric">
            <span>归类</span>
            <strong>{{ result.label }}</strong>
          </div>
          <div class="metric">
            <span>规则</span>
            <strong>{{ result.matchedRule || "--" }}</strong>
          </div>
          <div class="metric">
            <span>命中值</span>
            <strong>{{ result.matchedValue || "--" }}</strong>
          </div>
          <div class="metric">
            <span>标准化</span>
            <strong>{{ result.normalizedName || "--" }}</strong>
          </div>
        </div>

        <pre v-if="result" class="json-block">{{ prettyResult }}</pre>
        <div v-else class="empty-hint">还没有判定结果。输入队名后点击“开始判定”。</div>
      </PageCard>
    </section>

    <PageCard title="规则提示" description="当前调试页展示的是后端分类器的默认规则。你可以直接看到它是如何命中的。">
      <div class="rule-grid">
        <article class="rule-card infantry">
          <strong>步兵队</strong>
          <p>默认队名、步兵白名单、或包含“步兵”“空突”等关键字。</p>
        </article>
        <article class="rule-card vehicle">
          <strong>载具队</strong>
          <p>载具白名单、或包含“载具”“装甲”“坦克”“战车”等关键字。</p>
        </article>
        <article class="rule-card support">
          <strong>支援队</strong>
          <p>支援白名单、或包含“支援”“后勤”“维修”“医疗”等关键字。</p>
        </article>
        <article class="rule-card other">
          <strong>其他</strong>
          <p>未命中规则，或先命中黑名单。</p>
        </article>
      </div>
    </PageCard>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { apiPost } from "../app/apiClient";
import { useUiStore } from "../stores/ui.store";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";

interface SquadNameClassifierResult {
  rawName: string;
  normalizedName: string;
  category: "infantry" | "vehicle" | "support" | "other";
  label: string;
  matchedRule: string;
  matchedValue: string;
  reason: string;
}

const ui = useUiStore();
const name = ref("步兵队");
const loading = ref(false);
const result = ref<SquadNameClassifierResult | null>(null);
const error = ref("");

const prettyResult = computed(() => JSON.stringify(result.value, null, 2));

async function classify() {
  error.value = "";
  loading.value = true;
  try {
    const response = await apiPost<SquadNameClassifierResult & { ok: boolean }>("/api/squad-name/classify", {
      name: name.value,
    });
    result.value = {
      rawName: response.rawName,
      normalizedName: response.normalizedName,
      category: response.category,
      label: response.label,
      matchedRule: response.matchedRule,
      matchedValue: response.matchedValue,
      reason: response.reason,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error.value = message;
    ui.pushToast({ title: "判定失败", message, tone: "error" });
  } finally {
    loading.value = false;
  }
}

function fillSample(sample: string) {
  name.value = sample;
  void classify();
}
</script>

<style scoped>
.squad-name-classifier-page {
  display: grid;
  gap: 18px;
  padding: 18px;
  background:
    radial-gradient(circle at top left, rgba(55, 200, 255, 0.08), transparent 28%),
    radial-gradient(circle at top right, rgba(255, 155, 69, 0.08), transparent 32%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 26%),
    transparent;
}

.hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1.2fr);
  gap: 16px;
}

.query-card,
.result-card {
  min-height: 100%;
}

.query-form {
  display: grid;
  gap: 12px;
}

.field-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.input-row {
  display: flex;
  gap: 10px;
}

.input-row input {
  flex: 1 1 auto;
  min-width: 0;
  border: 1px solid var(--color-border-default);
  border-radius: 10px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  padding: 12px 14px;
  font-size: 14px;
}

.input-row input:focus {
  outline: none;
  border-color: var(--color-border-highlight);
}

.primary-btn,
.ghost-btn {
  border-radius: 10px;
  border: 1px solid var(--color-border-default);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02));
  color: var(--color-text-primary);
  padding: 12px 14px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease;
}

.primary-btn {
  min-width: 112px;
  background: linear-gradient(180deg, rgba(59, 130, 246, 0.22), rgba(59, 130, 246, 0.12));
  border-color: rgba(59, 130, 246, 0.35);
}

.ghost-btn {
  padding: 8px 12px;
}

.primary-btn:hover,
.ghost-btn:hover {
  transform: translateY(-1px);
  border-color: var(--color-border-highlight);
}

.primary-btn:disabled,
.ghost-btn:disabled,
.input-row input:disabled {
  cursor: not-allowed;
  opacity: 0.72;
  transform: none;
}

.field-hint {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.result-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-title {
  margin: 0;
  font-size: 16px;
}

.card-description {
  margin: 4px 0 0;
}

.category-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.04);
}

.category-pill[data-category="infantry"] {
  color: #37c8ff;
  border-color: rgba(55, 200, 255, 0.3);
  background: rgba(55, 200, 255, 0.12);
}

.category-pill[data-category="vehicle"] {
  color: #ff9b45;
  border-color: rgba(255, 155, 69, 0.3);
  background: rgba(255, 155, 69, 0.12);
}

.category-pill[data-category="support"] {
  color: #fbbf24;
  border-color: rgba(251, 191, 36, 0.3);
  background: rgba(251, 191, 36, 0.12);
}

.category-pill[data-category="other"] {
  color: #cbd5e1;
}

.error-banner {
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.08);
  color: #fecaca;
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.metric {
  display: grid;
  gap: 4px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.03);
}

.metric span {
  color: var(--color-text-muted);
  font-size: 12px;
}

.metric strong {
  font-size: 14px;
  word-break: break-word;
}

.json-block {
  margin: 0;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid var(--color-border-soft);
  background: rgba(8, 12, 18, 0.5);
  color: #dbe7f3;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.empty-hint {
  color: var(--color-text-muted);
  font-size: 13px;
}

.rule-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.rule-card {
  border-radius: 12px;
  border: 1px solid var(--color-border-soft);
  padding: 14px;
  background: rgba(255, 255, 255, 0.03);
  display: grid;
  gap: 8px;
}

.rule-card strong {
  font-size: 14px;
}

.rule-card p {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.rule-card.infantry {
  border-color: rgba(55, 200, 255, 0.18);
}

.rule-card.vehicle {
  border-color: rgba(255, 155, 69, 0.18);
}

.rule-card.support {
  border-color: rgba(251, 191, 36, 0.18);
}

.rule-card.other {
  border-color: rgba(148, 163, 184, 0.18);
}

@media (max-width: 1100px) {
  .hero-grid,
  .rule-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .squad-name-classifier-page {
    padding: 14px;
  }

  .input-row {
    flex-direction: column;
  }

  .primary-btn {
    width: 100%;
  }

  .result-grid {
    grid-template-columns: 1fr;
  }
}
</style>
