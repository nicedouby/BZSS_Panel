// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_POLL_INTERVAL_MS = 100;
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
  let timer = null;
  let lastFingerprint = "";
  let lastExists = false;
  let lastResolvedPath = "";

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
        draft.lastError = "";
      });
      return;
    }

    const resolvedPath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(process.cwd(), configuredPath);
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

    const fingerprint = `${stat.size}:${Math.floor(stat.mtimeMs)}`;
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
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await tick();
      } finally {
        scheduleNextTick();
      }
    }, Math.max(100, delayMs));
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
      lastError: state.lastError,
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
    await tick();
    scheduleNextTick();
  }

  async function stop() {
    started = false;
    clearTimeout(timer);
    timer = null;
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
      findPlayer,
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
  const pattern = /PlayerBaseInfo\{([^}]*)\}(?:SoldierInfo\{([\s\S]*?)\})?PlayerScoreboard\{([^}]*)\}/g;
  let match = null;
  while ((match = pattern.exec(source)) !== null) {
    const baseRaw = String(match[1] ?? "");
    const soldierRaw = String(match[2] ?? "");
    const scoreboardRaw = String(match[3] ?? "");
    const baseFields = splitTopLevelCsv(baseRaw);
    const scoreboardValues = splitTopLevelCsv(scoreboardRaw);
    const soldierInfo = soldierRaw ? parseSoldierInfo(soldierRaw) : { summary: createEmptySoldierInfo() };
    players.push({
      playerName: baseFields[2] ?? "",
      playerGuid: baseFields[1] ?? "",
      teamId: toFiniteNumber(baseFields[3]),
      squadId: toFiniteNumber(baseFields[4]),
      playerBaseInfo: {
        raw: baseRaw,
        fields: baseFields,
      },
      soldierInfo: soldierInfo.summary,
      playerScoreboard: {
        raw: scoreboardRaw,
        values: scoreboardValues,
        numericValues: scoreboardValues.map(toFiniteNumber),
      },
      rawText: `PlayerBaseInfo{${baseRaw}}SoldierInfo{${soldierRaw}}PlayerScoreboard{${scoreboardRaw}}`,
    });
  }
  return players;
}

function createEmptySoldierInfo() {
  return {
    raw: "",
    fields: [],
    soldierClass: "",
    health: null,
    weaponClass: "",
    ammoValues: [],
    position: null,
    rotation: null,
  };
}

function parseSoldierInfo(rawText) {
  const vectorMatches = [...String(rawText ?? "").matchAll(/\{X=([-0-9.]+)\s+Y=([-0-9.]+)\s+Z=([-0-9.]+)\}/g)];
  const vectors = vectorMatches.map((match) => ({
    x: toFiniteNumber(match[1]),
    y: toFiniteNumber(match[2]),
    z: toFiniteNumber(match[3]),
  }));
  const withoutVectors = String(rawText ?? "").replace(/\{X=[-0-9.]+\s+Y=[-0-9.]+\s+Z=[-0-9.]+\}/g, "");
  const fields = splitTopLevelCsv(withoutVectors);
  const weaponFieldIndex = fields.findIndex((value, index) => index > 0 && /^BP_/i.test(value));
  const ammoValues = weaponFieldIndex >= 0
    ? fields.slice(weaponFieldIndex + 1).map(toFiniteNumber).filter((value) => value != null)
    : [];

  return {
    summary: {
      raw: rawText,
      fields,
      soldierClass: fields[0] ?? "",
      health: toFiniteNumber(fields[1]),
      weaponClass: weaponFieldIndex >= 0 ? fields[weaponFieldIndex] ?? "" : "",
      ammoValues,
      position: vectors[0] ?? null,
      rotation: vectors[1] ?? null,
    },
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

function clonePlainObject(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
