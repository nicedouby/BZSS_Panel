<template>
  <section class="black-edge-page">
    <header class="page-header">
      <div>
        <h1>黑奴跳边 CDK</h1>
        <p>为暖服玩家发放黑奴跳边次数，玩家在聊天输入 CDK 后即可把次数写入玩家资产。</p>
      </div>
      <button type="button" class="page-btn" :disabled="loading" @click="loadState">
        {{ loading ? "刷新中..." : "刷新" }}
      </button>
    </header>

    <div v-if="error" class="page-banner error">{{ error }}</div>
    <div v-else-if="notice" class="page-banner">{{ notice }}</div>

    <section class="summary-grid">
      <article class="summary-card">
        <span>有效批次</span>
        <strong>{{ state?.summary.batchCount ?? 0 }}</strong>
      </article>
      <article class="summary-card">
        <span>剩余 CDK</span>
        <strong>{{ state?.summary.remainingCodeCount ?? 0 }}</strong>
      </article>
      <article class="summary-card">
        <span>成功激活</span>
        <strong>{{ state?.summary.successCount ?? 0 }}</strong>
      </article>
      <article class="summary-card">
        <span>累计发放次数</span>
        <strong>{{ state?.summary.totalGrantedCount ?? 0 }}</strong>
      </article>
    </section>

    <div class="workspace">
      <section class="panel batch-panel">
        <div class="panel-head">
          <div>
            <h2>批次列表</h2>
            <p>点击批次可复制整批 CDK，或查看该批次的激活记录。</p>
          </div>
          <span class="panel-stat">{{ batches.length }}</span>
        </div>

        <div v-if="!batches.length" class="empty-state">暂无有效批次。</div>
        <div v-else class="batch-list">
          <article
            v-for="batch in batches"
            :key="batch.id"
            class="batch-card"
            :class="{ active: selectedBatchId === batch.id }"
            @click="selectedBatchId = batch.id"
          >
            <div class="batch-card__head">
              <div>
                <div class="batch-title-row">
                  <strong>{{ batch.codeType }}</strong>
                  <span class="pill">每码 {{ batch.grantCount }} 次</span>
                </div>
                <p class="mono">{{ batch.id }}</p>
              </div>
              <div class="batch-actions">
                <button type="button" class="mini-btn" @click.stop="copyBatchCodes(batch)">复制 CDK</button>
                <button type="button" class="mini-btn" @click.stop="openBatchRecords(batch)">记录</button>
                <button
                  v-if="canEdit"
                  type="button"
                  class="mini-btn danger"
                  :disabled="actionBatchId === batch.id"
                  @click.stop="deactivateBatch(batch)"
                >
                  {{ actionBatchId === batch.id ? "停用中..." : "停用" }}
                </button>
              </div>
            </div>

            <div class="metric-grid">
              <div class="metric">
                <span>数量</span>
                <strong>{{ batch.quantity }}</strong>
              </div>
              <div class="metric">
                <span>已用</span>
                <strong>{{ batch.usedCount }}</strong>
              </div>
              <div class="metric">
                <span>剩余</span>
                <strong>{{ batch.remainingCount }}</strong>
              </div>
              <div class="metric">
                <span>允许重复</span>
                <strong>{{ batch.allowMultiActivation ? "是" : "否" }}</strong>
              </div>
            </div>

            <div class="code-list">
              <code v-for="code in (batch.codes ?? []).slice(0, expandedBatchId === batch.id ? 999 : 4)" :key="code">{{ code }}</code>
            </div>
            <button
              v-if="(batch.codes?.length ?? 0) > 4"
              type="button"
              class="inline-link"
              @click.stop="expandedBatchId = expandedBatchId === batch.id ? '' : batch.id"
            >
              {{ expandedBatchId === batch.id ? "收起" : `展开全部 ${(batch.codes?.length ?? 0)} 个 CDK` }}
            </button>
          </article>
        </div>
      </section>

      <section class="panel create-panel">
        <div class="panel-head">
          <div>
            <h2>创建批次</h2>
            <p>玩家聊天发送完整 CDK 后，会直接获得对应的黑奴跳边次数。</p>
          </div>
        </div>

        <form class="create-form" @submit.prevent="createBatch">
          <label class="field">
            <span>批次前缀</span>
            <input v-model.trim="form.codeType" class="input" type="text" maxlength="12" placeholder="例如 HN" :disabled="!canEdit || creating">
          </label>

          <label class="field">
            <span>生成数量</span>
            <input v-model.number="form.quantity" class="input" type="number" min="1" max="500" :disabled="!canEdit || creating">
          </label>

          <label class="field">
            <span>每个 CDK 发放次数</span>
            <input v-model.number="form.grantCount" class="input" type="number" min="1" max="999" :disabled="!canEdit || creating">
          </label>

          <label class="checkbox-row">
            <input v-model="form.allowMultiActivation" type="checkbox" :disabled="!canEdit || creating">
            <span>允许同一玩家重复激活同一批次</span>
          </label>

          <button type="submit" class="page-btn primary" :disabled="!canEdit || creating || !canSubmit">
            {{ creating ? "创建中..." : "创建黑奴跳边 CDK 批次" }}
          </button>
        </form>

        <div v-if="createdCodes.length" class="created-panel">
          <div class="panel-head compact">
            <div>
              <h3>最近生成</h3>
              <p>可以直接整批复制给玩家。</p>
            </div>
            <button type="button" class="mini-btn" @click="copyCreatedCodes">复制全部</button>
          </div>
          <div class="code-list tall">
            <code v-for="code in createdCodes" :key="code">{{ code }}</code>
          </div>
        </div>
      </section>
    </div>

    <div v-if="recordsOpen" class="modal-backdrop" @click.self="closeRecords">
      <section class="modal-panel">
        <div class="panel-head">
          <div>
            <h2>激活记录</h2>
            <p>{{ recordsBatch?.codeType || "-" }} / {{ recordsBatch?.id || "-" }}</p>
          </div>
          <button type="button" class="mini-btn" @click="closeRecords">关闭</button>
        </div>

        <div class="filter-row">
          <input v-model.trim="recordFilters.steamId" class="input" type="search" placeholder="按 Steam64 筛选">
          <select v-model="recordFilters.result" class="input select">
            <option value="">全部结果</option>
            <option value="success">成功</option>
            <option value="code_used">已使用</option>
            <option value="duplicate_player_restricted">重复限制</option>
            <option value="batch_deactivated">批次停用</option>
            <option value="code_not_found">无此 CDK</option>
          </select>
          <button type="button" class="mini-btn" :disabled="recordsLoading" @click="reloadRecords">
            {{ recordsLoading ? "刷新中..." : "刷新" }}
          </button>
        </div>

        <div class="table-wrap">
          <table class="record-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>玩家</th>
                <th>Steam64</th>
                <th>结果</th>
                <th>发放</th>
                <th>剩余</th>
                <th>CDK</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!records.length">
                <td colspan="7" class="empty-cell">暂无记录。</td>
              </tr>
              <tr v-for="record in records" :key="record.id">
                <td>{{ formatTime(record.createdAt) }}</td>
                <td>{{ record.playerName || "-" }}</td>
                <td class="mono">{{ record.steamId || "-" }}</td>
                <td>{{ resultLabel(record.result, record.failureReason) }}</td>
                <td>{{ record.grantedCount }}</td>
                <td>{{ record.remainingCount ?? "-" }}</td>
                <td class="mono">{{ record.code }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import {
  createBlackEdgeCdkBatch,
  deactivateBlackEdgeCdkBatch,
  fetchBlackEdgeBatchActivations,
  fetchBlackEdgeCdkState,
  type BlackEdgeCdkActivationRecord,
  type BlackEdgeCdkBatch,
  type BlackEdgeCdkState,
} from "../app/blackEdgePrivilegeApi";
import { ApiError } from "../app/apiClient";
import { useAuthStore } from "../stores/auth.store";
import { useUiStore } from "../stores/ui.store";
import { copyTextWithToast } from "../utils/clipboard";

const auth = useAuthStore();
const ui = useUiStore();
const canEdit = computed(() => Boolean(auth.user?.isSuperAdmin));

const loading = ref(false);
const creating = ref(false);
const actionBatchId = ref("");
const error = ref("");
const notice = ref("");
const state = ref<BlackEdgeCdkState | null>(null);
const selectedBatchId = ref("");
const expandedBatchId = ref("");
const createdCodes = ref<string[]>([]);

const form = reactive({
  codeType: "HN",
  quantity: 20,
  grantCount: 1,
  allowMultiActivation: false,
});

const recordsOpen = ref(false);
const recordsLoading = ref(false);
const recordsBatch = ref<BlackEdgeCdkBatch | null>(null);
const records = ref<BlackEdgeCdkActivationRecord[]>([]);
const recordFilters = reactive({
  steamId: "",
  result: "",
});

const batches = computed(() => state.value?.batches ?? []);
const canSubmit = computed(() => {
  return Boolean(form.codeType.trim())
    && Number(form.quantity) > 0
    && Number(form.grantCount) > 0;
});

onMounted(() => {
  void loadState();
});

async function loadState() {
  loading.value = true;
  error.value = "";
  try {
    state.value = await fetchBlackEdgeCdkState();
    selectedBatchId.value = selectedBatchId.value || state.value.batches[0]?.id || "";
  } catch (err) {
    error.value = renderError(err);
  } finally {
    loading.value = false;
  }
}

async function createBatch() {
  if (!canEdit.value || !canSubmit.value) return;
  creating.value = true;
  error.value = "";
  try {
    const result = await createBlackEdgeCdkBatch({
      codeType: form.codeType.trim().toUpperCase(),
      quantity: Number(form.quantity) || 1,
      grantCount: Number(form.grantCount) || 1,
      allowMultiActivation: Boolean(form.allowMultiActivation),
    });
    state.value = result;
    createdCodes.value = result.createdCodes ?? [];
    selectedBatchId.value = result.createdBatchId ?? result.batches[0]?.id ?? "";
    notice.value = result.message ?? "黑奴跳边 CDK 批次已创建。";
  } catch (err) {
    error.value = renderError(err);
  } finally {
    creating.value = false;
  }
}

async function deactivateBatch(batch: BlackEdgeCdkBatch) {
  if (!canEdit.value) return;
  actionBatchId.value = batch.id;
  error.value = "";
  try {
    const result = await deactivateBlackEdgeCdkBatch(batch.id);
    state.value = result;
    if (selectedBatchId.value === batch.id) {
      selectedBatchId.value = result.batches[0]?.id ?? "";
    }
    notice.value = result.message ?? "批次已停用。";
  } catch (err) {
    error.value = renderError(err);
  } finally {
    actionBatchId.value = "";
  }
}

async function openBatchRecords(batch: BlackEdgeCdkBatch) {
  recordsBatch.value = batch;
  recordsOpen.value = true;
  await reloadRecords();
}

async function reloadRecords() {
  if (!recordsBatch.value) return;
  recordsLoading.value = true;
  error.value = "";
  try {
    const result = await fetchBlackEdgeBatchActivations(recordsBatch.value.id, {
      steamId: recordFilters.steamId,
      result: recordFilters.result,
    });
    records.value = result.records;
  } catch (err) {
    error.value = renderError(err);
  } finally {
    recordsLoading.value = false;
  }
}

function closeRecords() {
  recordsOpen.value = false;
  recordsBatch.value = null;
  records.value = [];
  recordFilters.steamId = "";
  recordFilters.result = "";
}

async function copyBatchCodes(batch: BlackEdgeCdkBatch) {
  const codes = (batch.codes ?? []).filter(Boolean);
  if (!codes.length) return;
  const copied = await copyTextWithToast(codes.join("\n"), ui, {
    label: `${batch.codeType} CDK`,
    successMessage: `Copied all CDK codes for batch ${batch.codeType}.`,
    errorMessage: "Copy failed. Please select and copy manually.",
  });
  if (copied) notice.value = `Copied all CDK codes for batch ${batch.codeType}.`;
}

async function copyCreatedCodes() {
  if (!createdCodes.value.length) return;
  const copied = await copyTextWithToast(createdCodes.value.join("\n"), ui, {
    label: "CDK",
    successMessage: "Recent black-edge CDK codes copied.",
    errorMessage: "Copy failed. Please select and copy manually.",
  });
  if (copied) notice.value = "Recent black-edge CDK codes copied.";
}
function formatTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function resultLabel(result: string, failureReason: string) {
  switch (result) {
    case "success":
      return "Success";
    case "code_used":
      return "CDK used";
    case "duplicate_player_restricted":
      return "Duplicate player restricted";
    case "batch_deactivated":
      return "Batch deactivated";
    case "code_not_found":
      return "CDK not found";
    case "type_mismatch":
      return "Type mismatch";
    case "invalid_player":
      return "Invalid player";
    default:
      return failureReason || result || "-";
  }
}

function renderError(err: unknown) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Black-edge CDK page request failed.";
}
</script>



