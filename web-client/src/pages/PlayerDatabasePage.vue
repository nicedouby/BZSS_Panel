<template>
  <section class="page">
    <PageHeader title="Player Database" subtitle="Paged database queries with on-demand player detail loading." />

    <PageCard compact>
      <div class="toolbar">
        <input v-model="filters.q" placeholder="Search player name / Steam / EOS / IP">
        <select v-model="filters.sort">
          <option value="updated_desc">Recently Updated</option>
          <option value="name_asc">Name A-Z</option>
          <option value="last_login_desc">Last Login</option>
        </select>
        <button type="button" :disabled="filters.offset === 0" @click="previousPage">Previous</button>
        <button type="button" :disabled="!hasNextPage" @click="nextPage">Next</button>
      </div>
    </PageCard>

    <DataState
      :loading="query.isLoading.value && !rows.length"
      :error="pageError"
      :empty="!pageError && !rows.length && !query.isLoading.value"
      empty-title="No players found"
      empty-text="Try a different search keyword."
    >
      <PageCard compact>
        <div class="summary-row">
          <span>{{ total }} total players</span>
          <span>Offset {{ filters.offset }}</span>
          <span v-if="query.isFetching.value">Refreshing...</span>
        </div>
      </PageCard>

      <PlayerTable :rows="rows" :selected-id="selectedId" @select="openDetail" />
    </DataState>

    <PlayerDetailDrawer
      :open="selectedId !== null"
      :detail="detailQuery.data.value"
      :loading="detailQuery.isLoading.value"
      :error="detailError"
      :saving="permissionMutation.isPending.value"
      @close="selectedId = null"
      @save-permission="savePermission"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { apiGet, request } from "../app/apiClient";
import { renderApiError } from "../app/errors";
import { useUiStore } from "../stores/ui.store";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import DataState from "../components/common/DataState.vue";
import PlayerTable from "../components/player-database/PlayerTable.vue";
import PlayerDetailDrawer from "../components/player-database/PlayerDetailDrawer.vue";
import { usePlayerDatabaseQuery } from "../composables/usePlayerDatabaseQuery";

const ui = useUiStore();
const queryClient = useQueryClient();

const filters = reactive({
  q: "",
  sort: "updated_desc",
  limit: 100,
  offset: 0,
});

watch(
  () => [filters.q, filters.sort],
  () => {
    filters.offset = 0;
  },
);

const selectedId = ref<number | null>(null);
const { query } = usePlayerDatabaseQuery(filters);
const pageError = computed(() => query.error.value ? renderApiError(query.error.value, "Failed to load the player database.") : "");
const rows = computed(() => query.data.value?.items ?? query.data.value?.players ?? []);
const total = computed(() => Number(query.data.value?.total ?? rows.value.length));
const hasNextPage = computed(() => filters.offset + filters.limit < total.value);

const detailQuery = useQuery({
  queryKey: computed(() => ["player-detail", selectedId.value]),
  enabled: computed(() => selectedId.value !== null),
  queryFn: async () => apiGet<any>(`/api/player-database/detail?id=${encodeURIComponent(String(selectedId.value))}`),
});

const detailError = computed(() => detailQuery.error.value ? renderApiError(detailQuery.error.value, "Failed to load player detail.") : "");

const permissionMutation = useMutation({
  mutationFn: async (permissionGroup: string) => request(`/api/db/players/${encodeURIComponent(String(selectedId.value))}/permission-group`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permissionGroup }),
  }),
  onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey: ["player-database"] });
    await detailQuery.refetch();
    ui.pushToast({
      title: "Permission group updated",
      message: "The player profile has been refreshed with the latest value.",
      tone: "ok",
    });
  },
  onError: (error) => {
    ui.pushToast({
      title: "Update failed",
      message: renderApiError(error, "Failed to update the permission group."),
      tone: "error",
    });
  },
});

function previousPage() {
  filters.offset = Math.max(0, filters.offset - filters.limit);
}

function nextPage() {
  if (!hasNextPage.value) return;
  filters.offset += filters.limit;
}

function openDetail(id: number) {
  selectedId.value = id;
}

function savePermission(permissionGroup: string) {
  if (!permissionGroup.trim()) return;
  permissionMutation.mutate(permissionGroup.trim());
}
</script>

<style scoped>
.toolbar,
.summary-row {
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
  flex: 1 1 280px;
}

.summary-row {
  color: #a5b0b8;
  font-size: 12px;
}
</style>
