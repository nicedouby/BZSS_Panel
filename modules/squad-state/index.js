// -*- coding: utf-8 -*-

export function createSquadStateModule({ core, modules, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.squadState",
    source: "module.squadState",
    channel: "module",
  }) ?? core.logger;

  const api = {
    getState(serverId) {
      warnDeprecated();
      return modules.squadManagement?.getState?.(serverId) ?? null;
    },

    getSquad(serverId, teamId, squadId) {
      warnDeprecated();
      return modules.squadManagement?.getSquad?.(serverId, teamId, squadId) ?? null;
    },

    getSquads(serverId) {
      warnDeprecated();
      return modules.squadManagement?.getSquads?.(serverId) ?? [];
    },
  };

  return {
    manifest: {
      id: "module.squadState",
      name: "Squad State Module",
      kind: "module",
      version: "0.3.0",
      description: "Deprecated compatibility wrapper for squadManagement.",
    },
    apiName: "squadState",
    api,

    async start() {
      warnDeprecated();
    },
  };

  function warnDeprecated() {
    moduleLogger?.warn?.("[squad-state] Deprecated: use squadManagement instead.");
  }
}
