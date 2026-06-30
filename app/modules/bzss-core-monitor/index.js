// -*- coding: utf-8 -*-

import { createHash } from "node:crypto";

const MARKER = "{BZSS-Marked}";
const START_NEEDLE = Buffer.from("PlayerBaseInfo{", "utf16le");
const MARKER_NEEDLE = Buffer.from(MARKER, "utf16le");
const SCOREBOARD_FIELDS = [
  ["dataLives", "Data lives"],
  ["numKills", "Num kills"],
  ["vehicleKills", "Num vehicle kills"],
  ["numDeaths", "Num death"],
  ["numWoundeds", "Num woundeds"],
  ["numWounds", "Num wounds"],
  ["numTeamKills", "Num TK"],
  ["healPoints", "Heal point"],
  ["revivedPoints", "Revived points"],
  ["teamworkScore", "Team work score"],
  ["objectiveScore", "Objective score"],
  ["combatScore", "Combat score"],
];
const SCOREBOARD_FIELD_ALIASES = {
  dataLives: ["Lives", "DataLives"],
  numKills: ["NumKills"],
  vehicleKills: ["VehicleKills", "NumVehicleKills"],
  numDeaths: ["NumDeaths"],
  numWoundeds: ["Woundeds"],
  numWounds: ["Wounds"],
  numTeamKills: ["TKs", "NumTK"],
  healPoints: ["HealPoints"],
  revivedPoints: ["Revived"],
  teamworkScore: ["TeamWork"],
  objectiveScore: ["Objective"],
  combatScore: ["Combat"],
};

