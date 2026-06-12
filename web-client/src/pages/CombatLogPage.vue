<template>
  <AppPage full-bleed class="combat-log-page">
    <AppPageHeader
      eyebrow="SYSTEM LOGS"
      title="战斗日志"
      subtitle="按月分文件夹、按天分文件。记录时间、事件类型、标记、攻击者、受害者、伤害与武器。"
      :status-items="headerStatusItems"
    >
      <template #actions>
        <button
          type="button"
          class="refresh-button"
          :disabled="refreshing"
          @click="refreshAll"
        >
          <span v-if="refreshing" class="spinner button-spinner"></span>
          <span>{{ refreshing ? "刷新中..." : "全部刷新" }}</span>
        </button>
      </template>
    </AppPageHeader>

    <AppPageToolbar>
      <div class="status-compact">
        <span class="live-pill" :class="{ live: isLiveSelected }">{{ liveBadgeLabel }}</span>
        <span class="meta-chip">最近写入：{{ formatDateTime(status?.lastWrittenAt) }}</span>
        <span class="meta-chip">写入次数：{{ formatNumber(status?.writeCount ?? 0) }}</span>
        <span class="meta-chip">当前文件：{{ currentFileLabel || "--" }}</span>
        <span class="meta-chip">读取路径：{{ selectedFileLabel || status?.currentTargetRelativePath || "--" }}</span>
        <span v-if="selectedFile" class="meta-chip">文件大小：{{ formatBytes(selectedFileSize) }}</span>
        <span v-if="selectedFile" class="meta-chip">修改时间：{{ formatDateTime(selectedFile.mtime) }}</span>
        <span v-if="search" class="meta-chip">搜索词：{{ search }}</span>
      </div>
    </AppPageToolbar>

    <div v-if="refreshError" class="refresh-banner">
      {{ refreshError }}
    </div>

    <DataState
      :loading="bootLoading"
      :error="bootError"
      :empty="!bootLoading && !bootError && months.length === 0"
      empty-title="暂无战斗日志"
      empty-text="模块会自动按月创建文件夹、按天创建日志文件。"
    >
      <div class="layout">
        <AppCard compact class="side-card" title="月份">
          <div class="list">
            <button
              v-for="month in months"
              :key="month.month"
              type="button"
              class="list-item"
              :class="{ active: month.month === selectedMonth }"
              @click="selectMonth(month.month)"
            >
              <span>{{ month.month }}</span>
              <small>{{ month.fileCount }} 个文件</small>
            </button>
          </div>
        </AppCard>

        <AppCard compact class="side-card" :title="selectedMonth ? `${selectedMonth} 日期` : '日期'">
          <div class="list">
            <button
              v-for="file in files"
              :key="file.date"
              type="button"
              class="list-item"
              :class="{ active: file.date === selectedDate }"
              @click="selectDate(file.date)"
            >
              <span>{{ file.date }}</span>
              <small>{{ formatBytes(file.size) }}</small>
            </button>
            <div v-if="!files.length" class="empty-note">当前月份没有日志文件</div>
          </div>
        </AppCard>

        <AppCard compact class="viewer-card" title="日志内容">
          <template #actions>
            <div class="viewer-header-meta">
              <span class="meta-chip">总行数：{{ formatNumber(total) }}</span>
              <span class="meta-chip">偏移：{{ formatNumber(offset) }}</span>
              <span v-if="isLiveSelected" class="meta-chip live">实时跟随中</span>
            </div>
          </template>

          <div class="toolbar">
            <div class="search-box">
              <input
                v-model="search"
                class="search-input"
                placeholder="搜索攻击者 / 受害者 / 武器 / 标记"
                @keydown.enter.prevent="runSearch"
              >
              <button type="button" class="clear-button" @click="clearSearch" :disabled="!search">清空</button>
            </div>
            <select v-model.number="limit" class="limit-select" @change="() => reloadEntries()">
              <option :value="100">100 条/页</option>
              <option :value="200">200 条/页</option>
              <option :value="500">500 条/页</option>
              <option :value="1000">1000 条/页</option>
            </select>
            <div class="pagination-buttons">
              <button type="button" class="action-btn" @click="pageNewer" :disabled="offset <= 0">更新的</button>
              <button type="button" class="action-btn" @click="pageOlder" :disabled="!hasMoreOlder">更旧的</button>
              <button type="button" class="action-btn" :disabled="entriesLoading" @click="() => reloadEntries()">
                <span v-if="entriesLoading" class="spinner button-spinner"></span>
                <span>{{ entriesLoading ? "刷新中..." : "刷新" }}</span>
              </button>
            </div>
          </div>

          <DataState
            :loading="entriesLoading && !entries.length"
            :error="entriesError"
            :empty="!entriesLoading && !entriesError && entries.length === 0"
            empty-title="没有日志行"
            empty-text="当前文件或搜索条件下没有匹配内容。"
          >
            <div class="table-wrap" :class="{ 'is-loading': entriesLoading }">
              <table class="log-table">
                <thead>
                  <tr>
                    <th style="width: 80px">时间</th>
                    <th style="width: 100px">事件</th>
                    <th style="width: 60px">标记</th>
                    <th>攻击者</th>
                    <th>受害者</th>
                    <th style="width: 60px">伤害</th>
                    <th style="width: 180px">武器</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="line in entries" :key="`${line.lineNumber}-${line.raw}`">
                    <td class="time-cell">{{ line.time || "--" }}</td>
                    <td class="type-cell">
                      <span class="type-pill" :class="line.type?.toLowerCase()">{{ line.type || "--" }}</span>
                    </td>
                    <td class="mark-cell">{{ line.mark || "-" }}</td>
                    <td class="name-cell attacker">{{ line.attacker || "-" }}</td>
                    <td class="name-cell victim">{{ line.victim || "-" }}</td>
                    <td class="damage-cell">{{ line.damage || "-" }}</td>
                    <td class="weapon-cell">{{ line.weapon || "-" }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </DataState>
        </AppCard>
      </div>
    </DataState>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiGet } from "../app/apiClient";
