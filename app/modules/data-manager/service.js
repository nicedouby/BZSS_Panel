// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const ACTIVE_FILE_GUARD_MS = 2 * 60 * 1000;
const ACTIVE_FILE_WINDOW_MS = 5 * 60 * 1000;
const MAX_SCANNED_FILES = 250_000;
const MAX_CLEANUP_TARGETS = 32;
const MAX_REPORTED_ERRORS = 20;

const LOGPOST_RUNTIME_DIRECTORIES = Object.freeze([
  "archive",
  "dead-letter",
  "events",
  "logs",
  "output",
  "raw",
  "raw-archive",
]);

const POLICY_RULES = Object.freeze([
  { prefix: "data/replay-spool", label: "战术回放", kind: "回放", risk: "low", cleanable: true },
  { prefix: "data/match-end-snapshots", label: "对局结束快照", kind: "快照", risk: "medium", cleanable: true },
  { prefix: "data/match-end-snapshot-debug", label: "快照调试文件", kind: "调试", risk: "low", cleanable: true },
  { prefix: "data/match-snapshots", label: "对局快照", kind: "快照", risk: "medium", cleanable: true },
  { prefix: "data/combat-events", label: "战斗事件归档", kind: "历史", risk: "medium", cleanable: true },
  { prefix: "data/kill-records", label: "击杀记录归档", kind: "历史", risk: "medium", cleanable: true },
  { prefix: "data/combat-logs", label: "战斗日志", kind: "日志", risk: "medium", cleanable: true },
  { prefix: "data/server-stats", label: "服务器统计历史", kind: "统计", risk: "medium", cleanable: true },
  { prefix: "data/match-cache", label: "对局缓存", kind: "缓存", risk: "low", cleanable: true },
  { prefix: "data/tasks", label: "任务历史", kind: "缓存", risk: "low", cleanable: true },
  { prefix: "data/player-session-records", label: "玩家进出服历史", kind: "历史", risk: "medium", cleanable: true },
  { prefix: "data/admin-warns", label: "管理员警告历史", kind: "历史", risk: "medium", cleanable: true },
  { prefix: "data/chat", label: "聊天历史", kind: "历史", risk: "medium", cleanable: true },
  { prefix: "data/logpost-packet-stats.jsonl", label: "LogPost 丢包统计", kind: "统计", risk: "low", cleanable: true },
  { prefix: "logs", label: "面板运行日志", kind: "日志", risk: "low", cleanable: true },
  { prefix: "LogPost/", label: "LogPost 运行数据", kind: "日志", risk: "medium", cleanable: true },
]);

const PROTECTED_LABELS = Object.freeze({
  "data/micepanel.db": "玩家与面板主数据库",
  "data/micepanel.db-shm": "主数据库共享内存",
  "data/micepanel.db-wal": "主数据库预写日志",
  "data/reserve-exchange": "预留位兑换数据库",
  "data/reserve-slots": "预留位数据",
  "data/auth": "管理员账号数据",
  "data/bzss-core": "BZSS Core 状态",
  "data/logpost-consumer": "LogPost 消费检查点",
  "data/plugins/panel-ban": "面板封禁数据",
  "data/plugins/network-block": "网络阻断数据",
});

export class DataManagerService {
  constructor({ rootDirectory = process.cwd(), logger = null } = {}) {
    this.rootDirectory = path.resolve(rootDirectory);
    this.logger = logger;
    this.cleanupInProgress = false;
  }

  async getOverview() {
    const targets = await this.discoverTargets();
    const categories = await mapWithConcurrency(targets, 4, async (target) => {
      try {
        return await this.scanTarget(target);
      } catch (error) {
        return {
          ...publicTarget(target),
          bytes: 0,
          fileCount: 0,
          directoryCount: 0,
          activeFileCount: 0,
          oldestModifiedAt: null,
          newestModifiedAt: null,
          partial: true,
          error: error?.message ?? String(error),
        };
      }
    });

    categories.sort((left, right) => right.bytes - left.bytes || left.relativePath.localeCompare(right.relativePath));
    const summary = categories.reduce((result, category) => {
      result.totalBytes += category.bytes;
      result.fileCount += category.fileCount;
      if (category.cleanable) result.cleanableBytes += category.bytes;
      if (category.partial) result.partialCategoryCount += 1;
      return result;
    }, {
      totalBytes: 0,
      cleanableBytes: 0,
      fileCount: 0,
      categoryCount: categories.length,
      partialCategoryCount: 0,
    });

    return {
      ok: true,
      scannedAt: new Date().toISOString(),
      cleanupInProgress: this.cleanupInProgress,
      summary,
      categories,
    };
  }

