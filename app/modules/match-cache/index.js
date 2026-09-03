// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

export function createMatchCacheModule({ core, config, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.matchCache",
    source: "module.matchCache",
    channel: "module",
  }) ?? core.logger;
  const moduleConfig = config.get("modules.matchCache", {});
  const enabled = Boolean(moduleConfig.enabled ?? true);
  const directory = path.resolve(
    process.cwd(),
    String(moduleConfig.directory ?? "./data/match-cache").trim() || "./data/match-cache",
  );
  const writeDebounceMs = normalizePositiveNumber(moduleConfig.writeDebounceMs, 1500);
  const forceFlushIntervalMs = normalizePositiveNumber(moduleConfig.forceFlushIntervalMs, 10_000);
  const maxRestoreAgeMs = normalizePositiveNumber(moduleConfig.maxRestoreAgeMs, 6 * 60 * 60 * 1000);
  const archiveEndedMatches = moduleConfig.archiveEndedMatches !== false;
  const maxArchivedMatches = normalizePositiveNumber(moduleConfig.maxArchivedMatches, 20);

  const servers = new Map();
  const providers = new Map();
  const unsubscribers = [];
  const writeState = {
    activeWrite: null,
    writeRequestedAgain: false,
  };

  let started = false;
  let forceFlushTimer = null;

  function getServerId() {
    return normalizeText(core.webStatus?.serverId ?? core.webStatus?.state?.serverId ?? "unknown") || "unknown";
  }

  function ensureServerState(serverId = getServerId()) {
    const key = normalizeText(serverId || getServerId());
    if (!servers.has(key)) {
      servers.set(key, {
        serverId: key,
        filePath: getCurrentFilePath(key),
        loaded: false,
        cachedMatch: null,
        currentMatch: null,
        namespaces: new Map(),
        dirty: false,
        savedAt: "",
        restoredAt: "",
        lastReason: "",
        lastError: "",
      });
    }
    return servers.get(key);
  }

  function getCurrentFilePath(serverId = getServerId()) {
    return path.resolve(directory, `${safeServerId(serverId)}.current.json`);
  }

  function getArchiveDir(serverId = getServerId()) {
    return path.resolve(directory, "archive", safeServerId(serverId));
  }

  function safeServerId(serverId) {
    return normalizeText(serverId || "unknown")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      || "unknown";
  }

  function clone(value) {
    if (value == null) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }

  function normalizeStatusMatch(match = null) {
    if (!match || typeof match !== "object") return null;
    const normalized = {
      matchId: normalizeText(match.matchId ?? ""),
      fingerprint: normalizeText(match.fingerprint ?? ""),
      baseKey: normalizeText(match.baseKey ?? ""),
      fullKey: normalizeText(match.fullKey ?? ""),
      map: normalizeText(match.map ?? ""),
      layer: normalizeText(match.layer ?? ""),
      mode: normalizeText(match.mode ?? ""),
      team1Name: normalizeText(match.team1Name ?? ""),
      team2Name: normalizeText(match.team2Name ?? ""),
      savedAt: normalizeText(match.savedAt ?? ""),
      closedAt: normalizeText(match.closedAt ?? ""),
      lastObservedPlaytimeSeconds: toFiniteNumber(match.lastObservedPlaytimeSeconds),
      roundAnchor: {
        worldPath: normalizeText(match.roundAnchor?.worldPath ?? ""),
        serverPlayAt: normalizeText(match.roundAnchor?.serverPlayAt ?? ""),
        logLineTime: normalizeText(match.roundAnchor?.logLineTime ?? ""),
      },
    };

    if (!normalized.matchId) {
      return null;
    }

    normalized.fingerprint = normalized.fingerprint || normalized.fullKey || normalized.baseKey;
    return normalized;
  }

  function getProviderNames() {
    return [...providers.keys()];
  }

  async function ensureLoaded(serverId = getServerId()) {
    const state = ensureServerState(serverId);
    if (state.loaded) return state;

    state.loaded = true;
    try {
      const text = await fs.readFile(state.filePath, "utf8");
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") return state;

      if (Number(parsed.version ?? 0) !== 1) {
        throw new Error(`Unsupported cache version: ${String(parsed.version ?? "")}`);
      }

      if (normalizeText(parsed.serverId ?? "") && normalizeText(parsed.serverId ?? "") !== state.serverId) {
        throw new Error(`Cache server mismatch: ${String(parsed.serverId ?? "")}`);
      }

      state.cachedMatch = normalizeStatusMatch(parsed.match ?? null);
      state.currentMatch = state.cachedMatch ? clone(state.cachedMatch) : null;
      state.savedAt = normalizeText(parsed.savedAt ?? "");
      state.namespaces.clear();

      const namespaces = parsed.namespaces && typeof parsed.namespaces === "object"
        ? parsed.namespaces
        : {};
      for (const [namespaceId, namespaceState] of Object.entries(namespaces)) {
        state.namespaces.set(namespaceId, clone(namespaceState));
      }

      logWithFallback(moduleLogger, "info", "[MatchCache] cache loaded", {
        operation: "matchCache.loaded",
        data: {
          serverId: state.serverId,
          filePath: state.filePath,
          namespaces: [...state.namespaces.keys()],
        },
      });
    } catch (error) {
      if (error?.code === "ENOENT") return state;

      const text = String(error?.message ?? error);
      logWithFallback(moduleLogger, "warn", "[MatchCache] cache read failed", {
        operation: "matchCache.readFailed",
        data: {
          serverId: state.serverId,
          filePath: state.filePath,
          message: text,
        },
      });

      try {
        const corruptPath = `${state.filePath}.corrupt.${Date.now()}.json`;
        await fs.rename(state.filePath, corruptPath);
      } catch {
        // Best effort only.
      }
    }

    return state;
  }

  function getNamespace(namespaceId, serverId = getServerId()) {
    const state = ensureServerState(serverId);
    return clone(state.namespaces.get(namespaceId) ?? null);
  }

  function getStatus(serverId = getServerId()) {
    const state = ensureServerState(serverId);
    return {
      enabled,
      started,
      serverId: state.serverId,
      filePath: state.filePath,
      loaded: state.loaded,
      dirty: state.dirty,
      savedAt: state.savedAt,
      restoredAt: state.restoredAt,
      currentMatch: clone(state.currentMatch),
      cachedMatch: clone(state.cachedMatch),
      maxRestoreAgeMs,
      writeDebounceMs,
      forceFlushIntervalMs,
      archiveEndedMatches,
      maxArchivedMatches,
      providerIds: getProviderNames(),
    };
  }

  function getMatchIdentity(serverId = getServerId()) {
    return getStatus(serverId).currentMatch;
  }

  function compareCachedMatch(cachedMatch, serverId = getServerId()) {
    const state = ensureServerState(serverId);
    const currentMatch = state.currentMatch;
    if (!currentMatch || !cachedMatch) {
      return {
        status: "pending",
        reason: "match_identity_unavailable",
        currentMatch: clone(currentMatch),
        cachedMatch: clone(cachedMatch ?? null),
      };
    }

    const cached = normalizeStatusMatch(cachedMatch);
    const current = normalizeStatusMatch(currentMatch);
    if (!cached || !current) {
      return {
        status: "pending",
        reason: "match_identity_unavailable",
        currentMatch: clone(current),
        cachedMatch: clone(cached),
      };
    }

    if (current.serverId && cached.serverId && current.serverId !== cached.serverId) {
      return {
        status: "different",
        reason: "server_id_mismatch",
        currentMatch: clone(current),
        cachedMatch: clone(cached),
      };
    }

    const anchorStatus = compareRoundAnchor(current.roundAnchor, cached.roundAnchor);
    if (anchorStatus === "different") {
      return {
        status: "different",
        reason: "round_anchor_mismatch",
        currentMatch: clone(current),
        cachedMatch: clone(cached),
      };
    }

    const currentFullKey = normalizeText(current.fullKey ?? "");
    const cachedFullKey = normalizeText(cached.fullKey ?? "");
    const currentBaseKey = normalizeText(current.baseKey ?? "");
    const cachedBaseKey = normalizeText(cached.baseKey ?? "");
    const currentPlaytime = toFiniteNumber(current.lastObservedPlaytimeSeconds);
    const cachedPlaytime = toFiniteNumber(cached.lastObservedPlaytimeSeconds);

    if (currentFullKey && cachedFullKey) {
      if (currentFullKey !== cachedFullKey) {
        return {
          status: "different",
          reason: "fingerprint_mismatch",
          currentMatch: clone(current),
          cachedMatch: clone(cached),
        };
      }
    } else if (currentBaseKey && cachedBaseKey && currentBaseKey !== cachedBaseKey) {
      return {
        status: "different",
        reason: "fingerprint_mismatch",
        currentMatch: clone(current),
        cachedMatch: clone(cached),
      };
    }

    if (Number.isFinite(currentPlaytime) && Number.isFinite(cachedPlaytime) && currentPlaytime + 60 < cachedPlaytime) {
      return {
        status: "different",
        reason: "playtime_rollback",
        currentMatch: clone(current),
        cachedMatch: clone(cached),
      };
    }

    if (state.savedAt) {
      const savedAtMs = Date.parse(state.savedAt);
      const nowMs = Date.now();
      if (Number.isFinite(savedAtMs) && nowMs - savedAtMs > maxRestoreAgeMs) {
        return {
          status: "ambiguous",
          reason: "cache_too_old",
          currentMatch: clone(current),
          cachedMatch: clone(cached),
        };
      }
    }

    return {
      status: "same",
      reason: "fingerprint_and_playtime_match",
      currentMatch: clone(current),
      cachedMatch: clone(cached),
    };
  }

  function registerProvider(provider) {
    if (!provider || typeof provider.id !== "string" || !provider.id.trim()) {
      throw new Error("MatchCache provider id is required.");
    }
    const id = provider.id.trim();
    providers.set(id, {
      ...provider,
      id,
      version: Number(provider.version ?? 1) || 1,
    });

    for (const serverState of servers.values()) {
      const namespaceState = serverState.namespaces.get(id);
      if (namespaceState == null) continue;
      if (typeof provider.importState === "function") {
        provider.importState(clone(namespaceState), makeProviderContext(serverState.serverId, "registerProvider"));
      }
    }
  }

  function markDirty(namespaceId = "unknown", serverId = getServerId()) {
    const state = ensureServerState(serverId);
    state.dirty = true;
    state.lastReason = namespaceId;
    scheduleFlush();
  }

  function setCurrentMatch(matchIdentity, serverId = getServerId()) {
    const state = ensureServerState(serverId);
    const normalized = normalizeStatusMatch(matchIdentity);
    if (!normalized) return null;
    state.currentMatch = normalized;
    state.serverId = normalizeText(serverId || state.serverId || getServerId());
    state.filePath = getCurrentFilePath(state.serverId);
    state.dirty = true;
    state.lastReason = "setCurrentMatch";
    scheduleFlush();
    return clone(normalized);
  }

  async function restoreCurrentMatch(matchIdentity, serverId = getServerId()) {
    const state = ensureServerState(serverId);
    const normalized = normalizeStatusMatch(matchIdentity ?? state.cachedMatch);
    if (!normalized) return null;

    state.currentMatch = normalized;
    state.restoredAt = new Date().toISOString();

    for (const provider of providers.values()) {
      const namespaceState = state.namespaces.get(provider.id);
      if (typeof provider.importState !== "function") continue;
      provider.importState(clone(namespaceState ?? null), makeProviderContext(state.serverId, "restoreCurrentMatch", normalized, {
        restoredAt: state.restoredAt,
        savedAt: normalized.savedAt || state.savedAt,
      }));
    }

    core.eventBus.emitModuleEvent("module.matchCache", "restored", makeEvent("module.matchCache.restored", {
      serverId: state.serverId,
      match: clone(normalized),
      namespaces: Object.fromEntries([...state.namespaces.entries()].map(([key, value]) => [key, clone(value)])),
    }));

    state.dirty = true;
    state.lastReason = "restoreCurrentMatch";
    scheduleFlush();
    return clone(normalized);
  }

  async function rejectCurrentMatch(reason = "rejected", serverId = getServerId()) {
    const state = ensureServerState(serverId);
    core.eventBus.emitModuleEvent("module.matchCache", "rejected", makeEvent("module.matchCache.rejected", {
      serverId: state.serverId,
      reason,
      match: clone(state.currentMatch),
    }));
    return clearCurrentMatch(reason, serverId);
  }

  async function clearCurrentMatch(reason = "reset", serverId = getServerId()) {
    const state = ensureServerState(serverId);
    const previousMatch = clone(state.currentMatch);
    state.currentMatch = null;
    state.cachedMatch = null;
    state.restoredAt = "";
    state.dirty = true;
    state.lastReason = reason;

    for (const provider of providers.values()) {
      if (typeof provider.resetState !== "function") continue;
      provider.resetState(makeProviderContext(state.serverId, "clearCurrentMatch", previousMatch, { reason }));
    }

    core.eventBus.emitModuleEvent("module.matchCache", "reset", makeEvent("module.matchCache.reset", {
      serverId: state.serverId,
      reason,
      match: previousMatch,
    }));
    core.eventBus.emitModuleEvent("module.matchCache", "matchReset", makeEvent("module.matchCache.matchReset", {
      serverId: state.serverId,
      reason,
      match: previousMatch,
    }));

    scheduleFlush();
    return null;
  }

  function exportNamespaces(serverId = getServerId()) {
    const state = ensureServerState(serverId);
    const namespaces = {};
    for (const provider of providers.values()) {
      if (typeof provider.exportState !== "function") continue;
      const exported = provider.exportState(makeProviderContext(state.serverId, "exportState", state.currentMatch, {
        savedAt: new Date().toISOString(),
      }));
      if (exported == null) continue;
      namespaces[provider.id] = clone(exported);
      state.namespaces.set(provider.id, clone(exported));
    }
    return namespaces;
  }

  async function flush(serverId = getServerId(), options = {}) {
    if (!enabled) return null;
    const force = options?.force === true;
    const state = ensureServerState(serverId);
    await ensureLoaded(serverId);

    if (writeState.activeWrite && !force) {
      writeState.writeRequestedAgain = true;
      return writeState.activeWrite;
    }

    const writePromise = (async () => {
      try {
        await fs.mkdir(directory, { recursive: true });

        const namespaces = exportNamespaces(serverId);
        const currentMatch = state.currentMatch ?? state.cachedMatch;
        const payload = {
          version: 1,
          serverId: state.serverId,
          savedAt: new Date().toISOString(),
          match: currentMatch ? clone(currentMatch) : null,
          namespaces,
        };

        if (archiveEndedMatches && state.cachedMatch && currentMatch && state.cachedMatch.matchId && currentMatch.matchId && state.cachedMatch.matchId !== currentMatch.matchId) {
          await archiveSnapshot(state, payload);
        }

        const tempFile = `${state.filePath}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(tempFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
        await fs.rename(tempFile, state.filePath);
        state.cachedMatch = clone(currentMatch);
        state.savedAt = payload.savedAt;
        state.dirty = false;
        state.lastError = "";
      } catch (error) {
        state.lastError = String(error?.message ?? error);
        logWithFallback(moduleLogger, "warn", "[MatchCache] cache write failed", {
          operation: "matchCache.writeFailed",
          data: {
            serverId: state.serverId,
            filePath: state.filePath,
            message: state.lastError,
          },
        });
      }
    })();

    writeState.activeWrite = writePromise.finally(() => {
      writeState.activeWrite = null;
      if (writeState.writeRequestedAgain) {
        writeState.writeRequestedAgain = false;
        void flush(serverId, { force: true });
      }
    });

    return writeState.activeWrite;
  }

  function scheduleFlush() {
    if (!started || !enabled) return;
    if (writeDebounceMs <= 0) {
      void flush();
      return;
    }

    if (forceFlushTimer) clearTimeout(forceFlushTimer);
    forceFlushTimer = setTimeout(() => {
      forceFlushTimer = null;
      void flush();
    }, writeDebounceMs);
    forceFlushTimer.unref?.();
  }

  async function archiveSnapshot(state, payload) {
    if (!archiveEndedMatches) return;
    try {
      const archiveDir = getArchiveDir(state.serverId);
      await fs.mkdir(archiveDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const match = payload.match ?? state.cachedMatch ?? null;
      const filename = [
        stamp,
        safeSegment(match?.map || "unknown"),
        safeSegment(match?.layer || "unknown"),
        safeSegment(match?.mode || "unknown"),
      ].join("_");
      const archiveFile = path.join(archiveDir, `${filename}.json`);
      await fs.writeFile(archiveFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

      const archivedFiles = await fs.readdir(archiveDir);
      const jsonFiles = archivedFiles.filter((file) => file.endsWith(".json")).sort().reverse();
      const excess = jsonFiles.slice(maxArchivedMatches);
      for (const file of excess) {
        await fs.rm(path.join(archiveDir, file), { force: true });
      }
    } catch (error) {
      logWithFallback(moduleLogger, "warn", "[MatchCache] archive write failed", {
        operation: "matchCache.archiveFailed",
        data: {
          serverId: state.serverId,
          message: String(error?.message ?? error),
        },
      });
    }
  }

  async function start() {
    if (!enabled) return;
    started = true;
    await ensureLoaded();
    forceFlushTimer = setInterval(() => {
      void flush(undefined, { force: true });
    }, forceFlushIntervalMs);
    forceFlushTimer.unref?.();
    logWithFallback(moduleLogger, "info", "MatchCache started.", {
      label: "MODULE",
      operation: "start",
    });
  }

  async function stop() {
    if (!enabled) return;
    started = false;
    if (forceFlushTimer) clearInterval(forceFlushTimer);
    forceFlushTimer = null;
    if (writeState.activeWrite) {
      await writeState.activeWrite.catch(() => {});
    }
    await flush(undefined, { force: true });
    for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
    logWithFallback(moduleLogger, "info", "MatchCache stopped.", {
      label: "MODULE",
      operation: "stop",
    });
  }

  const api = {
    getStatus,
    getMatchIdentity,
    getNamespace,
    registerProvider,
    markDirty,
    flush,
    clearCurrentMatch,
    restoreCurrentMatch,
    rejectCurrentMatch,
    setCurrentMatch,
  };

  return {
    manifest: {
      id: "module.matchCache",
      name: "Match Cache",
      kind: "module",
      version: "0.1.0",
      description: "当前对局缓存与恢复管理模块。",
      hidden: true,
    },
    apiName: "matchCache",
    api,
    start,
    stop,
  };
}

function makeProviderContext(serverId, operation, match = null, extra = {}) {
  return {
    serverId,
    operation,
    match: clone(match),
    ...extra,
  };
}

function makeEvent(eventName, patch = {}) {
  return {
    eventId: `${eventName}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
    eventName,
    layer: "module",
    source: "module.matchCache",
    time: new Date().toISOString(),
    params: [],
    ...patch,
  };
}

function clone(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.floor(number);
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

  function safeSegment(value) {
  return normalizeText(value || "unknown")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    || "unknown";
}

  function logWithFallback(logger, method, message, context) {
  const fn = logger?.[method];
  if (typeof fn === "function") {
    fn.call(logger, message, context);
    return;
  }

  function compareRoundAnchor(current = {}, cached = {}) {
    const currentWorld = normalizeText(current.worldPath ?? "");
    const cachedWorld = normalizeText(cached.worldPath ?? "");
    const currentServerPlayAt = normalizeText(current.serverPlayAt ?? "");
    const cachedServerPlayAt = normalizeText(cached.serverPlayAt ?? "");
    const currentLogLineTime = normalizeText(current.logLineTime ?? "");
    const cachedLogLineTime = normalizeText(cached.logLineTime ?? "");

    const currentHasAnchor = Boolean(currentWorld || currentServerPlayAt || currentLogLineTime);
    const cachedHasAnchor = Boolean(cachedWorld || cachedServerPlayAt || cachedLogLineTime);
    if (!currentHasAnchor || !cachedHasAnchor) return "pending";
    if (currentWorld && cachedWorld && currentWorld !== cachedWorld) return "different";
    if (currentServerPlayAt && cachedServerPlayAt && currentServerPlayAt !== cachedServerPlayAt) return "different";
    if (currentLogLineTime && cachedLogLineTime && currentLogLineTime !== cachedLogLineTime) return "different";
    return "same";
  }

  const rendered = typeof message === "function" ? message() : message;
  logger?.info?.(rendered, context);
}
