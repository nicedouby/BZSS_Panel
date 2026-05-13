// -*- coding: utf-8 -*-

import { makeEventId } from "./event-id.js";
import { makeSquadLifecycleId, makeSquadRuntimeKey } from "./keys.js";

export class SquadLifecycleReducer {
  constructor(config) {
    this.config = config;
  }

  async createOrUpdateFromLog(input) {
    const { logEvent, activeState } = input;
    const now = Date.now();

    const runtimeKey = makeSquadRuntimeKey({
      serverId: logEvent.serverId,
      matchId: logEvent.matchId,
      teamId: logEvent.teamId,
      squadId: logEvent.squadId,
    });

    if (activeState) {
      const updated = {
        ...activeState,
        squadName: logEvent.squadName || activeState.squadName,
        creatorName: logEvent.creatorName ?? activeState.creatorName ?? null,
        creatorSteamId: logEvent.creatorSteamId ?? activeState.creatorSteamId ?? null,
        creatorEosId: logEvent.creatorEosId ?? activeState.creatorEosId ?? null,
        createSource: this.config.preferLogCreateEvent ? "LOG" : activeState.createSource,
        confidence: "HIGH",
        createdAt: this.config.preferLogCreateEvent && activeState.createSource === "RCON_SNAPSHOT"
          ? logEvent.eventTime
          : activeState.createdAt,
        updatedAt: now,
      };

      const event = this.makeEvent({
        state: updated,
        eventType: "squad.updated",
        eventTime: logEvent.eventTime,
        source: "LOG",
        confidence: "HIGH",
        payload: {
          reason: "log_create_event_matched_existing_state",
          squadName: logEvent.squadName,
          creatorName: logEvent.creatorName ?? null,
          creatorSteamId: logEvent.creatorSteamId ?? null,
          creatorEosId: logEvent.creatorEosId ?? null,
        },
        rawLog: logEvent.rawLog,
        rawSourceEventId: logEvent.sourceEventId ?? null,
      });

      return {
        state: updated,
        events: [event],
      };
    }

    const generation = input.nextGeneration;
    const lifecycleId = makeSquadLifecycleId({
      serverId: logEvent.serverId,
      matchId: logEvent.matchId,
      teamId: logEvent.teamId,
      squadId: logEvent.squadId,
      generation,
    });

    const state = {
      lifecycleId,
      runtimeKey,
      serverId: logEvent.serverId,
      matchId: logEvent.matchId,
      teamId: logEvent.teamId,
      squadId: logEvent.squadId,
      generation,
      squadName: logEvent.squadName,
      leaderName: logEvent.creatorName ?? null,
      leaderSteamId: logEvent.creatorSteamId ?? null,
      leaderEosId: logEvent.creatorEosId ?? null,
      creatorName: logEvent.creatorName ?? null,
      creatorSteamId: logEvent.creatorSteamId ?? null,
      creatorEosId: logEvent.creatorEosId ?? null,
      memberCount: null,
      locked: null,
      status: "ACTIVE",
      createdAt: logEvent.eventTime,
      firstSeenAt: now,
      lastSeenAt: now,
      missingSince: null,
      missingCount: 0,
      disbandedAt: null,
      closedAt: null,
      closeReason: null,
      createSource: "LOG",
      disbandSource: null,
      confidence: "HIGH",
      updatedAt: now,
    };

    return {
      state,
      events: [this.makeEvent({
        state,
        eventType: "squad.created",
        eventTime: logEvent.eventTime,
        source: "LOG",
        confidence: "HIGH",
        payload: {
          squadName: logEvent.squadName,
          creatorName: logEvent.creatorName ?? null,
          creatorSteamId: logEvent.creatorSteamId ?? null,
          creatorEosId: logEvent.creatorEosId ?? null,
        },
        rawLog: logEvent.rawLog,
        rawSourceEventId: logEvent.sourceEventId ?? null,
      })],
    };
  }