import { renderApiError } from "../app/errors";
import AppPage from "../components/common/AppPage.vue";
import AppPageHeader from "../components/common/AppPageHeader.vue";
import AppPageToolbar from "../components/common/AppPageToolbar.vue";
import AppCard from "../components/common/AppCard.vue";
import DataState from "../components/common/DataState.vue";

interface CombatLogStatus {
  currentFilePath?: string;
  currentRelativePath?: string;
  currentTargetFilePath?: string;
  currentTargetRelativePath?: string;
  currentMonth?: string;
  currentDate?: string;
  lastWrittenAt?: string;
  writeCount?: number;
}

interface CombatLogMonth {
  month: string;
  fileCount: number;
  latestDate?: string;
}

interface CombatLogFile {
  date: string;
  fileName: string;
  filePath: string;
  relativePath: string;
  size: number;
  mtime: string;
}

interface CombatLogLine {
  lineNumber: number;
  time: string;
  type: string;
  mark: string;
  attacker: string;
  victim: string;
  damage: string;
  weapon: string;
  raw: string;
  extra?: string;
}

const route = useRoute();
const router = useRouter();

const status = ref<CombatLogStatus | null>(null);
const months = ref<CombatLogMonth[]>([]);
const files = ref<CombatLogFile[]>([]);
const entries = ref<CombatLogLine[]>([]);
const meta = ref<any | null>(null);

const selectedMonth = ref(String(route.query.month ?? ""));
const selectedDate = ref(String(route.query.date ?? ""));
const search = ref(String(route.query.q ?? ""));
const limit = ref(clampInt(route.query.limit, 200, 100, 1000));
const offset = ref(Math.max(Number(route.query.offset ?? 0) || 0, 0));

const bootLoading = ref(true);
const bootError = ref("");
const refreshError = ref("");
const refreshing = ref(false);
const entriesLoading = ref(false);
const entriesError = ref("");

let statusTimer: number | null = null;
let refreshSeq = 0;

const currentFileLabel = computed(() => (
  status.value?.currentRelativePath
  || status.value?.currentTargetRelativePath
  || status.value?.currentFilePath
  || status.value?.currentTargetFilePath
  || ""
));

const currentTargetLabel = computed(() => {
  if (!status.value) return "--";
  return `${status.value.currentMonth ?? "--"} / ${status.value.currentDate ?? "--"}`;
});

