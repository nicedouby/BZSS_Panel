// -*- coding: utf-8 -*-

import { getParam } from "../../core/event-normalizer.js";

export class SquadLogAdapter {
  constructor(lifecycleService, options = {}) {
    this.lifecycleService = lifecycleService;
    this.resolveMatchContext = options.resolveMatchContext;
    this.findTeamIdForSquad = options.findTeamIdForSquad;
    this.logger = options.logger ?? console;
    this.debug = Boolean(options.debug);
  }

  async onCoreSquadCreatedEvent(event) {
    const parsed = this.parseSquadCreateEvent(event);
    if (!parsed) return;

    await this.lifecycleService.handleSquadCreateLogEvent(parsed);
  }

  parseSquadCreateEvent(event) {
    const serverId = String(event?.serverId ?? "").trim();
    if (!serverId) return null;

    const rawTeamId =
      firstFiniteNumber([
        getParam(event, "TeamID"),
        getParam(event, "TeamId"),
        getParam(event, "Team"),
        event?.teamID,
        event?.teamId,
      ]);

    const squadId = firstFiniteNumber([
      getParam(event, "SquadID"),
      getParam(event, "SquadId"),
      event?.squadID,
      event?.squadId,
    ]);

    if (!Number.isFinite(squadId)) return null;

    const squadName = String(
      getParam(event, "SquadName")
      || event?.squadName
      || "",
    ).trim();

    const creatorName = String(
      getParam(event, "PlayerName")
      || event?.playerName
      || "",
    ).trim() || null;

    const creatorSteamId = String(
      getParam(event, "Steam64ID")
      || event?.steamID
      || "",
    ).trim() || null;

    const creatorEosId = String(
      getParam(event, "EOSID")
      || event?.eosID
      || "",
    ).trim() || null;

    const context = this.resolveMatchContext?.(serverId) ?? null;
    const matchId = String(context?.matchId ?? "").trim();
    if (!matchId) return null;

    let teamId = rawTeamId;
    if (!Number.isFinite(teamId)) {
      teamId = this.findTeamIdForSquad?.({
        serverId,
        squadId,
        squadName,
      }) ?? null;
    }

    if (!Number.isFinite(teamId)) {
      if (this.debug) {
        this.logger.warn?.("[SquadLifecycle] skip squad create event because teamId is missing", {
          serverId,
          matchId,
          squadId,
          squadName,
          eventName: event?.eventName,
        });
      }
      return null;
    }

    const eventTime = toEpochMs(event?.time) || Date.now();

    return {
      serverId,
      matchId,
      eventTime,
      teamId,
      squadId,
      squadName,
      creatorName,
      creatorSteamId,
      creatorEosId,
      rawLog: String(event?.rawLog ?? event?.rawEvent?.Raw ?? ""),
      sourceEventId: String(event?.eventId ?? "").trim() || null,
    };
  }
}

function firstFiniteNumber(values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toEpochMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}
