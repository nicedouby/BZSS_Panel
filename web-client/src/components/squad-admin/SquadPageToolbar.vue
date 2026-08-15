<template>
  <div class="squad-page-toolbar">
    <div class="toolbar-row">


      <div class="admin-warn-targets" aria-label="AdminWarn target">
        <span class="admin-warn-label">AdminWarn</span>
        <button type="button" class="admin-warn-choice all" :disabled="!canRefresh || isRefreshing" @click="$emit('warn-target', 'all')">All</button>
        <button type="button" class="admin-warn-choice team1" :disabled="!canRefresh || isRefreshing" @click="$emit('warn-target', 'team1')">TEAM 1</button>
        <button type="button" class="admin-warn-choice team2" :disabled="!canRefresh || isRefreshing" @click="$emit('warn-target', 'team2')">TEAM 2</button>
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
                :disabled="!canRefresh || isRefreshing || refreshingPlaytime"
                @click="runPlaytimeRefresh(false)"
              >
                智能刷新时长
              </button>
              <button
                type="button"
                class="menu-item danger-item"
                role="menuitem"
                :disabled="!canRefresh || isRefreshing || refreshingPlaytime"
                @click="runPlaytimeRefresh(true)"
              >
                强制刷新时长
              </button>
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

const props = defineProps<{
  canRefresh: boolean;
  refreshingType: RefreshType | "";
  refreshingPlaytime?: boolean;
  serverStatusUpdatedAt?: number;
  playersUpdatedAt?: number;
  squadsUpdatedAt?: number;
  multiSelectMode?: boolean;
}>();

const emit = defineEmits<{
  (event: "warn-target", target: "all" | "team1" | "team2"): void;
  (event: "refresh", type: RefreshType): void;
  (event: "refresh-playtime"): void;
  (event: "refresh-playtime-force"): void;
  (event: "warn-all"): void;
  (event: "toggle-multi-select"): void;
  (event: "view-mode-change", mode: "list" | "map"): void;
}>();

const isRefreshing = computed(() => Boolean(props.refreshingType));
const refreshingPlaytime = computed(() => Boolean(props.refreshingPlaytime));
const refreshMenuOpen = ref(false);
const refreshMenuRoot = ref<HTMLElement | null>(null);

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

function runPlaytimeRefresh(force: boolean) {
  emit(force ? "refresh-playtime-force" : "refresh-playtime");
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

.admin-warn-targets,
.refresh-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.admin-warn-choice,
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

.refresh-button.active,
.refresh-button.primary-select {
  color: var(--color-text-primary);
  border-color: rgba(56, 189, 248, 0.4);
  background: linear-gradient(180deg, rgba(56, 189, 248, 0.18), rgba(56, 189, 248, 0.08));
}

 .admin-warn-label {
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 700;
}

.admin-warn-choice.all { border-color: rgba(245, 158, 11, 0.48); color: #fcd34d; }
.admin-warn-choice.team1 { border-color: rgba(56, 189, 248, 0.48); color: #7dd3fc; }
.admin-warn-choice.team2 { border-color: rgba(251, 146, 60, 0.48); color: #fdba74; }

.danger-item {
  color: #fca5a5;
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

.admin-warn-choice:hover,
.refresh-button:hover,
.menu-item:hover {
  transform: translateY(-1px);
  color: var(--color-text-primary);
}

.admin-warn-choice:disabled,
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

  .admin-warn-targets,
  .refresh-controls {
    width: 100%;
  }

  .refresh-controls {
    gap: 6px;
  }

  .admin-warn-choice,
  .refresh-button,
  .menu-item {
    min-height: 32px;
    padding: 0 10px;
    font-size: 12px;
  }
}
</style>
