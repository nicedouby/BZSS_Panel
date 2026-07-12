<template>
  <div class="kpi-grid">
    <!-- Card 1: Online Players -->
    <ServerStatsKpiCard
      title="在线人数"
      :value="currentMetrics.players ?? 0"
      :suffix="` / ${maxPlayers}`"
      sub-label="较 10 分钟前"
      :sub-value="playerDiffText"
      :sub-value-class="playerDiffClass"
      peak-label="今日峰值"
      :peak-value="summary.peakPlayers"
      :progress-pct="playersProgress"
      :progress-color="STATS_THEME.player"
      tone="info"
    />

    <!-- Card 2: Queue Pressure -->
    <ServerStatsKpiCard
      title="队列压力"
      :value="queueValue"
      :suffix="currentMetrics.queue > 0 ? '人' : ''"
      sub-label="持续时长"
      :sub-value="queueDurationText"
      peak-label="最高排队"
      :peak-value="summary.peakQueue"
      :progress-pct="queueProgress"
      :progress-color="STATS_THEME.queue"
      :tone="currentMetrics.queue > 0 ? 'warn' : 'neutral'"
    />

    <!-- Card 3: Server TPS -->
    <ServerStatsKpiCard
      title="服务器 TPS"
      :value="tpsValue"
      :status-label="tpsStatusLabel"
      sub-label="5 分钟最低"
      :sub-value="tpsMin5mVal"
      :sub-value-class="tpsMin5mClass"
      peak-label="5 分钟平均"
      :peak-value="tpsAvg5mVal"
      :progress-pct="tpsProgress"
      :progress-color="tpsProgressColor"
      :tone="tpsTone"
    />

    <!-- Card 4: Server Health -->
    <ServerStatsKpiCard
      title="服务器健康度"
      :value="summary.healthScore"
      :status-label="healthStatusLabel"
      sub-label="TPS 稳定度"
      :sub-value="`${tpsStabilityPct}%`"
      peak-label="采样完整度"
      :peak-value="`${summary.sampleCoverage}%`"
      :progress-pct="summary.healthScore"
      :progress-color="healthColor"
      :tone="healthTone"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import ServerStatsKpiCard from "./ServerStatsKpiCard.vue";
import { STATS_THEME } from "./serverStatsTheme";
import type { ServerStatsSummary } from "../../composables/useServerMetricsAnalytics";
import type { ServerMetricSample } from "../../composables/useServerMetrics";

const props = defineProps<{
  currentMetrics: Record<string, number>;
  samples: ServerMetricSample[];
  summary: ServerStatsSummary;
  maxPlayers: number;
  maxQueue: number;
}>();

// 1. Online Players Calculations
const playersProgress = computed(() => {
  const max = props.maxPlayers || 100;
  return Math.min(100, ((props.currentMetrics.players ?? 0) / max) * 100);
});

const playerDiff = computed(() => {
  if (props.samples.length < 2) return 0;
  const now = Date.now();
  const tenMinAgo = now - 10 * 60 * 1000;

  let closestSample = props.samples[0];
  let minDiff = Math.abs(closestSample.timestamp_ms - tenMinAgo);

  for (const s of props.samples) {
    const diff = Math.abs(s.timestamp_ms - tenMinAgo);
    if (diff < minDiff) {
      minDiff = diff;
      closestSample = s;
    }
  }

  if (minDiff > 5 * 60 * 1000) return 0;
  return (props.currentMetrics.players ?? 0) - (closestSample.metrics.players ?? 0);
});

const playerDiffText = computed(() => {
  const diff = playerDiff.value;
  if (diff > 0) return `+${diff}`;
  if (diff < 0) return `${diff}`;
  return "无变化";
});

const playerDiffClass = computed(() => {
  const diff = playerDiff.value;
  if (diff > 0) return "text-green";
  if (diff < 0) return "text-red";
  return "";
});

