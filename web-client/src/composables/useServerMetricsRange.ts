import { computed, ref } from "vue";

export type ServerMetricRangeKey = "10m" | "30m" | "1h" | "match" | "24h" | "7d";

export interface ServerMetricRangeOption {
  key: ServerMetricRangeKey;
  label: string;
  spanMs?: number;
  kind: "fixed" | "match";
}

export const SERVER_METRIC_RANGES: readonly ServerMetricRangeOption[] = [
  { key: "10m", label: "10 分钟", spanMs: 10 * 60 * 1000, kind: "fixed" },
  { key: "30m", label: "30 分钟", spanMs: 30 * 60 * 1000, kind: "fixed" },
  { key: "1h", label: "1 小时", spanMs: 60 * 60 * 1000, kind: "fixed" },
  { key: "match", label: "本局", kind: "match" },
  { key: "24h", label: "24 小时", spanMs: 24 * 60 * 60 * 1000, kind: "fixed" },
  { key: "7d", label: "7 天", spanMs: 7 * 24 * 60 * 60 * 1000, kind: "fixed" },
];

export function useServerMetricsRange(onRangeOrDatesChange: () => Promise<void>) {
  const selectedRange = ref<ServerMetricRangeKey>("24h");
  const selectedDates = ref<string[]>([]);
  const showDateDialog = ref(false);

  const hasCustomSelection = computed(() => selectedDates.value.length > 0);

  const activeRangeLabel = computed(() => {
    if (hasCustomSelection.value) {
      return `自定义 ${selectedDates.value.length} 天`;
    }
    const range = SERVER_METRIC_RANGES.find((item) => item.key === selectedRange.value);
    return range ? range.label : "24 小时";
  });

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
    } else {
      selectedDates.value.splice(index, 1);
    }
  }

  function resetSelectedDates() {
    selectedDates.value = [];
  }

  async function applySelectedDates() {
    closeDateDialog();
    await onRangeOrDatesChange();
  }

  async function setRange(range: ServerMetricRangeKey) {
    selectedRange.value = range;
    selectedDates.value = [];
    await onRangeOrDatesChange();
  }

  function resolveWindow(matchRangeStartMs: number | null) {
    if (hasCustomSelection.value) {
      const sortedDates = [...selectedDates.value].sort();
      // Fix UTC boundary issue by using local date parsing bounds
      const fromMs = new Date(`${sortedDates[0]}T00:00:00`).getTime();
      const toMs = new Date(`${sortedDates[sortedDates.length - 1]}T23:59:59`).getTime();
      return { fromMs, toMs };
    }

    const range = SERVER_METRIC_RANGES.find((item) => item.key === selectedRange.value) ?? SERVER_METRIC_RANGES[4];
    const toMs = Date.now();

    if (range.kind === "match" && matchRangeStartMs !== null) {
      return { fromMs: matchRangeStartMs, toMs };
    }

    const spanMs = range.spanMs ?? 24 * 60 * 60 * 1000;
    return { fromMs: toMs - spanMs, toMs };
  }

  return {
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
    resolveWindow,
  };
}
