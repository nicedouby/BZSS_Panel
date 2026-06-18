import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiGet } from "../app/apiClient";
import { queryKeys } from "../app/queryKeys";
import { usePageActivity } from "./usePageActivity";

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
  const MAX_VISIBLE_LINES = 2000;
  const lines = shallowRef<ConsoleLine[]>([]);
  const lineSeqSet = new Set<number>();
  const lastSeq = ref(0);
  const { isDocumentVisible, canPoll, canAutoRefresh } = usePageActivity();
  const currentFilterKey = computed(() => JSON.stringify({
    stream: filters.stream,
    scope: filters.scope,
    level: filters.level,
    q: filters.q,
  }));

  function reset() {
    lines.value = [];
    lineSeqSet.clear();
    lastSeq.value = 0;
  }

  function clearVisibleLines() {
    lines.value = [];
    lineSeqSet.clear();
  }

  const channelsQuery = useQuery({
    queryKey: computed(() => queryKeys.console.channels(filters.stream)),
    queryFn: async () => apiGet<{
      streams?: Array<{ id: string; title: string }>;
      scopes?: Array<{ id: string; title: string }>;
      levels?: Array<{ id: string; title: string }>;
    }>(`/api/console/channels?stream=${encodeURIComponent(filters.stream)}`),
    staleTime: 30_000,
  });

  const linesQuery = useQuery({
    queryKey: computed(() => queryKeys.console.lines(filters.stream, filters.scope, filters.level, filters.q)),
    enabled: computed(() => canPoll.value && !filters.paused),
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
      if (!canAutoRefresh.value || filters.paused) return false;
      return 1000;
    },
    refetchOnMount: true,
    placeholderData: (previousData) => previousData,
  });

  watch(currentFilterKey, () => {
    reset();
  });

  watch(
    () => linesQuery.data.value?.lines,
    (incoming) => {
      if (!Array.isArray(incoming) || !incoming.length) return;
      const merged = [...lines.value];
      for (const line of incoming) {
        const seq = Number(line.seq ?? 0);
        if (seq > lastSeq.value) lastSeq.value = seq;
        if (!lineSeqSet.has(seq)) {
          merged.push(line);
          lineSeqSet.add(seq);
        }
      }
      if (merged.length > MAX_VISIBLE_LINES) {
        const overflow = merged.length - MAX_VISIBLE_LINES;
        const removed = merged.splice(0, overflow);
        for (const item of removed) {
          const seq = Number(item.seq ?? 0);
          lineSeqSet.delete(seq);
        }
      }
      lines.value = merged;
    },
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

  onScopeDispose(() => {
    lineSeqSet.clear();
  });

  return {
    lines,
    hidden: computed(() => !isDocumentVisible.value),
    clearVisibleLines,
    reset,
    channelsQuery,
    linesQuery,
  };
}
