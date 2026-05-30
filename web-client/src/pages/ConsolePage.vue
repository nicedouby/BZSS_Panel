<template>
  <section class="console-page">
    <div class="console-frame">
      <header class="console-hero">
        <div class="hero-copy">
          <p class="eyebrow">{{ t("nav.console") }}</p>
          <h1 class="page-title">{{ t("console.title") }}</h1>
          <p class="page-subtitle">{{ t("console.subtitle") }}</p>
        </div>

        <div class="hero-stats">
          <div class="stat-card">
            <span class="stat-label">{{ t("common.live") }}</span>
            <strong class="stat-value">{{ filters.paused ? t("common.paused") : t("common.live") }}</strong>
          </div>
          <div class="stat-card">
            <span class="stat-label">{{ t("common.source") }}</span>
            <strong class="stat-value">{{ streamTitle }}</strong>
          </div>
          <div class="stat-card">
            <span class="stat-label">{{ t("common.visible") }}</span>
            <strong class="stat-value">{{ hidden ? t("common.hidden") : t("common.visible") }}</strong>
          </div>
          <div class="stat-card">
            <span class="stat-label">{{ t("common.lastUpdated") }}</span>
            <strong class="stat-value">{{ t("console.linesBuffered", "", { count: lines.length }) }}</strong>
          </div>
        </div>
      </header>

      <header class="console-toolbar-area">
        <ConsoleToolbar
          ref="toolbarRef"
          :stream="filters.stream"
          :scope="filters.scope"
          :level="filters.level"
          :q="filters.q"
          :paused="filters.paused"
          :has-active-filters="hasActiveFilters"
          :advanced-open="advancedOpen"
          :streams="channelsQuery.data.value?.streams ?? defaultStreams"
          :scopes="channelsQuery.data.value?.scopes ?? defaultScopes"
          :levels="channelsQuery.data.value?.levels ?? defaultLevels"
          @update:stream="setStream"
          @update:scope="filters.scope = $event"
          @update:level="filters.level = $event"
          @update:q="searchInput = $event"
          @toggle-paused="filters.paused = !filters.paused"
          @toggle-advanced="advancedOpen = !advancedOpen"
          @clear="clearVisibleLines"
          @reset-filters="resetFilters"
        />
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
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import DataState from "../components/common/DataState.vue";
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
const advancedOpen = ref(false);
let searchTimer: number | null = null;
const hasActiveFilters = computed(() => {
  return filters.stream !== "modules" || filters.scope !== "all" || filters.level !== "all" || Boolean(filters.q.trim());
});

const { lines, hidden, clearVisibleLines, channelsQuery, linesQuery } = useConsoleLines(filters);
const pageError = ref("");
const streamTitle = computed(() => {
  const items = channelsQuery.data.value?.streams ?? defaultStreams;
  return items.find((item) => item.id === filters.stream)?.title ?? filters.stream;
});

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
  advancedOpen.value = false;
}
</script>

<style scoped>
.console-page {
  height: 100%;
  min-height: 0;
  padding: 16px;
  background:
    radial-gradient(circle at top left, rgba(88, 166, 255, 0.12), transparent 32%),
    radial-gradient(circle at top right, rgba(63, 113, 88, 0.14), transparent 28%),
    linear-gradient(180deg, #0b0f14 0%, #10141a 100%);
}

.console-frame {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  border: 1px solid rgba(95, 111, 128, 0.26);
  border-radius: 20px;
  overflow: hidden;
  background: rgba(12, 16, 22, 0.86);
  box-shadow: 0 20px 52px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(14px);
}

.console-hero {
  padding: 18px 20px 14px;
  display: flex;
  gap: 18px;
  align-items: stretch;
  justify-content: space-between;
  flex-wrap: wrap;
  border-bottom: 1px solid rgba(95, 111, 128, 0.18);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.024), rgba(255, 255, 255, 0)),
    rgba(255, 255, 255, 0.01);
}

.hero-copy {
  display: grid;
  gap: 4px;
  align-content: start;
  min-width: 240px;
}

.eyebrow {
  margin: 0;
  color: #7d8894;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

.page-title {
  margin: 0;
  font-size: 20px;
  line-height: 1.2;
  color: #e6edf3;
}

.page-subtitle {
  margin: 0;
  max-width: 68ch;
  color: #9aa7b2;
  font-size: 13px;
  line-height: 1.5;
}

.hero-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(140px, 1fr));
  gap: 10px;
  align-self: center;
}

.stat-card {
  min-width: 0;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(95, 111, 128, 0.2);
  background: rgba(255, 255, 255, 0.02);
}

.stat-label {
  display: block;
  margin-bottom: 4px;
  color: #7d8894;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.stat-value {
  display: block;
  color: #e6edf3;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.console-toolbar-area {
  flex-shrink: 0;
  padding: 16px 20px 14px;
  border-bottom: 1px solid rgba(95, 111, 128, 0.16);
  background: rgba(13, 17, 23, 0.82);
}

.console-status-bar {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 12px;
  color: #98a5b1;
}

.buffered-count {
  font-family: monospace;
  color: #c9d1d9;
}

.fetching-indicator {
  color: #58a6ff;
}

.console-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.01), rgba(255, 255, 255, 0));
}

.console-footer {
  flex-shrink: 0;
  padding: 14px 20px 18px;
  border-top: 1px solid rgba(95, 111, 128, 0.16);
  background: rgba(13, 17, 23, 0.9);
}

:deep(.rcon-input-group) {
  margin-bottom: 0;
}

@media (max-width: 900px) {
  .console-page {
    padding: 12px;
  }

  .console-frame {
    border-radius: 14px;
  }

  .console-header,
  .console-hero,
  .console-toolbar-area,
  .console-footer {
    padding-left: 14px;
    padding-right: 14px;
  }

  .hero-stats {
    grid-template-columns: 1fr;
    width: 100%;
  }
}
</style>
