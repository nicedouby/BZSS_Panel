<template>
  <AppPage full-bleed>
    <AppPageHeader
      title="快照录制"
      subtitle="查看对局结束后自动生成的快照文件，并预览图片、JSON、CSV、Markdown 和捕获点信息。"
      :status-items="headerStatusItems"
    >
      <template #actions>
        <button type="button" class="action-btn ghost" :disabled="loading" @click="loadList">
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          {{ loading ? "刷新中..." : "刷新列表" }}
        </button>
      </template>
    </AppPageHeader>

    <!-- Compact KPI Strip -->
    <div class="kpi-strip">
      <div class="kpi-strip-item">
        <span class="kpi-icon-dot cyan"></span>
        <span class="kpi-strip-label">总快照数量</span>
        <strong class="kpi-strip-val">{{ snapshots.length }}</strong>
      </div>
      <div class="kpi-strip-divider"></div>
      <div class="kpi-strip-item">
        <span class="kpi-icon-dot emerald"></span>
        <span class="kpi-strip-label">最新快照时间</span>
        <strong class="kpi-strip-val date">{{ latestSnapshot ? formatDate(latestSnapshot.createdAt) : '-' }}</strong>
      </div>
      <div class="kpi-strip-divider"></div>
      <div class="kpi-strip-item">
        <span class="kpi-icon-dot amber"></span>
        <span class="kpi-strip-label">Capture Point 覆盖</span>
        <strong class="kpi-strip-val">{{ selectedSnapshotCaptureZones.length }} 点位</strong>
      </div>
      <div class="kpi-strip-divider"></div>
      <div class="kpi-strip-item">
        <span class="kpi-icon-dot purple"></span>
        <span class="kpi-strip-label">当前快照工件</span>
        <strong class="kpi-strip-val">{{ selectedSnapshot?.artifacts?.length || 0 }} 项</strong>
      </div>
    </div>

    <!-- Main Split Layout -->
    <AppSplitLayout class="snapshot-split">
      <template #left>
        <AppCard compact title="历史快照记录" description="选择快照进行深度分析与导出" class="list-card">
          <!-- Toolbar Search & Batch Bar -->
          <div class="list-toolbar">
            <div class="search-box">
              <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input
                v-model.trim="searchQuery"
                type="search"
                placeholder="搜索快照名称、ID 或时间..."
                class="search-input"
              >
            </div>
            <div v-if="selectedIds.length > 0" class="batch-actions-bar">
              <span class="batch-count">已选 <strong>{{ selectedIds.length }}</strong> 项</span>
              <button
                type="button"
                class="action-btn sm danger"
                :disabled="busy"
                @click="batchDelete"
              >
                批量删除
              </button>
            </div>
          </div>

          <!-- List Header Bar -->
          <div class="list-header-row">
            <label class="chk-label">
              <input
                type="checkbox"
                :checked="selectedIds.length === filteredSnapshotsList.length && filteredSnapshotsList.length > 0"
                @change="toggleSelectAll($event)"
              >
              <span>全选</span>
            </label>
            <span class="list-count-desc">共 {{ filteredSnapshotsList.length }} 条记录</span>
          </div>

          <div v-if="loading" class="empty-state">
            <div class="spinner-lg"></div>
            <span>正在加载快照列表...</span>
          </div>
          <div v-else-if="snapshotsView.length === 0" class="empty-state">
            <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
            <span>暂无录制记录</span>
          </div>
          <div v-else-if="filteredSnapshotsList.length === 0" class="empty-state">
            <span>未找到匹配 “{{ searchQuery }}” 的快照</span>
          </div>
          <div v-else class="snapshot-list-container">
            <div
              v-for="snapshot in filteredSnapshotsList"
              :key="snapshot.id"
              class="snapshot-item-row"
              :class="{ selected: selectedId === snapshot.id }"
              @click="selectSnapshot(snapshot.id)"
            >
              <div class="row-left" @click.stop>
                <input type="checkbox" :value="snapshot.id" v-model="selectedIds">
              </div>

              <div class="row-main">
                <div class="row-title-bar">
                  <strong class="snapshot-name" :title="snapshot.name">{{ snapshot.name }}</strong>
                  <button type="button" class="copy-btn" title="复制 ID" @click.stop="copyText(snapshot.id)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                  </button>
                  <span class="snapshot-time-pill">{{ formatDate(snapshot.createdAt) }}</span>
                </div>
                <div class="snapshot-id-text font-mono">{{ snapshot.id }}</div>

                <div class="artifact-list">
                  <span
                    v-for="artifact in snapshot.artifacts"
                    :key="artifact.format"
                    class="artifact-chip"
                    :data-format="artifact.format"
                    @click.stop="openArtifact(snapshot.id, artifact.format)"
                  >
                    {{ artifact.label }} <span class="artifact-size">{{ formatSize(artifact.size) }}</span>
                  </span>
                </div>
              </div>

              <div class="row-actions" @click.stop>
                <button type="button" class="icon-btn" title="查看图片" @click="openArtifact(snapshot.id, 'image')">📷</button>
                <button type="button" class="icon-btn" title="查看 JSON" @click="openArtifact(snapshot.id, 'json')">📄</button>
                <button type="button" class="icon-btn" title="下载 CSV" @click="downloadArtifact(snapshot.id, 'csv')">📊</button>
                <button type="button" class="icon-btn danger" title="删除快照" :disabled="busy" @click="handleDeleteSnapshot(snapshot)">🗑️</button>
              </div>
            </div>
          </div>
        </AppCard>
      </template>

      <template #right>
        <AppCard compact title="预览与工件分析" :description="selectedSnapshot?.name || '未选择快照'" class="preview-card">
          <!-- View Mode & Action Navigation Tabs -->
          <div class="preview-header-nav">
            <div class="preview-tabs">
              <button
                type="button"
                class="tab-btn"
                :class="{ active: previewMode === 'image' }"
                @click="previewMode = 'image'"
              >
                <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                战绩图片
              </button>
              <button
                type="button"
                class="tab-btn"
                :class="{ active: previewMode === 'map' }"
                :disabled="!selectedSnapshotCaptureZones.length"
                @click="previewMode = 'map'"
              >
                <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
                Capture Point ({{ selectedSnapshotCaptureZones.length }})
              </button>
              <button
                type="button"
                class="tab-btn"
                :class="{ active: previewMode === 'json' }"
                :disabled="!selectedSnapshot"
                @click="previewMode = 'json'"
              >
                <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                JSON 结构
              </button>
            </div>

            <div class="preview-quick-actions">
              <button
                v-if="selectedImageUrl && previewMode === 'image'"
                type="button"
                class="action-btn sm ghost"
                @click="zoomMode = zoomMode === 'fit' ? 'raw' : 'fit'"
              >
                {{ zoomMode === 'fit' ? '1:1 原始大小' : '适应窗口' }}
              </button>
              <button
                type="button"
                class="action-btn sm ghost"
                :disabled="!selectedSnapshot"
                @click="selectedSnapshot && openArtifact(selectedSnapshot.id, previewMode === 'map' || previewMode === 'json' ? 'json' : 'image')"
              >
                新标签页打开
              </button>
            </div>
          </div>

          <!-- Mode 1: Capture Point / Tactical Map Preview -->
          <div v-if="previewMode === 'map'" class="map-preview-shell">
            <div class="map-sub-header">
              <div class="meta-pill">
                <span class="meta-label">地图图层:</span>
                <strong>{{ selectedSnapshotMapTitle }}</strong>
              </div>
              <div class="meta-pill cyan">
                <span class="meta-label">捕获点:</span>
                <strong>{{ selectedSnapshotCaptureZones.length }} 个</strong>
              </div>
              <div class="map-view-toggle">
                <button
                  type="button"
                  class="mini-pill-btn"
                  :class="{ active: mapSubView === 'overlay' }"
                  @click="mapSubView = 'overlay'"
                >
                  🗺️ 战术地图
                </button>
                <button
                  type="button"
                  class="mini-pill-btn"
                  :class="{ active: mapSubView === 'list' }"
                  @click="mapSubView = 'list'"
                >
                  📌 坐标列表
                </button>
              </div>
            </div>

            <div v-if="mapSubView === 'overlay'" class="map-stage-container">
              <div v-if="selectedSnapshotMapConfig && selectedSnapshotCaptureZones.length" class="map-preview-stage">
                <img :src="selectedSnapshotMapConfig.image" :alt="selectedSnapshotMapTitle" class="map-preview-image">
                <div class="map-preview-layer">
                  <button
                    v-for="zone in selectedSnapshotCaptureMarkers"
                    :key="`${zone.name}-${zone.mapX}-${zone.mapY}`"
                    type="button"
                    class="map-preview-marker"
                    :style="{ left: `${zone.mapX}%`, top: `${zone.mapY}%` }"
                    :title="`${zone.name}\n${zone.raw}`"
                  >
                    <span class="map-preview-marker-pulse"></span>
                    <span class="map-preview-marker-dot"></span>
                    <span class="map-preview-marker-label">{{ zone.name }}</span>
                  </button>
                </div>
              </div>
              <div v-else-if="selectedSnapshotJsonLoading" class="empty-state">
                <div class="spinner-lg"></div>
                <span>正在加载战术地图...</span>
              </div>
              <div v-else class="empty-state">未能解析对应的战术地图图层。</div>
            </div>

            <div v-else class="capture-zone-grid-wrapper">
              <div class="capture-zone-grid">
                <div
                  v-for="zone in selectedSnapshotCaptureZones"
                  :key="`${zone.name}-${zone.position?.x}-${zone.position?.y}`"
                  class="capture-zone-card-item"
                >
                  <strong class="zone-name">{{ zone.name }}</strong>
                  <div class="capture-zone-coords">
                    <span class="coord-pill">X: {{ formatCoord(zone.position?.x) }}</span>
                    <span class="coord-pill">Y: {{ formatCoord(zone.position?.y) }}</span>
                    <span class="coord-pill">Z: {{ formatCoord(zone.position?.z) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Mode 2: JSON Viewer -->
          <div v-else-if="previewMode === 'json'" class="json-preview-shell">
            <div class="json-toolbar">
              <span class="json-info font-mono">{{ selectedSnapshot?.id }}.json</span>
              <button
                type="button"
                class="action-btn sm ghost"
                :disabled="!selectedSnapshotJson"
                @click="copyText(JSON.stringify(selectedSnapshotJson, null, 2))"
              >
                复制 JSON
              </button>
            </div>
            <div v-if="selectedSnapshotJsonLoading" class="empty-state">
              <div class="spinner-lg"></div>
              <span>正在读取 JSON 文件...</span>
            </div>
            <pre v-else-if="selectedSnapshotJson" class="json-code-block"><code>{{ JSON.stringify(selectedSnapshotJson, null, 2) }}</code></pre>
            <div v-else class="empty-state">暂无可用的 JSON 数据</div>
          </div>

          <!-- Mode 3: Image Preview -->
          <div v-else-if="selectedImageUrl" class="preview-shell" :class="zoomMode">
            <img :src="selectedImageUrl" alt="snapshot preview" loading="lazy">
            <div class="image-overlay-info">
              <span>{{ selectedSnapshot?.name }}</span>
            </div>
          </div>

          <div v-else class="empty-state">
            <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <span>从左侧列表中选择一条快照以预览图片</span>
          </div>
        </AppCard>
      </template>
    </AppSplitLayout>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { apiDelete, apiGet } from "../app/apiClient";
import type { BzssCoreCaptureZoneInfo } from "../app/bzssCoreApi";
import AppCard from "../components/common/AppCard.vue";
import AppPage from "../components/common/AppPage.vue";
import AppPageHeader from "../components/common/AppPageHeader.vue";
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
const lastLoadedAt = ref("");
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

const headerStatusItems = computed(() => {
  const items: Array<{ label: string; tone?: "ok" | "warn" | "error" | "idle" }> = [
    { label: `记录数 ${snapshots.value.length}`, tone: "idle" },
  ];
  if (latestSnapshot.value) {
    items.push({ label: `最新快照 ${formatDate(latestSnapshot.value.createdAt)}`, tone: "ok" });
  }
  if (lastLoadedAt.value) {
    items.push({ label: `刷新于 ${lastLoadedAt.value}`, tone: "idle" });
  }
  if (errorMessage.value) {
    items.push({ label: errorMessage.value, tone: "error" });
  }
  return items;
});

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    ui.pushToast({ title: "已复制", message: "内容已复制到剪贴板", tone: "ok" });
  } catch {
    ui.pushToast({ title: "复制失败", message: "浏览器未提供剪贴板权限", tone: "warn" });
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
    lastLoadedAt.value = new Date().toLocaleString("zh-CN", { hour12: false });
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
    message: `确认删除快照 ${normalized.id} 吗？该操作会删除对应图片和导出文件。`,
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
    selectedIds.value = selectedIds.value.filter((id) => id !== normalized.id);
    if (selectedId.value === normalized.id) selectedId.value = "";
    await loadList();
  } catch (error) {
    errorMessage.value = String(error instanceof Error ? error.message : error);
    ui.pushToast({ title: "删除失败", message: errorMessage.value, tone: "error" });
  } finally {
    busy.value = false;
  }
}

