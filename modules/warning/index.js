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
    manifest: { id: "module.warning", name: "Warning Module", kind: "module", version: "0.1.0", description: "玩家警告/提示执行模块。封装 AdminWarn RCON 命令，为所有需要向玩家发送警告消息的插件提供统一入口。执行后自动调用 audit.record() 记录操作者、目标玩家和警告内容，避免各插件各自调用 RCON 导致行为分散和审计断链。" },
    apiName: "warning",
    api,
  };
}