const selectedFile = computed(() => files.value.find((file) => file.date === selectedDate.value) ?? null);
const monthCount = computed(() => months.value.length);
const selectedLineCount = computed(() => Number(meta.value?.total ?? 0));
const selectedFileLabel = computed(() => (
  selectedFile.value?.relativePath
  || meta.value?.relativePath
  || currentFileLabel.value
  || status.value?.currentTargetRelativePath
  || status.value?.currentTargetFilePath
  || ""
));
const selectedFileSize = computed(() => Number(selectedFile.value?.size ?? 0));
const isLiveSelected = computed(() => Boolean(
  status.value
  && selectedMonth.value
  && selectedDate.value
  && selectedMonth.value === status.value.currentMonth
  && selectedDate.value === status.value.currentDate
));
const liveBadgeLabel = computed(() => (isLiveSelected.value ? "LIVE 当前写入文件" : "历史文件浏览"));
const total = computed(() => Number(meta.value?.total ?? 0));
const hasMoreOlder = computed(() => Boolean(meta.value?.hasMoreOlder));

const headerStatusItems = computed(() => [
  { label: `${formatNumber(monthCount.value)} 个月份`, tone: "idle" as const },
  { label: `${formatNumber(files.value.length)} 个文件`, tone: "idle" as const },
  { label: `${formatNumber(selectedLineCount.value)} 行记录`, tone: "idle" as const },
  {
    label: isLiveSelected.value ? "LIVE 写入中" : "历史归档",
    tone: isLiveSelected.value ? "ok" as const : "idle" as const,
  },
]);

watch(
  () => [selectedMonth.value, selectedDate.value, search.value, offset.value, limit.value],
  async () => {
    void router.replace({
      query: {
        panel: "combat-log",
        month: selectedMonth.value || undefined,
        date: selectedDate.value || undefined,
        q: search.value || undefined,
        offset: offset.value > 0 ? String(offset.value) : undefined,
        limit: limit.value !== 200 ? String(limit.value) : undefined,
      },
    });
    if (!bootLoading.value) {
      await reloadEntries(true);
    }
  },
);

onMounted(async () => {
  await bootstrap();
  statusTimer = window.setInterval(() => {
    void refreshStatusAndMaybeEntries();
  }, 5000);
});

onBeforeUnmount(() => {
  if (statusTimer != null) {
    window.clearInterval(statusTimer);
    statusTimer = null;
  }
});

async function bootstrap() {
  bootLoading.value = true;
  bootError.value = "";
  refreshError.value = "";

  try {
    await refreshAllData();
  } catch (error) {
    bootError.value = renderApiError(error, "加载战斗日志失败");
  } finally {
    bootLoading.value = false;
  }
}

async function refreshAll() {
  if (refreshing.value) return;

  refreshing.value = true;
  refreshError.value = "";

  try {
    await refreshAllData();
  } catch (error) {
    refreshError.value = renderApiError(error, "刷新战斗日志失败");
  } finally {
    refreshing.value = false;
  }
}

async function refreshAllData() {
  await refreshStatus();
  await refreshMonths();
  await ensureSelection();
  await loadFiles();
  await ensureDateSelection();
  await reloadEntries();
}

async function refreshStatus() {
  status.value = await apiGet<CombatLogStatus>("/api/combat-logs/status");
}

async function refreshStatusAndMaybeEntries() {
  await refreshStatus();
  if (isLiveSelected.value && !entriesLoading.value) {
    await reloadEntries(true);
    return;
  }
  renderState();
}

async function refreshMonths() {
  const data = await apiGet<{ months: CombatLogMonth[] }>("/api/combat-logs/months");
  months.value = Array.isArray(data.months) ? data.months : [];
}

async function loadFiles() {
  if (!selectedMonth.value) {
    files.value = [];
    return;
  }

  const data = await apiGet<{ files: CombatLogFile[] }>(
    `/api/combat-logs/files?month=${encodeURIComponent(selectedMonth.value)}`,
  );
  files.value = Array.isArray(data.files) ? data.files : [];
}

async function reloadEntries(silent = false) {
  if (!selectedMonth.value || !selectedDate.value) {
    entries.value = [];
    meta.value = null;
    return;
  }

  const requestId = ++refreshSeq;
  if (!silent) {
    entriesLoading.value = true;
  }
  entriesError.value = "";

  try {
    const params = new URLSearchParams({
      month: selectedMonth.value,
      date: selectedDate.value,
      q: search.value,
      offset: String(offset.value),
      limit: String(limit.value),
    });
    const data = await apiGet<any>(`/api/combat-logs/read?${params.toString()}`);
    if (requestId !== refreshSeq) return;
    entries.value = Array.isArray(data.lines) ? data.lines : [];
    meta.value = data;
  } catch (error) {
    if (requestId !== refreshSeq) return;
    entriesError.value = renderApiError(error, "加载战斗日志失败");
  } finally {
    if (requestId !== refreshSeq) return;
    entriesLoading.value = false;
  }
}

