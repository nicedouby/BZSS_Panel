<template>
  <div class="squad-page-toolbar">
    <div class="toolbar-row">
      <div class="search-wrapper">
        <span class="search-icon" aria-hidden="true">🔍</span>
        <input
          v-model="searchQuery"
          type="text"
          class="squad-search-input"
          :placeholder="t('match.searchPlaceholder')"
          @input="$emit('search', searchQuery)"
        >
      </div>

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

      <div class="view-mode-toggle">
        <button
          type="button"
          class="toggle-btn"
          :class="{ active: viewMode === 'list' }"
          @click="$emit('view-mode-change', 'list')"
        >
          列表
        </button>
        <button
          type="button"
          class="toggle-btn"
          :class="{ active: viewMode === 'map' }"
          @click="$emit('view-mode-change', 'map')"
        >
          地图
        </button>
      </div>

      <div class="toolbar-spacer" />

      <div v-if="serverStatusUpdatedAt || playersUpdatedAt" class="toolbar-timestamps">
        <span v-if="playersUpdatedAt" class="ts-badge" :title="`玩家数据更新时间: ${formatTimestamp(playersUpdatedAt)}`">
          {{ formatTimestampShort(playersUpdatedAt) }}
        </span>
      </div>

      <div class="refresh-controls">
        <button
          type="button"
          class="refresh-button"
          :class="{ active: multiSelectMode, 'primary-select': multiSelectMode }"
          @click="$emit('toggle-multi-select')"
          :title="multiSelectMode ? '关闭批量操作' : '开启批量操作'"
        >
          <span class="select-icon">★</span>
          <span>{{ multiSelectMode ? '退出批量' : '批量操作' }}</span>
        </button>
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
          :title="'智能刷新 Steam 时长（跳过30分钟内已刷新的玩家）'"
          @click="$emit('refresh-playtime')"
        >
          智能刷新时长
        </button>
        <button
          type="button"
          class="refresh-button danger"
          :disabled="!canRefresh || isRefreshing || refreshingPlaytime"
          :title="'强制刷新全部在线玩家的 Steam 时长'"
          @click="$emit('refresh-playtime-force')"
        >
          强制刷新
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
  canRefresh: boolean;
  refreshingType: RefreshType | "";
  refreshingPlaytime?: boolean;
  viewerPerspectiveText?: string;
  showViewerPerspective?: boolean;
  serverStatusUpdatedAt?: number;
  playersUpdatedAt?: number;
  squadsUpdatedAt?: number;
  multiSelectMode?: boolean;
  viewMode: "list" | "map";
}>();

const emit = defineEmits<{
  (event: "search", query: string): void;
  (event: "filter-change", mode: FilterMode): void;
  (event: "refresh", type: RefreshType): void;
  (event: "refresh-playtime"): void;
  (event: "refresh-playtime-force"): void;
  (event: "toggle-multi-select"): void;
  (event: "view-mode-change", mode: "list" | "map"): void;
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

function runRefresh(type: "players" | "squads") {
  emit("refresh", type);
  closeRefreshMenu();
}

function formatTimestamp(value: number) {
  if (!Number.isFinite(value)) return "--";
  return new Date(value).toLocaleString();
}

function formatTimestampShort(value: number) {
  if (!Number.isFinite(value)) return "--";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

onBeforeUnmount(removeWindowListeners);
</script>

<style scoped>
.squad-page-toolbar {
  display: grid;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--color-border-default);
  background:
    radial-gradient(circle at 0% 0%, rgba(56, 189, 248, 0.08), transparent 26%),
    radial-gradient(circle at 100% 0%, rgba(245, 158, 11, 0.08), transparent 24%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.02)),
    var(--color-bg-card);
  backdrop-filter: blur(10px);
}

.toolbar-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
}

.search-wrapper {
  position: relative;
  flex: 1 1 280px;
  min-width: 220px;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-muted);
  pointer-events: none;
  font-size: 14px;
}

.squad-search-input {
  width: 100%;
  min-width: 0;
  height: 38px;
  padding: 0 14px 0 34px;
  border-radius: 999px;
  border: 1px solid var(--color-border-default);
  background: rgba(15, 23, 42, 0.36);
  color: var(--color-text-primary);
  outline: none;
}

.squad-search-input:focus {
  border-color: rgba(56, 189, 248, 0.5);
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.12);
}

.filter-chips,
.refresh-controls,
.view-mode-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.filter-chip,
.toggle-btn,
.refresh-button,
.menu-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease, transform 0.16s ease;
}

.filter-chip.active,
.toggle-btn.active,
.refresh-button.active,
.refresh-button.primary-select {
  color: var(--color-text-primary);
  border-color: rgba(56, 189, 248, 0.4);
  background: linear-gradient(180deg, rgba(56, 189, 248, 0.18), rgba(56, 189, 248, 0.08));
}

.toggle-btn.active {
  border-color: rgba(245, 158, 11, 0.42);
  background: linear-gradient(180deg, rgba(245, 158, 11, 0.18), rgba(245, 158, 11, 0.08));
}

.refresh-button.primary {
  border-color: rgba(34, 197, 94, 0.34);
}

.refresh-button.secondary {
  border-color: rgba(56, 189, 248, 0.34);
}

.refresh-button.danger {
  border-color: rgba(239, 68, 68, 0.34);
}

.filter-chip:hover,
.toggle-btn:hover,
.refresh-button:hover,
.menu-item:hover {
  transform: translateY(-1px);
  color: var(--color-text-primary);
}

.filter-chip:disabled,
.toggle-btn:disabled,
.refresh-button:disabled,
.menu-item:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
}

.viewer-perspective-chip,
.ts-badge {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.025);
  color: var(--color-text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.toolbar-spacer {
  flex: 1 1 auto;
}

.toolbar-timestamps {
  display: flex;
  align-items: center;
  gap: 8px;
}

.select-icon,
.refresh-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 6px;
}

.refresh-dropdown {
  position: relative;
}

.refresh-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 20;
  min-width: 160px;
  display: grid;
  gap: 6px;
  padding: 8px;
  border-radius: 14px;
  border: 1px solid var(--color-border-default);
  background: rgba(8, 12, 18, 0.96);
  box-shadow: 0 18px 40px rgba(2, 6, 23, 0.28);
}

.menu-item {
  width: 100%;
  justify-content: flex-start;
}

.menu-fade-enter-active,
.menu-fade-leave-active {
  transition: opacity 0.14s ease, transform 0.14s ease;
}

.menu-fade-enter-from,
.menu-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 1100px) {
  .toolbar-spacer {
    display: none;
  }

  .toolbar-row {
    align-items: flex-start;
  }
}

@media (max-width: 760px) {
  .squad-page-toolbar {
    padding: 8px 10px;
  }

  .search-wrapper {
    flex-basis: 100%;
    min-width: 0;
  }

  .filter-chips,
  .refresh-controls,
  .view-mode-toggle {
    width: 100%;
  }

  .refresh-controls {
    gap: 6px;
  }

  .filter-chip,
  .toggle-btn,
  .refresh-button,
  .menu-item {
    min-height: 32px;
    padding: 0 10px;
    font-size: 12px;
  }
}
</style>
