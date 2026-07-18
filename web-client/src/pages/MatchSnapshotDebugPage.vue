<template>
  <AppPage full-bleed>
    <AppPageHeader
      title="对局快照浏览"
      subtitle="按时间浏览每一局结束快照，查看地图、人数、队列、玩家状态与 BZSS Core 计分板数据。"
      :status-items="headerStatusItems"
    >
      <template #actions>
        <button type="button" class="action-btn ghost" @click="loadList" :disabled="loading">
          {{ loading ? "刷新中..." : "刷新列表" }}
        </button>
      </template>
    </AppPageHeader>

    <AppSplitLayout class="snapshot-split">
      <template #left>
        <AppCard compact title="历史快照记录" description="每次对局结束都会生成一个独立版本，并按录制时间倒序保存。">
          <div v-if="loading" class="empty-state">正在加载快照列表...</div>
          <div v-else-if="snapshots.length === 0" class="empty-state">暂无录制记录</div>
          <div v-else class="snapshot-list">
            <AppTable compact>
              <thead>
                <tr>
                  <th><input type="checkbox" :checked="selectedIds.length === snapshotsView.length && snapshotsView.length > 0" @change="toggleSelectAll($event)"></th>
                  <th>名称</th>
                  <th>录制时间</th>
                  <th>工件</th>
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
                  <td><input type="checkbox" :value="snapshot.id" v-model="selectedIds" @click.stop></td>
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
          </div>
        </AppCard>
      </template>

      <template #right>
        <AppCard compact title="预览" :description="selectedSnapshot?.name || '未选择'" class="preview-card">
          <div class="preview-toolbar">
            <button type="button" class="action-btn sm" :class="{ active: previewMode === 'image' }" @click="previewMode = 'image'">
              图片
            </button>
            <button type="button" class="action-btn sm" :class="{ active: previewMode === 'details' }" @click="previewMode = 'details'">
              快照数据
            </button>
            <button
              type="button"
              class="action-btn sm"
              :class="{ active: previewMode === 'map' }"
              :disabled="!selectedSnapshotCaptureZones.length"
              @click="previewMode = 'map'"
            >
              Capture Point
            </button>
            <button
              v-if="selectedImageUrl && previewMode === 'image'"
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
              @click="selectedSnapshot && openArtifact(selectedSnapshot.id, previewMode === 'image' ? 'image' : 'json')"
            >
              新标签打开
            </button>
            <button
              type="button"
              class="action-btn sm danger"
              :disabled="!selectedIds.length || busy"
              @click="batchDelete"
            >
              批量删除
            </button>
          </div>

          <div v-if="previewMode === 'details'" class="snapshot-detail-shell">
            <div v-if="selectedSnapshotJsonLoading" class="empty-state">正在加载快照数据...</div>
            <template v-else-if="selectedSnapshotJson">
              <div class="snapshot-overview-grid">
                <div class="snapshot-overview-item">
                  <span>快照时间</span>
                  <strong>{{ formatDate(selectedSnapshotJson.capturedAt || selectedSnapshot?.createdAt || "") }}</strong>
                </div>
                <div class="snapshot-overview-item">
                  <span>当前地图</span>
                  <strong>{{ selectedSnapshotJson.match?.map || "-" }}</strong>
                  <small>{{ selectedSnapshotJson.match?.layer || "-" }}</small>
                </div>
                <div class="snapshot-overview-item">
                  <span>下一地图</span>
                  <strong>{{ selectedSnapshotJson.match?.nextMap || "-" }}</strong>
                  <small>{{ selectedSnapshotJson.match?.nextLayer || "-" }}</small>
                </div>
                <div class="snapshot-overview-item">
                  <span>在线 / 队列</span>
                  <strong>{{ selectedSnapshotPlayerCount }} / {{ selectedSnapshotJson.server?.queueCount ?? 0 }}</strong>
                  <small>玩家 / 排队</small>
                </div>
              </div>

              <div class="snapshot-player-header">
                <div>
                  <strong>玩家列表</strong>
                  <span>{{ selectedSnapshotPlayers.length }} 人</span>
                </div>
                <span class="snapshot-player-hint">生命值与计分来自该局结束时冻结的 BZSS Core 数据</span>
              </div>

              <div v-if="selectedSnapshotPlayers.length" class="snapshot-player-table-wrap">
                <AppTable compact>
                  <thead>
                    <tr>
                      <th>玩家</th>
                      <th>队伍 / 小队</th>
                      <th>Role</th>
                      <th>生命值</th>
                      <th>K</th>
                      <th>W</th>
                      <th>D</th>
                      <th>TK</th>
                      <th>载具</th>
                      <th>复苏</th>
                      <th>治疗</th>
                      <th>战斗</th>
                      <th>目标</th>
                      <th>团队</th>
                      <th>延迟</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="player in selectedSnapshotPlayers" :key="snapshotPlayerKey(player)">
                      <td class="snapshot-player-name">
                        <strong>{{ player.name || "Unknown" }}</strong>
                        <small>{{ player.steamID || player.eosID || "-" }}</small>
                      </td>
                      <td>
                        <strong>T{{ player.teamID ?? "-" }}</strong>
                        <small>{{ player.squadInfo?.name || formatSquad(player.squadID) }}</small>
                      </td>
                      <td>{{ player.role || player.bzssCore?.soldierClass || "-" }}</td>
                      <td>{{ formatHealth(player.health ?? player.bzssCore?.health) }}</td>
                      <td>{{ statValue(player.bzssCore?.kills) }}</td>
                      <td>{{ statValue(player.bzssCore?.downs) }}</td>
                      <td>{{ statValue(player.bzssCore?.deaths) }}</td>
                      <td>{{ statValue(player.bzssCore?.teamKills) }}</td>
                      <td>{{ statValue(player.bzssCore?.vehicleKills) }}</td>
                      <td>{{ statValue(player.bzssCore?.revives) }}</td>
                      <td>{{ statValue(player.bzssCore?.healPoints) }}</td>
                      <td>{{ statValue(player.bzssCore?.combatScore) }}</td>
                      <td>{{ statValue(player.bzssCore?.objectiveScore) }}</td>
                      <td>{{ statValue(player.bzssCore?.teamworkScore) }}</td>
                      <td>{{ formatPing(player.bzssCore?.ping) }}</td>
                    </tr>
                  </tbody>
                </AppTable>
              </div>
              <div v-else class="empty-state">该快照没有玩家记录。</div>
            </template>
            <div v-else class="empty-state">快照数据不可用。</div>
          </div>

          <div v-else-if="previewMode === 'map'" class="map-preview-shell">
            <div v-if="selectedSnapshotCaptureZones.length" class="map-preview-meta">
              <span>{{ selectedSnapshotMapTitle }}</span>
              <span>{{ selectedSnapshotCaptureZones.length }} 个 Capture Point</span>
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
                  :title="zone.raw || zone.name"
                >
                  <span class="map-preview-marker-dot"></span>
                  <span class="map-preview-marker-label">{{ zone.name }}</span>
                </button>
              </div>
            </div>

            <div v-if="selectedSnapshotCaptureZones.length" class="capture-zone-list-card">
              <div class="capture-zone-list-title">Capture Point 列表</div>
              <div class="capture-zone-list">
                <div
                  v-for="zone in selectedSnapshotCaptureZones"
                  :key="`${zone.name}-${zone.position?.x}-${zone.position?.y}`"
                  class="capture-zone-list-item"
                >
                  <strong>{{ zone.name }}</strong>
                  <span class="capture-zone-coords">
                    X={{ formatCoord(zone.position?.x) }}, Y={{ formatCoord(zone.position?.y) }}, Z={{ formatCoord(zone.position?.z) }}
                  </span>
                </div>
              </div>
            </div>

            <div v-else-if="selectedSnapshotJsonLoading" class="empty-state">正在加载 Capture Point 数据...</div>
            <div v-else class="empty-state">该快照没有 Capture Point。</div>
          </div>

          <div v-else-if="selectedImageUrl" class="preview-shell" :class="zoomMode">
            <img :src="selectedImageUrl" alt="snapshot preview">
          </div>
          <div v-else class="empty-state">选择一条快照后预览图片。</div>
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