export function createBzssCoreMonitorModule({ core, logger }) {
  const moduleLogger = logger ?? core.createLogger?.({
    moduleId: "module.bzssCoreMonitor",
    source: "module.bzssCoreMonitor",
    channel: "module",
  }) ?? core.logger;

  const state = createInitialState();
  let started = false;
  const unsubscribers = [];

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
          runtimePlayerCount: state.runtimePlayers.length,
          scoreboardPlayerCount: state.scoreboardPlayers.length,
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
    core.eventBus?.emitModuleEvent?.("module.bzssCoreMonitor", "snapshotUpdated", getSnapshotEvent());
  }

  function clearPublishedPlayers(nextStatus, nextError = "") {
    publish((draft) => {
      draft.status = nextStatus;
      draft.runtimePlayers = [];
      draft.scoreboardPlayers = [];
      draft.markerSeen = false;
      draft.lastError = nextError;
    });
  }

  function ingestLogLine(input = {}) {
    const line = extractRawLogLine(input);
    if (!line) return { ok: false, ignored: true, reason: "empty" };

    const parsed = parseBzssCoreLogLine(line);
    if (!parsed) return { ok: true, ignored: true, reason: "not_bzss_core" };

    try {
      publish((draft) => {
        draft.status = "ready";
        draft.markerSeen = true;
        draft.rawLineHash = hashText(line);
        draft.rawFields = parsed.rawFields ?? [];
        draft.lastError = "";

        if (parsed.type === "playerRuntime") {
          draft.runtimePlayers = parsed.runtimePlayers;
        } else if (parsed.type === "playerScoreboard") {
          draft.scoreboardPlayers = parsed.scoreboardPlayers;
        } else if (parsed.type === "playerFullBlocks") {
          const observedAt = new Date().toISOString();
          draft.runtimePlayers = parsed.players.map((p) => ({
            playerId: p.playerId,
            playerIndex: p.playerIndex,
            position: p.soldierInfo?.position ?? p.position ?? null,
            yaw: p.yaw,
            combatInfo: p.claimedInfo || p.soldierInfo?.weaponClass || "",
            observedAt,
            stale: false,
            playerName: p.playerName,
            playerGuid: p.playerGuid,
            soldierInfo: p.soldierInfo,
            vehicleInfo: p.vehicleInfo,
          }));
          draft.scoreboardPlayers = parsed.players.map((p) => ({
            playerId: p.playerId,
            playerIndex: p.playerIndex,
            teamId: p.teamId,
            squadId: p.squadId,
            lives: p.playerScoreboard?.stats?.dataLives ?? null,
            kills: p.playerScoreboard?.stats?.numKills ?? null,
            vehicleKills: p.playerScoreboard?.stats?.vehicleKills ?? null,
            deaths: p.playerScoreboard?.stats?.numDeaths ?? null,
            woundeds: p.playerScoreboard?.stats?.numWoundeds ?? null,
            wounds: p.playerScoreboard?.stats?.numWounds ?? null,
            teamKills: p.playerScoreboard?.stats?.numTeamKills ?? null,
            healPoints: p.playerScoreboard?.stats?.healPoints ?? null,
            revivedPoints: p.playerScoreboard?.stats?.revivedPoints ?? null,
            teamworkScore: p.playerScoreboard?.stats?.teamworkScore ?? null,
            objectiveScore: p.playerScoreboard?.stats?.objectiveScore ?? null,
            combatScore: p.playerScoreboard?.stats?.combatScore ?? null,
            isAdmin: p.isAdmin,
            isCommander: p.isCommander,
            fireTeamIndex: p.ftIndex,
            fireTeamPosition: p.ftPosition,
            playerScoreboard: p.playerScoreboard,
          }));
        } else if (parsed.type === "scene") {
          draft.captureZones = parsed.captureZones;
          draft.fobs = parsed.fobs;
          draft.mainZones = parsed.mainZones;
        }
      });
      return { ok: true, ignored: false, type: parsed.type };
    } catch (error) {
      publish((draft) => {
        draft.status = "error";
        draft.lastError = error?.message ?? "Failed to parse BZSS-Core log line.";
        draft.rawLineHash = hashText(line);
      });
      return { ok: false, ignored: false, error: error?.message ?? "Failed to parse BZSS-Core log line." };
    }
  }

  function getSnapshotEvent() {
    return {
      state: getState(),
      runtimePlayers: getRuntimePlayers(),
      scoreboardPlayers: getScoreboardPlayers(),
      captureZones: state.captureZones.map(clonePlainObject),
      fobs: state.fobs.map(clonePlainObject),
      mainZones: state.mainZones.map(clonePlainObject),
    };
  }

  function handleRawLogLine(event) {
    ingestLogLine(event);
  }

  function getState() {
    return {
      status: state.status,
      revision: state.revision,
      updatedAt: state.updatedAt,
      markerSeen: state.markerSeen,
      runtimePlayerCount: state.runtimePlayers.length,
      scoreboardPlayerCount: state.scoreboardPlayers.length,
      playerCount: state.runtimePlayers.length + state.scoreboardPlayers.length,
      mainZoneCount: state.mainZones.length,
      rawLineHash: state.rawLineHash,
      rawFields: [...state.rawFields],
      lastError: state.lastError,
    };
  }

  function getRawSnapshot() {
    return {
      status: state.status,
      revision: state.revision,
      updatedAt: state.updatedAt,
      markerSeen: state.markerSeen,
      runtimePlayerCount: state.runtimePlayers.length,
      scoreboardPlayerCount: state.scoreboardPlayers.length,
      playerCount: state.runtimePlayers.length + state.scoreboardPlayers.length,
      captureZones: state.captureZones.map(clonePlainObject),
      fobs: state.fobs.map(clonePlainObject),
      mainZones: state.mainZones.map(clonePlainObject),
      runtimePlayers: state.runtimePlayers.map(clonePlainObject),
      scoreboardPlayers: state.scoreboardPlayers.map(clonePlainObject),
      rawLineHash: state.rawLineHash,
      rawFields: [...state.rawFields],
      lastError: state.lastError,
    };
  }

  function getRuntimePlayers() {
    return state.runtimePlayers.map(clonePlainObject);
  }

  function getScoreboardPlayers() {
    return state.scoreboardPlayers.map(clonePlainObject);
  }

  /**
   * 获取合并且规范化后的在线玩家列表。
   * 深度融合了运行时状态 (runtimePlayers) 与记分板指标 (scoreboardPlayers)，
   * 确保提供一致的 JSDoc/TypeScript 契约结构，供战术地图及战术回放进行无差别访问。
   *
   * @returns {Array<Object>} 规范化的玩家数组
   */
  function getPlayers() {
    const byIndex = new Map();

    // 1. 写入运行时玩家数据
    for (const player of state.runtimePlayers) {
      if (player.playerIndex == null && player.playerId == null) continue;
      const key = player.playerIndex ?? player.playerId;

      const position = player.position ? { ...player.position } : null;
      const soldierInfo = player.soldierInfo ? clonePlainObject(player.soldierInfo) : {
        raw: "",
        fields: [],
        values: {},
        soldierClass: "",
        health: 100, // 默认填充 100 生命值
        weaponClass: "",
        ammoValues: [],
        position: position ? { ...position } : null,
        rotation: { x: 0, y: 0, z: player.yaw ?? 0 },
      };

      byIndex.set(key, {
        playerId: player.playerId,
        playerIndex: player.playerIndex,
        playerName: player.playerName ?? "",
        playerGuid: player.playerGuid ?? "",
        teamId: player.teamId ?? null,
        squadId: player.squadId ?? null,
        isAdmin: player.isAdmin ?? null,
        isCommander: player.isCommander ?? null,
        position,
        yaw: player.yaw,
        combatInfo: player.combatInfo ?? "",
        observedAt: player.observedAt,
        stale: player.stale ?? false,
        soldierInfo,
        vehicleInfo: player.vehicleInfo ? clonePlainObject(player.vehicleInfo) : null,
        playerScoreboard: player.playerScoreboard ? clonePlainObject(player.playerScoreboard) : {
          raw: "",
          values: [],
          numericValues: [],
          stats: {
            dataLives: null,
            numKills: 0,
            vehicleKills: 0,
            numDeaths: 0,
            numWoundeds: 0,
            numWounds: 0,
            numTeamKills: 0,
            healPoints: 0,
            revivedPoints: 0,
            teamworkScore: 0,
            objectiveScore: 0,
            combatScore: 0,
          },
        },
        rawText: player.rawText ?? "",
      });
    }

    // 2. 合并/更新记分板数据
    for (const player of state.scoreboardPlayers) {
      if (player.playerIndex == null && player.playerId == null) continue;
      const key = player.playerIndex ?? player.playerId;

      const existing = byIndex.get(key);
      const scoreboardInfo = player.playerScoreboard ? clonePlainObject(player.playerScoreboard) : {
        raw: player.raw ?? "",
        values: player.rawFields ?? [],
        numericValues: [],
        stats: {
          dataLives: player.lives,
          numKills: player.kills,
          vehicleKills: player.vehicleKills,
          numDeaths: player.deaths,
          numWoundeds: player.woundeds,
          numWounds: player.wounds,
          numTeamKills: player.teamKills,
          healPoints: player.healPoints,
          revivedPoints: player.revivedPoints,
          teamworkScore: player.teamworkScore,
          objectiveScore: player.objectiveScore,
          combatScore: player.combatScore,
        },
      };

      if (existing) {
        existing.teamId = player.teamId ?? existing.teamId;
        existing.squadId = player.squadId ?? existing.squadId;
        existing.isAdmin = player.isAdmin ?? existing.isAdmin;
        existing.isCommander = player.isCommander ?? existing.isCommander;
        existing.playerScoreboard = scoreboardInfo;
      } else {
        byIndex.set(key, {
          playerId: player.playerId,
          playerIndex: player.playerIndex,
          playerName: player.playerName ?? "",
          playerGuid: player.playerGuid ?? "",
          teamId: player.teamId,
          squadId: player.squadId,
          isAdmin: player.isAdmin,
          isCommander: player.isCommander,
          position: null,
          yaw: null,
          combatInfo: "",
          observedAt: new Date().toISOString(),
          stale: true,
          soldierInfo: {
            raw: "",
            fields: [],
            values: {},
            soldierClass: "",
            health: null,
            weaponClass: "",
            ammoValues: [],
            position: null,
            rotation: null,
          },
          vehicleInfo: null,
          playerScoreboard: scoreboardInfo,
          rawText: player.raw ?? "",
        });
      }
    }

    return [...byIndex.values()];
  }

  async function start() {
    if (started) return;
    started = true;
    if (core.eventBus?.onCoreEvent) {
      unsubscribers.push(core.eventBus.onCoreEvent("On_RawLogLine", handleRawLogLine));
    }
  }

  async function stop() {
    started = false;
    for (const unsubscribe of unsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch {
        // ignore
      }
    }
  }

  return {
    manifest: {
      id: "module.bzssCoreMonitor",
      name: "BZSS-Core Monitor",
      kind: "module",
      version: "0.1.0",
      description: "Monitor BZSS-Core log lines and expose parsed player snapshots.",
    },
    apiName: "bzssCoreMonitor",
    api: {
      getState,
      getRuntimePlayers,
      getScoreboardPlayers,
      getPlayers,
      getRawSnapshot,
      subscribe,
      ingestLogLine,
    },
    start,
    stop,
  };
}

