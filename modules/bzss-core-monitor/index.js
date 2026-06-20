// -*- coding: utf-8 -*-

import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_WATCH_DEBOUNCE_MS = 0;
const MARKER = "{BZSS-Marked}";
const START_NEEDLE = Buffer.from("PlayerBaseInfo{", "utf16le");
const MARKER_NEEDLE = Buffer.from(MARKER, "utf16le");

export function createBzssCoreMonitorModule({ core, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.bzssCoreMonitor",
    source: "module.bzssCoreMonitor",
    channel: "module",
  }) ?? core.logger;

  const state = createInitialState();
  let started = false;
  let pollTimer = null;
  let watchTimer = null;
  let tickRunning = false;
  let tickAgain = false;
  let lastFingerprint = "";
  let lastExists = false;
  let lastResolvedPath = "";
  let watcher = null;
  let watcherPath = "";

  function readConfig() {
    const config = core.config?.get?.("bzssCore", {}) ?? {};
    return {
      playerInfoSavePath: String(
        config.playerInfoSavePath
        ?? config.playerBaseInfoPath
        ?? config.playerInfoPath
        ?? "",
      ).trim(),
      playerInfoPollIntervalMs: normalizePositiveInteger(
        config.playerInfoPollIntervalMs,
        DEFAULT_POLL_INTERVAL_MS,
      ),
      playerInfoWatchDebounceMs: normalizeNonNegativeInteger(
        config.playerInfoWatchDebounceMs,
        DEFAULT_WATCH_DEBOUNCE_MS,
      ),
    };
  }

  const listeners = new Set();
  function subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function publish(mutator) {
    const previousStatus = state.status;
    mutator(state);
    state.revision += 1;
    state.updatedAt = new Date().toISOString();
    if (state.status !== previousStatus) {
      moduleLogger.info(`BZSS-Core monitor status -> ${state.status}`, {
        operation: "bzssCoreMonitor.status",
        data: {
          status: state.status,
          resolvedPath: state.resolvedPath,
          playerCount: state.players.length,
          lastError: state.lastError,
        },
      });
    }

    for (const listener of listeners) {
      try {
        listener(state);
      } catch (err) {
        // ignore
      }
    }
  }

  function clearPublishedPlayers(nextStatus, nextError = "") {
    publish((draft) => {
      draft.status = nextStatus;
      draft.players = [];
      draft.indexByName = {};
      draft.markerSeen = false;
      draft.lastError = nextError;
      draft.lastCompletedAt = nextStatus === "ready" ? draft.lastCompletedAt : "";
    });
  }

  async function tick() {
    const config = readConfig();
    const configuredPath = config.playerInfoSavePath;

    if (!configuredPath) {
      closeFileWatcher();
      lastFingerprint = "";
      lastExists = false;
      lastResolvedPath = "";
      publish((draft) => {
        draft.configuredPath = "";
        draft.resolvedPath = "";
        draft.exists = false;
        draft.fileSize = 0;
        draft.fileMtimeMs = 0;
        draft.status = "unconfigured";
        draft.players = [];
        draft.indexByName = {};
        draft.markerSeen = false;
        draft.rawText = "";
        draft.rawTextLength = 0;
        draft.rawTextUpdatedAt = "";
        draft.lastError = "";
      });
      return;
    }

    const resolvedPath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(process.cwd(), configuredPath);
    ensureFileWatcher(configuredPath, resolvedPath, config.playerInfoWatchDebounceMs);
    const pathChanged = resolvedPath !== lastResolvedPath;
    if (pathChanged) {
      lastFingerprint = "";
      lastExists = false;
      lastResolvedPath = resolvedPath;
      publish((draft) => {
        draft.configuredPath = configuredPath;
        draft.resolvedPath = resolvedPath;
        draft.exists = false;
        draft.fileSize = 0;
        draft.fileMtimeMs = 0;
        draft.players = [];
        draft.indexByName = {};
        draft.markerSeen = false;
        draft.rawText = "";
        draft.rawTextLength = 0;
        draft.rawTextUpdatedAt = "";
        draft.lastError = "";
        draft.status = "missing";
      });
    }

    let stat = null;
    try {
      stat = await fs.stat(resolvedPath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        lastFingerprint = "";
        const missingAfterExisting = lastExists;
        lastExists = false;
        publish((draft) => {
          draft.configuredPath = configuredPath;
          draft.resolvedPath = resolvedPath;
          draft.exists = false;
          draft.fileSize = 0;
          draft.fileMtimeMs = 0;
          draft.markerSeen = false;
          draft.players = [];
          draft.indexByName = {};
          draft.rawText = "";
          draft.rawTextLength = 0;
          draft.rawTextUpdatedAt = "";
          draft.lastError = "";
          draft.status = missingAfterExisting ? "waiting" : "missing";
        });
        return;
      }
      publish((draft) => {
        draft.configuredPath = configuredPath;
        draft.resolvedPath = resolvedPath;
        draft.exists = false;
        draft.lastError = error?.message ?? "Failed to stat player info file.";
        draft.status = "error";
      });
      return;
    }

    const fingerprint = `${stat.size}:${stat.mtimeMs}`;
    if (!pathChanged && fingerprint === lastFingerprint) return;
    lastFingerprint = fingerprint;
    lastExists = true;

    let fileBuffer = null;
    try {
      fileBuffer = await fs.readFile(resolvedPath);
    } catch (error) {
      publish((draft) => {
        draft.configuredPath = configuredPath;
        draft.resolvedPath = resolvedPath;
        draft.exists = true;
        draft.fileSize = Number(stat?.size ?? 0);
        draft.fileMtimeMs = Number(stat?.mtimeMs ?? 0);
        draft.lastError = error?.message ?? "Failed to read player info file.";
        draft.status = "error";
      });
      return;
    }

    const extracted = extractBzssCoreTrackedText(fileBuffer);
    publish((draft) => {
      draft.configuredPath = configuredPath;
      draft.resolvedPath = resolvedPath;
      draft.exists = true;
      draft.fileSize = Number(stat?.size ?? 0);
      draft.fileMtimeMs = Number(stat?.mtimeMs ?? 0);
      draft.lastReadAt = new Date().toISOString();
      draft.markerSeen = extracted.markerSeen;
      draft.rawText = extracted.text;
      draft.rawTextLength = extracted.text.length;
      draft.rawTextUpdatedAt = draft.lastReadAt;
      draft.lastError = extracted.error ?? "";
    });

    if (!extracted.text) {
      clearPublishedPlayers("writing", extracted.error ?? "");
      return;
    }

    if (!extracted.markerSeen) {
      clearPublishedPlayers("writing");
      return;
    }

    const players = parseBzssCorePlayerBlocks(extracted.text);
    const indexByName = buildPlayerIndex(players);
    publish((draft) => {
      draft.status = "ready";
      draft.players = players;
      draft.indexByName = indexByName;
      draft.markerSeen = true;
      draft.lastCompletedAt = new Date().toISOString();
      draft.lastError = "";
    });
  }

  function scheduleNextTick(delayMs = readConfig().playerInfoPollIntervalMs) {
    if (!started) return;
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      try {
        await runTick();
      } finally {
        scheduleNextTick();
      }
    }, Math.max(25, delayMs));
  }

  function scheduleWatchTick(delayMs = DEFAULT_WATCH_DEBOUNCE_MS) {
    if (!started) return;
    if (watchTimer) return;
    watchTimer = setTimeout(() => {
      watchTimer = null;
      runTick().catch((err) => {
        moduleLogger.warn(`BZSS-Core monitor watch tick failed: ${err.message}`);
      });
    }, Math.max(0, delayMs));
  }

  async function runTick() {
    if (tickRunning) {
      tickAgain = true;
      return;
    }

    tickRunning = true;
    try {
      do {
        tickAgain = false;
        await tick();
      } while (started && tickAgain);
    } finally {
      tickRunning = false;
    }
  }

  function ensureFileWatcher(configuredPath, resolvedPath, debounceMs) {
    if (!started) return;
    if (!configuredPath || !resolvedPath) {
      closeFileWatcher();
      return;
    }
    if (watcherPath === resolvedPath && watcher) return;

    closeFileWatcher();
    watcherPath = resolvedPath;
    const directory = path.dirname(resolvedPath);
    const targetName = path.basename(resolvedPath).toLowerCase();
    try {
      watcher = fsSync.watch(directory, { persistent: false }, (_eventType, fileName) => {
        const changedName = fileName == null ? "" : String(fileName).toLowerCase();
        if (changedName && changedName !== targetName) return;
        scheduleWatchTick(debounceMs);
      });
      watcher.on?.("error", (error) => {
        moduleLogger.warn(`BZSS-Core monitor file watcher failed: ${error.message}`);
        closeFileWatcher();
      });
    } catch (error) {
      watcher = null;
      moduleLogger.warn(`BZSS-Core monitor file watcher unavailable: ${error.message}`);
    }
  }

  function closeFileWatcher() {
    if (watcher) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
    }
    watcher = null;
    watcherPath = "";
  }

  function getState() {
    return {
      configuredPath: state.configuredPath,
      resolvedPath: state.resolvedPath,
      exists: state.exists,
      status: state.status,
      revision: state.revision,
      updatedAt: state.updatedAt,
      lastReadAt: state.lastReadAt,
      lastCompletedAt: state.lastCompletedAt,
      markerSeen: state.markerSeen,
      fileSize: state.fileSize,
      fileMtimeMs: state.fileMtimeMs,
      playerCount: state.players.length,
      rawTextLength: state.rawTextLength,
      rawTextUpdatedAt: state.rawTextUpdatedAt,
      lastError: state.lastError,
    };
  }

  function getRawSnapshot() {
    return {
      configuredPath: state.configuredPath,
      resolvedPath: state.resolvedPath,
      exists: state.exists,
      status: state.status,
      revision: state.revision,
      updatedAt: state.updatedAt,
      lastReadAt: state.lastReadAt,
      lastCompletedAt: state.lastCompletedAt,
      markerSeen: state.markerSeen,
      fileSize: state.fileSize,
      fileMtimeMs: state.fileMtimeMs,
      playerCount: state.players.length,
      lastError: state.lastError,
      rawText: state.rawText,
      rawTextLength: state.rawTextLength,
      rawTextUpdatedAt: state.rawTextUpdatedAt,
    };
  }

  function getPlayers() {
    return state.players.map(clonePlainObject);
  }

  function findPlayer(query = {}) {
    const name = String(query?.name ?? "").trim();
    if (!name) return null;
    const directKey = normalizeComparableName(name);
    const directMatch = state.indexByName[directKey];
    if (directMatch) return clonePlainObject(directMatch);

    const querySuffix = normalizeSuffixName(name);
    if (!querySuffix) return null;

    for (const player of state.players) {
      if (normalizeSuffixName(player.playerName) === querySuffix) {
        return clonePlainObject(player);
      }
    }
    return null;
  }

  async function start() {
    if (started) return;
    started = true;
    await runTick();
    scheduleNextTick();
  }

  async function stop() {
    started = false;
    clearTimeout(pollTimer);
    clearTimeout(watchTimer);
    pollTimer = null;
    watchTimer = null;
    closeFileWatcher();
  }

  return {
    manifest: {
      id: "module.bzssCoreMonitor",
      name: "BZSS-Core Monitor",
      kind: "module",
      version: "0.1.0",
      description: "Monitor BZSS-Core player info save files and expose parsed player snapshots.",
    },
    apiName: "bzssCoreMonitor",
    api: {
      getState,
      getPlayers,
      getRawSnapshot,
      findPlayer,
      subscribe,
    },
    start,
    stop,
  };
}

