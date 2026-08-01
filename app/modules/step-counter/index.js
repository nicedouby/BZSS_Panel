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
  let flushTimer = null;
  let lastReason = "";
  let activeMatchKey = null;
  let started = false;

  function getSnapshot() {
    return modules.tacticalState?.getSnapshot?.() ?? null;
  }

  function getMatchKey(snapshot) {
    const match = snapshot?.match ?? {};
    const server = snapshot?.server ?? {};
    return String(
      match.matchId ?? match.id ?? match.startTime ?? match.startedAt
      ?? `${server.serverId ?? ""}:${server.map ?? ""}:${server.layer ?? ""}`,
    );
  }

  function ensureMatch(player, snapshot) {
    const key = getMatchKey(snapshot);
    if (!activeMatchKey) {
      activeMatchKey = key;
    } else if (key && key !== activeMatchKey) {
      for (const item of Object.values(storage.getData().players)) {
        storage.upsert(item.steamID, { matchSteps: 0, matchDistanceMeters: 0, matches: Number(item.matches ?? 0) + 1 });
      }
      activeMatchKey = key;
      calculator.reset(player?.identity?.steamID);
    }
  }

  function handleSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.players)) return;
    ensureMatch(snapshot.players[0], snapshot);
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
    return { updatedAt: data.updatedAt, players, lastReason, filePath: storage.filePath };
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
      flushTimer = setInterval(() => { void storage.flush(); }, 30_000);
      flushTimer.unref?.();
    },
    async stop() {
      started = false;
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      if (flushTimer) clearInterval(flushTimer);
      flushTimer = null;
      await storage.flush(true);
    },
  };
}
