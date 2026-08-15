// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import path from "node:path";

const DEFAULT_MAX_RECORDS = 3000;
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_DATA_DIRECTORY = "./data/admin-warns";
const DAILY_HISTORY_VERSION = 2;
const REVERSE_READ_CHUNK_BYTES = 64 * 1024;

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
  // ttlMs remains in config/API for backward compatibility. Persistent history is no longer TTL-pruned.
  const ttlMs = Math.max(1000, Number(moduleConfig.ttlMs ?? DEFAULT_TTL_MS));
  const dataDirectory = path.resolve(process.cwd(), String(moduleConfig.dataDirectory ?? DEFAULT_DATA_DIRECTORY));

  const memoryStore = new AdminWarnDailyStore({ maxRecords, ttlMs, dataDirectory, logger: moduleLogger });

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
        dataDirectory,
        persistentHistory: true,
        historyFormat: "jsonl-per-day",
      };
    },

    clear() {
      // Audit history is intentionally permanent. Clearing only drops the hot in-memory cache.
      return memoryStore.clear();
    },
  };

  async function sendNotification(kind, req) {
    const normalizedKind = normalizeKind(kind);
    const sourceModule = String(req?.sourceModule ?? "unknown");
    const reason = String(req?.reason ?? defaultReasonForKind(normalizedKind));
    const targetScope = normalizedKind === "warning" ? normalizeWarningTarget(req?.targetScope ?? req?.target) : "";
    // Selection-based batch warnings deliberately avoid one history line per player.
    const appendRecord = (entry) => req?.record === false ? { ...entry, persisted: false } : memoryStore.push(entry);
    const relatedEventId = optionalText(req?.relatedEventId);
    const actor = req?.actor ?? req?.viewer ?? null;
    const system = Boolean(req?.system);
    const actorRecord = normalizeActorRecord(actor, system);

    const message = normalizedKind === "broadcast"
      ? sanitizeBroadcastMessage(req?.message)
      : sanitizeWarningMessage(req?.message);

    const targetName = normalizedKind === "warning"
      ? (targetScope ? targetScope.toUpperCase() : String(req?.targetName ?? "").trim())
      : "";
    const targetPlayerId = normalizedKind === "warning" && !targetScope
      ? sanitizeTargetPlayerId(optionalText(req?.targetPlayerId ?? req?.targetPlayerID ?? req?.playerId ?? req?.playerID))
      : undefined;
    const requireTargetPlayerId = normalizedKind === "warning" && !targetScope
      ? Boolean(req?.requireTargetPlayerId)
      : false;
    const targetEosId = normalizedKind === "warning" ? optionalText(req?.targetEosId) : undefined;
    const targetSteamId = normalizedKind === "warning" ? optionalText(req?.targetSteamId) : undefined;
    const commandText = buildCommandText(normalizedKind, {
      targetName,
      targetPlayerId,
      targetScope,
      message,
    });

    if (!enabled) {
      appendRecord({
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

    if (!message || (normalizedKind === "warning" && !targetScope && !targetPlayerId && (!targetName || requireTargetPlayerId))) {
      const skipReason = normalizedKind === "warning" && !targetPlayerId && requireTargetPlayerId
        ? "missing_target_player_id"
        : "invalid_request";
      const record = appendRecord({
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
        appendRecord({
          ...actorRecord,
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

      appendRecord({
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
      appendRecord({
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
      version: "0.3.0",
      description: "统一的警告和广播执行模块。记录按天永久追加保存，页面按需读取最近记录，避免启动时加载全部历史。",
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
      moduleLogger?.info?.(
        `Broadcast module started. maxRecords=${maxRecords} persistentHistory=jsonl-per-day dataDirectory=${dataDirectory}`,
      );
    },

    async stop() {
      await memoryStore.flush();
      memoryStore.clear();
      moduleLogger?.info?.("Broadcast module stopped.");
    },
  };
}

class AdminWarnDailyStore {
  constructor({ maxRecords, ttlMs, dataDirectory, logger }) {
    this.maxRecords = maxRecords;
    this.ttlMs = ttlMs;
    this.dataDirectory = dataDirectory;
    this.logger = logger;
    this.records = [];
    this.activeDate = localDateKey(Date.now());
    this.saveChain = Promise.resolve();
    this.migratedDates = new Set();
  }

  async load() {
    this.ensureCurrentDate();
    // Deliberately do not read history here. Startup memory use must stay independent of archive size.
    await fs.mkdir(this.dataDirectory, { recursive: true });
  }

  async flush() {
    await this.saveChain.catch(() => {});
  }

  filePath(dateKey = this.activeDate) {
    return path.join(this.dataDirectory, `${dateKey}.jsonl`);
  }

  legacyFilePath(dateKey = this.activeDate) {
    return path.join(this.dataDirectory, `${dateKey}.json`);
  }

  ensureCurrentDate() {
    const nextDate = localDateKey(Date.now());
    if (nextDate !== this.activeDate) {
      this.activeDate = nextDate;
      this.records = [];
    }
  }

  push(record) {
    this.ensureCurrentDate();
    const normalized = normalizeStoredRecord(record);
    const dateKey = localDateKey(normalized.createdAt ?? Date.now());

    if (dateKey === this.activeDate) {
      this.records.push(normalized);
      this.pruneMemory();
    }

    const line = `${JSON.stringify(normalized)}\n`;
    this.saveChain = this.saveChain
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(this.dataDirectory, { recursive: true });
        await this.migrateLegacyDayIfNeeded(dateKey);
        await fs.appendFile(this.filePath(dateKey), line, "utf8");
      })
      .catch((error) => {
        this.logger?.error?.(`[BroadcastModule] failed to append daily history: ${error?.stack ?? error}`);
      });

    return normalized;
  }

  query(filter = {}) {
    this.ensureCurrentDate();
    const limit = clampLimit(filter.limit, 200, Math.max(this.maxRecords, 1000));
    const dateKey = normalizeDateKey(filter.date) || this.activeDate;
    const predicate = createRecordPredicate(filter);

    // Disk is authoritative. Read backwards in bounded chunks and stop once enough matches are found.
    // This avoids loading the entire daily archive into memory for every page refresh.
    let diskRecords = [];
    try {
      diskRecords = readRecentJsonLinesSync(this.filePath(dateKey), { limit, predicate });
    } catch (error) {
      if (error?.code !== "ENOENT") {
        this.logger?.warn?.(`[BroadcastModule] daily history query failed date=${dateKey}: ${error.message}`);
      }
    }

    // During an in-flight append, the newest record may not be visible on disk yet. Overlay the hot cache.
    if (dateKey === this.activeDate && this.records.length) {
      const seen = new Set(diskRecords.map((item) => item?.id).filter(Boolean));
      const pending = this.records
        .slice()
        .reverse()
        .filter(predicate)
        .filter((item) => !item?.id || !seen.has(item.id));

      if (pending.length) {
        diskRecords = [...pending, ...diskRecords]
          .sort((a, b) => Number(b?.createdAt ?? 0) - Number(a?.createdAt ?? 0))
          .slice(0, limit);
      }
    }

    return diskRecords.map(cloneJsonSafe);
  }

  clear() {
    const cleared = this.records.length;
    this.records.splice(0);
    return {
      ok: true,
      cleared,
      persistentHistoryPreserved: true,
    };
  }

  pruneMemory() {
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
  }

  async migrateLegacyDayIfNeeded(dateKey) {
    if (this.migratedDates.has(dateKey)) return;

    const jsonlPath = this.filePath(dateKey);
    const legacyPath = this.legacyFilePath(dateKey);

    try {
      await fs.access(jsonlPath);
      this.migratedDates.add(dateKey);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    let raw;
    try {
      raw = await fs.readFile(legacyPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        this.migratedDates.add(dateKey);
        return;
      }
      throw error;
    }

    const parsed = JSON.parse(raw);
    const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.records) ? parsed.records : [];
    const tempPath = `${jsonlPath}.migrate-${process.pid}-${Date.now()}.tmp`;
    const payload = records
      .map((item) => JSON.stringify(normalizeStoredRecord(item)))
      .join("\n");

    await fs.writeFile(tempPath, payload ? `${payload}\n` : "", "utf8");
    await fs.rename(tempPath, jsonlPath);
    await fs.unlink(legacyPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    this.migratedDates.add(dateKey);
    this.logger?.info?.(
      `[BroadcastModule] migrated legacy daily history date=${dateKey} records=${records.length} format=v${DAILY_HISTORY_VERSION}`,
    );
  }
}

function normalizeStoredRecord(record) {
  return {
    ...record,
    kind: normalizeKind(record?.kind),
    createdAt: Number(record?.createdAt ?? Date.now()),
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
  };
}

function createRecordPredicate(filter = {}) {
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

  return (item) => {
    if (!item || typeof item !== "object") return false;
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
      const haystack = normalizeSearch([
        item.actorUsername,
        item.sourceModule,
        item.reason,
        item.targetName,
        item.message,
        item.errorMessage,
      ].join(" "));
      if (!haystack.includes(search)) return false;
    }
    return true;
  };
}

function readRecentJsonLinesSync(filePath, { limit, predicate }) {
  let fd;
  try {
    fd = openSync(filePath, "r");
    const size = statSync(filePath).size;
    let position = size;
    let carry = Buffer.alloc(0);
    const results = [];

    while (position > 0 && results.length < limit) {
      const readSize = Math.min(REVERSE_READ_CHUNK_BYTES, position);
      position -= readSize;

      const chunk = Buffer.allocUnsafe(readSize);
      const bytesRead = readSync(fd, chunk, 0, readSize, position);
      const currentChunk = bytesRead === readSize ? chunk : chunk.subarray(0, bytesRead);
      const combined = carry.length ? Buffer.concat([currentChunk, carry]) : currentChunk;

      let lineEnd = combined.length;
      for (let index = combined.length - 1; index >= 0 && results.length < limit; index -= 1) {
        if (combined[index] !== 0x0a) continue;
        const lineBuffer = combined.subarray(index + 1, lineEnd);
        lineEnd = index;
        maybeCollectJsonLine(lineBuffer, predicate, results, limit);
      }

      carry = Buffer.from(combined.subarray(0, lineEnd));
    }

    if (position === 0 && results.length < limit && carry.length) {
      maybeCollectJsonLine(carry, predicate, results, limit);
    }

    return results;
  } finally {
    if (fd != null) closeSync(fd);
  }
}

function maybeCollectJsonLine(lineBuffer, predicate, results, limit) {
  if (!lineBuffer?.length || results.length >= limit) return;
  const text = lineBuffer.toString("utf8").trim();
  if (!text) return;
  try {
    const parsed = JSON.parse(text);
    if (predicate(parsed)) results.push(parsed);
  } catch {
    // Ignore only the malformed/partial line. Append-only files keep all previous lines intact.
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

function normalizeDateKey(value) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function buildCommandText(kind, { targetName = "", targetPlayerId = "", targetScope = "", message = "" } = {}) {
  if (kind === "broadcast") {
    return `AdminBroadcast ${escapeCommandText(message)}`;
  }
  const scope = normalizeWarningTarget(targetScope);
  if (scope) {
    return `AdminWarn ${scope} "${escapeCommandText(message)}"`;
  }
  const id = sanitizeTargetPlayerId(targetPlayerId);
  if (id) {
    return `AdminWarnById ${id} "${escapeCommandText(message)}"`;
  }
  return `AdminWarn "${escapeCommandText(targetName)}" "${escapeCommandText(message)}"`;
}

function normalizeWarningTarget(value) {
  const target = String(value ?? "").trim().toLowerCase();
  return target === "all" || target === "team1" || target === "team2" ? target : "";
}

function sanitizeWarningMessage(message) {
  return String(message ?? "")
    // 保留真实换行；转成转义文本会被游戏当作普通字符显示。
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