<style scoped>
.black-edge-page {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  gap: 14px;
  height: 100%;
  min-height: 0;
  padding: 16px;
  overflow: hidden;
}

.page-header,
.panel-head,
.batch-card__head,
.batch-actions,
.filter-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.page-header,
.panel-head,
.batch-card__head {
  justify-content: space-between;
  align-items: flex-start;
}

.page-header h1,
.panel-head h2,
.panel-head h3 {
  margin: 0;
}

.page-header p,
.panel-head p,
.panel-stat,
.batch-card p,
.metric span {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.page-banner,
.panel,
.summary-card,
.modal-panel {
  border: 1px solid var(--color-border-soft);
  border-radius: 12px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.015)),
    rgba(255, 255, 255, 0.025);
}

.page-banner {
  padding: 10px 12px;
}

.page-banner.error {
  border-color: rgba(248, 113, 113, 0.34);
  color: #ffc7c2;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.summary-card {
  display: grid;
  gap: 6px;
  padding: 12px;
}

.summary-card span {
  color: var(--color-text-muted);
  font-size: 12px;
}

.summary-card strong {
  font-size: 28px;
  line-height: 1;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.9fr);
  gap: 14px;
  min-height: 0;
  overflow: hidden;
}

.panel {
  padding: 12px;
  min-height: 0;
  display: grid;
  gap: 12px;
}

