<template>
  <AppPage full-bleed class="tactical-replay-page">
    <AppPageHeader
      title="战术地图回放"
      subtitle="查看自动录制的战术地图轨迹，按玩家筛选并导出 MP4。"
      :status-items="headerStatusItems"
    >
      <template #actions>
        <button type="button" class="refresh-btn" :disabled="loadingSegments" @click="loadSegments">
          {{ loadingSegments ? "刷新中..." : "刷新列表" }}
        </button>
      </template>
    </AppPageHeader>

    <section class="metric-strip" aria-label="回放概览">
      <article class="metric-tile accent">
        <span class="metric-label">片段</span>
        <strong class="metric-value">{{ segments.length }}</strong>
        <span class="metric-hint">自动录制的可播放区间</span>
      </article>
      <article class="metric-tile">
        <span class="metric-label">当前帧</span>
        <strong class="metric-value">{{ frames.length ? currentFrameIndex + 1 : 0 }}</strong>
        <span class="metric-hint">已加载的回放帧</span>
      </article>
      <article class="metric-tile">
        <span class="metric-label">倍速</span>
        <strong class="metric-value">{{ speed }}x</strong>
        <span class="metric-hint">{{ playing ? "正在播放" : "已暂停" }}</span>
      </article>
      <article class="metric-tile">
        <span class="metric-label">导出任务</span>
        <strong class="metric-value">{{ exportTasks.length }}</strong>
        <span class="metric-hint">完成后可直接下载</span>
      </article>
    </section>

    <AppSplitLayout class="replay-split-layout">
      <template #left>
        <div class="sidebar-stack">
          <!-- Controls Panel -->
          <AppCard compact title="筛选与控制" class="panel panel--controls">
            <div class="field-grid">
              <label class="control-field control-field--wide">
                <span>玩家筛选</span>
                <textarea v-model="playerFilterText" rows="3" placeholder="每行一个玩家名，或用逗号分隔"></textarea>
              </label>
              <label class="control-field">
                <span>开始时间</span>
                <input v-model.number="fromMsInput" type="number" min="0">
                <span class="field-preview" v-if="fromMsInput">{{ formatDate(fromMsInput) }}</span>
              </label>
              <label class="control-field">
                <span>结束时间</span>
                <input v-model.number="toMsInput" type="number" min="0">
                <span class="field-preview" v-if="toMsInput">{{ formatDate(toMsInput) }}</span>
              </label>
            </div>

            <div class="control-actions">
              <button type="button" class="action-btn primary" :disabled="!selectedSegment || loadingFrames" @click="loadFrames">
                {{ loadingFrames ? "加载中..." : "应用筛选并加载" }}
              </button>
            </div>
          </AppCard>

          <!-- Replay Segments List -->
          <AppCard compact title="回放片段" description="人数大于 50 时自动录制，按地图切换和断流自动分段。" class="panel">
            <div v-if="loadingSegments" class="empty-state">正在加载片段...</div>
            <div v-else-if="!segments.length" class="empty-state">暂无回放片段</div>
            <div v-else class="segment-list">
              <button
                v-for="segment in segments"
                :key="segment.id"
                type="button"
                class="segment-item"
                :class="{ selected: selectedSegmentId === segment.id }"
                @click="selectSegment(segment.id)"
              >
                <div class="segment-head">
                  <strong>{{ segment.mapName || segment.mapKey }}</strong>
                  <span class="segment-layer">{{ segment.layer || "--" }}</span>
                </div>
                <div class="segment-meta font-mono">
                  <span>开始: {{ formatDate(segment.startedAt).split(' ')[1] || formatDate(segment.startedAt) }}</span>
                  <span>时长: {{ formatDuration(segment.durationMs) }} / {{ segment.frameCount }} 帧</span>
                </div>
              </button>
            </div>
          </AppCard>

          <!-- Export Tasks List -->
          <AppCard compact title="导出任务" description="完成后可直接下载 MP4。" class="panel">
            <div v-if="!exportTasks.length" class="empty-state">暂无导出任务</div>
            <div v-else class="task-list">
              <div v-for="task in exportTasks" :key="task.id" class="task-item">
                <div class="task-main">
                  <strong class="task-filename">{{ task.outputFileName }}</strong>
                  <div class="task-meta-row">
                    <AppStatusBadge :tone="getTaskStatusTone(task.status)">
                      {{ getTaskStatusLabel(task.status) }}
                    </AppStatusBadge>
                    <span class="task-detail font-mono">{{ task.frameCount }} 帧 / {{ task.speed }}x</span>
                  </div>
                </div>
                <div class="task-actions">
                  <a v-if="task.status === 'completed'" class="action-btn sm" :href="exportFileUrl(task.id)">下载</a>
                  <span v-else-if="task.error" class="task-error" :title="task.error">错误: {{ task.error }}</span>
                </div>
              </div>
            </div>
          </AppCard>
        </div>
      </template>

      <template #right>
        <main class="stage">
          <AppCard
            compact
            body-mode="fill"
            overflow="clip"
            title="回放舞台"
            :description="selectedSegment ? `${selectedSegment.mapName || selectedSegment.mapKey} / ${selectedSegment.layer || '--'}` : '未选择片段'"
            class="panel panel--stage"
          >
            <div class="stage-shell">
              <div class="preview-frame">
                <div
                  ref="previewCanvasRef"
                  class="preview-canvas"
                  @mousedown="startDrag"
                  @mousemove="onDrag"
                  @mouseup="stopDrag"
                  @mouseleave="stopDrag"
                  @wheel.prevent="onWheel"
                >
                  <!-- Zoom & Pan transform layer (fixed 1000x1000 virtual coordinates) -->
                  <div
                    class="map-transform-container"
                    :style="{
                      transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
                      cursor: isDragging ? 'grabbing' : 'grab'
                    }"
                  >
                    <!-- Map Image -->
                    <img
                      v-if="activeMapConfig"
                      class="preview-map-image"
                      :src="activeMapConfig.image"
                      alt="tactical map"
                    >

                    <!-- Map Grid Overlay -->
                    <div class="map-grid-pattern"></div>

                    <!-- Player Markers -->
                    <div
                      v-for="player in currentMarkers"
                      :key="`${player.playerGuid || player.playerName}-${player.playerName}`"
                      class="preview-marker"
                      :class="[
                        `team-${player.teamId || 0}`,
                        { 'is-dead': (player.health ?? 100) <= 0 },
                        { 'is-vehicle': player.vehicleInfo && player.vehicleInfo.vehicleType && player.vehicleInfo.vehicleType !== 'None' },
                        { 'is-hovered': hoveredPlayer?.playerGuid === player.playerGuid || hoveredPlayer?.playerName === player.playerName }
                      ]"
                      :style="{
                        left: `${player.mapX}%`,
                        top: `${player.mapY}%`,
                        transform: `translate(-50%, -50%) scale(${dynamicMarkerScale})`
                      }"
                      @mouseenter="hoveredPlayer = player.rawPlayer"
                      @mouseleave="hoveredPlayer = null"
                    >
                      <!-- Player Direction Pointer -->
                      <div
                        v-if="getPlayerYaw(player) !== null"
                        class="marker-direction"
                        :style="{
                          transform: `translate(-50%, -50%) rotate(${(getPlayerYaw(player) ?? 0) + 90}deg)`
                        }"
                      >
                        <div class="direction-arrow"></div>
                      </div>

                      <span class="preview-dot"></span>
                      <span class="preview-label">{{ player.playerName }}</span>
                    </div>
                  </div>

                  <!-- Floating Canvas Zoom Utility controls (Bottom Left) -->
                  <div class="map-utility-controls">
                    <button type="button" class="map-ctrl-btn" title="放大" @click="zoomIn">＋</button>
                    <button type="button" class="map-ctrl-btn" title="缩小" @click="zoomOut">－</button>
                    <button type="button" class="map-ctrl-btn" title="重置视角" @click="resetView">↺</button>
                  </div>

                  <!-- Floating Player Hover Tooltip (rendered outside map-transform-container to keep scale independent) -->
                  <div
                    v-if="hoveredMarker"
                    class="player-tooltip"
                    :class="`team-${hoveredMarker.teamId || 0}`"
                    :style="tooltipStyle"
                  >
                    <!-- Tooltip Header -->
                    <div class="tooltip-header">
                      <span class="tooltip-name" :title="hoveredMarker.playerName">{{ hoveredMarker.playerName }}</span>
                      <span
                        class="tooltip-health-badge"
                        :class="{ 'low-health': (hoveredMarker.health ?? 100) < 40, 'dead-health': (hoveredMarker.health ?? 100) <= 0 }"
                      >
                        {{ (hoveredMarker.health ?? 100) <= 0 ? 'DOWNED' : `${hoveredMarker.health ?? 100}% HP` }}
                      </span>
                    </div>

                    <!-- Divider Line -->
                    <div class="tooltip-divider"></div>

                    <!-- Tooltip Details Grid -->
                    <div class="tooltip-details">
                      <div class="detail-row">
                        <span class="detail-label">角色职业</span>
                        <span class="detail-val">
                          <template v-if="isRoleIconImage(hoveredMarker.roleInfo.icon)">
                            <span
                              class="inline-kit-mask"
                              :style="getTeamRoleIconStyle(hoveredMarker.roleInfo.icon, hoveredMarker.teamId)"
                              :aria-label="hoveredMarker.roleInfo.label"
                            ></span>
                          </template>
                          <span v-else class="inline-kit-fallback" aria-hidden="true">{{ hoveredMarker.roleInfo.icon }}</span>
                          {{ hoveredMarker.roleInfo.label }}
                        </span>
                      </div>
                      <div class="detail-row">
                        <span class="detail-label">战术小队</span>
                        <span class="detail-val">
                          <span class="squad-color-pill"></span>
                          #{{ hoveredMarker.squadId || '-' }}
                        </span>
                      </div>
                      <div class="detail-row" v-if="hoveredMarker.vehicleInfo">
                        <span class="detail-label">载具</span>
                        <span class="detail-val font-mono">
                          {{ hoveredMarker.vehicleInfo.vehicleType }} ({{ hoveredMarker.vehicleInfo.health }} HP)
                        </span>
                      </div>
                      <div class="detail-row">
                        <span class="detail-label">坐标</span>
                        <span class="detail-val font-mono highlight-cyan">
                          {{ Math.round(hoveredMarker.rawPlayer.position?.x ?? 0) }}, {{ Math.round(hoveredMarker.rawPlayer.position?.y ?? 0) }}
                        </span>
                      </div>
                    </div>

                    <!-- Health visual bar -->
                    <div class="tooltip-health-track">
                      <div
                        class="tooltip-health-bar"
                        :style="{
                          width: `${hoveredMarker.health ?? 100}%`,
                          background: (hoveredMarker.health ?? 100) <= 0 ? '#ef5350' : (hoveredMarker.health ?? 100) < 40 ? '#ffd54f' : '#10b981'
                        }"
                      ></div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Media Player Control Deck -->
              <div class="media-deck">
                <!-- Timeline Slider -->
                <div class="timeline-container">
                  <input
                    v-model.number="currentFrameIndex"
                    class="timeline-range"
                    type="range"
                    min="0"
                    :max="Math.max(0, frames.length - 1)"
                    :disabled="!frames.length"
                  >
                </div>

                <!-- Control actions and information -->
                <div class="media-controls-bar">
                  <div class="playback-buttons">
                    <button
                      type="button"
                      class="ctrl-btn icon-btn"
                      title="回到起点"
                      :disabled="!frames.length"
                      @click="currentFrameIndex = 0"
                    >
                      ⏮ 重置
                    </button>
                    <button
                      type="button"
                      class="ctrl-btn play-pause-btn"
                      :class="{ playing }"
                      title="播放 / 暂停"
                      :disabled="!frames.length"
                      @click="togglePlayback"
                    >
                      {{ playing ? "⏸ 暂停" : "▶ 播放" }}
                    </button>
                  </div>

                  <div class="playback-status font-mono">
                    <span class="status-item">
                      <span class="label">当前进度</span>
                      <strong>{{ frames.length ? currentFrameIndex + 1 : 0 }} / {{ frames.length }} 帧</strong>
                    </span>
                    <span class="status-item">
                      <span class="label">当前时刻</span>
                      <strong>{{ currentFrame ? formatDate(currentFrame.timestampMs) : "--" }}</strong>
                    </span>
                    <span class="status-item">
                      <span class="label">玩家数</span>
                      <strong>{{ currentMarkers.length }} / {{ currentFrame?.playerCount || 0 }}</strong>
                    </span>
                  </div>

                  <div class="playback-speed">
                    <span class="speed-label">倍速:</span>
                    <div class="speed-badges">
                      <button
                        v-for="s in [0.25, 0.5, 1, 2, 4, 8]"
                        :key="s"
                        type="button"
                        class="speed-badge-btn"
                        :class="{ active: speed === s }"
                        @click="speed = s"
                      >
                        {{ s }}x
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Page Action Panel -->
              <div class="stage-actions">
                <button type="button" class="stage-btn outline" :disabled="!selectedSegment || loadingFrames" @click="loadFrames">
                  {{ loadingFrames ? "重新加载中..." : "🔄 重新载入回放" }}
                </button>
                <button type="button" class="stage-btn primary" :disabled="!selectedSegment || exportBusy" @click="submitExport">
                  {{ exportBusy ? "正在导出..." : "🎬 导出 MP4 视频" }}
                </button>
              </div>
            </div>
          </AppCard>
        </main>
      </template>
    </AppSplitLayout>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import AppPage from "../components/common/AppPage.vue";
