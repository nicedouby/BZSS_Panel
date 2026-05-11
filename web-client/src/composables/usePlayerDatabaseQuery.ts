import { computed, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiGet } from "../app/apiClient";

export interface PlayerDatabaseFilters {
  q: string;
  sort: string;
  limit: number;
  offset: number;
}

export function usePlayerDatabaseQuery(filters: PlayerDatabaseFilters) {
  const debouncedQuery = ref(filters.q);
  let timer: number | null = null;

  watch(
    () => filters.q,
    (value) => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        debouncedQuery.value = value.trim();
      }, 300);
    },
    { immediate: true },
  );

  const queryKey = computed(() => [
    "player-database",
    debouncedQuery.value,
    filters.sort,
    filters.limit,
    filters.offset,
  ]);

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        query: debouncedQuery.value,
        sort: filters.sort,
        limit: String(filters.limit),
        offset: String(filters.offset),
      });
      return apiGet<{
        items?: any[];
        players?: any[];
        total?: number;
      }>(`/api/db/players?${params.toString()}`);
    },
    placeholderData: (previousData) => previousData,
  });

  return {
    debouncedQuery,
    query,
  };
}