async function batchDelete() {
  if (!selectedIds.value.length) return;
  const confirmed = await ui.openConfirm({
    title: "批量删除快照",
    message: `确认删除 ${selectedIds.value.length} 条快照吗？此操作不可恢复。`,
    confirmText: "确认删除",
    cancelText: "取消",
    tone: "warn",
  });
  if (!confirmed) return;

  busy.value = true;
  errorMessage.value = "";
  try {
    for (const id of selectedIds.value) {
      await apiDelete<{ ok: boolean }>(`/api/match-snapshot/delete?id=${encodeURIComponent(id)}`);
    }
    ui.pushToast({ title: "已删除", message: `共删除 ${selectedIds.value.length} 条快照。`, tone: "ok" });
    selectedIds.value = [];
    selectedId.value = "";
    await loadList();
  } catch (error) {
    errorMessage.value = String(error instanceof Error ? error.message : error);
    ui.pushToast({ title: "删除失败", message: errorMessage.value, tone: "error" });
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
    if (!id) {
      selectedSnapshotJson.value = null;
      return;
    }
    loadSelectedSnapshotJson(id);
  },
  { immediate: true },
);

onMounted(loadList);
</script>

<style scoped>
/* Compact Top KPI Strip */
.kpi-strip {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 18px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(8px);
  margin-bottom: 14px;
}

