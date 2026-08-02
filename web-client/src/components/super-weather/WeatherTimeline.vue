<template>
  <div class="timeline-shell">
    <div class="timeline-ruler">
      <span>00:00</span>
      <span>{{ formatDuration(totalSeconds) }}</span>
    </div>
    <div ref="track" class="timeline-track">
      <div
        v-if="logicalSeconds != null && totalSeconds > 0"
        class="playhead"
        :style="{ left: `${playheadPercent}%` }"
      >
        <span>{{ formatDuration(logicalSeconds) }}</span>
      </div>
      <template v-for="item in layout" :key="item.segment.id">
        <WeatherBlock
          v-if="item.segment.type === 'weather'"
          :segment="item.segment"
          :start-seconds="item.startSeconds"
          :end-seconds="item.endSeconds"
          :selected="item.segment.id === selectedId"
          :current="item.segment.id === currentSegmentId"
          @select="$emit('select', item.segment.id)"
        />
        <TransitionBlock
          v-else
          :segment="item.segment"
          :from-weather="weatherAround(item.index, -1)"
          :to-weather="weatherAround(item.index, 1)"
          :selected="item.segment.id === selectedId"
          :current="item.segment.id === currentSegmentId"
          @select="$emit('select', item.segment.id)"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { SuperWeatherSegment } from "../../app/superWeatherApi";
import WeatherBlock from "./WeatherBlock.vue";
import TransitionBlock from "./TransitionBlock.vue";

const props = defineProps<{
  timeline: SuperWeatherSegment[];
  selectedId?: string;
  currentSegmentId?: string;
  logicalSeconds?: number | null;
}>();
defineEmits<{ select: [id: string] }>();

const layout = computed(() => {
  let cursor = 0;
  return props.timeline.map((segment, index) => {
    const startSeconds = cursor;
    cursor += Math.max(1, Number(segment.durationSeconds) || 1);
    return { segment, index, startSeconds, endSeconds: cursor };
  });
});
const totalSeconds = computed(() => layout.value.at(-1)?.endSeconds ?? 0);
const playheadPercent = computed(() => Math.min(100, Math.max(0, ((Number(props.logicalSeconds) || 0) / totalSeconds.value) * 100)));

function weatherAround(index: number, direction: -1 | 1) {
  const segment = props.timeline[index + direction];
  return segment?.type === "weather" ? segment.weatherType : 0;
}

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
.timeline-shell { min-width: 0; }
.timeline-ruler { display: flex; justify-content: space-between; padding: 0 4px 7px; color: rgba(202, 221, 235, .54); font: 10px ui-monospace, monospace; }
.timeline-track {
  position: relative;
  display: flex;
  align-items: stretch;
  gap: 8px;
  min-width: max-content;
  padding: 26px 6px 6px;
}
.playhead {
  position: absolute;
  z-index: 5;
  top: 11px;
  bottom: 0;
  width: 2px;
  background: #f8d25d;
  box-shadow: 0 0 12px rgba(248, 210, 93, .78);
  pointer-events: none;
}
.playhead::before { content: ""; position: absolute; top: -5px; left: -4px; border: 5px solid transparent; border-top-color: #f8d25d; }
.playhead span { position: absolute; top: -23px; left: 7px; color: #ffe9a5; font: 10px ui-monospace, monospace; white-space: nowrap; }
</style>
