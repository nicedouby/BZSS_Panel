<template>
  <section class="console-page">
    <header class="console-toolbar-area">
      <ConsoleToolbar
        v-if="!isMobile"
        :stream="filters.stream"
        :scope="filters.scope"
        :level="filters.level"
        :q="filters.q"
        :paused="filters.paused"
        :streams="channelsQuery.data.value?.streams ?? defaultStreams"
        :scopes="channelsQuery.data.value?.scopes ?? defaultScopes"
        :levels="channelsQuery.data.value?.levels ?? defaultLevels"
        @update:stream="setStream"
        @update:scope="filters.scope = $event"
        @update:level="filters.level = $event"
        @update:q="searchInput = $event"
        @toggle-paused="filters.paused = !filters.paused"
        @clear="clearVisibleLines"
      />
      <div v-else class="console-mobile-toolbar">
        <input
          :value="searchInput"
          class="console-mobile-search"
          :placeholder="t('console.filterLogs')"
          @input="searchInput = (($event.target as HTMLInputElement).value)"
        >
        <div class="console-mobile-actions">
          <button type="button" class="console-mobile-btn" @click="filters.paused = !filters.paused">
            {{ filters.paused ? t("common.resume") : t("common.pause") }}
          </button>
          <button type="button" class="console-mobile-btn" @click="clearVisibleLines">{{ t("common.clear") }}</button>
          <button type="button" class="console-mobile-btn" @click="filtersSheetOpen = true">Filters</button>
        </div>
      </div>
      <div class="console-status-bar">
        <StatusBadge :tone="filters.paused ? 'warn' : 'ok'">{{ filters.paused ? t("common.paused") : t("common.live") }}</StatusBadge>
        <StatusBadge :tone="hidden ? 'warn' : 'idle'">{{ hidden ? t("common.hidden") : t("common.visible") }}</StatusBadge>
        <span class="buffered-count">{{ t("console.linesBuffered", "", { count: lines.length }) }}</span>
        <span v-if="linesQuery.isFetching.value" class="fetching-indicator">{{ t("console.fetchingUpdates") }}</span>
      </div>
    </header>

    <main class="console-main">
      <DataState
        mode="fill"
        :error="pageError"
        :empty="!pageError && !lines.length && !linesQuery.isFetching.value"
        :empty-title="t('console.noLogsTitle')"
        :empty-text="t('console.noLogsText')"
      >
        <LogVirtualList :lines="lines" />
      </DataState>
    </main>

    <footer class="console-footer">
      <RconCommandInput />
    </footer>

    <MobileBottomSheet
      :open="filtersSheetOpen"
      title="Console Filters"
      description="Low-frequency filters moved off the main toolbar on mobile."
      @close="filtersSheetOpen = false"
    >
      <ConsoleToolbar
        :stream="filters.stream"
        :scope="filters.scope"
        :level="filters.level"
        :q="filters.q"
        :paused="filters.paused"
        :streams="channelsQuery.data.value?.streams ?? defaultStreams"
        :scopes="channelsQuery.data.value?.scopes ?? defaultScopes"
        :levels="channelsQuery.data.value?.levels ?? defaultLevels"
        @update:stream="setStream"
        @update:scope="filters.scope = $event"
        @update:level="filters.level = $event"
        @update:q="searchInput = $event"
        @toggle-paused="filters.paused = !filters.paused"
        @clear="clearVisibleLines"
      />
    </MobileBottomSheet>
  </section>
</template>

<script setup lang="ts">
import { onScopeDispose, reactive, ref, watch } from "vue";
import DataState from "../components/common/DataState.vue";
import StatusBadge from "../components/common/StatusBadge.vue";
import ConsoleToolbar from "../components/console/ConsoleToolbar.vue";
import LogVirtualList from "../components/console/LogVirtualList.vue";
import RconCommandInput from "../components/console/RconCommandInput.vue";
import MobileBottomSheet from "../components/mobile/MobileBottomSheet.vue";
import { useIsMobile } from "../composables/useMediaQuery";
import { useConsoleLines } from "../composables/useConsoleLines";
import { renderApiError } from "../app/errors";
import { t } from "../i18n";

