// -*- coding: utf-8 -*-

const DEFAULT_MAX_RECORDS = 3000;
const DEFAULT_TTL_MS = 30 * 60 * 1000;

export function createAdminWarnModule({ core, config, logger }) {
  const moduleLogger =
    logger ??
    core.createLogger?.({
      moduleId: "module.adminWarn",
      source: "module.adminWarn",
      channel: "module",
    }) ??
    core.logger;

  const moduleConfig = config?.get?.("modules.adminWarn", {}) ?? {};
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const maxRecords = Math.max(1, Number(moduleConfig.maxRecords ?? DEFAULT_MAX_RECORDS));
  const ttlMs = Math.max(1000, Number(moduleConfig.ttlMs ?? DEFAULT_TTL_MS));

  const memoryStore = new AdminWarnMemoryStore({ maxRecords, ttlMs });

  const api = {
    async warnPlayer(req) {
      return sendNotification("warning", req);
    },

    async sendAdminWarn(req) {
      return api.warnPlayer(req);
    },

    async broadcastMessage(req) {
      return sendNotification("broadcast", req);
    },

    async sendAdminBroadcast(req) {
      return api.broadcastMessage(req);
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

  async function sendNotification(kind, req) {
    const normalizedKind = normalizeKind(kind);
    const sourceModule = String(req?.sourceModule ?? "unknown");
    const reason = String(req?.reason ?? defaultReasonForKind(normalizedKind));
    const relatedEventId = optionalText(req?.relatedEventId);
    const actor = req?.actor ?? req?.viewer ?? null;
    const system = Boolean(req?.system);

    const message = normalizedKind === "broadcast"
      ? sanitizeBroadcastMessage(req?.message)
      : sanitizeWarningMessage(req?.message);

    const targetName = normalizedKind === "warning" ? String(req?.targetName ?? "").trim() : "";
    const targetPlayerId = normalizedKind === "warning"
      ? sanitizeTargetPlayerId(optionalText(req?.targetPlayerId ?? req?.targetPlayerID ?? req?.playerId ?? req?.playerID))
      : undefined;
    const requireTargetPlayerId = normalizedKind === "warning"
      ? Boolean(req?.requireTargetPlayerId)
      : false;
    const targetEosId = normalizedKind === "warning" ? optionalText(req?.targetEosId) : undefined;
    const targetSteamId = normalizedKind === "warning" ? optionalText(req?.targetSteamId) : undefined;
    const commandText = buildCommandText(normalizedKind, {
      targetName,
      targetPlayerId,
      message,
    });

    if (!enabled) {
      memoryStore.push({
        id: makeRecordId("disabled"),
        kind: normalizedKind,
        createdAt: Date.now(),
        sourceModule,
        reason,
        targetName,
        targetPlayerId,
        targetEosId,
        targetSteamId,
        message,
        commandText,
        success: false,
        skipped: true,
        skipReason: "module_disabled",
        relatedEventId,
      });
      return {
        success: false,
        skipped: true,
        skipReason: "module_disabled",
      };
    }

    if (!message || (normalizedKind === "warning" && !targetPlayerId && (!targetName || requireTargetPlayerId))) {
      const skipReason = normalizedKind === "warning" && !targetPlayerId && requireTargetPlayerId
        ? "missing_target_player_id"
        : "invalid_request";
      const record = memoryStore.push({
        id: makeRecordId("invalid"),
        kind: normalizedKind,
        createdAt: Date.now(),
        sourceModule,
        reason: skipReason,
        targetName,
        targetPlayerId,
        targetEosId,
        targetSteamId,
        message,
        commandText,
        success: false,
        skipped: true,
        skipReason,
        relatedEventId,
      });
      return {
        success: false,
        skipped: true,
        skipReason: record.skipReason,
      };
    }

    try {
      const result = await core.rconManager.dispatchCommand({
        command: commandText,
        requestedBy: "module.adminWarn",
        reason,
        sourceEventId: relatedEventId,
        priority: "high",
        actor,
        system,
      });

      if (!result?.success) {
        const errorMessage = String(result?.message ?? "RCON command failed.");
        memoryStore.push({
          id: makeRecordId("failed"),
          kind: normalizedKind,
          createdAt: Date.now(),
          sourceModule,
          reason: `${reason}_failed`,
          targetName,
          targetPlayerId,
          targetEosId,
          targetSteamId,
          message,
          commandText,
          success: false,
          skipped: false,
          errorMessage,
          relatedEventId,
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
        kind: normalizedKind,
        createdAt: Date.now(),
        sourceModule,
        reason,
        targetName,
        targetPlayerId,
        targetEosId,
        targetSteamId,
        message,
        commandText,
        success: true,
        skipped: false,
        relatedEventId,
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
        kind: normalizedKind,
        createdAt: Date.now(),
        sourceModule,
        reason: `${reason}_exception`,
        targetName,
        targetPlayerId,
        targetEosId,
        targetSteamId,
        message,
        commandText,
        success: false,
        skipped: false,
        errorMessage,
        relatedEventId,
      });
      moduleLogger?.warn?.(
        `[BroadcastModule] ${normalizedKind} failed for ${targetName || "server"}: ${errorMessage}`,
      );
      return {
        success: false,
        skipped: false,
        commandText,
        errorMessage,
      };
    }
  }

  return {
    manifest: {
      id: "module.adminWarn",
      name: "广播模块",
      kind: "module",
      version: "0.2.0",
      description: "统一的警告和广播执行模块。支持单人警告、全服广播，并在内存中保留短期记录供页面查看。",
    },
    apiName: "adminWarn",
    api,

    async start() {
      core.webRegistry?.registerPage?.({
        id: "web.adminWarn",
        title: "广播模块",
        group: "管理",
        route: "/admin-warns",
        pageModule: "/pages/admin-warns.js",
        source: "module.adminWarn",
        required: false,
        enabled: true,
        order: 112,
        icon: "W",
      });
      moduleLogger?.info?.(`Broadcast module started. maxRecords=${maxRecords} ttlMs=${ttlMs}`);
    },

    async stop() {
      memoryStore.clear();
      moduleLogger?.info?.("Broadcast module stopped.");
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
      kind: normalizeKind(record?.kind),
    targetName: String(record?.targetName ?? "").trim(),
      targetPlayerId: optionalText(record?.targetPlayerId),
      targetEosId: optionalText(record?.targetEosId),
      targetSteamId: optionalText(record?.targetSteamId),
      commandText: optionalText(record?.commandText),
      skipReason: optionalText(record?.skipReason),
      errorMessage: optionalText(record?.errorMessage),
      relatedEventId: optionalText(record?.relatedEventId),
      sourceModule: String(record?.sourceModule ?? "unknown"),
      reason: String(record?.reason ?? "unknown"),
    });
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
    return this.records[this.records.length - 1];
  }

  query(filter = {}) {
    this.prune(Date.now());
    const limit = clampLimit(filter.limit, 200, this.maxRecords);
    const kind = normalizeKind(filter.kind);
    const targetName = normalizeSearch(filter.targetName);
    const targetPlayerId = normalizeSearch(filter.targetPlayerId);
    const targetEosId = normalizeSearch(filter.targetEosId);
    const sourceModule = normalizeSearch(filter.sourceModule);
    const reason = normalizeSearch(filter.reason);
    const success = normalizeBooleanFilter(filter.success);
    const skipped = normalizeBooleanFilter(filter.skipped);

    return this.records
      .slice()
      .reverse()
      .filter((item) => {
        if (kind && normalizeKind(item.kind) !== kind) return false;
        if (targetName && !normalizeSearch(item.targetName).includes(targetName)) return false;
        if (targetPlayerId && normalizeSearch(item.targetPlayerId) !== targetPlayerId) return false;
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

function buildCommandText(kind, { targetName = "", targetPlayerId = "", message = "" } = {}) {
  if (kind === "broadcast") {
    return `AdminBroadcast ${escapeCommandText(message)}`;
  }
  const id = sanitizeTargetPlayerId(targetPlayerId);
  if (id) {
    return `AdminWarnById ${id} "${escapeCommandText(message)}"`;
  }
  return `AdminWarn "${escapeCommandText(targetName)}" "${escapeCommandText(message)}"`;
}

function sanitizeWarningMessage(message) {
  return String(message ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/"/g, "'")
    .trim()
    .slice(0, 180);
}

function sanitizeBroadcastMessage(message) {
  return String(message ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/"/g, "'")
    .trim()
    .slice(0, 180);
}

function defaultReasonForKind(kind) {
  return kind === "broadcast" ? "manual_broadcast" : "manual_warn";
}

function normalizeKind(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return "";
  if (text === "warn" || text === "warning") return "warning";
  if (text === "broadcast" || text === "announce" || text === "announcement") return "broadcast";
  return text;
}

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function sanitizeTargetPlayerId(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return /^\d+$/.test(text) ? text : "";
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

function escapeCommandText(value) {
  return String(value ?? "")
    .replace(/"/g, "'")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function makeRecordId(prefix) {
  return `adminWarn:${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}
