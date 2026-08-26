<template>
  <div class="db-toolbar">
    <div class="search-box" :class="{ focused: searchFocused }">
      <span class="search-icon" aria-hidden="true"></span>
      <input
        :value="modelValue.q"
        type="text"
        class="search-input"
        :placeholder="t('database.searchPlaceholder')"
        @input="updateQuery"
        @focus="searchFocused = true"
        @blur="searchFocused = false"
      >
      <button
        v-if="modelValue.q"
        type="button"
        class="clear-search"
        :aria-label="t('database.clearSearch')"
        @click="clearQuery"
      >×</button>
    </div>
    <div class="result-summary">
      <strong>{{ total.toLocaleString() }}</strong>
      <span>{{ t("database.resultCount") }}</span>
      <i v-if="loading" class="loading-dot"></i>
    </div>
    <div class="toolbar-actions">
      <select
        :value="modelValue.sort"
        class="sort-select"
        @change="updateSort"
      >
        <option value="updated_desc">{{ t("database.sortRecentlyUpdated") }}</option>
        <option value="name_asc">{{ t("database.sortNameAsc") }}</option>
        <option value="playtime_desc">{{ t("database.sortPlaytime") }}</option>
        <option value="matches_desc">{{ t("database.sortMatches") }}</option>
      </select>
      <button type="button" class="stats-btn" @click="$emit('open-stats')">
        <span aria-hidden="true">⌁</span>
        {{ t("database.openStatsModal") }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { t } from "../../i18n";

const props = defineProps<{
  modelValue: { q: string; sort: string };
  total: number;
  loading: boolean;
}>();

const emit = defineEmits<{
  (event: "update:modelValue", value: { q: string; sort: string }): void;
  (event: "open-stats"): void;
}>();

const searchFocused = ref(false);

function updateQuery(e: Event) {
  const q = (e.target as HTMLInputElement).value;
  emit("update:modelValue", { ...props.modelValue, q });
}

function updateSort(e: Event) {
  const sort = (e.target as HTMLSelectElement).value;
  emit("update:modelValue", { ...props.modelValue, sort });
}

function clearQuery() {
  emit("update:modelValue", { ...props.modelValue, q: "" });
}
</script>

<style scoped>
.db-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  padding: 10px;
  background: color-mix(in srgb, var(--color-bg-panel) 96%, transparent);
  border: 1px solid var(--color-border-default);
  border-radius: 14px;
}

.search-box {
  flex: 1;
  min-width: 260px;
  position: relative;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  background: var(--color-bg-input);
  transition: border-color .16s ease, box-shadow .16s ease;
}

.search-box.focused {
  border-color: #4aa8ff;
  box-shadow: 0 0 0 3px rgba(74, 168, 255, .12);
}

.search-input {
  width: 100%;
  min-height: 40px;
  padding: 8px 38px 8px 40px;
  background: transparent;
  border: 0;
  outline: 0;
  color: var(--color-text-primary);
  font-size: 14px;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  border: 2px solid var(--color-text-muted);
  border-radius: 50%;
  opacity: .65;
}

.search-icon::after {
  position: absolute;
  width: 6px;
  height: 2px;
  content: "";
  background: var(--color-text-muted);
  transform: translate(10px, 10px) rotate(45deg);
}

.clear-search {
  position: absolute;
  top: 50%;
  right: 8px;
  width: 25px;
  height: 25px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: rgba(255, 255, 255, .06);
  color: var(--color-text-muted);
  transform: translateY(-50%);
  cursor: pointer;
}

.result-summary {
  display: flex;
  align-items: baseline;
  gap: 5px;
  padding: 0 4px;
  color: var(--color-text-muted);
  font-size: 11px;
  white-space: nowrap;
}

.result-summary strong {
  color: var(--color-text-primary);
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}

.loading-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4aa8ff;
  animation: pulse 1s infinite alternate;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.sort-select,
.stats-btn {
  min-height: 40px;
}

.sort-select {
  padding: 8px 12px;
  background: var(--color-bg-input);
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  color: var(--color-text-primary);
  font-size: 14px;
}

.stats-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 15px;
  background: rgba(74, 168, 255, .12);
  border: 1px solid rgba(74, 168, 255, .3);
  border-radius: 10px;
  color: var(--color-text-primary);
  font-size: 14px;
  cursor: pointer;
}

.stats-btn:hover {
  background: rgba(74, 168, 255, .2);
}

@keyframes pulse { to { opacity: .25; } }

@media (max-width: 700px) {
  .search-box { min-width: 100%; }
  .result-summary { order: 3; }
  .toolbar-actions { flex: 1; }
  .sort-select { flex: 1; min-width: 0; }
}
</style>
