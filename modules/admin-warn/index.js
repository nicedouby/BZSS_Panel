// -*- coding: utf-8 -*-

const DEFAULT_MAX_RECORDS = 3000;
const DEFAULT_TTL_MS = 30 * 60 * 1000;

export function createAdminWarnModule({ core, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.adminWarn",
    source: "module.adminWarn",
    channel: "module",
  }) ?? core.logger;
  const moduleConfig = config?.get?.("modules.adminWarn", {}) ?? {};
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const maxRecords = Math.max(1, Number(moduleConfig.maxRecords ?? DEFAULT_MAX_RECORDS));
  const ttlMs = Math.max(1000, Number(moduleConfig.ttlMs ?? DEFAULT_TTL_MS));

  const memoryStore = new AdminWarnMemoryStore({ maxRecords, ttlMs });

  const api = {
    async warnPlayer(req) {
      if (!enabled) {
        const message = prefixWarningMessage(sanitizeMessage(req?.message));
        memoryStore.push({
          id: makeRecordId("disabled"),
          createdAt: Date.now(),
          sourceModule: String(req?.sourceModule ?? "unknown"),
          reason: String(req?.reason ?? "disabled"),
          targetName: String(req?.targetName ?? ""),
          targetEosId: optionalText(req?.targetEosId),
          targetSteamId: optionalText(req?.targetSteamId),
          message,
          success: false,
          skipped: true,
          skipReason: "module_disabled",
          relatedEventId: optionalText(req?.relatedEventId),
        });
        return {
          success: false,
          skipped: true,
          skipReason: "module_disabled",
        };
      }

      const message = prefixWarningMessage(sanitizeMessage(req?.message));
      const targetName = String(req?.targetName ?? "").trim();
      const targetEosId = optionalText(req?.targetEosId);
      const targetSteamId = optionalText(req?.targetSteamId);
      if (!targetName || !message) {
        const record = memoryStore.push({
          id: makeRecordId("invalid"),
          createdAt: Date.now(),
          sourceModule: String(req?.sourceModule ?? "unknown"),
          reason: String(req?.reason ?? "invalid_request"),
          targetName,
          targetEosId,
          targetSteamId,
          message,
          success: false,
          skipped: true,
          skipReason: "invalid_request",
          relatedEventId: optionalText(req?.relatedEventId),
        });
        return {
          success: false,
          skipped: true,
          skipReason: record.skipReason,
        };
      }

      const commandText = buildCommand(targetName, message);
      try {
        const result = await core.rconManager.dispatchCommand({
          command: commandText,
          requestedBy: "module.adminWarn",
          reason: String(req?.reason ?? "admin_warn"),
          sourceEventId: optionalText(req?.relatedEventId),
        });

        if (!result?.success) {
          const errorMessage = String(result?.message ?? "RCON command failed.");
          memoryStore.push({
            id: makeRecordId("failed"),
            createdAt: Date.now(),
            sourceModule: String(req?.sourceModule ?? "unknown"),
            reason: String(req?.reason ?? "admin_warn_failed"),
            targetName,
            targetEosId,
            targetSteamId,
            message,
            commandText,
            success: false,
            skipped: false,
            errorMessage,
            relatedEventId: optionalText(req?.relatedEventId),
          });
          return {
            success: false,
            skipped: false,
            commandText,
            errorMessage,
          };
        }

        memoryStore.push({
          id: makeRecordId("ok"),
          createdAt: Date.now(),
          sourceModule: String(req?.sourceModule ?? "unknown"),
          reason: String(req?.reason ?? "admin_warn"),
          targetName,
          targetEosId,
          targetSteamId,
          message,
          commandText,
          success: true,
          skipped: false,
          relatedEventId: optionalText(req?.relatedEventId),
        });

        return {
          success: true,
          skipped: false,
          commandText,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        memoryStore.push({
          id: makeRecordId("error"),
          createdAt: Date.now(),
          sourceModule: String(req?.sourceModule ?? "unknown"),
          reason: String(req?.reason ?? "admin_warn_exception"),
          targetName,
          targetEosId,
          targetSteamId,
          message,
          commandText,
          success: false,
          skipped: false,
          errorMessage,
          relatedEventId: optionalText(req?.relatedEventId),
        });
        moduleLogger?.warn?.(`AdminWarn failed for ${targetName}: ${errorMessage}`);
        return {
          success: false,
          skipped: false,
          commandText,
          errorMessage,
        };
      }
    },

    async sendAdminWarn(req) {
      return api.warnPlayer(req);
    },

    getRecent(filter = {}) {
      return memoryStore.query(filter);
    },

    getConfig() {
      return {
        enabled,
        maxRecords,
        ttlMs,
      };
    },

    clear() {
      return memoryStore.clear();
    },
  };

  return {
    manifest: {
      id: "module.adminWarn",
      name: "Admin Warn Module",
      kind: "module",
      version: "0.1.0",
      description: "Unified AdminWarn execution module. Sanitizes messages, executes RCON AdminWarn, and keeps short-lived in-memory records for the web UI.",
    },
    apiName: "adminWarn",
    api,

    async start() {
      core.webRegistry?.registerPage?.({
        id: "web.adminWarn",
        title: "警告记录（当前进程内存）",
        group: "管理",
        route: "/admin-warns",
        pageModule: "/pages/admin-warns.js",
        source: "module.adminWarn",
        required: false,
        enabled: true,
        order: 112,
        icon: "W",
      });
      moduleLogger?.info?.(`AdminWarn started. maxRecords=${maxRecords} ttlMs=${ttlMs}`);
    },

    async stop() {
      memoryStore.clear();
      moduleLogger?.info?.("AdminWarn stopped.");
    },
  };
}

