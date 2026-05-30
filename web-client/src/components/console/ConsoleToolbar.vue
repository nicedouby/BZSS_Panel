<template>
  <div class="toolbar">
    <div class="toolbar-grid">
      <label class="control control-stream">
        <span class="control-label">{{ t("console.filterStream") }}</span>
        <select :value="stream" @change="$emit('update:stream', readValue($event))">
          <option v-for="item in streams" :key="item.id" :value="item.id">{{ item.title }}</option>
        </select>
      </label>

      <label class="control">
        <span class="control-label">{{ t("console.filterScope") }}</span>
        <select :value="scope" @change="$emit('update:scope', readValue($event))">
          <option v-for="item in scopes" :key="item.id" :value="item.id">{{ item.title }}</option>
        </select>
      </label>

      <label class="control">
        <span class="control-label">{{ t("console.filterLevel") }}</span>
        <select :value="level" @change="$emit('update:level', readValue($event))">
          <option v-for="item in levels" :key="item.id" :value="item.id">{{ item.title }}</option>
        </select>
      </label>

      <label class="control control-search">
        <span class="control-label">{{ t("common.search") }}</span>
        <input :value="q" :placeholder="t('console.filterLogs')" @input="$emit('update:q', readValue($event))">
      </label>

      <div class="control control-actions">
        <span class="control-label">{{ t("console.filterActions") }}</span>
        <div class="action-row">
          <button type="button" @click="$emit('clear')">{{ t("common.clear") }}</button>
          <button type="button" @click="$emit('toggle-paused')">{{ paused ? t("common.resume") : t("common.pause") }}</button>
        </div>
      </div>
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
  border: 1px solid #2d3748;
  border-radius: 14px;
  padding: 12px;
  background:
    radial-gradient(circle at right top, rgba(56, 189, 248, 0.1), transparent 46%),
    linear-gradient(180deg, rgba(22, 27, 34, 0.98), rgba(13, 17, 23, 0.98));
}

.toolbar-grid {
  display: grid;
  grid-template-columns: minmax(180px, 0.9fr) minmax(160px, 0.75fr) minmax(140px, 0.6fr) minmax(220px, 1fr) auto;
  gap: 10px;
  align-items: end;
}

.control {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.control-label {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #7dd3fc;
  font-weight: 700;
}

select,
input {
  min-width: 0;
  border: 1px solid #3b4758;
  background: #0b1320;
  color: #c9d1d9;
  border-radius: 10px;
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
  width: 100%;
}

button {
  background: #1f2937;
  border: 1px solid #3b4758;
  color: #c9d1d9;
  padding: 6px 12px;
  font-size: 13px;
  border-radius: 9px;
}

button:hover {
  background: #2b3a4d;
  border-color: #7dd3fc;
}

.action-row {
  display: flex;
  gap: 8px;
}

.action-row button {
  min-width: 88px;
}

@media (max-width: 1120px) {
  .toolbar-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .control-stream,
  .control-search,
  .control-actions {
    grid-column: 1 / -1;
  }
}

@media (max-width: 700px) {
  .toolbar-grid {
    grid-template-columns: 1fr;
  }

  .action-row {
    width: 100%;
  }

  .action-row button {
    flex: 1;
  }
}
</style>
