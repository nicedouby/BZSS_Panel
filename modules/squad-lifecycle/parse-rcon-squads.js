// -*- coding: utf-8 -*-

export function toRconSquadSnapshot({
  serverId,
  matchId,
  parsedSquads,
  rawText,
  capturedAt,
  playerCount,
  isMatchChanging,
}) {
  const now = Number(capturedAt) || Date.now();

  const squads = (parsedSquads ?? [])
    .map((squad) => ({
      serverId,
      matchId,
      teamId: Number(squad.teamID),
      squadId: Number(squad.squadID),
      squadName: String(squad.squadName ?? "").trim(),
      leaderName: String(squad.creatorName ?? "").trim() || null,
      leaderSteamId: String(squad.creatorSteamID ?? "").trim() || null,
      leaderEosId: String(squad.creatorEOSID ?? "").trim() || null,
      memberCount: Number.isFinite(Number(squad.size)) ? Number(squad.size) : null,
      locked: typeof squad.locked === "boolean" ? squad.locked : null,
      raw: squad,
    }))
    .filter((x) => Number.isFinite(x.teamId) && Number.isFinite(x.squadId));

  return {
    serverId,
    matchId,
    capturedAt: now,
    playerCount: Number.isFinite(Number(playerCount)) ? Number(playerCount) : null,
    isMatchChanging: Boolean(isMatchChanging),
    squads,
    rawText: String(rawText ?? ""),
  };
}
