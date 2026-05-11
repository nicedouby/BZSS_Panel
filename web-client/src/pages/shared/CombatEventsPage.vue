<template>
  <section class="page">
    <PageHeader :title="pageTitle" :subtitle="pageSubtitle" />

    <PageCard compact>
      <div class="toolbar">
        <select v-model="filters.type">
          <option v-for="item in typeOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
        <input v-model="filters.q" placeholder="Search events">
        <button type="button" :disabled="filters.offset === 0" @click="previousPage">Previous</button>
        <button type="button" :disabled="!hasNextPage" @click="nextPage">Next</button>
        <button type="button" @click="clearEvents">Clear Memory Events</button>
      </div>
    </PageCard>

    <DataState
      :loading="query.isLoading.value && !events.length"
      :error="pageError"
      :empty="!pageError && !events.length && !query.isLoading.value"
      empty-title="No events"
      :empty-text="emptyText"
    >
      <PageCard compact>
        <div class="summary">
          <span>Total {{ total }}</span>
          <span>Offset {{ filters.offset }}</span>
          <span v-if="overview?.rejected != null">Rejected {{ overview.rejected }}</span>
          <span v-if="overview?.lastUpdatedAt">Updated {{ formatTime(overview.lastUpdatedAt) }}</span>
        </div>
      </PageCard>

      <CombatEventTable
        :events="events"
        @select="selectedEvent = $event"
        @search-player="searchPlayer"
      />
    </DataState>

    <CombatEventDetailModal :event="selectedEvent" @close="selectedEvent = null" />
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
import CombatEventTable from "../../components/combat/CombatEventTable.vue";
import CombatEventDetailModal from "../../components/combat/CombatEventDetailModal.vue";
import { useCombatEventsQuery } from "../../composables/useCombatEventsQuery";

const props = defineProps<{
  pageTitle: string;
  pageSubtitle: string;
  endpoint: string;
  clearEndpoint: string;
  routeScope: string;
  typeOptions: Array<{ value: string; label: string }>;
  emptyText: string;
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
const { query } = useCombatEventsQuery(endpointRef, filters);
const pageError = computed(() => query.error.value ? renderApiError(query.error.value, "Failed to load combat events.") : "");
const events = computed(() => query.data.value?.events ?? []);
const overview = computed(() => query.data.value?.overview ?? null);
const total = computed(() => Number(overview.value?.count ?? events.value.length));
const hasNextPage = computed(() => filters.offset + filters.limit < total.value);
const selectedEvent = ref<any | null>(null);

const clearMutation = useMutation({
  mutationFn: async () => apiPost(props.clearEndpoint, {}),
  onSuccess: async () => {
    ui.pushToast({
      title: "Combat events cleared",
      message: "The in-memory event buffer has been cleared.",
      tone: "ok",
    });
    selectedEvent.value = null;
    await query.refetch();
  },
  onError: (error) => {
    ui.pushToast({
      title: "Clear failed",
      message: renderApiError(error, "Failed to clear combat events."),
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
    title: "Clear event buffer",
    message: "This clears only the in-memory combat event buffer for this page.",
    confirmText: "Clear",
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
.toolbar,
.summary {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.toolbar input,
.toolbar select {
  min-width: 0;
  border: 1px solid #38414c;
  background: #11171d;
  color: #edf2f4;
  border-radius: 6px;
  padding: 8px 10px;
}

.toolbar input {
  flex: 1 1 240px;
}

.summary {
  color: #a5b0b8;
  font-size: 12px;
}
</style>
