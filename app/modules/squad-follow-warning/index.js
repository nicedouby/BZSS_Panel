// -*- coding: utf-8 -*-

const MODULE_ID = "module.squadFollowWarning";

export function createSquadFollowWarningModule({ core, config, logger } = {}) {
  const moduleLogger = logger ?? core?.logger ?? console;
  const moduleConfig = config?.get?.("modules.squadFollowWarning", {}) ?? {};
  const enabled = Boolean(moduleConfig.enabled ?? false);

  const state = {
    enabled,
    subscribed: false,
    recentWarnings: [],
    stats: {
      warnings: 0,
    },
  };

  return {
    manifest: {
      id: MODULE_ID,
      name: "Squad Follow Warning Module",
      kind: "module",
      version: "0.1.1",
      hidden: true,
      description: "Disabled placeholder for squad follow radius warnings.",
    },
    apiName: "squadFollowWarning",
    api: {
      getState() {
        return {
          ...state,
          recentWarnings: [...state.recentWarnings].reverse(),
        };
      },
    },
    start() {
      moduleLogger?.info?.("[SquadFollowWarning] disabled.");
    },
    stop() {
      moduleLogger?.info?.("[SquadFollowWarning] stopped.");
    },
  };
}