import AppPageHeader from "../components/common/AppPageHeader.vue";
import AppCard from "../components/common/AppCard.vue";
import AppSplitLayout from "../components/common/AppSplitLayout.vue";
import AppStatusBadge from "../components/common/AppStatusBadge.vue";
import { useUiStore } from "../stores/ui.store";
import {
  createTacticalReplayExport,
  fetchTacticalReplayExportTasks,
  fetchTacticalReplaySegment,
  fetchTacticalReplaySegments,
  tacticalReplayExportFileUrl,
  type TacticalReplayExportTask,
  type TacticalReplayFrame,
  type TacticalReplaySegment,
} from "../app/tacticalMapReplayApi";
import { TACTICAL_MAP_CONFIGS, type TacticalMapConfig } from "../shared/tactical-map-data";
import { resolveRoleIcon, type RoleIconInfo } from "../utils/role-icons";

interface PreviewMarker {
  playerGuid: string;
  playerName: string;
  teamId: number | null;
  mapX: number;
  mapY: number;
  yaw: number | null;
  health: number | null;
  squadId: number | null;
  soldierClass: string;
  vehicleInfo: {
    vehicleType: string;
    health: number | null;
    maxHealth: number | null;
  } | null;
  roleInfo: RoleIconInfo;
  rawPlayer: any;
}

