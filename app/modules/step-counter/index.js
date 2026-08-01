// -*- coding: utf-8 -*-

import { createStepCalculator } from "./calculator.js";
import { createStepStorage } from "./storage.js";

export function createStepCounterModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.stepCounter", source: "module.stepCounter", channel: "module",
  }) ?? core.logger;
  const moduleConfig = config.get("modules.stepCounter", {});
  const dataDir = moduleConfig.dataDir || "data/step-counter";
  const calculator = createStepCalculator();
  const storage = createStepStorage({ dataDir, logger: moduleLogger });
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
    const observedAt = snapshot.meta?.generatedAt ?? new Date().toISOString();
    for (const player of snapshot.players) {
      const steamID = String(player?.identity?.steamID ?? "").trim();
      if (!/^\d{17}$/.test(steamID)) continue;
      const result = calculator.observe(player, observedAt);
      const existing = storage.getPlayer(steamID) ?? {};
      const name = String(player?.identity?.name ?? existing.playerName ?? "").trim();
      const patch = { playerName: name, lastSeenAt: observedAt, currentSpeedMps: Number(result.speedMps ?? 0), lastReason: result.reason ?? "" };
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
    const players = Object.values(data.players)
      .map((player) => ({
        ...player,
        totalSteps: Math.floor(Number(player.totalSteps ?? 0)),
        matchSteps: Math.floor(Number(player.matchSteps ?? 0)),
        totalDistanceMeters: Number(Number(player.totalDistanceMeters ?? 0).toFixed(1)),
        matchDistanceMeters: Number(Number(player.matchDistanceMeters ?? 0).toFixed(1)),
      }))
      .sort((a, b) => b.matchSteps - a.matchSteps || b.totalSteps - a.totalSteps);
    return { updatedAt: data.updatedAt, players, lastReason, activeRoundKey, filePath: storage.filePath };
  }

  return {
    manifest: {
      id: "module.stepCounter", name: "Step Counter Module", kind: "module", version: "1.0.0",
      description: "Estimates infantry steps from tactical-state distance and speed, and persists JSON statistics.",
    },
    apiName: "stepCounter",
    api: { getStats, getPlayer: (steamID) => storage.getPlayer(steamID) },
    async init() {
      await storage.init();
      activeRoundKey = storage.getActiveRoundKey();
      const currentRound = modules.matchState?.getState?.()?.round?.current;
      acceptRoundKey(getStepRoundKey(currentRound), { flush: false });
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

export function getStepRoundKey(value) {
  const record = value?.record ?? value?.roundState?.current ?? value;
  if (!record || typeof record !== "object") return "";

  const direct = String(record.dedupeKey ?? "").trim();
  if (direct) return direct;

  const serverId = String(record.serverId ?? value?.serverId ?? "").trim();
  const logLineTime = String(record.logLineTime ?? "").trim();
  const worldPath = String(record.worldPath ?? "").trim();
  const serverPlayAt = String(record.serverPlayAt ?? "").trim();
  if (!worldPath || (!logLineTime && !serverPlayAt)) return "";
  return [serverId, logLineTime, worldPath, serverPlayAt].join(":");
}
