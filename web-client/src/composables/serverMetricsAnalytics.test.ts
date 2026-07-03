import { describe, expect, it } from "vitest";

import { buildPlayerTooltipStats } from "./serverMetricsAnalytics";
import type { ServerMetricSample } from "./useServerMetrics";

function sample(timestamp: string, players: number): ServerMetricSample {
  return {
    timestamp_ms: new Date(timestamp).getTime(),
    metrics: { players },
  };
}

describe("buildPlayerTooltipStats", () => {
  it("computes same-moment and rolling extrema for visible timestamps", () => {
    const samples = [
      sample("2026-01-10T10:00:00+08:00", 10),
      sample("2026-01-12T10:00:00+08:00", 30),
      sample("2026-01-15T09:00:00+08:00", 40),
      sample("2026-01-16T10:00:00+08:00", 25),
    ];

    const visibleTs = samples[3].timestamp_ms;
    const statsByTimestamp = buildPlayerTooltipStats(samples, new Set([visibleTs]));
    const stats = statsByTimestamp[String(visibleTs)];

    expect(stats).toBeTruthy();
    expect(stats?.sameMoment).toEqual({ min: 10, max: 30, count: 2 });
    expect(stats?.recent7d).toEqual({ min: 10, max: 40, count: 3 });
    expect(stats?.recent15d).toEqual({ min: 10, max: 40, count: 3 });
  });
});
