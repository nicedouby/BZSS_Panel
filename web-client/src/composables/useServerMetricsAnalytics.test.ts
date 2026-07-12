import { describe, expect, it } from "vitest";
import { useServerMetricsAnalytics } from "./useServerMetricsAnalytics";

function makeSample(timestampMs: number, players: number, queue: number, tps: number) {
  return {
    timestamp_ms: timestampMs,
    metrics: { players, queue, tps },
  };
}

describe("useServerMetricsAnalytics", () => {
  it("correctly compiles server stats summaries", () => {
    // 5 samples spaced by 5 seconds (5000ms)
    // 0s: 40 players, 0 queue, 38 tps
    // 5s: 52 players, 0 queue, 36 tps  (reached 50 here)
    // 10s: 80 players, 5 queue, 32 tps  (reached 80 here, queue starts)
    // 15s: 100 players, 10 queue, 25 tps (full server here, low TPS here)
    // 20s: 100 players, 0 queue, 39 tps  (low TPS stops)
    const baseTime = 1720760000000;
    const samplesList = [
      makeSample(baseTime, 40, 0, 38),
      makeSample(baseTime + 5000, 52, 0, 36),
      makeSample(baseTime + 10000, 80, 5, 32),
      makeSample(baseTime + 15000, 100, 10, 25),
      makeSample(baseTime + 20000, 100, 0, 39),
    ];

    const lastUpdatedAt = baseTime + 20000;
    const { summary } = useServerMetricsAnalytics(
      () => samplesList,
      () => lastUpdatedAt
    );

    const s = summary.value;

    expect(s.currentPlayers).toBe(100);
    expect(s.peakPlayers).toBe(100);
    expect(s.averagePlayers).toBe(74); // (40+52+80+100+100)/5 = 74.4 => 74
    
    expect(s.currentQueue).toBe(0);
    expect(s.peakQueue).toBe(10);
    
    expect(s.currentTps).toBe(39);
    expect(s.minimumTps).toBe(25);
    expect(s.averageTps).toBe(34); // (38+36+32+25+39)/5 = 34

    // Milestones
    expect(s.reached50At).toBe(baseTime + 5000);
    expect(s.reached80At).toBe(baseTime + 10000);
    expect(s.fullAt).toBe(baseTime + 15000);

    // Durations
    // queue > 0 at 10s and 15s -> accumulates 10000ms
    expect(s.queueDurationMs).toBe(10000);
    // players >= 100 at 15s and 20s -> accumulates 10000ms
    expect(s.fullDurationMs).toBe(10000);
    // tps < 28 at 15s -> accumulates 5000ms
    expect(s.lowTpsDurationMs).toBe(5000);

    // Health Score
    expect(s.healthScore).toBeGreaterThan(0);
    expect(s.healthScore).toBeLessThanOrEqual(100);
  });
});
