// -*- coding: utf-8 -*-

const DEFAULT_MAX_RECORDS = 300;

export function createKillManageModule({ core, modules, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.killManage",
    source: "module.killManage",
    channel: "module",
  }) ?? core.logger;

  const moduleConfig = config?.get?.("modules.killManage", {}) ?? {};
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const maxRecords = Math.max(1, Number(moduleConfig.maxRecords ?? DEFAULT_MAX_RECORDS));
  const store = new KillManageMemoryStore(maxRecords);

  const api = {
    async killPlayer(input = {}) {
      return killPlayer(input);
    },

    async killRecord(input = {}) {
      return api.killPlayer(input);
    },

    getRecentKills(serverId = "", limit = 50) {
      return store.query({ serverId, limit });
    },

    clear() {
      return { ok: true, cleared: store.clear() };
    },
  };

  async function killPlayer(input = {}) {
    const targetName = String(input.targetName ?? "").trim();
    const targetSteamId = String(input.targetSteamId ?? "").trim();
    const reason = String(input.reason ?? "").trim();
    const operatorId = String(input.operatorId ?? "").trim();
    const operatorName = String(input.operatorName ?? "").trim();
    const source = String(input.source ?? "module.killManage").trim() || "module.killManage";
    const createdAt = Date.now();

    const command = buildKillCommand(targetName, targetSteamId);
    if (!enabled) {
      return storeAndReturn({
        success: false,
        command,
        targetName,
        targetSteamId,
        reason,
        operatorId,
        operatorName,
        source,
        error: "ModuleDisabled",
        createdAt,
        skipped: true,
        skipReason: "module_disabled",
      });
    }

    if (!targetName && !targetSteamId) {
      return storeAndReturn({
        success: false,
        command,
        targetName,
        targetSteamId,
        reason,
        operatorId,
        operatorName,
        source,
        error: "MissingTarget",
        createdAt,
        skipped: true,
        skipReason: "missing_target",
      });
    }

    try {
      const result = await core.rconManager.dispatchCommand({
        command,
        requestedBy: "module.killManage",
        reason: reason || "manual_kill",
        actor: input.actor ?? null,
        system: Boolean(input.system ?? false),
        priority: "high",
      });

      return storeAndReturn({
        success: Boolean(result?.success),
        command,
        targetName,
        targetSteamId,
        reason,
        operatorId,
        operatorName,
        source,
        error: result?.success ? "" : String(result?.message ?? "RCON command failed."),
        createdAt,
      });
    } catch (error) {
      return storeAndReturn({
        success: false,
        command,
        targetName,
        targetSteamId,
        reason,
        operatorId,
        operatorName,
        source,
        error: error instanceof Error ? error.message : String(error),
        createdAt,
      });
    }
  }

  function storeAndReturn(record) {
    const saved = store.push(record);
    return cloneJsonSafe(saved);
  }

  return {
    manifest: {
      id: "module.killManage",
      name: "RCON 强制击杀",
      kind: "module",
      version: "1.0.0",
      hidden: true,
      description: "管理端强制击杀入口，仅封装 AdminKill 兼容命令与执行记录，不参与战斗事件解析。",
    },
    apiName: "killManage",
    api,

    async start() {
      core.webRegistry?.registerPage?.({
        id: "web.killManage",
        title: "RCON 强制击杀",
        group: "管理",
        route: "/kill-manage",
        pageModule: "/pages/kill-manage.js",
        source: "module.killManage",
        description: "管理端强制击杀入口，仅执行 AdminKill。",
        required: false,
        enabled: true,
        order: 114,
        icon: "K",
      });
      moduleLogger?.info?.("KillManage admin-kill module started.", {
        operation: "start",
      });
    },

    async stop() {
      moduleLogger?.info?.("KillManage admin-kill module stopped.", {
        operation: "stop",
      });
    },
  };
}

class KillManageMemoryStore {
  constructor(maxRecords) {
    this.maxRecords = Math.max(1, Number(maxRecords ?? DEFAULT_MAX_RECORDS));
    this.records = [];
  }

  push(record) {
    this.records.push(cloneJsonSafe({
      ...record,
      createdAt: Number(record?.createdAt ?? Date.now()),
      success: Boolean(record?.success),
      skipped: Boolean(record?.skipped),
      skipReason: String(record?.skipReason ?? ""),
      error: String(record?.error ?? ""),
      command: String(record?.command ?? ""),
      targetName: String(record?.targetName ?? ""),
      targetSteamId: String(record?.targetSteamId ?? ""),
      reason: String(record?.reason ?? ""),
      operatorId: String(record?.operatorId ?? ""),
      operatorName: String(record?.operatorName ?? ""),
      source: String(record?.source ?? "module.killManage"),
    }));

    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }

    return this.records[this.records.length - 1];
  }

  query({ serverId = "", limit = 50 } = {}) {
    const wantedServer = String(serverId ?? "").trim();
    const maxLimit = Math.max(1, Math.min(Number(limit) || 50, this.maxRecords));
    return this.records
      .slice()
      .reverse()
      .filter((record) => !wantedServer || String(record.serverId ?? "").trim() === wantedServer)
      .slice(0, maxLimit)
      .map(cloneJsonSafe);
  }

  clear() {
    const cleared = this.records.length;
    this.records.splice(0);
    return cleared;
  }
}

function buildKillCommand(targetName, targetSteamId) {
  const target = targetName || targetSteamId || "";
  return `AdminKill "${escapeCommandText(target)}"`;
}

function escapeCommandText(value) {
  return String(value ?? "").replace(/"/g, "'").trim();
}

function cloneJsonSafe(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

export default createKillManageModule;
