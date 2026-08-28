// -*- coding: utf-8 -*-

import { calculatePressureZones } from "./engine.js";
import { DEFAULT_PRESSURE_ZONE_CONFIG, mergePressureZoneConfig } from "./defaults.js";
import { createBaseConfigStore } from "./base-config-store.js";
import { createLayerProfileStore } from "./layer-profile-store.js";
import { simulatePressureZones } from "./simulator.js";
import { resolveLiveHotspot as resolveEngagementHotspot } from "./live-hotspot.js";
import {
  TACTICAL_MAP_CONFIGS,
  getStaticTacticalAssets,
  resolveTacticalMapKey,
} from "../../../web-client/src/shared/tactical-map-data.shared.js";

export function createDynamicPressureZoneModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.dynamicPressureZone",
    source: "module.dynamicPressureZone",
    channel: "module",
  }) ?? core.logger;
  const moduleConfig = config.get("modules.dynamicPressureZone", {});
  const store = createLayerProfileStore({
    dataDir: moduleConfig.dataDir || "data/dynamic-pressure-zone",
    logger: moduleLogger,
  });
  const baseConfigStore = createBaseConfigStore({
    dataDir: moduleConfig.dataDir || "data/dynamic-pressure-zone",
    logger: moduleLogger,
  });
  const subscribers = new Set();
  let unsubscribe = null;
  let state = inactive("waiting-for-tactical-state");
  let currentProfile = null;
  let currentLayer = "";
  let lastSnapshot = null;
  let lastInputSignature = "";
  let generation = 0;
  let started = false;
  let baseConfig = mergePressureZoneConfig(moduleConfig.rules);

  function getState() {
    return clone(state);
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  }

  function publish(nextState) {
    state = nextState;
    for (const listener of subscribers) {
      try { listener(clone(state)); } catch {}
    }
  }

  async function recalculate(snapshot = lastSnapshot, { force = false } = {}) {
    if (snapshot) lastSnapshot = snapshot;
    const inputSignature = buildRelevantSnapshotSignature(snapshot ?? {});
    if (!force && inputSignature === lastInputSignature) return getState();
    const localGeneration = ++generation;
    const source = snapshot ?? {};
    const layer = firstText(source?.server?.layer, source?.match?.layer, source?.server?.map, source?.match?.map);
    if (layer !== currentLayer) {
      currentLayer = layer;
      currentProfile = layer ? await store.get(layer) : null;
    }
    if (localGeneration !== generation) return getState();
    const input = buildLiveInput(source, currentProfile, baseConfig);
    const calculated = calculatePressureZones(input);
    calculated.layer = layer;
    calculated.mapKey = input.mapKey ?? "";
    calculated.profileSource = currentProfile ? "saved" : "runtime";
    lastInputSignature = inputSignature;
    publish(calculated);
    return getState();
  }

  async function getLayerProfile() {
    if (!currentProfile && currentLayer) currentProfile = await store.get(currentLayer);
    return clone(currentProfile);
  }

  async function saveLayerProfile(profile) {
    const result = await store.save(profile);
    if (result.profile.layer === currentLayer) {
      currentProfile = result.profile;
      await recalculate(lastSnapshot, { force: true });
    }
    return clone(result);
  }

  function getBaseConfig() {
    return {
      config: clone(baseConfig),
      defaults: clone(DEFAULT_PRESSURE_ZONE_CONFIG),
    };
  }

  async function saveBaseConfig(value) {
    const result = await baseConfigStore.save(value);
    baseConfig = mergePressureZoneConfig(moduleConfig.rules, result.config);
    await recalculate(lastSnapshot, { force: true });
    return { ...clone(result), config: clone(baseConfig) };
  }

  function simulate(input = {}) {
    return simulatePressureZones({
      ...input,
      config: mergePressureZoneConfig(baseConfig, input?.config),
    });
  }

  return {
    manifest: {
      id: "module.dynamicPressureZone",
      name: "Dynamic Pressure Zone",
      kind: "module",
      version: "0.3.0",
      description: "Calculates unlock-aware, live-combat adaptive pressure zones for AAS and RAAS layers.",
    },
    apiName: "dynamicPressureZone",
    api: {
      getState,
      getLayerProfile,
      saveLayerProfile,
      getBaseConfig,
      saveBaseConfig,
      simulate,
      subscribe,
      recalculate,
    },
    async init() {
      await store.init();
      await baseConfigStore.init();
      baseConfig = mergePressureZoneConfig(moduleConfig.rules, await baseConfigStore.get());
    },
    async start() {
      if (started) return;
      started = true;
      unsubscribe = modules.tacticalState?.subscribe?.((snapshot) => {
        void recalculate(snapshot).catch((error) => {
          moduleLogger?.warn?.(`[DynamicPressureZone] recalculation failed: ${error.message}`);
        });
      }) ?? null;
      const initial = await modules.tacticalState?.getSnapshot?.();
      await recalculate(initial ?? null);
    },
    async stop() {
      started = false;
      generation += 1;
      unsubscribe?.();
      unsubscribe = null;
      subscribers.clear();
    },
  };
}

