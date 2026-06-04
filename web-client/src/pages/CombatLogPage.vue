<template>
  <section class="page combat-log-page">
    <PageHeader
      title="战斗日志"
      subtitle="按月分文件夹、按天分文件。只保留时间、事件类型、标记、攻击者、受害者、伤害和武器。"
    />

    <PageCard class="status-card" compact>
      <div class="status-compact">
        <span class="live-pill" :class="{ live: isLiveSelected }">{{ liveBadgeLabel }}</span>

        <span class="meta-chip">{{ formatNumber(monthCount) }} 个月份</span>
        <span class="meta-chip">{{ formatNumber(files.length) }} 个文件</span>
        <span class="meta-chip">{{ formatNumber(selectedLineCount) }} 行</span>

        <span class="meta-chip">当前文件：{{ currentFileLabel || "--" }}</span>
        <span class="meta-chip">当前目标：{{ currentTargetLabel }}</span>
        <span class="meta-chip">最近写入：{{ formatDateTime(status?.lastWrittenAt) }}</span>
        <span class="meta-chip">写入次数：{{ formatNumber(status?.writeCount ?? 0) }}</span>

        <span class="meta-chip">当前读取路径：{{ selectedFileLabel || status?.currentTargetRelativePath || "--" }}</span>
        <span v-if="selectedFile" class="meta-chip">文件大小：{{ formatBytes(selectedFileSize) }}</span>
        <span v-if="selectedFile" class="meta-chip">修改时间：{{ formatDateTime(selectedFile.mtime) }}</span>
        <span v-if="search" class="meta-chip">搜索词：{{ search }}</span>
      </div>
    </PageCard>

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
        <PageCard compact class="side-card">
          <div class="section-head">
            <strong>月份</strong>
            <button type="button" class="mini-button" @click="refreshAll">刷新</button>
          </div>
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
        </PageCard>

        <PageCard compact class="side-card">
          <div class="section-head">
            <strong>日期</strong>
            <span class="muted">{{ selectedMonth || "--" }}</span>
          </div>
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
        </PageCard>

        <PageCard compact class="viewer-card">
          <div class="toolbar">
            <input
              v-model="search"
              class="search-input"
              placeholder="搜索攻击者 / 受害者 / 武器 / 标记"
              @keydown.enter.prevent="runSearch"
            >
            <button type="button" class="mini-button" @click="clearSearch" :disabled="!search">清空</button>
            <select v-model.number="limit" class="limit-select" @change="reloadEntries">
              <option :value="100">100</option>
              <option :value="200">200</option>
              <option :value="500">500</option>
              <option :value="1000">1000</option>
            </select>
            <button type="button" @click="pageNewer" :disabled="offset <= 0">更新的</button>
            <button type="button" @click="pageOlder" :disabled="!hasMoreOlder">更旧的</button>
            <button type="button" @click="reloadEntries">刷新当前页</button>
          </div>

          <div class="meta">
            <span class="meta-chip">文件：{{ selectedDate || "--" }}</span>
            <span class="meta-chip">总行数：{{ formatNumber(total) }}</span>
            <span class="meta-chip">偏移：{{ formatNumber(offset) }}</span>
            <span v-if="meta?.relativePath" class="meta-chip">路径：{{ meta.relativePath }}</span>
            <span v-if="isLiveSelected" class="meta-chip live">实时跟随中</span>
          </div>

          <DataState
            :loading="entriesLoading"
            :error="entriesError"
            :empty="!entriesLoading && !entriesError && entries.length === 0"
            empty-title="没有日志行"
            empty-text="当前文件或搜索条件下没有匹配内容。"
          >
            <div class="table-wrap">
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
                    <td class="type-cell"><span class="type-pill" :class="line.type?.toLowerCase()">{{ line.type || "--" }}</span></td>
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
        </PageCard>
      </div>
    </DataState>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiGet } from "../app/apiClient";
import { renderApiError } from "../app/errors";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
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