function createInitialState() {
  return {
    configuredPath: "",
    resolvedPath: "",
    exists: false,
    status: "idle",
    revision: 0,
    updatedAt: "",
    lastReadAt: "",
    lastCompletedAt: "",
    markerSeen: false,
    fileSize: 0,
    fileMtimeMs: 0,
    players: [],
    indexByName: {},
    rawText: "",
    rawTextLength: 0,
    rawTextUpdatedAt: "",
    lastError: "",
  };
}

export function extractBzssCoreTrackedText(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
  const startIndex = data.indexOf(START_NEEDLE);
  if (startIndex < 0) {
    const fallbackText = extractRelevantUtf16Runs(data);
    if (fallbackText.text) return fallbackText;
    return {
      text: "",
      markerSeen: false,
      error: "PlayerBaseInfo block was not found.",
    };
  }

  const markerIndex = data.lastIndexOf(MARKER_NEEDLE);
  const endIndex = markerIndex >= 0 ? markerIndex + MARKER_NEEDLE.length : data.length;
  const text = data.subarray(startIndex, endIndex).toString("utf16le").replace(/\u0000+$/g, "");
  if (!text.includes("SoldierInfo{") || !text.includes("PlayerScoreboard{")) {
    const fallbackText = extractRelevantUtf16Runs(data);
    if (fallbackText.text) return fallbackText;
  }
  return {
    text,
    markerSeen: markerIndex >= 0 && text.includes(MARKER),
    error: "",
  };
}

