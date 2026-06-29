<template>
  <div class="squad-page-toolbar">
    <!-- 单行工具栏：搜索 + 筛选 + 视角标签 + 操作按钮 全部在一行 -->
    <div class="toolbar-row">
      <!-- 搜索框 -->
      <div class="search-wrapper">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <input
          v-model="searchQuery"
          type="text"
          class="squad-search-input"
          :placeholder="t('match.searchPlaceholder')"
          @input="$emit('search', searchQuery)"
        >
      </div>

      <!-- 筛选芯片 -->
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

      <!-- 视角标签（有则显示） -->
      <div v-if="showViewerPerspective" class="viewer-perspective-chip">
        {{ viewerPerspectiveText }}
      </div>

      <!-- 视图切换 -->
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

      <!-- 弹性占位 -->
      <div class="toolbar-spacer" />

      <!-- 时间戳元信息 -->
      <div v-if="serverStatusUpdatedAt || playersUpdatedAt" class="toolbar-timestamps">
        <span v-if="playersUpdatedAt" class="ts-badge" :title="`玩家数据更新时间: ${formatTimestamp(playersUpdatedAt)}`">
          {{ formatTimestampShort(playersUpdatedAt) }}
        </span>
      </div>

      <!-- 操作按钮 -->
      <div class="refresh-controls">
        <button
          type="button"
          class="refresh-button"
          :class="{ active: multiSelectMode, 'primary-select': multiSelectMode }"
          @click="$emit('toggle-multi-select')"
          :title="multiSelectMode ? '关闭批量操作' : '开启批量操作'"
        >
          <span class="select-icon">☑</span>
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
          :title="'智能刷新 Steam 时长（跳过 30 分钟内已刷新的玩家）'"
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
        <button
          type="button"
          class="refresh-button primary"
          :disabled="!canRefresh || isRefreshing || refreshingPlaytime || refreshingSnapshot"
          :title="'涓存椂鐢熸垚瀵瑰眬蹇収'"
          @click="$emit('capture-snapshot')"
        >
          {{ refreshingSnapshot ? '鐢熸垚涓?..' : '涓存椂鐢熸垚' }}
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
  refreshingSnapshot?: boolean;
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
  (event: "capture-snapshot"): void;
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
const isRefreshing = computed(() => Boolean(props.refreshingType) || Boolean(props.refreshingSnapshot));
const refreshingPlaytime = computed(() => Boolean(props.refreshingPlaytime));
const refreshingSnapshot = computed(() => Boolean(props.refreshingSnapshot));
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
  () => [props.refreshingType, props.refreshingPlaytime, props.refreshingSnapshot],
  () => {
    if (isRefreshing.value || refreshingPlaytime.value || refreshingSnapshot.value) {
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

function formatTimestamp(ms: number | undefined): string {
  if (!ms) return "--";
  return new Date(ms).toLocaleTimeString("zh-CN", { hour12: false });
}

function formatTimestampShort(ms: number | undefined): string {
  if (!ms) return "--";
  return new Date(ms).toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

onBeforeUnmount(() => {
  removeWindowListeners();
});
</script>

<style scoped>
/* ─── 单行工具栏容器 ─────────────────────────────────────────────────────── */
.squad-page-toolbar {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(255, 255, 255, 0.01)),
    var(--color-bg-card);
  border-bottom: 1px solid var(--color-border-default);
  padding: 8px var(--spacing-lg);
  flex-shrink: 0;
  min-width: 0;
  backdrop-filter: blur(12px);
}

.toolbar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

/* ─── 搜索框 ──────────────────────────────────────────────────────────────── */
.search-wrapper {
  position: relative;
  flex: 0 0 auto;
  width: min(300px, 30vw);
  min-width: 180px;
}

.search-icon {
  position: absolute;
  left: 9px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 15px;
  color: var(--color-text-muted);
  pointer-events: none;
  line-height: 1;
  opacity: 0.7;
}

.squad-search-input {
  width: 100%;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
  padding: 5px 10px 5px 28px;
  border-radius: var(--radius-full);
  font-size: var(--font-size-sm);
  transition: all 0.18s ease;
  height: 30px;
}

.squad-search-input:focus {
  outline: none;
  border-color: var(--color-status-info);
  background: var(--color-bg-elevated);
  box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.12);
}

.squad-search-input::placeholder {
  color: var(--color-text-muted);
  font-size: 11px;
}

/* ─── 筛选芯片 ───────────────────────────────────────────────────────────── */
.filter-chips {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-wrap: wrap;
}

.filter-chip {
  height: 26px;
  padding: 0 9px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-muted);
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.14s ease;
  font-weight: 500;
}