watch(
  () => [selectedMonth.value, selectedDate.value, search.value, offset.value, limit.value],
  () => {
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
  await loadFiles();
  selectedDate.value = files.value[0]?.date ?? "";
  await reloadEntries();
}

async function selectDate(date: string) {
  if (!date || date === selectedDate.value) return;
  selectedDate.value = date;
  offset.value = 0;
  await reloadEntries();
}

async function runSearch() {
  offset.value = 0;
  await reloadEntries();
}

async function clearSearch() {
  if (!search.value) return;
  search.value = "";
  offset.value = 0;
  await reloadEntries();
}

async function pageOlder() {
  if (!hasMoreOlder.value) return;
  offset.value += limit.value;
  await reloadEntries();
}

async function pageNewer() {
  if (offset.value <= 0) return;
  offset.value = Math.max(0, offset.value - limit.value);
  await reloadEntries();
}

function renderState() {
  // Vue reactivity handles the actual updates; this keeps the polling helper simple.
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
.page {
  display: grid;
  gap: 14px;
  min-height: 0;
}

.status-card {
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.03)),
    radial-gradient(circle at top right, rgba(96, 165, 250, 0.14), transparent 34%),
    rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.status-compact {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.live-pill,
.meta-chip {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.live-pill.live,
.meta-chip.live {
  border-color: rgba(34, 197, 94, 0.28);
  background: rgba(34, 197, 94, 0.16);
  color: #9af0b1;
}

.refresh-banner {
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(248, 113, 113, 0.25);
  background: rgba(248, 113, 113, 0.08);
  color: #fecaca;
  font-size: 13px;
  line-height: 1.5;
}

.layout {
  display: grid;
  grid-template-columns: 240px 280px minmax(0, 1fr);
  gap: 14px;
  min-height: 0;
}

.side-card,
.viewer-card {
  min-height: 0;
  border-radius: 18px;
}

.section-head,
.toolbar,
.meta {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.section-head {
  justify-content: space-between;
  margin-bottom: 10px;
}

.list {
  display: grid;
  gap: 8px;
  max-height: min(70vh, 760px);
  overflow: auto;
  padding-right: 4px;
}

.list-item {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  padding: 10px 12px;
  text-align: left;
  display: grid;
  gap: 4px;
  transition: transform 0.12s ease, border-color 0.12s ease, background-color 0.12s ease;
}

.list-item:hover {
  transform: translateY(-1px);
  border-color: rgba(96, 165, 250, 0.3);
}

.list-item.active {
  border-color: rgba(96, 165, 250, 0.55);
  background: rgba(96, 165, 250, 0.12);
}

.list-item small,
.muted {
  color: var(--muted);
}

.empty-note {
  color: var(--muted);
  font-size: 13px;
  padding: 12px 0;
}

.toolbar {
  margin-bottom: 12px;
}

.search-input,
.limit-select,
.toolbar button {
  min-height: 34px;
}

.search-input {
  flex: 1 1 280px;
  min-width: 0;
}

.limit-select {
  width: 92px;
}

.meta {
  color: var(--muted);
  font-size: 12px;
  margin-bottom: 10px;
}

.table-wrap {
  min-height: 0;
  overflow: auto;
  max-height: min(72vh, 820px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.02);
}

.log-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.log-table thead th {
  position: sticky;
  top: 0;
  background: rgba(9, 13, 19, 0.94);
  backdrop-filter: blur(8px);
  z-index: 1;
  text-align: left;
  color: var(--muted);
  font-weight: 600;
  border-bottom: 2px solid rgba(255, 255, 255, 0.1);
}

.log-table th,
.log-table td {
  padding: 11px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-table tbody tr:nth-child(2n) {
  background: rgba(255, 255, 255, 0.015);
}

.log-table tbody tr:hover {
  background: rgba(96, 165, 250, 0.08);
}

.time-cell {
  color: var(--muted);
  font-family: var(--font-mono);
}

.type-cell {
  text-align: center;
}

.mark-cell {
  text-align: center;
  color: var(--muted);
}

.damage-cell {
  text-align: center;
  font-weight: 700;
  color: #f87171;
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
  color: var(--muted);
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
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
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

.type-pill.damage {
  background: rgba(59, 130, 246, 0.15);
  color: #93c5fd;
  border: 1px solid rgba(59, 130, 246, 0.15);
}

.type-pill.revive {
  background: rgba(34, 197, 94, 0.15);
  color: #86efac;
  border: 1px solid rgba(34, 197, 94, 0.15);
}

.mini-button {
  min-height: 30px;
  padding: 0 10px;
}

@media (max-width: 1200px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
</style>