interface MatchSnapshotPlayer {
  playerID?: number | null;
  name?: string;
  teamID?: number | null;
  squadID?: number | null;
  role?: string;
  steamID?: string;
  eosID?: string;
  health?: number | null;
  squadInfo?: {
    name?: string;
  } | null;
  bzssCore?: {
    health?: number | null;
    soldierClass?: string;
    kills?: number | null;
    downs?: number | null;
    deaths?: number | null;
    teamKills?: number | null;
    vehicleKills?: number | null;
    revives?: number | null;
    healPoints?: number | null;
    combatScore?: number | null;
    objectiveScore?: number | null;
    teamworkScore?: number | null;
    ping?: number | null;
  } | null;
}

interface MatchSnapshotJsonPayload {
  capturedAt?: string;
  server?: {
    playerCount?: number;
    queueCount?: number;
  };
  match?: {
    map?: string;
    layer?: string;
    nextMap?: string;
    nextLayer?: string;
    playerCount?: number;
  };
  summary?: {
    playerCount?: number;
  };
  players?: MatchSnapshotPlayer[];
  captureZones?: BzssCoreCaptureZoneInfo[];
}

const ui = useUiStore();
const snapshots = ref<MatchSnapshotItem[]>([]);
const loading = ref(true);
const busy = ref(false);
const errorMessage = ref("");
const lastLoadedAt = ref("");
const selectedId = ref("");
const zoomMode = ref<"fit" | "raw">("fit");
const previewMode = ref<"image" | "details" | "map">("image");
const selectedSnapshotJson = ref<MatchSnapshotJsonPayload | null>(null);
const selectedSnapshotJsonLoading = ref(false);
const selectedIds = ref<string[]>([]);