export function parseBzssCorePlayerBlocks(text) {
  const source = String(text ?? "");
  const players = [];
  const pattern = /PlayerBaseInfo\{([^}]*)\}/g;
  let match = null;
  while ((match = pattern.exec(source)) !== null) {
    const baseRaw = String(match[1] ?? "");
    const segmentStart = pattern.lastIndex;
    const nextBaseIndex = source.indexOf("PlayerBaseInfo{", segmentStart);
    const segmentEnd = nextBaseIndex >= 0 ? nextBaseIndex : source.length;
    const segment = source.slice(segmentStart, segmentEnd);
    const soldierBlock = findNamedBlock(segment, "SoldierInfo");
    const scoreboardBlock = findNamedBlock(segment, "PlayerScoreboard");
    if (!scoreboardBlock) continue;
    const soldierRaw = soldierBlock?.content ?? "";
    const scoreboardRaw = scoreboardBlock.content;
    const baseFields = splitTopLevelCsv(baseRaw);
    const baseMap = parseKeyValueFields(baseFields);
    const scoreboardValues = splitTopLevelCsv(scoreboardRaw);
    const soldierInfo = soldierRaw ? parseSoldierInfo(soldierRaw) : { summary: createEmptySoldierInfo() };
    players.push({
      playerName: baseMap.PlayerName ?? baseFields[2] ?? "",
      playerGuid: baseMap.PlayerOnlineID ?? baseFields[1] ?? "",
      teamId: toFiniteNumber(baseMap.TeamID ?? baseMap.TeamId ?? baseFields[3]),
      squadId: toFiniteNumber(baseMap.SquadID ?? baseMap.SquadId ?? baseFields[4]),
      playerBaseInfo: {
        raw: baseRaw,
        fields: baseFields,
        values: baseMap,
      },
      soldierInfo: soldierInfo.summary,
      playerScoreboard: {
        raw: scoreboardRaw,
        values: scoreboardValues,
        numericValues: scoreboardValues.map(toFiniteNumber),
      },
      rawText: source.slice(match.index, segmentEnd),
    });
  }
  return players;
}