function createInitialState() {
  return {
    status: "idle",
    revision: 0,
    updatedAt: "",
    markerSeen: false,
    runtimePlayers: [],
    scoreboardPlayers: [],
    captureZones: [],
    fobs: [],
    mainZones: [],
    rawLineHash: "",
    rawFields: [],
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

  const contextStart = findBzssCoreContextStart(data, startIndex);
  const markerIndex = data.lastIndexOf(MARKER_NEEDLE);
  const endIndex = markerIndex >= 0 ? markerIndex + MARKER_NEEDLE.length : data.length;
  const text = data.subarray(contextStart, endIndex).toString("utf16le").replace(/\u0000+$/g, "");
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
    const contextStart = findPlayerContextStart(source, match.index);
    const context = source.slice(contextStart, match.index);
    const soldierBlock = findNamedBlock(segment, "SoldierInfo");
    const scoreboardBlock = findNamedBlock(segment, "PlayerScoreboard");
    if (!scoreboardBlock) continue;
    const soldierRaw = soldierBlock?.content ?? "";
    const scoreboardRaw = scoreboardBlock.content;
    const baseFields = splitTopLevelCsv(baseRaw);
    const baseMap = parseKeyValueFields(baseFields);
    const seatsBlock = findNamedBlock(segment, "SeatsPlayers");
    const vehicleInfo = parseVehicleInfo(segment);
    const scoreboardInfo = parseScoreboardInfo(scoreboardRaw);
    const soldierInfo = soldierRaw ? parseSoldierInfo(soldierRaw) : { summary: createEmptySoldierInfo() };
    if (!soldierInfo.summary.position && vehicleInfo.position) {
      soldierInfo.summary.position = vehicleInfo.position;
      soldierInfo.summary.rotation = vehicleInfo.rotation;
    }
    const teamAndSquadInfo = parseTeamAndSquadInfo(context, segment, baseMap, baseFields);
    players.push({
      playerId: toFiniteNumber(baseMap.PlayerID ?? baseFields[0]),
      playerIndex: toFiniteNumber(baseMap.PlayerID ?? baseFields[0]),
      playerName: baseMap.PlayerName ?? baseFields[2] ?? "",
      playerGuid: baseMap.PlayerOnlineID ?? baseFields[1] ?? "",
      teamId: teamAndSquadInfo.teamId,
      squadId: teamAndSquadInfo.squadId,
      isAdmin: toBooleanNumber(baseMap.IsAdmin),
      isCommander: toBooleanNumber(baseMap.IsCommander),
      ftIndex: toFiniteNumber(baseMap.FTIndex),
      ftPosition: toFiniteNumber(baseMap.FTPosition),
      claimedInfo: segment.includes("{NoExistingClaimedInfo}") ? "NoExistingClaimedInfo" : "",
      seatsPlayers: seatsBlock ? splitTopLevelCsv(seatsBlock.content).filter(Boolean) : [],
      vehicleInfo,
      playerBaseInfo: {
        raw: baseRaw,
        fields: baseFields,
        values: baseMap,
      },
      soldierInfo: soldierInfo.summary,
      playerScoreboard: {
        ...scoreboardInfo,
      },
      rawText: source.slice(match.index, segmentEnd),
    });
  }
  return players;
}

