// -*- coding: utf-8 -*-

const MIN_SPEED_MPS = 0.3;
const MAX_SPEED_MPS = 10;
const MAX_SAMPLE_GAP_MS = 5000;
const TELEPORT_MARGIN_METERS = 2;
const SPEED_EMA_ALPHA = 0.3;

export function createStepCalculator() {
  const previous = new Map();

  function reset(steamID) {
    if (steamID) previous.delete(String(steamID));
  }

  function resetAll() {
    previous.clear();
  }

  function observe(player) {
    const steamID = normalizeSteamID(player?.identity?.steamID);
    if (!steamID) return result(false, "missingSteamID");

    const position = normalizePosition(player?.telemetry?.position);
    if (!position) {
      previous.delete(steamID);
      return result(false, "missingPosition");
    }

    const observedAt = firstTelemetryTimestamp(player);
    const observedAtMs = Date.parse(observedAt);
    if (!observedAt || !Number.isFinite(observedAtMs)) {
      return result(false, "missingTelemetryTimestamp", { position });
    }

    const sourceTick = normalizeSampleKey(player?.telemetry?.sourceTick);
    const sourceSeq = normalizeSampleKey(player?.telemetry?.sourceSeq);
    const current = {
      position,
      observedAt,
      observedAtMs,
      sourceTick,
      sourceSeq,
      smoothedSpeedMps: 0,
    };
    const previousSample = previous.get(steamID);

    if (previousSample && isDuplicateSample(previousSample, current)) {
      return result(false, "duplicateTelemetry", sampleDetails(current, previousSample, {
        smoothedSpeedMps: previousSample.smoothedSpeedMps ?? 0,
      }));
    }

    const presence = player?.presence ?? {};
    const inactive = presence.online === false
      || String(presence.state ?? "").toLowerCase() === "nopawn";
    if (inactive) {
      previous.delete(steamID);
      return result(false, "inactive", sampleDetails(current, previousSample));
    }

    if (!previousSample) {
      previous.set(steamID, current);
      return result(false, "warmingUp", sampleDetails(current, null));
    }

    const deltaMs = observedAtMs - previousSample.observedAtMs;
    if (deltaMs <= 0) {
      return result(false, "invalidInterval", sampleDetails(current, previousSample, { sampleIntervalMs: deltaMs }));
    }

    if (deltaMs > MAX_SAMPLE_GAP_MS) {
      previous.set(steamID, current);
      return result(false, "staleTelemetry", sampleDetails(current, previousSample, { sampleIntervalMs: deltaMs }));
    }

    const distanceMeters = horizontalDistance(previousSample.position, position) / 100;
    const speedMps = distanceMeters / (deltaMs / 1000);
    const smoothedSpeedMps = previousSample.smoothedSpeedMps > 0
      ? previousSample.smoothedSpeedMps * (1 - SPEED_EMA_ALPHA) + speedMps * SPEED_EMA_ALPHA
      : speedMps;
    current.smoothedSpeedMps = smoothedSpeedMps;

    const details = sampleDetails(current, previousSample, {
      sampleIntervalMs: deltaMs,
      distanceMeters,
      speedMps,
      instantSpeedMps: speedMps,
      smoothedSpeedMps,
    });

    // Every accepted telemetry sample becomes the next movement baseline.
    // Invalid movement must not keep comparing against an older coordinate.
    previous.set(steamID, current);

    const vehicleType = String(player?.vehicle?.vehicleType ?? "").trim();
    const vehicleSeatIndex = toFiniteNumber(
      player?.telemetry?.vehicleSeatIndex
      ?? player?.vehicle?.vehicleSeatIndex
      ?? player?.raw?.bzss?.vehicleSeatIndex
      ?? player?.raw?.bzss?.compactStateInfo?.seatIndex,
    );
    // New BZSS-Core Runtime rows explicitly use -1 for walking and a
    // non-negative index for any vehicle seat. Prefer that over legacy OV flags.
    const onVehicle = vehicleSeatIndex != null
      ? vehicleSeatIndex >= 0
      : Boolean(
        player?.telemetry?.ov
        || player?.telemetry?.onVehicle
        || player?.presence?.ov
        || player?.presence?.onVehicle
        || vehicleType,
      );
    if (onVehicle) return result(false, "onVehicle", details);

    if (distanceMeters === 0) return result(false, "stationary", details);

    if (distanceMeters > MAX_SPEED_MPS * (deltaMs / 1000) + TELEPORT_MARGIN_METERS) {
      return result(false, "teleportOrRespawn", details);
    }

    if (speedMps < MIN_SPEED_MPS) return result(false, "belowWalkingSpeed", details);
    if (speedMps >= MAX_SPEED_MPS) return result(false, "aboveWalkingSpeed", details);

    const strideLength = clamp(0.62 + speedMps * 0.075, 0.65, 1.35);
    return result(true, "valid", {
      ...details,
      strideLength,
      steps: distanceMeters / strideLength,
    });
  }

  return { observe, reset, resetAll };
}

function result(valid, reason, details = {}) {
  return {
    valid,
    reason,
    distanceMeters: 0,
    speedMps: 0,
    instantSpeedMps: 0,
    smoothedSpeedMps: 0,
    steps: 0,
    sampleIntervalMs: null,
    telemetryAgeMs: telemetryAge(details.observedAt),
    ...details,
  };
}

function sampleDetails(current, previousSample, extra = {}) {
  return {
    position: current.position,
    observedAt: current.observedAt,
    sourceTick: current.sourceTick,
    sourceSeq: current.sourceSeq,
    telemetryAgeMs: telemetryAge(current.observedAt),
    sampleIntervalMs: previousSample
      ? current.observedAtMs - previousSample.observedAtMs
      : null,
    ...extra,
  };
}

function firstTelemetryTimestamp(player) {
  const direct = String(player?.telemetry?.observedAt ?? "").trim();
  if (direct) return direct;
  return String(player?.freshness?.bzssCoreUpdatedAt ?? "").trim();
}

function normalizeSampleKey(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function isDuplicateSample(previousSample, current) {
  if (current.sourceTick && previousSample.sourceTick && current.sourceTick === previousSample.sourceTick) return true;
  if (current.sourceSeq && previousSample.sourceSeq && current.sourceSeq === previousSample.sourceSeq) return true;
  return current.observedAt === previousSample.observedAt;
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeSteamID(value) {
  const text = String(value ?? "").trim();
  return /^\d{17}$/.test(text) ? text : "";
}

function normalizePosition(value) {
  if (!value || !["x", "y", "z"].every((key) => Number.isFinite(Number(value[key])))) return null;
  return { x: Number(value.x), y: Number(value.y), z: Number(value.z) };
}

function horizontalDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function telemetryAge(observedAt) {
  const timestamp = Date.parse(observedAt ?? "");
  return Number.isFinite(timestamp) ? Math.max(0, Date.now() - timestamp) : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export const stepCounterConstants = {
  MIN_SPEED_MPS,
  MAX_SPEED_MPS,
  MAX_SAMPLE_GAP_MS,
  SPEED_EMA_ALPHA,
};
