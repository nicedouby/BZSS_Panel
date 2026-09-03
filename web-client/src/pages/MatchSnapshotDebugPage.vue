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

    <!-- Top KPI Summary Bar -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-icon-box cyan">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
        </div>
        <div class="kpi-content">
          <span class="kpi-label">总快照数量</span>
          <strong class="kpi-value">{{ snapshots.length }}</strong>
          <small class="kpi-sub">自动与调试录制文件</small>
        </div>
      </div>

      <div class="kpi-card">
        <div class="kpi-icon-box emerald">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        </div>
        <div class="kpi-content">
          <span class="kpi-label">最新录制时间</span>
          <strong class="kpi-value date-text">{{ latestSnapshot ? formatDate(latestSnapshot.createdAt) : '-' }}</strong>
          <small class="kpi-sub">{{ latestSnapshot ? latestSnapshot.name : '暂无数据' }}</small>
        </div>
      </div>

      <div class="kpi-card">
        <div class="kpi-icon-box amber">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
        </div>
        <div class="kpi-content">
          <span class="kpi-label">Capture Point 覆盖</span>
          <strong class="kpi-value">{{ selectedSnapshotCaptureZones.length }} <span class="unit">个</span></strong>
          <small class="kpi-sub">{{ selectedSnapshotMapTitle }}</small>
        </div>
      </div>

      <div class="kpi-card">
        <div class="kpi-icon-box purple">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
        </div>
        <div class="kpi-content">
          <span class="kpi-label">工件种类</span>
          <strong class="kpi-value">{{ selectedSnapshot?.artifacts?.length || 0 }} <span class="unit">项</span></strong>
          <small class="kpi-sub">JSON / Image / CSV / MD</small>
        </div>
      </div>
    </div>

    <!-- Main Split Layout -->
    <AppSplitLayout class="snapshot-split">
      <template #left>
        <AppCard compact title="历史快照记录" description="选择快照进行深度分析与导出" class="list-card">
          <!-- Filter Search & Batch Bar -->
          <div class="list-toolbar">
            <div class="search-box">
              <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input
                v-model.trim="searchQuery"
                type="search"
                placeholder="搜索快照名称、工件 ID 或时间..."
                class="search-input"
              >
            </div>
            <div v-if="selectedIds.length > 0" class="batch-actions-bar">
              <span class="batch-count">已选择 <strong>{{ selectedIds.length }}</strong> 项</span>
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
            <AppTable compact class="custom-snapshot-table">
              <thead>
                <tr>
                  <th class="col-chk">
                    <input
                      type="checkbox"
                      :checked="selectedIds.length === filteredSnapshotsList.length && filteredSnapshotsList.length > 0"
                      @change="toggleSelectAll($event)"
                    >
                  </th>
                  <th>快照名称</th>
                  <th>录制时间</th>
                  <th>工件列表</th>
                  <th class="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="snapshot in filteredSnapshotsList"
                  :key="snapshot.id"
                  :class="{ selected: selectedId === snapshot.id }"
                  @click="selectSnapshot(snapshot.id)"
                >
                  <td class="col-chk" @click.stop>
                    <input type="checkbox" :value="snapshot.id" v-model="selectedIds">
                  </td>
                  <td class="col-name">
                    <div class="name-row">
                      <strong class="snapshot-name" :title="snapshot.name">{{ snapshot.name }}</strong>
                      <button type="button" class="copy-btn" title="复制 ID" @click.stop="copyText(snapshot.id)">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                      </button>
                    </div>
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
                        @click.stop="openArtifact(snapshot.id, artifact.format)"
                      >
                        {{ artifact.label }}
                        <span class="artifact-size">{{ formatSize(artifact.size) }}</span>
                      </span>
                    </div>
                  </td>
                  <td class="col-actions text-right" @click.stop>
                    <div class="action-dropdown-group">
                      <button type="button" class="icon-btn" title="查看图片" @click="openArtifact(snapshot.id, 'image')">📷</button>
                      <button type="button" class="icon-btn" title="查看 JSON" @click="openArtifact(snapshot.id, 'json')">📄</button>
                      <button type="button" class="icon-btn" title="下载 CSV" @click="downloadArtifact(snapshot.id, 'csv')">📊</button>
                      <button type="button" class="icon-btn danger" title="删除" :disabled="busy" @click="handleDeleteSnapshot(snapshot)">🗑️</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </AppTable>
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
                图片预览
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
                {{ zoomMode === 'fit' ? '原始大小 (1:1)' : '适应窗口' }}
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
            <div v-if="selectedSnapshotCaptureZones.length" class="map-preview-meta">
              <div class="meta-pill">
                <span class="meta-label">地图:</span>
                <strong>{{ selectedSnapshotMapTitle }}</strong>
              </div>
              <div class="meta-pill cyan">
                <span class="meta-label">捕获点数量:</span>
                <strong>{{ selectedSnapshotCaptureZones.length }} 个</strong>
              </div>
            </div>

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

            <div v-if="selectedSnapshotCaptureZones.length" class="capture-zone-list-card">
              <div class="capture-zone-list-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-sm"><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                Capture Point 坐标列表
              </div>
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

            <div v-else-if="selectedSnapshotJsonLoading" class="empty-state">
              <div class="spinner-lg"></div>
              <span>正在加载 Capture Point 数据...</span>
            </div>
            <div v-else class="empty-state">该快照没有 Capture Point 坐标信息。</div>
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
import AppTable from "../components/common/AppTable.vue";
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
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.kpi-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
  transition: all 0.2s ease;
}

