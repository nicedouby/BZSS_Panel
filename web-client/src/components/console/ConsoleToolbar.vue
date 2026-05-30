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

      <div class="stream-field">
        <div class="field-row">
          <span class="field-label">{{ t("console.moduleFilter") }}</span>
          <button type="button" class="text-toggle" @click="$emit('toggle-advanced')">
            {{ advancedOpen ? t("common.collapse") : t("console.advancedFilters") }}
          </button>
        </div>
        <div class="stream-select-wrap">
          <select
            class="stream-select"
            :value="stream"
            :aria-label="t('console.moduleFilter')"
            @change="$emit('update:stream', readValue($event))"
          >
            <option v-for="item in streams" :key="item.id" :value="item.id">
              {{ item.title }}
            </option>
          </select>
        </div>
      </div>

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

    <div v-if="advancedOpen || hasSummary" class="toolbar-advanced">
      <div class="advanced-grid">
        <div class="toolbar-chip-group">
          <div class="chip-group-label">{{ t("console.scopeFilter") }}</div>
          <div class="stream-select-wrap">
            <select
              class="stream-select"
              :value="scope"
              :aria-label="t('console.scopeFilter')"
              @change="$emit('update:scope', readValue($event))"
            >
              <option v-for="item in scopes" :key="item.id" :value="item.id">
                {{ item.title }}
              </option>
            </select>
          </div>
        </div>

        <div class="toolbar-chip-group">
          <div class="chip-group-label">{{ t("console.levelFilter") }}</div>
          <div class="stream-select-wrap">
            <select
              class="stream-select"
              :value="level"
              :aria-label="t('console.levelFilter')"
              @change="$emit('update:level', readValue($event))"
            >
              <option v-for="item in levels" :key="item.id" :value="item.id">
                {{ item.title }}
              </option>
            </select>
          </div>
        </div>
      </div>

      <div v-if="hasSummary" class="toolbar-summary">
        <span class="summary-label">{{ t("console.activeFilters") }}</span>
        <span class="summary-pill">{{ streamTitle }}</span>
        <span class="summary-pill">{{ scopeTitle }}</span>
        <span class="summary-pill">{{ levelTitle }}</span>
        <span v-if="q" class="summary-pill">{{ q }}</span>
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
  advancedOpen: boolean;
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
  (event: "toggle-advanced"): void;
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
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(220px, 0.8fr) auto;
  gap: 12px;
  align-items: end;
}

.search-field,
.stream-field,
.toolbar-chip-group {
  display: grid;
  gap: 5px;
  min-width: 0;
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
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #8b949e;
}

.field-hint,
.text-toggle {
  font-size: 11px;
  color: #6e7681;
  white-space: nowrap;
}

.text-toggle {
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
}

.search-box,
.stream-select {
  border: 1px solid rgba(95, 111, 128, 0.34);
  background: rgba(10, 14, 20, 0.94);
  border-radius: 12px;
  min-height: 36px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02);
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 0 10px 0 12px;
}

.search-box:focus-within,
.stream-select:focus {
  border-color: #58a6ff;
  box-shadow: 0 0 0 3px rgba(31, 111, 235, 0.18);
}

.search-box input {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: #e6edf3;
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

.toolbar-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.action-button {
  min-height: 36px;
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
  color: #b2bcc6;
  background: rgba(17, 22, 28, 0.92);
}

.toolbar-advanced {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(95, 111, 128, 0.22);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.02);
}

.advanced-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.stream-select-wrap {
  position: relative;
  min-width: 0;
}

.stream-select-wrap::after {
  content: "";
  position: absolute;
  right: 12px;
  top: 50%;
  width: 7px;
  height: 7px;
  border-right: 1.5px solid #7d8894;
  border-bottom: 1.5px solid #7d8894;
  transform: translateY(calc(-50% - 2px)) rotate(45deg);
  pointer-events: none;
}

.stream-select {
  width: 100%;
  min-width: 0;
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  color: #e6edf3;
  padding: 7px 36px 7px 12px;
  font-size: 12px;
  line-height: 1.2;
  cursor: pointer;
  outline: none;
}

.stream-select option {
  background: #0d1117;
  color: #e6edf3;
}

.toolbar-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
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
  color: #dfe8f0;
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 12px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 920px) {
  .toolbar-primary-row,
  .advanced-grid {
    grid-template-columns: 1fr;
  }

  .toolbar-actions {
    width: 100%;
  }

  .action-button {
    flex: 1 1 auto;
  }
}
</style>
