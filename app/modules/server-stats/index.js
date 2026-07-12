// -*- coding: utf-8 -*-

import { createDatabase } from "../../core/database.js";
import { createServerStatsApi } from "./api.js";
import { ServerInfoSampler } from "./sampler.js";
import { ServerMetricStore } from "./store.js";

export function createServerStatsModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.serverStats",
    source: "module.serverStats",
    channel: "module",
  }) ?? core.logger;

  const moduleConfig = config.get("modules.serverStats", {});
  const dataDir = moduleConfig.dataDir || "data/server-stats";
  
  let store = null;
  let sampler = null;
  let api = null;

  function getServerId() {
    return String(core.webStatus?.serverId ?? "BZSS_Main").trim() || "BZSS_Main";
  }

  function getMatchStateSnapshot() {
    return modules?.matchState?.getState?.()
      ?? modules?.matchState?.getOverview?.()?.matchState
      ?? null;
  }

  function buildRawSnapshot() {
    const matchState = getMatchStateSnapshot();
    const serverStatus = matchState?.serverStatus ?? {};
    const status = core.webStatus?.getSnapshot?.() ?? {};

    return {
      metrics: {
        players: firstFinite([
          serverStatus.playerCount,
          status.playerCount,
          matchState?.players?.count,
          matchState?.players?.list?.length,
        ]),
        queue: firstFinite([
          serverStatus.queueCount,
          status.queueCount,
        ]),
        tps: firstFinite([
          serverStatus.tps,
          status.tps,
        ]),
      },
    };
  }

  return {
    manifest: {
      id: "module.serverStats",
      name: "Server Stats Module",
      kind: "module",
      version: "1.1.0",
      description: "Stores normalized server metric snapshots in daily JSONL files, deduplicates unchanged samples, and exposes history/current APIs for charting.",
    },
    apiName: "serverStats",
    api: null,

    async init() {
      store = new ServerMetricStore({ dataDir, logger: moduleLogger });
      await store.init();
      sampler = new ServerInfoSampler({
        serverId: getServerId(),
        store,
        getSnapshot: buildRawSnapshot,
        logger: moduleLogger,
      });
      api = createServerStatsApi({
        sampler,
        store,
        getLiveSnapshot: async () => sampler.getCurrentSample(),
        getServerId,
        getMatchStateSnapshot,
        core,
      });
      this.api = api;
    },

    async start() {
      core.webRegistry.registerPage({
        id: "web.serverStats",
        title: "系统效能概览",
        group: "扩展",
        route: "/plugins/server-info-statistics",
        pageModule: "/pages/server-info-statistics.js",
        source: "module.serverStats",
        required: false,
        enabled: true,
        order: 200,
        icon: "📈",
      });

      await sampler?.start();
      moduleLogger.info?.(`[ServerStats] module started using file storage at ${dataDir}`);
    },

    async stop() {
      await sampler?.stop();
      moduleLogger.info?.("[ServerStats] module stopped.");
    },
  };
}

function firstFinite(values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}