const ui = useUiStore();
const segments = ref<TacticalReplaySegment[]>([]);
const frames = ref<TacticalReplayFrame[]>([]);
const exportTasks = ref<TacticalReplayExportTask[]>([]);
const loadingSegments = ref(false);
const loadingFrames = ref(false);
const exportBusy = ref(false);
const selectedSegmentId = ref("");
const currentFrameIndex = ref(0);
const playerFilterText = ref("");
const speed = ref(1);
const fromMsInput = ref(0);
const toMsInput = ref(0);
const playing = ref(false);
let playbackTimer: number | null = null;

const hoveredPlayer = ref<any | null>(null);

// Zoom and Pan States (Virtual canvas coordinates: 1000px * 1000px)
const zoom = ref(0.55);
const panX = ref(0);
const panY = ref(0);
const isDragging = ref(false);
const dragStart = reactive({ x: 0, y: 0 });
const previewCanvasRef = ref<HTMLElement | null>(null);

const selectedSegment = computed(() => segments.value.find((item) => item.id === selectedSegmentId.value) ?? null);
const currentFrame = computed(() => frames.value[currentFrameIndex.value] ?? null);
const headerStatusItems = computed(() => [
  { label: `片段: ${segments.value.length}`, tone: "idle" as const },
  { label: `帧: ${frames.value.length}`, tone: "idle" as const },
  { label: `倍速: ${speed.value}x`, tone: "ok" as const },
]);

