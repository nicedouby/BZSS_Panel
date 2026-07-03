import type { ServerMetricSample } from "./useServerMetrics";

export interface PlayerExtremaStats {
  min: number;
  max: number;
  count: number;
}

export interface PlayerTooltipStats {
  sameMoment: PlayerExtremaStats | null;
  recent7d: PlayerExtremaStats | null;
  recent15d: PlayerExtremaStats | null;
}

interface SampleValue {
  timestamp_ms: number;
  value: number;
}

interface RollingExtremaState {
  queue: SampleValue[];
  minDeque: SampleValue[];
  maxDeque: SampleValue[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * DAY_MS;
const FIFTEEN_DAYS_MS = 15 * DAY_MS;

export function buildPlayerTooltipStats(
  samples: ServerMetricSample[],
  visibleTimestamps: Set<number>,
): Record<string, PlayerTooltipStats> {
  const orderedSamples = [...samples].sort((a, b) => a.timestamp_ms - b.timestamp_ms);
  const result = new Map<number, PlayerTooltipStats>();
  const recent7d = createRollingExtremaState();
  const recent15d = createRollingExtremaState();
  const sameMomentBuckets = new Map<number, RollingExtremaState>();

  for (const sample of orderedSamples) {
    const timestamp = Number(sample.timestamp_ms);
    const value = readPlayerCount(sample);
    if (!Number.isFinite(timestamp) || value === null) continue;

    pruneRollingExtremaState(recent7d, timestamp - SEVEN_DAYS_MS);
    pruneRollingExtremaState(recent15d, timestamp - FIFTEEN_DAYS_MS);

    const minuteBucketKey = getLocalMinuteBucketKey(timestamp);
    let sameMomentState = sameMomentBuckets.get(minuteBucketKey);
    if (!sameMomentState) {
      sameMomentState = createRollingExtremaState();
      sameMomentBuckets.set(minuteBucketKey, sameMomentState);
    }
    pruneRollingExtremaState(sameMomentState, timestamp - FIFTEEN_DAYS_MS);

    if (visibleTimestamps.has(timestamp)) {
      result.set(timestamp, {
        sameMoment: snapshotRollingExtremaState(sameMomentState),
        recent7d: snapshotRollingExtremaState(recent7d),
        recent15d: snapshotRollingExtremaState(recent15d),
      });
    }

    pushRollingExtremaState(recent7d, timestamp, value);
    pushRollingExtremaState(recent15d, timestamp, value);
    pushRollingExtremaState(sameMomentState, timestamp, value);
  }

  return Object.fromEntries(result.entries().map(([timestamp, stats]) => [String(timestamp), stats]));
}

function readPlayerCount(sample: ServerMetricSample): number | null {
  const rawValue = sample.metrics?.players ?? sample.metrics?.playerCount;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

function getLocalMinuteBucketKey(timestampMs: number) {
  const date = new Date(timestampMs);
  return date.getHours() * 60 + date.getMinutes();
}

function createRollingExtremaState(): RollingExtremaState {
  return {
    queue: [],
    minDeque: [],
    maxDeque: [],
  };
}

function pruneRollingExtremaState(state: RollingExtremaState, cutoffMs: number) {
  while (state.queue.length > 0 && state.queue[0].timestamp_ms < cutoffMs) {
    const removed = state.queue.shift()!;
    if (state.minDeque[0] === removed) state.minDeque.shift();
    if (state.maxDeque[0] === removed) state.maxDeque.shift();
  }
}

function pushRollingExtremaState(state: RollingExtremaState, timestampMs: number, value: number) {
  const entry: SampleValue = { timestamp_ms: timestampMs, value };
  state.queue.push(entry);

  while (state.minDeque.length > 0 && state.minDeque[state.minDeque.length - 1].value > value) {
    state.minDeque.pop();
  }
  state.minDeque.push(entry);

  while (state.maxDeque.length > 0 && state.maxDeque[state.maxDeque.length - 1].value < value) {
    state.maxDeque.pop();
  }
  state.maxDeque.push(entry);
}

function snapshotRollingExtremaState(state: RollingExtremaState): PlayerExtremaStats | null {
  if (state.queue.length === 0) return null;
  const min = state.minDeque[0]?.value;
  const max = state.maxDeque[0]?.value;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return {
    min,
    max,
    count: state.queue.length,
  };
}
