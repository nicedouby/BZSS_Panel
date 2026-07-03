import { computed, reactive, ref } from "vue";

import { apiGet } from "../app/apiClient";
import { renderApiError } from "../app/errors";
import { canAutoRefreshNow } from "./useAutoRefreshGate";
import { buildPlayerTooltipStats, type PlayerTooltipStats } from "./serverMetricsAnalytics";

export type ServerMetricTone = "critical" | "warn" | "ok" | "idle";

export type ServerMetricRangeKey = "10m" | "30m" | "1h" | "match" | "24h";

export interface ServerMetricRangeOption {
  key: ServerMetricRangeKey;
  label: string;
  spanMs?: number;
  kind: "fixed" | "match";
}

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

interface ServerMetricHistoryResponse {
  samples?: ServerMetricSample[];
  channels?: ServerMetricChannel[];
}

interface ServerMetricCurrentResponse {
  timestamp_ms?: number;
  metrics?: Record<string, number>;
}

interface RoundOverviewRecord {
  serverPlayAt?: string | number | null;
  logLineTime?: string | number | null;
  logTimeStartedAtMs?: number | null;
  receivedAt?: string | null;
  time?: string | null;
}

interface RoundOverviewResponse {
  roundState?: {
    current?: RoundOverviewRecord | null;
    history?: RoundOverviewRecord[];
    updatedAt?: string | null;
  } | null;
}

const POLL_INTERVAL_MS = 2000;
const MATCH_OVERVIEW_TTL_MS = 15_000;
const MAX_SAMPLES = 8000;
const TOOLTIP_ANALYTICS_WINDOW_MS = 15 * 24 * 60 * 60 * 1000;

export const SERVER_METRIC_RANGES = [
  { key: "10m", label: "10 分钟", spanMs: 10 * 60 * 1000, kind: "fixed" },
  { key: "30m", label: "30 分钟", spanMs: 30 * 60 * 1000, kind: "fixed" },
  { key: "1h", label: "1 小时", spanMs: 60 * 60 * 1000, kind: "fixed" },
  { key: "match", label: "当前对局", kind: "match" },
  { key: "24h", label: "24 小时", spanMs: 24 * 60 * 60 * 1000, kind: "fixed" },
] as const satisfies readonly ServerMetricRangeOption[];

