import { computed } from "vue";
import type { ServerMetricSample } from "./useServerMetrics";

export interface ServerStatsSummary {
  currentPlayers: number;
  peakPlayers: number;
  averagePlayers: number;

  currentQueue: number;
  peakQueue: number;
  queueDurationMs: number;

  currentTps: number | null;
  averageTps: number | null;
  minimumTps: number | null;
  lowTpsDurationMs: number;

  reached50At: number | null;
  reached80At: number | null;
  fullAt: number | null;
  fullDurationMs: number;

  sampleCoverage: number;
  stale: boolean;
  healthScore: number;
}

export function useServerMetricsAnalytics(
  samples: () => ServerMetricSample[],
  lastUpdatedAt: () => number | null
) {
  const summary = computed<ServerStatsSummary>(() => {
    const list = samples();
    const lastUpdate = lastUpdatedAt();

    const result: ServerStatsSummary = {
      currentPlayers: 0,
      peakPlayers: 0,
      averagePlayers: 0,
      currentQueue: 0,
      peakQueue: 0,
      queueDurationMs: 0,
      currentTps: null,
      averageTps: null,
      minimumTps: null,
      lowTpsDurationMs: 0,
      reached50At: null,
      reached80At: null,
      fullAt: null,
      fullDurationMs: 0,
      sampleCoverage: 0,
      stale: false,
      healthScore: 100,
    };

    if (!list.length) {
      return result;
    }

    const sorted = [...list].sort((a, b) => a.timestamp_ms - b.timestamp_ms);
    const latest = sorted[sorted.length - 1];

    result.currentPlayers = latest.metrics.players ?? 0;
    result.currentQueue = latest.metrics.queue ?? 0;
    result.currentTps = latest.metrics.tps ?? null;

    // Players stats
    let totalPlayers = 0;
    let tpsCount = 0;
    let totalTps = 0;
    let minTps = null as number | null;
    let peakP = 0;
    let peakQ = 0;

    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i];
      const p = s.metrics.players ?? 0;
      const q = s.metrics.queue ?? 0;
      const t = s.metrics.tps;

      totalPlayers += p;
      if (p > peakP) peakP = p;
      if (q > peakQ) peakQ = q;

      if (t != null) {
        tpsCount++;
        totalTps += t;
        if (minTps === null || t < minTps) {
          minTps = t;
        }
      }

      // Check milestones
      if (result.reached50At === null && p >= 50) {
        result.reached50At = s.timestamp_ms;
      }
      if (result.reached80At === null && p >= 80) {
        result.reached80At = s.timestamp_ms;
      }
      if (result.fullAt === null && p >= 100) {
        result.fullAt = s.timestamp_ms;
      }
    }

    result.peakPlayers = peakP;
    result.averagePlayers = Math.round(totalPlayers / sorted.length);
    result.peakQueue = peakQ;
    result.averageTps = tpsCount > 0 ? Number((totalTps / tpsCount).toFixed(2)) : null;
    result.minimumTps = minTps;

    // Durations calculation by accumulation
    let lowTpsTime = 0;
    let queueTime = 0;
    let fullTime = 0;

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const diff = curr.timestamp_ms - prev.timestamp_ms;

      // Avoid huge gaps skewing durations
      if (diff > 5 * 60 * 1000) continue;

      if (curr.metrics.tps != null && curr.metrics.tps < 28) {
        lowTpsTime += diff;
      }
      if (curr.metrics.queue > 0) {
        queueTime += diff;
      }
      if (curr.metrics.players >= 100) {
        fullTime += diff;
      }
    }

    result.lowTpsDurationMs = lowTpsTime;
    result.queueDurationMs = queueTime;
    result.fullDurationMs = fullTime;

    // Freshness & Stale
    const now = Date.now();
    const ageMs = lastUpdate ? now - lastUpdate : 999999;
    result.stale = ageMs > 15000; // stale if more than 15s old

    // Health Score calculation (0 - 100)
    // 1. TPS stability: fraction of samples where TPS is good (>= 35) or warning (28 - 35)
    let tpsScore = 100;
    if (tpsCount > 0) {
      let goodCount = 0;
      let warnCount = 0;
      for (const s of sorted) {
        const t = s.metrics.tps;
        if (t != null) {
          if (t >= 35) goodCount++;
          else if (t >= 28) warnCount++;
        }
      }
      tpsScore = (goodCount * 100 + warnCount * 50) / tpsCount;
    }

    // 2. Freshness Score
    const freshnessScore = Math.max(0, Math.min(100, 100 - (ageMs / 60000) * 100));

    // 3. Completeness (100 if we have samples)
    const completenessScore = sorted.length > 0 ? 100 : 0;

    // Weighted health score: 60% TPS, 30% Freshness, 10% Completeness
    result.healthScore = Math.round(
      0.6 * tpsScore + 0.3 * freshnessScore + 0.1 * completenessScore
    );

    // Coverage percentage (arbitrary mock for layout contract/fullness of time slot)
    result.sampleCoverage = Math.min(100, Math.round((sorted.length / 500) * 100));

    return result;
  });

  return {
    summary,
  };
}
export type { ServerMetricSample };
export { buildPlayerTooltipStats } from "./serverMetricsAnalytics";
