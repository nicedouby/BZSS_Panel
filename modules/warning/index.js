// -*- coding: utf-8 -*-

export function createWarningModule({ core, modules }) {
  const api = {
    async warnPlayer(request) {
      const target = request.targetName ?? request.targetSteam64 ?? request.targetEOS ?? "";
      const result = await core.rconManager.dispatchCommand({
        command: `AdminWarn "${target}" "${request.message}"`,
        requestedBy: request.requestedBy,
        reason: request.reason,
      });

      await modules.audit?.record({
        serverId: request.serverId,
        actorId: request.requestedBy,
        actorKind: "plugin",
        action: "WarnPlayer",
        targetType: "player",
        targetId: target,
        reason: request.reason,
        sourceEventId: request.sourceEventId,
        result: result.success ? "success" : "failed",
        raw: { request, result },
      });

      return { success: result.success, moduleId: "module.warning", action: "WarnPlayer", message: result.message };
    },
  };

  return {
    manifest: { id: "module.warning", name: "Warning Module", kind: "module", version: "0.1.0" },
    apiName: "warning",
    api,
  };
}