const sortedSnapshots = computed(() => [...snapshots.value].sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt))));
const snapshotsView = computed(() => sortedSnapshots.value.map(normalizeSnapshotItem));
const latestSnapshot = computed(() => snapshotsView.value[0] ?? null);
const selectedSnapshot = computed(() => snapshotsView.value.find((item) => item.id === selectedId.value) ?? latestSnapshot.value ?? null);
const selectedImageUrl = computed(() => selectedSnapshot.value ? artifactUrl(selectedSnapshot.value.id, "image") : "");
const selectedSnapshotCaptureZones = computed(() => Array.isArray(selectedSnapshotJson.value?.captureZones) ? selectedSnapshotJson.value?.captureZones : []);
const selectedSnapshotPlayers = computed<MatchSnapshotPlayer[]>(() =>
  Array.isArray(selectedSnapshotJson.value?.players) ? selectedSnapshotJson.value?.players ?? [] : [],
);
const selectedSnapshotPlayerCount = computed(() =>
  Number(
    selectedSnapshotJson.value?.server?.playerCount
    ?? selectedSnapshotJson.value?.match?.playerCount
    ?? selectedSnapshotJson.value?.summary?.playerCount
    ?? selectedSnapshotPlayers.value.length,
  ) || 0,
);
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
  return "Unrecognized map";
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
  selectedIds.value = checked ? snapshotsView.value.map((snapshot) => snapshot.id) : [];
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

function snapshotPlayerKey(player: MatchSnapshotPlayer) {
  return [
    player.steamID,
    player.eosID,
    player.playerID,
    player.teamID,
    player.squadID,
    player.name,
  ].map((value) => String(value ?? "")).join("|");
}

function formatSquad(value: number | null | undefined) {
  return value == null ? "无小队" : `Squad ${value}`;
}

function statValue(value: number | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : "-";
}

function formatHealth(value: number | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(1) : "-";
}

function formatPing(value: number | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric)} ms` : "-";
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
.snapshot-detail-shell {
  min-height: 360px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.snapshot-overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.snapshot-overview-item {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-surface-raised) 88%, transparent);
}

.snapshot-overview-item span,
.snapshot-overview-item small,
.snapshot-player-name small,
.snapshot-player-table-wrap td small {
  color: var(--color-text-muted);
  font-size: 11px;
}

.snapshot-overview-item strong {
  overflow: hidden;
  color: var(--color-text-primary);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.snapshot-player-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.snapshot-player-header > div {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.snapshot-player-header span,
.snapshot-player-hint {
  color: var(--color-text-muted);
  font-size: 11px;
}

.snapshot-player-table-wrap {
  max-height: 520px;
  overflow: auto;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
}

.snapshot-player-table-wrap table {
  min-width: 1180px;
}

.snapshot-player-table-wrap th,
.snapshot-player-table-wrap td {
  white-space: nowrap;
}

.snapshot-player-name strong,
.snapshot-player-name small,
.snapshot-player-table-wrap td strong,
.snapshot-player-table-wrap td small {
  display: block;
}

@media (max-width: 900px) {
  .snapshot-overview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .snapshot-player-header {
    align-items: flex-start;
    flex-direction: column;
  }
}

.snapshot-split {
  grid-template-columns: minmax(0, 1.25fr) minmax(400px, 1fr) !important;
}

.snapshot-list {
  height: 420px;
  overflow-y: auto;
  flex-shrink: 0;
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
  flex-wrap: wrap;
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
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-shell img {
  display: block;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.preview-shell.fit img {
  width: auto;
  height: auto;
}

.preview-shell.raw img {
  width: auto;
  height: auto;
  min-width: inherit;
  max-width: none;
}

.map-preview-shell {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 350px;
}

.map-preview-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.map-preview-stage {
  position: relative;
  flex: 1;
  min-height: 350px;
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  overflow: hidden;
  background: #0b1220;
}

.map-preview-image {
  display: block;
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
  color: #f8fafc;
  cursor: default;
  padding: 0;
}

.map-preview-marker-dot {
  display: block;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: #f97316;
  border: 2px solid rgba(15, 23, 42, 0.95);
  box-shadow: 0 0 0 4px rgba(249, 115, 22, 0.22);
}

.map-preview-marker-label {
  display: inline-block;
  margin-top: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.88);
  border: 1px solid rgba(249, 115, 22, 0.3);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.capture-zone-list-card {
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.02);
}

.capture-zone-list-title {
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-secondary);
}

.capture-zone-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.capture-zone-list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: var(--color-text-primary);
}

.capture-zone-coords {
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
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

.action-btn.active {
  border-color: rgba(56, 189, 248, 0.4);
  background: rgba(56, 189, 248, 0.1);
  color: #e0f2fe;
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
