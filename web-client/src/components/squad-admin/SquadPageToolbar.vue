<template>
  <div class="squad-page-toolbar">
    <div class="toolbar-observe">
      <input
        v-model="searchQuery"
        type="text"
        class="squad-search-input"
        :placeholder="t('match.searchPlaceholder')"
        @input="$emit('search', searchQuery)"
      >

      <div class="filter-chips" aria-label="Quick filters">
        <button type="button" class="filter-chip active" aria-pressed="true">All</button>
        <button type="button" class="filter-chip" aria-pressed="false">No leader</button>
        <button type="button" class="filter-chip" aria-pressed="false">Locked</button>
        <button type="button" class="filter-chip" aria-pressed="false">Alerts</button>
      </div>

      <div v-if="showViewerPerspective" class="viewer-perspective-chip">
        {{ viewerPerspectiveText }}
      </div>
    </div>

    <div class="toolbar-actions">
      <div class="refresh-controls">
        <button
          type="button"
          class="refresh-button"
          :disabled="!canRefresh || isRefreshing"
          @click="$emit('refresh', 'players')"
        >
          {{ refreshingType === 'players' ? t('common.refreshing') : t('match.refreshPlayers') }}
        </button>
        <button
          type="button"
          class="refresh-button"
          :disabled="!canRefresh || isRefreshing"
          @click="$emit('refresh', 'squads')"
        >
          {{ refreshingType === 'squads' ? t('common.refreshing') : t('match.refreshSquads') }}
        </button>
        <button
          type="button"
          class="refresh-button"
          :disabled="!canRefresh || isRefreshing"
          @click="$emit('refresh', 'all')"
        >
          {{ refreshingType === 'all' ? t('common.refreshing') : t('match.refreshAll') }}
        </button>
        <button
          type="button"
          class="refresh-button secondary"
          :disabled="!canRefresh || isRefreshing || refreshingPlaytime"
          @click="$emit('refresh-playtime')"
        >
          {{ refreshingPlaytime ? "Refreshing Steam time" : "Refresh Steam time" }}
        </button>
      </div>

      <div class="density-toggle">
        <button
          v-for="mode in ['comfortable', 'compact']"
          :key="mode"
          type="button"
          :class="{ active: densityMode === mode }"
          @click="selectDensityMode(mode)"
        >
          {{ mode === 'comfortable' ? t('match.densityComfortable') : t('match.densityCompact') }}
        </button>
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
  refreshingPlaytime?: boolean;
  viewerPerspectiveText?: string;
  showViewerPerspective?: boolean;
}>();

const emit = defineEmits<{
  (event: "search", query: string): void;
  (event: "density-change", mode: "comfortable" | "compact"): void;
  (event: "refresh", type: RefreshType): void;
  (event: "refresh-playtime"): void;
}>();

const searchQuery = ref(props.searchQuery);
const isRefreshing = computed(() => Boolean(props.refreshingType));
const refreshingPlaytime = computed(() => Boolean(props.refreshingPlaytime));
const showViewerPerspective = computed(() => Boolean(props.showViewerPerspective));
const viewerPerspectiveText = computed(() => props.viewerPerspectiveText ?? "");

watch(
  () => props.searchQuery,
  (newVal) => {
    searchQuery.value = newVal;
  },
);

function selectDensityMode(mode: string) {
  if (mode === "comfortable" || mode === "compact") {
    emit("density-change", mode);
  }
}
</script>

<style scoped>
.squad-page-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--spacing-md);
  align-items: center;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(255, 255, 255, 0.01)),
    var(--color-bg-card);
  border-bottom: 1px solid var(--color-border-default);
  padding: 12px var(--spacing-lg);
  flex-shrink: 0;
  min-width: 0;
}

.toolbar-observe {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.squad-search-input {
  width: min(420px, 100%);
  min-width: 220px;
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

.filter-chips {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.filter-chip,
.viewer-perspective-chip {
  height: 30px;
  padding: 0 10px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.025);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.filter-chip.active {
  color: var(--color-text-primary);
  border-color: var(--color-status-info);
  background: rgba(96, 165, 250, 0.12);
}

.viewer-perspective-chip {
  display: inline-flex;
  align-items: center;
  color: var(--color-text-primary);
  border-color: var(--color-team1-border);
  background: rgba(55, 200, 255, 0.08);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex: 0 0 auto;
}

.refresh-controls {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.refresh-button {
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

.refresh-button.secondary {
  color: var(--color-text-muted);
}

.refresh-button:hover:not(:disabled) {
  color: var(--color-text-primary);
  border-color: var(--color-status-info);
}

.refresh-button:disabled {
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

@media (max-width: 1180px) {
  .squad-page-toolbar {
    grid-template-columns: 1fr;
  }

  .toolbar-actions {
    justify-content: space-between;
    flex-wrap: wrap;
  }
}
</style>
