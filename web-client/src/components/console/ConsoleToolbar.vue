<template>
  <div class="toolbar-shell">
    <div class="toolbar-primary-row">
      <label class="search-field">
        <div class="field-row">
          <span class="field-label">{{ t("console.filterLogs") }}</span>
          <span class="field-hint">{{ t("console.searchShortcut") }}</span>
        </div>
        <div class="search-box">
          <input
            ref="searchInputRef"
            :value="q"
            :placeholder="t('console.filterLogs')"
            :aria-label="t('console.filterLogs')"
            @input="$emit('update:q', readValue($event))"
            @keydown="onSearchKeydown"
          >
          <button
            v-if="q"
            type="button"
            class="ghost-icon-button"
            :aria-label="t('console.clearSearch')"
            :title="t('console.clearSearch')"
            @click="$emit('update:q', '')"
          >
            x
          </button>
        </div>
      </label>

      <div class="toolbar-actions">
        <button
          type="button"
          class="action-button subtle"
          :disabled="!hasActiveFilters"
          @click="$emit('reset-filters')"
        >
          {{ t("console.resetFilters") }}
        </button>
        <button type="button" class="action-button" @click="$emit('clear')">
          {{ t("common.clear") }}
        </button>
        <button type="button" class="action-button" @click="$emit('toggle-paused')">
          {{ paused ? t("common.resume") : t("common.pause") }}
        </button>
      </div>
    </div>

    <div v-if="hasSummary" class="toolbar-summary">
      <span class="summary-label">{{ t("console.activeFilters") }}</span>
      <span class="summary-pill">{{ streamTitle }}</span>
      <span class="summary-pill">{{ scopeTitle }}</span>
      <span class="summary-pill">{{ levelTitle }}</span>
      <span v-if="q" class="summary-pill">{{ q }}</span>
    </div>

    <div class="toolbar-grid">
      <div class="toolbar-chip-group">
        <div class="chip-group-label">{{ t("console.streamFilter") }}</div>
        <div class="chip-strip">
          <button
            v-for="item in streams"
            :key="item.id"
            type="button"
            class="filter-chip"
            :class="{ active: stream === item.id }"
            :aria-pressed="stream === item.id"
            @click="$emit('update:stream', item.id)"
          >
            {{ item.title }}
          </button>
        </div>
      </div>

      <div class="toolbar-chip-group">
        <div class="chip-group-label">{{ t("console.scopeFilter") }}</div>
        <div class="chip-strip">
          <button
            v-for="item in scopes"
            :key="item.id"
            type="button"
            class="filter-chip"
            :class="{ active: scope === item.id }"
            :aria-pressed="scope === item.id"
            :title="item.title"
            @click="$emit('update:scope', item.id)"
          >
            {{ item.title }}
          </button>
        </div>
      </div>

      <div class="toolbar-chip-group">
        <div class="chip-group-label">{{ t("console.levelFilter") }}</div>
        <div class="chip-strip">
          <button
            v-for="item in levels"
            :key="item.id"
            type="button"
            class="filter-chip"
            :class="{ active: level === item.id }"
            :aria-pressed="level === item.id"
            @click="$emit('update:level', item.id)"
          >
            {{ item.title }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { t } from "../../i18n";

const props = defineProps<{
  stream: string;
  scope: string;
  level: string;
  q: string;
  paused: boolean;
  hasActiveFilters: boolean;
  streams: Array<{ id: string; title: string }>;
  scopes: Array<{ id: string; title: string }>;
  levels: Array<{ id: string; title: string }>;
}>();

const emit = defineEmits<{
  (event: "update:stream", value: string): void;
  (event: "update:scope", value: string): void;
  (event: "update:level", value: string): void;
  (event: "update:q", value: string): void;
  (event: "toggle-paused"): void;
  (event: "clear"): void;
  (event: "reset-filters"): void;
}>();

const searchInputRef = ref<HTMLInputElement | null>(null);

function readValue(event: Event) {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

const streamTitle = computed(() => resolveTitle(props.streams, props.stream));
const scopeTitle = computed(() => resolveTitle(props.scopes, props.scope));
const levelTitle = computed(() => resolveTitle(props.levels, props.level));
const hasSummary = computed(() => Boolean(props.q || props.stream !== "modules" || props.scope !== "all" || props.level !== "all"));

function resolveTitle(items: Array<{ id: string; title: string }>, value: string) {
  return items.find((item) => item.id === value)?.title ?? value;
}

function onSearchKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || !props.q) return;
  event.preventDefault();
  emit("update:q", "");
}

defineExpose({
  focusSearch() {
    searchInputRef.value?.focus();
    searchInputRef.value?.select();
  },
});
</script>

<style scoped>
.toolbar-shell {
  display: grid;
  gap: 12px;
}

.toolbar-primary-row {
  display: flex;
  gap: 12px;
  align-items: end;
  justify-content: space-between;
  flex-wrap: wrap;
}

.search-field {
  display: grid;
  gap: 6px;
  flex: 1 1 360px;
  min-width: 260px;
}

.field-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}

.field-label,
.chip-group-label {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #8b949e;
}

.field-hint {
  font-size: 11px;
  color: #6e7681;
  white-space: nowrap;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 0 10px 0 12px;
  border: 1px solid #30363d;
  background: #0d1117;
  border-radius: 10px;
}

.search-box:focus-within {
  border-color: #58a6ff;
  box-shadow: 0 0 0 3px rgba(31, 111, 235, 0.18);
}

.search-box input {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: #c9d1d9;
  padding: 10px 0;
  font-size: 13px;
}

.search-box input::placeholder {
  color: #6e7681;
}

.ghost-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: #c9d1d9;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.ghost-icon-button:hover {
  background: rgba(255, 255, 255, 0.08);
}

.toolbar-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.action-button {
  border: 1px solid #30363d;
  background: #161b22;
  color: #c9d1d9;
  border-radius: 10px;
  padding: 9px 12px;
  font-size: 13px;
  cursor: pointer;
}

.action-button:hover {
  background: #21262d;
  border-color: #8b949e;
}

.action-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.action-button.subtle {
  color: #8b949e;
}

.toolbar-chip-group {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.toolbar-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.toolbar-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid #30363d;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.02);
}

.summary-label {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #8b949e;
  margin-right: 2px;
}

.summary-pill {
  display: inline-flex;
  align-items: center;
  border: 1px solid rgba(88, 166, 255, 0.35);
  background: rgba(88, 166, 255, 0.08);
  color: #c9d1d9;
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 12px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip-strip {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  min-width: 0;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #30363d;
  background: rgba(255, 255, 255, 0.03);
  color: #c9d1d9;
  border-radius: 999px;
  padding: 7px 12px;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.filter-chip:hover {
  border-color: #58a6ff;
  background: rgba(88, 166, 255, 0.1);
}

.filter-chip.active {
  border-color: #58a6ff;
  background: rgba(88, 166, 255, 0.16);
  color: #f0f6fc;
}
</style>