export function parseBzssCoreLogLine(line) {
  const text = String(line ?? "");
  if (text.includes("PlayerBaseInfo{") && text.includes("SoldierInfo{") && text.includes("PlayerScoreboard{")) {
    const players = parseBzssCorePlayerBlocks(text);
    return {
      type: "playerFullBlocks",
      players,
      rawFields: [],
    };
  }
  if (text.includes("PlayerBaseInfo{")) return parseRuntimePlayerLine(text);
  if (text.includes("PlayerScoreboard{")) return parseScoreboardPlayerLine(text);
  if (text.includes("CPZ:") && text.includes(",FOBI:") && text.includes(",MainZone:")) return parseSceneInfoLine(text);
  return null;
}

function parseRuntimePlayerLine(text) {
  const block = extractLineBlock(text, "PlayerBaseInfo");
  const raw = block?.content ?? "";
  if (!raw.trim()) {
    return {
      type: "playerRuntime",
      runtimePlayers: [],
      rawFields: [],
    };
  }

  const items = extractBraceItems(raw);
  const rows = items.length > 0 ? items : [raw];
  const observedAt = new Date().toISOString();
  const runtimePlayers = rows
    .map((row) => {
      const fields = splitTopLevelCsv(row);
      return {
        playerId: toFiniteNumber(fields[0]),
        playerIndex: toFiniteNumber(fields[0]),
        position: {
          x: toFiniteNumber(fields[1]),
          y: toFiniteNumber(fields[2]),
          z: toFiniteNumber(fields[3]),
        },
        yaw: toFiniteNumber(fields[4]),
        combatInfo: fields.slice(5).join(","),
        observedAt,
        stale: false,
      };
    })
    .filter((player) => player.playerId != null);

  return {
    type: "playerRuntime",
    runtimePlayers,
    rawFields: [],
  };
}