.kpi-strip-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.kpi-icon-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.kpi-icon-dot.cyan { background: #38bdf8; box-shadow: 0 0 8px #38bdf8; }
.kpi-icon-dot.emerald { background: #22c55e; box-shadow: 0 0 8px #22c55e; }
.kpi-icon-dot.amber { background: #f59e0b; box-shadow: 0 0 8px #f59e0b; }
.kpi-icon-dot.purple { background: #a78bfa; box-shadow: 0 0 8px #a78bfa; }

.kpi-strip-label {
  color: var(--color-text-muted);
}

.kpi-strip-val {
  color: var(--color-text-primary);
  font-weight: 700;
}

.kpi-strip-val.date {
  font-size: 11px;
}

.kpi-strip-divider {
  width: 1px;
  height: 16px;
  background: rgba(255, 255, 255, 0.08);
}

.snapshot-split {
  grid-template-columns: minmax(0, 1.25fr) minmax(400px, 1fr) !important;
  gap: 14px;
}

.list-card,
.preview-card {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.search-box {
  position: relative;
  flex: 1;
}

.search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  color: var(--color-text-muted);
  pointer-events: none;
}

.search-input {
  width: 100%;
  height: 32px;
  padding: 0 12px 0 30px;
  border-radius: 7px;
  border: 1px solid var(--color-border-soft);
  background: rgba(15, 23, 42, 0.8);
  color: var(--color-text-primary);
  font-size: 12px;
}

.search-input:focus {
  outline: none;
  border-color: rgba(56, 189, 248, 0.4);
}

.batch-actions-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.25);
}

.batch-count {
  font-size: 11px;
  color: #fecaca;
}

.list-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  background: rgba(15, 23, 42, 0.5);
  border-radius: 6px;
  margin-bottom: 8px;
  font-size: 11px;
  color: var(--color-text-muted);
}

.chk-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.snapshot-list-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1 1 auto;
  min-height: 420px;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

/* Row Item Cards */
.snapshot-item-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.5);
  border: 1px solid var(--color-border-soft);
  cursor: pointer;
  transition: all 0.15s ease;
}

