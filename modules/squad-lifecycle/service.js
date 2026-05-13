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

    const activeState = await this.repository.getActiveByRuntimeKey(runtimeKey);
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
    return states.filter((x) => x.status === "ACTIVE");
  }
}