function parseScoreboardPlayerLine(text) {
  const raw = extractCompactLineTail(text, "PlayerScoreboard");
  if (!raw.trim()) {
    return {
      type: "playerScoreboard",
      scoreboardPlayers: [],
      rawFields: [],
    };
  }

  const rowTexts = extractScoreboardRows(raw);
  const scoreboardPlayers = rowTexts
    .map((row) => parseLogScoreboardRow(row))
    .filter(Boolean);

  return {
    type: "playerScoreboard",
    scoreboardPlayers,
    rawFields: scoreboardPlayers.flatMap((player) => player.rawFields ?? []),
  };
}

function parseLogScoreboardRow(row) {
  const raw = String(row ?? "").trim().replace(/}+$/g, "");
  if (!raw) return null;
  const originalFields = splitTopLevelCsv(raw);
  const rawFields = repairScoreboardFields(originalFields);
  const numericValues = rawFields.map(toFiniteNumber);
  const scoreboardInfo = buildScoreboardInfoFromCompactRow(raw, rawFields, numericValues);
  const hasGluedBooleanField = originalFields.length === 18;
  const statIndex = COMPACT_SCOREBOARD_STAT_INDEX;
  const player = {
    playerId: numericValues[0] ?? null,
    playerIndex: numericValues[0] ?? null,
    teamId: numericValues[1] ?? null,
    squadId: numericValues[2] ?? null,
    lives: statIndex.dataLives != null ? (numericValues[statIndex.dataLives] ?? null) : null,
    kills: numericValues[statIndex.numKills] ?? null,
    vehicleKills: numericValues[statIndex.vehicleKills] ?? null,
    deaths: numericValues[statIndex.numDeaths] ?? null,
    woundeds: numericValues[statIndex.numWoundeds] ?? null,
    wounds: numericValues[statIndex.numWounds] ?? null,
    teamKills: numericValues[statIndex.numTeamKills] ?? null,
    healPoints: numericValues[statIndex.healPoints] ?? null,
    revivedPoints: numericValues[statIndex.revivedPoints] ?? null,
    teamworkScore: numericValues[statIndex.teamworkScore] ?? null,
    objectiveScore: numericValues[statIndex.objectiveScore] ?? null,
    combatScore: numericValues[statIndex.combatScore] ?? null,
    isAdmin: toScoreboardBoolean(numericValues[14]),
    // Compact rows with a glued 00/01/02 tail are not stable enough to trust for commander detection.
    isCommander: hasGluedBooleanField ? null : toScoreboardBoolean(numericValues[15]),
    fireTeamIndex: numericValues[16] ?? null,
    fireTeamPosition: numericValues[17] ?? null,
    raw,
    rawFields,
    playerScoreboard: scoreboardInfo,
  };
  return player;
}

function extractScoreboardRows(raw) {
  const source = String(raw ?? "").trim();
  if (!source) return [];
  if (!source.startsWith("{") && source.includes("}{")) {
    return source.replace(/}+$/g, "").split("}{");
  }
  const rows = extractBraceItems(source);
  if (rows.length > 0) return rows;
  const repairedFields = repairScoreboardFields(splitTopLevelCsv(source.replace(/}+$/g, "")));
  if (repairedFields.length > 19 && repairedFields.length % 19 === 0) {
    const chunkedRows = [];
    for (let index = 0; index < repairedFields.length; index += 19) {
      chunkedRows.push(repairedFields.slice(index, index + 19).join(","));
    }
    return chunkedRows;
  }
  return [source];
}

function repairScoreboardFields(rawFields) {
  const out = [];
  for (const field of rawFields) {
    const text = String(field ?? "").trim();
    const glued = text.match(/^(-?\d+)(-\d+)$/);
    if (glued) {
      out.push(glued[1], glued[2]);
      continue;
    }
    out.push(text);
  }
  if (
    out.length === 18
    && /^[01]{2}$/.test(String(out[15] ?? ""))
    && /^-?\d+$/.test(String(out[16] ?? ""))
    && /^-?\d+$/.test(String(out[17] ?? ""))
  ) {
    const pair = String(out[15]);
    out.splice(15, 1, pair[0], pair[1]);
  }
  return out;
}

const COMPACT_SCOREBOARD_STAT_INDEX = {
  dataLives: null,
  numKills: 3,
  vehicleKills: 4,
  numDeaths: 5,
  numWoundeds: 6,
  numWounds: 7,
  numTeamKills: 8,
  healPoints: 9,
  revivedPoints: 10,
  teamworkScore: 11,
  objectiveScore: 12,
  combatScore: 13,
};

