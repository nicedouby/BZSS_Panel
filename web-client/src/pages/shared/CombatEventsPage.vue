<template>
  <section class="bz-page combat-page">
    <PageHeader :title="pageTitle" :subtitle="pageSubtitle" />

    <DataState
      :loading="query.isLoading.value"
      :error="pageError"
    >
      <div class="combat-shell">
        <div class="combat-main">
          <div class="combat-top">
            <CombatRateChart :refresh-key="query.dataUpdatedAt.value" :endpoint="rateEndpoint" />

            <PageCard compact class="combat-toolbar-card">
              <div class="combat-controls">
                <div class="toolbar">
                  <select v-model="filters.type">
                    <option v-for="item in typeOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
                  </select>
                  <input v-model="filters.q" :placeholder="text.searchEvents">
                  <button type="button" class="bz-btn bz-btn-ghost" :disabled="filters.offset === 0" @click="previousPage">{{ text.previous }}</button>
                  <button type="button" class="bz-btn bz-btn-ghost" :disabled="!hasNextPage" @click="nextPage">{{ text.next }}</button>
                  <button type="button" class="bz-btn bz-btn-danger" @click="clearEvents">{{ text.clearMemoryEvents }}</button>
                </div>
                <div class="summary">
                  <span>{{ t(text.total, "", { count: total }) }}</span>
                  <span>{{ t(text.offset, "", { offset: filters.offset }) }}</span>
                  <span v-if="overview?.rejected != null">{{ t(text.rejected, "", { count: overview.rejected }) }}</span>
                  <span v-if="overview?.lastUpdatedAt">{{ t("common.updated") }} {{ formatTime(overview.lastUpdatedAt) }}</span>
                </div>
              </div>
            </PageCard>
          </div>

          <CombatEventTable
            class="combat-table-card"
            :events="events"
            :highlight-key="hoverKey"
            @select="selectedEvent = $event"
            @search-player="searchPlayer"
            @hover-player="hoverKey = $event"
          />
        </div>

        <CombatEventDetailModal
          class="combat-detail-pane"
          inline
          :event="selectedEvent"
          :highlight-key="hoverKey"
          @close="selectedEvent = null"
        />
      </div>
    </DataState>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useMutation } from "@tanstack/vue-query";
import { apiPost } from "../../app/apiClient";
import { renderApiError } from "../../app/errors";
import { useUiStore } from "../../stores/ui.store";
import { goToPlayerDatabaseSearch } from "../../utils/player-database";
import PageHeader from "../../components/common/PageHeader.vue";
import PageCard from "../../components/common/PageCard.vue";
import DataState from "../../components/common/DataState.vue";
import CombatRateChart from "../../components/combat/CombatRateChart.vue";
import CombatEventTable from "../../components/combat/CombatEventTable.vue";
import CombatEventDetailModal from "../../components/combat/CombatEventDetailModal.vue";
import { useCombatEventsQuery } from "../../composables/useCombatEventsQuery";
import { t } from "../../i18n";

const props = defineProps<{
  pageTitle: string;
  pageSubtitle: string;
  endpoint: string;
  clearEndpoint: string;
  rateEndpoint?: string;
  routeScope: string;
  typeOptions: Array<{ value: string; label: string }>;
  emptyText: string;
  uiText?: Partial<{
    searchEvents: string;
    previous: string;
    next: string;
    clearMemoryEvents: string;
    noEvents: string;
    total: string;
    offset: string;
    rejected: string;
    loadFailed: string;
    clearEventBuffer: string;
    clearEventBufferMessage: string;
    clearCompleted: string;
    clearCompletedMessage: string;
    clearFailed: string;
  }>;
}>();

const route = useRoute();
const router = useRouter();
const ui = useUiStore();

const filters = reactive({
  type: String(route.query.type ?? "all"),
  q: String(route.query.q ?? ""),
  limit: 100,
  offset: Math.max(Number(route.query.offset ?? 0) || 0, 0),
});

watch(
  () => [filters.type, filters.q, filters.offset],
  () => {
    void router.replace({
      query: {
        ...route.query,
        panel: props.routeScope,
        type: filters.type !== "all" ? filters.type : undefined,
        q: filters.q || undefined,
        offset: filters.offset > 0 ? String(filters.offset) : undefined,
      },
    });
  },
);

watch(
  () => [filters.type, filters.q],
  () => {
    filters.offset = 0;
  },
);

