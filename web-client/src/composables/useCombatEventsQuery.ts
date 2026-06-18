import { computed, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiGet } from "../app/apiClient";
import { useAutoRefreshGate } from "./useAutoRefreshGate";

export interface CombatQueryFilters {
  type: string;
  q: string;
  limit: number;
  offset: number;
}

export function useCombatEventsQuery(endpoint: Ref<string>, filters: CombatQueryFilters) {
  const { canAutoRefresh } = useAutoRefreshGate();
  const queryKey = computed(() => [
    "combat-events",
    endpoint.value,
    filters.type,
    filters.q,
    filters.limit,
    filters.offset,
  ]);

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        type: filters.type,
        search: filters.q,
        limit: String(filters.limit),
        offset: String(filters.offset),
      });
      return apiGet<{
        events?: any[];
        overview?: {
          count?: number;
          stats?: Record<string, number>;
          rejected?: number;
          lastUpdatedAt?: string;
        };
      }>(`${endpoint.value}?${params.toString()}`);
    },
    placeholderData: (previousData) => previousData,
    refetchInterval: computed(() => (canAutoRefresh.value ? 3000 : false)),
    refetchIntervalInBackground: false,
  });

  return { query };
}