class AdminWarnMemoryStore {
  constructor({ maxRecords, ttlMs }) {
    this.maxRecords = maxRecords;
    this.ttlMs = ttlMs;
    this.records = [];
  }

  push(record) {
    this.prune(Date.now());
    this.records.push({
      ...record,
      targetEosId: optionalText(record?.targetEosId),
      targetSteamId: optionalText(record?.targetSteamId),
      commandText: optionalText(record?.commandText),
      skipReason: optionalText(record?.skipReason),
      errorMessage: optionalText(record?.errorMessage),
      relatedEventId: optionalText(record?.relatedEventId),
    });
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
    return this.records[this.records.length - 1];
  }

  query(filter = {}) {
    this.prune(Date.now());
    const limit = clampLimit(filter.limit, 200, this.maxRecords);
    const targetName = normalizeSearch(filter.targetName);
    const targetEosId = normalizeSearch(filter.targetEosId);
    const sourceModule = normalizeSearch(filter.sourceModule);
    const reason = normalizeSearch(filter.reason);
    const success = normalizeBooleanFilter(filter.success);
    const skipped = normalizeBooleanFilter(filter.skipped);

    return this.records
      .slice()
      .reverse()
      .filter((item) => {
        if (targetName && !normalizeSearch(item.targetName).includes(targetName)) return false;
        if (targetEosId && normalizeSearch(item.targetEosId) !== targetEosId) return false;
        if (sourceModule && normalizeSearch(item.sourceModule) !== sourceModule) return false;
        if (reason && normalizeSearch(item.reason) !== reason) return false;
        if (success != null && Boolean(item.success) !== success) return false;
        if (skipped != null && Boolean(item.skipped) !== skipped) return false;
        return true;
      })
      .slice(0, limit)
      .map(cloneJsonSafe);
  }

  clear() {
    const cleared = this.records.length;
    this.records.splice(0);
    return { ok: true, cleared };
  }

  prune(now) {
    const cutoff = now - this.ttlMs;
    while (this.records.length && Number(this.records[0]?.createdAt ?? 0) < cutoff) {
      this.records.shift();
    }
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
  }
}

function buildCommand(targetName, message) {
  return `AdminWarn "${escapeCommandText(targetName)}" "${escapeCommandText(message)}"`;
}

function escapeCommandText(value) {
  return String(value ?? "").replace(/"/g, "'");
}

function sanitizeMessage(message) {
  return String(message ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/"/g, "'")
    .trim()
    .slice(0, 180);
}

function prefixWarningMessage(message) {
  const text = String(message ?? "").trim();
  if (!text) return "";
  if (text.startsWith("[BZSS]")) return text;
  return `[BZSS] ${text}`;
}

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function normalizeSearch(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeBooleanFilter(value) {
  if (value === true || value === false) return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  return null;
}

function clampLimit(value, defaultValue, maxValue) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.max(1, Math.min(maxValue, parsed));
}

function cloneJsonSafe(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function makeRecordId(prefix) {
  return `adminWarn:${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}