const activeMapConfig = computed<TacticalMapConfig | null>(() => {
  const key = currentFrame.value?.mapKey || selectedSegment.value?.mapKey || "";
  return TACTICAL_MAP_CONFIGS[key] ?? null;
});

const filteredPlayerNames = computed(() => {
  return Array.from(
    new Set(
      playerFilterText.value
        .split(/[\r\n,，]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
});

const currentMarkers = computed<PreviewMarker[]>(() => {
  const frame = currentFrame.value;
  const mapConfig = activeMapConfig.value;
  if (!frame || !mapConfig) return [];

  const bounds = mapConfig.bounds;
  return (frame.players ?? [])
    .map((player) => {
      const position = player.position;
      if (!position) return null;

      const inVehicle = player.vehicleInfo && player.vehicleInfo.vehicleType && player.vehicleInfo.vehicleType !== 'None';
      const roleInfo = inVehicle
        ? { icon: '🚙', label: `乘车中 (${player.vehicleInfo.vehicleType})` }
        : resolveRoleIcon(player.soldierClass);

      return {
        playerGuid: player.playerGuid,
        playerName: player.playerName,
        teamId: player.teamId,
        mapX: project(position.x, bounds.minX, bounds.maxX),
        mapY: project(position.y, bounds.minY, bounds.maxY),
        yaw: player.yaw,
        health: player.health,
        squadId: player.squadId,
        soldierClass: player.soldierClass,
        vehicleInfo: player.vehicleInfo,
        roleInfo,
        rawPlayer: player,
      };
    })
    .filter((item): item is PreviewMarker => Boolean(item));
});

const hoveredMarker = computed(() => {
  if (!hoveredPlayer.value) return null;
  return currentMarkers.value.find(
    (m) => m.playerGuid === hoveredPlayer.value?.playerGuid || m.playerName === hoveredPlayer.value?.playerName
  ) || null;
});

// Tooltip position calculated relative to the outer preview-canvas viewport using the map pan/zoom factors
const tooltipStyle = computed(() => {
  if (!hoveredMarker.value || !previewCanvasRef.value) return { display: "none" };
  const { mapX, mapY } = hoveredMarker.value;
  
  // Coordinates relative to 1000px * 1000px grid
  const mapPixelX = mapX * 10;
  const mapPixelY = mapY * 10;
  
  // Project to viewport canvas coordinate space
  const pixelX = panX.value + mapPixelX * zoom.value;
  const pixelY = panY.value + mapPixelY * zoom.value;
  
  // If the marker is in the top 20% of the canvas frame, render the tooltip below the marker
  const isTooTop = pixelY < 120;
  
  return {
    left: `${pixelX}px`,
    top: `${pixelY}px`,
    transform: isTooTop ? "translate(-50%, 0) translateY(12px)" : "translate(-50%, -100%) translateY(-12px)",
    position: "absolute" as const,
    zIndex: 100,
  };
});

const dynamicMarkerScale = computed(() => {
  // Rather than keeping marker screen size perfectly constant (1/zoom),
  // we scale it by zoom^(-0.6) so that markers grow slightly when zoomed in
  // and shrink slightly when zoomed out, creating a natural tactical map feel.
  return 1 / Math.pow(Math.max(zoom.value, 0.05), 0.6);
});

// Map Viewport Zoom / Panning controls
function startDrag(e: MouseEvent) {
  isDragging.value = true;
  dragStart.x = e.clientX - panX.value;
  dragStart.y = e.clientY - panY.value;
}

function onDrag(e: MouseEvent) {
  if (!isDragging.value) return;
  panX.value = e.clientX - dragStart.x;
  panY.value = e.clientY - dragStart.y;
}

function stopDrag() {
  isDragging.value = false;
}

function onWheel(e: WheelEvent) {
  const zoomFactor = 1.15;
  const oldZoom = zoom.value;
  
  if (e.deltaY < 0) {
    zoom.value = Math.min(8, zoom.value * zoomFactor);
  } else {
    zoom.value = Math.max(0.1, zoom.value / zoomFactor);
  }
  
  if (previewCanvasRef.value) {
    const rect = previewCanvasRef.value.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    panX.value = mouseX - (mouseX - panX.value) * (zoom.value / oldZoom);
    panY.value = mouseY - (mouseY - panY.value) * (zoom.value / oldZoom);
  }
}

function zoomIn() {
  const oldZoom = zoom.value;
  zoom.value = Math.min(8, zoom.value * 1.3);
  if (previewCanvasRef.value) {
    const cx = previewCanvasRef.value.clientWidth / 2;
    const cy = previewCanvasRef.value.clientHeight / 2;
    panX.value = cx - (cx - panX.value) * (zoom.value / oldZoom);
    panY.value = cy - (cy - panY.value) * (zoom.value / oldZoom);
  }
}

function zoomOut() {
  const oldZoom = zoom.value;
  zoom.value = Math.max(0.1, zoom.value / 1.3);
  if (previewCanvasRef.value) {
    const cx = previewCanvasRef.value.clientWidth / 2;
    const cy = previewCanvasRef.value.clientHeight / 2;
    panX.value = cx - (cx - panX.value) * (zoom.value / oldZoom);
    panY.value = cy - (cy - panY.value) * (zoom.value / oldZoom);
  }
}

function resetView() {
  zoom.value = 0.55;
  if (previewCanvasRef.value) {
    const cw = previewCanvasRef.value.clientWidth;
    const ch = previewCanvasRef.value.clientHeight;
    // Centers the virtual 1000px * 1000px map element inside the wrapper
    panX.value = (cw - 1000 * zoom.value) / 2;
    panY.value = (ch - 1000 * zoom.value) / 2;
  } else {
    panX.value = 0;
    panY.value = 0;
  }
}

function formatDate(timestamp: number) {
  if (!timestamp) return "--";
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(durationMs: number) {
  const seconds = Math.max(0, Math.round(Number(durationMs ?? 0) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}

function project(value: number, min: number, max: number) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || min === max) return 50;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

function getPlayerYaw(player: PreviewMarker): number | null {
  if (player.yaw != null) return player.yaw;
  return null;
}

function getTaskStatusTone(status: string) {
  if (status === "completed") return "ok";
  if (status === "failed") return "error";
  if (status === "running") return "warn";
  return "idle";
}

function getTaskStatusLabel(status: string) {
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "running") return "导出中";
  if (status === "queued") return "排队中";
  return status;
}

// Inline role icon rendering helpers
function isRoleIconImage(icon: string) {
  return String(icon ?? "").startsWith("/");
}

function getTeamRoleIconStyle(icon: string, teamId: number | null | undefined) {
  const iconUrl = String(icon ?? "");
  const color = getTeamRoleIconColor(teamId);
  return {
    backgroundColor: color,
    WebkitMaskImage: `url("${iconUrl}")`,
    maskImage: `url("${iconUrl}")`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain",
  };
}

function getTeamRoleIconColor(teamId: number | null | undefined) {
  const normalized = Number(teamId);
  if (normalized === 1) return "#3b82f6";
  if (normalized === 2) return "#ef4444";
  return "#f59e0b";
}

async function loadSegments() {
  loadingSegments.value = true;
  try {
    const response = await fetchTacticalReplaySegments();
    segments.value = Array.isArray(response.items) ? response.items : [];
    if (!selectedSegmentId.value && segments.value.length) {
      selectSegment(segments.value[0].id);
    }
  } catch (error) {
    ui.pushToast({ title: "加载回放失败", message: String(error), tone: "error" });
  } finally {
    loadingSegments.value = false;
  }
}

function selectSegment(segmentId: string) {
  selectedSegmentId.value = segmentId;
  const segment = segments.value.find((item) => item.id === segmentId);
  fromMsInput.value = Number(segment?.startedAt ?? 0);
  toMsInput.value = Number(segment?.endedAt ?? 0);
  currentFrameIndex.value = 0;
  frames.value = [];
  loadExportTasks();
  // Auto load frames for the selected segment to improve UX
  void loadFrames();
}

async function loadFrames() {
  if (!selectedSegment.value) return;

  loadingFrames.value = true;
  try {
    const response = await fetchTacticalReplaySegment({
      id: selectedSegment.value.id,
      from: fromMsInput.value || selectedSegment.value.startedAt,
      to: toMsInput.value || selectedSegment.value.endedAt,
      players: filteredPlayerNames.value,
    });
    frames.value = Array.isArray(response.frames) ? response.frames : [];
    currentFrameIndex.value = 0;
    if (!frames.value.length) {
      ui.pushToast({ title: "无匹配帧", message: "当前筛选条件下没有可播放的帧。", tone: "warn" });
    }
    // Centering the view after frames load ensures accurate dimensions
    setTimeout(() => {
      resetView();
    }, 50);
  } catch (error) {
    ui.pushToast({ title: "加载帧失败", message: String(error), tone: "error" });
  } finally {
    loadingFrames.value = false;
  }
}

function stopPlayback() {
  if (playbackTimer != null) {
    window.clearTimeout(playbackTimer);
    playbackTimer = null;
  }
  playing.value = false;
}

function togglePlayback() {
  if (!frames.value.length) return;
  if (playing.value) {
    stopPlayback();
    return;
  }
  playing.value = true;
  scheduleNextFrame();
}

function scheduleNextFrame() {
  if (!playing.value) return;
  if (currentFrameIndex.value >= frames.value.length - 1) {
    stopPlayback();
    return;
  }

  const current = frames.value[currentFrameIndex.value];
  const next = frames.value[currentFrameIndex.value + 1];
  const duration = Math.max(16, ((next.timestampMs - current.timestampMs) || 100) / Math.max(speed.value, 0.01));

  playbackTimer = window.setTimeout(() => {
    currentFrameIndex.value = Math.min(frames.value.length - 1, currentFrameIndex.value + 1);
    scheduleNextFrame();
  }, duration);
}

async function submitExport() {
  if (!selectedSegment.value) return;

  exportBusy.value = true;
  try {
    await createTacticalReplayExport({
      segmentId: selectedSegment.value.id,
      fromMs: fromMsInput.value || selectedSegment.value.startedAt,
      toMs: toMsInput.value || selectedSegment.value.endedAt,
      playerNames: filteredPlayerNames.value,
      speed: speed.value,
      fps: 30,
      resolution: 1280,
    });
    ui.pushToast({ title: "导出任务已创建", message: "稍后可在导出任务列表中下载 MP4。", tone: "ok" });
    await loadExportTasks();
  } catch (error) {
    ui.pushToast({ title: "导出失败", message: String(error), tone: "error" });
  } finally {
    exportBusy.value = false;
  }
}

async function loadExportTasks() {
  if (!selectedSegment.value) {
    exportTasks.value = [];
    return;
  }

  try {
    const response = await fetchTacticalReplayExportTasks({ segmentId: selectedSegment.value.id });
    exportTasks.value = Array.isArray(response.items) ? response.items : [];
  } catch {
    exportTasks.value = [];
  }
}

function exportFileUrl(taskId: string) {
  return tacticalReplayExportFileUrl(taskId);
}

watch(currentFrameIndex, () => {
  if (currentFrameIndex.value < 0) currentFrameIndex.value = 0;
  if (currentFrameIndex.value >= frames.value.length) currentFrameIndex.value = Math.max(0, frames.value.length - 1);
});

watch(speed, () => {
  if (playing.value) {
    stopPlayback();
    togglePlayback();
  }
});

onMounted(async () => {
  await loadSegments();
  window.addEventListener("resize", resetView);
  setTimeout(() => {
    resetView();
  }, 150);
});

onBeforeUnmount(() => {
  stopPlayback();
  window.removeEventListener("resize", resetView);
});
</script>

<style scoped>
.tactical-replay-page {
  gap: 16px;
  height: 100%;
}

.refresh-btn {
  min-height: 38px;
  padding: 0 16px;
  border-radius: 10px;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}

.refresh-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: #38bdf8;
  color: #ffffff;
  background: rgba(56, 189, 248, 0.12);
}

.metric-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  flex-shrink: 0;
}

.metric-tile {
  padding: 12px 14px;
  border-radius: 14px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.01)),
    rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow: 0 8px 16px rgba(2, 6, 23, 0.25);
  display: grid;
  gap: 3px;
  min-width: 0;
}

