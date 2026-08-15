// -*- coding: utf-8 -*-

import { getParam } from "../../core/event-normalizer.js";

export function parseSquadCreateEvent(event) {
  if (!event || typeof event !== "object") return null;

  const eventName = String(
    event.eventName
      ?? event.Event
      ?? event.rawEvent?.Event
      ?? event.rawEvent?.eventName
      ?? "",
  ).trim();
  if (eventName !== "On_SquadCreated" && eventName !== "SQUAD_CREATED" && eventName !== "On_RawLogLine") {
    return null;
  }

  const serverId = String(event.serverId ?? getParam(event, "ServerID") ?? "").trim();
  const matchId = String(
    event.matchId
      ?? event.sessionId
      ?? getParam(event, "SessionID")
      ?? getParam(event, "MatchID")
      ?? "",
  ).trim();
  const squadId = toNumber(
    event.squadId
      ?? getParam(event, "SquadID")
      ?? getParam(event, "SquadId"),
  );

  if (eventName === "On_RawLogLine") {
    const rawLog = String(event.rawLog ?? event.rawEvent?.Raw ?? event.sourceRaw ?? event.raw ?? "").trim();
    const parsed = parseRawSquadCreateLog(rawLog);
    if (!serverId || !parsed) return null;

    return {
      serverId,
      matchId: matchId || null,
      sourceMode: String(event.sourceMode ?? event.SourceMode ?? event.rawEvent?.SourceMode ?? "live"),
      canTriggerActions: normalizeBoolean(event.canTriggerActions ?? event.CanTriggerActions ?? event.rawEvent?.CanTriggerActions, true),
      eventTime: parseRawLogTimestamp(rawLog) ?? String(
        event.eventTime
          ?? event.time
          ?? getParam(event, "Time")
          ?? new Date().toISOString(),
      ).trim(),
      squadId: parsed.squadId,
      squadName: parsed.squadName,
      factionName: parsed.factionName,
      creatorName: parsed.creatorName,
      creatorSteamId: parsed.creatorSteamId,
      creatorEosId: parsed.creatorEosId,
      rawLog,
      sourceEventId: String(event.sourceEventId ?? event.eventId ?? event.rawEvent?.EventId ?? event.rawEvent?.eventId ?? ""),
      sourceFile: String(event.sourceFile ?? ""),
      sourceFileId: String(event.sourceFileId ?? ""),
      sourceOffset: toNumber(event.sourceOffset),
      isReplay: event.isReplay === true,
      teamId: null,
      needsTeamId: true,
      needsMatchId: !matchId,
      parsedFromRawLogLine: true,
    };
  }

  if (!serverId || squadId == null) {
    return null;
  }

  const eventTime = String(
    event.eventTime
      ?? event.time
      ?? getParam(event, "Time")
      ?? new Date().toISOString(),
  ).trim();

  const squadName = String(
    event.squadName
      ?? getParam(event, "SquadName")
      ?? "",
  ).trim();

  const creatorName = String(
    event.creatorName
      ?? event.playerName
      ?? getParam(event, "PlayerName")
      ?? "",
  ).trim();

  const creatorSteamId = String(
    event.creatorSteamId
      ?? event.steamID
      ?? getParam(event, "Steam64ID")
      ?? getParam(event, "SteamID")
      ?? "",
  ).trim();

  const creatorEosId = String(
    event.creatorEosId
      ?? event.eosID
      ?? getParam(event, "EOSID")
      ?? "",
  ).trim();

  const factionName = String(
    event.factionName
      ?? getParam(event, "FactionName")
      ?? getParam(event, "TeamName")
      ?? "",
  ).trim();

  const teamId = toNumber(
    event.teamId
      ?? getParam(event, "TeamID")
      ?? getParam(event, "TeamId")
      ?? getParam(event, "teamID")
      ?? getParam(event, "teamId"),
  );

    return {
      serverId,
      matchId: matchId || null,
      sourceMode: String(event.sourceMode ?? event.SourceMode ?? event.rawEvent?.SourceMode ?? "live"),
      canTriggerActions: normalizeBoolean(event.canTriggerActions ?? event.CanTriggerActions ?? event.rawEvent?.CanTriggerActions, true),
      eventTime,
      squadId,
      squadName,
    factionName,
    creatorName,
    creatorSteamId,
    creatorEosId,
    rawLog: String(event.rawLog ?? event.sourceRaw ?? event.raw ?? ""),
    sourceEventId: String(event.sourceEventId ?? event.eventId ?? ""),
    sourceFile: String(event.sourceFile ?? ""),
    sourceFileId: String(event.sourceFileId ?? ""),
    sourceOffset: toNumber(event.sourceOffset),
    isReplay: event.isReplay === true,
    teamId,
    needsTeamId: teamId == null,
    needsMatchId: !matchId,
    parsedFromRawLogLine: false,
  };
}

export function parseReplaySquadCreateLine(rawLog, metadata = {}) {
  return parseSquadCreateEvent({
    eventName: "On_RawLogLine",
    serverId: metadata.serverId,
    matchId: metadata.matchId,
    sourceMode: "replay",
    isReplay: true,
    canTriggerActions: false,
    rawLog,
    sourceFile: metadata.sourceFile,
    sourceFileId: metadata.sourceFileId,
    sourceOffset: metadata.sourceOffset,
    sourceEventId: `squadcreate:${String(metadata.sourceFileId ?? "unknown")}:${Number(metadata.sourceOffset) || 0}`,
  });
}

export function normalizeSquadName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "true" || text === "1" || text === "yes") return true;
  if (text === "false" || text === "0" || text === "no") return false;
  return fallback;
}

function parseRawSquadCreateLog(rawLog) {
  const text = String(rawLog ?? "");
  if (!text) return null;

  const match = text.match(/LogSquad:\s*(.+?)\s*\(Online IDs:\s*EOS:\s*([^\s)]+)\s*steam:\s*([^\s)]+)\)\s*has created Squad\s*(\d+)\s*\(Squad Name:\s*(.+?)\)\s*on\s*(.+?)\s*$/i);
  if (!match) return null;

  return {
    creatorName: match[1].trim(),
    creatorEosId: match[2].trim(),
    creatorSteamId: match[3].trim(),
    squadId: toNumber(match[4]),
    squadName: match[5].trim(),
    factionName: match[6].trim(),
  };
}

function parseRawLogTimestamp(rawLog) {
  const text = String(rawLog ?? "");
  const match = text.match(/\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2}):(\d{3})\]/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number(match[7]);

  const date = new Date(year, month, day, hour, minute, second, millisecond);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
