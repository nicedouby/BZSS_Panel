<template>
  <section class="db-page">
    <header class="db-hero">
      <div>
        <div class="eyebrow">{{ t("database.dataCenter") }}</div>
        <h1>{{ t("database.title") }}</h1>
        <p>{{ t("database.pageDescription") }}</p>
      </div>
      <div class="hero-status">
        <span class="status-dot" :class="{ loading: statsLoading }"></span>
        <div>
          <small>{{ t("database.lastStatsUpdate") }}</small>
          <strong>{{ statsUpdatedAt }}</strong>
        </div>
      </div>
    </header>

    <PlayerDatabaseStats :stats="overviewCards" />

    <PlayerDatabaseToolbar
      :model-value="filters"
      :total="resultTotal"
      :loading="listFetching"
      @update:model-value="onFiltersChange"
      @open-stats="openStatsModal"
    />

    <div class="db-main">
      <aside v-if="!isMobile || selectedId === null" class="db-sidebar">
        <PlayerDatabaseList
          :rows="rows"
          :selected-id="selectedId"
          :loading="listLoading"
          :error="listError"
          @select="openPlayer"
        />
      </aside>

      <section v-if="!isMobile || selectedId !== null" class="db-content">
        <div v-if="isMobile && selectedId !== null" class="db-mobile-backbar">
          <button type="button" class="db-back-btn" @click="closePlayerDetail">Back</button>
          <strong>{{ t("database.playerDetail") }}</strong>
        </div>
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
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useRoute } from "vue-router";
import { ApiError, apiGet } from "../app/apiClient";
import { queryClient } from "../app/queryClient";
import { renderApiError } from "../app/errors";
import { useIsMobile } from "../composables/useMediaQuery";
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
const isMobile = useIsMobile(1024);

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

const rowsRaw = computed(() => query.data.value?.items ?? query.data.value?.players ?? []);
const rows = computed(() => sortRows(rowsRaw.value, filters.sort));
const resultTotal = computed(() => Number(query.data.value?.total ?? rowsRaw.value.length));
const listLoading = computed(() => query.isLoading.value && !rowsRaw.value.length);
const listFetching = computed(() => query.isFetching.value);
const listError = computed(() => (query.error.value && !rowsRaw.value.length ? renderApiError(query.error.value, t("common.error")) : ""));
const statsUpdatedAt = computed(() => stats.value?.generatedAt
  ? formatRelativeTime(stats.value.generatedAt)
  : t("common.notLoaded"));

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
  const activity = stats.value?.activity ?? null;
  const engagement = stats.value?.engagement ?? null;
  const playerStats7d = stats.value?.playerStats7d ?? null;
  return [
    {
      label: t("database.totalPlayers"),
      value: overview ? formatNumber(overview.totalPlayers ?? 0) : "--",
      hint: activity ? t("database.active24hHint", "", { count: formatNumber(activity.active24h ?? 0) }) : "",
      icon: "人",
      tone: "blue" as const,
    },
    {
      label: t("database.activePlayers7d"),
      value: activity ? formatNumber(activity.active7d ?? 0) : "--",
      hint: activity ? t("database.active30dHint", "", { count: formatNumber(activity.active30d ?? 0) }) : "",
      icon: "活",
      tone: "green" as const,
    },
    {
      label: t("database.newPlayers7d"),
      value: playerStats7d ? formatNumber(playerStats7d.newPlayers ?? 0) : "--",
      hint: playerStats7d ? t("database.repeatRateHint", "", { rate: formatPercent(playerStats7d.repeatRate ?? 0) }) : "",
      icon: "新",
      tone: "violet" as const,
    },
    {
      label: t("database.totalPlaytime"),
      value: overview ? formatCompactHours(overview.totalGameSeconds ?? 0) : "--",
      hint: engagement ? t("database.averagePlaytimeHint", "", { hours: formatHours(engagement.averageGameSeconds ?? 0) }) : "",
      icon: "时",
      tone: "blue" as const,
    },
    {
      label: t("database.matches"),
      value: overview ? formatNumber(overview.totalMatches ?? 0) : "--",
      hint: engagement ? t("database.averageMatchesHint", "", { count: Number(engagement.averageMatches ?? 0).toFixed(1) }) : "",
      icon: "局",
      tone: "amber" as const,
    },
    {
      label: t("database.warmupContribution"),
      value: overview ? formatCompactHours(overview.totalWarmupSeconds ?? 0) : "--",
      hint: engagement ? t("database.warmupPlayersHint", "", { count: formatNumber(engagement.warmupPlayers ?? 0) }) : "",
      icon: "暖",
      tone: "amber" as const,
    },
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

function onFiltersChange(value: { q: string; sort: string }) {
  filters.q = String(value?.q ?? "");
  filters.sort = String(value?.sort ?? "updated_desc");
}

onBeforeUnmount(() => {
  void queryClient.cancelQueries({ queryKey: ["player-database-detail"] });
});

onMounted(() => {
  void loadStats();
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

function formatHours(value: unknown) {
  return (Math.max(0, Number(value ?? 0)) / 3600).toFixed(1);
}

function formatCompactHours(value: unknown) {
  const hours = Math.max(0, Number(value ?? 0)) / 3600;
  if (hours >= 1_000_000) return `${(hours / 1_000_000).toFixed(1)}M h`;
  if (hours >= 1_000) return `${(hours / 1_000).toFixed(1)}k h`;
  return `${hours.toFixed(1)} h`;
}

function formatNumber(value: unknown) {
  return new Intl.NumberFormat(currentLocale.value).format(Number(value ?? 0));
}

function formatPercent(value: unknown) {
  const ratio = Number(value ?? 0);
  if (!Number.isFinite(ratio)) return "--";
  return `${(Math.max(0, ratio) * 100).toFixed(1)}%`;
}

function formatRelativeTime(value: unknown) {
  const time = Number(value ?? 0);
  if (!time) return "--";
  const deltaSeconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (deltaSeconds < 60) return t("database.justNow");
  if (deltaSeconds < 3600) return t("database.minutesAgo", "", { count: Math.floor(deltaSeconds / 60) });
  return formatTime(time);
}

function sortRows(input: any[], sort: string) {
  const rows = Array.isArray(input) ? [...input] : [];
  if (!rows.length) return rows;

  if (sort === "name_asc") {
    return rows.sort((a, b) => {
      const aName = String(a?.current_name ?? a?.name ?? "");
      const bName = String(b?.current_name ?? b?.name ?? "");
      return aName.localeCompare(bName, currentLocale.value, { sensitivity: "base" });
    });
  }

  if (sort === "playtime_desc") {
    return rows.sort((a, b) =>
      Number(b?.game_seconds ?? b?.gameSeconds ?? 0) - Number(a?.game_seconds ?? a?.gameSeconds ?? 0));
  }

  if (sort === "matches_desc") {
    return rows.sort((a, b) =>
      Number(b?.total_matches ?? b?.totalMatches ?? 0) - Number(a?.total_matches ?? a?.totalMatches ?? 0));
  }

  return rows.sort((a, b) => getSortTime(b) - getSortTime(a));
}

function getSortTime(row: any) {
  const updated = Number(row?.updated_at ?? row?.updatedAt ?? 0);
  if (Number.isFinite(updated) && updated > 0) return updated;

  const lastLogin = Number(row?.last_login_at ?? row?.lastLoginAt ?? 0);
  if (Number.isFinite(lastLogin) && lastLogin > 0) return lastLogin;

  return 0;
}
</script>

<style scoped>
.db-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  padding: clamp(12px, 1.2vw, 20px);
  overflow: hidden;
  background: var(--app-background, var(--color-bg-page));
}

.db-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding: 2px 2px 4px;
}

.eyebrow {
  margin-bottom: 4px;
  color: #6cb8f3;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .16em;
  text-transform: uppercase;
}

.db-hero h1 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: clamp(22px, 2vw, 30px);
  letter-spacing: -.035em;
  line-height: 1.1;
}