.metric-tile.accent {
  border-color: rgba(56, 189, 248, 0.32);
  background:
    radial-gradient(circle at top right, rgba(56, 189, 248, 0.12), transparent 50%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.01)),
    rgba(15, 23, 42, 0.84);
}

.metric-label {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #94a3b8;
}

.metric-value {
  font-size: 20px;
  line-height: 1.1;
  color: #f8fafc;
}

.metric-hint {
  font-size: 11px;
  color: #cbd5e1;
}

/* Scroll area optimization */
.replay-split-layout {
  flex: 1;
  min-height: 0;
}

.sidebar-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel {
  min-width: 0;
}

.panel--controls :deep(.card-body) {
  display: grid;
  gap: 14px;
}

.field-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: 1fr 1fr;
}

.control-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: #cbd5e1;
  min-width: 0;
}

.control-field--wide {
  grid-column: 1 / -1;
}

.control-field textarea,
.control-field input {
  width: 100%;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(15, 23, 42, 0.82);
  color: #f8fafc;
  border-radius: 10px;
  padding: 8px 12px;
  outline: none;
  font-size: 13px;
  transition: all 0.2s ease;
}

.control-field textarea:focus,
.control-field input:focus {
  border-color: #38bdf8;
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.16);
}

.field-preview {
  margin-top: 4px;
  font-size: 11px;
  color: #38bdf8;
  font-variant-numeric: tabular-nums;
  word-break: break-all;
}

