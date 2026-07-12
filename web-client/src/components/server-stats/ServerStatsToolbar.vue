<template>
  <div class="stats-toolbar">
    <!-- Left: Server info and status -->
    <div class="toolbar-left">
      <div class="title-wrap">
        <h1 class="page-title">服务器统计</h1>
        <div class="server-meta">
          <span class="server-name">{{ currentServer?.name || 'BZSS Server' }}</span>
          <span class="meta-separator">•</span>
          <ServerStatsStaleBadge :is-polling="isPolling" :is-stale="isStale" />
        </div>
      </div>
    </div>

    <!-- Center: Active Match info -->
    <div class="toolbar-center">
      <div v-if="currentMatch" class="match-summary">
        <div class="match-cell">
          <span class="cell-label">地图与图层</span>
          <span class="cell-value" :title="currentMatch.layer">{{ currentMatch.map }} / {{ getLayerShort(currentMatch.layer) }}</span>
        </div>
        <div class="match-divider" />
        <div class="match-cell">
          <span class="cell-label">对局阶段</span>
          <span class="cell-value phase-badge" :class="currentMatch.phase">{{ getPhaseText(currentMatch.phase) }}</span>
        </div>
        <div class="match-divider" />
        <div class="match-cell">
          <span class="cell-label">已进行</span>
          <span class="cell-value monospace">{{ matchDurationText }}</span>
        </div>
      </div>
      <div v-else class="match-empty">
        暂无活跃对局信息
      </div>
    </div>

    <!-- Right: Filters & Controls -->
    <div class="toolbar-right">
      <!-- Horizontal Segmented Control for Time Window -->
      <div class="segmented-control">
        <button
          v-for="r in SERVER_METRIC_RANGES"
          :key="r.key"
          class="segment-btn"
          :class="{ active: selectedRange === r.key && !hasCustomSelection }"
          @click="emit('set-range', r.key)"
        >
          {{ r.label }}
        </button>
      </div>

      <div class="control-actions">
        <!-- Date Picker Button -->
        <button
          class="action-btn"
          :class="{ active: hasCustomSelection }"
          title="选择历史日期进行对比/查看"
          @click="emit('open-dates')"
        >
          📅 <span class="btn-text">历史日期</span>
        </button>

        <!-- Refresh Button -->
        <button class="action-btn refresh-btn" :disabled="loading" @click="emit('refresh')">
          <span class="refresh-icon" :class="{ spin: loading }">↺</span>
          <span class="btn-text">{{ loading ? '载入中' : '刷新' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import ServerStatsStaleBadge from "./ServerStatsStaleBadge.vue";
import { SERVER_METRIC_RANGES, type ServerMetricRangeKey } from "../../composables/useServerMetricsRange";
import type { ServerDetails, MatchDetails } from "../../composables/useServerMetrics";

const props = defineProps<{
  currentServer: ServerDetails | null;
  currentMatch: MatchDetails | null;
  selectedRange: ServerMetricRangeKey;
  hasCustomSelection: boolean;
  isPolling: boolean;
  isStale: boolean;
  loading: boolean;
}>();

const emit = defineEmits<{
  (event: "set-range", range: ServerMetricRangeKey): void;
  (event: "open-dates"): void;
  (event: "refresh"): void;
}>();

const matchDurationText = ref("00:00:00");
let timerId: any = null;

function updateMatchDuration() {
  if (!props.currentMatch || !props.currentMatch.startedAt) {
    matchDurationText.value = "--:--:--";
    return;
  }

  const startMs = props.currentMatch.startedAt;
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000));

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  matchDurationText.value = [
    hours.toString().padStart(2, "0"),
    minutes.toString().padStart(2, "0"),
    seconds.toString().padStart(2, "0"),
  ].join(":");
}

function getLayerShort(layer: string) {
  if (!layer || layer === "Unknown") return "未知图层";
  return layer.split("_").pop() || layer;
}

function getPhaseText(phase: string) {
  if (!phase) return "未知";
  const mapped: Record<string, string> = {
    warmup: "预热阶段",
    active: "进行中",
    loading: "载入中",
    over: "已结束",
  };
  return mapped[phase.toLowerCase()] || phase;
}

