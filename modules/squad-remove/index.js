// -*- coding: utf-8 -*-

const MODULE_ID = "module.squadRemove";
const API_NAME = "squadRemove";

export function createSquadRemoveModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: MODULE_ID,
    source: MODULE_ID,
    channel: "module",
  }) ?? core.logger;

  const api = {
    async removePlayerFromSquad(request = {}) {
      const squadManagement = modules.squadManagement;
      if (!squadManagement) {
        throw new Error("SquadManagement module is required.");
      }

      return await squadManagement.executeAction({
        ...request,
        type: "remove_from_squad",
        source: String(request.source ?? "module.squadRemove").trim() || "module.squadRemove",
      });
    },
  };

  return {
    manifest: {
      id: MODULE_ID,
      name: "Squad Remove Module",
      kind: "module",
      version: "1.0.0",
      description: "Dedicated module for removing players from squads.",
      deprecated: true,
      hidden: true,
    },
    apiName: API_NAME,
    api,

    async init() {},
    async start() {
      moduleLogger.info("Squad Remove module started.");
    },
    async stop() {},
  };
}