.control-actions {
  display: flex;
  gap: 10px;
}

.action-btn {
  min-height: 38px;
  padding: 0 16px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(30, 41, 59, 0.6);
  color: #cbd5e1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.action-btn:hover:not(:disabled) {
  border-color: #38bdf8;
  color: #ffffff;
}

.action-btn.primary {
  background: #0284c7;
  border-color: #38bdf8;
  color: #ffffff;
  width: 100%;
}

.action-btn.primary:hover:not(:disabled) {
  background: #0369a1;
}

.action-btn.sm {
  min-height: 28px;
  padding: 0 10px;
  font-size: 11px;
  border-radius: 6px;
}

.empty-state {
  padding: 16px;
  color: #94a3b8;
  text-align: center;
  font-size: 13px;
}

/* Segments list card items */
.segment-list,
.task-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.segment-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.15);
  background: rgba(30, 41, 59, 0.2);
  color: #e2e8f0;
  cursor: pointer;
  transition: all 0.2s ease;
}

.segment-item:hover {
  background: rgba(30, 41, 59, 0.4);
  border-color: rgba(56, 189, 248, 0.4);
  color: #ffffff;
}

.segment-item.selected {
  border-color: #38bdf8;
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.2);
  background: rgba(8, 47, 73, 0.5);
  color: #ffffff;
}