function buildRelevantSnapshotSignature(snapshot) {
  const captureZones = Array.isArray(snapshot?.assets?.captureZones) ? snapshot.assets.captureZones : [];
  const mainZones = Array.isArray(snapshot?.assets?.mainZones) ? snapshot.assets.mainZones : [];
  const players = Array.isArray(snapshot?.players) ? snapshot.players : [];
  return JSON.stringify({
    layer: firstText(snapshot?.server?.layer, snapshot?.match?.layer, snapshot?.server?.map),
    mode: firstText(snapshot?.server?.mode, snapshot?.match?.mode),
    captureZones: captureZones.map((zone) => [
      zone?.id ?? zone?.name ?? "",
      zone?.ownerTeamId ?? zone?.teamId ?? zone?.captureDirection ?? null,
      zone?.isLocked ?? zone?.locked ?? null,
      zone?.capturePercent ?? null,
      zone?.position?.x ?? zone?.x ?? null,
      zone?.position?.y ?? zone?.y ?? null,
    ]),
    mainZones: mainZones.map((zone) => [
      zone?.teamId ?? zone?.teamID ?? null,
      zone?.position?.x ?? zone?.x ?? null,
      zone?.position?.y ?? zone?.y ?? null,
    ]),
    players: players.map((player) => [
      player?.identity?.key ?? player?.identity?.playerID ?? player?.playerId ?? "",
      player?.telemetry?.position?.x ?? player?.soldierInfo?.position?.x ?? player?.position?.x ?? null,
      player?.telemetry?.position?.y ?? player?.soldierInfo?.position?.y ?? player?.position?.y ?? null,
      player?.telemetry?.health ?? player?.soldierInfo?.health ?? null,
      player?.telemetry?.inactive ?? player?.inactive ?? null,
      player?.telemetry?.onVehicle ?? player?.vehicle?.onVehicle ?? null,
      player?.presence?.state ?? "",
      player?.match?.teamId ?? player?.teamId ?? null,
    ]),
  });
}

function buildLiveInput(snapshot, profile, baseConfig) {
  const assets = snapshot?.assets ?? {};
  const mapIdentity = firstText(profile?.mapKey, snapshot?.server?.map, snapshot?.server?.layer, snapshot?.match?.map);
  const mapKey = profile?.mapKey || resolveTacticalMapKey(mapIdentity) || "";
  const mapConfig = TACTICAL_MAP_CONFIGS[mapKey] ?? null;
  const staticAssets = getStaticTacticalAssets(mapKey) ?? {};
  const runtimeObjectives = normalizeRuntimeObjectives(assets.captureZones, staticAssets.captureZones);
  const objectives = profile?.objectives?.length ? profile.objectives : runtimeObjectives;
  const runtimeByName = new Map(runtimeObjectives.flatMap((objective) => [
    [objective.name, objective],
    [objective.id, objective],
  ]));
  const objectiveState = Object.fromEntries(objectives.map((objective) => {
    const runtime = runtimeByName.get(objective.name) ?? runtimeByName.get(objective.id) ?? objective;
    return [objective.id, {
      ownerTeamId: runtime.ownerTeamId ?? runtime.teamId ?? null,
      isLocked: runtime.isLocked ?? objective.isLocked ?? null,
    }];
  }));
  const mapBounds = profile?.mapBounds ?? mapConfig?.bounds ?? null;
  return {
    mode: firstText(profile?.mode, snapshot?.server?.mode, snapshot?.match?.mode, snapshot?.server?.layer),
    mapKey,
    mapBounds,
    mapSize: mapConfig?.widthMeters && mapConfig?.heightMeters
      ? { widthMeters: mapConfig.widthMeters, heightMeters: mapConfig.heightMeters }
      : null,
    mains: profile?.mains ?? normalizeRuntimeMains(assets.mainZones),
    objectiveChain: objectives,
    objectiveState,
    hotspot: resolveEngagementHotspot(snapshot?.players, {
      mapBounds,
      coordinateScaleMeters: baseConfig?.coordinateScaleMeters,
      config: baseConfig?.hotspot,
    }),
    config: baseConfig,
  };
}

function normalizeRuntimeObjectives(zones, staticZones) {
  const staticByName = new Map((Array.isArray(staticZones) ? staticZones : []).map((zone) => [String(zone?.name ?? "").trim(), zone]));
  return (Array.isArray(zones) ? zones : []).map((zone, index) => {
    const name = String(zone?.name ?? `P${index + 1}`).trim() || `P${index + 1}`;
    const fallback = staticByName.get(name) ?? null;
    return {
      id: String(zone?.id ?? name).trim() || `p${index + 1}`,
      name,
      x: finite(zone?.x ?? zone?.position?.x ?? fallback?.x),
      y: finite(zone?.y ?? zone?.position?.y ?? fallback?.y),
      ownerTeamId: normalizeTeamId(zone?.ownerTeamId ?? zone?.teamId ?? zone?.captureDirection),
      isLocked: normalizeLockState(zone?.isLocked ?? zone?.locked),
      capturePercent: finite(zone?.capturePercent),
    };
  }).filter((zone) => zone.x != null && zone.y != null);
}

function normalizeRuntimeMains(zones) {
  return (Array.isArray(zones) ? zones : []).map((zone) => ({
    teamId: normalizeTeamId(zone?.teamId ?? zone?.teamID),
    x: finite(zone?.x ?? zone?.position?.x),
    y: finite(zone?.y ?? zone?.position?.y),
  })).filter((zone) => zone.teamId && zone.x != null && zone.y != null);
}

function inactive(reason) {
  return { active: false, reason, map: null, combat: null, bases: {}, zones: [], diagnostics: {} };
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function finite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeTeamId(value) {
  const numeric = Number(value);
  return numeric === 1 || numeric === 2 ? numeric : null;
}

function normalizeLockState(value) {
  if (value === true || value === false) return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "locked"].includes(text)) return true;
  if (["false", "0", "no", "unlocked"].includes(text)) return false;
  return null;
}

function clone(value) {
  if (value == null) return value;
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}
