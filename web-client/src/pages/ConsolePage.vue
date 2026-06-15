<template>
  <section class="console-page">
    <header class="console-toolbar-area">
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
  </section>
</template>

<script setup lang="ts">
import { onScopeDispose, reactive, ref, watch } from "vue";
import DataState from "../components/common/DataState.vue";
import StatusBadge from "../components/common/StatusBadge.vue";
import ConsoleToolbar from "../components/console/ConsoleToolbar.vue";
import LogVirtualList from "../components/console/LogVirtualList.vue";
import RconCommandInput from "../components/console/RconCommandInput.vue";
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
}

.console-footer {
  padding: 0;
}

:deep(.rcon-input-group) {
  margin-bottom: 0;
}
</style>
