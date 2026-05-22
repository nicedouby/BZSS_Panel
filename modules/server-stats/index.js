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

  const databaseConfig = config.get("database", config.get("modules.serverStats.database", {}));
  let db = null;
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
      version: "1.0.0",
      description: "Stores normalized server metric snapshots in SQLite, deduplicates unchanged samples, and exposes history/current APIs for charting.",
    },
    apiName: "serverStats",
    api: null,

    async init() {
      db = await createDatabase(databaseConfig);
      store = new ServerMetricStore(db);
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
      });
      this.api = api;
    },

    async start() {
      await sampler?.start();
      moduleLogger.info?.("[ServerStats] module started.");
    },

    async stop() {
      await sampler?.stop();
      await db?.close();
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
