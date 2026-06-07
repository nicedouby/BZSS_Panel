<template>
  <AppPage full-bleed>
    <AppPageHeader
      title="快照录制"
      subtitle="录制对局状态玩家列表，并输出图片、JSON、CSV 和 Markdown 文件。"
      :status-items="headerStatusItems"
    >
      <template #actions>
        <button type="button" class="action-btn ghost" @click="loadList" :disabled="loading">
          {{ loading ? "刷新中..." : "刷新列表" }}
        </button>
        <button type="button" class="action-btn primary" @click="handleManualSnapshot" :disabled="busy">
          {{ busy ? "录制中..." : "手动录制" }}
        </button>
      </template>
    </AppPageHeader>

    <AppPageToolbar>
      <div class="toolbar-options">
        <label class="option-toggle">
          <input v-model="includeSteamID" type="checkbox">
          <span>输出 SteamID</span>
        </label>
      </div>
    </AppPageToolbar>

    <AppSplitLayout class="snapshot-split">
      <template #left>
        <AppCard compact title="历史快照记录" description="查看自动或手动生成的对局状态快照，提供图片预览和文件下载。">
          <div v-if="loading" class="empty-state">正在加载快照列表...</div>
          <div v-else-if="snapshots.length === 0" class="empty-state">暂无录制记录</div>
          <AppTable v-else compact>
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
                <td class="col-name">
                  <strong class="snapshot-name">{{ snapshot.name }}</strong>
                  <div class="snapshot-file">{{ snapshot.id }}</div>
                </td>
                <td class="col-time">{{ formatDate(snapshot.createdAt) }}</td>
                <td class="col-artifacts">
                  <div class="artifact-list">
                    <span
                      v-for="artifact in snapshot.artifacts"
                      :key="artifact.format"
                      class="artifact-chip"
                      :data-format="artifact.format"
                    >
                      {{ artifact.label }} <span class="artifact-size">{{ formatSize(artifact.size) }}</span>
                    </span>
                  </div>
                </td>
                <td class="col-actions">
                  <div class="action-group" @click.stop>
                    <button type="button" class="action-btn sm" @click="openArtifact(snapshot.id, 'image')">图片</button>
                    <button type="button" class="action-btn sm" @click="openArtifact(snapshot.id, 'json')">JSON</button>
                    <button type="button" class="action-btn sm" @click="downloadArtifact(snapshot.id, 'csv')">CSV</button>
                    <button type="button" class="action-btn sm" @click="downloadArtifact(snapshot.id, 'markdown')">MD</button>
                    <button type="button" class="action-btn sm danger" :disabled="busy" @click="handleDeleteSnapshot(snapshot)">删除</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </AppTable>
        </AppCard>
      </template>

      <template #right>
        <AppCard compact title="图片预览" :description="selectedSnapshot?.name || '未选择'">
          <div class="preview-toolbar">
            <button
              v-if="selectedImageUrl"
              type="button"
              class="action-btn sm"
              @click="zoomMode = zoomMode === 'fit' ? 'raw' : 'fit'"
            >
              {{ zoomMode === 'fit' ? '原始大小' : '适应宽度' }}
            </button>
            <button
              type="button"
              class="action-btn sm"
              :disabled="!selectedSnapshot"
              @click="selectedSnapshot && openArtifact(selectedSnapshot.id, 'image')"
            >
              在新标签页打开
            </button>
          </div>

          <div v-if="selectedImageUrl" class="preview-shell">
            <img
              :src="selectedImageUrl"
              :class="zoomMode === 'fit' ? 'zoom-fit' : 'zoom-raw'"
              alt="对局状态玩家列表快照图片"
            >
          </div>
          <div v-else class="empty-state">选择一条快照后预览图片。</div>
        </AppCard>
      </template>
    </AppSplitLayout>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { apiDelete, apiGet, apiPost } from "../app/apiClient";
import { useUiStore } from "../stores/ui.store";
import AppPage from "../components/common/AppPage.vue";
import AppPageHeader from "../components/common/AppPageHeader.vue";
import AppPageToolbar from "../components/common/AppPageToolbar.vue";
import AppCard from "../components/common/AppCard.vue";
import AppTable from "../components/common/AppTable.vue";
import AppSplitLayout from "../components/common/AppSplitLayout.vue";

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
const zoomMode = ref<"fit" | "raw">("fit");

const sortedSnapshots = computed(() => [...snapshots.value].sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt))));
const snapshotsView = computed(() => sortedSnapshots.value.map(normalizeSnapshotItem));
const latestSnapshot = computed(() => snapshotsView.value[0] ?? null);
const selectedSnapshot = computed(() => snapshotsView.value.find((item) => item.id === selectedId.value) ?? latestSnapshot.value ?? null);
const selectedImageUrl = computed(() => selectedSnapshot.value ? artifactUrl(selectedSnapshot.value.id, "image") : "");