.snapshot-item-row:hover {
  border-color: var(--color-border-hover);
  background: rgba(255, 255, 255, 0.03);
}

.snapshot-item-row.selected {
  border-color: rgba(56, 189, 248, 0.4);
  background: rgba(56, 189, 248, 0.06);
  box-shadow: inset 3px 0 0 #38bdf8;
}

.row-left {
  padding-top: 2px;
}

.row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.row-title-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.snapshot-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.copy-btn {
  background: transparent;
  border: 0;
  color: var(--color-text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  padding: 2px;
}

.copy-btn svg { width: 12px; height: 12px; }
.copy-btn:hover { color: #38bdf8; }

.snapshot-time-pill {
  margin-left: auto;
  font-size: 11px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.snapshot-id-text {
  font-size: 10px;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artifact-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}

.artifact-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 6px;
  border-radius: 5px;
  border: 1px solid var(--color-border-soft);
  color: var(--color-text-secondary);
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
}

.artifact-chip[data-format="json"] { border-color: rgba(56, 189, 248, 0.3); color: #38bdf8; background: rgba(56, 189, 248, 0.08); }
.artifact-chip[data-format="image"] { border-color: rgba(34, 197, 94, 0.3); color: #22c55e; background: rgba(34, 197, 94, 0.08); }
.artifact-chip[data-format="csv"] { border-color: rgba(167, 139, 250, 0.3); color: #a78bfa; background: rgba(167, 139, 250, 0.08); }
.artifact-chip[data-format="markdown"] { border-color: rgba(249, 115, 22, 0.3); color: #f97316; background: rgba(249, 115, 22, 0.08); }

.row-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.icon-btn {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.03);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-btn:hover { background: rgba(255, 255, 255, 0.1); }
.icon-btn.danger:hover { background: rgba(239, 68, 68, 0.2); }

/* Preview Card */
.preview-header-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--color-border-soft);
  flex-wrap: wrap;
}

.preview-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(15, 23, 42, 0.7);
  padding: 3px;
  border-radius: 8px;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.tab-btn .tab-icon { width: 14px; height: 14px; }
.tab-btn.active { background: rgba(56, 189, 248, 0.15); color: #38bdf8; }

.preview-quick-actions { display: flex; gap: 6px; }

.preview-shell {
  flex: 1;
  min-height: 420px;
  overflow: auto;
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  background: #090d16;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-shell img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
}

.preview-shell.raw img { max-width: none; max-height: none; }

.image-overlay-info {
  position: absolute;
  bottom: 8px;
  left: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(15, 23, 42, 0.85);
  font-size: 11px;
  color: var(--color-text-secondary);
}

.map-preview-shell {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 420px;
}

.map-sub-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.meta-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid var(--color-border-soft);
  font-size: 11px;
  color: var(--color-text-secondary);
}

.meta-pill.cyan { color: #38bdf8; border-color: rgba(56, 189, 248, 0.3); }

.map-view-toggle {
  margin-left: auto;
  display: flex;
  gap: 4px;
  background: rgba(15, 23, 42, 0.6);
  padding: 2px;
  border-radius: 6px;
}

.mini-pill-btn {
  padding: 3px 8px;
  border-radius: 4px;
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 11px;
  cursor: pointer;
}

.mini-pill-btn.active { background: rgba(56, 189, 248, 0.15); color: #38bdf8; }

.map-stage-container {
  position: relative;
  flex: 1;
  min-height: 360px;
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  overflow: hidden;
  background: #080c14;
}

.map-preview-image { width: 100%; height: 100%; object-fit: contain; }
.map-preview-layer { position: absolute; inset: 0; }
.map-preview-marker { position: absolute; transform: translate(-50%, -50%); border: 0; background: transparent; cursor: pointer; padding: 0; z-index: 2; }

.map-preview-marker-pulse {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: 20px; height: 20px; border-radius: 50%; background: rgba(249, 115, 22, 0.4);
  animation: pulse-ring 2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
}

@keyframes pulse-ring {
  0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
}

.map-preview-marker-dot {
  position: relative; display: block; width: 10px; height: 10px; border-radius: 50%;
  background: #f97316; border: 2px solid #0f172a; box-shadow: 0 0 8px #f97316;
}

.map-preview-marker-label {
  display: inline-block; margin-top: 3px; padding: 1px 5px; border-radius: 4px;
  background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(249, 115, 22, 0.4);
  font-size: 10px; font-weight: 700; color: #fff; white-space: nowrap;
}

.capture-zone-grid-wrapper {
  flex: 1;
  overflow-y: auto;
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  padding: 10px;
  background: rgba(15, 23, 42, 0.4);
}

.capture-zone-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}

.capture-zone-card-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.zone-name { font-size: 11px; color: var(--color-text-primary); }
.capture-zone-coords { display: flex; gap: 4px; }
.coord-pill { font-size: 10px; font-family: monospace; padding: 1px 4px; border-radius: 3px; background: rgba(56, 189, 248, 0.1); color: #38bdf8; }

.json-preview-shell {
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  background: #090d16;
  overflow: hidden;
  min-height: 420px;
}

.json-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: rgba(15, 23, 42, 0.8);
  border-bottom: 1px solid var(--color-border-soft);
}

.json-code-block {
  flex: 1;
  margin: 0;
  padding: 12px;
  overflow: auto;
  font-family: monospace;
  font-size: 11px;
  color: #7dd3fc;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px 16px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 12px;
}

.empty-icon { width: 32px; height: 32px; opacity: 0.4; }
.spinner-lg { width: 22px; height: 22px; border: 2px solid rgba(56, 189, 248, 0.2); border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.action-btn {
  display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 4px 10px;
  border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;
  border: 1px solid var(--color-border-default); background: rgba(255, 255, 255, 0.04); color: var(--color-text-secondary);
}

.btn-icon { width: 14px; height: 14px; }
.action-btn:hover { border-color: var(--color-border-hover); color: var(--color-text-primary); background: rgba(255, 255, 255, 0.08); }
.action-btn.danger { border-color: rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.08); color: #fecaca; }
.action-btn.danger:hover { background: rgba(239, 68, 68, 0.18); color: #fff; }
.action-btn.ghost { background: rgba(255, 255, 255, 0.02); }
.action-btn.sm { min-height: 24px; padding: 2px 6px; font-size: 11px; }

@media (max-width: 1100px) {
  .snapshot-split { grid-template-columns: 1fr !important; }
}
</style>