.kpi-card:hover {
  border-color: rgba(56, 189, 248, 0.25);
  transform: translateY(-2px);
}

.kpi-icon-box {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 10px;
  flex-shrink: 0;
}

.kpi-icon-box svg {
  width: 22px;
  height: 22px;
}

.kpi-icon-box.cyan {
  background: rgba(56, 189, 248, 0.12);
  color: #38bdf8;
  border: 1px solid rgba(56, 189, 248, 0.25);
}

.kpi-icon-box.emerald {
  background: rgba(34, 197, 94, 0.12);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.25);
}

.kpi-icon-box.amber {
  background: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.25);
}

.kpi-icon-box.purple {
  background: rgba(167, 139, 250, 0.12);
  color: #a78bfa;
  border: 1px solid rgba(167, 139, 250, 0.25);
}

.kpi-content {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.kpi-label {
  font-size: 11px;
  color: var(--color-text-muted);
  font-weight: 500;
}

.kpi-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kpi-value.date-text {
  font-size: 13px;
}

.kpi-value .unit {
  font-size: 12px;
  font-weight: 400;
  opacity: 0.7;
}

.kpi-sub {
  font-size: 10px;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.snapshot-split {
  grid-template-columns: minmax(0, 1.35fr) minmax(420px, 1fr) !important;
  gap: 16px;
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
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.search-box {
  position: relative;
  flex: 1;
  min-width: 200px;
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
  border-radius: 8px;
  border: 1px solid var(--color-border-soft);
  background: rgba(15, 23, 42, 0.8);
  color: var(--color-text-primary);
  font-size: 12px;
  transition: all 0.15s ease;
}

.search-input:focus {
  outline: none;
  border-color: rgba(56, 189, 248, 0.4);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.1);
}

.batch-actions-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.batch-count {
  font-size: 11px;
  color: #fecaca;
}

.snapshot-list-container {
  flex: 1 1 auto;
  min-height: 400px;
  overflow-y: auto;
  scrollbar-gutter: stable;
  border-radius: 8px;
  border: 1px solid var(--color-border-soft);
  background: rgba(15, 23, 42, 0.3);
}

.custom-snapshot-table {
  width: 100%;
}

.col-chk {
  width: 32px;
  text-align: center;
}

.col-name {
  min-width: 160px;
}

.name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.snapshot-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.copy-btn {
  background: transparent;
  border: 0;
  color: var(--color-text-muted);
  padding: 2px;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}

.copy-btn svg {
  width: 12px;
  height: 12px;
}

.copy-btn:hover {
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.1);
}

.snapshot-file {
  margin-top: 2px;
  font-size: 10px;
  color: var(--color-text-muted);
  font-family: monospace;
}

.col-time {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.artifact-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
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
  transition: all 0.15s ease;
}

.artifact-chip:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}

.artifact-size {
  opacity: 0.7;
  font-size: 9px;
}

.artifact-chip[data-format="json"] {
  border-color: rgba(56, 189, 248, 0.3);
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.08);
}

.artifact-chip[data-format="image"] {
  border-color: rgba(34, 197, 94, 0.3);
  color: #22c55e;
  background: rgba(34, 197, 94, 0.08);
}

.artifact-chip[data-format="csv"] {
  border-color: rgba(167, 139, 250, 0.3);
  color: #a78bfa;
  background: rgba(167, 139, 250, 0.08);
}

.artifact-chip[data-format="markdown"] {
  border-color: rgba(249, 115, 22, 0.3);
  color: #f97316;
  background: rgba(249, 115, 22, 0.08);
}

