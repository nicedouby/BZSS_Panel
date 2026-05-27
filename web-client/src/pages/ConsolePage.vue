<template>
  <section class="console-page">
    <header class="console-toolbar-area">
      <ConsoleToolbar
        ref="toolbarRef"
        :stream="filters.stream"
        :scope="filters.scope"
        :level="filters.level"
        :q="filters.q"
        :paused="filters.paused"
        :has-active-filters="hasActiveFilters"
        :streams="channelsQuery.data.value?.streams ?? defaultStreams"
        :scopes="channelsQuery.data.value?.scopes ?? defaultScopes"
        :levels="channelsQuery.data.value?.levels ?? defaultLevels"
        @update:stream="setStream"
        @update:scope="filters.scope = $event"
        @update:level="filters.level = $event"
        @update:q="searchInput = $event"
        @toggle-paused="filters.paused = !filters.paused"
        @clear="clearVisibleLines"
        @reset-filters="resetFilters"
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
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
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
const toolbarRef = ref<InstanceType<typeof ConsoleToolbar> | null>(null);
let searchTimer: number | null = null;
const hasActiveFilters = computed(() => {
  return filters.stream !== "modules" || filters.scope !== "all" || filters.level !== "all" || Boolean(filters.q.trim());
});

const { lines, hidden, clearVisibleLines, channelsQuery, linesQuery } = useConsoleLines(filters);
const pageError = ref("");

watch(searchInput, (value) => {
  if (searchTimer != null) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    filters.q = value.trim();
  }, 220);
});

watch(
  () => linesQuery.error.value,
  (error) => {
    pageError.value = error ? renderApiError(error, t("console.noLogsText")) : "";
  },
  { immediate: true },
);

function onGlobalKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    toolbarRef.value?.focusSearch?.();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onGlobalKeydown);
});

onBeforeUnmount(() => {
  if (searchTimer != null) {
    window.clearTimeout(searchTimer);
    searchTimer = null;
  }
  window.removeEventListener("keydown", onGlobalKeydown);
});

function setStream(value: string) {
  filters.stream = value;
  filters.scope = "all";
  filters.level = "all";
}

function resetFilters() {
  if (searchTimer != null) {
    window.clearTimeout(searchTimer);
    searchTimer = null;
  }
  filters.stream = "modules";
  filters.scope = "all";
  filters.level = "all";
  filters.q = "";
  searchInput.value = "";
}
</script>

<style scoped>
.console-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #0d1117;
}

.console-toolbar-area {
  flex-shrink: 0;
  padding: 12px 16px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.console-status-bar {
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 11px;
  color: #8b949e;
}

.buffered-count {
  font-family: monospace;
}

.fetching-indicator {
  color: #58a6ff;
}

.console-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.console-footer {
  flex-shrink: 0;
  padding: 12px 16px;
  background: #161b22;
  border-top: 1px solid #30363d;
}

:deep(.rcon-input-group) {
  margin-bottom: 0;
}
</style>
