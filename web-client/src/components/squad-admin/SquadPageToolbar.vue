<template>
  <div class="squad-page-toolbar">
    <div class="toolbar-row">
      <input
        v-model="searchQuery"
        type="text"
        class="squad-search-input"
        :placeholder="t('match.searchPlaceholder')"
        @input="$emit('search', searchQuery)"
      >
      <div class="toolbar-controls">
        <div class="refresh-controls" :title="t('common.refresh')">
          <button
            type="button"
            :disabled="!canRefresh || isRefreshing"
            @click="$emit('refresh', 'players')"
          >
            {{ refreshingType === 'players' ? t('common.refreshing') : t('match.refreshPlayers') }}
          </button>
          <button
            type="button"
            :disabled="!canRefresh || isRefreshing"
            @click="$emit('refresh', 'squads')"
          >
            {{ refreshingType === 'squads' ? t('common.refreshing') : t('match.refreshSquads') }}
          </button>
          <button
            type="button"
            :disabled="!canRefresh || isRefreshing"
            @click="$emit('refresh', 'all')"
          >
            {{ refreshingType === 'all' ? t('common.refreshing') : t('match.refreshAll') }}
          </button>
        </div>

        <div class="density-toggle">
          <button
            v-for="mode in ['comfortable', 'compact']"
            :key="mode"
            type="button"
            :class="{ active: densityMode === mode }"
            @click="$emit('density-change', mode as any)"
          >
            {{ mode === 'comfortable' ? t('match.densityComfortable') : t('match.densityCompact') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { t } from "../../i18n";

type RefreshType = "players" | "squads" | "all";

const props = defineProps<{
  searchQuery: string;
  densityMode: "comfortable" | "compact";
  canRefresh: boolean;
  refreshingType: RefreshType | "";
}>();

const emit = defineEmits<{
  (event: "search", query: string): void;
  (event: "density-change", mode: "comfortable" | "compact"): void;
  (event: "refresh", type: RefreshType): void;
}>();

const searchQuery = ref(props.searchQuery);
const isRefreshing = computed(() => Boolean(props.refreshingType));

watch(
  () => props.searchQuery,
  (newVal) => {
    searchQuery.value = newVal;
  },
);
</script>

<style scoped>
.squad-page-toolbar {
  background: var(--color-bg-card);
  border-bottom: 1px solid var(--color-border-default);
  padding: var(--spacing-md) var(--spacing-lg);
  flex-shrink: 0;
}

.toolbar-row {
  display: flex;
  gap: var(--spacing-md);
  align-items: center;
}

.squad-search-input {
  flex: 1 1 auto;
  min-width: 200px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  font-size: var(--font-size-base);
  transition: all 0.2s ease;
}

.squad-search-input:focus {
  outline: none;
  border-color: var(--color-status-info);
  background: var(--color-bg-elevated);
}

.squad-search-input::placeholder {
  color: var(--color-text-muted);
}

.toolbar-controls {
  display: flex;
  gap: var(--spacing-md);
  align-items: center;
  flex-wrap: wrap;
}

.refresh-controls {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.refresh-controls button {
  padding: 6px 10px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: all 0.15s ease;
  font-weight: 500;
  white-space: nowrap;
}

.refresh-controls button:hover:not(:disabled) {
  color: var(--color-text-primary);
  border-color: var(--color-status-info);
}

.refresh-controls button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.density-toggle {
  display: flex;
  gap: 2px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  padding: 2px;
}

.density-toggle button {
  padding: 6px 12px;
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: all 0.15s ease;
  font-weight: 500;
}

.density-toggle button.active {
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-soft);
}

.density-toggle button:hover:not(.active) {
  color: var(--color-text-primary);
}

@media (max-width: 768px) {
  .toolbar-row {
    flex-direction: column;
  }

  .squad-search-input {
    width: 100%;
  }

  .toolbar-controls {
    width: 100%;
    justify-content: space-between;
  }
}
</style>
