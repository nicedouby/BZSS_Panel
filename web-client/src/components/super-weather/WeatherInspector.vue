<template>
  <aside class="inspector">
    <template v-if="segment">
      <header>
        <span>{{ segment.type === "weather" ? "WEATHER SEGMENT" : "TRANSITION SEGMENT" }}</span>
        <button v-if="segment.type === 'weather' && weatherCount > 1" type="button" @click="$emit('delete')">Delete</button>
      </header>
      <label v-if="segment.type === 'weather'">
        <span>Weather type</span>
        <select :value="segment.weatherType" @change="updateWeather">
          <option v-for="(name, index) in SUPER_WEATHER_NAMES" :key="name" :value="index">{{ index }} · {{ name }}</option>
        </select>
      </label>
      <div v-else class="transition-route">
        <span>Transition route</span>
        <strong>{{ fromName }} → {{ toName }}</strong>
        <small>From/To is derived from adjacent Weather segments.</small>
      </div>
      <label>
        <span>{{ segment.type === "weather" ? "Stable duration" : "Transition duration" }} (seconds)</span>
        <input :value="segment.durationSeconds" type="number" min="1" step="1" @input="updateDuration" />
      </label>
      <input
        class="duration-range"
        :value="segment.durationSeconds"
        type="range"
        min="1"
        :max="segment.type === 'weather' ? 7200 : 900"
        step="1"
        @input="updateDuration"
      />
      <p>{{ formatDuration(segment.durationSeconds) }} actual timeline time</p>
    </template>
    <div v-else class="empty">Select a Weather or Transition block to edit it.</div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { SUPER_WEATHER_NAMES, type SuperWeatherSegment } from "../../app/superWeatherApi";

const props = defineProps<{
  segment: SuperWeatherSegment | null;
  fromWeather?: number | null;
  toWeather?: number | null;
  weatherCount: number;
}>();
const emit = defineEmits<{ update: [patch: Record<string, number>]; delete: [] }>();
const fromName = computed(() => SUPER_WEATHER_NAMES[Number(props.fromWeather)] ?? "--");
const toName = computed(() => SUPER_WEATHER_NAMES[Number(props.toWeather)] ?? "--");

function updateWeather(event: Event) {
  emit("update", { weatherType: Number((event.target as HTMLSelectElement).value) });
}
function updateDuration(event: Event) {
  emit("update", { durationSeconds: Math.max(1, Math.floor(Number((event.target as HTMLInputElement).value) || 1)) });
}
function formatDuration(value: number) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
</script>

<style scoped>
.inspector { min-width: 228px; padding: 14px; border: 1px solid rgba(125, 166, 193, .18); border-radius: 12px; background: rgba(5, 14, 25, .68); }
header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 13px; color: #75d9ff; font-size: 9px; letter-spacing: .13em; }
header button { border: 0; background: transparent; color: #ff8f9b; font-size: 11px; }
label, .transition-route { display: grid; gap: 6px; margin-bottom: 12px; color: rgba(216, 232, 242, .7); font-size: 11px; }
select, input[type="number"] { width: 100%; padding: 8px 9px; border: 1px solid rgba(123, 168, 195, .24); border-radius: 7px; background: #091625; color: #edf8ff; }
.duration-range { width: 100%; accent-color: #58cfff; }
.transition-route strong { color: #ead7ff; font-size: 12px; }
.transition-route small, p, .empty { color: rgba(202, 221, 234, .48); font-size: 10px; }
.empty { display: grid; place-items: center; min-height: 160px; text-align: center; }
</style>