const filters = reactive({
  stream: "modules",
  scope: "all",
  level: "all",
  q: "",
  paused: false,
});

const defaultStreams = [
  { id: "modules", title: t("console.streamModules") },
  { id: "raw-log", title: t("console.streamRawLog") },
  { id: "rcon-native", title: t("console.streamRconNative") },
];
const defaultScopes = [{ id: "all", title: t("console.allScopes") }];
const defaultLevels = [
  { id: "all", title: t("console.allLevels") },
  { id: "debug", title: t("console.debug") },
  { id: "info", title: t("console.info") },
  { id: "warn", title: t("console.warn") },
  { id: "error", title: t("console.error") },
];

const searchInput = ref("");
const isMobile = useIsMobile(1024);
const filtersSheetOpen = ref(false);
let searchTimer: number | null = null;

const { lines, hidden, clearVisibleLines, channelsQuery, linesQuery } = useConsoleLines(filters);
const pageError = ref("");

watch(searchInput, (value) => {
  if (searchTimer != null) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    filters.q = value.trim();
  }, 220);
});

onScopeDispose(() => {
  if (searchTimer != null) window.clearTimeout(searchTimer);
});

watch(
  () => linesQuery.error.value,
  (error) => {
    pageError.value = error ? renderApiError(error, t("console.noLogsText")) : "";
  },
  { immediate: true },
);

function setStream(value: string) {
  filters.stream = value;
  filters.scope = "all";
  filters.level = "all";
}
</script>

<style scoped>
.console-page {
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 12px;
  min-height: 0;
  background: var(--app-background, var(--color-bg-page));
}

.console-toolbar-area {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.console-status-bar {
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 11px;
  color: var(--color-text-muted);
  padding: 0 2px;
  flex-wrap: wrap;
}

.buffered-count {
  font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
  font-variant-numeric: tabular-nums;
}

.fetching-indicator {
  color: var(--color-status-info);
}

.console-main {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.console-footer {
  padding: 0;
}

.console-mobile-toolbar {
  display: grid;
  gap: 10px;
}

.console-mobile-search {
  min-height: var(--touch-target-min);
  padding: 0 14px;
  border-radius: 14px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.console-mobile-actions {
  display: flex;
  gap: 8px;
}

.console-mobile-btn {
  min-height: var(--touch-target-min);
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-card);
  color: var(--color-text-primary);
}

:deep(.rcon-input-group) {
  margin-bottom: 0;
}

@media (max-width: 1024px) {
  .console-page {
    gap: 10px;
    padding-bottom: calc(var(--safe-bottom) + 8px);
  }

  .console-footer {
    position: sticky;
    bottom: 0;
    z-index: var(--z-sticky-action);
    padding-bottom: var(--safe-bottom);
    background: linear-gradient(180deg, rgba(6, 9, 15, 0.05), rgba(6, 9, 15, 0.94) 24%);
  }
}

@media (orientation: landscape) and (max-height: 520px) {
  .console-page {
    gap: 6px;
    grid-template-rows: auto minmax(0, 1fr) auto;
    padding-bottom: 0;
  }

  .console-toolbar-area {
    gap: 6px;
  }

  .console-mobile-toolbar {
    grid-template-columns: minmax(180px, 1fr) auto;
    gap: 6px;
    align-items: center;
  }

  .console-mobile-search {
    border-radius: 10px;
    padding: 0 10px;
  }

  .console-mobile-actions {
    gap: 6px;
    flex-wrap: nowrap;
  }

  .console-mobile-btn {
    border-radius: 9px;
    padding: 0 10px;
  }

  .console-status-bar {
    gap: 8px;
    font-size: 10px;
  }

  .console-footer {
    padding-bottom: 0;
  }
}
</style>
