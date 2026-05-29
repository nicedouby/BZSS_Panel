// -*- coding: utf-8 -*-

import { createTeamBalanceService } from "./service.js";

const MODULE_ID = "module.teamBalance";

export function createTeamBalanceModule({ core, modules, config, logger }) {
  const service = createTeamBalanceService({
    core,
    modules,
    config,
    logger,
  });

  return {
    manifest: {
      id: MODULE_ID,
      name: "Team Balance Module",
      kind: "module",
      version: "0.1.0",
      description: "Central gateway for manual team switch actions. Records source and operator before executing RCON team change.",
    },
    apiName: "teamBalance",
    api: service.api,
    init: service.init,
    start: service.start,
    stop: service.stop,
  };
}
