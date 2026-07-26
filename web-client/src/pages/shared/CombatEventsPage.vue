<template>
  <section class="bz-page combat-page">
    <WorkspaceToolbar class="combat-page-header" :wrap="false">
      <div class="combat-heading">
        <div class="combat-heading__icon" aria-hidden="true">⚔</div>
        <div>
          <h1>{{ pageTitle }}</h1>
          <p>{{ pageSubtitle }}</p>
        </div>
      </div>

      <template #actions>
        <div class="header-status">
          <span class="status-dot" aria-hidden="true"></span>
          <span>{{ t(text.total, "", { count: total }) }}</span>
        </div>
        <button type="button" class="bz-btn bz-btn-danger clear-button" @click="clearEvents">
          {{ text.clearMemoryEvents }}
        </button>
      </template>
    </WorkspaceToolbar>

    <DataState
      class="combat-state"
      :loading="query.isLoading.value"
      :error="pageError"
      mode="fill"
    >
      <div
        class="combat-shell"
        :class="{
          'combat-shell--with-detail': Boolean(selectedEvent),
          'combat-shell--empty': events.length === 0,
        }"
      >
        <div class="combat-main">
          <div class="combat-top">
            <CombatRateChart :refresh-key="query.dataUpdatedAt.value" :endpoint="rateEndpoint" />

            <PageCard compact overflow="clip" class="combat-toolbar-card">
              <div class="combat-controls">
                <div class="filter-row">
                  <label class="filter-field filter-field--type">
                    <span>{{ t("combat.eventType") }}</span>
                    <select v-model="filters.type">
                      <option v-for="item in typeOptions" :key="item.value" :value="item.value">
                        {{ item.label }}
                      </option>
                    </select>
                  </label>

                  <label class="filter-field filter-field--search">
                    <span>{{ text.searchEvents }}</span>
                    <div class="search-control">
                      <span aria-hidden="true">⌕</span>
                      <input v-model.trim="filters.q" :placeholder="text.searchEvents">
                      <button
                        v-if="filters.q"
                        type="button"
                        class="search-clear"
                        :aria-label="t('common.clear')"
                        @click="filters.q = ''"
                      >
                        ×
                      </button>
                    </div>
                  </label>
                </div>

                <div class="summary-row">
                  <div class="summary">
                    <span class="summary-chip">{{ t(text.total, "", { count: total }) }}</span>
                    <span v-if="overview?.rejected != null" class="summary-chip summary-chip--warn">
                      {{ t(text.rejected, "", { count: overview.rejected }) }}
                    </span>
                    <span v-if="overview?.lastUpdatedAt" class="updated-at">
                      {{ t("common.updated") }} {{ formatTime(overview.lastUpdatedAt) }}
                    </span>
                  </div>

                  <div class="pagination" aria-label="分页">
                    <button
                      type="button"
                      class="bz-btn bz-btn-ghost"
                      :disabled="filters.offset === 0"
                      @click="previousPage"
                    >
                      {{ text.previous }}
                    </button>
                    <span class="page-indicator">第 {{ currentPage }} / {{ pageCount }} 页</span>
                    <button
                      type="button"
                      class="bz-btn bz-btn-ghost"
                      :disabled="!hasNextPage"
                      @click="nextPage"
                    >
                      {{ text.next }}
                    </button>
                  </div>
                </div>
              </div>
            </PageCard>
          </div>

          <CombatEventTable
            class="combat-table-card"
            :events="events"
            :empty-text="emptyText"
            :highlight-key="hoverKey"
            @select="selectedEvent = $event"
            @search-player="searchPlayer"
            @hover-player="hoverKey = $event"
          />
        </div>

        <CombatEventDetailModal
          v-if="selectedEvent"
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
import WorkspaceToolbar from "../../components/common/WorkspaceToolbar.vue";
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
const currentPage = computed(() => Math.floor(filters.offset / filters.limit) + 1);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / filters.limit)));
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
  const valueText = String(value ?? "");
  const date = new Date(valueText);
  return Number.isNaN(date.getTime()) ? valueText : date.toLocaleString();
}
</script>

<style scoped>
.bz-page {
  box-sizing: border-box;
  display: grid;
  gap: 12px;
  min-height: 0;
  overflow: hidden;
}

.combat-page {
  width: 100%;
  max-width: none;
  height: 100%;
  padding: clamp(10px, 1vw, 16px);
  grid-template-rows: auto minmax(0, 1fr);
}

.combat-page-header {
  min-width: 0;
}

.combat-heading {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.combat-heading > div:last-child {
  min-width: 0;
}

.combat-heading__icon {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--color-brand-primary) 32%, var(--color-border-default));
  border-radius: 9px;
  background: color-mix(in srgb, var(--color-brand-primary) 10%, transparent);
  color: var(--color-brand-primary);
  font-size: 17px;
}

.combat-heading h1 {
  margin: 0;
  overflow: hidden;
  color: var(--color-text-primary);
  font-size: 15px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.combat-heading p {
  max-width: 720px;
  margin: 2px 0 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: 11px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  color: var(--color-text-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--color-status-success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-status-success) 14%, transparent);
}