.batch-panel {
  grid-template-rows: auto minmax(0, 1fr);
}

.batch-list,
.code-list {
  display: grid;
  gap: 8px;
}

.batch-list {
  min-height: 0;
  overflow: auto;
  align-content: start;
}

.batch-card {
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  padding: 12px;
  display: grid;
  gap: 10px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.03);
}

.batch-card.active {
  border-color: rgba(96, 165, 250, 0.5);
  background: rgba(37, 99, 235, 0.12);
}

.batch-title-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.pill {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid rgba(96, 165, 250, 0.34);
  background: rgba(37, 99, 235, 0.12);
  color: var(--color-text-primary);
  font-size: 11px;
  font-weight: 700;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.metric {
  display: grid;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
}

.metric strong {
  font-size: 18px;
  line-height: 1.1;
}

.create-form {
  display: grid;
  gap: 12px;
}

.field {
  display: grid;
  gap: 6px;
}

.field span {
  color: var(--color-text-muted);
  font-size: 12px;
}

.input {
  min-width: 0;
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  background: rgba(5, 8, 16, 0.4);
  color: var(--color-text-primary);
  padding: 9px 10px;
}

.checkbox-row {
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.page-btn,
.mini-btn {
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
  cursor: pointer;
}

.page-btn {
  min-height: 38px;
  padding: 0 14px;
}

.page-btn.primary {
  border-color: rgba(96, 165, 250, 0.42);
  background: rgba(37, 99, 235, 0.18);
}

.mini-btn {
  padding: 7px 10px;
}

.mini-btn.danger {
  border-color: rgba(248, 113, 113, 0.34);
  background: rgba(127, 29, 29, 0.18);
}

.page-btn:disabled,
.mini-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.code-list code,
.mono {
  font-family: ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace;
}

.code-list {
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
}

.code-list code {
  display: block;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  overflow-wrap: anywhere;
}

.code-list.tall {
  max-height: 260px;
  overflow: auto;
}

.inline-link {
  width: fit-content;
  padding: 0;
  border: 0;
  background: transparent;
  color: #93c5fd;
  cursor: pointer;
}

.empty-state,
.empty-cell {
  color: var(--color-text-muted);
  font-size: 13px;
}

.created-panel {
  display: grid;
  gap: 10px;
}

.panel-head.compact h3 {
  font-size: 16px;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-confirm-dialog);
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(4, 10, 18, 0.72);
  backdrop-filter: blur(4px);
}

.modal-panel {
  width: min(1100px, 100%);
  max-height: min(82vh, 900px);
  padding: 14px;
  display: grid;
  gap: 12px;
}

.filter-row .input {
  flex: 1 1 200px;
}

.select {
  max-width: 180px;
}

.table-wrap {
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
}

.record-table {
  width: 100%;
  min-width: 980px;
  border-collapse: collapse;
}

.record-table th,
.record-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  vertical-align: top;
}

.record-table thead th {
  position: sticky;
  top: 0;
  background: rgba(17, 24, 39, 0.94);
  z-index: 1;
  color: var(--color-text-muted);
  font-size: 12px;
}

@media (max-width: 1080px) {
  .workspace {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .summary-grid,
  .metric-grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 560px) {
  .black-edge-page {
    padding: 12px;
  }

  .summary-grid,
  .metric-grid {
    grid-template-columns: 1fr;
  }
}
</style>
