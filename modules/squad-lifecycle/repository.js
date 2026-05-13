// -*- coding: utf-8 -*-

export class InMemorySquadLifecycleRepository {
  constructor() {
    this.statesByLifecycleId = new Map();
    this.events = [];
  }

  async getActiveByRuntimeKey(runtimeKey) {
    const states = [...this.statesByLifecycleId.values()]
      .filter((x) => x.runtimeKey === runtimeKey)
      .filter((x) => x.status === "ACTIVE" || x.status === "MISSING_CANDIDATE")
      .sort((a, b) => b.generation - a.generation);

    return states[0] ?? null;
  }

  async getLatestByRuntimeKey(runtimeKey) {
    const states = [...this.statesByLifecycleId.values()]
      .filter((x) => x.runtimeKey === runtimeKey)
      .sort((a, b) => b.generation - a.generation);

    return states[0] ?? null;
  }

  async getActiveByMatch(serverId, matchId) {
    return [...this.statesByLifecycleId.values()]
      .filter((x) => x.serverId === serverId)
      .filter((x) => x.matchId === matchId)
      .filter((x) => x.status === "ACTIVE" || x.status === "MISSING_CANDIDATE");
  }

  async getAllCurrentByMatch(serverId, matchId) {
    return [...this.statesByLifecycleId.values()]
      .filter((x) => x.serverId === serverId)
      .filter((x) => x.matchId === matchId);
  }

  async saveState(state) {
    this.statesByLifecycleId.set(state.lifecycleId, { ...state });
  }

  async saveEvent(event) {
    this.events.push({ ...event });
  }

  async getNextGeneration(input) {
    const generations = [...this.statesByLifecycleId.values()]
      .filter((x) => x.serverId === input.serverId)
      .filter((x) => x.matchId === input.matchId)
      .filter((x) => x.runtimeKey === input.runtimeKey)
      .map((x) => x.generation);

    if (generations.length === 0) return 1;
    return Math.max(...generations) + 1;
  }

  async markClosedByMatchEnd(input) {
    const changed = [];

    for (const state of this.statesByLifecycleId.values()) {
      if (state.serverId !== input.serverId) continue;
      if (state.matchId !== input.matchId) continue;
      if (state.status !== "ACTIVE" && state.status !== "MISSING_CANDIDATE") continue;

      const next = {
        ...state,
        status: "CLOSED_BY_MATCH_END",
        closedAt: input.closedAt,
        closeReason: "MATCH_ENDED",
        updatedAt: input.closedAt,
      };

      this.statesByLifecycleId.set(next.lifecycleId, next);
      changed.push(next);
    }

    return changed;
  }

  async getEventsByMatch(serverId, matchId, limit = 1000) {
    return this.events
      .filter((x) => x.serverId === serverId && x.matchId === matchId)
      .slice(-Math.max(1, Number(limit) || 1000));
  }

  dumpStates() {
    return [...this.statesByLifecycleId.values()];
  }

  dumpEvents() {
    return [...this.events];
  }
}