async function ensureSelection() {
  const monthFromQuery = String(route.query.month ?? "").trim();
  const monthFromStatus = String(status.value?.currentMonth ?? "").trim();
  const monthFromData = months.value[0]?.month ?? "";
  selectedMonth.value = selectedMonth.value || monthFromQuery || monthFromStatus || monthFromData;
}

async function ensureDateSelection() {
  const dateFromQuery = String(route.query.date ?? "").trim();
  const dateFromStatus = String(status.value?.currentDate ?? "").trim();
  const dateFromData = files.value[0]?.date ?? "";
  selectedDate.value = selectedDate.value || dateFromQuery || dateFromStatus || dateFromData;
}

async function selectMonth(month: string) {
  if (!month || month === selectedMonth.value) return;
  selectedMonth.value = month;
  offset.value = 0;
  entries.value = []; // Clear entries to trigger loading block
  await loadFiles();
  selectedDate.value = files.value[0]?.date ?? "";
}

async function selectDate(date: string) {
  if (!date || date === selectedDate.value) return;
  selectedDate.value = date;
  offset.value = 0;
  entries.value = []; // Clear entries to trigger loading block
}

async function runSearch() {
  offset.value = 0;
  entries.value = []; // Clear entries to trigger loading block
}

async function clearSearch() {
  if (!search.value) return;
  search.value = "";
  offset.value = 0;
  entries.value = []; // Clear entries to trigger loading block
}

async function pageOlder() {
  if (!hasMoreOlder.value) return;
  offset.value += limit.value;
}

async function pageNewer() {
  if (offset.value <= 0) return;
  offset.value = Math.max(0, offset.value - limit.value);
}

function renderState() {
  // Vue reactivity handles the actual updates
}

