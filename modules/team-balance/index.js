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
    manifest: { id: "module.teamBalance", name: "Team Balance Module", kind: "module", version: "0.1.0", description: "队伍平衡执行模块。提供 canSwitchTeam() 权限检查和 requestSwitchTeam() 强制换队两个 API，所有插件和页面的换队操作必须经此模块执行，不能绕过直接调用 RCON。执行后自动调用 audit.record() 记录操作，保证换队行为留有审计追踪。" },
    apiName: "teamBalance",
    api,
  };
}
