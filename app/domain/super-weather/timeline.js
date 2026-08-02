// -*- coding: utf-8 -*-

export const WEATHER_TYPES = Object.freeze([
  "Clear_Skies", "Cloudy", "Foggy", "Overcast", "Partly_Cloudy", "Rain",
  "Rain_Light", "Rain_Thunders", "Sand_Dust_Calm", "Sand_Dust_Storm",
  "Snow", "Snow_Blizzard", "Snow_Light",
]);

export function validateTimeline(timeline) {
  const errors = [];
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return { ok: false, errors: ["Timeline must contain at least one Weather segment."] };
  }
  if (timeline[0]?.type !== "weather") errors.push("The first segment must be Weather.");
  if (timeline.at(-1)?.type !== "weather") errors.push("The last segment must be Weather.");

  const ids = new Set();
  timeline.forEach((segment, index) => {
    const expectedType = index % 2 === 0 ? "weather" : "transition";
    if (segment?.type !== expectedType) errors.push(`Segment ${index + 1} must be ${expectedType}.`);
    const id = String(segment?.id ?? "").trim();
    if (!id) errors.push(`Segment ${index + 1} requires an id.`);
    else if (ids.has(id)) errors.push(`Segment id ${id} is duplicated.`);
    else ids.add(id);
    const duration = Number(segment?.durationSeconds);
    if (!Number.isInteger(duration) || duration < 1) errors.push(`Segment ${index + 1} durationSeconds must be a positive integer.`);
    if (segment?.type === "weather") {
      const weatherType = Number(segment?.weatherType);
      if (!Number.isInteger(weatherType) || weatherType < 0 || weatherType >= WEATHER_TYPES.length) {
        errors.push(`Segment ${index + 1} weatherType must be between 0 and ${WEATHER_TYPES.length - 1}.`);
      }
    }
  });
  return { ok: errors.length === 0, errors };
}

export function compileTimeline(timeline) {
  const validation = validateTimeline(timeline);
  if (!validation.ok) {
    const error = new Error(validation.errors.join(" "));
    error.code = "InvalidWeatherTimeline";
    error.details = validation.errors;
    throw error;
  }

  let cursor = 0;
  const segments = timeline.map((segment, index) => {
    const durationSeconds = Number(segment.durationSeconds);
    const startSeconds = cursor;
    const endSeconds = cursor + durationSeconds;
    cursor = endSeconds;
    if (segment.type === "weather") {
      return {
        id: segment.id,
        type: "weather",
        startSeconds,
        endSeconds,
        durationSeconds,
        currentWeather: Number(segment.weatherType),
        targetWeather: Number(segment.weatherType),
        transitionTotalSeconds: 0,
        sourceIndex: index,
      };
    }
    const left = timeline[index - 1];
    const right = timeline[index + 1];
    return {
      id: segment.id,
      type: "transition",
      startSeconds,
      endSeconds,
      durationSeconds,
      currentWeather: Number(left.weatherType),
      targetWeather: Number(right.weatherType),
      transitionTotalSeconds: durationSeconds,
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
  const segment = held ? {
    ...base,
    startSeconds: base.startSeconds,
    endSeconds: null,
  } : base;
  const transitionRemainingSeconds = segment.type === "transition"
    ? Math.max(0, Math.ceil(Number(segment.endSeconds) - position))
    : 0;

  return {
    type: segment.type,
    segmentId: segment.id,
    startSeconds: segment.startSeconds,
    endSeconds: segment.endSeconds,
    currentWeather: segment.currentWeather,
    targetWeather: segment.targetWeather,
    transitionTotalSeconds: segment.transitionTotalSeconds,
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
