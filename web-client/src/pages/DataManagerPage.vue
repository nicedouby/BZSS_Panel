<template>
  <main class="data-manager-page">
    <header class="data-header">
      <div>
        <p class="eyebrow">STORAGE CONTROL</p>
        <h1>数据管理</h1>
        <p class="subtitle">查看面板生成的数据占用，并按类型清理历史文件。核心数据库和业务状态只展示，不允许在运行期间删除。</p>
      </div>
      <button class="refresh-button" type="button" :disabled="loading || cleaning" @click="loadOverview">
        {{ loading ? "扫描中…" : "重新扫描" }}
      </button>
    </header>

    <div v-if="error" class="notice error-notice">{{ error }}</div>
    <div v-if="resultMessage" class="notice success-notice">{{ resultMessage }}</div>

    <section class="summary-grid" aria-label="磁盘占用摘要">
      <article class="summary-card accent">
        <span>面板数据总量</span>
        <strong>{{ formatBytes(overview?.summary.totalBytes ?? 0) }}</strong>
        <small>扫描到的全部面板数据</small>
      </article>
      <article class="summary-card">
        <span>可清理数据</span>
        <strong>{{ formatBytes(overview?.summary.cleanableBytes ?? 0) }}</strong>
        <small>{{ cleanablePercent }}% 的占用可在此页管理</small>
      </article>
      <article class="summary-card">
        <span>文件数量</span>
        <strong>{{ formatCount(overview?.summary.fileCount ?? 0) }}</strong>
        <small>{{ overview?.summary.categoryCount ?? 0 }} 个数据分类</small>
      </article>
      <article class="summary-card">
        <span>已选中</span>
        <strong>{{ formatBytes(selectedBytes) }}</strong>
        <small>{{ selectedIds.size }} 个分类</small>
      </article>
    </section>

    <section class="control-panel">
      <div class="selection-actions">
        <button type="button" class="quiet-button" :disabled="!cleanableCategories.length" @click="selectAllCleanable">选择全部可清理项</button>
        <button type="button" class="quiet-button" :disabled="!selectedIds.size" @click="selectedIds.clear()">清除选择</button>
      </div>
      <label class="retention-control">
        <span>清理范围</span>
        <select v-model="retentionValue" :disabled="cleaning">
          <option value="30">30 天以前</option>
          <option value="90">90 天以前</option>
          <option value="7">7 天以前</option>
          <option value="all">全部历史文件</option>
        </select>
      </label>
      <button class="cleanup-button" type="button" :disabled="!selectedIds.size || cleaning || loading" @click="confirmCleanup">
        {{ cleaning ? "正在清理…" : `清理选中项 · ${formatBytes(selectedBytes)}` }}
      </button>
    </section>

    <section class="data-table-card">
      <div class="table-headline">
        <div>
          <h2>数据分类</h2>
          <p>最近 2 分钟写入的文件和正在录制的 <code>.open</code> 回放始终保留，避免破坏运行中的服务。</p>
        </div>
        <span v-if="overview" class="scan-time">扫描于 {{ formatDate(overview.scannedAt) }}</span>
      </div>

      <div v-if="loading && !overview" class="empty-state">正在统计目录大小，这可能需要几秒钟…</div>
      <div v-else-if="!categories.length" class="empty-state">当前没有发现面板数据文件。</div>
      <div v-else class="table-scroll">
        <table>
          <thead>
            <tr>
              <th class="select-column"><span class="sr-only">选择</span></th>
              <th>数据</th>
              <th>类型</th>
              <th class="number-column">占用</th>
              <th class="number-column">文件</th>
              <th>最后写入</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="category in categories" :key="category.id" :class="{ selected: selectedIds.has(category.id) }">
              <td class="select-column">
                <input
                  type="checkbox"
                  :checked="selectedIds.has(category.id)"
                  :disabled="!category.cleanable || cleaning"
                  :aria-label="`选择 ${category.label}`"
                  @change="toggleCategory(category.id)"
                />
              </td>
              <td>
                <div class="category-name">{{ category.label }}</div>
                <code class="category-path">{{ category.relativePath }}</code>
              </td>
              <td><span class="kind-pill">{{ category.kind }}</span></td>
              <td class="number-column size-value">{{ formatBytes(category.bytes) }}</td>
              <td class="number-column">{{ formatCount(category.fileCount) }}</td>
              <td>{{ formatDate(category.newestModifiedAt) }}</td>
              <td>
                <span v-if="category.error" class="status-pill status-error" :title="category.error">扫描异常</span>
                <span v-else-if="!category.cleanable" class="status-pill status-protected" :title="category.protectedReason">受保护</span>
                <span v-else-if="category.activeFileCount" class="status-pill status-active">{{ category.activeFileCount }} 个活动文件</span>
                <span v-else-if="category.risk === 'medium'" class="status-pill status-history">历史数据</span>
                <span v-else class="status-pill status-cleanable">可安全清理</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <p class="footnote">受保护数据包括玩家主数据库、管理员账号、封禁、网络阻断、预留位和模块业务状态。它们仍会显示实际占用，但不会出现在批量清理范围内。</p>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import {
  cleanupDataCategories,
  fetchDataManagerOverview,
  type DataCategory,
  type DataManagerOverview,
} from "../app/dataManagerApi";

