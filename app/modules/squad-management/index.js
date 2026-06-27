// -*- coding: utf-8 -*-

import { createSquadManagementRepository } from "./repository.js";
import { createSquadManagementService } from "./service.js";

const MODULE_ID = "module.squadManagement";

export function createSquadManagementModule({ core, modules, config, logger }) {
  const repository = createSquadManagementRepository({ config, logger });
  const service = createSquadManagementService({
    core,
    modules,
    config,
    logger,
    repository,
  });

  return {
    manifest: {
      id: MODULE_ID,
      name: "Squad Management Module",
      kind: "module",
      version: "0.3.0",
      description: "Unified squad state, lifecycle, records, and action gateway.",
    },
    apiName: "squadManagement",
    api: service.api,
    init: service.init,
    start: service.start,
    stop: service.stop,
  };
}

