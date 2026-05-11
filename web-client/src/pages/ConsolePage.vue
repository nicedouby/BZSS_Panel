<template>
  <section class="page">
    <PageHeader title="Console" subtitle="Module logs, raw logs, and native RCON traces." />

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

    <DataState
      :error="pageError"
      :empty="!pageError && !lines.length && !linesQuery.isFetching.value"
      empty-title="No logs yet"
      empty-text="No console lines match the current filters."
    >
      <PageCard compact>
        <div class="console-status">
          <StatusBadge :tone="filters.paused ? 'warn' : 'ok'">{{ filters.paused ? "paused" : "live" }}</StatusBadge>
          <StatusBadge :tone="hidden ? 'warn' : 'idle'">{{ hidden ? "hidden" : "visible" }}</StatusBadge>
          <span>{{ lines.length }} lines buffered</span>
          <span v-if="linesQuery.isFetching.value">Fetching updates...</span>
        </div>
      </PageCard>

      <LogVirtualList :lines="lines" />
    </DataState>
  </section>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import DataState from "../components/common/DataState.vue";
import StatusBadge from "../components/common/StatusBadge.vue";
import ConsoleToolbar from "../components/console/ConsoleToolbar.vue";
import LogVirtualList from "../components/console/LogVirtualList.vue";
import { useConsoleLines } from "../composables/useConsoleLines";
import { renderApiError } from "../app/errors";

const filters = reactive({
  stream: "modules",
  scope: "all",
  level: "all",
  q: "",
  paused: false,
});

const defaultStreams = [
  { id: "modules", title: "Modules" },
  { id: "raw-log", title: "Raw Log" },
  { id: "rcon-native", title: "RCON Native" },
];
const defaultScopes = [{ id: "all", title: "All scopes" }];
const defaultLevels = [
  { id: "all", title: "All levels" },
  { id: "debug", title: "Debug" },
  { id: "info", title: "Info" },
  { id: "warn", title: "Warn" },
  { id: "error", title: "Error" },
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

watch(
  () => linesQuery.error.value,
  (error) => {
    pageError.value = error ? renderApiError(error, "Failed to load console lines.") : "";
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
.console-status {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  color: #a5b0b8;
  font-size: 12px;
}
</style>
