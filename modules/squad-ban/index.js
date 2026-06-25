// -*- coding: utf-8 -*-

const MODULE_ID = "module.squadBan";
const API_NAME = "squadBan";

export function createSquadBanModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: MODULE_ID,
    source: MODULE_ID,
    channel: "module",
  }) ?? core.logger;

  const api = {
    async banPlayer(request = {}) {
      const squadManagement = modules.squadManagement;
      if (!squadManagement) {
        throw new Error("SquadManagement module is required.");
      }

      return await squadManagement.executeAction({
        ...request,
        type: "ban_player",
        source: String(request.source ?? "module.squadBan").trim() || "module.squadBan",
      });
    },
  };

  return {
    manifest: {
      id: MODULE_ID,
      name: "Squad Ban Module",
      kind: "module",
      version: "1.0.0",
      description: "Dedicated module for banning players from server.",
      deprecated: true,
      hidden: true,
    },
    apiName: API_NAME,
    api,

    async init() {},
    async start() {
      moduleLogger.info("Squad Ban module started.");
    },
    async stop() {},
  };
}
