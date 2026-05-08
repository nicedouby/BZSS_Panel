// -*- coding: utf-8 -*-

/**
 * Module: Audit
 *
 * 行为追溯模块。记录“谁通过什么模块做了什么动作”。
 */
export function createAuditModule({ core }) {
  const records = [];

  const api = {
    async record(record) {
      const item = {
        auditId: `audit_${Date.now()}_${records.length + 1}`,
        time: new Date().toISOString(),
        ...record,
      };

      records.push(item);
      core.logger.info(`[AUDIT] ${item.actorId ?? "unknown"} -> ${item.action ?? "unknown"}`);
      return item;
    },

    query(filter = {}) {
      return records.filter((item) => {
        if (filter.serverId && item.serverId !== filter.serverId) return false;
        if (filter.actorId && item.actorId !== filter.actorId) return false;
        if (filter.action && item.action !== filter.action) return false;
        return true;
      });
    },
  };

  return {
    manifest: { id: "module.audit", name: "Audit Module", kind: "module", version: "0.1.0", description: "行为追溯模块。记录面板内所有管理操作的'谁、通过什么模块、做了什么动作'，结果写入内存日志供查询。是跳边、解散小队、警告玩家等高危操作的审计链路终点，所有其他模块在执行敏感操作后必须调用 audit.record() 上报，保证操作可回溯。" },
    apiName: "audit",
    api,
  };
}