  async cleanup({ ids, olderThanDays = null } = {}) {
    if (this.cleanupInProgress) {
      const error = new Error("Another data cleanup is already running.");
      error.code = "DataCleanupInProgress";
      error.statusCode = 409;
      throw error;
    }

    const requestedIds = [...new Set((Array.isArray(ids) ? ids : []).map((item) => String(item ?? "").trim()).filter(Boolean))];
    if (!requestedIds.length || requestedIds.length > MAX_CLEANUP_TARGETS) {
      const error = new Error(`Select between 1 and ${MAX_CLEANUP_TARGETS} data categories.`);
      error.code = "InvalidDataCleanupSelection";
      error.statusCode = 400;
      throw error;
    }

    const retentionDays = normalizeRetentionDays(olderThanDays);
    const targets = await this.discoverTargets();
    const byId = new Map(targets.map((target) => [target.id, target]));
    const selected = requestedIds.map((id) => byId.get(id)).filter(Boolean);
    const missing = requestedIds.filter((id) => !byId.has(id));
    const blocked = selected.filter((target) => !target.cleanable);
    if (missing.length || blocked.length) {
      const error = new Error("The cleanup selection contains missing or protected data categories.");
      error.code = "ProtectedDataCategory";
      error.statusCode = 409;
      error.details = {
        missing,
        blocked: blocked.map((target) => target.id),
      };
      throw error;
    }

    this.cleanupInProgress = true;
    try {
      const startedAt = Date.now();
      const results = [];
      for (const target of selected) {
        results.push(await this.cleanupTarget(target, { retentionDays, startedAt }));
      }
      const totals = results.reduce((result, item) => {
        result.deletedBytes += item.deletedBytes;
        result.deletedFiles += item.deletedFiles;
        result.deletedDirectories += item.deletedDirectories;
        result.skippedActiveFiles += item.skippedActiveFiles;
        result.skippedRecentFiles += item.skippedRecentFiles;
        result.failedFiles += item.failedFiles;
        return result;
      }, {
        deletedBytes: 0,
        deletedFiles: 0,
        deletedDirectories: 0,
        skippedActiveFiles: 0,
        skippedRecentFiles: 0,
        failedFiles: 0,
      });

      return {
        ok: totals.failedFiles === 0,
        startedAt: new Date(startedAt).toISOString(),
        completedAt: new Date().toISOString(),
        olderThanDays: retentionDays,
        ...totals,
        results,
      };
    } finally {
      this.cleanupInProgress = false;
    }
  }

  async discoverTargets() {
    const targets = [];
    await this.addDataTargets(targets);
    await this.addSingleTarget(targets, "logs");
    for (const directory of LOGPOST_RUNTIME_DIRECTORIES) {
      await this.addSingleTarget(targets, path.posix.join("LogPost", directory));
    }
    return targets;
  }

  async addDataTargets(targets) {
    const dataDirectory = this.resolveRelativePath("data");
    const entries = await safeReadDir(dataDirectory);
    for (const entry of entries) {
      const relativePath = path.posix.join("data", entry.name);
      if (entry.isDirectory() && entry.name === "plugins") {
        const pluginEntries = await safeReadDir(this.resolveRelativePath(relativePath));
        for (const pluginEntry of pluginEntries) {
          await this.addSingleTarget(targets, path.posix.join(relativePath, pluginEntry.name));
        }
        continue;
      }
      await this.addSingleTarget(targets, relativePath);
    }
  }

