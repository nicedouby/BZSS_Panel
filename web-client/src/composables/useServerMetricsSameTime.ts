import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { apiGet } from "../app/apiClient";
import type { ServerMetricSample } from "./useServerMetrics";

export type SameTimeWindowMinutes = 15 | 30 | 60;
export type SameTimeLookbackDays = 3 | 7 | 14;

export interface SameTimePoint {
  timestampMs: number;
  offsetMinutes: number;
  players: number;
  queue: number;
  tps: number | null;
}

export interface SameTimeSeries {
  date: string;
  label: string;
  isToday: boolean;
  points: SameTimePoint[];
  representative: SameTimePoint | null;
}

export interface SameTimeSummary {
  targetTime: string;
  currentPlayers: number | null;
  historicalAverage: number | null;
  historicalMedian: number | null;
  typicalLow: number | null;
  typicalHigh: number | null;
  delta: number | null;
  deltaPercent: number | null;
  sampleDays: number;
  confidence: "none" | "low" | "medium" | "high";
  tone: "neutral" | "positive" | "negative";
  headline: string;
  message: string;
}

interface HistoryResponse {
  samples?: ServerMetricSample[];
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function toLocalDateKey(timestampMs = Date.now()) {
  const date = new Date(timestampMs);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function toLocalClockTime(timestampMs = Date.now()) {
  const date = new Date(timestampMs);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function resolveClockTimestamp(dateKey: string, clockTime: string) {
  const [hours, minutes] = clockTime.split(":").map(Number);
  const timestamp = new Date(`${dateKey}T00:00:00`).getTime();
  if (!Number.isFinite(timestamp) || !Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return NaN;
  }
  const date = new Date(timestamp);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

function weekdayLabel(dateKey: string) {
  const timestamp = new Date(`${dateKey}T12:00:00`).getTime();
  if (!Number.isFinite(timestamp)) return dateKey;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(timestamp);
}

export function selectSameTimeDates(
  availableDates: string[],
  today: string,
  lookbackDays: number,
  sameWeekdayOnly: boolean,
) {
  const targetWeekday = new Date(`${today}T12:00:00`).getDay();
  return [...new Set(availableDates)]
    .filter((date) => date < today)
    .filter((date) => !sameWeekdayOnly || new Date(`${date}T12:00:00`).getDay() === targetWeekday)
    .sort((left, right) => right.localeCompare(left))
    .slice(0, lookbackDays);
}

export function buildSameTimeSeries(
  date: string,
  today: string,
  targetTimestampMs: number,
  samples: ServerMetricSample[],
): SameTimeSeries {
  const points = samples
    .filter((sample) => Number.isFinite(Number(sample.timestamp_ms)))
    .map((sample) => ({
      timestampMs: Number(sample.timestamp_ms),
      offsetMinutes: Number(((Number(sample.timestamp_ms) - targetTimestampMs) / 60_000).toFixed(2)),
      players: Number(sample.metrics?.players ?? 0),
      queue: Number(sample.metrics?.queue ?? 0),
      tps: Number.isFinite(Number(sample.metrics?.tps)) ? Number(sample.metrics.tps) : null,
    }))
    .sort((left, right) => left.timestampMs - right.timestampMs);

  const representative = points.reduce<SameTimePoint | null>((closest, point) => {
    if (!closest) return point;
    return Math.abs(point.offsetMinutes) < Math.abs(closest.offsetMinutes) ? point : closest;
  }, null);

  return {
    date,
    label: date === today ? "今天" : weekdayLabel(date),
    isToday: date === today,
    points,
    representative,
  };
}

function percentile(sorted: number[], ratio: number) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function buildSameTimeSummary(
  targetTime: string,
  series: SameTimeSeries[],
): SameTimeSummary {
  const today = series.find((item) => item.isToday);
  const historicalValues = series
    .filter((item) => !item.isToday && item.representative)
    .map((item) => Number(item.representative?.players ?? 0))
    .sort((left, right) => left - right);

  const currentPlayers = today?.representative?.players ?? null;
  const historicalAverage = historicalValues.length
    ? Math.round(historicalValues.reduce((sum, value) => sum + value, 0) / historicalValues.length)
    : null;
  const historicalMedianValue = percentile(historicalValues, 0.5);
  const typicalLowValue = percentile(historicalValues, 0.25);
  const typicalHighValue = percentile(historicalValues, 0.75);
  const historicalMedian = historicalMedianValue === null ? null : Math.round(historicalMedianValue);
  const typicalLow = typicalLowValue === null ? null : Math.round(typicalLowValue);
  const typicalHigh = typicalHighValue === null ? null : Math.round(typicalHighValue);
  const delta = currentPlayers !== null && historicalAverage !== null
    ? currentPlayers - historicalAverage
    : null;
  const deltaPercent = delta !== null && historicalAverage && historicalAverage > 0
    ? Math.round((delta / historicalAverage) * 100)
    : null;
  const sampleDays = historicalValues.length;
  const confidence = sampleDays >= 7 ? "high" : sampleDays >= 3 ? "medium" : sampleDays > 0 ? "low" : "none";
  const meaningfulDelta = historicalAverage === null
    ? 5
    : Math.max(5, Math.round(historicalAverage * 0.1));
  const tone = delta === null || Math.abs(delta) < meaningfulDelta
    ? "neutral"
    : delta > 0 ? "positive" : "negative";

  let headline = "等待历史同期数据";
  let message = "需要至少一个历史日期，才能判断当前时段的人数表现。";

  if (currentPlayers === null) {
    headline = `${targetTime} 暂无当前日期样本`;
    message = "可以调整对比时刻或扩大时间窗口，以匹配最近的一条有效人数记录。";
  } else if (historicalAverage !== null) {
    const deltaText = delta === 0
      ? "与历史平均相同"
      : `比历史平均${delta! > 0 ? "多" : "少"} ${Math.abs(delta!)} 人`;
    const percentText = deltaPercent === null ? "" : `（${deltaPercent > 0 ? "+" : ""}${deltaPercent}%）`;
    headline = `${targetTime} 当前 ${currentPlayers} 人，${deltaText}`;
    const verdict = tone === "positive"
      ? "当前时段表现明显强于历史同期。"
      : tone === "negative"
        ? "当前时段低于历史同期，建议留意暖服速度和玩家流失。"
        : "当前人数处于历史同期的正常波动范围。";
    message = `过去 ${sampleDays} 个有记录日期在这一时刻平均 ${historicalAverage} 人，通常为 ${typicalLow}–${typicalHigh} 人${percentText}。${verdict}`;
  }

  return {
    targetTime,
    currentPlayers,
    historicalAverage,
    historicalMedian,
    typicalLow,
    typicalHigh,
    delta,
    deltaPercent,
    sampleDays,
    confidence,
    tone,
    headline,
    message,
  };
}

export function useServerMetricsSameTime(
  availableDates: Ref<string[]>,
  customDates: Ref<string[]>,
  serverId: () => string,
) {
  const targetTime = ref(toLocalClockTime());
  const windowMinutes = ref<SameTimeWindowMinutes>(30);
  const lookbackDays = ref<SameTimeLookbackDays>(7);
  const sameWeekdayOnly = ref(false);
  const loading = ref(false);
  const error = ref("");
  const series = ref<SameTimeSeries[]>([]);
  let requestVersion = 0;
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;

  const summary = computed(() => buildSameTimeSummary(targetTime.value, series.value));
  const usingCustomDates = computed(() => customDates.value.length > 0);
  const selectedHistoricalDates = computed(() => {
    const today = toLocalDateKey();
    if (usingCustomDates.value) {
      return [...new Set(customDates.value)]
        .filter((date) => date < today)
        .sort((left, right) => right.localeCompare(left))
        .slice(0, 14);
    }
    return selectSameTimeDates(
      availableDates.value,
      today,
      lookbackDays.value,
      sameWeekdayOnly.value,
    );
  });

  async function loadSameTime() {
    const version = ++requestVersion;
    const today = toLocalDateKey();
    const dates = [today, ...selectedHistoricalDates.value];
    loading.value = true;
    error.value = "";

    const results = await Promise.allSettled(dates.map(async (date) => {
      const targetTimestampMs = resolveClockTimestamp(date, targetTime.value);
      const radiusMs = windowMinutes.value * 60_000;
      const params = new URLSearchParams({
        server_id: serverId(),
        from_ms: String(targetTimestampMs - radiusMs),
        to_ms: String(targetTimestampMs + radiusMs),
        max_points: "360",
        include_current: date === today ? "1" : "0",
      });
      const payload = await apiGet<HistoryResponse>(`/api/server-stats/history?${params.toString()}`);
      return buildSameTimeSeries(date, today, targetTimestampMs, payload.samples ?? []);
    }));

    if (version !== requestVersion) return;

    const fulfilled = results
      .filter((result): result is PromiseFulfilledResult<SameTimeSeries> => result.status === "fulfilled")
      .map((result) => result.value)
      .filter((item) => item.points.length > 0);
    series.value = fulfilled.sort((left, right) => {
      if (left.isToday) return -1;
      if (right.isToday) return 1;
      return right.date.localeCompare(left.date);
    });

    const rejectedCount = results.length - fulfilled.length;
    if (!fulfilled.length) {
      error.value = "所选时刻附近没有可用人数记录。";
    } else if (rejectedCount > 0) {
      error.value = `有 ${rejectedCount} 个日期暂时无法读取，已展示其余可用数据。`;
    }
    loading.value = false;
  }

  function scheduleLoad() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      void loadSameTime();
    }, 180);
  }

  function setTargetToNow() {
    targetTime.value = toLocalClockTime();
  }

  watch(
    [availableDates, customDates, targetTime, windowMinutes, lookbackDays, sameWeekdayOnly],
    scheduleLoad,
    { immediate: true },
  );

  onBeforeUnmount(() => {
    requestVersion += 1;
    if (reloadTimer) clearTimeout(reloadTimer);
  });

  return {
    targetTime,
    windowMinutes,
    lookbackDays,
    sameWeekdayOnly,
    loadingSameTime: loading,
    sameTimeError: error,
    sameTimeSeries: series,
    sameTimeSummary: summary,
    selectedHistoricalDates,
    usingCustomDates,
    loadSameTime,
    setTargetToNow,
  };
}