  async applyRconSnapshot(input) {
    const now = input.snapshot.capturedAt || Date.now();
    const statesToSave = [];
    const events = [];

    const snapshotByRuntimeKey = new Map();
    for (const item of input.snapshot.squads) {
      const runtimeKey = makeSquadRuntimeKey({
        serverId: item.serverId,
        matchId: item.matchId,
        teamId: item.teamId,
        squadId: item.squadId,
      });
      snapshotByRuntimeKey.set(runtimeKey, item);
    }

    const activeByRuntimeKey = new Map();
    for (const state of input.activeStates) {
      activeByRuntimeKey.set(state.runtimeKey, state);
    }

    for (const [runtimeKey, item] of snapshotByRuntimeKey.entries()) {
      const existing = activeByRuntimeKey.get(runtimeKey);
      if (existing) {
        const wasMissing = existing.status === "MISSING_CANDIDATE";
        const meaningfulChange = hasMeaningfulSquadChange(existing, item);

        const updated = {
          ...existing,
          squadName: item.squadName || existing.squadName,
          leaderName: item.leaderName ?? existing.leaderName ?? null,
          leaderSteamId: item.leaderSteamId ?? existing.leaderSteamId ?? null,
          leaderEosId: item.leaderEosId ?? existing.leaderEosId ?? null,
          memberCount: item.memberCount ?? existing.memberCount ?? null,
          locked: item.locked ?? existing.locked ?? null,
          status: "ACTIVE",
          lastSeenAt: now,
          missingSince: null,
          missingCount: 0,
          updatedAt: now,
        };

        statesToSave.push(updated);

        if (wasMissing || meaningfulChange) {
          events.push(this.makeEvent({
            state: updated,
            eventType: wasMissing ? "squad.recovered" : "squad.updated",
            eventTime: now,
            source: "RCON",
            confidence: existing.confidence,
            payload: {
              reason: wasMissing
                ? "squad_reappeared_before_disband_confirmed"
                : "rcon_snapshot_update",
              squadName: item.squadName,
              leaderName: item.leaderName ?? null,
              memberCount: item.memberCount ?? null,
              locked: item.locked ?? null,
            },
          }));
        }

        continue;
      }

      if (this.config.createFromRconSnapshot) {
        const generation = await input.getNextGeneration(runtimeKey);

        const lifecycleId = makeSquadLifecycleId({
          serverId: item.serverId,
          matchId: item.matchId,
          teamId: item.teamId,
          squadId: item.squadId,
          generation,
        });

        const state = {
          lifecycleId,
          runtimeKey,
          serverId: item.serverId,
          matchId: item.matchId,
          teamId: item.teamId,
          squadId: item.squadId,
          generation,
          squadName: item.squadName,
          leaderName: item.leaderName ?? null,
          leaderSteamId: item.leaderSteamId ?? null,
          leaderEosId: item.leaderEosId ?? null,
          creatorName: null,
          creatorSteamId: null,
          creatorEosId: null,
          memberCount: item.memberCount ?? null,
          locked: item.locked ?? null,
          status: "ACTIVE",
          createdAt: now,
          firstSeenAt: now,
          lastSeenAt: now,
          missingSince: null,
          missingCount: 0,
          disbandedAt: null,
          closedAt: null,
          closeReason: null,
          createSource: "RCON_SNAPSHOT",
          disbandSource: null,
          confidence: "MEDIUM",
          updatedAt: now,
        };

        statesToSave.push(state);
        events.push(this.makeEvent({
          state,
          eventType: "squad.created",
          eventTime: now,
          source: "RCON",
          confidence: "MEDIUM",
          payload: {
            reason: "rcon_snapshot_found_new_squad",
            squadName: item.squadName,
            leaderName: item.leaderName ?? null,
            memberCount: item.memberCount ?? null,
            locked: item.locked ?? null,
          },
        }));
      }
    }

    for (const existing of input.activeStates) {
      const stillExists = snapshotByRuntimeKey.has(existing.runtimeKey);
      if (stillExists) continue;

      const nextMissingCount = existing.missingCount + 1;

      if (nextMissingCount < this.config.missingConfirmCount) {
        const missing = {
          ...existing,
          status: "MISSING_CANDIDATE",
          missingSince: existing.missingSince ?? now,
          missingCount: nextMissingCount,
          updatedAt: now,
        };

        statesToSave.push(missing);
        events.push(this.makeEvent({
          state: missing,
          eventType: "squad.missing_candidate",
          eventTime: now,
          source: "RCON",
          confidence: "LOW",
          payload: {
            reason: "squad_missing_in_rcon_snapshot",
            missingCount: nextMissingCount,
            requiredMissingCount: this.config.missingConfirmCount,
          },
        }));

        continue;
      }

      const disbanded = {
        ...existing,
        status: "DISBANDED",
        missingCount: nextMissingCount,
        missingSince: existing.missingSince ?? now,
        disbandedAt: now,
        closedAt: now,
        closeReason: "DISBANDED",
        disbandSource: "RCON_DIFF",
        updatedAt: now,
      };

      statesToSave.push(disbanded);
      events.push(this.makeEvent({
        state: disbanded,
        eventType: "squad.disbanded",
        eventTime: now,
        source: "RCON",
        confidence: "MEDIUM",
        payload: {
          reason: "squad_absent_for_confirmed_snapshots",
          missingCount: nextMissingCount,
          requiredMissingCount: this.config.missingConfirmCount,
          missingSince: disbanded.missingSince,
          disbandedAt: disbanded.disbandedAt,
        },
      }));
    }

    return {
      statesToSave,
      events,
    };
  }

  makeClosedByMatchEndEvents(input) {
    return input.states.map((state) => this.makeEvent({
      state,
      eventType: "squad.closed_by_match_end",
      eventTime: input.closedAt,
      source: "SYSTEM",
      confidence: "HIGH",
      payload: {
        reason: "match_ended",
        closedAt: input.closedAt,
      },
    }));
  }

  makeEvent(input) {
    return {
      id: makeEventId("squad_evt"),
      serverId: input.state.serverId,
      matchId: input.state.matchId,
      lifecycleId: input.state.lifecycleId,
      runtimeKey: input.state.runtimeKey,
      eventType: input.eventType,
      eventTime: input.eventTime,
      source: input.source,
      confidence: input.confidence,
      payload: {
        ...input.payload,
        teamId: input.state.teamId,
        squadId: input.state.squadId,
        generation: input.state.generation,
        lifecycleId: input.state.lifecycleId,
        runtimeKey: input.state.runtimeKey,
      },
      rawSourceEventId: input.rawSourceEventId ?? null,
      rawLog: input.rawLog ?? null,
      createdAt: Date.now(),
    };
  }
}

function hasMeaningfulSquadChange(oldState, snapshotItem) {
  return (
    oldState.squadName !== (snapshotItem.squadName || oldState.squadName)
    || oldState.leaderName !== (snapshotItem.leaderName ?? oldState.leaderName ?? null)
    || oldState.memberCount !== (snapshotItem.memberCount ?? oldState.memberCount ?? null)
    || oldState.locked !== (snapshotItem.locked ?? oldState.locked ?? null)
  );
}