function createEmptySoldierInfo() {
  return {
    raw: "",
    fields: [],
    values: {},
    soldierClass: "",
    health: null,
    weaponClass: "",
    ammoValues: [],
    position: null,
    rotation: null,
  };
}

function parseSoldierInfo(rawText) {
  const source = String(rawText ?? "");
  const positionBlock = findNamedBlock(source, "Position");
  const rotationBlock = findNamedBlock(source, "Rotation");
  const weaponBlock = findNamedBlock(source, "WeaponInfo");
  const vectors = [
    parseVectorBlock(positionBlock?.content ?? ""),
    parseVectorBlock(rotationBlock?.content ?? ""),
  ].filter(Boolean);
  const withoutNestedBlocks = source
    .replace(/WeaponInfo\{[\s\S]*?\}(?=Position\{|Rotation\{|$)/g, "")
    .replace(/Position\{[\s\S]*?\}(?=Rotation\{|$)/g, "")
    .replace(/Rotation\{[\s\S]*?\}/g, "");
  const withoutLegacyVectors = withoutNestedBlocks.replace(/\{X=[-0-9.]+\s+Y=[-0-9.]+\s+Z=[-0-9.]+\}/g, "");
  const legacyVectorMatches = [...source.matchAll(/\{X=([-0-9.]+)\s+Y=([-0-9.]+)\s+Z=([-0-9.]+)\}/g)];
  for (const match of legacyVectorMatches) {
    vectors.push({
      x: toFiniteNumber(match[1]),
      y: toFiniteNumber(match[2]),
      z: toFiniteNumber(match[3]),
    });
  }
  const fields = splitTopLevelCsv(withoutLegacyVectors);
  const fieldMap = parseKeyValueFields(fields);
  const weaponFields = weaponBlock ? splitTopLevelCsv(weaponBlock.content) : [];
  const weaponClass = weaponFields[0] && weaponFields[0] !== "NoWeapon"
    ? weaponFields[0]
    : "";
  const weaponFieldIndex = fields.findIndex((value, index) => index > 0 && /^BP_/i.test(value));
  const ammoValues = weaponFields.length > 1
    ? weaponFields.slice(1).map(toFiniteNumber).filter((value) => value != null)
    : weaponFieldIndex >= 0
      ? fields.slice(weaponFieldIndex + 1).map(toFiniteNumber).filter((value) => value != null)
      : [];

  return {
    summary: {
      raw: rawText,
      fields,
      values: fieldMap,
      soldierClass: fieldMap.PawnClass ?? fields[0] ?? "",
      health: toFiniteNumber(fieldMap.Health ?? fields[1]),
      weaponClass: weaponClass || (weaponFieldIndex >= 0 ? fields[weaponFieldIndex] ?? "" : ""),
      ammoValues,
      position: vectors[0] ?? null,
      rotation: vectors[1] ?? null,
    },
  };
}

function findNamedBlock(text, name) {
  const source = String(text ?? "");
  const startToken = `${name}{`;
  const start = source.indexOf(startToken);
  if (start < 0) return null;
  const contentStart = start + startToken.length;
  let depth = 1;
  for (let index = contentStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return {
        start,
        end: index + 1,
        content: source.slice(contentStart, index),
      };
    }
  }
  return null;
}

function parseKeyValueFields(fields) {
  const result = {};
  for (const field of fields) {
    const text = String(field ?? "").trim();
    const separator = text.indexOf(":");
    if (separator <= 0) continue;
    const key = text.slice(0, separator).trim();
    const value = text.slice(separator + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

function parseVectorBlock(text) {
  const match = String(text ?? "").match(/X=([-0-9.]+)\s+Y=([-0-9.]+)\s+Z=([-0-9.]+)/);
  if (!match) return null;
  return {
    x: toFiniteNumber(match[1]),
    y: toFiniteNumber(match[2]),
    z: toFiniteNumber(match[3]),
  };
}

function buildPlayerIndex(players) {
  const index = {};
  for (const player of players) {
    const comparable = normalizeComparableName(player.playerName);
    if (comparable && !index[comparable]) index[comparable] = player;
  }
  return index;
}

function splitTopLevelCsv(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of String(text ?? "")) {
    if (char === "{") depth += 1;
    if (char === "}") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current || text === "") parts.push(current.trim());
  return parts;
}

function extractRelevantUtf16Runs(data) {
  const runs = extractUtf16LeTextRuns(data).filter((run) => (
    run.includes("PlayerBaseInfo{")
    || run.includes("SoldierInfo{")
    || run.includes("PlayerScoreboard{")
    || run.includes(MARKER)
  ));
  return {
    text: runs.join(""),
    markerSeen: runs.some((run) => run.includes(MARKER)),
    error: runs.length > 0 ? "" : "Relevant UTF-16 text runs were not found.",
  };
}

function extractUtf16LeTextRuns(data) {
  const runs = [];
  let start = -1;

  for (let offset = 0; offset + 1 < data.length; offset += 2) {
    const codeUnit = data.readUInt16LE(offset);
    const printable = isLikelyPrintableUtf16CodeUnit(codeUnit);
    if (printable) {
      if (start < 0) start = offset;
      continue;
    }

    if (start >= 0) {
      if (offset - start >= 16) {
        runs.push(data.subarray(start, offset).toString("utf16le"));
      }
      start = -1;
    }
  }

  if (start >= 0 && data.length - start >= 16) {
    const safeEnd = data.length - (data.length - start) % 2;
    runs.push(data.subarray(start, safeEnd).toString("utf16le"));
  }

  return runs;
}

function isLikelyPrintableUtf16CodeUnit(value) {
  if (value === 0 || value === 0xffff) return false;
  if (value === 0x0009 || value === 0x000a || value === 0x000d) return true;
  return value >= 0x0020 && value <= 0xfffd;
}

function normalizeComparableName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeSuffixName(value) {
  const normalized = normalizeComparableName(value);
  if (!normalized) return "";
  const tokens = normalized.split(" ").filter(Boolean);
  return tokens[tokens.length - 1] ?? normalized;
}

function toFiniteNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function normalizeNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

function clonePlainObject(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
