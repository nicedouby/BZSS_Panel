// -*- coding: utf-8 -*-

const DEFAULT_FAST_UNTIL_SECONDS = 90;
const DEFAULT_MEDIUM_UNTIL_SECONDS = 180;

export function resolveRconRefreshPolicy({
  logClockSeconds = 0,
  logClockHasAnchor = false,
  logClockManual = false,
  config = {},
} = {}) {
  const fallbackPlayersIntervalMs = normalizePositiveInteger(config.playersIntervalMs, 5000);
  const fallbackSquadsIntervalMs = normalizePositiveInteger(config.squadsIntervalMs, 10000);
  const dynamic = config.dynamic ?? {};

  if (!Boolean(config.enabled ?? false)) {
    return {
      mode: "disabled",
      playersIntervalMs: fallbackPlayersIntervalMs,
      squadsIntervalMs: fallbackSquadsIntervalMs,
      fastUntilSeconds: normalizePositiveInteger(dynamic.fastUntilSeconds, DEFAULT_FAST_UNTIL_SECONDS),
      mediumUntilSeconds: normalizePositiveInteger(dynamic.mediumUntilSeconds, DEFAULT_MEDIUM_UNTIL_SECONDS),
    };
  }

  const fastUntilSeconds = normalizePositiveInteger(dynamic.fastUntilSeconds, DEFAULT_FAST_UNTIL_SECONDS);
  const mediumUntilSeconds = Math.max(
    fastUntilSeconds,
    normalizePositiveInteger(dynamic.mediumUntilSeconds, DEFAULT_MEDIUM_UNTIL_SECONDS),
  );

  const fastPlayersIntervalMs = normalizePositiveInteger(dynamic.fastPlayersIntervalMs, 1000);
  const fastSquadsIntervalMs = normalizePositiveInteger(dynamic.fastSquadsIntervalMs, 1500);
  const mediumPlayersIntervalMs = normalizePositiveInteger(dynamic.mediumPlayersIntervalMs, 2500);
  const mediumSquadsIntervalMs = normalizePositiveInteger(dynamic.mediumSquadsIntervalMs, 3500);

  const seconds = Math.max(0, Math.floor(Number(logClockSeconds ?? 0) || 0));
  const isAnchored = Boolean(logClockHasAnchor) && !Boolean(logClockManual);

  if (!isAnchored) {
    return {
      mode: "fallback",
      playersIntervalMs: fallbackPlayersIntervalMs,
      squadsIntervalMs: fallbackSquadsIntervalMs,
      fastUntilSeconds,
      mediumUntilSeconds,
    };
  }

  if (seconds < fastUntilSeconds) {
    return {
      mode: "fast",
      playersIntervalMs: fastPlayersIntervalMs,
      squadsIntervalMs: fastSquadsIntervalMs,
      fastUntilSeconds,
      mediumUntilSeconds,
    };
  }

  if (seconds < mediumUntilSeconds) {
    return {
      mode: "medium",
      playersIntervalMs: mediumPlayersIntervalMs,
      squadsIntervalMs: mediumSquadsIntervalMs,
      fastUntilSeconds,
      mediumUntilSeconds,
    };
  }

  return {
    mode: "fallback",
    playersIntervalMs: fallbackPlayersIntervalMs,
    squadsIntervalMs: fallbackSquadsIntervalMs,
    fastUntilSeconds,
    mediumUntilSeconds,
  };
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return Math.max(1, Math.floor(Number(fallback) || 1));
  }
  return Math.max(1, Math.floor(number));
}
