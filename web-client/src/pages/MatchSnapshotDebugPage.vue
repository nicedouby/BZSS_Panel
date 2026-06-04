<template>
  <section class="page">
    <PageHeader title="快照录制" subtitle="录制对局状态玩家列表，并输出图片、JSON、CSV 和 Markdown 文件。">
      <template #actions>
        <button type="button" class="action-btn ghost" @click="loadList" :disabled="loading">
          {{ loading ? "刷新中..." : "刷新列表" }}
        </button>
        <button type="button" class="action-btn primary" @click="handleManualSnapshot" :disabled="busy">
          {{ busy ? "录制中..." : "手动录制" }}
        </button>
      </template>
    </PageHeader>

    <div class="summary-row">
      <div class="summary-pill">记录 {{ snapshots.length }}</div>
      <div class="summary-pill" v-if="latestSnapshot">最新 {{ formatDate(latestSnapshot.createdAt) }}</div>
      <div class="summary-pill" v-if="lastLoadedAt">刷新 {{ lastLoadedAt }}</div>
      <div class="summary-pill tone-warn" v-if="errorMessage">{{ errorMessage }}</div>
    </div>

    <div class="option-row">
      <label class="option-toggle">
        <input v-model="includeSteamID" type="checkbox">
        <span>输出 SteamID</span>
      </label>
    </div>

    <div class="snapshot-layout">
      <PageCard compact class="list-card">
        <div v-if="loading" class="empty-state">正在加载快照列表...</div>
        <div v-else-if="snapshots.length === 0" class="empty-state">暂无录制记录</div>
        <div v-else class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>录制时间</th>
                <th>文件</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="snapshot in snapshotsView"
                :key="snapshot.id"
                :class="{ selected: selectedId === snapshot.id }"
                @click="selectSnapshot(snapshot.id)"
              >
                <td>
                  <strong>{{ snapshot.name }}</strong>
                  <div class="snapshot-file">{{ snapshot.id }}</div>
                </td>
                <td>{{ formatDate(snapshot.createdAt) }}</td>
                <td>
                  <div class="artifact-list">
                    <span v-for="artifact in snapshot.artifacts" :key="artifact.format" class="artifact-chip">
                      {{ artifact.label }} {{ formatSize(artifact.size) }}
                    </span>
                  </div>
                </td>
                <td>
                  <div class="action-group" @click.stop>
                    <button type="button" class="action-btn sm" @click="openArtifact(snapshot.id, 'image')">图片</button>
                    <button type="button" class="action-btn sm" @click="openArtifact(snapshot.id, 'json')">JSON</button>
                    <button type="button" class="action-btn sm" @click="downloadArtifact(snapshot.id, 'csv')">CSV</button>
                    <button type="button" class="action-btn sm" @click="downloadArtifact(snapshot.id, 'markdown')">MD</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </PageCard>

      <PageCard compact class="preview-card">
        <div class="preview-header">
          <div>
            <strong>图片预览</strong>
            <span>{{ selectedSnapshot?.name || "未选择" }}</span>
          </div>
          <button
            type="button"
            class="action-btn sm"
            :disabled="!selectedSnapshot"
            @click="selectedSnapshot && openArtifact(selectedSnapshot.id, 'image')"
          >
            打开图片
          </button>
        </div>
        <div v-if="selectedImageUrl" class="preview-shell">
          <img :src="selectedImageUrl" alt="对局状态玩家列表快照图片">
        </div>
        <div v-else class="empty-state">选择一条快照后预览图片。</div>
      </PageCard>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { apiGet, apiPost } from "../app/apiClient";
import { useUiStore } from "../stores/ui.store";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";

interface MatchSnapshotArtifact {
  format: "json" | "image" | "csv" | "markdown" | string;
  label: string;
  id: string;
  fileName: string;
  size: number;
  createdAt: string;
}

interface MatchSnapshotItem {
  id: string;
  name: string;
  createdAt: string;
  size: number;
  totalSize?: number;
  file?: string;
  artifacts?: MatchSnapshotArtifact[];
}

const ui = useUiStore();
const snapshots = ref<MatchSnapshotItem[]>([]);
const loading = ref(true);
const busy = ref(false);
const errorMessage = ref("");
const lastLoadedAt = ref("");
const selectedId = ref("");
const includeSteamID = ref(true);

const sortedSnapshots = computed(() => [...snapshots.value].sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt))));
const snapshotsView = computed(() => sortedSnapshots.value.map(normalizeSnapshotItem));
const latestSnapshot = computed(() => snapshotsView.value[0] ?? null);
const selectedSnapshot = computed(() => snapshotsView.value.find((item) => item.id === selectedId.value) ?? latestSnapshot.value ?? null);
const selectedImageUrl = computed(() => selectedSnapshot.value ? artifactUrl(selectedSnapshot.value.id, "image") : "");

