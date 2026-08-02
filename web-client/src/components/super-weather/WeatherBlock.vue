<template>
  <button
    type="button"
    class="weather-block"
    :class="{ selected, current }"
    :style="{ flexGrow: String(Math.max(1, segment.durationSeconds)) }"
    @click="$emit('select')"
  >
    <span class="kind">WEATHER {{ segment.weatherType }}</span>
    <strong>{{ weatherName }}</strong>
    <span>{{ formatDuration(segment.durationSeconds) }}</span>
    <small>{{ formatDuration(startSeconds) }} → {{ formatDuration(endSeconds) }}</small>
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { SUPER_WEATHER_NAMES, type SuperWeatherWeatherSegment } from "../../app/superWeatherApi";

const props = defineProps<{
  segment: SuperWeatherWeatherSegment;
  startSeconds: number;
  endSeconds: number;
  selected?: boolean;
  current?: boolean;
}>();
defineEmits<{ select: [] }>();
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
  min-width: 154px;
  min-height: 118px;
  padding: 14px;
  border: 1px solid rgba(71, 178, 255, 0.24);
  border-radius: 13px;
  background: linear-gradient(145deg, rgba(24, 70, 105, 0.94), rgba(12, 25, 42, 0.96));
  color: #e9f6ff;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 5px;
  text-align: left;
  box-shadow: inset 0 1px rgba(255, 255, 255, 0.05);
}
.weather-block:hover { border-color: rgba(85, 203, 255, 0.62); }
.weather-block.selected { outline: 2px solid #5ad6ff; outline-offset: 2px; }
.weather-block.current { box-shadow: 0 0 24px rgba(38, 178, 255, 0.26), inset 0 1px rgba(255,255,255,.08); }
.kind { color: #68d7ff; font-size: 9px; letter-spacing: .14em; }
strong { font-size: 17px; }
small { color: rgba(213, 232, 245, .58); font-family: ui-monospace, monospace; }
</style>