const overview = ref<DataManagerOverview | null>(null);
const loading = ref(false);
const cleaning = ref(false);
const error = ref("");
const resultMessage = ref("");
const retentionValue = ref("30");
const selectedIds = reactive(new Set<string>());

const categories = computed(() => overview.value?.categories ?? []);
const cleanableCategories = computed(() => categories.value.filter((category) => category.cleanable && category.bytes > 0));
const selectedBytes = computed(() => categories.value
  .filter((category) => selectedIds.has(category.id))
  .reduce((total, category) => total + category.bytes, 0));
const cleanablePercent = computed(() => {
  const total = overview.value?.summary.totalBytes ?? 0;
  if (!total) return 0;
  return Math.round(((overview.value?.summary.cleanableBytes ?? 0) / total) * 100);
});

async function loadOverview() {
  loading.value = true;
  error.value = "";
  try {
    overview.value = await fetchDataManagerOverview();
    const validIds = new Set(overview.value.categories.filter((category) => category.cleanable).map((category) => category.id));
    for (const id of selectedIds) if (!validIds.has(id)) selectedIds.delete(id);
  } catch (cause) {
    error.value = formatError(cause, "无法扫描面板数据。");
  } finally {
    loading.value = false;
  }
}

function toggleCategory(id: string) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
}

function selectAllCleanable() {
  for (const category of cleanableCategories.value) selectedIds.add(category.id);
}

async function confirmCleanup() {
  const selected = categories.value.filter((category) => selectedIds.has(category.id));
  if (!selected.length) return;
  const scope = retentionValue.value === "all" ? "全部历史文件" : `${retentionValue.value} 天以前的文件`;
  const names = selected.slice(0, 5).map((category) => category.label).join("、");
  const extra = selected.length > 5 ? `等 ${selected.length} 项` : "";
  if (!window.confirm(`将永久删除 ${names}${extra}中的${scope}。此操作不可恢复，确定继续吗？`)) return;

  cleaning.value = true;
  error.value = "";
  resultMessage.value = "";
  try {
    const result = await cleanupDataCategories(
      selected.map((category) => category.id),
      retentionValue.value === "all" ? null : Number(retentionValue.value),
    );
    resultMessage.value = `已释放 ${formatBytes(result.deletedBytes)}，删除 ${formatCount(result.deletedFiles)} 个文件。`
      + (result.skippedActiveFiles ? ` 为安全起见保留了 ${result.skippedActiveFiles} 个活动文件。` : "")
      + (result.failedFiles ? ` ${result.failedFiles} 个文件清理失败，请检查面板日志。` : "");
    selectedIds.clear();
    await loadOverview();
  } catch (cause) {
    error.value = formatError(cause, "数据清理失败。");
  } finally {
    cleaning.value = false;
  }
}

