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
  if (eventName !== "On_SquadCreated" && eventName !== "SQUAD_CREATED") {
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
    eventTime,
    squadId,
    squadName,
    factionName,
    creatorName,
    creatorSteamId,
    creatorEosId,
    rawLog: String(event.rawLog ?? event.sourceRaw ?? event.raw ?? ""),
    sourceEventId: String(event.sourceEventId ?? event.eventId ?? ""),
    teamId,
    needsTeamId: teamId == null,
    needsMatchId: !matchId,
  };
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