.action-dropdown-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.03);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.icon-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--color-border-hover);
}

.icon-btn.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.4);
}

/* Preview Navigation Tabs */
.preview-header-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--color-border-soft);
}

.preview-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(15, 23, 42, 0.7);
  padding: 3px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tab-btn .tab-icon {
  width: 14px;
  height: 14px;
}

.tab-btn:hover:not(:disabled) {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.05);
}

.tab-btn.active {
  background: rgba(56, 189, 248, 0.15);
  color: #38bdf8;
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.2);
}

.tab-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.preview-quick-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Preview Shell & Map Stage */
.preview-shell {
  flex: 1;
  min-height: 420px;
  overflow: auto;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  background: #090d16;
  background-image: radial-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px);
  background-size: 16px 16px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-shell img {
  display: block;
  transition: transform 0.2s ease;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 6px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
}

.preview-shell.raw img {
  max-width: none;
  max-height: none;
}

.image-overlay-info {
  position: absolute;
  bottom: 10px;
  left: 10px;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 11px;
  color: var(--color-text-secondary);
}

.map-preview-shell {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 420px;
}

.map-preview-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.meta-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid var(--color-border-soft);
  font-size: 12px;
  color: var(--color-text-secondary);
}

.meta-pill.cyan {
  border-color: rgba(56, 189, 248, 0.3);
  color: #38bdf8;
}

.map-preview-stage {
  position: relative;
  flex: 1;
  min-height: 320px;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  overflow: hidden;
  background: #080c14;
}

.map-preview-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.map-preview-layer {
  position: absolute;
  inset: 0;
}

.map-preview-marker {
  position: absolute;
  transform: translate(-50%, -50%);
  border: 0;
  background: transparent;
  cursor: pointer;
  padding: 0;
  z-index: 2;
}

.map-preview-marker-pulse {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(249, 115, 22, 0.4);
  animation: pulse-ring 2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
}

@keyframes pulse-ring {
  0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
  100% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
}

.map-preview-marker-dot {
  position: relative;
  display: block;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: #f97316;
  border: 2px solid #0f172a;
  box-shadow: 0 0 10px #f97316;
}

.map-preview-marker-label {
  display: inline-block;
  margin-top: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid rgba(249, 115, 22, 0.4);
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
}

.capture-zone-list-card {
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  padding: 12px;
  background: rgba(15, 23, 42, 0.4);
}

.capture-zone-list-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.icon-sm {
  width: 14px;
  height: 14px;
  color: #f97316;
}

.capture-zone-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
  max-height: 160px;
  overflow-y: auto;
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

.zone-name {
  font-size: 12px;
  color: var(--color-text-primary);
}

.capture-zone-coords {
  display: flex;
  gap: 4px;
}

.coord-pill {
  font-size: 10px;
  font-family: monospace;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(56, 189, 248, 0.1);
  color: #38bdf8;
}

/* JSON Shell */
.json-preview-shell {
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  background: #090d16;
  overflow: hidden;
  min-height: 420px;
}

.json-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(15, 23, 42, 0.8);
  border-bottom: 1px solid var(--color-border-soft);
}

.json-info {
  font-size: 11px;
  color: var(--color-text-muted);
}

.json-code-block {
  flex: 1;
  margin: 0;
  padding: 12px;
  overflow: auto;
  font-family: Consolas, Monaco, 'Andale Mono', monospace;
  font-size: 11px;
  line-height: 1.5;
  color: #7dd3fc;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 16px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 13px;
}

.empty-icon {
  width: 36px;
  height: 36px;
  opacity: 0.4;
}

.spinner-lg {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(56, 189, 248, 0.2);
  border-top-color: #38bdf8;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary);
  transition: all 0.15s ease;
}

.btn-icon {
  width: 14px;
  height: 14px;
}

.action-btn:hover:not(:disabled) {
  border-color: var(--color-border-hover);
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.08);
}

.action-btn.danger {
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.08);
  color: #fecaca;
}

.action-btn.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.18);
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

:deep(.custom-snapshot-table tbody tr.selected td) {
  background: rgba(56, 189, 248, 0.1) !important;
  border-bottom-color: rgba(56, 189, 248, 0.25) !important;
}

@media (max-width: 1200px) {
  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .snapshot-split {
    grid-template-columns: minmax(0, 1fr) !important;
  }
}

@media (max-width: 640px) {
  .kpi-grid {
    grid-template-columns: 1fr;
  }
}
</style>

