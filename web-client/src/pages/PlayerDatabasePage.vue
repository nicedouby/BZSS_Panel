<template>
  <section class="db-page">
    <PlayerDatabaseStats :stats="overviewCards" />

    <PlayerDatabaseToolbar v-model="filters" @open-stats="openStatsModal" />

    <div class="db-main">
      <aside class="db-sidebar">
        <PlayerDatabaseList
          :rows="rows"
          :selected-id="selectedId"
          :loading="listLoading"
          :error="listError"
          @select="openPlayer"
        />
      </aside>

      <section class="db-content">
        <PlayerDatabaseDetail
          :id="selectedId"
          :detail="detail"
          :loading="detailLoading"
          :error="detailError"
          @close="closePlayerDetail"
          @retry="retryDetail"
        />
      </section>
    </div>

    <PlayerDatabaseStatsModal
      v-model:days="statsDays"
      v-model:top="statsTop"
      :open="showStatsModal"
      :loading="statsLoading"
      :error="statsError"
      :stats="stats"
      :subtitle="statsSubtitle"
      @close="closeStatsModal"
      @refresh="loadStats"
      @jump="jumpToPlayerFromStats"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useRoute } from "vue-router";
import { ApiError, apiGet } from "../app/apiClient";
import { queryClient } from "../app/queryClient";
import { renderApiError } from "../app/errors";
import { useServerStore } from "../stores/server.store";
import { usePlayerDatabaseQuery } from "../composables/usePlayerDatabaseQuery";
import PlayerDatabaseStats from "../components/player-database/PlayerDatabaseStats.vue";
import PlayerDatabaseToolbar from "../components/player-database/PlayerDatabaseToolbar.vue";
import PlayerDatabaseList from "../components/player-database/PlayerDatabaseList.vue";
import PlayerDatabaseDetail from "../components/player-database/PlayerDatabaseDetail.vue";
import PlayerDatabaseStatsModal from "../components/player-database/PlayerDatabaseStatsModal.vue";
import { currentLocale, t } from "../i18n";

const filters = reactive({
  q: "",
  sort: "updated_desc",
  limit: 200,
  offset: 0,
});

const statsDays = ref("14");
const statsTop = ref("10");
const showStatsModal = ref(false);
const statsLoading = ref(false);
const statsError = ref("");
const stats = ref<any | null>(null);
const route = useRoute();
const server = useServerStore();

const statsSubtitle = computed(() => {
  const generatedAt = stats.value?.generatedAt ? formatTime(stats.value.generatedAt) : t("common.notLoaded");
  return t("database.statsSubtitle", "", {
    days: statsDays.value,
    top: statsTop.value,
    time: generatedAt,
  });
});

const selectedId = ref<number | null>(null);

const { query } = usePlayerDatabaseQuery(filters);

const rows = computed(() => query.data.value?.items ?? query.data.value?.players ?? []);
const listLoading = computed(() => query.isLoading.value && !rows.value.length);
const listError = computed(() => (query.error.value && !rows.value.length ? renderApiError(query.error.value, t("common.error")) : ""));

const detailQuery = useQuery({
  queryKey: computed(() => ["player-database-detail", selectedId.value]),
  enabled: computed(() => selectedId.value !== null),
  queryFn: async () => apiGet<any>(`/api/player-database/detail?id=${encodeURIComponent(String(selectedId.value))}`, {}, { timeoutMs: 5_000 }),
  retry: false,
  refetchOnWindowFocus: false,
  staleTime: 10_000,
  gcTime: 60_000,
});

const detail = computed(() => (selectedId.value === null ? null : detailQuery.data.value ?? null));
const detailLoading = computed(() => selectedId.value !== null && detailQuery.isLoading.value && !detail.value);
const detailError = computed(() => {
  if (selectedId.value === null) return "";
  const error = detailQuery.error.value;
  if (!error) return "";
  if (error instanceof ApiError && error.type === "abort") return "";
  if (error instanceof ApiError && error.type === "timeout") return t("common.error");
  return renderApiError(error, t("common.error"));
});

const overviewCards = computed(() => {
  const overview = stats.value?.overview ?? null;
  return [
    { label: t("database.title"), value: overview ? formatNumber(overview.totalPlayers ?? 0) : "--" },
    { label: t("database.active"), value: overview ? formatNumber(overview.activePlayersInWindow ?? 0) : "--" },
    { label: t("database.matches"), value: overview ? formatNumber(overview.totalMatches ?? 0) : "--" },
    { label: t("database.gameTime"), value: overview ? formatHoursFromSeconds(overview.totalGameSeconds ?? 0) : "--" },
    { label: t("database.serverTime"), value: overview ? formatHoursFromSeconds(overview.totalServerSeconds ?? 0) : "--" },
  ];
});

watch(
  () => route.query.q,
  (value) => {
    const next = String(value ?? "").trim();
    if (next !== filters.q) {
      filters.q = next;
    }
  },
  { immediate: true },
);

watch(
  () => [filters.q, filters.sort],
  () => {
    void queryClient.cancelQueries({ queryKey: ["player-database-detail"] });
    selectedId.value = null;
  },
);

onBeforeUnmount(() => {
  void queryClient.cancelQueries({ queryKey: ["player-database-detail"] });
});

async function cancelDetailQueries() {
  await queryClient.cancelQueries({ queryKey: ["player-database-detail"] });
}

async function openPlayer(id: number) {
  await cancelDetailQueries();
  selectedId.value = Number(id);
}

async function closePlayerDetail() {
  await cancelDetailQueries();
  selectedId.value = null;
}

async function retryDetail() {
  if (selectedId.value === null) return;
  await detailQuery.refetch();
}

async function openStatsModal() {
  showStatsModal.value = true;
  await loadStats();
}

function closeStatsModal() {
  showStatsModal.value = false;
}

async function loadStats() {
  statsLoading.value = true;
  statsError.value = "";
  try {
    const params = new URLSearchParams({
      days: String(statsDays.value),
      top: String(statsTop.value),
    });
    stats.value = await apiGet<any>(`/api/db/stats?${params.toString()}`);
  } catch (error) {
    statsError.value = renderApiError(error, t("common.error"));
  } finally {
    statsLoading.value = false;
  }
}

async function jumpToPlayerFromStats(playerId: number) {
  showStatsModal.value = false;
  await openPlayer(playerId);
}

function formatTime(value: unknown) {
  const time = Number(value ?? 0);
  if (!time) return "--";
  return new Date(time).toLocaleString(currentLocale.value);
}

function formatHoursFromSeconds(value: unknown) {
  return `${(Math.max(0, Number(value ?? 0)) / 3600).toFixed(1)} h`;
}

function formatNumber(value: unknown) {
  return new Intl.NumberFormat(currentLocale.value).format(Number(value ?? 0));
}
</script>

<style scoped>
.db-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  min-height: 0;
  padding: 16px;
  overflow: hidden;
  background: var(--app-background);
}

.db-main {
  flex: 1;
  display: grid;
  grid-template-columns: 380px minmax(0, 1fr);
  gap: 16px;
  min-height: 0;
  overflow: hidden;
}

.db-sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--color-bg-panel);
  border: 1px solid var(--color-border-default);
  border-radius: 12px;
}

.db-content {
  min-height: 0;
  overflow: hidden;
}

@media (max-width: 1000px) {
  .db-main {
    grid-template-columns: 1fr;
  }
  
  .db-sidebar {
    max-height: 400px;
  }
}
</style>
