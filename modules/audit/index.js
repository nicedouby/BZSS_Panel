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
    manifest: { id: "module.audit", name: "Audit Module", kind: "module", version: "0.1.0" },
    apiName: "audit",
    api,
  };
}