function buildScoreboardInfoFromCompactRow(raw, values, numericValues) {
  const stats = {};
  const labeledValues = SCOREBOARD_FIELDS.map(([key, label]) => {
    const value = numericValues[COMPACT_SCOREBOARD_STAT_INDEX[key]] ?? null;
    stats[key] = value;
    return { key, label, value };
  });

  return {
    raw,
    values,
    numericValues,
    stats,
    labeledValues,
    extraValues: numericValues.slice(15),
  };
}

function parseSceneInfoLine(text) {
  return {
    type: "scene",
    captureZones: parseCompactCaptureZones(text),
    fobs: parseCompactFobs(text),
    mainZones: parseMainZones(text),
    rawFields: [],
  };
}

export function parseCaptureZones(text) {
  const source = String(text ?? "");
  const block = findNamedBlock(source, "CaptureZones");
  if (!block) return [];
  const zones = [];
  const zonePattern = /CaptureZone\{([^}]*)\}/g;
  let match = null;
  while ((match = zonePattern.exec(block.content)) !== null) {
    const raw = String(match[1] ?? "");
    const name = raw.split(",")[0]?.trim() ?? "";
    const positionMatch = raw.match(/Position:X=([-0-9.]+)\s+Y=([-0-9.]+)\s+Z=([-0-9.]+)/);
    zones.push({
      name,
      position: positionMatch ? {
        x: toFiniteNumber(positionMatch[1]),
        y: toFiniteNumber(positionMatch[2]),
        z: toFiniteNumber(positionMatch[3]),
      } : null,
      raw,
    });
  }
  return zones.filter((zone) => zone.name);
}

export function parseFobs(text) {
  const source = String(text ?? "");
  const block = findNamedBlock(source, "FOBs");
  if (!block) return [];
  const fobs = [];
  const fobPattern = /FobInfo\{([^}]*)\}/g;
  let match = null;
  while ((match = fobPattern.exec(block.content)) !== null) {
    const raw = String(match[1] ?? "");
    const fields = splitTopLevelCsv(raw);
    const map = parseKeyValueFields(fields);
    const posVal = map.Position;
    let position = null;
    if (posVal) {
      const positionMatch = posVal.match(/X=([-0-9.]+)\s+Y=([-0-9.]+)\s+Z=([-0-9.]+)/);
      if (positionMatch) {
        position = {
          x: toFiniteNumber(positionMatch[1]),
          y: toFiniteNumber(positionMatch[2]),
          z: toFiniteNumber(positionMatch[3]),
        };
      }
    }
    fobs.push({
      teamId: toFiniteNumber(map.TeamID),
      health: toFiniteNumber(map.Health),
      isBleeding: map.IsBleeding === "true",
      ammo: toFiniteNumber(map.Ammo),
      construction: toFiniteNumber(map.Construction),
      name: map.Name ?? "",
      position,
      raw,
    });
  }
  return fobs;
}

function parseCompactCaptureZones(text) {
  const section = extractDelimitedSceneSection(text, "CPZ:", ",FOBI:");
  if (!section) return [];
  return extractBraceItems(section).map((raw) => {
    const fields = splitTopLevelCsv(raw);
    return {
      name: fields[0] ?? "",
      isLocked: parseBooleanText(fields[1]),
      capturePercent: toFiniteNumber(fields[2]),
      captureDirection: toFiniteNumber(fields[3]),
      position: null,
      raw,
    };
  }).filter((zone) => zone.name);
}

function parseCompactFobs(text) {
  const section = extractDelimitedSceneSection(text, "FOBI:", ",MainZone:");
  if (!section) return [];
  return extractBraceItems(section).map((raw, index) => {
    const fields = splitTopLevelCsv(raw);
    const teamId = toFiniteNumber(fields[1]);
    return {
      fobId: fields[0] ? fields[0] : `team:${teamId ?? "unknown"}:index:${index}`,
      name: fields[0] ?? "",
      teamId,
      size: fields[2] ?? "",
      health: toFiniteNumber(fields[3]),
      ammo: toFiniteNumber(fields[4]),
      constructionPoints: toFiniteNumber(fields[5]),
      construction: toFiniteNumber(fields[5]),
      instigator: fields[6] ?? "",
      isBleeding: false,
      position: null,
      raw,
    };
  });
}

function parseMainZones(text) {
  const section = extractDelimitedSceneSection(text, "MainZone:", "");
  if (!section) return [];
  return extractBraceItems(section).map((raw) => {
    const commaIndex = raw.indexOf(",");
    const teamText = commaIndex >= 0 ? raw.slice(0, commaIndex) : raw;
    const vectorText = commaIndex >= 0 ? raw.slice(commaIndex + 1) : "";
    return {
      teamId: toFiniteNumber(teamText),
      position: parseVectorBlock(vectorText),
      raw,
    };
  }).filter((zone) => zone.teamId != null || zone.position);
}

