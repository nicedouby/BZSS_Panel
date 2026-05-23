// -*- coding: utf-8 -*-

const MODULE_ID = "module.squadKick";
const API_NAME = "squadKick";

export function createSquadKickModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: MODULE_ID,
    source: MODULE_ID,
    channel: "module",
  }) ?? core.logger;

  const api = {
    async kickPlayer(request = {}) {
      const squadManagement = modules.squadManagement;
      if (!squadManagement) {
        throw new Error("SquadManagement module is required.");
      }

      const source = String(request.source ?? "manual").trim() || "manual";
      
      return await squadManagement.requestKick({
        ...request,
        source,
      });
    },
  };

  return {
    manifest: {
      id: MODULE_ID,
      name: "Squad Kick Module",
      kind: "module",
      version: "1.0.0",
      description: "Dedicated module for kicking players from server.",
    },
    apiName: API_NAME,
    api,

    async init() {},
    async start() {
      moduleLogger.info("Squad Kick module started.");
    },
    async stop() {},
  };
}