.db-hero p {
  margin: 6px 0 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.hero-status {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 11px;
  border: 1px solid var(--color-border-default);
  border-radius: 11px;
  background: var(--color-bg-panel);
}

.hero-status small,
.hero-status strong {
  display: block;
  white-space: nowrap;
}

.hero-status small { color: var(--color-text-muted); font-size: 9px; }
.hero-status strong { margin-top: 2px; color: var(--color-text-secondary); font-size: 11px; }

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #3fcf8e;
  box-shadow: 0 0 0 4px rgba(63, 207, 142, .1);
}

.status-dot.loading {
  background: #f2b84b;
  animation: db-status-pulse 1s infinite alternate;
}

.db-main {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(330px, 370px) minmax(0, 1fr);
  gap: 14px;
  min-height: 0;
  overflow: hidden;
}

@keyframes db-status-pulse { to { opacity: .35; } }

.db-sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.016)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  border-radius: 18px;
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(12px);
}

.db-content {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.db-mobile-backbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border-default);
  background: color-mix(in srgb, var(--color-bg-card) 92%, transparent);
}

.db-back-btn {
  min-height: var(--touch-target-min);
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

@media (max-width: 1000px) {
  .db-main {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(180px, 0.42fr) minmax(0, 1fr);
  }
  
  .db-sidebar {
    min-height: 0;
  }
}

@media (max-width: 1024px) {
  .db-page {
    padding: 10px 10px calc(12px + var(--safe-bottom));
  }

  .db-main {
    grid-template-rows: minmax(0, 1fr);
  }

  .db-hero { align-items: flex-start; }
  .db-hero p { max-width: 520px; }
}

@media (max-width: 620px) {
  .db-hero { display: block; }
  .hero-status { display: none; }
}

@media (orientation: landscape) and (max-height: 520px) {
  .db-page {
    gap: 8px;
    padding: 8px 10px calc(8px + var(--safe-bottom));
  }

  .db-main {
    gap: 8px;
    grid-template-rows: minmax(0, 1fr);
  }

  .db-sidebar,
  .db-content {
    border-radius: 12px;
  }

  .db-mobile-backbar {
    padding: 6px 8px;
  }

  .db-back-btn {
    border-radius: 9px;
    padding: 0 10px;
  }
}
</style>