.segment-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.segment-layer {
  font-size: 11px;
  color: #94a3b8;
  background: rgba(148, 163, 184, 0.12);
  padding: 2px 6px;
  border-radius: 4px;
}

.segment-meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #94a3b8;
  flex-wrap: wrap;
  gap: 4px;
}

/* Task item layout */
.task-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(30, 41, 59, 0.2);
  border: 1px solid rgba(148, 163, 184, 0.12);
}

.task-main {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.task-filename {
  font-size: 13px;
  color: #f8fafc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.task-detail {
  font-size: 11px;
  color: #94a3b8;
}

.task-error {
  color: #fca5a5;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100px;
  display: block;
}

/* Stage & Map Canvas layout */
.stage {
  min-width: 0;
  height: 100%;
}

.panel--stage {
  height: 100%;
}

.panel--stage :deep(.card-body) {
  height: 100%;
}

.stage-shell {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  min-height: 0;
}

/* Outer frame wrapping the canvas */
.preview-frame {
  border-radius: 16px;
  padding: 8px;
  background:
    radial-gradient(circle at top, rgba(56, 189, 248, 0.1), transparent 50%),
    rgba(15, 23, 42, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.16);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  width: 100%;
}

/* Aspect-ratio square viewport to prevent Grid vertical collapse */
.preview-canvas {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  max-height: 74vh;
  overflow: hidden;
  border-radius: 12px;
  background: #08111f;
  isolation: isolate;
  user-select: none;
}

/* Zoomable/pannable transform layer containing coordinates */
.map-transform-container {
  position: absolute;
  width: 1000px;
  height: 1000px;
  transform-origin: 0 0;
  background-color: #020205;
  box-shadow: 0 0 40px rgba(0, 0, 0, 0.85);
  will-change: transform;
}

.preview-map-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  position: relative;
  z-index: 1;
  opacity: 0.9;
  filter: contrast(1.05) brightness(0.9);
}

.map-grid-pattern {
  position: absolute;
  inset: 0;
  background-size: 25px 25px;
  background-image:
    linear-gradient(to right, rgba(56, 189, 248, 0.04) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(56, 189, 248, 0.04) 1px, transparent 1px);
  pointer-events: none;
  z-index: 2;
}

/* Floating Zoom controls */
.map-utility-controls {
  position: absolute;
  bottom: 14px;
  left: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 50;
  pointer-events: auto;
}

.map-ctrl-btn {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #f8fafc;
  font-size: 15px;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
  transition: all 0.2s ease;
}

.map-ctrl-btn:hover {
  background: #38bdf8;
  color: #0f172a;
  border-color: #38bdf8;
  transform: translateY(-1px);
}

.map-ctrl-btn:active {
  transform: translateY(0);
}

/* Map Markers */
.preview-marker {
  position: absolute;
  transform-origin: center center;
  pointer-events: auto;
  cursor: pointer;
  z-index: 10;
  display: flex;
  align-items: center;
}

.preview-dot {
  display: block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid #ffffff;
  box-shadow: 0 0 6px rgba(0, 0, 0, 0.6);
  transition: transform 0.2s ease;
}

.preview-marker.team-1 .preview-dot {
  background: #3b82f6;
}

.preview-marker.team-2 .preview-dot {
  background: #ef4444;
}

.preview-marker.team-0 .preview-dot {
  background: #f59e0b;
}

.preview-marker.is-dead .preview-dot {
  background: #475569;
  border-color: #94a3b8;
}

.preview-marker:hover .preview-dot,
.preview-marker.is-hovered .preview-dot {
  transform: scale(1.3);
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.9);
  z-index: 30;
}

.preview-marker.is-vehicle .preview-dot {
  border-radius: 2px;
  transform: rotate(45deg);
}

.preview-marker.is-vehicle:hover .preview-dot,
.preview-marker.is-vehicle.is-hovered .preview-dot {
  transform: rotate(45deg) scale(1.3);
}

.preview-label {
  display: inline-block;
  margin-left: 6px;
  padding: 2px 6px;
  border-radius: 99px;
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #f8fafc;
  font-size: 10px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0.85;
  transition: all 0.2s ease;
}

.preview-marker:hover .preview-label,
.preview-marker.is-hovered .preview-label {
  opacity: 1;
  background: rgba(15, 23, 42, 0.95);
  border-color: rgba(255, 255, 255, 0.2);
}

/* Player direction indicators */
.marker-direction {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 24px;
  height: 24px;
  transform-origin: center center;
  pointer-events: none;
  z-index: 1;
}

.direction-arrow {
  position: absolute;
  top: -6px;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-bottom: 6px solid #ffffff;
}

.team-1 .direction-arrow {
  border-bottom-color: #3b82f6;
}

.team-2 .direction-arrow {
  border-bottom-color: #ef4444;
}

.team-0 .direction-arrow {
  border-bottom-color: #f59e0b;
}

.is-dead .direction-arrow {
  display: none;
}

/* Tooltip style */
.player-tooltip {
  position: absolute;
  width: 180px;
  background: rgba(15, 23, 42, 0.96);
  border: 1.5px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  padding: 8px 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(12px);
  z-index: 100;
  pointer-events: none;
  animation: tooltip-fade-in 0.15s ease-out;
}

@keyframes tooltip-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.player-tooltip.team-1 {
  border-color: rgba(59, 130, 246, 0.6) !important;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.85), 0 0 15px rgba(59, 130, 246, 0.25);
}

