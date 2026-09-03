// -*- coding: utf-8 -*-

import { createStepCalculator } from "./calculator.js";
import { createStepStorage } from "./storage.js";

const DIAGNOSTIC_REASON_FIELDS = {
  valid: "validSamples",
  duplicateTelemetry: "duplicateSamples",
  stationary: "stationarySamples",
  staleTelemetry: "staleSamples",
  teleportOrRespawn: "teleportSamples",
  aboveWalkingSpeed: "aboveWalkingSpeedSamples",
  missingTelemetryTimestamp: "missingTimestampSamples",
  missingPosition: "missingPositionSamples",
};

const STATUS_BY_REASON = {
  valid: "VALID",
  warmingUp: "WARMING_UP",
  duplicateTelemetry: "DUPLICATE",
  stationary: "STATIONARY",
  belowWalkingSpeed: "BELOW_WALKING_SPEED",
  aboveWalkingSpeed: "ABOVE_WALKING_SPEED",
  teleportOrRespawn: "TELEPORT",
  staleTelemetry: "STALE",
  onVehicle: "ON_VEHICLE",
  inactive: "INACTIVE",
  missingPosition: "NO_POSITION",
  missingTelemetryTimestamp: "NO_TIMESTAMP",
  invalidInterval: "INVALID_INTERVAL",
  missingSteamID: "NO_STEAM_ID",
};

export function createStepCounterModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.stepCounter", source: "module.stepCounter", channel: "module",
  }) ?? core.logger;
  const moduleConfig = config.get("modules.stepCounter", {});
  const dataDir = moduleConfig.dataDir || "data/step-counter";
  const calculator = createStepCalculator();
  const storage = createStepStorage({ dataDir, logger: moduleLogger });
  const sampleDiagnostics = createSampleDiagnostics();
  let unsubscribe = null;
  let unsubscribeRound = null;
  let flushTimer = null;
  let lastReason = "";
  let activeRoundKey = "";
  let started = false;

  function acceptRoundKey(roundKey, { flush = true } = {}) {
    const key = String(roundKey ?? "").trim();
    if (!key || key === activeRoundKey) return false;

    if (!activeRoundKey) {
      activeRoundKey = key;
      storage.setActiveRoundKey(key);
      return false;
    }

    for (const item of Object.values(storage.getData().players)) {
      const participated = Number(item.matchSteps ?? 0) > 0 || Number(item.matchDistanceMeters ?? 0) > 0;
      storage.upsert(item.steamID, {
        matchSteps: 0,
        matchDistanceMeters: 0,
        matches: Number(item.matches ?? 0) + (participated ? 1 : 0),
      });
    }
    activeRoundKey = key;
    storage.setActiveRoundKey(key);
    calculator.resetAll();
    moduleLogger?.info?.(`[StepCounter] confirmed new round: ${key}`);
    if (flush) {
      void storage.flush().catch((error) => {
        moduleLogger?.warn?.(`[StepCounter] round-boundary flush failed: ${error.message}`);
      });
    }
    return true;
  }

  function handleRoundUpdated(event) {
    acceptRoundKey(getStepRoundKey(event));
  }

  function handleSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.players)) return;
    for (const player of snapshot.players) {
      const steamID = String(player?.identity?.steamID ?? "").trim();
      if (!/^\d{17}$/.test(steamID)) continue;

      const result = calculator.observe(player);
      recordSampleDiagnostic(sampleDiagnostics, result);
      const existing = storage.getPlayer(steamID) ?? {};
      const name = String(player?.identity?.name ?? existing.playerName ?? "").trim();
      const observedAt = String(result.observedAt ?? player?.telemetry?.observedAt ?? "").trim();
      const patch = {
        playerName: name,
        lastSeenAt: observedAt || new Date().toISOString(),
        currentPosition: result.position ?? player?.telemetry?.position ?? null,
        sourceTick: result.sourceTick ?? player?.telemetry?.sourceTick ?? null,
        sourceSeq: result.sourceSeq ?? player?.telemetry?.sourceSeq ?? null,
        telemetryObservedAt: observedAt,
        telemetryAgeMs: finiteOrNull(result.telemetryAgeMs),
        sampleIntervalMs: finiteOrNull(result.sampleIntervalMs),
        distanceDeltaMeters: finiteOrZero(result.distanceMeters),
        instantSpeedMps: finiteOrZero(result.instantSpeedMps ?? result.speedMps),
        smoothedSpeedMps: finiteOrZero(result.smoothedSpeedMps),
        currentSpeedMps: finiteOrZero(result.smoothedSpeedMps ?? result.speedMps),
        currentStatus: STATUS_BY_REASON[result.reason] ?? String(result.reason ?? "UNKNOWN").toUpperCase(),
        lastReason: result.reason ?? "",
      };

      if (result.valid) {
        patch.totalSteps = Number(existing.totalSteps ?? 0) + result.steps;
        patch.totalDistanceMeters = Number(existing.totalDistanceMeters ?? 0) + result.distanceMeters;
        patch.matchSteps = Number(existing.matchSteps ?? 0) + result.steps;
        patch.matchDistanceMeters = Number(existing.matchDistanceMeters ?? 0) + result.distanceMeters;
        patch.lastReason = "";
      } else {
        lastReason = result.reason ?? lastReason;
      }
      storage.upsert(steamID, patch);
    }
  }

  function getStats() {
    const data = storage.getData();
    const now = Date.now();
    const players = Object.values(data.players)
      .map((player) => {
        const telemetryTimestamp = Date.parse(player.telemetryObservedAt ?? "");
        return {
          ...player,
          totalSteps: Math.floor(Number(player.totalSteps ?? 0)),
          matchSteps: Math.floor(Number(player.matchSteps ?? 0)),
          totalDistanceMeters: Number(Number(player.totalDistanceMeters ?? 0).toFixed(1)),
          matchDistanceMeters: Number(Number(player.matchDistanceMeters ?? 0).toFixed(1)),
          telemetryAgeMs: Number.isFinite(telemetryTimestamp)
            ? Math.max(0, now - telemetryTimestamp)
            : null,
        };
      })
      .sort((a, b) => b.matchSteps - a.matchSteps || b.totalSteps - a.totalSteps);
    return {
      updatedAt: data.updatedAt,
      players,
      lastReason,
      activeRoundKey,
      sampleDiagnostics: snapshotSampleDiagnostics(sampleDiagnostics),
      filePath: storage.filePath,
    };
  }

  return {
    manifest: {
      id: "module.stepCounter", name: "Step Counter Module", kind: "module", version: "1.1.0",
      description: "Estimates infantry steps from unique BZSS-Core telemetry samples and persists JSON statistics.",
    },
    apiName: "stepCounter",
    api: { getStats, getPlayer: (steamID) => storage.getPlayer(steamID) },
    async init() {
      await storage.init();
      activeRoundKey = storage.getActiveRoundKey();
      const matchStateApi = modules.matchState?.api ?? modules.matchState;
      acceptRoundKey(matchStateApi?.getCurrentMatchId?.(), { flush: false });
      this.api = { getStats, getPlayer: (steamID) => storage.getPlayer(steamID) };
    },
    async start() {
      if (started) return;
      started = true;
      core.webRegistry.registerPage({
        id: "web.stepCounter", title: "步数统计", group: "调试", route: "/debug/step-counter",
        pageModule: "/pages/step-counter.js", source: "module.stepCounter", required: false,
        enabled: true, order: 130, icon: "👣",
      });
      unsubscribe = modules.tacticalState?.subscribe?.(handleSnapshot) ?? null;
      unsubscribeRound = core.eventBus?.onModuleEvent?.("module.matchState", "roundUpdated", handleRoundUpdated) ?? null;
      flushTimer = setInterval(() => {
        void storage.flush().catch((error) => {
          moduleLogger?.warn?.(`[StepCounter] periodic flush failed: ${error.message}`);
        });
      }, 30_000);
      flushTimer.unref?.();
    },
    async stop() {
      started = false;
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      if (unsubscribeRound) unsubscribeRound();
      unsubscribeRound = null;
      if (flushTimer) clearInterval(flushTimer);
      flushTimer = null;
      await storage.flush(true);
    },
  };
}