function extractDelimitedSceneSection(text, startToken, endToken) {
  const source = String(text ?? "");
  const start = source.indexOf(startToken);
  if (start < 0) return "";
  const contentStart = start + startToken.length;
  const end = endToken ? source.indexOf(endToken, contentStart) : -1;
  return source.slice(contentStart, end >= 0 ? end : source.length).trim();
}

function extractLineBlock(text, name) {
  const source = String(text ?? "");
  const startToken = `${name}{`;
  const start = source.indexOf(startToken);
  if (start < 0) return null;
  const contentStart = start + startToken.length;
  let depth = 1;
  for (let index = contentStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          start,
          end: index + 1,
          content: source.slice(contentStart, index),
        };
      }
    }
  }
  return {
    start,
    end: source.length,
    content: source.slice(contentStart).replace(/}+$/g, ""),
  };
}

function extractCompactLineTail(text, name) {
  const source = String(text ?? "");
  const startToken = `${name}{`;
  const start = source.indexOf(startToken);
  if (start < 0) return "";
  return source.slice(start + startToken.length).trim();
}

function extractBraceItems(text) {
  const items = [];
  const source = String(text ?? "");
  let depth = 0;
  let itemStart = -1;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      if (depth === 0) itemStart = index + 1;
      depth += 1;
      continue;
    }
    if (char === "}") {
      if (depth > 0) depth -= 1;
      if (depth === 0 && itemStart >= 0) {
        items.push(source.slice(itemStart, index));
        itemStart = -1;
      }
    }
  }
  return items;
}

function extractRawLogLine(input) {
  if (typeof input === "string") return input;
  return String(input?.rawLog ?? input?.rawEvent?.Raw ?? input?.sourceRaw ?? input?.raw ?? input?.message ?? "").trim();
}

function hashText(text) {
  return createHash("sha1").update(String(text ?? "")).digest("hex");
}

function parseBooleanText(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "true" || text === "1") return true;
  if (text === "false" || text === "0") return false;
  return null;
}

function toScoreboardBoolean(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number === 1;
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

function parseVehicleInfo(text) {
  const match = String(text ?? "").match(/\{VehicleType:([^{},]+?)(?:,\s*|\s*)Health:([0-9./]+)(?:[^{}]*?)\}/);
  if (!match) {
    return {
      raw: "",
      vehicleType: "",
      healthText: "",
      health: null,
      maxHealth: null,
      position: null,
      rotation: null,
    };
  }
  const healthText = String(match[2] ?? "").trim();
  const [health, maxHealth] = healthText.split("/").map(toFiniteNumber);

  let position = null;
  const posMatch = match[0].match(/Position:X=([-0-9.]+)\s+Y=([-0-9.]+)\s+Z=([-0-9.]+)/);
  if (posMatch) {
    position = {
      x: toFiniteNumber(posMatch[1]),
      y: toFiniteNumber(posMatch[2]),
      z: toFiniteNumber(posMatch[3]),
    };
  }

  let rotation = null;
  const rotMatch = match[0].match(/Rotation:P=([-0-9.]+)\s+Y=([-0-9.]+)\s+R=([-0-9.]+)/);
  if (rotMatch) {
    rotation = {
      x: toFiniteNumber(rotMatch[1]),
      y: toFiniteNumber(rotMatch[3]),
      z: toFiniteNumber(rotMatch[2]),
    };
  }

  return {
    raw: match[0],
    vehicleType: String(match[1] ?? "").trim(),
    healthText,
    health: health ?? null,
    maxHealth: maxHealth ?? null,
    position,
    rotation,
  };
}

function parseTeamId(segment, baseMap, baseFields, context = "") {
  const source = `${String(context ?? "")}${String(segment ?? "")}`;
  const matches = [...source.matchAll(/TeamID:(-?\d+)/ig)];
  if (matches.length > 0) {
    return toFiniteNumber(matches[matches.length - 1][1]);
  }
  return toFiniteNumber(baseMap.TeamID ?? baseMap.TeamId ?? baseFields[3]);
}

function parseTeamAndSquadInfo(context, segment, baseMap, baseFields) {
  const sourceContext = String(context ?? "");
  const sourceSegment = String(segment ?? "");
  const squadContextMatch = sourceContext.match(/SquadBaseInfo\{([^}]*)\}/i);
  const squadSegmentMatch = sourceSegment.match(/SquadBaseInfo\{([^}]*)\}/i);
  const squadRaw = squadSegmentMatch?.[1] ?? squadContextMatch?.[1] ?? "";
  const squadMap = parseKeyValueFields(splitTopLevelCsv(squadRaw));
  const teamId = parseTeamId(segment, baseMap, baseFields, context);
  const squadId = toFiniteNumber(
    squadMap.ID
    ?? squadMap.SquadID
    ?? squadMap.SquadId
    ?? baseMap.SquadID
    ?? baseMap.SquadId
    ?? baseFields[4],
  );
  return { teamId, squadId };
}

