// -*- coding: utf-8 -*-

export const WEATHER_TYPES = Object.freeze([
  "Clear_Skies", "Cloudy", "Foggy", "Overcast", "Partly_Cloudy", "Rain",
  "Rain_Light", "Rain_Thunders", "Sand_Dust_Calm", "Sand_Dust_Storm",
  "Snow", "Snow_Blizzard", "Snow_Light",
]);

/**
 * Converts the original Weather/Transition/Weather model into weather-only
 * segments. A transition is a zero-width command node at the end of the
 * weather on its left, so its duration becomes transitionToNextSeconds.
 */
export function normalizeTimeline(timeline) {
  if (!Array.isArray(timeline)) return [];

  const normalized = [];
  for (let index = 0; index < timeline.length; index += 1) {
    const segment = timeline[index];
    if (segment?.type !== "weather") continue;
    const legacyTransition = timeline[index + 1]?.type === "transition"
      ? timeline[index + 1]
      : null;
    normalized.push({
      id: String(segment.id ?? "").trim(),
      type: "weather",
      weatherType: Number(segment.weatherType),
      durationSeconds: Number(segment.durationSeconds),
      transitionToNextSeconds: legacyTransition
        ? Number(legacyTransition.durationSeconds)
        : Number(segment.transitionToNextSeconds ?? 0),
    });
  }

  if (normalized.length > 0) normalized.at(-1).transitionToNextSeconds = 0;
  return normalized;
}

export function validateTimeline(timeline) {
  const errors = [];
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return { ok: false, errors: ["Timeline must contain at least one Weather segment."] };
  }

  const ids = new Set();
  timeline.forEach((segment, index) => {
    if (segment?.type !== "weather") errors.push(`Segment ${index + 1} must be weather.`);
    const id = String(segment?.id ?? "").trim();
    if (!id) errors.push(`Segment ${index + 1} requires an id.`);
    else if (ids.has(id)) errors.push(`Segment id ${id} is duplicated.`);
    else ids.add(id);

    const duration = Number(segment?.durationSeconds);
    if (!Number.isInteger(duration) || duration < 1) {
      errors.push(`Segment ${index + 1} durationSeconds must be a positive integer.`);
    }
    const transition = Number(segment?.transitionToNextSeconds ?? 0);
    if (!Number.isInteger(transition) || transition < 0) {
      errors.push(`Segment ${index + 1} transitionToNextSeconds must be a non-negative integer.`);
    }
    const weatherType = Number(segment?.weatherType);
    if (!Number.isInteger(weatherType) || weatherType < 0 || weatherType >= WEATHER_TYPES.length) {
      errors.push(`Segment ${index + 1} weatherType must be between 0 and ${WEATHER_TYPES.length - 1}.`);
    }
  });
  return { ok: errors.length === 0, errors };
}

export function compileTimeline(timeline) {
  const normalized = normalizeTimeline(timeline);
  const validation = validateTimeline(normalized);
  if (!validation.ok) {
    const error = new Error(validation.errors.join(" "));
    error.code = "InvalidWeatherTimeline";
    error.details = validation.errors;
    throw error;
  }

  let cursor = 0;
  const segments = normalized.map((segment, index) => {
    const durationSeconds = Number(segment.durationSeconds);
    const startSeconds = cursor;
    const endSeconds = cursor + durationSeconds;
    const previous = normalized[index - 1] ?? null;
    cursor = endSeconds;
    return {
      id: segment.id,
      type: "weather",
      startSeconds,
      endSeconds,
      durationSeconds,
      currentWeather: Number(segment.weatherType),
      targetWeather: Number(segment.weatherType),
      transitionNodeId: previous ? `transition:${previous.id}` : null,
      transitionTotalSeconds: previous ? Number(previous.transitionToNextSeconds ?? 0) : 0,
      transitionToNextSeconds: Number(segment.transitionToNextSeconds ?? 0),
      sourceIndex: index,
    };
  });

  return {
    segments,
    totalDurationSeconds: cursor,
    endBehavior: "hold_last",
  };
}

export function resolveTimeline(compiledOrTimeline, seconds) {
  const compiled = Array.isArray(compiledOrTimeline) ? compileTimeline(compiledOrTimeline) : compiledOrTimeline;
  if (!compiled?.segments?.length) throw new Error("Compiled timeline is empty.");
  const position = Math.max(0, Number(seconds) || 0);
  const index = compiled.segments.findIndex((segment) => position < segment.endSeconds);
  const resolvedIndex = index >= 0 ? index : compiled.segments.length - 1;
  const base = compiled.segments[resolvedIndex];
  const held = index < 0;
  // Transition is a zero-width command node. It never counts down inside
  // the target Weather segment; the command must receive the node's exact value.
  const transitionNodeSeconds = Math.max(0, Math.ceil(base.transitionTotalSeconds));
  const transitionRemainingSeconds = transitionNodeSeconds;

  return {
    type: "weather",
    segmentId: base.id,
    transitionNodeId: base.transitionNodeId,
    startSeconds: base.startSeconds,
    endSeconds: held ? null : base.endSeconds,
    currentWeather: base.currentWeather,
    targetWeather: base.targetWeather,
    transitionTotalSeconds: base.transitionTotalSeconds,
    transitionNodeSeconds,
    // Kept for API compatibility; this is the node parameter, not elapsed time.
    transitionRemainingSeconds,
    timelinePositionSeconds: position,
    held,
    segmentIndex: resolvedIndex,
    nextSegment: compiled.segments[resolvedIndex + 1] ?? null,
  };
}

export function weatherName(weatherType) {
  return WEATHER_TYPES[Number(weatherType)] ?? `Weather_${weatherType}`;
}
