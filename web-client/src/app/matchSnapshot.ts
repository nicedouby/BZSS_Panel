import { useEventStore } from "../stores/event.store";
import { useJobStore } from "../stores/job.store";
import { usePlayerStore } from "../stores/player.store";
import { useServerStore } from "../stores/server.store";
import { useSquadStore } from "../stores/squad.store";

export function applyMatchSnapshotResponse(response: any, options: { skipPlayers?: boolean, skipSquads?: boolean } = {}) {
  const matchState = response?.matchState ?? null;
  if (!matchState) return false;

  useServerStore().applyStableSnapshot(buildServerSnapshot(matchState, response?.overview ?? null));
  if (!options.skipPlayers) {
    usePlayerStore().applySnapshot(buildPlayersSnapshot(matchState.players));
  }
  if (!options.skipSquads) {
    useSquadStore().applySnapshot(buildSquadsSnapshot(matchState.squads));
  }
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
  const derivedMode = deriveModeFromLayer(status.layer, serverStatus.layer, status.currentLayer, serverStatus.currentLayer);
  const webStatus = {
    rcon: firstDisplayValue(status.rcon, serverStatus.rcon),
    isWarmup: status.isWarmup ?? serverStatus.isWarmup,
    warmupUpdatedAt: firstDisplayValue(status.warmupUpdatedAt, serverStatus.warmupUpdatedAt),
    warmupUpdatedBy: firstDisplayValue(status.warmupUpdatedBy, serverStatus.warmupUpdatedBy),
    serverName: firstDisplayValue(status.serverName, serverStatus.serverName, serverStatus.name),
    name: firstDisplayValue(status.name, serverStatus.name, serverStatus.serverName),
    map: firstDisplayValue(status.map, serverStatus.map),
    mapName: firstDisplayValue(status.mapName, status.map, serverStatus.mapName, serverStatus.map),
    layer: firstDisplayValue(status.layer, serverStatus.layer, status.currentLayer, serverStatus.currentLayer),
    layerName: firstDisplayValue(status.layerName, status.layer, serverStatus.layerName, serverStatus.layer),
    mode: firstDisplayValue(derivedMode, status.mode, serverStatus.mode),
    gameMode: firstDisplayValue(derivedMode, status.gameMode, status.mode, serverStatus.gameMode, serverStatus.mode),
    currentLayer: firstDisplayValue(status.currentLayer, serverStatus.currentLayer, status.layer, serverStatus.layer),
    nextLayer: firstDisplayValue(status.nextLayer, serverStatus.nextLayer, matchState?.serverStatus?.nextLayer),
    tps: firstPositiveNumber(status.tps, serverStatus.tps),
    tpsStatus: firstDisplayValue(status.tpsStatus, serverStatus.tpsStatus),
    playtime: firstFiniteNumber(status.playtime, serverStatus.playtime),
    matchTimeSeconds: firstFiniteNumber(status.matchTimeSeconds, serverStatus.matchTimeSeconds, status.playtime, serverStatus.playtime),
    playerCount: firstFiniteNumber(status.playerCount, serverStatus.playerCount),
    maxPlayers: firstFiniteNumber(status.maxPlayers, serverStatus.maxPlayers),
    queueCount: firstFiniteNumber(status.queueCount, serverStatus.queueCount),
    logTime: status.logTime ?? serverStatus.logTime,
    logClockSeconds: firstFiniteNumber(status.logClockSeconds, serverStatus.logClockSeconds),
    logClockHasAnchor: Boolean(status.logClockHasAnchor ?? serverStatus.logClockHasAnchor),
    logClockManual: Boolean(status.logClockManual ?? serverStatus.logClockManual),
    logClockAnchorLogTime: firstDisplayValue(status.logClockAnchorLogTime, serverStatus.logClockAnchorLogTime),
    logClockLastResetAt: firstDisplayValue(status.logClockLastResetAt, serverStatus.logClockLastResetAt),
    logClockLastResetReason: firstDisplayValue(status.logClockLastResetReason, serverStatus.logClockLastResetReason),
  };

  return {
    ...serverStatus,
    rcon: firstDisplayValue(serverStatus.rcon, status.rcon),
    isWarmup: serverStatus.isWarmup ?? status.isWarmup,
    warmupUpdatedAt: firstDisplayValue(serverStatus.warmupUpdatedAt, status.warmupUpdatedAt),
    warmupUpdatedBy: firstDisplayValue(serverStatus.warmupUpdatedBy, status.warmupUpdatedBy),
    serverName: firstDisplayValue(serverStatus.serverName, serverStatus.name, status.serverName, status.name),
    name: firstDisplayValue(serverStatus.name, serverStatus.serverName, status.name, status.serverName),
    map: firstDisplayValue(serverStatus.map, status.map),
    mapName: firstDisplayValue(serverStatus.mapName, serverStatus.map, status.mapName, status.map),
    layer: firstDisplayValue(serverStatus.layer, status.layer, serverStatus.currentLayer, status.currentLayer),
    layerName: firstDisplayValue(serverStatus.layerName, serverStatus.layer, status.layerName, status.layer),
    mode: firstDisplayValue(derivedMode, serverStatus.mode, status.mode),
    gameMode: firstDisplayValue(derivedMode, serverStatus.gameMode, serverStatus.mode, status.gameMode, status.mode),
    currentLayer: firstDisplayValue(serverStatus.currentLayer, serverStatus.layer, status.currentLayer, status.layer),
    nextLayer: firstDisplayValue(serverStatus.nextLayer, status.nextLayer, matchState?.serverStatus?.nextLayer),
    tps: firstPositiveNumber(serverStatus.tps, status.tps) ?? undefined,
    tpsStatus: firstDisplayValue(serverStatus.tpsStatus, status.tpsStatus),
    playtime: firstFiniteNumber(serverStatus.playtime, status.playtime) ?? undefined,
    matchTimeSeconds: firstFiniteNumber(serverStatus.matchTimeSeconds, status.matchTimeSeconds, serverStatus.playtime, status.playtime) ?? undefined,
    playerCount: firstFiniteNumber(serverStatus.playerCount, status.playerCount) ?? undefined,
    maxPlayers: firstFiniteNumber(serverStatus.maxPlayers, status.maxPlayers) ?? undefined,
    queueCount: firstFiniteNumber(serverStatus.queueCount, status.queueCount) ?? undefined,
    logTime: status.logTime ?? serverStatus.logTime,
    logClockSeconds: firstFiniteNumber(status.logClockSeconds, serverStatus.logClockSeconds) ?? undefined,
    logClockHasAnchor: Boolean(status.logClockHasAnchor ?? serverStatus.logClockHasAnchor),
    logClockManual: Boolean(status.logClockManual ?? serverStatus.logClockManual),
    logClockAnchorLogTime: firstDisplayValue(status.logClockAnchorLogTime, serverStatus.logClockAnchorLogTime),
    logClockLastResetAt: firstDisplayValue(status.logClockLastResetAt, serverStatus.logClockLastResetAt),
    logClockLastResetReason: firstDisplayValue(status.logClockLastResetReason, serverStatus.logClockLastResetReason),
    updatedAt: toMillis(serverStatus.lastUpdatedAt) || Date.now(),
    matchState,
    webStatus,
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

function firstDisplayValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) continue;
      if (text === "Unknown" || text === "Unknown Server" || text === "Unknown Map" || text === "Unknown Layer") continue;
      return text;
    }
    if (value !== undefined && value !== null) {
      return String(value);
    }
  }
  return undefined;
}

function firstPositiveNumber(...values: unknown[]) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function firstFiniteNumber(...values: unknown[]) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function deriveModeFromLayer(...layers: unknown[]) {
  for (const layer of layers) {
    const text = String(layer ?? "").trim();
    if (!text) continue;

    const tokens = text.split(/[_\s-]+/).filter(Boolean);
    if (!tokens.length) continue;

  const lastToken = tokens[tokens.length - 1];
  if (/^seed$/i.test(lastToken)) return "seed";

  if (/^(?:v?\d+|pve|pvp)$/i.test(lastToken) && tokens.length > 1) {
      const previous = String(tokens[tokens.length - 2] ?? "").trim();
      if (!previous) continue;
      if (/^seed$/i.test(previous)) return "seed";
      if (/^(?:pve|pvp)$/i.test(previous)) return previous.toLowerCase();
      if (/^[a-z]+$/i.test(previous)) return previous.toLowerCase();
      continue;
    }

    const mode = String(lastToken).trim();
    if (/^seed$/i.test(mode)) return "seed";
    if (/^(?:pve|pvp)$/i.test(mode)) return mode.toLowerCase();
    if (/^[a-z]+$/i.test(mode)) return mode.toLowerCase();
  }

  return undefined;
}
