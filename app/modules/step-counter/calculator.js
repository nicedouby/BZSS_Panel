// -*- coding: utf-8 -*-

const MIN_SPEED_MPS = 0.3;
const MAX_SPEED_MPS = 10;
const MAX_SAMPLE_GAP_MS = 5000;
const TELEPORT_MARGIN_METERS = 2;

export function createStepCalculator() {
  const previous = new Map();

  function reset(steamID) {
    if (steamID) previous.delete(String(steamID));
  }

  function observe(player, observedAt) {
    const steamID = normalizeSteamID(player?.identity?.steamID);
    const position = normalizePosition(player?.telemetry?.position);
    const timestamp = Date.parse(observedAt || player?.freshness?.bzssCoreUpdatedAt || "");
    const now = Number.isFinite(timestamp) ? timestamp : Date.now();
    if (!steamID || !position) {
      if (steamID) previous.delete(steamID);
      return { valid: false, reason: !steamID ? "missingSteamID" : "missingPosition" };
    }

    const previousSample = previous.get(steamID);
    previous.set(steamID, { position, at: now });
    if (!previousSample) return { valid: false, reason: "warmingUp" };

    const deltaMs = now - previousSample.at;
    if (deltaMs <= 0 || deltaMs > MAX_SAMPLE_GAP_MS) {
      return { valid: false, reason: "invalidInterval" };
    }

    const distanceMeters = distance(previousSample.position, position) / 100;
    const deltaSeconds = deltaMs / 1000;
    const speedMps = distanceMeters / deltaSeconds;
    if (distanceMeters > MAX_SPEED_MPS * deltaSeconds + TELEPORT_MARGIN_METERS) {
      return { valid: false, reason: "teleportOrRespawn", speedMps, distanceMeters };
    }

    const presence = player?.presence ?? {};
    const vehicleType = String(player?.vehicle?.vehicleType ?? "").trim();
    const onVehicle = Boolean(
      player?.telemetry?.ov
      ?? player?.telemetry?.onVehicle
      ?? player?.presence?.ov
      ?? player?.presence?.onVehicle
      ?? vehicleType,
    );
    const inactive = presence.online === false
      || String(presence.state ?? "").toLowerCase() === "nopawn";

    if (inactive) return { valid: false, reason: "inactive", speedMps, distanceMeters };
    if (onVehicle) return { valid: false, reason: "onVehicle", speedMps, distanceMeters };
    if (speedMps < MIN_SPEED_MPS) return { valid: false, reason: "belowWalkingSpeed", speedMps, distanceMeters };
    if (speedMps >= MAX_SPEED_MPS) return { valid: false, reason: "aboveWalkingSpeed", speedMps, distanceMeters };

    const strideLength = clamp(0.62 + speedMps * 0.075, 0.65, 1.35);
    return {
      valid: true,
      distanceMeters,
      speedMps,
      strideLength,
      steps: distanceMeters / strideLength,
    };
  }

  return { observe, reset };
}

function normalizeSteamID(value) {
  const text = String(value ?? "").trim();
  return /^\d{17}$/.test(text) ? text : "";
}

function normalizePosition(value) {
  if (!value || !["x", "y", "z"].every((key) => Number.isFinite(Number(value[key])))) return null;
  return { x: Number(value.x), y: Number(value.y), z: Number(value.z) };
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export const stepCounterConstants = {
  MIN_SPEED_MPS,
  MAX_SPEED_MPS,
  MAX_SAMPLE_GAP_MS,
};