.player-tooltip.team-2 {
  border-color: rgba(239, 68, 68, 0.6) !important;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.85), 0 0 15px rgba(239, 68, 68, 0.25);
}

.player-tooltip.team-0 {
  border-color: rgba(245, 158, 11, 0.6) !important;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.85), 0 0 15px rgba(245, 158, 11, 0.25);
}

.tooltip-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 5px;
}

.tooltip-name {
  font-weight: bold;
  font-size: 11px;
  color: #ffffff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.tooltip-health-badge {
  font-size: 9px;
  font-family: monospace;
  padding: 2px 5px;
  border-radius: 4px;
  font-weight: bold;
  color: #10b981;
  background: rgba(16, 185, 129, 0.12);
}

.tooltip-health-badge.low-health {
  color: #ffd54f;
  background: rgba(253, 216, 53, 0.12);
}

.tooltip-health-badge.dead-health {
  color: #ef5350;
  background: rgba(239, 83, 80, 0.15);
}

.tooltip-divider {
  height: 1px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.15), transparent);
  margin: 6px 0;
}

.tooltip-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: #94a3b8;
}

.detail-label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.detail-val {
  color: #e2e8f0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.inline-kit-mask {
  display: inline-block;
  width: 12px;
  height: 12px;
}

.inline-kit-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  font-size: 9px;
  font-weight: 700;
  color: #cbd5e1;
}

.squad-color-pill {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.player-tooltip.team-1 .squad-color-pill {
  background: #3b82f6;
}

.player-tooltip.team-2 .squad-color-pill {
  background: #ef4444;
}

.player-tooltip.team-0 .squad-color-pill {
  background: #f59e0b;
}

.highlight-cyan {
  color: #22d3ee;
}

.tooltip-health-track {
  width: 100%;
  height: 3px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 99px;
  margin-top: 8px;
  overflow: hidden;
}

.tooltip-health-bar {
  height: 100%;
  transition: width 0.15s ease-out;
}

/* Media Deck styling */
.media-deck {
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 16px;
  padding: 16px;
  display: grid;
  gap: 12px;
  flex-shrink: 0;
}

.timeline-container {
  display: flex;
  align-items: center;
  position: relative;
}

.timeline-range {
  width: 100%;
  height: 6px;
  -webkit-appearance: none;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 99px;
  outline: none;
  cursor: pointer;
  transition: all 0.2s ease;
}

.timeline-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #38bdf8;
  border: 2px solid #ffffff;
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.5);
  transition: transform 0.1s ease;
}

.timeline-range::-webkit-slider-thumb:hover {
  transform: scale(1.25);
}

.media-controls-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.playback-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ctrl-btn {
  background: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  color: #cbd5e1;
  padding: 6px 12px;
  border-radius: 10px;
  cursor: pointer;
  font-weight: 600;
  font-size: 13px;
  transition: all 0.2s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ctrl-btn:hover:not(:disabled) {
  background: rgba(56, 189, 248, 0.1);
  border-color: #38bdf8;
  color: #ffffff;
}

.ctrl-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.play-pause-btn {
  min-width: 90px;
  background: #0284c7;
  border-color: #38bdf8;
  color: #ffffff;
}

.play-pause-btn:hover:not(:disabled) {
  background: #0369a1;
  color: #ffffff;
}

.playback-status {
  display: flex;
  align-items: center;
  gap: 20px;
  background: rgba(15, 23, 42, 0.6);
  padding: 6px 16px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.1);
}

.status-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.status-item .label {
  font-size: 9px;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.status-item strong {
  font-size: 12px;
  color: #e2e8f0;
}

.playback-speed {
  display: flex;
  align-items: center;
  gap: 8px;
}

.speed-label {
  font-size: 12px;
  color: #94a3b8;
}

.speed-badges {
  display: flex;
  background: rgba(30, 41, 59, 0.6);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 10px;
  padding: 2px;
  overflow: hidden;
}

.speed-badge-btn {
  border: none;
  background: transparent;
  color: #94a3b8;
  font-size: 11px;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.speed-badge-btn:hover {
  color: #f8fafc;
}

.speed-badge-btn.active {
  background: #38bdf8;
  color: #0f172a;
}

/* Stage Actions Buttons */
.stage-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  flex-shrink: 0;
}

.stage-btn {
  min-height: 42px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.stage-btn.outline {
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(30, 41, 59, 0.6);
  color: #cbd5e1;
}

.stage-btn.outline:hover:not(:disabled) {
  border-color: #38bdf8;
  color: #ffffff;
  background: rgba(56, 189, 248, 0.1);
}

.stage-btn.primary {
  background: #0284c7;
  border: 1px solid #38bdf8;
  color: #ffffff;
}

.stage-btn.primary:hover:not(:disabled) {
  background: #0369a1;
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.3);
}

.stage-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

@media (max-width: 1200px) {
  .metric-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .metric-strip {
    grid-template-columns: 1fr;
  }
  .field-grid {
    grid-template-columns: 1fr;
  }
  .media-controls-bar {
    flex-direction: column;
    align-items: stretch;
  }
  .playback-buttons, .playback-status, .playback-speed {
    justify-content: center;
  }
  .stage-actions {
    grid-template-columns: 1fr;
  }
}
</style>