.filter-chip:hover {
  border-color: var(--color-border-default);
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.04);
}

.filter-chip.active {
  color: #bfdbfe;
  border-color: rgba(96, 165, 250, 0.45);
  background: rgba(96, 165, 250, 0.12);
  font-weight: 700;
}

/* ─── 视角标签 ───────────────────────────────────────────────────────────── */
.viewer-perspective-chip {
  height: 26px;
  padding: 0 10px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-team1-border);
  background: rgba(55, 200, 255, 0.07);
  color: var(--color-team1-primary);
  font-size: 10px;
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  font-weight: 600;
}

/* ─── 弹性占位 ───────────────────────────────────────────────────────────── */
.toolbar-spacer {
  flex: 1 1 auto;
  min-width: 0;
}

/* ─── 时间戳元信息 ───────────────────────────────────────────────────────── */
.toolbar-timestamps {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.ts-badge {
  height: 22px;
  padding: 0 8px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
  cursor: default;
}

/* ─── 刷新操作区 ─────────────────────────────────────────────────────────── */
.refresh-controls {
  display: inline-flex;
  gap: 5px;
  align-items: center;
  flex: 0 0 auto;
}

.refresh-button {
  padding: 4px 10px;
  height: 28px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
  border-radius: var(--radius-sm);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.14s ease;
  font-weight: 500;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.refresh-button.primary {
  min-width: 96px;
  background: rgba(96, 165, 250, 0.08);
  color: #93c5fd;
  border-color: rgba(96, 165, 250, 0.28);
  font-weight: 600;
}

.refresh-button.primary:hover:not(:disabled) {
  background: rgba(96, 165, 250, 0.16);
  border-color: rgba(96, 165, 250, 0.5);
  color: #bfdbfe;
}

.refresh-button.secondary {
  background: rgba(55, 200, 255, 0.06);
  color: var(--color-team1-primary);
  border-color: rgba(55, 200, 255, 0.2);
}

.refresh-button.secondary:hover:not(:disabled) {
  background: rgba(55, 200, 255, 0.12);
  border-color: rgba(55, 200, 255, 0.38);
}

.refresh-button.danger {
  background: rgba(248, 113, 113, 0.06);
  color: #fca5a5;
  border-color: rgba(248, 113, 113, 0.22);
}

.refresh-button.danger:hover:not(:disabled) {
  background: rgba(248, 113, 113, 0.12);
  border-color: rgba(248, 113, 113, 0.4);
}

.refresh-button:hover:not(:disabled) {
  color: var(--color-text-primary);
}

.refresh-button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.refresh-dropdown {
  position: relative;
}

.refresh-menu-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.refresh-caret {
  color: var(--color-text-muted);
  font-size: 10px;
}

.refresh-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 170px;
  padding: 6px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.02)), rgba(255, 255, 255, 0.01)),
    var(--color-bg-card);
  box-shadow: var(--shadow-lg);
  display: grid;
  gap: 5px;
  z-index: 10;
}

.refresh-menu .menu-item {
  width: 100%;
  justify-content: flex-start;
  text-align: left;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-secondary);
  border-radius: var(--radius-sm);
  padding: 7px 10px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.refresh-menu .menu-item:hover:not(:disabled) {
  color: var(--color-text-primary);
  border-color: var(--color-status-info);
  background: rgba(96, 165, 250, 0.08);
}