watch(() => props.currentMatch?.startedAt, () => {
  updateMatchDuration();
});

onMounted(() => {
  updateMatchDuration();
  timerId = setInterval(updateMatchDuration, 1000);
});

onUnmounted(() => {
  if (timerId) clearInterval(timerId);
});
</script>

<style scoped>
.stats-toolbar {
  height: 64px;
  min-height: 64px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--stats-panel, var(--color-bg-card));
  border-bottom: 1px solid var(--stats-panel-border, var(--color-border-soft));
  backdrop-filter: blur(10px);
  gap: 16px;
  flex-shrink: 0;
}

/* Left Section */
.toolbar-left {
  display: flex;
  align-items: center;
}

.title-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.page-title {
  font-size: 15px;
  font-weight: 800;
  color: var(--color-text-primary);
  margin: 0;
}

.server-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.server-name {
  font-size: 11px;
  color: var(--color-text-muted);
  font-weight: 600;
}

.meta-separator {
  color: var(--color-text-disabled);
  font-size: 10px;
}

/* Center Section */
.toolbar-center {
  flex: 1;
  display: flex;
  justify-content: center;
  max-width: 45%;
}

.match-summary {
  display: flex;
  align-items: center;
  background: color-mix(in srgb, var(--color-bg-elevated) 88%, transparent);
  border: 1px solid var(--color-border-soft);
  padding: 4px 14px;
  border-radius: var(--control-radius, 10px);
  gap: 12px;
}

.match-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.cell-label {
  font-size: 9px;
  color: var(--color-text-muted);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.cell-value {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-primary);
  max-width: 140px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.phase-badge {
  padding: 0 4px;
  border-radius: 4px;
  font-size: 10px;
}

.phase-badge.warmup {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.phase-badge.active {
  background: rgba(52, 211, 153, 0.15);
  color: #34d399;
}

.monospace {
  font-family: 'JetBrains Mono', monospace;
}

.match-divider {
  width: 1px;
  height: 20px;
  background: var(--color-border-soft);
}

.match-empty {
  font-size: 12px;
  color: var(--color-text-muted);
  font-style: italic;
}

/* Right Section */
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* Horizontal Segmented Control */
.segmented-control {
  display: flex;
  background: color-mix(in srgb, var(--color-bg-elevated) 88%, transparent);
  border: 1px solid var(--color-border-soft);
  padding: 2px;
  border-radius: var(--control-radius, 10px);
}

.segment-btn {
  height: 28px;
  padding: 0 10px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.15s ease;
}

.segment-btn:hover {
  color: var(--color-text-primary);
}

.segment-btn.active {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}

.control-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-btn {
  height: 32px;
  padding: 0 10px;
  border-radius: var(--control-radius, 10px);
  border: 1px solid var(--color-border-default);
  background: color-mix(in srgb, var(--color-bg-elevated) 88%, transparent);
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.14s ease;
}

.action-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
  border-color: var(--color-border-highlight);
}

.action-btn.active {
  border-color: var(--color-border-highlight);
  background: rgba(96, 165, 250, 0.1);
  color: #60a5fa;
}

.refresh-btn {
  background: rgba(37, 99, 235, 0.15);
  color: #93c5fd;
  border-color: rgba(37, 99, 235, 0.3);
}

.refresh-btn:hover {
  background: rgba(37, 99, 235, 0.25);
  color: #bfdbfe;
}

.refresh-icon {
  font-size: 13px;
  display: inline-block;
}

.refresh-icon.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Responsiveness */
@media (max-width: 1200px) {
  .toolbar-center {
    display: none;
  }
}

@media (max-width: 768px) {
  .stats-toolbar {
    height: auto;
    flex-direction: column;
    padding: 12px;
    align-items: stretch;
    gap: 10px;
  }

  .toolbar-right {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .segmented-control {
    overflow-x: auto;
  }

  .btn-text {
    display: none;
  }
}
</style>
