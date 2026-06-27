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
      version: "0.2.0",
      description: "Single gateway for manual team switch actions.",
    },
    apiName: "teamBalance",
    api: service.api,
    init: service.init,
    start: service.start,
    stop: service.stop,
  };
}
