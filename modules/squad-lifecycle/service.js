// -*- coding: utf-8 -*-

import { makeSquadRuntimeKey } from "./keys.js";
import { SquadLifecycleReducer } from "./reducer.js";
import { SquadSnapshotValidator } from "./snapshot-validator.js";

export class SquadLifecycleService {
  constructor(config, repository, eventBus, logger = console) {
    this.config = config;
    this.repository = repository;
    this.eventBus = eventBus;
    this.logger = logger;
    this.reducer = new SquadLifecycleReducer(config);
    this.validator = new SquadSnapshotValidator(config);
    this.lastMatchByServer = new Map();
  }

  async handleSquadCreateLogEvent(logEvent) {
    if (!this.config.enabled) return;

    const runtimeKey = makeSquadRuntimeKey({
      serverId: logEvent.serverId,
      matchId: logEvent.matchId,
      teamId: logEvent.teamId,
      squadId: logEvent.squadId,
    });

    let activeState = await this.repository.getActiveByRuntimeKey(runtimeKey);

    if (activeState?.status === "MISSING_CANDIDATE") {
      const now = Number(logEvent.eventTime || Date.now());
      const disbanded = {
        ...activeState,
        status: "DISBANDED",
        disbandedAt: now,
        closedAt: now,
        closeReason: "DISBANDED",
        disbandSource: "LOG_RECREATE",
        updatedAt: now,
      };

      await this.repository.saveState(disbanded);

      const disbandEvent = this.reducer.makeEvent({
        state: disbanded,
        eventType: "squad.disbanded",
        eventTime: now,
        source: "LOG",
        confidence: "HIGH",
        payload: {
          reason: "log_create_after_missing_treated_as_new_generation",
          previousLifecycleId: activeState.lifecycleId,
          previousGeneration: activeState.generation,
        },
        rawLog: logEvent.rawLog,
        rawSourceEventId: logEvent.sourceEventId ?? null,
      });

      await this.repository.saveEvent(disbandEvent);
      await this.eventBus.emitSquadLifecycleEvent(disbandEvent);
      activeState = null;
    }

    const nextGeneration = await this.repository.getNextGeneration({
      serverId: logEvent.serverId,
      matchId: logEvent.matchId,
      runtimeKey,
    });

    const result = await this.reducer.createOrUpdateFromLog({
      logEvent,
      activeState,
      nextGeneration,
    });

    await this.repository.saveState(result.state);

    for (const event of result.events) {
      await this.repository.saveEvent(event);
      await this.eventBus.emitSquadLifecycleEvent(event);
    }

    if (this.config.debug) {
      this.logger.info?.("[SquadLifecycle] handleSquadCreateLogEvent", {
        runtimeKey,
        lifecycleId: result.state.lifecycleId,
        status: result.state.status,
        events: result.events.map((x) => x.eventType),
      });
    }
  }

  async handleRconSnapshot(snapshot) {
    if (!this.config.enabled) return;

    const previousMatchId = this.lastMatchByServer.get(snapshot.serverId);
    if (
      this.config.closeSquadsOnMatchEnd
      && previousMatchId
      && previousMatchId !== snapshot.matchId
    ) {
      await this.handleMatchEnded({
        serverId: snapshot.serverId,
        matchId: previousMatchId,
        endedAt: snapshot.capturedAt,
      });
    }
    this.lastMatchByServer.set(snapshot.serverId, snapshot.matchId);

    const validation = this.validator.validate(snapshot);
    if (!validation.ok) {
      if (this.config.debug) {
        this.logger.warn?.("[SquadLifecycle] Skip invalid RCON snapshot", {
          serverId: snapshot?.serverId,
          matchId: snapshot?.matchId,
          reason: validation.reason,
          squadCount: snapshot?.squads?.length,
          playerCount: snapshot?.playerCount,
          isMatchChanging: snapshot?.isMatchChanging,
        });
      }
      return;
    }

    const activeStates = await this.repository.getActiveByMatch(snapshot.serverId, snapshot.matchId);

    const result = await this.reducer.applyRconSnapshot({
      snapshot,
      activeStates,
      getNextGeneration: async (runtimeKey) => this.repository.getNextGeneration({
        serverId: snapshot.serverId,
        matchId: snapshot.matchId,
        runtimeKey,
      }),
    });

    for (const state of result.statesToSave) {
      await this.repository.saveState(state);
    }

    for (const event of result.events) {
      await this.repository.saveEvent(event);
      await this.eventBus.emitSquadLifecycleEvent(event);
    }

    if (this.config.debug) {
      this.logger.info?.("[SquadLifecycle] handleRconSnapshot", {
        serverId: snapshot.serverId,
        matchId: snapshot.matchId,
        squadCount: snapshot.squads.length,
        savedStates: result.statesToSave.length,
        events: result.events.map((x) => x.eventType),
      });
    }
  }

