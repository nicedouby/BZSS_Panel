// -*- coding: utf-8 -*-

export function createTeamBalanceModule({ core, modules }) {
  const api = {
    async canSwitchTeam(request) {
      return { allowed: true, reason: "Minimal skeleton allows switch." };
    },

    async requestSwitchTeam(request) {
      const check = await api.canSwitchTeam(request);
      if (!check.allowed) {
        return { success: false, moduleId: "module.teamBalance", action: "SwitchTeam", message: check.reason };
      }

      const result = await core.rconManager.dispatchCommand({
        command: `AdminForceTeamChange ${request.targetName ?? request.targetSteam64 ?? ""}`,
        requestedBy: request.requestedBy,
        reason: request.reason,
      });

      await modules.audit?.record({
        serverId: request.serverId,
        actorId: request.requestedBy,
        actorKind: "plugin",
        action: "SwitchTeam",
        targetType: "player",
        targetId: request.targetSteam64 ?? request.targetName ?? "",
        reason: request.reason,
        sourceEventId: request.sourceEventId,
        result: result.success ? "success" : "failed",
        raw: { request, result },
      });

      return { success: result.success, moduleId: "module.teamBalance", action: "SwitchTeam", message: result.message };
    },
  };

  return {
    manifest: { id: "module.teamBalance", name: "Team Balance Module", kind: "module", version: "0.1.0" },
    apiName: "teamBalance",
    api,
  };
}