async function loadList() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const response = await apiGet<MatchSnapshotItem[] | { ok?: boolean; data?: MatchSnapshotItem[] }>("/api/match-snapshot/list");
    const list = Array.isArray(response)
      ? response
      : Array.isArray((response as { data?: MatchSnapshotItem[] } | null | undefined)?.data)
        ? (response as { data?: MatchSnapshotItem[] }).data ?? []
        : [];
    snapshots.value = list;
    if (!selectedId.value && list.length) selectedId.value = normalizeSnapshotItem(list[0]).id;
    if (selectedId.value && !list.some((item) => normalizeSnapshotItem(item).id === selectedId.value)) {
      selectedId.value = list.length ? normalizeSnapshotItem(list[0]).id : "";
    }
    lastLoadedAt.value = new Date().toLocaleString("zh-CN", { hour12: false });
  } catch (error) {
    errorMessage.value = String(error instanceof Error ? error.message : error);
    ui.pushToast({ title: "加载失败", message: errorMessage.value, tone: "error" });
    snapshots.value = [];
  } finally {
    loading.value = false;
  }
}

async function handleManualSnapshot() {
  busy.value = true;
  errorMessage.value = "";
  try {
    const response = await apiPost<{ snapshot?: MatchSnapshotItem }>("/api/match-snapshot/capture", {
      includeSteamID: includeSteamID.value,
      includeEOSID: false,
    });
    const nextId = response?.snapshot ? normalizeSnapshotItem(response.snapshot).id : "";
    ui.pushToast({ title: "已录制", message: "快照已输出为图片和文件。", tone: "ok" });
    await loadList();
    if (nextId) selectedId.value = nextId;
  } catch (error) {
    errorMessage.value = String(error instanceof Error ? error.message : error);
    ui.pushToast({ title: "录制失败", message: errorMessage.value, tone: "error" });
  } finally {
    busy.value = false;
  }
}

function selectSnapshot(id: string) {
  selectedId.value = id;
}

function openArtifact(id: string, format: string) {
  window.open(artifactUrl(id, format), "_blank", "noopener,noreferrer");
}

function downloadArtifact(id: string, format: string) {
  window.open(`${artifactUrl(id, format)}&download=1`, "_blank", "noopener,noreferrer");
}

function artifactUrl(id: string, format: string) {
  return `/api/match-snapshot/view?id=${encodeURIComponent(id)}&format=${encodeURIComponent(format)}`;
}

function normalizeSnapshotItem(item: MatchSnapshotItem): MatchSnapshotItem & { artifacts: MatchSnapshotArtifact[] } {
  const id = String(item.id || item.name || item.file || "").replace(/\.(json|png|svg|csv|md)$/i, "");
  const artifacts = Array.isArray(item.artifacts) && item.artifacts.length
    ? item.artifacts
    : [{
        format: "json",
        label: "JSON 数据",
        id: item.file || `${id}.json`,
        fileName: item.file || `${id}.json`,
        size: Number(item.size ?? 0),
        createdAt: item.createdAt,
      }];
  return {
    ...item,
    id,
    name: item.name || id,
    artifacts,
  };
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatSize(value: number) {
  const size = Number(value ?? 0);
  if (!Number.isFinite(size) || size <= 0) return "0 KB";
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`;
  return `${(size / 1024).toFixed(1)} KB`;
}

onMounted(loadList);
</script>

<style scoped>
.page {
  display: grid;
  gap: var(--spacing-lg);
  padding: var(--spacing-lg);
}

.summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.option-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.option-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary);
  font-size: 12px;
}

.option-toggle input {
  margin: 0;
}

.summary-pill {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary);
  font-size: 12px;
}

.summary-pill.tone-warn {
  border-color: rgba(245, 158, 11, 0.24);
  color: var(--color-status-warning);
  background: rgba(245, 158, 11, 0.08);
}

.snapshot-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(360px, 0.9fr);
  gap: var(--spacing-lg);
  align-items: start;
}

.table-container {
  overflow-x: auto;
}

.empty-state {
  padding: 24px 16px;
  text-align: center;
  color: var(--color-text-muted);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th,
.data-table td {
  padding: var(--spacing-md);
  text-align: left;
  border-bottom: 1px solid var(--color-border-soft);
  vertical-align: top;
}

.data-table th {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
}

.data-table tbody tr {
  cursor: pointer;
}

.data-table tbody tr.selected {
  background: rgba(56, 189, 248, 0.08);
}

.snapshot-file {
  margin-top: 4px;
  font-size: 11px;
  color: var(--color-text-muted);
  word-break: break-all;
}

.artifact-list,
.action-group {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.artifact-chip {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--color-border-soft);
  color: var(--color-text-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.preview-header div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.preview-header span {
  color: var(--color-text-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-shell {
  max-height: 70vh;
  overflow: auto;
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  background: #0f172a;
}

.preview-shell img {
  display: block;
  width: 100%;
  min-width: 720px;
  height: auto;
}

.action-btn {
  min-height: 32px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
}

.action-btn.primary {
  background: var(--color-status-info);
  border-color: var(--color-status-info);
  color: #fff;
}

.action-btn.ghost {
  background: rgba(255, 255, 255, 0.03);
}

.action-btn.sm {
  min-height: 26px;
  padding: 4px 8px;
  font-size: 11px;
}

.action-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

@media (max-width: 1100px) {
  .snapshot-layout {
    grid-template-columns: 1fr;
  }
}
</style>
