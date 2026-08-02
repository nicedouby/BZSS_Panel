<template>
  <div class="transition-node" :class="{ selected, current }" :style="{ left: `${leftPercent}%` }">
    <button type="button" :title="`${fromName} → ${toName}: ${formatDuration(source.transitionToNextSeconds)}`" @click="$emit('select')">
      <span class="arrow">→</span>
      <strong>{{ formatDuration(source.transitionToNextSeconds) }}</strong>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { SUPER_WEATHER_NAMES, type SuperWeatherWeatherSegment } from "../../app/superWeatherApi";

const props = defineProps<{
  source: SuperWeatherWeatherSegment;
  target: SuperWeatherWeatherSegment;
  leftPercent: number;
  selected?: boolean;
  current?: boolean;
}>();
defineEmits<{ select: [] }>();
const fromName = computed(() => SUPER_WEATHER_NAMES[props.source.weatherType] ?? `Weather ${props.source.weatherType}`);
const toName = computed(() => SUPER_WEATHER_NAMES[props.target.weatherType] ?? `Weather ${props.target.weatherType}`);

function formatDuration(value: number) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}
</script>

<style scoped>
.transition-node {
  position: absolute;
  z-index: 5;
  top: 44px;
  bottom: 20px;
  width: 0;
  border-left: 1px dashed rgba(206, 153, 255, .48);
  pointer-events: none;
}
.transition-node button {
  position: absolute;
  top: 50%;
  left: 0;
  min-width: 44px;
  min-height: 42px;
  padding: 3px 5px;
  transform: translate(-50%, -50%);
  border: 1px solid rgba(190, 129, 255, .5);
  border-radius: 999px;
  background: #20182f;
  color: #efdfff;
  display: grid;
  place-items: center;
  line-height: 1;
  box-shadow: 0 0 16px rgba(179, 94, 255, .2);
  pointer-events: auto;
}
.transition-node button:hover,
.transition-node.selected button { border-color: #d9a4ff; background: #37204f; }
.transition-node.selected button { outline: 2px solid rgba(217, 164, 255, .7); outline-offset: 2px; }
.transition-node.current button { box-shadow: 0 0 22px rgba(203, 130, 255, .72); }
.arrow { color: #d9a4ff; font-size: 16px; }
strong { font: 8px ui-monospace, monospace; white-space: nowrap; }
</style>
