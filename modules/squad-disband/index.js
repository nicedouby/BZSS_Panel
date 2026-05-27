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

      return await squadManagement.executeAction({
        ...request,
        type: "disband_squad",
        source: String(request.source ?? "module.squadDisband").trim() || "module.squadDisband",
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
      deprecated: true,
      hidden: true,
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
