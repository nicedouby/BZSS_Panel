import { describe, expect, it } from "vitest";
import {
  buildSameTimeSeries,
  buildSameTimeSummary,
  resolveClockTimestamp,
  selectSameTimeDates,
} from "./useServerMetricsSameTime";

describe("server metrics same-time intelligence", () => {
  it("selects the newest historical dates and excludes today", () => {
    expect(selectSameTimeDates(
      ["2026-07-26", "2026-07-25", "2026-07-24", "2026-07-23"],
      "2026-07-26",
      2,
      false,
    )).toEqual(["2026-07-25", "2026-07-24"]);
  });

  it("uses the closest sample to the selected clock time", () => {
    const date = "2026-07-26";
    const target = resolveClockTimestamp(date, "20:00");
    const result = buildSameTimeSeries(date, date, target, [
      { timestamp_ms: target - 10 * 60_000, metrics: { players: 40, queue: 0, tps: 40 } },
      { timestamp_ms: target + 2 * 60_000, metrics: { players: 64, queue: 3, tps: 38 } },
    ]);

    expect(result.representative?.players).toBe(64);
    expect(result.representative?.offsetMinutes).toBe(2);
  });

  it("compares today against the historical same-time average", () => {
    const targetTime = "20:00";
    const today = "2026-07-26";
    const createSeries = (date: string, players: number) => {
      const target = resolveClockTimestamp(date, targetTime);
      return buildSameTimeSeries(date, today, target, [
        { timestamp_ms: target, metrics: { players, queue: 0, tps: 40 } },
      ]);
    };
    const summary = buildSameTimeSummary(targetTime, [
      createSeries(today, 80),
      createSeries("2026-07-25", 60),
      createSeries("2026-07-24", 70),
      createSeries("2026-07-23", 50),
    ]);

    expect(summary.currentPlayers).toBe(80);
    expect(summary.historicalAverage).toBe(60);
    expect(summary.delta).toBe(20);
    expect(summary.deltaPercent).toBe(33);
    expect(summary.tone).toBe("positive");
    expect(summary.sampleDays).toBe(3);
  });
});