/* ─── 响应式 ─────────────────────────────────────────────────────────────── */
@media (max-width: 1180px) {
  .toolbar-timestamps {
    display: none;
  }

  .search-wrapper {
    width: min(240px, 28vw);
    min-width: 160px;
  }
}

@media (max-width: 900px) {
  .squad-page-toolbar {
    padding: 8px 12px;
  }

  .toolbar-row {
    gap: 8px;
    row-gap: 8px;
  }

  /* 搜索框：独占第一行并加大触控高度 */
  .search-wrapper {
    order: -1;
    flex: 1 0 100%;
    width: 100%;
    min-width: 0;
  }

  .squad-search-input {
    height: 40px;
    font-size: 14px;
    padding: 6px 12px 6px 32px;
  }

  .search-icon {
    font-size: 17px;
  }

  /* 筛选 + 视图切换：放大芯片便于点按 */
  .filter-chips {
    flex: 1 1 auto;
    gap: 6px;
  }

  .filter-chip {
    height: 34px;
    padding: 0 14px;
    font-size: 12px;
  }

  .view-mode-toggle {
    margin-left: 0;
  }

  .toggle-btn {
    height: 30px;
    padding: 0 16px;
    font-size: 12px;
  }

  .toolbar-spacer {
    display: none;
  }

  /* 操作按钮：占满整行并均分宽度，避免拥挤难点 */
  .refresh-controls {
    flex: 1 0 100%;
    flex-wrap: wrap;
    gap: 8px;
  }

  .refresh-button {
    flex: 1 1 auto;
    justify-content: center;
    min-height: 42px;
    height: auto;
    padding: 9px 12px;
    font-size: 12px;
  }

  .refresh-button.primary {
    min-width: 0;
  }

  /* 保留强制刷新入口，移动端也可触达 */
  .refresh-button.danger {
    display: inline-flex;
  }

  .refresh-dropdown {
    flex: 1 1 auto;
    display: flex;
  }

  .refresh-menu-trigger {
    width: 100%;
    justify-content: center;
  }

  .refresh-menu {
    left: 0;
    right: 0;
    min-width: 0;
  }

  .refresh-menu .menu-item {
    min-height: 42px;
    font-size: 13px;
  }
}

@media (max-width: 480px) {
  .filter-chip {
    flex: 1 1 auto;
    text-align: center;
  }
}

/* ─── 批量操作按钮样式 ───────────────────────────────────────────────────── */
.refresh-button.primary-select {
  background: rgba(96, 165, 250, 0.16) !important;
  border-color: rgba(96, 165, 250, 0.45) !important;
  color: #bfdbfe !important;
  font-weight: 700;
}

.refresh-button.primary-select:hover {
  background: rgba(96, 165, 250, 0.24) !important;
  border-color: rgba(96, 165, 250, 0.6) !important;
}

.select-icon {
  font-size: 13px;
  line-height: 1;
}

/* ─── 动画 ───────────────────────────────────────────────────────────────── */
.menu-fade-enter-active,
.menu-fade-leave-active {
  transition: opacity 0.1s ease, transform 0.1s ease;
}

.menu-fade-enter-from,
.menu-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ─── 视图切换 ───────────────────────────────────────────────────────────── */
.view-mode-toggle {
  display: flex;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--color-border-soft);
  border-radius: var(--radius-full);
  padding: 2px;
  gap: 2px;
  margin-left: 4px;
}

.toggle-btn {
  height: 22px;
  padding: 0 10px;
  border-radius: var(--radius-full);
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.toggle-btn:hover {
  color: var(--color-text-secondary);
  background: rgba(255, 255, 255, 0.02);
}

.toggle-btn.active {
  background: rgba(96, 165, 250, 0.15);
  color: #93c5fd;
  font-weight: 600;
}
</style>
