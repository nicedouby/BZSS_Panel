<template>
  <div class="db-toolbar">
    <div class="search-box">
      <input
        :value="modelValue.q"
        type="text"
        class="search-input"
        :placeholder="t('database.searchPlaceholder')"
        @input="updateQuery"
      >
      <span class="search-icon">🔍</span>
    </div>
    <div class="toolbar-actions">
      <select
        :value="modelValue.sort"
        class="sort-select"
        @change="updateSort"
      >
        <option value="updated_desc">{{ t("database.sortRecentlyUpdated") }}</option>
        <option value="name_asc">{{ t("database.sortNameAsc") }}</option>
      </select>
      <button type="button" class="stats-btn" @click="$emit('open-stats')">
        {{ t("database.openStatsModal") }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from "../../i18n";

const props = defineProps<{
  modelValue: { q: string; sort: string };
}>();

const emit = defineEmits<{
  (event: "update:modelValue", value: { q: string; sort: string }): void;
  (event: "open-stats"): void;
}>();

function updateQuery(e: Event) {
  const q = (e.target as HTMLInputElement).value;
  emit("update:modelValue", { ...props.modelValue, q });
}

function updateSort(e: Event) {
  const sort = (e.target as HTMLSelectElement).value;
  emit("update:modelValue", { ...props.modelValue, sort });
}
</script>

<style scoped>
.db-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  padding: 12px;
  background: var(--color-bg-panel);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
}

.search-box {
  flex: 1;
  min-width: 300px;
  position: relative;
}

.search-input {
  width: 100%;
  padding: 8px 12px 8px 36px;
  background: var(--color-bg-input);
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  color: var(--color-text-primary);
  font-size: 14px;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 14px;
  opacity: 0.5;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
}

.sort-select {
  padding: 8px 12px;
  background: var(--color-bg-input);
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  color: var(--color-text-primary);
  font-size: 14px;
}

.stats-btn {
  padding: 8px 16px;
  background: var(--color-bg-hover);
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  color: var(--color-text-primary);
  font-size: 14px;
  cursor: pointer;
}

.stats-btn:hover {
  background: var(--color-bg-active);
}
</style>
