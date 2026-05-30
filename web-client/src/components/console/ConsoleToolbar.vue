<template>
  <div class="toolbar">
    <div class="toolbar-row">
      <select :value="stream" @change="$emit('update:stream', readValue($event))">
        <option v-for="item in streams" :key="item.id" :value="item.id">{{ item.title }}</option>
      </select>
      <select :value="scope" @change="$emit('update:scope', readValue($event))">
        <option v-for="item in scopes" :key="item.id" :value="item.id">{{ item.title }}</option>
      </select>
      <select :value="level" @change="$emit('update:level', readValue($event))">
        <option v-for="item in levels" :key="item.id" :value="item.id">{{ item.title }}</option>
      </select>
      <input :value="q" :placeholder="t('console.filterLogs')" @input="$emit('update:q', readValue($event))">
    </div>
    <div class="toolbar-row end">
      <button type="button" @click="$emit('clear')">{{ t("common.clear") }}</button>
      <button type="button" @click="$emit('toggle-paused')">{{ paused ? t("common.resume") : t("common.pause") }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from "../../i18n";

defineProps<{
  stream: string;
  scope: string;
  level: string;
  q: string;
  paused: boolean;
  streams: Array<{ id: string; title: string }>;
  scopes: Array<{ id: string; title: string }>;
  levels: Array<{ id: string; title: string }>;
}>();

defineEmits<{
  (event: "update:stream", value: string): void;
  (event: "update:scope", value: string): void;
  (event: "update:level", value: string): void;
  (event: "update:q", value: string): void;
  (event: "toggle-paused"): void;
  (event: "clear"): void;
}>();

function readValue(event: Event) {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}
</script>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.toolbar-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.toolbar-row.end {
  justify-content: flex-end;
}

select,
input {
  min-width: 0;
  border: 1px solid #30363d;
  background: #0d1117;
  color: #c9d1d9;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
}

select:focus,
input:focus {
  border-color: #58a6ff;
  outline: none;
  box-shadow: 0 0 0 3px rgba(31, 111, 235, 0.3);
}

input {
  width: 200px;
}

button {
  background: #21262d;
  border: 1px solid #30363d;
  color: #c9d1d9;
  padding: 6px 12px;
  font-size: 13px;
}

button:hover {
  background: #30363d;
  border-color: #8b949e;
}
</style>
