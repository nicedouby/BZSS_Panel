// -*- coding: utf-8 -*-

export function makeSquadRuntimeKey(input) {
  return [
    input.serverId,
    input.matchId,
    `T${input.teamId}`,
    `S${input.squadId}`,
  ].join(":");
}

export function makeSquadLifecycleId(input) {
  return [
    input.serverId,
    input.matchId,
    `T${input.teamId}`,
    `S${input.squadId}`,
    `G${input.generation}`,
  ].join(":");
}
