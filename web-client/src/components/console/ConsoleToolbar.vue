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
  align-items: center;
  padding: 12px 14px;
  border: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.016)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-card);
  border-radius: 16px;
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(12px);
}

.toolbar-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  min-width: 0;
}

.toolbar-row.end {
  justify-content: flex-end;
}

select,
input {
  min-width: 0;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  border-radius: 12px;
  padding: 8px 12px;
  font-size: 13px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02);
}

select:focus,
input:focus {
  outline: none;
  border-color: var(--color-border-highlight);
  box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.16);
}

input {
  width: min(260px, 100%);
}

button {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.018)), rgba(255, 255, 255, 0.004)),
    var(--color-bg-elevated);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
  padding: 8px 12px;
  font-size: 13px;
  box-shadow: var(--shadow-sm);
}

button:hover {
  border-color: var(--color-border-highlight);
}

@media (max-width: 900px) {
  .toolbar {
    padding: 12px;
  }

  .toolbar-row.end {
    width: 100%;
    justify-content: flex-start;
  }

  input {
    flex: 1 1 220px;
  }
}
</style>
