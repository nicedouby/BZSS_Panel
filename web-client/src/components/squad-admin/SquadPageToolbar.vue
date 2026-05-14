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
        <button
          v-for="filter in filters"
          :key="filter.value"
          type="button"
          class="filter-chip"
          :class="{ active: filterMode === filter.value }"
          :aria-pressed="filterMode === filter.value"
          @click="$emit('filter-change', filter.value)"
        >
          {{ filter.label }}
        </button>
      </div>

      <div v-if="showViewerPerspective" class="viewer-perspective-chip">
        {{ viewerPerspectiveText }}
      </div>
    </div>

    <div class="toolbar-actions">
      <div class="refresh-controls">
        <button
          type="button"
          class="refresh-button primary"
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
          智能刷新时长
        </button>
        <button
          type="button"
          class="refresh-button danger"
          :disabled="!canRefresh || isRefreshing || refreshingPlaytime"
          @click="$emit('refresh-playtime-force')"
        >
          强制刷新全部时长
        </button>
        <div ref="refreshMenuRoot" class="refresh-dropdown">
          <button
            type="button"
            class="refresh-button refresh-menu-trigger"
            :disabled="!canRefresh || isRefreshing || refreshingPlaytime"
            :aria-expanded="refreshMenuOpen"
            aria-haspopup="menu"
            @click.stop="toggleRefreshMenu"
          >
            <span>{{ t("common.more", "More") }}</span>
            <span class="refresh-caret" aria-hidden="true">▾</span>
          </button>

          <transition name="menu-fade">
            <div v-if="refreshMenuOpen" class="refresh-menu" role="menu">
              <button
                type="button"
                class="menu-item"
                role="menuitem"
                :disabled="!canRefresh || isRefreshing"
                @click="runRefresh('players')"
              >
                {{ refreshingType === 'players' ? t('common.refreshing') : t('match.refreshPlayers') }}
              </button>
              <button
                type="button"
                class="menu-item"
                role="menuitem"
                :disabled="!canRefresh || isRefreshing"
                @click="runRefresh('squads')"
              >
                {{ refreshingType === 'squads' ? t('common.refreshing') : t('match.refreshSquads') }}
              </button>
            </div>
          </transition>
        </div>
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
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { t } from "../../i18n";

type RefreshType = "players" | "squads" | "all";
type FilterMode = "all" | "no_leader" | "locked" | "alerts";

const props = defineProps<{
  searchQuery: string;
  filterMode: FilterMode;
  densityMode: "comfortable" | "compact";
  canRefresh: boolean;
  refreshingType: RefreshType | "";
  refreshingPlaytime?: boolean;
  viewerPerspectiveText?: string;
  showViewerPerspective?: boolean;
}>();

const emit = defineEmits<{
  (event: "search", query: string): void;
  (event: "filter-change", mode: FilterMode): void;
  (event: "density-change", mode: "comfortable" | "compact"): void;
  (event: "refresh", type: RefreshType): void;
  (event: "refresh-playtime"): void;
  (event: "refresh-playtime-force"): void;
}>();

const filters = [
  { value: "all", label: "All" },
  { value: "no_leader", label: "No leader" },
  { value: "locked", label: "Locked" },
  { value: "alerts", label: "Alerts" },
] as const;

const searchQuery = ref(props.searchQuery);
const isRefreshing = computed(() => Boolean(props.refreshingType));
const refreshingPlaytime = computed(() => Boolean(props.refreshingPlaytime));
const showViewerPerspective = computed(() => Boolean(props.showViewerPerspective));
const viewerPerspectiveText = computed(() => props.viewerPerspectiveText ?? "");
const filterMode = computed(() => props.filterMode);
const refreshMenuOpen = ref(false);
const refreshMenuRoot = ref<HTMLElement | null>(null);

watch(
  () => props.searchQuery,
  (newVal) => {
    searchQuery.value = newVal;
  },
);

watch(
  () => [props.refreshingType, props.refreshingPlaytime],
  () => {
    if (isRefreshing.value || refreshingPlaytime.value) {
      closeRefreshMenu();
    }
  },
);

function toggleRefreshMenu() {
  refreshMenuOpen.value = !refreshMenuOpen.value;
  if (refreshMenuOpen.value) {
    window.addEventListener("pointerdown", onWindowPointerDown);
    window.addEventListener("keydown", onWindowKeyDown);
  } else {
    removeWindowListeners();
  }
}

function closeRefreshMenu() {
  refreshMenuOpen.value = false;
  removeWindowListeners();
}

function onWindowPointerDown(event: PointerEvent) {
  if (!refreshMenuRoot.value) return;
  if (!refreshMenuRoot.value.contains(event.target as Node)) {
    closeRefreshMenu();
  }
}

function onWindowKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    closeRefreshMenu();
  }
}

function removeWindowListeners() {
  window.removeEventListener("pointerdown", onWindowPointerDown);
  window.removeEventListener("keydown", onWindowKeyDown);
}

function runRefresh(type: RefreshType) {
  closeRefreshMenu();
  emit("refresh", type);
}

function selectDensityMode(mode: string) {
  if (mode === "comfortable" || mode === "compact") {
    emit("density-change", mode);
  }
}

onBeforeUnmount(() => {
  removeWindowListeners();
});
</script>

<style scoped>
.squad-page-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  align-items: stretch;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(255, 255, 255, 0.01)),
    var(--color-bg-card);
  border-bottom: 1px solid var(--color-border-default);
  padding: 12px var(--spacing-lg) 14px;
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
  width: min(400px, 100%);
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
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--spacing-sm);
  min-width: 0;
}

.refresh-controls {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  min-width: 0;
  justify-content: flex-start;
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

.refresh-button.primary {
  min-width: 112px;
}

.refresh-button.secondary {
  color: var(--color-text-muted);
}

.refresh-button.secondary {
  background: rgba(55, 200, 255, 0.08);
  color: var(--color-team1-primary);
  border-color: rgba(55, 200, 255, 0.22);
}

.refresh-button.danger {
  background: rgba(248, 113, 113, 0.08);
  color: #fda4af;
  border-color: rgba(248, 113, 113, 0.26);
}

.refresh-button.secondary:hover:not(:disabled) {
  background: rgba(55, 200, 255, 0.14);
}

.refresh-button.danger:hover:not(:disabled) {
  background: rgba(248, 113, 113, 0.14);
}

.refresh-button:hover:not(:disabled) {
  color: var(--color-text-primary);
  border-color: var(--color-status-info);
}

.refresh-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.refresh-dropdown {
  position: relative;
}

.refresh-menu-trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.refresh-caret {
  color: var(--color-text-muted);
  font-size: 11px;
}

.refresh-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 190px;
  padding: 8px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.02)), rgba(255, 255, 255, 0.01)),
    var(--color-bg-card);
  box-shadow: var(--shadow-lg);
  display: grid;
  gap: 6px;
  z-index: 10;
}

.refresh-menu .menu-item {
  width: 100%;
  justify-content: flex-start;
  text-align: left;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
  border-radius: var(--radius-md);
  padding: 8px 10px;
}

.refresh-menu .menu-item.secondary {
  color: var(--color-text-muted);
}

.refresh-menu .menu-item:hover:not(:disabled) {
  color: var(--color-text-primary);
  border-color: var(--color-status-info);
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
  .toolbar-actions {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  .refresh-controls {
    grid-column: 1 / -1;
    justify-content: space-between;
  }

  .density-toggle {
    justify-self: end;
  }
}

.menu-fade-enter-active,
.menu-fade-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.menu-fade-enter-from,
.menu-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
