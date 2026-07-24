// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAX_RECORDS = 3000;
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_DATA_DIRECTORY = "./data/admin-warns";

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
  const dataDirectory = path.resolve(process.cwd(), String(moduleConfig.dataDirectory ?? DEFAULT_DATA_DIRECTORY));

  const memoryStore = new AdminWarnMemoryStore({ maxRecords, ttlMs, dataDirectory, logger: moduleLogger });

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
    const actorRecord = normalizeActorRecord(actor, system);

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
        ...actorRecord,
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
        ...actorRecord,
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
        ...actorRecord,
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
        ...actorRecord,
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

    async init() {
      await memoryStore.load();
    },

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
      await memoryStore.flush();
      memoryStore.clear({ persist: false });
      moduleLogger?.info?.("Broadcast module stopped.");
    },
  };
}

class AdminWarnMemoryStore {
  constructor({ maxRecords, ttlMs, dataDirectory, logger }) {
    this.maxRecords = maxRecords;
    this.ttlMs = ttlMs;
    this.dataDirectory = dataDirectory;
    this.logger = logger;
    this.records = [];
    this.activeDate = localDateKey(Date.now());
    this.saveChain = Promise.resolve();
  }

  async load() {
    this.ensureCurrentDate();
    try {
      const raw = await fs.readFile(this.filePath(), "utf8");
      const parsed = JSON.parse(raw);
      const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.records) ? parsed.records : [];
      this.records = records.slice(-this.maxRecords).map(cloneJsonSafe);
    } catch (error) {
      if (error?.code !== "ENOENT") this.logger?.warn?.("[BroadcastModule] daily history load failed: " + error.message);
      this.records = [];
    }
  }

  async flush() {
    await this.saveChain.catch(() => {});
  }

  filePath() {
    return path.join(this.dataDirectory, this.activeDate + ".json");
  }

  ensureCurrentDate() {
    const nextDate = localDateKey(Date.now());
    if (nextDate !== this.activeDate) {
      this.activeDate = nextDate;
      this.records = [];
    }
  }

  persist() {
    const payload = JSON.stringify({ version: 1, date: this.activeDate, records: this.records }, null, 2);
    this.saveChain = this.saveChain.catch(() => {}).then(async () => {
      await fs.mkdir(this.dataDirectory, { recursive: true });
      const target = this.filePath();
      const temp = target + ".tmp";
      await fs.writeFile(temp, payload, "utf8");
      await fs.rename(temp, target).catch(async (error) => {
        if (error?.code === "ENOENT") {
          await fs.mkdir(this.dataDirectory, { recursive: true });
          await fs.rename(temp, target);
          return;
        }
        throw error;
      });
    });
  }

  push(record) {
    this.ensureCurrentDate();
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
      actorUsername: String(record?.actorUsername ?? "").trim(),
      actorUserId: optionalText(record?.actorUserId),
      actorRole: optionalText(record?.actorRole),
      system: Boolean(record?.system),
    });
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
    this.persist();
    return this.records[this.records.length - 1];
  }

  query(filter = {}) {
    this.ensureCurrentDate();
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
    const search = normalizeSearch(filter.search);
    const actorUsername = normalizeSearch(filter.actorUsername);

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
        if (actorUsername && !normalizeSearch(item.actorUsername).includes(actorUsername)) return false;
        if (search) {
          const haystack = normalizeSearch([item.actorUsername, item.sourceModule, item.reason, item.targetName, item.message, item.errorMessage].join(" "));
          if (!haystack.includes(search)) return false;
        }
        return true;
      })
      .slice(0, limit)
      .map(cloneJsonSafe);
  }

  clear({ persist = true } = {}) {
    const cleared = this.records.length;
    this.records.splice(0);
    if (persist) this.persist();
    return { ok: true, cleared };
  }

  prune(now) {
    this.ensureCurrentDate();
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
  }
}

function normalizeActorRecord(actor, system) {
  return {
    actorUsername: String(actor?.username ?? actor?.name ?? actor?.displayName ?? (system ? "system" : "")).trim(),
    actorUserId: actor?.id ?? actor?.userId ?? actor?.username ?? "",
    actorRole: actor?.role ?? "",
    system: Boolean(system),
  };
}

function localDateKey(value) {
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
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