const headerStatusItems = computed(() => {
  const items: Array<{ label: string; tone?: "ok" | "warn" | "error" | "idle" }> = [
    { label: `记录数: ${snapshots.value.length}`, tone: "idle" },
  ];
  if (latestSnapshot.value) {
    items.push({
      label: `最新快照: ${formatDate(latestSnapshot.value.createdAt)}`,
      tone: "ok",
    });
  }
  if (lastLoadedAt.value) {
    items.push({
      label: `刷新于: ${lastLoadedAt.value}`,
      tone: "idle",
    });
  }
  if (errorMessage.value) {
    items.push({
      label: errorMessage.value,
      tone: "error",
    });
  }
  return items;
});

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

async function handleDeleteSnapshot(snapshot: MatchSnapshotItem) {
  const normalized = normalizeSnapshotItem(snapshot);

  const confirmed = await ui.openConfirm({
    title: "确认删除快照",
    message: `确认删除快照 ${normalized.id} 吗？该操作会删除对应的图片和导出文件。`,
    confirmText: "确认删除",
    cancelText: "取消",
    tone: "warn",
  });
  if (!confirmed) return;

  busy.value = true;
  errorMessage.value = "";
  try {
    await apiDelete<{ ok: boolean; snapshot?: { id?: string } }>(`/api/match-snapshot/delete?id=${encodeURIComponent(normalized.id)}`);
    ui.pushToast({ title: "已删除", message: `快照 ${normalized.id} 已删除。`, tone: "ok" });
    if (selectedId.value === normalized.id) selectedId.value = "";
    await loadList();
  } catch (error) {
    errorMessage.value = String(error instanceof Error ? error.message : error);
    ui.pushToast({ title: "删除失败", message: errorMessage.value, tone: "error" });
  } finally {
    busy.value = false;
  }
}

function selectSnapshot(id: string) {
  selectedId.value = id;
  zoomMode.value = "fit";
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
.snapshot-split {
  grid-template-columns: minmax(0, 1.25fr) minmax(400px, 1fr) !important;
}

.toolbar-options {
  display: flex;
  align-items: center;
  gap: 12px;
}

.option-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.option-toggle:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--color-border-hover);
  color: var(--color-text-primary);
}

.option-toggle input[type="checkbox"] {
  margin: 0;
  accent-color: var(--color-status-info);
  cursor: pointer;
}

.empty-state {
  padding: 24px 16px;
  text-align: center;
  color: var(--color-text-muted);
}

.snapshot-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.snapshot-file {
  margin-top: 4px;
  font-size: 11px;
  color: var(--color-text-muted);
  word-break: break-all;
}

.col-time {
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  color: var(--color-text-secondary);
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
  gap: 4px;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--color-border-soft);
  color: var(--color-text-secondary);
  font-size: 11px;
  white-space: nowrap;
  font-weight: 500;
  background: rgba(255, 255, 255, 0.02);
}

.artifact-size {
  opacity: 0.7;
  font-size: 10px;
}

.artifact-chip[data-format="json"] {
  border-color: rgba(56, 189, 248, 0.24);
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.04);
}

.artifact-chip[data-format="image"] {
  border-color: rgba(34, 197, 94, 0.24);
  color: #22c55e;
  background: rgba(34, 197, 94, 0.04);
}

.artifact-chip[data-format="csv"] {
  border-color: rgba(167, 139, 250, 0.24);
  color: #a78bfa;
  background: rgba(167, 139, 250, 0.04);
}

.artifact-chip[data-format="markdown"] {
  border-color: rgba(249, 115, 22, 0.24);
  color: #f97316;
  background: rgba(249, 115, 22, 0.04);
}

.preview-card {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.preview-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.preview-shell {
  flex: 1;
  overflow: auto;
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  background: #0b1220;
  scrollbar-gutter: stable;
  position: relative;
  min-height: 350px;
}

.preview-shell img {
  display: block;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.preview-shell img.zoom-fit {
  width: 100%;
  max-width: 100%;
  height: auto;
}

.preview-shell img.zoom-raw {
  width: auto;
  min-width: 2200px;
  max-width: none;
  height: auto;
}

.action-btn {
  min-height: 32px;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary);
  transition: all 0.15s ease;
}

.action-btn:hover:not(:disabled) {
  border-color: var(--color-border-hover);
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.08);
}

.action-btn.primary {
  background: var(--color-status-info);
  border-color: var(--color-status-info);
  color: #fff;
}

.action-btn.primary:hover:not(:disabled) {
  background: #3b82f6;
  border-color: #3b82f6;
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.35);
}

.action-btn.danger {
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.08);
  color: #fecaca;
}

.action-btn.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.16);
  border-color: rgba(239, 68, 68, 0.5);
  color: #fff;
}

.action-btn.ghost {
  background: rgba(255, 255, 255, 0.02);
}

.action-btn.sm {
  min-height: 26px;
  padding: 4px 8px;
  font-size: 11px;
  border-radius: 6px;
}

.action-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

:deep(.app-table tbody tr.selected td) {
  background: rgba(56, 189, 248, 0.08);
  border-bottom-color: rgba(56, 189, 248, 0.2);
}

@media (max-width: 1100px) {
  .snapshot-split {
    grid-template-columns: minmax(0, 1fr) !important;
  }
}
</style>
