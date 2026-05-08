// -*- coding: utf-8 -*-

export function createSquadManageModule({ core, modules }) {
  const api = {
    async disbandSquad(request) {
      const result = await core.rconManager.dispatchCommand({
        command: `AdminDisbandSquad ${request.teamId} ${request.squadId}`,
        requestedBy: request.requestedBy,
        reason: request.reason,
      });

      await modules.audit?.record({
        serverId: request.serverId,
        actorId: request.requestedBy,
        actorKind: "plugin",
        action: "DisbandSquad",
        targetType: "squad",
        targetId: `${request.teamId}:${request.squadId}`,
        reason: request.reason,
        sourceEventId: request.sourceEventId,
        result: result.success ? "success" : "failed",
        raw: { request, result },
      });

      return { success: result.success, moduleId: "module.squadManage", action: "DisbandSquad", message: result.message };
    },
  };

  return {
    manifest: { id: "module.squadManage", name: "Squad Manage Module", kind: "module", version: "0.1.0", description: "小队管理执行模块。提供解散小队等 RCON 操作的标准封装 API，所有插件和页面的小队管理操作必须经此模块执行。执行结果同步写入 audit.record()，避免直接绕过模块层调用底层 RCON 命令，保持操作链路的一致性与可追溯性。" },
    apiName: "squadManage",
    api,
  };
}
