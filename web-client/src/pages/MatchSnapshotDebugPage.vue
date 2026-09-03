<template>
  <AppPage full-bleed class="snapshot-debug-page">
    <!-- Streamlined Single-Row Command Header -->
    <header class="page-cmd-header">
      <div class="header-left">
        <h1 class="page-title">快照录制</h1>
        <div class="kpi-inline-group">
          <span class="kpi-tag cyan">
            <span class="dot"></span>
            总快照 <strong>{{ snapshots.length }}</strong>
          </span>
          <span class="kpi-tag emerald">
            <span class="dot"></span>
            最新 <strong>{{ latestSnapshot ? formatDate(latestSnapshot.createdAt, true) : '-' }}</strong>
          </span>
          <span class="kpi-tag amber">
            <span class="dot"></span>
            Capture Point <strong>{{ selectedSnapshotCaptureZones.length }} 点位</strong>
          </span>
          <span class="kpi-tag purple">
            <span class="dot"></span>
            工件 <strong>{{ selectedSnapshot?.artifacts?.length || 0 }} 项</strong>
          </span>
        </div>
      </div>

      <div class="header-right">
        <button type="button" class="btn-compact ghost" :disabled="loading" @click="loadList">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          {{ loading ? "刷新中..." : "刷新列表" }}
        </button>
      </div>
    </header>

    <!-- Main Split Layout -->
    <AppSplitLayout class="compact-split">
      <template #left>
        <div class="card-panel list-panel">
          <!-- Filter & Search Toolbar -->
          <div class="panel-toolbar">
            <div class="search-input-wrap">
              <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input
                v-model.trim="searchQuery"
                type="search"
                placeholder="搜索快照名称、ID、时间..."
                class="search-field"
              >
            </div>
            <div v-if="selectedIds.length > 0" class="batch-bar">
              <span class="batch-text">已选 <strong>{{ selectedIds.length }}</strong> 项</span>
              <button type="button" class="btn-compact danger" :disabled="busy" @click="batchDelete">批量删除</button>
            </div>
          </div>

          <div class="panel-sub-bar">
            <label class="select-all-label">
              <input
                type="checkbox"
                :checked="selectedIds.length === filteredSnapshotsList.length && filteredSnapshotsList.length > 0"
                @change="toggleSelectAll($event)"
              >
              <span>全选</span>
            </label>
            <span class="count-text">显示 {{ filteredSnapshotsList.length }} / {{ snapshots.length }} 条</span>
          </div>

          <!-- High-Density Snapshot List -->
          <div v-if="loading" class="empty-state">
            <div class="spinner"></div>
            <span>正在加载快照数据...</span>
          </div>
          <div v-else-if="filteredSnapshotsList.length === 0" class="empty-state">
            <span>无匹配快照文件</span>
          </div>
          <div v-else class="snapshot-feed">
            <div
              v-for="snapshot in filteredSnapshotsList"
              :key="snapshot.id"
              class="snapshot-row-card"
              :class="{ active: selectedId === snapshot.id }"
              @click="selectSnapshot(snapshot.id)"
            >
              <div class="row-chk-cell" @click.stop>
                <input type="checkbox" :value="snapshot.id" v-model="selectedIds">
              </div>

              <div class="row-main-cell">
                <div class="row-header">
                  <strong class="snapshot-title" :title="snapshot.name">{{ snapshot.name }}</strong>
                  <button type="button" class="btn-copy-id" title="复制 ID" @click.stop="copyText(snapshot.id)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                  </button>
                  <span class="time-badge font-mono">{{ formatDate(snapshot.createdAt, true) }}</span>
                </div>

                <div class="row-footer">
                  <div class="artifact-pills">
                    <span
                      v-for="artifact in snapshot.artifacts"
                      :key="artifact.format"
                      class="artifact-pill"
                      :data-format="artifact.format"
                      @click.stop="openArtifact(snapshot.id, artifact.format)"
                    >
                      {{ artifact.label }} <em>{{ formatSize(artifact.size) }}</em>
                    </span>
                  </div>

                  <div class="quick-actions" @click.stop>
                    <button type="button" class="btn-action-icon" title="查看图片" @click="openArtifact(snapshot.id, 'image')">📷</button>
                    <button type="button" class="btn-action-icon" title="查看 JSON" @click="openArtifact(snapshot.id, 'json')">📄</button>
                    <button type="button" class="btn-action-icon" title="下载 CSV" @click="downloadArtifact(snapshot.id, 'csv')">📊</button>
                    <button type="button" class="btn-action-icon danger" title="删除快照" :disabled="busy" @click="handleDeleteSnapshot(snapshot)">🗑️</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <template #right>
        <div class="card-panel detail-panel">
          <!-- Tabbed Stage Header -->
          <div class="stage-nav">
            <div class="nav-tabs">
              <button
                type="button"
                class="stage-tab-btn"
                :class="{ active: previewMode === 'image' }"
                @click="previewMode = 'image'"
              >
                📷 战绩图片
              </button>
              <button
                type="button"
                class="stage-tab-btn"
                :class="{ active: previewMode === 'map' }"
                :disabled="!selectedSnapshotCaptureZones.length"
                @click="previewMode = 'map'"
              >
                🚩 Capture Point ({{ selectedSnapshotCaptureZones.length }})
              </button>
              <button
                type="button"
                class="stage-tab-btn"
                :class="{ active: previewMode === 'json' }"
                :disabled="!selectedSnapshot"
                @click="previewMode = 'json'"
              >
                📄 JSON 结构
              </button>
            </div>

            <div class="nav-actions">
              <button
                v-if="selectedImageUrl && previewMode === 'image'"
                type="button"
                class="btn-compact ghost"
                @click="zoomMode = zoomMode === 'fit' ? 'raw' : 'fit'"
              >
                {{ zoomMode === 'fit' ? '1:1 原始' : '适应窗口' }}
              </button>
              <button
                type="button"
                class="btn-compact ghost"
                :disabled="!selectedSnapshot"
                @click="selectedSnapshot && openArtifact(selectedSnapshot.id, previewMode === 'map' || previewMode === 'json' ? 'json' : 'image')"
              >
                新标签页打开
              </button>
            </div>
          </div>

          <!-- Mode 1: Capture Point / Tactical Map Stage -->
          <div v-if="previewMode === 'map'" class="stage-body map-stage">
            <div class="map-toolbar">
              <div class="pill-badge cyan">地图: <strong>{{ selectedSnapshotMapTitle }}</strong></div>
              <div class="pill-badge amber">捕获点: <strong>{{ selectedSnapshotCaptureZones.length }} 个</strong></div>
              <div class="sub-toggle">
                <button type="button" class="btn-sub" :class="{ active: mapSubView === 'overlay' }" @click="mapSubView = 'overlay'">🗺️ 战术地图</button>
                <button type="button" class="btn-sub" :class="{ active: mapSubView === 'list' }" @click="mapSubView = 'list'">📌 坐标列表</button>
              </div>
            </div>

            <div v-if="mapSubView === 'overlay'" class="map-canvas">
              <div v-if="selectedSnapshotMapConfig && selectedSnapshotCaptureZones.length" class="map-inner-stage">
                <img :src="selectedSnapshotMapConfig.image" :alt="selectedSnapshotMapTitle" class="map-bg-img">
                <div class="map-marker-layer">
                  <button
                    v-for="zone in selectedSnapshotCaptureMarkers"
                    :key="`${zone.name}-${zone.mapX}-${zone.mapY}`"
                    type="button"
                    class="radar-marker"
                    :style="{ left: `${zone.mapX}%`, top: `${zone.mapY}%` }"
                    :title="`${zone.name}\n${zone.raw}`"
                  >
                    <span class="marker-pulse"></span>
                    <span class="marker-dot"></span>
                    <span class="marker-title">{{ zone.name }}</span>
                  </button>
                </div>
              </div>
              <div v-else-if="selectedSnapshotJsonLoading" class="empty-state">
                <div class="spinner"></div>
                <span>正在加载战术地图...</span>
              </div>
              <div v-else class="empty-state">未找到对应地图配置图层</div>
            </div>

            <div v-else class="coords-list-wrap">
              <div class="coords-grid">
                <div v-for="zone in selectedSnapshotCaptureZones" :key="`${zone.name}-${zone.position?.x}-${zone.position?.y}`" class="coord-card">
                  <strong class="c-title">{{ zone.name }}</strong>
                  <div class="c-vals font-mono">
                    <span>X: {{ formatCoord(zone.position?.x) }}</span>
                    <span>Y: {{ formatCoord(zone.position?.y) }}</span>
                    <span>Z: {{ formatCoord(zone.position?.z) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Mode 2: JSON Code Viewer -->
          <div v-else-if="previewMode === 'json'" class="stage-body json-stage">
            <div class="json-header font-mono">
              <span>{{ selectedSnapshot?.id }}.json</span>
              <button type="button" class="btn-compact ghost" :disabled="!selectedSnapshotJson" @click="copyText(JSON.stringify(selectedSnapshotJson, null, 2))">
                复制 JSON
              </button>
            </div>
            <div v-if="selectedSnapshotJsonLoading" class="empty-state">
              <div class="spinner"></div>
              <span>正在解包 JSON 数据...</span>
            </div>
            <pre v-else-if="selectedSnapshotJson" class="json-code font-mono"><code>{{ JSON.stringify(selectedSnapshotJson, null, 2) }}</code></pre>
            <div v-else class="empty-state">暂无 JSON 数据</div>
          </div>

          <!-- Mode 3: Image Stage -->
          <div v-else-if="selectedImageUrl" class="stage-body image-stage" :class="zoomMode">
            <img :src="selectedImageUrl" alt="snapshot preview" loading="lazy">
            <div class="image-label-overlay">{{ selectedSnapshot?.name }}</div>
          </div>

          <div v-else class="empty-state">
            <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <span>选择左侧列表条目以预览快照内容</span>
          </div>
        </div>
      </template>
    </AppSplitLayout>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { apiDelete, apiGet } from "../app/apiClient";
import type { BzssCoreCaptureZoneInfo } from "../app/bzssCoreApi";
import AppPage from "../components/common/AppPage.vue";
import AppSplitLayout from "../components/common/AppSplitLayout.vue";
import { TACTICAL_MAP_CONFIGS, resolveTacticalMapKey, type TacticalMapConfig } from "../shared/tactical-map-data";
import { useUiStore } from "../stores/ui.store";

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

interface MatchSnapshotJsonPayload {
  match?: {
    map?: string;
    layer?: string;
  };
  captureZones?: BzssCoreCaptureZoneInfo[];
}

const ui = useUiStore();
const snapshots = ref<MatchSnapshotItem[]>([]);
const loading = ref(true);
const busy = ref(false);
const errorMessage = ref("");
const selectedId = ref("");
const searchQuery = ref("");
const zoomMode = ref<"fit" | "raw">("fit");
const previewMode = ref<"image" | "map" | "json">("image");
const mapSubView = ref<"overlay" | "list">("overlay");
const selectedSnapshotJson = ref<MatchSnapshotJsonPayload | null>(null);
const selectedSnapshotJsonLoading = ref(false);
const selectedIds = ref<string[]>([]);

const sortedSnapshots = computed(() => [...snapshots.value].sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt))));
const snapshotsView = computed(() => sortedSnapshots.value.map(normalizeSnapshotItem));
const filteredSnapshotsList = computed(() => {
  if (!searchQuery.value) return snapshotsView.value;
  const q = searchQuery.value.toLowerCase();
  return snapshotsView.value.filter(item =>
    item.name.toLowerCase().includes(q) ||
    item.id.toLowerCase().includes(q) ||
    formatDate(item.createdAt).toLowerCase().includes(q)
  );
});
const latestSnapshot = computed(() => snapshotsView.value[0] ?? null);
const selectedSnapshot = computed(() => snapshotsView.value.find((item) => item.id === selectedId.value) ?? latestSnapshot.value ?? null);
const selectedImageUrl = computed(() => selectedSnapshot.value ? artifactUrl(selectedSnapshot.value.id, "image") : "");
const selectedSnapshotCaptureZones = computed(() => Array.isArray(selectedSnapshotJson.value?.captureZones) ? selectedSnapshotJson.value?.captureZones : []);
const selectedSnapshotMapKey = computed(() => {
  const payload = selectedSnapshotJson.value;
  return resolveTacticalMapKey(payload?.match?.layer ?? payload?.match?.map ?? "");
});
const selectedSnapshotMapConfig = computed<TacticalMapConfig | null>(() => {
  const key = selectedSnapshotMapKey.value;
  return key ? TACTICAL_MAP_CONFIGS[key] ?? null : null;
});
const selectedSnapshotMapTitle = computed(() => {
  const payload = selectedSnapshotJson.value;
  if (payload?.match?.layer) return payload.match.layer;
  if (payload?.match?.map) return payload.match.map;
  if (selectedSnapshotMapConfig.value?.name) return selectedSnapshotMapConfig.value.name;
  return "未知地图";
});
const selectedSnapshotCaptureMarkers = computed(() => {
  const config = selectedSnapshotMapConfig.value;
  if (!config) return [];
  return selectedSnapshotCaptureZones.value
    .map((zone) => {
      const x = Number(zone?.position?.x);
      const y = Number(zone?.position?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return {
        name: String(zone?.name ?? "").trim(),
        raw: zone?.raw ?? "",
        mapX: projectToPercent(x, config.bounds.minX, config.bounds.maxX),
        mapY: projectToPercent(y, config.bounds.minY, config.bounds.maxY),
      };
    })
    .filter((marker): marker is { name: string; raw: string; mapX: number; mapY: number } => {
      if (!marker) return false;
      return Boolean(marker.name) && Number.isFinite(marker.mapX) && Number.isFinite(marker.mapY);
    });
});

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    ui.pushToast({ title: "已复制", message: "内容已复制到剪贴板", tone: "ok" });
  } catch {
    ui.pushToast({ title: "复制失败", message: "剪贴板权限未获得", tone: "warn" });
  }
}

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
  } catch (error) {
    errorMessage.value = String(error instanceof Error ? error.message : error);
    ui.pushToast({ title: "加载失败", message: errorMessage.value, tone: "error" });
    snapshots.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadSelectedSnapshotJson(id: string) {
  selectedSnapshotJsonLoading.value = true;
  try {
    selectedSnapshotJson.value = await apiGet<MatchSnapshotJsonPayload>(artifactUrl(id, "json"));
  } catch {
    selectedSnapshotJson.value = null;
  } finally {
    selectedSnapshotJsonLoading.value = false;
  }
}

async function handleDeleteSnapshot(snapshot: MatchSnapshotItem) {
  const normalized = normalizeSnapshotItem(snapshot);
  const confirmed = await ui.openConfirm({
    title: "确认删除快照",
    message: `确认删除快照 ${normalized.id} 吗？`,
    confirmText: "确认删除", cancelText: "取消", tone: "warn",
  });
  if (!confirmed) return;

  busy.value = true;
  try {
    await apiDelete<{ ok: boolean }>(`/api/match-snapshot/delete?id=${encodeURIComponent(normalized.id)}`);
    ui.pushToast({ title: "已删除", message: `快照 ${normalized.id} 已删除。`, tone: "ok" });
    selectedIds.value = selectedIds.value.filter((id) => id !== normalized.id);
    if (selectedId.value === normalized.id) selectedId.value = "";
    await loadList();
  } catch (error) {
    ui.pushToast({ title: "删除失败", message: String(error instanceof Error ? error.message : error), tone: "error" });
  } finally {
    busy.value = false;
  }
}

async function batchDelete() {
  if (!selectedIds.value.length) return;
  const confirmed = await ui.openConfirm({
    title: "批量删除",
    message: `确认删除 ${selectedIds.value.length} 条快照吗？`,
    confirmText: "确认删除", cancelText: "取消", tone: "warn",
  });
  if (!confirmed) return;

  busy.value = true;
  try {
    for (const id of selectedIds.value) {
      await apiDelete<{ ok: boolean }>(`/api/match-snapshot/delete?id=${encodeURIComponent(id)}`);
    }
    ui.pushToast({ title: "已删除", message: `共删除 ${selectedIds.value.length} 条快照。`, tone: "ok" });
    selectedIds.value = [];
    selectedId.value = "";
    await loadList();
  } catch (error) {
    ui.pushToast({ title: "删除失败", message: String(error instanceof Error ? error.message : error), tone: "error" });
  } finally {
    busy.value = false;
  }
}

function toggleSelectAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  selectedIds.value = checked ? filteredSnapshotsList.value.map((snapshot) => snapshot.id) : [];
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
        label: "JSON",
        id: item.file || `${id}.json`,
        fileName: item.file || `${id}.json`,
        size: Number(item.size ?? 0),
        createdAt: item.createdAt,
      }];
  return { ...item, id, name: item.name || id, artifacts };
}

