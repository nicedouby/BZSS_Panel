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
    manifest: { id: "module.squadManage", name: "Squad Manage Module", kind: "module", version: "0.1.0" },
    apiName: "squadManage",
    api,
  };
}
