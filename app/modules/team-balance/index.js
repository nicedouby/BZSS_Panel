// -*- coding: utf-8 -*-

import { createTeamBalanceService } from "./service.js";

const MODULE_ID = "module.teamBalance";
const FAIR_TEAM_BALANCE_SOURCE_PREFIX = "plugin.fairTeamBalance.";

export function createTeamBalanceModule({ core, modules, config, logger }) {
  const service = createTeamBalanceService({
    core,
    modules,
    config,
    logger,
  });

  const api = {
    ...service.api,

    forceTeamChange(request = {}) {
      return service.api.forceTeamChange(withFairTeamBalancePriority(request));
    },

    requestSwitchTeam(request = {}) {
      return service.api.requestSwitchTeam(withFairTeamBalancePriority(request));
    },

    switchTeam(request = {}) {
      return service.api.switchTeam(withFairTeamBalancePriority(request));
    },
  };

  return {
    manifest: {
      id: MODULE_ID,
      name: "Team Balance Module",
      kind: "module",
      version: "0.2.0",
      description: "Single gateway for manual team switch actions.",
    },
    apiName: "teamBalance",
    api,
    init: service.init,
    start: service.start,
    stop: service.stop,
  };
}

function withFairTeamBalancePriority(request = {}) {
  const source = String(request?.source ?? "").trim();
  if (!source.startsWith(FAIR_TEAM_BALANCE_SOURCE_PREFIX)) {
    return request;
  }

  // FairTB is an interactive, time-windowed player action. It must not sit in
  // the normal RCON queue behind a continuous stream of AdminWarn/Broadcast
  // traffic, otherwise strict priority scheduling can starve the actual team
  // switch for minutes. Keep manual/batch team-balance traffic unchanged.
  return {
    ...request,
    priority: "interactive",
    maxQueueWaitMs: Number.isFinite(Number(request?.maxQueueWaitMs))
      ? Number(request.maxQueueWaitMs)
      : 5000,
  };
}
