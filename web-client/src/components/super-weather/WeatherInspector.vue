<template>
  <aside class="inspector">
    <template v-if="weather">
      <header>
        <span>WEATHER SEGMENT</span>
        <button v-if="weatherCount > 1" type="button" @click="$emit('delete')">Delete</button>
      </header>
      <label>
        <span>Weather type</span>
        <select :value="weather.weatherType" @change="updateWeatherType">
          <option v-for="(name, index) in SUPER_WEATHER_NAMES" :key="name" :value="index">{{ index }} · {{ name }}</option>
        </select>
      </label>
      <label>
        <span>Weather duration (seconds)</span>
        <input :value="weather.durationSeconds" type="number" min="1" step="1" @input="updateWeatherDuration" />
      </label>
      <input
        class="duration-range"
        :value="weather.durationSeconds"
        type="range"
        min="60"
        max="7200"
        step="60"
        @input="updateWeatherDuration"
      />
      <p>{{ formatDuration(weather.durationSeconds) }} of actual timeline time</p>
    </template>

    <template v-else-if="transition">
      <header><span>TRANSITION NODE</span></header>
      <div class="transition-route">
        <span>SetWeather command</span>
        <strong>{{ weatherName(transition.fromWeather) }} → {{ weatherName(transition.toWeather) }}</strong>
        <small>This node has zero timeline width. It only supplies the Transition parameter when the right-side weather starts.</small>
      </div>
      <label>
        <span>Transition parameter (seconds)</span>
        <input :value="transition.seconds" type="number" min="0" max="900" step="1" @input="updateTransition" />
      </label>
      <input
        class="duration-range transition-range"
        :value="transition.seconds"
        type="range"
        min="0"
        max="900"
        step="1"
        @input="updateTransition"
      />
      <p>Command: SetWeather {{ transition.toWeather }},{{ transition.seconds }}</p>
    </template>

    <div v-else class="empty">Select a Weather block or an arrow node to edit it.</div>
  </aside>
</template>

<script setup lang="ts">
import { SUPER_WEATHER_NAMES, type SuperWeatherWeatherSegment } from "../../app/superWeatherApi";

defineProps<{
  weather: SuperWeatherWeatherSegment | null;
  transition: {
    sourceId: string;
    fromWeather: number;
    toWeather: number;
    seconds: number;
  } | null;
  weatherCount: number;
}>();
const emit = defineEmits<{
  updateWeather: [patch: { weatherType?: number; durationSeconds?: number }];
  updateTransition: [seconds: number];
  delete: [];
}>();

function updateWeatherType(event: Event) {
  emit("updateWeather", { weatherType: Number((event.target as HTMLSelectElement).value) });
}
function updateWeatherDuration(event: Event) {
  emit("updateWeather", { durationSeconds: Math.max(1, Math.floor(Number((event.target as HTMLInputElement).value) || 1)) });
}
function updateTransition(event: Event) {
  emit("updateTransition", Math.max(0, Math.floor(Number((event.target as HTMLInputElement).value) || 0)));
}
function weatherName(value: number) { return SUPER_WEATHER_NAMES[value] ?? `Weather ${value}`; }
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
.transition-range { accent-color: #c48cff; }
.transition-route strong { color: #ead7ff; font-size: 12px; }
.transition-route small, p, .empty { color: rgba(202, 221, 234, .48); font-size: 10px; line-height: 1.45; }
.empty { display: grid; place-items: center; min-height: 160px; text-align: center; }
</style>