function formatBytes(value: number) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && amount >= 1024; index += 1) {
    amount /= 1024;
    unit = units[index];
  }
  return `${amount >= 100 ? amount.toFixed(0) : amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${unit}`;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatError(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

onMounted(loadOverview);
</script>

<style scoped>
.data-manager-page {
  width: min(100%, 1720px);
  margin: 0 auto;
  padding: clamp(12px, 1.5vw, 22px);
  display: grid;
  gap: 14px;
  color: var(--color-text-primary);
}

.data-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.eyebrow {
  margin: 0 0 5px;
  color: var(--color-brand-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .16em;
}

h1, h2, p { margin: 0; }
h1 { font-size: clamp(24px, 2.4vw, 36px); letter-spacing: -.04em; }
h2 { font-size: 17px; }
.subtitle { max-width: 790px; margin-top: 7px; color: var(--color-text-secondary); font-size: 13px; line-height: 1.6; }

.refresh-button,
.quiet-button,
.cleanup-button {
  min-height: 36px;
  border-radius: 9px;
  font-weight: 700;
}

.refresh-button,
.quiet-button { background: var(--color-bg-elevated); }
.cleanup-button { border-color: color-mix(in srgb, #ef4444 60%, var(--color-border-default)); background: color-mix(in srgb, #ef4444 17%, var(--color-bg-elevated)); color: #fecaca; }
.cleanup-button:hover:not(:disabled) { border-color: #ef4444; background: color-mix(in srgb, #ef4444 25%, var(--color-bg-elevated)); }

.notice { padding: 11px 14px; border-radius: 10px; border: 1px solid; font-size: 13px; }
.error-notice { border-color: color-mix(in srgb, #ef4444 55%, transparent); background: color-mix(in srgb, #ef4444 12%, transparent); color: #fecaca; }
.success-notice { border-color: color-mix(in srgb, #22c55e 48%, transparent); background: color-mix(in srgb, #22c55e 11%, transparent); color: #bbf7d0; }

.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.summary-card {
  min-height: 112px;
  padding: 16px;
  display: grid;
  align-content: space-between;
  gap: 6px;
  border: 1px solid var(--color-border-default);
  border-radius: 13px;
  background: var(--theme-panel-highlight), var(--color-bg-card);
  box-shadow: var(--shadow-sm);
}
.summary-card.accent { border-color: color-mix(in srgb, var(--color-brand-primary) 45%, var(--color-border-default)); }
.summary-card span { color: var(--color-text-secondary); font-size: 12px; }
.summary-card strong { font-size: clamp(23px, 2.2vw, 31px); letter-spacing: -.04em; }
.summary-card small { color: var(--color-text-muted); font-size: 11px; }

.control-panel {
  padding: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  background: color-mix(in srgb, var(--color-bg-card) 91%, transparent);
}
.selection-actions { display: flex; gap: 7px; }
.retention-control { margin-left: auto; display: flex; align-items: center; gap: 8px; color: var(--color-text-secondary); font-size: 12px; }
.retention-control select { min-height: 36px; border-radius: 9px; }

.data-table-card { min-width: 0; overflow: hidden; border: 1px solid var(--color-border-default); border-radius: 14px; background: var(--theme-panel-highlight), var(--color-bg-card); box-shadow: var(--shadow-md); }
.table-headline { padding: 15px 17px; display: flex; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--color-border-default); }
.table-headline p { margin-top: 5px; color: var(--color-text-muted); font-size: 11px; line-height: 1.5; }
.scan-time { flex: 0 0 auto; color: var(--color-text-muted); font-size: 11px; }
.table-scroll { overflow: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { padding: 9px 11px; color: var(--color-text-muted); font-size: 10px; letter-spacing: .08em; text-align: left; text-transform: uppercase; background: color-mix(in srgb, var(--color-bg-elevated) 72%, transparent); }
td { padding: 11px; border-top: 1px solid color-mix(in srgb, var(--color-border-default) 72%, transparent); vertical-align: middle; }
tbody tr { transition: background-color .14s ease; }
tbody tr:hover, tbody tr.selected { background: color-mix(in srgb, var(--color-brand-primary) 7%, transparent); }
.select-column { width: 38px; text-align: center; }
.number-column { text-align: right; white-space: nowrap; }
.size-value { font-weight: 800; font-variant-numeric: tabular-nums; }
.category-name { margin-bottom: 4px; font-size: 13px; font-weight: 750; }
.category-path { color: var(--color-text-muted); font-size: 10px; overflow-wrap: anywhere; }
.kind-pill, .status-pill { display: inline-flex; align-items: center; padding: 4px 7px; border-radius: 999px; white-space: nowrap; font-size: 10px; font-weight: 750; }
.kind-pill { color: var(--color-text-secondary); background: var(--color-bg-elevated); border: 1px solid var(--color-border-default); }
.status-cleanable { color: #86efac; background: color-mix(in srgb, #22c55e 13%, transparent); }
.status-history { color: #fde68a; background: color-mix(in srgb, #eab308 13%, transparent); }
.status-active { color: #93c5fd; background: color-mix(in srgb, #3b82f6 14%, transparent); }
.status-protected { color: var(--color-text-muted); background: color-mix(in srgb, var(--color-text-muted) 11%, transparent); }
.status-error { color: #fecaca; background: color-mix(in srgb, #ef4444 14%, transparent); }
.empty-state { min-height: 230px; display: grid; place-items: center; color: var(--color-text-muted); font-size: 13px; }
.footnote { padding: 0 3px; color: var(--color-text-muted); font-size: 11px; line-height: 1.6; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

@media (max-width: 980px) {
  .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .control-panel { align-items: stretch; flex-wrap: wrap; }
  .retention-control { margin-left: 0; }
  .cleanup-button { margin-left: auto; }
}

@media (max-width: 620px) {
  .data-header { flex-direction: column; }
  .refresh-button { width: 100%; }
  .summary-grid { grid-template-columns: 1fr; }
  .selection-actions { width: 100%; }
  .selection-actions button { flex: 1; }
  .retention-control { width: 100%; justify-content: space-between; }
  .cleanup-button { width: 100%; }
}
</style>

