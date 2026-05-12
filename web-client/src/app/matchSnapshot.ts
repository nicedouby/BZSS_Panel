import { useEventStore } from "../stores/event.store";
import { useJobStore } from "../stores/job.store";
import { usePlayerStore } from "../stores/player.store";
import { useServerStore } from "../stores/server.store";
import { useSquadStore } from "../stores/squad.store";

export function applyMatchSnapshotResponse(response: any) {
  const matchState = response?.matchState ?? null;
  if (!matchState) return false;

  useServerStore().applySnapshot(buildServerSnapshot(matchState, response?.overview ?? null));
  usePlayerStore().applySnapshot(buildPlayersSnapshot(matchState.players));
  useSquadStore().applySnapshot(buildSquadsSnapshot(matchState.squads));
  return true;
}

export function applyRuntimeSnapshotResponse(snapshot: any) {
  if (!snapshot) return;

  useEventStore().applySnapshot(snapshot.events);
  useJobStore().applySnapshot(snapshot.jobs);
}

export function buildServerSnapshot(matchState: any, overview: any) {
  const serverStatus = matchState?.serverStatus ?? {};
  const status = overview?.status ?? {};

  return {
    ...serverStatus,
    updatedAt: toMillis(serverStatus.lastUpdatedAt) || Date.now(),
    webStatus: status,
    stale: false,
  };
}

export function buildPlayersSnapshot(matchPlayers: any) {
  const list = Array.isArray(matchPlayers?.list) ? matchPlayers.list : [];
  const snapshot = {
    active: [...list],
    recentlyDisconnected: [],
    bySteamID: {} as Record<string, any>,
    byEOSID: {} as Record<string, any>,
    byPlayerID: {} as Record<string, any>,
    byName: {} as Record<string, any>,
    updatedAt: toMillis(matchPlayers?.lastUpdatedAt) || Date.now(),
    stale: false,
  };

  for (const player of list) {
    if (player?.steamID && !snapshot.bySteamID[player.steamID]) snapshot.bySteamID[player.steamID] = player;
    if (player?.eosID && !snapshot.byEOSID[player.eosID]) snapshot.byEOSID[player.eosID] = player;
    if (player?.playerID != null && !snapshot.byPlayerID[player.playerID]) snapshot.byPlayerID[player.playerID] = player;
    if (player?.name && !snapshot.byName[player.name]) snapshot.byName[player.name] = player;
  }

  return snapshot;
}

export function buildSquadsSnapshot(matchSquads: any) {
  const list = Array.isArray(matchSquads?.list) ? matchSquads.list : [];
  const snapshot = {
    list: [...list],
    byKey: {} as Record<string, any>,
    byTeamID: {} as Record<string, any[]>,
    updatedAt: toMillis(matchSquads?.lastUpdatedAt) || Date.now(),
    stale: false,
  };

  for (const squad of list) {
    if (squad?.key) snapshot.byKey[squad.key] = squad;
    const teamKey = squad?.teamID != null ? String(squad.teamID) : "";
    if (!teamKey) continue;
    if (!snapshot.byTeamID[teamKey]) snapshot.byTeamID[teamKey] = [];
    snapshot.byTeamID[teamKey].push(squad);
  }

  return snapshot;
}

export function isMatchSnapshotConnected(response: any) {
  const matchState = response?.matchState ?? null;
  if (!matchState) return false;

  return Boolean(matchState.rconStatus?.connected ?? response?.overview?.rconStatus?.connected ?? false);
}

export function hasEmptyMatchLists(response: any) {
  const matchState = response?.matchState ?? null;
  if (!matchState) return true;

  const players = Array.isArray(matchState.players?.list) ? matchState.players.list : [];
  const squads = Array.isArray(matchState.squads?.list) ? matchState.squads.list : [];
  return players.length === 0 || squads.length === 0;
}

function toMillis(value: string | number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value) return 0;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}