  async addSingleTarget(targets, relativePath) {
    const normalized = normalizeRelativePath(relativePath);
    const absolutePath = this.resolveRelativePath(normalized);
    const stats = await fs.lstat(absolutePath).catch(() => null);
    if (!stats) return;
    const policy = classifyTarget(normalized);
    targets.push({
      id: makeTargetId(normalized),
      relativePath: normalized,
      absolutePath,
      label: policy.label,
      kind: policy.kind,
      risk: policy.risk,
      cleanable: policy.cleanable && !stats.isSymbolicLink(),
      protectedReason: policy.cleanable
        ? (stats.isSymbolicLink() ? "符号链接不会由面板清理。" : "")
        : "这是业务或核心状态数据，运行期间禁止直接删除。",
    });
  }

  resolveRelativePath(relativePath) {
    const resolved = path.resolve(this.rootDirectory, normalizeRelativePath(relativePath));
    const relative = path.relative(this.rootDirectory, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      if (resolved === this.rootDirectory) {
        const error = new Error("The panel root cannot be used as a data target.");
        error.code = "UnsafeDataPath";
        throw error;
      }
      const error = new Error("Data path escaped the panel root.");
      error.code = "UnsafeDataPath";
      throw error;
    }
    return resolved;
  }

  async scanTarget(target) {
    const aggregate = {
      bytes: 0,
      fileCount: 0,
      directoryCount: 0,
      activeFileCount: 0,
      oldestModifiedMs: null,
      newestModifiedMs: null,
      partial: false,
    };
    const stack = [target.absolutePath];
    const now = Date.now();

    while (stack.length) {
      const current = stack.pop();
      const stats = await fs.lstat(current).catch(() => null);
      if (!stats) continue;
      if (stats.isSymbolicLink()) continue;
      if (stats.isDirectory()) {
        aggregate.directoryCount += 1;
        const entries = await safeReadDir(current);
        for (const entry of entries) stack.push(path.join(current, entry.name));
        continue;
      }

      aggregate.bytes += Number(stats.size ?? 0);
      aggregate.fileCount += 1;
      aggregate.oldestModifiedMs = aggregate.oldestModifiedMs == null
        ? stats.mtimeMs
        : Math.min(aggregate.oldestModifiedMs, stats.mtimeMs);
      aggregate.newestModifiedMs = aggregate.newestModifiedMs == null
        ? stats.mtimeMs
        : Math.max(aggregate.newestModifiedMs, stats.mtimeMs);
      if (isActiveFile(current, stats.mtimeMs, now)) aggregate.activeFileCount += 1;
      if (aggregate.fileCount >= MAX_SCANNED_FILES) {
        aggregate.partial = true;
        break;
      }
    }

    return {
      ...publicTarget(target),
      bytes: aggregate.bytes,
      fileCount: aggregate.fileCount,
      directoryCount: aggregate.directoryCount,
      activeFileCount: aggregate.activeFileCount,
      oldestModifiedAt: toIsoOrNull(aggregate.oldestModifiedMs),
      newestModifiedAt: toIsoOrNull(aggregate.newestModifiedMs),
      partial: aggregate.partial,
      error: "",
    };
  }

  async cleanupTarget(target, { retentionDays, startedAt }) {
    const result = {
      id: target.id,
      relativePath: target.relativePath,
      deletedBytes: 0,
      deletedFiles: 0,
      deletedDirectories: 0,
      skippedActiveFiles: 0,
      skippedRecentFiles: 0,
      failedFiles: 0,
      errors: [],
    };
    const retentionCutoff = retentionDays == null ? Number.POSITIVE_INFINITY : startedAt - retentionDays * 24 * 60 * 60 * 1000;
    const activeCutoff = startedAt - ACTIVE_FILE_GUARD_MS;
    await removeEligible(target.absolutePath, {
      rootPath: target.absolutePath,
      retentionCutoff,
      activeCutoff,
      result,
    });
    this.logger?.info?.(`[DataManager] cleaned ${target.relativePath}`, {
      operation: "dataCleanup",
      data: {
        deletedFiles: result.deletedFiles,
        deletedBytes: result.deletedBytes,
        skippedActiveFiles: result.skippedActiveFiles,
        skippedRecentFiles: result.skippedRecentFiles,
        failedFiles: result.failedFiles,
      },
    });
    return result;
  }
}

