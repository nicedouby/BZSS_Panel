import { computed, reactive, ref } from "vue";
import { apiGet } from "../app/apiClient";
import { renderApiError } from "../app/errors";
import { useServerMetricsPolling } from "./useServerMetricsPolling";
import { useServerMetricsRange, type ServerMetricRangeKey } from "./useServerMetricsRange";
import { useServerMetricsAnalytics } from "./useServerMetricsAnalytics";
import { useServerMetricsComparison } from "./useServerMetricsComparison";

export type ServerMetricTone = "critical" | "warn" | "ok" | "idle";

export interface ServerMetricChannel {
  key: string;
  label: string;
  unit: string;
  color: string;
  axis: string;
  enabledByDefault: boolean;
}

export interface ServerMetricSample {
  timestamp_ms: number;
  metrics: Record<string, number>;
  virtual?: boolean;
}

export interface ServerDetails {
  id: string;
  name: string;
  maxPlayers: number;
  maxQueue: number;
}

export interface MatchDetails {
  map: string;
  layer: string;
  mode: string;
  startedAt: number | null;
  roundId: string | null;
  phase: string;
}

interface ServerMetricHistoryResponse {
  samples?: ServerMetricSample[];
  channels?: ServerMetricChannel[];
}

interface ServerMetricCurrentResponse {
  timestamp_ms: number;
  server: ServerDetails;
  match: MatchDetails;
  metrics: Record<string, number>;
}