const endpointRef = computed(() => props.endpoint);
const rateEndpoint = computed(() => props.rateEndpoint ?? "/api/combat-clean/rates");
const { query } = useCombatEventsQuery(endpointRef, filters);
const pageError = computed(() => (query.error.value ? renderApiError(query.error.value, text.value.loadFailed) : ""));
const events = computed(() => query.data.value?.events ?? []);
const overview = computed(() => query.data.value?.overview ?? null);
const total = computed(() => Number(overview.value?.count ?? events.value.length));
const hasNextPage = computed(() => filters.offset + filters.limit < total.value);
const selectedEvent = ref<any | null>(null);
const hoverKey = ref("");
const text = computed(() => ({
  searchEvents: props.uiText?.searchEvents ?? t("combat.searchEvents"),
  previous: props.uiText?.previous ?? t("combat.previous"),
  next: props.uiText?.next ?? t("combat.next"),
  clearMemoryEvents: props.uiText?.clearMemoryEvents ?? t("combat.clearMemoryEvents"),
  noEvents: props.uiText?.noEvents ?? t("combat.noEvents"),
  total: props.uiText?.total ?? t("combat.total"),
  offset: props.uiText?.offset ?? t("combat.offset"),
  rejected: props.uiText?.rejected ?? t("combat.rejected"),
  loadFailed: props.uiText?.loadFailed ?? t("combat.loadFailed"),
  clearEventBuffer: props.uiText?.clearEventBuffer ?? t("combat.clearEventBuffer"),
  clearEventBufferMessage: props.uiText?.clearEventBufferMessage ?? t("combat.clearEventBufferMessage"),
  clearCompleted: props.uiText?.clearCompleted ?? t("combat.clearCompleted"),
  clearCompletedMessage: props.uiText?.clearCompletedMessage ?? t("combat.clearCompletedMessage"),
  clearFailed: props.uiText?.clearFailed ?? t("combat.clearFailed"),
}));

const clearMutation = useMutation({
  mutationFn: async () => apiPost(props.clearEndpoint, {}),
  onSuccess: async () => {
    ui.pushToast({
      title: text.value.clearCompleted,
      message: text.value.clearCompletedMessage,
      tone: "ok",
    });
    selectedEvent.value = null;
    await query.refetch();
  },
  onError: (error) => {
    ui.pushToast({
      title: text.value.clearFailed,
      message: renderApiError(error, text.value.clearFailed),
      tone: "error",
    });
  },
});

function searchPlayer(value: string) {
  goToPlayerDatabaseSearch(router, value);
}

function previousPage() {
  filters.offset = Math.max(0, filters.offset - filters.limit);
}

function nextPage() {
  if (!hasNextPage.value) return;
  filters.offset += filters.limit;
}

async function clearEvents() {
  const confirmed = await ui.openConfirm({
    title: text.value.clearEventBuffer,
    message: text.value.clearEventBufferMessage,
    confirmText: t("common.clear"),
    tone: "warn",
  });
  if (!confirmed) return;
  clearMutation.mutate();
}

function formatTime(value: unknown) {
  const text = String(value ?? "");
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString();
}
</script>

<style scoped>
.bz-page {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.combat-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 420px;
  gap: 12px;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.combat-main {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.combat-top {
  display: grid;
  grid-template-columns: minmax(280px, 0.92fr) minmax(0, 1.4fr);
  gap: 12px;
  align-items: stretch;
}

.combat-table-card {
  min-height: 0;
}

.combat-toolbar-card,
.combat-summary-card {
  min-height: 0;
}

.combat-detail-pane {
  min-height: 0;
  overflow: hidden;
}

.toolbar,
.summary {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.combat-controls {
  display: grid;
  gap: 8px;
  height: 100%;
  align-content: center;
}

.toolbar input,
.toolbar select {
  min-width: 0;
  border: 1px solid #38414c;
  background: #11171d;
  color: #edf2f4;
  border-radius: 6px;
  padding: 7px 10px;
  min-height: 34px;
}

.toolbar input {
  flex: 1 1 240px;
}

.summary {
  color: #a5b0b8;
  font-size: 12px;
}

.combat-top :deep(.combat-rate-chart-shell) {
  height: 100%;
}

.combat-top :deep(.combat-rate-chart-container),
.combat-top :deep(.combat-rate-chart-empty) {
  height: 100%;
  min-height: 112px;
}

.bz-page :deep(.card-body.compact) {
  padding: 8px 10px;
}

.bz-page :deep(.card-header) {
  padding: 8px 10px 0;
}

@media (max-width: 1400px) {
  .combat-shell {
    grid-template-columns: minmax(0, 1fr) 360px;
  }
}

@media (max-width: 1200px) {
  .combat-shell {
    grid-template-columns: 1fr;
  }

  .combat-top {
    grid-template-columns: 1fr;
  }

  .combat-detail-pane {
    max-height: 420px;
  }
}
</style>
