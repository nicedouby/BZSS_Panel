<template>
  <AppPage full-bleed class="tactical-replay-page">
    <AppPageHeader
      title="战术地图回放"
      subtitle="查看自动录制的战术地图轨迹，按玩家筛选并导出 MP4。"
      :status-items="headerStatusItems"
    >
      <template #actions>
        <button type="button" class="action-btn ghost" :disabled="loadingSegments" @click="loadSegments">
          {{ loadingSegments ? "刷新中..." : "刷新列表" }}
        </button>
        <button type="button" class="action-btn primary" :disabled="!selectedSegment || exportBusy" @click="submitExport">
          {{ exportBusy ? "导出中..." : "导出 MP4" }}
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

    <section class="workspace-shell">
      <aside class="sidebar">
        <AppCard compact title="筛选与控制" body-mode="scroll" class="panel panel--controls">
          <div class="field-grid">
            <label class="control-field control-field--wide">
              <span>玩家筛选</span>
              <textarea v-model="playerFilterText" rows="3" placeholder="每行一个玩家名，或用逗号分隔"></textarea>
            </label>
            <label class="control-field">
              <span>开始时间</span>
              <input v-model.number="fromMsInput" type="number" min="0">
            </label>
            <label class="control-field">
              <span>结束时间</span>
              <input v-model.number="toMsInput" type="number" min="0">
            </label>
            <label class="control-field">
              <span>倍速</span>
              <select v-model.number="speed">
                <option :value="0.25">0.25x</option>
                <option :value="0.5">0.5x</option>
                <option :value="1">1x</option>
                <option :value="2">2x</option>
                <option :value="4">4x</option>
                <option :value="8">8x</option>
              </select>
            </label>
          </div>

          <div class="control-actions">
            <button type="button" class="action-btn" :disabled="!selectedSegment || loadingFrames" @click="loadFrames">
              {{ loadingFrames ? "加载中..." : "加载回放" }}
            </button>
            <button type="button" class="action-btn" :disabled="!frames.length" @click="togglePlayback">
              {{ playing ? "暂停" : "播放" }}
            </button>
          </div>
        </AppCard>

        <AppCard compact title="回放片段" description="人数大于 50 时自动录制，按地图切换和断流自动分段。" body-mode="scroll" class="panel">
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
              <strong>{{ segment.mapName || segment.mapKey }}</strong>
              <span>{{ segment.layer || "--" }}</span>
              <span>{{ formatDate(segment.startedAt) }}</span>
              <span>{{ formatDuration(segment.durationMs) }} / {{ segment.frameCount }} 帧</span>
            </button>
          </div>
        </AppCard>

        <AppCard compact title="导出任务" description="完成后可直接下载 MP4。" body-mode="scroll" class="panel">
          <div v-if="!exportTasks.length" class="empty-state">暂无导出任务</div>
          <div v-else class="task-list">
            <div v-for="task in exportTasks" :key="task.id" class="task-item">
              <div class="task-main">
                <strong>{{ task.outputFileName }}</strong>
                <span>{{ task.status }}</span>
                <span>{{ task.frameCount }} 帧 / {{ task.speed }}x</span>
              </div>
              <div class="task-actions">
                <a v-if="task.status === 'completed'" class="action-btn sm" :href="exportFileUrl(task.id)">下载</a>
                <span v-else-if="task.error" class="task-error">{{ task.error }}</span>
              </div>
            </div>
          </div>
        </AppCard>
      </aside>

      <main class="stage">
        <AppCard
          compact
          body-mode="scroll"
          overflow="clip"
          title="回放舞台"
          :description="selectedSegment ? `${selectedSegment.mapName || selectedSegment.mapKey} / ${selectedSegment.layer || '--'}` : '未选择片段'"
          class="panel panel--stage"
        >
          <div class="stage-shell">
            <div class="stage-meta">
              <div class="stage-meta-item">
                <span class="stage-meta-label">当前帧</span>
                <strong>{{ frames.length ? currentFrameIndex + 1 : 0 }} / {{ frames.length }}</strong>
              </div>
              <div class="stage-meta-item">
                <span class="stage-meta-label">时间</span>
                <strong>{{ currentFrame ? formatDate(currentFrame.timestampMs) : "--" }}</strong>
              </div>
              <div class="stage-meta-item">
                <span class="stage-meta-label">筛选玩家</span>
                <strong>{{ filteredPlayerNames.length || 0 }}</strong>
              </div>
            </div>

            <div class="preview-frame">
              <div class="preview-canvas">
                <img
                  v-if="activeMapConfig"
                  class="preview-map-image"
                  :src="activeMapConfig.image"
                  alt="tactical map"
                >
                <div
                  v-for="player in currentMarkers"
                  :key="`${player.playerGuid || player.playerName}-${player.playerName}`"
                  class="preview-marker"
                  :class="`team-${player.teamId || 0}`"
                  :style="{ left: `${player.mapX}%`, top: `${player.mapY}%` }"
                >
                  <span class="preview-dot"></span>
                  <span class="preview-label">{{ player.playerName }}</span>
                </div>
              </div>
            </div>

            <div class="timeline-shell">
              <div class="timeline-header">
                <span>时间轴</span>
                <span>{{ currentFrame ? formatDate(currentFrame.timestampMs) : "未加载" }}</span>
              </div>
              <input
                v-model.number="currentFrameIndex"
                class="timeline-range"
                type="range"
                min="0"
                :max="Math.max(0, frames.length - 1)"
                :disabled="!frames.length"
              >
            </div>

            <div class="stage-actions">
              <button type="button" class="action-btn" :disabled="!selectedSegment || loadingFrames" @click="loadFrames">
                {{ loadingFrames ? "重新加载中..." : "重新加载回放" }}
              </button>
              <button type="button" class="action-btn primary" :disabled="!selectedSegment || exportBusy" @click="submitExport">
                {{ exportBusy ? "导出中..." : "导出 MP4" }}
              </button>
            </div>
          </div>
        </AppCard>
      </main>
    </section>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import AppPage from "../components/common/AppPage.vue";
