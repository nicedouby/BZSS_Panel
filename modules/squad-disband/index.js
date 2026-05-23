// -*- coding: utf-8 -*-

const MODULE_ID = "module.squadDisband";
const API_NAME = "squadDisband";

export function createSquadDisbandModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: MODULE_ID,
    source: MODULE_ID,
    channel: "module",
  }) ?? core.logger;

  const api = {
    async disbandSquad(request = {}) {
      const squadManagement = modules.squadManagement;
      if (!squadManagement) {
        throw new Error("SquadManagement module is required.");
      }

      const source = String(request.source ?? "manual").trim() || "manual";
      
      return await squadManagement.requestDisband({
        ...request,
        source,
      });
    },
  };

  return {
    manifest: {
      id: MODULE_ID,
      name: "Squad Disband Module",
      kind: "module",
      version: "1.0.0",
      description: "Dedicated module for disbanding squads.",
    },
    apiName: API_NAME,
    api,

    async init() {},
    async start() {
      moduleLogger.info("Squad Disband module started.");
    },
    async stop() {},
  };
}