function createSampleDiagnostics() {
  return {
    totalSamples: 0,
    validSamples: 0,
    duplicateSamples: 0,
    stationarySamples: 0,
    staleSamples: 0,
    teleportSamples: 0,
    aboveWalkingSpeedSamples: 0,
    missingTimestampSamples: 0,
    missingPositionSamples: 0,
    lastSampleIntervalMs: null,
    maxSampleIntervalMs: 0,
    intervalSamples: [],
  };
}

function recordSampleDiagnostic(diagnostics, result) {
  diagnostics.totalSamples += 1;
  const field = DIAGNOSTIC_REASON_FIELDS[result.reason];
  if (field) diagnostics[field] += 1;
  const interval = finiteOrNull(result.sampleIntervalMs);
  if (interval == null || interval <= 0) return;
  diagnostics.lastSampleIntervalMs = interval;
  diagnostics.maxSampleIntervalMs = Math.max(diagnostics.maxSampleIntervalMs, interval);
  diagnostics.intervalSamples.push(interval);
  if (diagnostics.intervalSamples.length > 1000) diagnostics.intervalSamples.shift();
}

function snapshotSampleDiagnostics(diagnostics) {
  const intervals = diagnostics.intervalSamples;
  const average = intervals.length
    ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length
    : null;
  const sorted = [...intervals].sort((a, b) => a - b);
  const p95Index = sorted.length ? Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1) : -1;
  return {
    totalSamples: diagnostics.totalSamples,
    validSamples: diagnostics.validSamples,
    duplicateSamples: diagnostics.duplicateSamples,
    stationarySamples: diagnostics.stationarySamples,
    staleSamples: diagnostics.staleSamples,
    teleportSamples: diagnostics.teleportSamples,
    aboveWalkingSpeedSamples: diagnostics.aboveWalkingSpeedSamples,
    missingTimestampSamples: diagnostics.missingTimestampSamples,
    missingPositionSamples: diagnostics.missingPositionSamples,
    lastSampleIntervalMs: diagnostics.lastSampleIntervalMs,
    averageSampleIntervalMs: average,
    maxSampleIntervalMs: diagnostics.maxSampleIntervalMs || null,
    p95SampleIntervalMs: p95Index >= 0 ? sorted[p95Index] : null,
    telemetryRateHz: average && average > 0 ? 1000 / average : null,
  };
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function finiteOrZero(value) {
  return finiteOrNull(value) ?? 0;
}

export function getStepRoundKey(value) {
  const record = value?.record ?? value?.roundState?.current ?? value;
  if (!record || typeof record !== "object") return "";

  return String(value?.matchId ?? record.matchId ?? "").trim();
}