function formatDate(value: string, compact = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  if (compact) {
    return date.toLocaleTimeString("zh-CN", { hour12: false });
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatSize(value: number) {
  const size = Number(value ?? 0);
  if (!Number.isFinite(size) || size <= 0) return "0 KB";
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}M`;
  return `${(size / 1024).toFixed(0)}K`;
}

function formatCoord(value: number | null | undefined) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return Math.round(num);
}

function projectToPercent(value: number, min: number, max: number) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max === min) return 0;
  const ratio = ((value - min) / (max - min)) * 100;
  return Math.max(0, Math.min(100, ratio));
}

watch(
  () => selectedSnapshot.value?.id ?? "",
  (id) => {
    if (!id) { selectedSnapshotJson.value = null; return; }
    loadSelectedSnapshotJson(id);
  },
  { immediate: true },
);

onMounted(loadList);
</script>

<style scoped>
.snapshot-debug-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 6px;
}

/* Single-Row Streamlined Command Header */
.page-cmd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.page-title {
  font-size: 14px;
  font-weight: 800;
  color: var(--color-text-primary);
  margin: 0;
  letter-spacing: -0.01em;
}

.kpi-inline-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.kpi-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  color: var(--color-text-secondary);
}

.kpi-tag .dot { width: 6px; height: 6px; border-radius: 50%; }
.kpi-tag.cyan .dot { background: #38bdf8; }
.kpi-tag.emerald .dot { background: #22c55e; }
.kpi-tag.amber .dot { background: #f59e0b; }
.kpi-tag.purple .dot { background: #a78bfa; }
.kpi-tag strong { color: var(--color-text-primary); font-weight: 700; }

.header-right { display: flex; gap: 6px; }

/* Split Layout & Panels */
.compact-split {
  flex: 1;
  min-height: 0;
  grid-template-columns: minmax(320px, 380px) minmax(0, 1fr) !important;
  gap: 6px;
}

.card-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid var(--color-border-soft);
  overflow: hidden;
}

.panel-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border-bottom: 1px solid var(--color-border-soft);
  background: rgba(15, 23, 42, 0.4);
}

.search-input-wrap {
  position: relative;
  flex: 1;
}

.search-icon {
  position: absolute;
  left: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 12px;
  height: 12px;
  color: var(--color-text-muted);
}

.search-field {
  width: 100%;
  height: 24px;
  padding: 0 6px 0 22px;
  border-radius: 4px;
  border: 1px solid var(--color-border-soft);
  background: rgba(15, 23, 42, 0.9);
  color: var(--color-text-primary);
  font-size: 11px;
}

.search-field:focus { outline: none; border-color: #38bdf8; }

.batch-bar {
  display: flex;
  align-items: center;
  gap: 4px;
}

.batch-text { font-size: 10px; color: #fecaca; }

.panel-sub-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 6px;
  background: rgba(0, 0, 0, 0.2);
  font-size: 10px;
  color: var(--color-text-muted);
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
}

.select-all-label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
.select-all-label input { width: 12px; height: 12px; }

/* Snapshot Feed Items */
.snapshot-feed {
  flex: 1;
  overflow-y: auto;
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  scrollbar-gutter: stable;
}

.snapshot-row-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.55);
  border: 1px solid var(--color-border-soft);
  cursor: pointer;
  transition: all 0.15s ease;
}

.snapshot-row-card:hover {
  background: rgba(255, 255, 255, 0.035);
  border-color: rgba(56, 189, 248, 0.3);
}

.snapshot-row-card.active {
  background: rgba(56, 189, 248, 0.08);
  border-color: #38bdf8;
  box-shadow: inset 3px 0 0 #38bdf8, 0 0 10px rgba(56, 189, 248, 0.12);
}

.row-chk-cell {
  display: flex;
  align-items: center;
}

.row-chk-cell input {
  width: 13px;
  height: 13px;
  cursor: pointer;
  accent-color: #38bdf8;
}

.row-main-cell {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.row-header {
  display: flex;
  align-items: center;
  gap: 5px;
}

.snapshot-title {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.btn-copy-id {
  background: transparent;
  border: 0;
  padding: 1px 3px;
  color: var(--color-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  border-radius: 3px;
  transition: color 0.15s ease;
}

.btn-copy-id svg { width: 11px; height: 11px; }
.btn-copy-id:hover { color: #38bdf8; background: rgba(56, 189, 248, 0.12); }

.time-badge {
  font-size: 9.5px;
  color: var(--color-text-muted);
  background: rgba(255, 255, 255, 0.04);
  padding: 1px 4px;
  border-radius: 3px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.row-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.artifact-pills {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-wrap: wrap;
}

.artifact-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 18px;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 9.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.12s ease;
  border: 1px solid transparent;
}

.artifact-pill em {
  font-style: normal;
  font-size: 8.5px;
  opacity: 0.8;
}

.artifact-pill[data-format="json"] { color: #38bdf8; background: rgba(56, 189, 248, 0.1); border-color: rgba(56, 189, 248, 0.25); }
.artifact-pill[data-format="image"] { color: #22c55e; background: rgba(34, 197, 94, 0.1); border-color: rgba(34, 197, 94, 0.25); }
.artifact-pill[data-format="csv"] { color: #a78bfa; background: rgba(167, 139, 250, 0.1); border-color: rgba(167, 139, 250, 0.25); }
.artifact-pill[data-format="markdown"] { color: #f97316; background: rgba(249, 115, 22, 0.1); border-color: rgba(249, 115, 22, 0.25); }

.artifact-pill:hover {
  transform: translateY(-1px);
  filter: brightness(1.25);
}

.quick-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.btn-action-icon {
  width: 20px;
  height: 20px;
  border-radius: 3px;
  border: 0;
  background: transparent;
  font-size: 10.5px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  transition: all 0.12s ease;
}

.btn-action-icon:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.btn-action-icon.danger:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #fecaca;
}

/* Right Detail Stage Panel */
.detail-panel { display: flex; flex-direction: column; }

.stage-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px;
  background: rgba(15, 23, 42, 0.8);
  border-bottom: 1px solid var(--color-border-soft);
}

.nav-tabs { display: flex; gap: 2px; }

.stage-tab-btn {
  padding: 3px 8px;
  border-radius: 4px;
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.stage-tab-btn.active { background: rgba(56, 189, 248, 0.15); color: #38bdf8; }

.nav-actions { display: flex; gap: 4px; }

.stage-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  position: relative;
}

.image-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #060911;
  padding: 6px;
}

.image-stage img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px; }
.image-stage.raw img { max-width: none; max-height: none; }

.image-label-overlay {
  position: absolute; bottom: 6px; left: 6px; padding: 2px 6px; border-radius: 3px;
  background: rgba(0, 0, 0, 0.8); font-size: 10px; color: var(--color-text-secondary);
}

.map-stage { display: flex; flex-direction: column; gap: 6px; padding: 6px; }
.map-toolbar { display: flex; align-items: center; gap: 6px; }
.pill-badge { font-size: 10.5px; padding: 2px 6px; border-radius: 4px; background: rgba(255, 255, 255, 0.04); color: var(--color-text-secondary); }
.pill-badge.cyan { color: #38bdf8; }
.pill-badge.amber { color: #f59e0b; }

.sub-toggle { margin-left: auto; display: flex; gap: 2px; background: rgba(0, 0, 0, 0.3); padding: 2px; border-radius: 4px; }
.btn-sub { padding: 2px 6px; border-radius: 3px; border: 0; background: transparent; color: var(--color-text-muted); font-size: 10px; cursor: pointer; }
.btn-sub.active { background: rgba(56, 189, 248, 0.15); color: #38bdf8; }

.map-canvas { flex: 1; position: relative; border-radius: 4px; overflow: hidden; background: #060a12; border: 1px solid var(--color-border-soft); }
.map-bg-img { width: 100%; height: 100%; object-fit: contain; }
.map-marker-layer { position: absolute; inset: 0; }
.radar-marker { position: absolute; transform: translate(-50%, -50%); border: 0; background: transparent; cursor: pointer; padding: 0; z-index: 2; }
.marker-pulse { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 16px; height: 16px; border-radius: 50%; background: rgba(249, 115, 22, 0.4); animation: pulse-ring 2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite; }

@keyframes pulse-ring { 0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; } 100% { transform: translate(-50%, -50%) scale(2); opacity: 0; } }

.marker-dot { position: relative; display: block; width: 8px; height: 8px; border-radius: 50%; background: #f97316; border: 1.5px solid #0f172a; box-shadow: 0 0 6px #f97316; }
.marker-title { display: inline-block; margin-top: 2px; padding: 1px 4px; border-radius: 3px; background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(249, 115, 22, 0.4); font-size: 9px; font-weight: 700; color: #fff; white-space: nowrap; }

.coords-list-wrap { flex: 1; overflow-y: auto; padding: 6px; background: rgba(0, 0, 0, 0.2); border-radius: 4px; }
.coords-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 4px; }
.coord-card { padding: 4px 6px; border-radius: 4px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.04); display: flex; flex-direction: column; gap: 2px; }
.c-title { font-size: 10px; color: var(--color-text-primary); }
.c-vals { font-size: 9px; color: #38bdf8; display: flex; gap: 4px; }

.json-stage { display: flex; flex-direction: column; background: #060911; }
.json-header { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; background: rgba(15, 23, 42, 0.6); border-bottom: 1px solid var(--color-border-soft); font-size: 10px; color: var(--color-text-muted); }
.json-code { flex: 1; margin: 0; padding: 8px; overflow: auto; font-size: 10px; color: #7dd3fc; }

.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 30px; color: var(--color-text-muted); font-size: 11px; text-align: center; }
.empty-icon { width: 24px; height: 24px; opacity: 0.4; }
.spinner { width: 16px; height: 16px; border: 2px solid rgba(56, 189, 248, 0.2); border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.btn-compact { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 6px; border-radius: 4px; font-size: 10.5px; font-weight: 600; cursor: pointer; border: 1px solid var(--color-border-default); background: rgba(255, 255, 255, 0.04); color: var(--color-text-secondary); }
.btn-compact .icon { width: 12px; height: 12px; }
.btn-compact:hover { border-color: var(--color-border-hover); color: var(--color-text-primary); background: rgba(255, 255, 255, 0.08); }
.btn-compact.danger { border-color: rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.1); color: #fecaca; }
.btn-compact.ghost { background: transparent; border-color: rgba(255, 255, 255, 0.06); }

@media (max-width: 1000px) {
  .compact-split { grid-template-columns: 1fr !important; }
}
</style>
