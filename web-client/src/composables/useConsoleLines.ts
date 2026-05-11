import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiGet } from "../app/apiClient";

export interface ConsoleFilterState {
  stream: string;
  scope: string;
  level: string;
  q: string;
  paused: boolean;
}

export interface ConsoleLine {
  seq: number;
  time?: string;
  stream?: string;
  scope?: string;
  level?: string;
  message?: string;
  channel?: string;
  eventName?: string;
  operation?: string;
  dataSummary?: string;
  tags?: string[];
  [key: string]: unknown;
}

export function useConsoleLines(filters: ConsoleFilterState) {
  const lines = ref<ConsoleLine[]>([]);
  const hidden = ref(typeof document !== "undefined" ? document.hidden : false);
  const active = ref(true);
  const lastSeq = ref(0);
  const currentFilterKey = computed(() => JSON.stringify({
    stream: filters.stream,
    scope: filters.scope,
    level: filters.level,
    q: filters.q,
  }));

  function handleVisibilityChange() {
    hidden.value = document.hidden;
  }

  function reset() {
    lines.value = [];
    lastSeq.value = 0;
  }

  function clearVisibleLines() {
    lines.value = [];
  }

  const channelsQuery = useQuery({
    queryKey: computed(() => ["console-channels", filters.stream]),
    queryFn: async () => apiGet<{
      streams?: Array<{ id: string; title: string }>;
      scopes?: Array<{ id: string; title: string }>;
      levels?: Array<{ id: string; title: string }>;
    }>(`/api/console/channels?stream=${encodeURIComponent(filters.stream)}`),
    staleTime: 30_000,
  });

  const linesQuery = useQuery({
    queryKey: computed(() => ["console-lines", filters.stream, filters.scope, filters.level, filters.q, filters.paused]),
    queryFn: async () => {
      const params = new URLSearchParams({
        stream: filters.stream,
        scope: filters.scope,
        level: filters.level,
        q: filters.q,
        afterSeq: String(lastSeq.value),
        limit: "300",
      });

      return apiGet<{ lines?: ConsoleLine[] }>(`/api/console/lines?${params.toString()}`);
    },
    refetchInterval: () => {
      if (!active.value || filters.paused || hidden.value) return false;
      return 1000;
    },
    refetchOnMount: true,
    placeholderData: (previousData) => previousData,
  });

  watch(currentFilterKey, () => {
    reset();
    void linesQuery.refetch();
  });

  watch(
    () => linesQuery.data.value?.lines,
    (incoming) => {
      if (!Array.isArray(incoming) || !incoming.length) return;
      const merged = [...lines.value];
      for (const line of incoming) {
        const seq = Number(line.seq ?? 0);
        if (seq > lastSeq.value) lastSeq.value = seq;
        if (!merged.some((item) => Number(item.seq ?? 0) === seq)) {
          merged.push(line);
        }
      }
      lines.value = merged.slice(-2000);
    },
    { deep: true },
  );

  watch(
    () => channelsQuery.data.value,
    (meta) => {
      const scopes = meta?.scopes ?? [];
      const levels = meta?.levels ?? [];
      if (scopes.length && !scopes.some((item) => item.id === filters.scope)) {
        filters.scope = "all";
      }
      if (levels.length && !levels.some((item) => item.id === filters.level)) {
        filters.level = "all";
      }
    },
    { immediate: true },
  );

  onMounted(() => {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  });

  onBeforeUnmount(() => {
    active.value = false;
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  });

  return {
    lines,
    hidden,
    clearVisibleLines,
    reset,
    channelsQuery,
    linesQuery,
  };
}