.clear-button {
  flex: 0 0 auto;
}

.combat-state,
.combat-shell,
.combat-main,
.combat-table-card,
.combat-detail-pane {
  min-width: 0;
  min-height: 0;
}

.combat-state {
  height: 100%;
  overflow: hidden;
}

.combat-shell {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  height: 100%;
  overflow: hidden;
}

.combat-shell--with-detail {
  grid-template-columns: minmax(0, 1fr) clamp(320px, 25vw, 390px);
}

.combat-main {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  height: 100%;
  overflow: hidden;
}

.combat-top {
  display: grid;
  grid-template-columns: minmax(280px, 0.72fr) minmax(460px, 1.55fr);
  gap: 10px;
  align-items: stretch;
  min-width: 0;
  min-height: 0;
  max-height: 124px;
  overflow: hidden;
}

.combat-table-card,
.combat-detail-pane {
  height: 100%;
  overflow: hidden;
}

.combat-toolbar-card {
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.combat-controls {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 8px;
  height: 100%;
  min-height: 0;
}

.filter-row {
  display: grid;
  grid-template-columns: minmax(130px, 0.34fr) minmax(220px, 1fr);
  gap: 8px;
  min-width: 0;
}

.filter-field {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.filter-field > span {
  color: var(--color-text-muted);
  font-size: 10px;
  line-height: 1;
}

.filter-field input,
.filter-field select {
  width: 100%;
  min-width: 0;
  min-height: 34px;
  border: 1px solid #38414c;
  border-radius: 6px;
  padding: 7px 10px;
  background: #11171d;
  color: #edf2f4;
}

.search-control {
  position: relative;
  min-width: 0;
}

.search-control > span {
  position: absolute;
  top: 50%;
  left: 10px;
  z-index: 1;
  transform: translateY(-50%);
  color: var(--color-text-muted);
  pointer-events: none;
}

.search-control input {
  padding-inline: 30px;
}

.search-clear {
  position: absolute;
  top: 50%;
  right: 4px;
  min-width: 28px;
  min-height: 28px;
  border: 0;
  border-radius: 6px;
  transform: translateY(-50%);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.search-clear:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-primary);
}

.summary-row {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.summary {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  color: #a5b0b8;
  font-size: 11px;
}

.summary-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 7px;
  border: 1px solid var(--color-border-soft);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.025);
  white-space: nowrap;
}

.summary-chip--warn {
  border-color: color-mix(in srgb, var(--color-status-warning) 36%, var(--color-border-soft));
  color: var(--color-status-warning);
}

.updated-at {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pagination {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.page-indicator {
  min-width: 72px;
  color: var(--color-text-muted);
  font-size: 10px;
  text-align: center;
  white-space: nowrap;
}

.combat-top :deep(.combat-rate-chart-shell) {
  height: 100%;
  min-height: 0;
}

.combat-top :deep(.combat-rate-chart-container),
.combat-top :deep(.combat-rate-chart-empty) {
  min-height: 0;
  height: 100%;
  max-height: 124px;
}

.combat-top :deep(.combat-rate-chart-empty) {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}

.bz-page :deep(.card-body.compact) {
  padding: 8px 10px;
}

.bz-page :deep(.card-header) {
  padding: 8px 10px 0;
}

@media (max-width: 1400px) {
  .combat-shell--with-detail {
    grid-template-columns: minmax(0, 1fr) 320px;
  }

  .combat-top {
    grid-template-columns: minmax(250px, 0.62fr) minmax(420px, 1.38fr);
  }
}

@media (max-width: 1200px) {
  .combat-shell,
  .combat-shell--with-detail {
    grid-template-columns: minmax(0, 1fr);
  }

  .combat-detail-pane {
    position: absolute;
    inset-block: 0;
    right: 0;
    z-index: 6;
    width: min(420px, 92%);
    max-height: none;
    filter: drop-shadow(-18px 0 28px rgba(0, 0, 0, 0.28));
  }
}

@media (max-width: 860px) {
  .combat-main {
    grid-template-rows: minmax(132px, 42%) minmax(0, 1fr);
  }

  .combat-top {
    grid-template-columns: 1fr;
    max-height: none;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
  }

  .combat-top :deep(.combat-rate-chart-shell) {
    min-height: 116px;
  }

  .combat-toolbar-card {
    min-height: 116px;
  }
}

@media (max-width: 640px) {
  .combat-page {
    gap: 8px;
    padding: 8px;
  }

  .combat-page-header {
    padding-inline: 8px;
  }

  .combat-heading__icon,
  .header-status {
    display: none;
  }

  .combat-heading p {
    max-width: 45vw;
  }

  .clear-button {
    min-width: 38px;
    max-width: 96px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .filter-row {
    grid-template-columns: 1fr;
  }

  .summary-row {
    align-items: flex-end;
  }

  .updated-at,
  .page-indicator {
    display: none;
  }

  .pagination {
    gap: 4px;
  }

  .combat-detail-pane {
    left: 0;
    width: 100%;
  }
}
</style>
