import { ref, computed } from "vue";
import type { ServerMetricSample } from "./useServerMetrics";
import { apiGet } from "../app/apiClient";

export type CompareAlignMode = "real" | "server" | "round";

export function useServerMetricsComparison(serverId: () => string) {
  const compareDates = ref<string[]>([]);
  const compareData = ref<Record<string, ServerMetricSample[]>>({});
  const alignMode = ref<CompareAlignMode>("real");
  const loadingCompare = ref(false);

  function toggleCompareDate(date: string) {
    const index = compareDates.value.indexOf(date);
    if (index > -1) {
      compareDates.value.splice(index, 1);
      delete compareData.value[date];
    } else {
      if (compareDates.value.length >= 3) {
        // Limit to 3 days max
        const oldest = compareDates.value.shift();
        if (oldest) delete compareData.value[oldest];
      }
      compareDates.value.push(date);
      void fetchCompareDate(date);
    }
  }

  async function fetchCompareDate(date: string) {
    loadingCompare.value = true;
    try {
      // Use local timezone boundaries to fetch history for that entire day
      const fromMs = new Date(`${date}T00:00:00`).getTime();
      const toMs = new Date(`${date}T23:59:59`).getTime();

      const params = new URLSearchParams({
        include_current: "0",
        from_ms: String(fromMs),
        to_ms: String(toMs),
        server_id: serverId(),
      });
      const res = await apiGet<{ samples?: ServerMetricSample[] }>(
        `/api/server-stats/history?${params.toString()}`
      );

      compareData.value[date] = Array.isArray(res.samples)
        ? res.samples.sort((a, b) => a.timestamp_ms - b.timestamp_ms)
        : [];
    } catch (err) {
      console.warn(`[ServerStatsComparison] Failed to load compare date ${date}:`, err);
    } finally {
      loadingCompare.value = false;
    }
  }

  function clearComparison() {
    compareDates.value = [];
    compareData.value = {};
  }

  // Align player data series
  const alignedComparisonSeries = computed(() => {
    const seriesList: { name: string; data: [number, number][] }[] = [];

    compareDates.value.forEach((date) => {
      const samplesList = compareData.value[date] || [];
      if (!samplesList.length) return;

      const firstTimestamp = samplesList[0].timestamp_ms;
      const data: [number, number][] = [];

      samplesList.forEach((sample) => {
        const val = sample.metrics.players ?? 0;
        let xVal = sample.timestamp_ms;

        if (alignMode.value === "server") {
          // Align by offset from server start time
          xVal = sample.timestamp_ms - firstTimestamp;
        } else if (alignMode.value === "round") {
          // Align by round time, let's assume the first player uptick or first tick is round start
          // Or align simply using offset from start of data (similar to server start for individual days)
          xVal = sample.timestamp_ms - firstTimestamp;
        } else {
          // Align by real clock time: map each timestamp to the offset within the day
          const d = new Date(sample.timestamp_ms);
          const msIntoDay =
            d.getHours() * 3600000 +
            d.getMinutes() * 60000 +
            d.getSeconds() * 1000 +
            d.getMilliseconds();
          // We anchor all to a base timestamp (e.g. today's 00:00:00) so they stack on the same X-axis
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          xVal = today.getTime() + msIntoDay;
        }

        data.push([xVal, val]);
      });

      seriesList.push({
        name: date,
        data,
      });
    });

    return seriesList;
  });

  return {
    compareDates,
    alignMode,
    loadingCompare,
    alignedComparisonSeries,
    toggleCompareDate,
    clearComparison,
  };
}