  async handleMatchEnded(input) {
    if (!this.config.enabled) return;

    const closedAt = input.endedAt ?? Date.now();
    const closedStates = await this.repository.markClosedByMatchEnd({
      serverId: input.serverId,
      matchId: input.matchId,
      closedAt,
    });

    const events = this.reducer.makeClosedByMatchEndEvents({
      states: closedStates,
      closedAt,
    });

    for (const event of events) {
      await this.repository.saveEvent(event);
      await this.eventBus.emitSquadLifecycleEvent(event);
    }

    if (this.config.debug) {
      this.logger.info?.("[SquadLifecycle] handleMatchEnded", {
        serverId: input.serverId,
        matchId: input.matchId,
        closedStates: closedStates.length,
      });
    }
  }

  async getCurrentSquads(input) {
    const states = await this.repository.getActiveByMatch(input.serverId, input.matchId);
    return formatOrderedSquads(states);
  }

  async getOrderedCurrentSquads(input) {
    const states = await this.repository.getActiveByMatch(input.serverId, input.matchId);
    return formatOrderedSquads(states);
  }

  async getTimeline(input) {
    const limit = Number(input.limit ?? 300);
    const events = await this.repository.getEventsByMatch(input.serverId, input.matchId, limit);
    return events.map((event) => ({
      id: event.id,
      type: event.eventType,
      time: new Date(event.eventTime || event.createdAt || Date.now()).toISOString(),
      lifecycleId: event.lifecycleId,
      runtimeKey: event.runtimeKey,
      teamId: event.payload?.teamId ?? null,
      squadId: event.payload?.squadId ?? null,
      generation: event.payload?.generation ?? null,
      squadName: event.payload?.squadName ?? "",
      message: buildSquadTimelineMessage(event),
      raw: event,
    }));
  }
}

function formatOrderedSquads(states) {
  return states
    .slice()
    .filter((x) => x.status === "ACTIVE")
    .sort((a, b) => {
      const at = Number(a.createdAt || a.firstSeenAt || 0);
      const bt = Number(b.createdAt || b.firstSeenAt || 0);

      if (at !== bt) return at - bt;

      const teamDiff = Number(a.teamId) - Number(b.teamId);
      if (teamDiff !== 0) return teamDiff;

      const squadDiff = Number(a.squadId) - Number(b.squadId);
      if (squadDiff !== 0) return squadDiff;

      return Number(a.generation) - Number(b.generation);
    })
    .map((squad, index) => {
      const createdAtMs = Number(squad.createdAt || squad.firstSeenAt || 0);
      const createdAtIso = createdAtMs > 0 ? new Date(createdAtMs).toISOString() : "";
      const createSource = squad.createSource || squad.creationSource || "RCON_SNAPSHOT";
      const confidence = squad.confidence || squad.creationConfidence || "MEDIUM";

      return {
        ...squad,
        order: index + 1,
        createdAt: createdAtIso,
        createdAtMs,
        createdAtLabel: formatTimeLabel(createdAtMs),
        creationSource: createSource,
        creationConfidence: confidence,
        sourceLabel: createSource === "LOG" ? "日志确认" : "RCON首次发现",
        createdDisplayText: createSource === "LOG"
          ? `创建于 ${formatTimeLabel(createdAtMs)}`
          : `首次发现于 ${formatTimeLabel(createdAtMs)}`,
      };
    });
}

function formatTimeLabel(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return "--:--:--";

  const date = new Date(ms);
  return date.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function buildSquadTimelineMessage(event) {
  const payload = event.payload ?? {};
  const teamId = payload.teamId ?? "?";
  const squadId = payload.squadId ?? "?";
  const squadName = payload.squadName ? ` ${payload.squadName}` : "";

  if (event.eventType === "squad.created") {
    return `Team${teamId} Squad${squadId}${squadName} 创建`;
  }

  if (event.eventType === "squad.disbanded") {
    return `Team${teamId} Squad${squadId}${squadName} 解散`;
  }

  if (event.eventType === "squad.closed_by_match_end") {
    return `Team${teamId} Squad${squadId}${squadName} 因回合结束关闭`;
  }

  if (event.eventType === "squad.recovered") {
    return `Team${teamId} Squad${squadId}${squadName} 恢复`;
  }

  return `Team${teamId} Squad${squadId}${squadName} 更新`;
}

