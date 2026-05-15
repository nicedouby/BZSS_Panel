import { apiGet } from "../../app/apiClient";

export interface SearchablePlayer {
  name: string;
  eosId?: string;
  steamId?: string;
  teamId?: number;
  squadId?: number;
  playtimeHours?: number | null;
  isOnline?: boolean;
}

function normalizePlayer(raw: any): SearchablePlayer {
  const steamId = String(
    raw?.steam_id
      ?? raw?.steamId
      ?? raw?.steamID
      ?? raw?.steam64
      ?? raw?.Steam64
      ?? "",
  ).trim() || undefined;

  const eosId = String(
    raw?.eos_id
      ?? raw?.eosId
      ?? raw?.eosID
      ?? raw?.eos
      ?? raw?.EOS
      ?? "",
  ).trim() || undefined;

  return {
    name: String(
      raw?.current_name
        ?? raw?.name
        ?? raw?.playerName
        ?? raw?.PlayerName
        ?? "未知玩家",
    ).trim() || "未知玩家",
    eosId,
    steamId,
    teamId: numberValue(raw?.team_id ?? raw?.teamId ?? raw?.team ?? raw?.TeamID),
    squadId: numberValue(raw?.squad_id ?? raw?.squadId ?? raw?.squad ?? raw?.SquadID),
    playtimeHours: normalizePlaytimeHours(raw),
    isOnline: Boolean(raw?.isOnline ?? raw?.online ?? true),
  };
}

function normalizeRuntimePlayer(raw: any): SearchablePlayer {
  return {
    name: String(raw?.name ?? raw?.current_name ?? "").trim() || "未知玩家",
    eosId: String(raw?.eosID ?? raw?.eosId ?? raw?.eos_id ?? "").trim() || undefined,
    steamId: String(raw?.steamID ?? raw?.steamId ?? raw?.steam_id ?? "").trim() || undefined,
    teamId: numberValue(raw?.teamID ?? raw?.teamId ?? raw?.team_id),
    squadId: numberValue(raw?.squadID ?? raw?.squadId ?? raw?.squad_id),
    isOnline: Boolean(raw?.online ?? true),
  };
}

function normalizePlaytimeHours(raw: any): number | null | undefined {
  const hours = raw?.playtimeHours
    ?? raw?.playtime_hours
    ?? raw?.gameHours
    ?? raw?.game_hours;
  if (Number.isFinite(Number(hours))) {
    return Number(hours);
  }

  const seconds = raw?.playtimeSeconds
    ?? raw?.playtime_seconds
    ?? raw?.gameSeconds
    ?? raw?.game_seconds
    ?? raw?.serverSeconds
    ?? raw?.server_seconds
    ?? raw?.total_playtime
    ?? raw?.totalPlaytime;
  if (Number.isFinite(Number(seconds))) {
    return Number((Number(seconds) / 3600).toFixed(2));
  }

  return undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function searchPlayers(keyword: string): Promise<SearchablePlayer[]> {
  const q = String(keyword ?? "").trim();
  const params = new URLSearchParams({
    q,
    sort: "updated_desc",
    limit: "100",
    offset: "0",
  });

  const [response, snapshot] = await Promise.all([
    apiGet<{
      items?: any[];
      players?: any[];
      total?: number;
    }>(`/api/db/players?${params.toString()}`),
    apiGet<any>("/api/snapshot/players").catch(() => null),
  ]);

  const list = Array.isArray(response.items)
    ? response.items
    : Array.isArray(response.players)
      ? response.players
      : [];

  const runtimeList = Array.isArray(snapshot?.active)
    ? snapshot.active
    : Array.isArray(snapshot?.players)
      ? snapshot.players
      : [];

  const runtimeBySteam = new Map<string, SearchablePlayer>();
  const runtimeByEos = new Map<string, SearchablePlayer>();

  for (const raw of runtimeList) {
    const player = normalizeRuntimePlayer(raw);
    if (player.steamId) runtimeBySteam.set(player.steamId, player);
    if (player.eosId) runtimeByEos.set(player.eosId, player);
  }

  return list.map((raw) => {
    const player = normalizePlayer(raw);
    const runtime = (player.steamId && runtimeBySteam.get(player.steamId))
      || (player.eosId && runtimeByEos.get(player.eosId))
      || null;

    return {
      ...player,
      teamId: runtime?.teamId ?? player.teamId,
      squadId: runtime?.squadId ?? player.squadId,
    };
  }).filter((player) => Boolean(player.eosId || player.steamId));
}