export function useServerMetrics() {
  const loading = ref(false);
  const historyError = ref("");
  const availableDates = ref<string[]>([]);
  const samples = ref<ServerMetricSample[]>([]);
  const channels = ref<ServerMetricChannel[]>([]);
  const tooltipStatsByTimestamp = ref<Record<string, PlayerTooltipStats>>({});
  const selectedRange = ref<ServerMetricRangeKey>("24h");
  const selectedDates = ref<string[]>([]);
  const showDateDialog = ref(false);
  const lastUpdatedAt = ref<number | null>(null);
  const roundOverview = ref<RoundOverviewResponse | null>(null);
  const roundOverviewLoadedAt = ref(0);

  const enabledChannels = reactive<Record<string, boolean>>({});

  let pollTimer: number | null = null;
  let startPromise: Promise<void> | null = null;
  let roundOverviewPromise: Promise<RoundOverviewResponse | null> | null = null;
  let isStopped = true;

  const currentMetrics = computed<Record<string, number>>(() => {
    const latest = samples.value[samples.value.length - 1];
    return latest?.metrics ?? {};
  });

  const hasData = computed(() => samples.value.length > 0);

  const hasCustomSelection = computed(() => selectedDates.value.length > 0);

  const activeRangeLabel = computed(() => {
    if (hasCustomSelection.value) {
      return `自定义 ${selectedDates.value.length} 天`;
    }

    const range = SERVER_METRIC_RANGES.find((item) => item.key === selectedRange.value) ?? SERVER_METRIC_RANGES[SERVER_METRIC_RANGES.length - 1];
    return range.label;
  });

  const matchRangeStartMs = computed(() => {
    const record = getLatestRoundRecord();

    return parseTimestampLike(record?.serverPlayAt)
      ?? parseTimestampLike(record?.logLineTime)
      ?? parseTimestampLike(record?.time)
      ?? parseTimestampLike(record?.receivedAt)
      ?? parseTimestampLike(record?.logTimeStartedAtMs)
      ?? null;
  });

  const rangeHint = computed(() => {
    if (hasCustomSelection.value) {
      return "已选择自定义日期，实时轮询已暂停。";
    }

    if (selectedRange.value === "match" && matchRangeStartMs.value === null) {
      return "未解析到当前对局起点，已回退到 24 小时窗口。";
    }

    return "";
  });

  const lastUpdatedLabel = computed(() => {
    if (!lastUpdatedAt.value) return "--:--:--";
    return new Date(lastUpdatedAt.value).toLocaleTimeString([], { hour12: false });
  });

  const tpsTone = computed<ServerMetricTone>(() => {
    const tps = currentMetrics.value.tps;
    if (tps == null) return "idle";
    if (tps < 20) return "critical";
    if (tps < 28) return "warn";
    return "ok";
  });

  async function start() {
    if (startPromise) return startPromise;
    isStopped = false;
    clearPollTimer();

    startPromise = (async () => {
      await Promise.all([
        loadAvailableDates(),
        loadHistory(),
      ]);
      if (isStopped) return;
      pollTimer = window.setInterval(() => {
        if (canAutoRefreshNow()) void refreshCurrent();
      }, POLL_INTERVAL_MS);
    })().finally(() => {
      startPromise = null;
    });

    return startPromise;
  }

  function stop() {
    isStopped = true;
    clearPollTimer();
  }

  function clearPollTimer() {
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function openDateDialog() {
    showDateDialog.value = true;
  }

  function closeDateDialog() {
    showDateDialog.value = false;
  }

  function toggleDate(date: string) {
    const index = selectedDates.value.indexOf(date);
    if (index === -1) {
      selectedDates.value.push(date);
      return;
    }

    selectedDates.value.splice(index, 1);
  }

  function resetSelectedDates() {
    selectedDates.value = [];
  }

  function toggleChannel(key: string) {
    enabledChannels[key] = !enabledChannels[key];
  }

  async function applySelectedDates() {
    closeDateDialog();
    await loadHistory();
  }

  async function setRange(range: ServerMetricRangeKey) {
    selectedRange.value = range;
    selectedDates.value = [];
    await loadHistory();
  }

  async function refreshAll() {
    await Promise.all([
      loadAvailableDates(),
      loadHistory(),
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

  async function loadRoundOverview() {
    const now = Date.now();
    if (roundOverviewPromise) return roundOverviewPromise;
    if (roundOverview.value && now - roundOverviewLoadedAt.value < MATCH_OVERVIEW_TTL_MS) {
      return roundOverview.value;
    }

    roundOverviewPromise = (async () => {
      try {
        const payload = await apiGet<RoundOverviewResponse>("/api/round/overview");
        roundOverview.value = payload;
        roundOverviewLoadedAt.value = Date.now();
        return payload;
      } catch (error) {
        console.warn("[ServerStats] Failed to load round overview:", error);
        roundOverviewLoadedAt.value = Date.now();
        return roundOverview.value;
      } finally {
        roundOverviewPromise = null;
      }
    })();

    return roundOverviewPromise;
  }

  async function loadHistory() {
    loading.value = true;
    try {
      const { fromMs, toMs } = await resolveWindow();
      const visiblePromise = loadHistoryWindow(fromMs, toMs, true);
      const analyticsPromise = loadHistoryWindow(Math.max(0, fromMs - TOOLTIP_ANALYTICS_WINDOW_MS), toMs, false)
        .catch((error) => {
          console.warn("[ServerStats] Failed to load tooltip analytics window:", error);
          return { samples: [] as ServerMetricSample[] };
        });
      const [visiblePayload, analyticsPayload] = await Promise.all([
        visiblePromise,
        analyticsPromise,
      ]);

      samples.value = Array.isArray(visiblePayload.samples) ? visiblePayload.samples.map((sample) => ({
        ...sample,
        metrics: { ...sample.metrics },
      })) : [];

      const visibleTimestamps = new Set(samples.value.map((sample) => sample.timestamp_ms));
      tooltipStatsByTimestamp.value = buildPlayerTooltipStats(
        Array.isArray(analyticsPayload.samples) ? analyticsPayload.samples : [],
        visibleTimestamps,
      );

      const nextChannels = Array.isArray(visiblePayload.channels) ? visiblePayload.channels.map((channel) => ({ ...channel })) : [];
      if (nextChannels.length > 0) {
        channels.value = nextChannels;
      }

      syncEnabledChannels();
      historyError.value = "";
      lastUpdatedAt.value = Date.now();
    } catch (error) {
      historyError.value = renderApiError(error, "Failed to load server metrics.");
    } finally {
      loading.value = false;
    }
  }

  async function refreshCurrent() {
    if (loading.value || hasCustomSelection.value) return;

    try {
      if (selectedRange.value === "match") {
        await loadRoundOverview();
      }

      const payload = await apiGet<ServerMetricCurrentResponse>("/api/server-stats/current");
      if (!payload?.metrics) return;

      const nextSample: ServerMetricSample = {
        timestamp_ms: Number(payload.timestamp_ms ?? Date.now()),
        metrics: { ...payload.metrics },
      };

      const lastSample = samples.value[samples.value.length - 1];
      if (!lastSample || nextSample.timestamp_ms > lastSample.timestamp_ms) {
        const nextSamples = [...samples.value, nextSample];
        if (nextSamples.length > MAX_SAMPLES) {
          nextSamples.shift();
        }
        samples.value = nextSamples;
        lastUpdatedAt.value = Date.now();
      }
    } catch (error) {
      console.warn("[ServerStats] Failed to refresh current sample:", error);
    }
  }

  function getLatestRoundRecord() {
    const roundState = roundOverview.value?.roundState;
    if (!roundState) return null;
    if (roundState.current) return roundState.current;
    const history = roundState.history;
    if (Array.isArray(history) && history.length > 0) {
      return history[history.length - 1];
    }
    return null;
  }

  async function resolveWindow() {
    if (hasCustomSelection.value) {
      const sortedDates = [...selectedDates.value].sort();
      const fromMs = Date.parse(`${sortedDates[0]}T00:00:00Z`);
      const toMs = Date.parse(`${sortedDates[sortedDates.length - 1]}T23:59:59Z`);
      return { fromMs, toMs };
    }

    const range = SERVER_METRIC_RANGES.find((item) => item.key === selectedRange.value) ?? SERVER_METRIC_RANGES[SERVER_METRIC_RANGES.length - 1];
    const toMs = Date.now();

    if (range.kind === "match") {
      let startMs = matchRangeStartMs.value;
      if (startMs === null) {
        await loadRoundOverview();
        startMs = matchRangeStartMs.value;
      }

      if (startMs !== null) {
        return { fromMs: startMs, toMs };
      }
    }

    const spanMs = "spanMs" in range && typeof range.spanMs === "number"
      ? range.spanMs
      : 24 * 60 * 60 * 1000;
    return { fromMs: toMs - spanMs, toMs };
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
    tooltipStatsByTimestamp,
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
    rangeHint,
    lastUpdatedLabel,
    tpsTone,
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
    loadRoundOverview,
  };
}

async function loadHistoryWindow(fromMs: number, toMs: number, includeCurrent: boolean) {
  const params = new URLSearchParams({
    include_current: includeCurrent ? "1" : "0",
    from_ms: String(fromMs),
    to_ms: String(toMs),
  });
  return apiGet<ServerMetricHistoryResponse>(`/api/server-stats/history?${params.toString()}`);
}

function parseTimestampLike(value: unknown) {
  if (value === null || value === undefined) return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10 ** 11 ? value : value * 1000;
  }

  const text = String(value).trim();
  if (!text) return null;

  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    return numeric > 10 ** 11 ? numeric : numeric * 1000;
  }

  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}