function findPlayerContextStart(source, playerBaseIndex) {
  const searchStart = Math.max(0, playerBaseIndex - 4096);
  let contextStart = searchStart;
  for (const needle of ["TeamID{", "TeamID:", "SquadInfo{", "SquadBaseInfo{"]) {
    const found = source.lastIndexOf(needle, playerBaseIndex);
    if (found >= searchStart && found >= 0) {
      contextStart = Math.min(contextStart, found);
    }
  }
  return contextStart;
}

function findBzssCoreContextStart(data, startIndex) {
  const searchWindow = Math.max(0, startIndex - 8192);
  let contextStart = startIndex;
  for (const needle of ["TeamID{", "TeamID:", "SquadInfo{", "SquadBaseInfo{"]) {
    const found = data.lastIndexOf(Buffer.from(needle, "utf16le"), startIndex);
    if (found >= searchWindow && found >= 0) {
      contextStart = Math.min(contextStart, found);
    }
  }
  return contextStart;
}

function parseScoreboardInfo(rawText) {
  const raw = String(rawText ?? "");
  const normalized = normalizeScoreboardText(raw);
  const values = splitTopLevelCsv(normalized);
  const valuesByKey = parseKeyValueFields(values);
  const numericValues = values.map((value) => {
    const text = String(value ?? "").trim();
    const separator = text.indexOf(":");
    const normalizedValue = separator > 0 ? text.slice(separator + 1).trim() : text;
    return toFiniteNumber(normalizedValue);
  });
  const scoreStats = parseScoreboardStats(valuesByKey, numericValues);
  return {
    raw,
    values,
    numericValues,
    stats: scoreStats.stats,
    labeledValues: scoreStats.labeledValues,
    extraValues: scoreStats.extraValues,
    valuesByKey,
  };
}

function parseScoreboardStats(valuesByKey, values) {
  const hasExplicitTailKeys = [
    "numTeamKills",
    "healPoints",
    "revivedPoints",
    "teamworkScore",
    "objectiveScore",
    "combatScore",
  ].some((key) => {
    const aliases = SCOREBOARD_FIELD_ALIASES[key] ?? [];
    return aliases.some((alias) => valuesByKey?.[alias] != null);
  });
  const isMissingTeamKillLayout = !hasExplicitTailKeys && values.length === SCOREBOARD_FIELDS.length - 1;
  const fallbackIndexByKey = isMissingTeamKillLayout
    ? {
        dataLives: 0,
        numKills: 1,
        vehicleKills: null,
        numDeaths: 2,
        numWoundeds: 3,
        numWounds: 4,
        numTeamKills: null,
        healPoints: 5,
        revivedPoints: 6,
        teamworkScore: 7,
        objectiveScore: 8,
        combatScore: 9,
      }
    : null;
  const stats = {};
  const labeledValues = SCOREBOARD_FIELDS.map(([key, label], index) => {
    const aliases = SCOREBOARD_FIELD_ALIASES[key] ?? [];
    const fallbackIndex = fallbackIndexByKey ? fallbackIndexByKey[key] : index;
    const value = pickFirstFiniteNumber([
      ...(aliases.map((alias) => valuesByKey?.[alias])),
      fallbackIndex != null ? values[fallbackIndex] : null,
    ]);
    stats[key] = value;
    return {
      key,
      label,
      value,
    };
  });
  return {
    stats,
    labeledValues,
    extraValues: values.slice(SCOREBOARD_FIELDS.length),
  };
}

function normalizeScoreboardText(text) {
  return String(text ?? "").replace(/(\d)([A-Z][A-Za-z0-9_]*:)/g, "$1,$2");
}

function pickFirstFiniteNumber(values) {
  for (const value of values) {
    const number = toFiniteNumber(value);
    if (number != null) return number;
  }
  return null;
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

function toFiniteNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBooleanNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (parsed === 1) return true;
  if (parsed === 0) return false;
  return null;
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
