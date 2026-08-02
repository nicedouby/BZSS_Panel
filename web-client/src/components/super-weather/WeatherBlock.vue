<template>
  <div
    class="weather-block"
    :class="{ selected, current, dragging }"
    :style="{ left: `${leftPercent}%`, width: `${widthPercent}%` }"
    draggable="true"
    @dragstart="$emit('drag-start', $event)"
    @dragend="$emit('drag-end')"
    @dragover.prevent
    @drop.prevent="$emit('drop', $event)"
  >
    <button type="button" class="block-content" @click="$emit('select')">
      <span class="kind">WEATHER {{ segment.weatherType }}</span>
      <strong>{{ weatherName }}</strong>
      <span>{{ formatDuration(segment.durationSeconds) }}</span>
      <small>{{ formatDuration(startSeconds) }} → {{ formatDuration(endSeconds) }}</small>
    </button>
    <button
      type="button"
      class="duration-handle"
      title="Drag to change weather duration"
      aria-label="Drag to change weather duration"
      draggable="false"
      @pointerdown.stop.prevent="$emit('resize-start', $event)"
      @dragstart.prevent
    ></button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { SUPER_WEATHER_NAMES, type SuperWeatherWeatherSegment } from "../../app/superWeatherApi";

const props = defineProps<{
  segment: SuperWeatherWeatherSegment;
  startSeconds: number;
  endSeconds: number;
  leftPercent: number;
  widthPercent: number;
  selected?: boolean;
  current?: boolean;
  dragging?: boolean;
}>();
defineEmits<{
  select: [];
  "resize-start": [event: PointerEvent];
  "drag-start": [event: DragEvent];
  "drag-end": [];
  drop: [event: DragEvent];
}>();
const weatherName = computed(() => SUPER_WEATHER_NAMES[props.segment.weatherType] ?? `Weather ${props.segment.weatherType}`);

function formatDuration(value: number) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
</script>

<style scoped>
.weather-block {
  position: absolute;
  top: 36px;
  bottom: 12px;
  min-width: 20px;
  border: 1px solid rgba(71, 178, 255, 0.24);
  border-radius: 11px;
  background: linear-gradient(145deg, rgba(24, 70, 105, 0.94), rgba(12, 25, 42, 0.96));
  color: #e9f6ff;
  box-shadow: inset 0 1px rgba(255, 255, 255, 0.05);
  overflow: hidden;
  cursor: grab;
  user-select: none;
}
.weather-block:hover { border-color: rgba(85, 203, 255, 0.62); }
.weather-block.selected { outline: 2px solid #5ad6ff; outline-offset: 2px; z-index: 2; }
.weather-block.current { box-shadow: 0 0 24px rgba(38, 178, 255, 0.26), inset 0 1px rgba(255,255,255,.08); }
.weather-block.dragging { opacity: .42; cursor: grabbing; }
.block-content {
  width: 100%;
  height: 100%;
  padding: 13px 18px 13px 13px;
  border: 0;
  background: transparent;
  color: inherit;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 4px;
  text-align: left;
  overflow: hidden;
}
.block-content > * { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kind { color: #68d7ff; font-size: 9px; letter-spacing: .14em; }
strong { font-size: 15px; }
small { color: rgba(213, 232, 245, .58); font-family: ui-monospace, monospace; }
.duration-handle {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 12px;
  padding: 0;
  border: 0;
  border-left: 1px solid rgba(115, 210, 250, .12);
  background: linear-gradient(90deg, transparent, rgba(83, 203, 250, .13));
  cursor: ew-resize;
  touch-action: none;
}
.duration-handle:hover { background: rgba(91, 213, 255, .28); }
</style>