// 2. Queue Pressure Calculations
const queueValue = computed(() => {
  const q = props.currentMetrics.queue ?? 0;
  return q > 0 ? q : "无队列";
});

const queueProgress = computed(() => {
  const max = props.maxQueue || 50;
  return Math.min(100, ((props.currentMetrics.queue ?? 0) / max) * 100);
});

const queueDurationText = computed(() => {
  const ms = props.summary.queueDurationMs;
  if (ms <= 0) return "0 分钟";
  const mins = Math.round(ms / 60000);
  return `${mins} 分钟`;
});

// 3. Server TPS Calculations
const currentTpsVal = computed(() => props.currentMetrics.tps ?? null);

const tpsValue = computed(() => {
  const val = currentTpsVal.value;
  return val !== null ? val.toFixed(1) : "--";
});

const last5mSamples = computed(() => {
  const now = Date.now();
  const fiveMinAgo = now - 5 * 60 * 1000;
  return props.samples.filter((s) => s.timestamp_ms >= fiveMinAgo && s.metrics.tps != null);
});

const min5mTps = computed(() => {
  if (!last5mSamples.value.length) return currentTpsVal.value;
  return Math.min(...last5mSamples.value.map((s) => s.metrics.tps));
});

const avg5mTps = computed(() => {
  if (!last5mSamples.value.length) return currentTpsVal.value;
  const sum = last5mSamples.value.reduce((acc, s) => acc + s.metrics.tps, 0);
  return sum / last5mSamples.value.length;
});

const tpsMin5mVal = computed(() => {
  const val = min5mTps.value;
  return val !== null ? val.toFixed(1) : "--";
});

const tpsAvg5mVal = computed(() => {
  const val = avg5mTps.value;
  return val !== null ? val.toFixed(1) : "--";
});

const tpsMin5mClass = computed(() => {
  const val = min5mTps.value;
  if (val === null) return "";
  if (val < 28) return "text-red";
  if (val < 35) return "text-orange";
  return "text-green";
});

const tpsTone = computed(() => {
  const val = currentTpsVal.value;
  if (val === null) return "neutral";
  if (val < 28) return "critical";
  if (val < 35) return "warn";
  return "ok";
});

const tpsStatusLabel = computed(() => {
  const val = currentTpsVal.value;
  if (val === null) return "未知";
  if (val < 28) return "异常";
  if (val < 35) return "注意";
  return "稳定";
});

const tpsProgress = computed(() => {
  const val = currentTpsVal.value ?? 0;
  return Math.min(100, (val / 50) * 100);
});

const tpsProgressColor = computed(() => {
  const val = currentTpsVal.value;
  if (val === null) return "var(--color-border-soft)";
  if (val < 28) return STATS_THEME.tpsCritical;
  if (val < 35) return STATS_THEME.tpsWarning;
  return STATS_THEME.tpsGood;
});

// 4. Server Health Calculations
const tpsStabilityPct = computed(() => {
  const tpsSamples = props.samples.filter((s) => s.metrics.tps != null);
  if (!tpsSamples.length) return 100;
  const stableCount = tpsSamples.filter((s) => s.metrics.tps >= 35).length;
  return Math.round((stableCount / tpsSamples.length) * 100);
});

const healthTone = computed(() => {
  const score = props.summary.healthScore;
  if (score >= 90) return "ok";
  if (score >= 70) return "warn";
  return "critical";
});

const healthStatusLabel = computed(() => {
  const score = props.summary.healthScore;
  if (score >= 90) return "良好";
  if (score >= 70) return "一般";
  return "亚健康";
});

const healthColor = computed(() => {
  const score = props.summary.healthScore;
  if (score >= 90) return STATS_THEME.tpsGood;
  if (score >= 70) return STATS_THEME.tpsWarning;
  return STATS_THEME.tpsCritical;
});
</script>

<style scoped>
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 16px;
  flex-shrink: 0;
}

@media (max-width: 1024px) {
  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .kpi-grid {
    grid-template-columns: 1fr;
  }
}
</style>