async function removeEligible(currentPath, context) {
  const stats = await fs.lstat(currentPath).catch(() => null);
  if (!stats) return;
  if (stats.isSymbolicLink()) {
    context.result.skippedActiveFiles += 1;
    return;
  }
  if (stats.isDirectory()) {
    if (currentPath !== context.rootPath && isOpenRuntimePath(currentPath)) {
      context.result.skippedActiveFiles += 1;
      return;
    }
    const entries = await safeReadDir(currentPath);
    for (const entry of entries) {
      await removeEligible(path.join(currentPath, entry.name), context);
    }
    if (currentPath !== context.rootPath) {
      try {
        await fs.rmdir(currentPath);
        context.result.deletedDirectories += 1;
      } catch (error) {
        if (!["ENOTEMPTY", "ENOENT", "EEXIST"].includes(error?.code)) rememberCleanupError(context.result, currentPath, error);
      }
    }
    return;
  }

  if (isOpenRuntimePath(currentPath) || stats.mtimeMs > context.activeCutoff) {
    context.result.skippedActiveFiles += 1;
    return;
  }
  if (stats.mtimeMs > context.retentionCutoff) {
    context.result.skippedRecentFiles += 1;
    return;
  }

  try {
    await fs.unlink(currentPath);
    context.result.deletedFiles += 1;
    context.result.deletedBytes += Number(stats.size ?? 0);
  } catch (error) {
    rememberCleanupError(context.result, currentPath, error);
  }
}

function classifyTarget(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const protectedLabel = Object.entries(PROTECTED_LABELS)
    .find(([prefix]) => normalized === prefix || normalized.startsWith(`${prefix}/`))?.[1];
  if (protectedLabel) return { label: protectedLabel, kind: "核心数据", risk: "protected", cleanable: false };

  const policy = POLICY_RULES.find((candidate) => candidate.prefix.endsWith("/")
    ? normalized.startsWith(candidate.prefix)
    : normalized === candidate.prefix || normalized.startsWith(`${candidate.prefix}/`));
  if (policy) {
    const suffix = policy.prefix === "LogPost/" ? normalized.slice(policy.prefix.length) : "";
    return { ...policy, label: suffix ? `${policy.label} · ${humanizeName(suffix)}` : policy.label };
  }

  return {
    label: humanizeName(normalized.split("/").pop()),
    kind: "业务数据",
    risk: "protected",
    cleanable: false,
  };
}

function publicTarget(target) {
  return {
    id: target.id,
    label: target.label,
    relativePath: target.relativePath,
    kind: target.kind,
    risk: target.risk,
    cleanable: target.cleanable,
    protectedReason: target.protectedReason,
  };
}

function normalizeRelativePath(value) {
  return String(value ?? "")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
}

function makeTargetId(relativePath) {
  return Buffer.from(normalizeRelativePath(relativePath), "utf8").toString("base64url");
}

function humanizeName(value) {
  return String(value ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeRetentionDays(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1 || number > 3650) {
    const error = new Error("olderThanDays must be between 1 and 3650, or null for all historical files.");
    error.code = "InvalidRetentionDays";
    error.statusCode = 400;
    throw error;
  }
  return Math.floor(number);
}

function isActiveFile(filePath, modifiedMs, now) {
  return isOpenRuntimePath(filePath) || now - modifiedMs < ACTIVE_FILE_WINDOW_MS;
}

function isOpenRuntimePath(filePath) {
  return String(filePath).split(/[\\/]/).some((segment) => segment.endsWith(".open"))
    || /(?:^|[\\/])writer\.lock$/i.test(filePath)
    || /\.open\.[^\\/]+$/i.test(filePath);
}

function rememberCleanupError(result, filePath, error) {
  result.failedFiles += 1;
  if (result.errors.length >= MAX_REPORTED_ERRORS) return;
  result.errors.push({ path: filePath, code: error?.code ?? "CleanupFailed", message: error?.message ?? String(error) });
}

function toIsoOrNull(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

async function safeReadDir(directory) {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return [];
    throw error;
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