export function useServerMetrics() {
  const loading = ref(false);
  const historyError = ref("");
  const availableDates = ref<string[]>([]);
  const samples = ref<ServerMetricSample[]>([]);
  const channels = ref<ServerMetricChannel[]>([]);
  const lastUpdatedAt = ref<number | null>(null);
  let historyAbortController: AbortController | null = null;

  // Metadata refs from backend
  const currentServer = ref<ServerDetails | null>(null);
  const currentMatch = ref<MatchDetails | null>(null);

  const enabledChannels = reactive<Record<string, boolean>>({
    players: true,
    queue: true,
    tps: true,
  });

  const hasData = computed(() => samples.value.length > 0);

  const currentMetrics = computed<Record<string, number>>(() => {
    if (samples.value.length > 0) {
      return samples.value[samples.value.length - 1].metrics;
    }
    return { players: 0, queue: 0, tps: 0 };
  });

  // Range helper
  const rangeManager = useServerMetricsRange(async () => {
    await loadHistory();
  });

  const {
    selectedRange,
    selectedDates,
    showDateDialog,
    hasCustomSelection,
    activeRangeLabel,
    openDateDialog,
    closeDateDialog,
    toggleDate,
    resetSelectedDates,
    applySelectedDates,
    setRange,
  } = rangeManager;

  // Polling helper (5-second polling)
  const pollingManager = useServerMetricsPolling(
    async () => {
      await refreshCurrent();
    },
    {
      intervalMs: 5000,
      hasCustomSelection: () => hasCustomSelection.value,
    }
  );

  const {
    start: startPolling,
    stop: stopPolling,
    isPolling,
    isPending,
  } = pollingManager;

  function start() {
    startPolling();
  }

  function stop() {
    historyAbortController?.abort();
    historyAbortController = null;
    stopPolling();
  }

  // Analytics helper
  const analyticsManager = useServerMetricsAnalytics(
    () => samples.value,
    () => lastUpdatedAt.value
  );
  const { summary } = analyticsManager;

  // Comparison helper
  const comparisonManager = useServerMetricsComparison(() => currentServer.value?.id ?? "BZSS_Main");

  const lastUpdatedLabel = computed(() => {
    if (!lastUpdatedAt.value) return "--:--:--";
    return new Date(lastUpdatedAt.value).toLocaleTimeString([], { hour12: false });
  });

  const tpsTone = computed<ServerMetricTone>(() => {
    const tps = currentMetrics.value.tps;
    if (tps == null) return "idle";
    if (tps < 28) return "critical"; // matching standard normal/warning/critical rules
    if (tps < 35) return "warn";
    return "ok";
  });

  function toggleChannel(key: string) {
    enabledChannels[key] = !enabledChannels[key];
  }

  async function refreshAll() {
    await Promise.all([
      loadAvailableDates(),
      loadHistory(),
      refreshCurrent(),
    ]);
  }

  async function loadAvailableDates() {
    try {
      const payload = await apiGet<{ dates?: string[] }>("/api/server-stats/dates");
      availableDates.value = Array.isArray(payload.dates) ? [...payload.dates] : [];
    } catch (error) {
      console.warn("[ServerStats] Failed to load available dates:", error);
    }
  }

  async function loadHistory() {
    historyAbortController?.abort();
    const controller = new AbortController();
    historyAbortController = controller;
    loading.value = true;
    try {
      // 1. Fetch current info to get match start time if selecting "match" range
      if (selectedRange.value === "match" && (!currentMatch.value || !currentMatch.value.startedAt)) {
        await refreshCurrent();
      }

      const matchStartMs = currentMatch.value ? currentMatch.value.startedAt : null;
      const { fromMs, toMs } = rangeManager.resolveWindow(matchStartMs);

      const params = new URLSearchParams({
        include_current: "1",
        from_ms: String(fromMs),
        to_ms: String(toMs),
        max_points: "1500",
      });

      const payload = await apiGet<ServerMetricHistoryResponse>(
        `/api/server-stats/history?${params.toString()}`,
        { signal: controller.signal },
      );

      // Downsample/Limit data points to max 1500 to keep UI responsive
      let loadedSamples = Array.isArray(payload.samples) ? payload.samples : [];
      if (loadedSamples.length > 1500) {
        // Simple downsampling
        const ratio = Math.ceil(loadedSamples.length / 1500);
        loadedSamples = loadedSamples.filter((_, idx) => idx % ratio === 0);
      }

      samples.value = loadedSamples.map((sample) => ({
        ...sample,
        metrics: { ...sample.metrics },
      }));

      const nextChannels = Array.isArray(payload.channels) ? payload.channels : [];
      if (nextChannels.length > 0) {
        channels.value = nextChannels;
      }

      syncEnabledChannels();
      historyError.value = "";
      lastUpdatedAt.value = Date.now();
    } catch (error: any) {
      if (error?.name !== "AbortError" && !controller.signal.aborted) {
        historyError.value = renderApiError(error, "Failed to load server metrics.");
      }
    } finally {
      if (historyAbortController === controller) {
        historyAbortController = null;
        loading.value = false;
      }
    }
  }

  async function refreshCurrent() {
    if (hasCustomSelection.value) return;

    try {
      const payload = await apiGet<ServerMetricCurrentResponse>("/api/server-stats/current");
      if (!payload) return;

      if (payload.server) currentServer.value = payload.server;
      if (payload.match) currentMatch.value = payload.match;

      if (payload.metrics) {
        const nextSample: ServerMetricSample = {
          timestamp_ms: Number(payload.timestamp_ms ?? Date.now()),
          metrics: { ...payload.metrics },
        };

        const lastSample = samples.value[samples.value.length - 1];
        if (!lastSample || nextSample.timestamp_ms > lastSample.timestamp_ms) {
          const nextSamples = [...samples.value, nextSample];
          // Limit to max 1500
          if (nextSamples.length > 1500) {
            nextSamples.shift();
          }
          samples.value = nextSamples;
          lastUpdatedAt.value = Date.now();
        }
      }
    } catch (error) {
      console.warn("[ServerStats] Failed to refresh current sample:", error);
    }
  }

  function syncEnabledChannels() {
    for (const channel of channels.value) {
      if (enabledChannels[channel.key] === undefined) {
        enabledChannels[channel.key] = channel.enabledByDefault;
      }
    }
  }

  return {
    loading,
    historyError,
    availableDates,
    samples,
    channels,
    selectedRange,
    selectedDates,
    showDateDialog,
    lastUpdatedAt,
    enabledChannels,
    currentMetrics,
    hasData,
    hasCustomSelection,
    activeRangeLabel,
    lastUpdatedLabel,
    tpsTone,
    currentServer,
    currentMatch,
    summary,
    isPolling,
    isPending,

    // Compare fields
    compareDates: comparisonManager.compareDates,
    alignMode: comparisonManager.alignMode,
    loadingCompare: comparisonManager.loadingCompare,
    alignedComparisonSeries: comparisonManager.alignedComparisonSeries,
    toggleCompareDate: comparisonManager.toggleCompareDate,
    clearComparison: comparisonManager.clearComparison,

    start,
    stop,
    openDateDialog,
    closeDateDialog,
    toggleDate,
    resetSelectedDates,
    toggleChannel,
    applySelectedDates,
    setRange,
    refreshAll,
    refreshCurrent,
    loadHistory,
    loadAvailableDates,
  };
}
