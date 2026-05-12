<template>
  <section class="page">
    <PageHeader :title="t('console.title')" :subtitle="t('console.subtitle')" />

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
      :empty-title="t('console.noLogsTitle')"
      :empty-text="t('console.noLogsText')"
    >
      <PageCard compact>
        <div class="console-status">
          <StatusBadge :tone="filters.paused ? 'warn' : 'ok'">{{ filters.paused ? t("common.paused") : t("common.live") }}</StatusBadge>
          <StatusBadge :tone="hidden ? 'warn' : 'idle'">{{ hidden ? t("common.hidden") : t("common.visible") }}</StatusBadge>
          <span>{{ t("console.linesBuffered", "", { count: lines.length }) }}</span>
          <span v-if="linesQuery.isFetching.value">{{ t("console.fetchingUpdates") }}</span>
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
.console-status {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  color: #a5b0b8;
  font-size: 12px;
}
</style>
