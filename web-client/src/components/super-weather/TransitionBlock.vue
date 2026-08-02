<template>
  <button
    type="button"
    class="transition-block"
    :class="{ selected, current }"
    :style="{ flexGrow: String(Math.max(1, segment.durationSeconds)) }"
    @click="$emit('select')"
  >
    <span>TRANS</span>
    <strong>{{ formatDuration(segment.durationSeconds) }}</strong>
    <small>{{ fromName }} → {{ toName }}</small>
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { SUPER_WEATHER_NAMES, type SuperWeatherTransitionSegment } from "../../app/superWeatherApi";

const props = defineProps<{
  segment: SuperWeatherTransitionSegment;
  fromWeather: number;
  toWeather: number;
  selected?: boolean;
  current?: boolean;
}>();
defineEmits<{ select: [] }>();
const fromName = computed(() => SUPER_WEATHER_NAMES[props.fromWeather] ?? `Weather ${props.fromWeather}`);
const toName = computed(() => SUPER_WEATHER_NAMES[props.toWeather] ?? `Weather ${props.toWeather}`);

function formatDuration(value: number) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
</script>

<style scoped>
.transition-block {
  min-width: 98px;
  max-width: 180px;
  min-height: 118px;
  padding: 10px;
  border: 1px solid rgba(189, 128, 255, .36);
  border-radius: 11px;
  background:
    repeating-linear-gradient(125deg, rgba(180, 99, 255, .18) 0 9px, rgba(63, 198, 255, .08) 9px 18px),
    linear-gradient(145deg, rgba(70, 35, 95, .95), rgba(17, 26, 43, .96));
  color: #f1e8ff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
}
.transition-block:hover { border-color: rgba(205, 148, 255, .72); }
.transition-block.selected { outline: 2px solid #c58cff; outline-offset: 2px; }
.transition-block.current { box-shadow: 0 0 24px rgba(185, 105, 255, .3); }
span { color: #d7a5ff; font-size: 9px; letter-spacing: .18em; }
strong { font-family: ui-monospace, monospace; }
small { max-width: 140px; color: rgba(238, 222, 255, .7); font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