function formatDateTime(value: unknown) {
  if (!value) return "--";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatBytes(value: unknown) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatNumber(value: unknown) {
  return new Intl.NumberFormat("zh-CN").format(Number(value ?? 0));
}

function clampInt(value: unknown, defaultValue: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(max, Math.max(min, parsed));
}
</script>

<style scoped>
.combat-log-page {
  height: 100%;
  padding: 16px;
  background:
    radial-gradient(circle at 0% 0%, color-mix(in srgb, var(--theme-brand-glow) 90%, transparent), transparent 26%),
    radial-gradient(circle at 100% 0%, color-mix(in srgb, var(--theme-warn-glow) 80%, transparent), transparent 24%),
    var(--theme-background-flat);
  color: var(--color-text-primary);
}

.status-compact {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.live-pill,
.meta-chip {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--color-border-default);
  background: color-mix(in srgb, var(--color-bg-elevated) 88%, transparent);
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 600;
}

.live-pill.live {
  border-color: rgba(34, 197, 94, 0.28);
  background: rgba(34, 197, 94, 0.16);
  color: #a7f3d0;
}

.refresh-banner {
  padding: 12px 16px;
  border-radius: 12px;
  border: 1px solid rgba(248, 113, 113, 0.25);
  background: rgba(248, 113, 113, 0.08);
  color: color-mix(in srgb, var(--color-status-error) 34%, white 66%);
  font-size: 14px;
}

.layout {
  display: grid;
  grid-template-columns: minmax(200px, 240px) minmax(220px, 260px) 1fr;
  gap: 16px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.side-card,
.viewer-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.side-card :deep(.card-body),
.viewer-card :deep(.card-body) {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.list-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 1px solid var(--color-border-default);
  background: color-mix(in srgb, var(--color-bg-card) 90%, transparent);
  border-radius: 8px;
  padding: 10px 12px;
  color: var(--color-text-secondary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: transform 0.12s ease, border-color 0.12s ease, background-color 0.12s ease;
}

.list-item:hover {
  transform: translateY(-1px);
  border-color: rgba(96, 165, 250, 0.4);
  background: rgba(96, 165, 250, 0.08);
}

.list-item.active {
  border-color: rgba(96, 165, 250, 0.55);
  background: rgba(96, 165, 250, 0.12);
  color: var(--color-text-primary);
}

.list-item small {
  color: var(--color-text-muted);
  font-size: 11px;
}

.empty-note {
  color: var(--color-text-muted);
  font-size: 13px;
  text-align: center;
  padding: 16px 0;
}

.viewer-header-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.search-box {
  display: flex;
  flex: 1 1 240px;
  min-width: 0;
  gap: 6px;
}

.search-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  padding: 0 12px;
  font-size: 13px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.search-input:focus {
  outline: none;
  border-color: var(--color-border-highlight);
  box-shadow: var(--theme-field-glow);
}

.clear-button {
  height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  background: color-mix(in srgb, var(--color-bg-elevated) 88%, transparent);
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.clear-button:hover:not(:disabled) {
  background: var(--color-bg-hover);
}

.clear-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.limit-select {
  height: 36px;
  width: 110px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  padding: 0 8px;
  font-size: 13px;
  outline: none;
  cursor: pointer;
}

.limit-select:focus {
  border-color: var(--color-border-highlight);
}

.pagination-buttons {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  background: color-mix(in srgb, var(--color-bg-elevated) 88%, transparent);
  color: var(--color-text-primary);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.action-btn:hover:not(:disabled) {
  background: var(--color-bg-hover);
  border-color: var(--color-border-highlight);
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.refresh-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 16px;
  border-radius: 10px;
  border: 1px solid var(--color-border-default);
  background: color-mix(in srgb, var(--color-bg-elevated) 88%, transparent);
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease, color 0.15s ease, background-color 0.15s ease;
}

.refresh-button:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: var(--color-border-highlight);
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
}

.refresh-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.table-wrap {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
  background: color-mix(in srgb, var(--color-bg-card) 92%, transparent);
  transition: opacity 0.15s ease;
}

.table-wrap.is-loading {
  opacity: 0.6;
  pointer-events: none;
}

.log-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
}

.log-table thead th {
  position: sticky;
  top: 0;
  background:
    var(--theme-panel-highlight),
    color-mix(in srgb, var(--color-bg-elevated) 96%, transparent);
  z-index: 1;
  text-align: left;
  color: var(--color-text-muted);
  font-weight: 600;
  border-bottom: 2px solid var(--color-border-default);
  padding: 12px 14px;
}

.log-table th,
.log-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border-soft);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-table tbody tr:nth-child(even) {
  background: color-mix(in srgb, var(--color-bg-card) 92%, transparent);
}

.log-table tbody tr:hover {
  background: rgba(96, 165, 250, 0.08);
}

.time-cell {
  color: var(--color-text-muted);
  font-family: var(--font-mono, monospace);
}

.type-cell {
  text-align: center;
}

.mark-cell {
  text-align: center;
  color: var(--color-text-muted);
}

.damage-cell {
  text-align: center;
  font-weight: 700;
  color: var(--color-status-error);
}

.name-cell {
  font-weight: 500;
}

.name-cell.attacker {
  color: #93c5fd;
}

.name-cell.victim {
  color: #fca5a5;
}

.weapon-cell {
  color: var(--color-text-muted);
  font-size: 12px;
}

.type-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  min-height: 22px;
  min-width: 70px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--color-bg-hover) 90%, transparent);
  color: var(--color-text-primary);
  text-transform: uppercase;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.type-pill.kill {
  background: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.type-pill.wound {
  background: rgba(245, 158, 11, 0.2);
  color: #fcd34d;
  border: 1px solid rgba(245, 158, 11, 0.2);
}

.type-pill.suicide {
  background: rgba(107, 114, 128, 0.2);
  color: #d1d5db;
  border: 1px solid rgba(107, 114, 128, 0.2);
}

.type-pill.tk {
  background: rgba(168, 85, 247, 0.2);
  color: #d8b4fe;
  border: 1px solid rgba(168, 85, 247, 0.2);
}

.type-pill.revive {
  background: rgba(34, 197, 94, 0.15);
  color: #86efac;
  border: 1px solid rgba(34, 197, 94, 0.15);
}

.type-pill.damage {
  background: rgba(59, 130, 246, 0.15);
  color: #93c5fd;
  border: 1px solid rgba(59, 130, 246, 0.15);
}

.spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid color-mix(in srgb, var(--color-border-default) 90%, transparent);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.button-spinner {
  margin-right: 6px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1200px) {
  .layout {
    grid-template-columns: 1fr;
    height: auto;
    overflow: visible;
  }
  .side-card,
  .viewer-card {
    height: 400px;
  }
}
</style>