import AppPageHeader from "../components/common/AppPageHeader.vue";
import AppCard from "../components/common/AppCard.vue";
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

interface PreviewMarker {
  playerGuid: string;
  playerName: string;
  teamId: number | null;
  mapX: number;
  mapY: number;
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
      return {
        playerGuid: player.playerGuid,
        playerName: player.playerName,
        teamId: player.teamId,
        mapX: project(position.x, bounds.minX, bounds.maxX),
        mapY: project(position.y, bounds.minY, bounds.maxY),
      };
    })
    .filter((item): item is PreviewMarker => Boolean(item));
});

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
});

onBeforeUnmount(() => {
  stopPlayback();
});
</script>

<style scoped>
.tactical-replay-page {
  gap: 18px;
}

.metric-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.metric-tile {
  padding: 14px 16px;
  border-radius: 18px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.01)),
    rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow: 0 16px 32px rgba(2, 6, 23, 0.2);
  display: grid;
  gap: 4px;
  min-width: 0;
}

.metric-tile.accent {
  border-color: rgba(56, 189, 248, 0.32);
  background:
    radial-gradient(circle at top right, rgba(56, 189, 248, 0.16), transparent 52%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.01)),
    rgba(15, 23, 42, 0.84);
}

.metric-label {
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #94a3b8;
}

.metric-value {
  font-size: 24px;
  line-height: 1.1;
  color: #f8fafc;
}

.metric-hint {
  font-size: 12px;
  color: #cbd5e1;
}

.workspace-shell {
  display: grid;
  grid-template-columns: minmax(320px, 420px) minmax(0, 1fr);
  gap: 16px;
  min-width: 0;
  align-items: start;
}

.sidebar,
.stage {
  min-width: 0;
}

.sidebar {
  display: grid;
  gap: 16px;
  position: sticky;
  top: 16px;
  align-self: start;
}

.stage {
  min-width: 0;
}

.panel {
  min-width: 0;
}

.panel :deep(.card-body) {
  min-width: 0;
}

.panel--controls :deep(.card-body) {
  display: grid;
  gap: 14px;
}

.panel--stage :deep(.card-body) {
  display: grid;
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
.control-field input,
.control-field select {
  width: 100%;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(15, 23, 42, 0.82);
  color: #f8fafc;
  border-radius: 12px;
  padding: 10px 12px;
  outline: none;
}

.control-field textarea:focus,
.control-field input:focus,
.control-field select:focus {
  border-color: rgba(56, 189, 248, 0.75);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.16);
}

.control-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.segment-list,
.task-list {
  display: grid;
  gap: 10px;
}

.segment-item {
  display: grid;
  gap: 4px;
  text-align: left;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(15, 23, 42, 0.72);
  color: #e2e8f0;
}

.segment-item.selected {
  border-color: rgba(56, 189, 248, 0.62);
  box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.35);
  background: rgba(8, 47, 73, 0.6);
}

.task-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.14);
}

.task-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.task-error {
  color: #fca5a5;
  font-size: 12px;
}

.stage-shell {
  display: grid;
  gap: 14px;
  min-width: 0;
}

.stage-meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.stage-meta-item {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.14);
}

.stage-meta-label {
  font-size: 12px;
  color: #94a3b8;
}

.stage-meta-item strong {
  color: #f8fafc;
  font-size: 14px;
}

.preview-frame {
  border-radius: 20px;
  padding: 14px;
  background:
    radial-gradient(circle at top, rgba(56, 189, 248, 0.14), transparent 42%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(2, 6, 23, 0.96));
  border: 1px solid rgba(148, 163, 184, 0.16);
  overflow: hidden;
}

.preview-canvas {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  max-height: 76vh;
  overflow: hidden;
  border-radius: 16px;
  background: #08111f;
  isolation: isolate;
}

.preview-map-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  position: relative;
  z-index: 1;
}

.preview-marker {
  position: absolute;
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 2;
}

.preview-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  border: 2px solid #ffffff;
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

.preview-label {
  display: inline-block;
  margin-left: 8px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(2, 6, 23, 0.84);
  color: #f8fafc;
  font-size: 12px;
  white-space: nowrap;
}

.timeline-shell {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.14);
}

.timeline-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  color: #cbd5e1;
  font-size: 12px;
}

.timeline-range {
  width: 100%;
  display: block;
}

.stage-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.empty-state {
  padding: 18px;
  color: #94a3b8;
}

@media (max-width: 1240px) {
  .workspace-shell {
    grid-template-columns: 1fr;
  }

  .sidebar {
    position: static;
  }
}

@media (max-width: 1100px) {
  .metric-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .stage-meta {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .metric-strip {
    grid-template-columns: 1fr;
  }

  .field-grid {
    grid-template-columns: 1fr;
  }

  .control-field--wide {
    grid-column: auto;
  }

  .stage-actions,
  .control-actions {
    flex-direction: column;
  }
}
</style>
