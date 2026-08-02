// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";
import { SuperWeatherPresetStore } from "../domain/super-weather/preset-store.js";
import { SuperWeatherScheduler } from "../domain/super-weather/scheduler.js";

const PLUGIN_ID = "bzss-super-weather";

export function createPlugin({ core, modules, config, logger }) {
  const settings = {
    enabled: config.get(`plugins.${PLUGIN_ID}.enabled`, true) !== false,
    tickIntervalMs: Number(config.get(`plugins.${PLUGIN_ID}.tickIntervalMs`, 1000)) || 1000,
    maxExtrapolationSeconds: Number(config.get(`plugins.${PLUGIN_ID}.maxExtrapolationSeconds`, 180)) || 180,
    backwardJitterToleranceSeconds: Number(config.get(`plugins.${PLUGIN_ID}.backwardJitterToleranceSeconds`, 15)) || 15,
    dataDirectory: String(config.get(`plugins.${PLUGIN_ID}.dataDirectory`, "./data/bzss-super-weather")),
    persistRuntime: config.get(`plugins.${PLUGIN_ID}.persistRuntime`, true) !== false,
  };
  const runtimePath = path.resolve(process.cwd(), settings.dataDirectory, "runtime.json");
  const presetStore = new SuperWeatherPresetStore({ dataDirectory: settings.dataDirectory, logger });
  let persistChain = Promise.resolve();
  let lastObservedStatusAt = "";
  let unsubscribers = [];
  const scheduler = new SuperWeatherScheduler({
    commandService: core.bzssCoreCommandService,
    logger,
    tickIntervalMs: settings.tickIntervalMs,
    maxExtrapolationSeconds: settings.maxExtrapolationSeconds,
    backwardJitterToleranceSeconds: settings.backwardJitterToleranceSeconds,
    onStateChange(runtime) {
      if (settings.persistRuntime) queuePersist(runtime);
    },
  });

  function queuePersist(runtime = scheduler.getRuntimeState()) {
    persistChain = persistChain.then(async () => {
      await fs.mkdir(path.dirname(runtimePath), { recursive: true });
      const tempPath = `${runtimePath}.${process.pid}.tmp`;
      await fs.writeFile(tempPath, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");
      await fs.rename(tempPath, runtimePath);
    }).catch((error) => logger?.warn?.(`[SuperWeather] runtime persist failed: ${error.message}`));
    return persistChain;
  }

  async function readRuntime() {
    try {
      return JSON.parse(await fs.readFile(runtimePath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") logger?.warn?.(`[SuperWeather] runtime read failed: ${error.message}`);
      return {};
    }
  }

  function getMatchSnapshot() {
    return modules?.matchState?.getState?.() ?? null;
  }

  function roundKeyFrom(snapshot) {
    return String(snapshot?.round?.current?.dedupeKey ?? "").trim();
  }

  async function ingestSnapshot(snapshot, observedAt = "") {
    const serverStatus = snapshot?.serverStatus ?? snapshot?.matchState?.serverStatus ?? snapshot?.match ?? null;
    const statusAt = String(serverStatus?.lastUpdatedAt ?? observedAt ?? "");
    if (statusAt && statusAt === lastObservedStatusAt) return scheduler.getState();
    const playtime = Number(serverStatus?.playtime ?? snapshot?.match?.playtime);
    if (!Number.isFinite(playtime) || playtime < 0) return scheduler.getState();
    if (statusAt) lastObservedStatusAt = statusAt;
    return scheduler.updateRcon(playtime, roundKeyFrom(snapshot), { observedAt: statusAt });
  }

  const api = {
    getState: () => scheduler.getState(),
    listPresets: () => presetStore.list(),
    createPreset: (input) => presetStore.create(input),
    updatePreset: (id, input) => presetStore.update(id, input),
    deletePreset: async (id) => {
      if (scheduler.activePresetId === id) {
        const error = new Error("Stop Super Weather before deleting the active preset.");
        error.code = "ActivePresetDeleteDenied";
        error.statusCode = 409;
        throw error;
      }
      return presetStore.delete(id);
    },
    duplicatePreset: (id, name) => presetStore.duplicate(id, name),
    activate: async (presetId) => {
      const preset = presetStore.get(presetId);
      if (!preset) {
        const error = new Error("Weather preset was not found.");
        error.code = "PresetNotFound";
        error.statusCode = 404;
        throw error;
      }
      await ingestSnapshot(getMatchSnapshot());
      return scheduler.activate(preset);
    },
    stop: () => scheduler.stop(),
    reconcile: async () => {
      await ingestSnapshot(getMatchSnapshot(), new Date().toISOString());
      return scheduler.reconcile("manual", { force: true });
    },
    testWeather: (weatherType, transitionSeconds) => scheduler.testWeather(weatherType, transitionSeconds),
    ingestRcon: (seconds, roundKey) => scheduler.updateRcon(seconds, roundKey),
  };

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "BZSS Super Weather",
      kind: "plugin",
      category: "Server Control",
      version: "1.0.0",
      description: "RCON Record-time anchored weather timeline scheduler with jump reconciliation and persistent presets.",
    },
    apiName: "bzssSuperWeather",
    api,
    async init() {
      if (!core.bzssCoreCommandService) throw new Error("BzssCoreCommandService is unavailable.");
      await presetStore.init();
      scheduler.restore(await readRuntime());
    },
    async start() {
      if (!settings.enabled) return;
      scheduler.start();
      unsubscribers.push(core.eventBus.onModuleEvent("module.matchState", "serverStatusUpdated", (event) => {
        void ingestSnapshot({
          serverStatus: event?.serverStatus,
          match: event?.match,
          round: getMatchSnapshot()?.round,
        }, event?.time);
      }));
      unsubscribers.push(core.eventBus.onModuleEvent("module.matchState", "roundUpdated", (event) => {
        const key = String(event?.record?.dedupeKey ?? event?.roundState?.current?.dedupeKey ?? "").trim();
        if (key && key !== scheduler.roundKey) {
          lastObservedStatusAt = "";
          scheduler.resetRound(key);
        }
        void ingestSnapshot(getMatchSnapshot(), event?.time);
      }));
      await ingestSnapshot(getMatchSnapshot());
    },
    async stop() {
      scheduler.stopTimer();
      for (const unsubscribe of unsubscribers.splice(0)) {
        try { unsubscribe(); } catch {}
      }
      await queuePersist();
    },
  };
}
