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

      return await squadManagement.executeAction({
        ...request,
        type: "kick_player",
        source: String(request.source ?? "module.squadKick").trim() || "module.squadKick",
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
      deprecated: true,
      hidden: true,
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
