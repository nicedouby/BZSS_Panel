import { apiGet } from "../../app/apiClient";

export interface SearchablePlayer {
  name: string;
  eosId?: string;
  steamId?: string;
  teamId?: number;
  squadId?: number;
  isOnline?: boolean;
}

function normalizePlayer(raw: any): SearchablePlayer {
  return {
    name: String(
      raw?.current_name
        ?? raw?.name
        ?? raw?.playerName
        ?? raw?.PlayerName
        ?? "未知玩家",
    ).trim() || "未知玩家",
    eosId: String(raw?.eos_id ?? raw?.eosId ?? raw?.eosID ?? raw?.eos ?? raw?.EOS ?? "").trim() || undefined,
    steamId: String(raw?.steam_id ?? raw?.steamId ?? raw?.steamID ?? raw?.steam64 ?? raw?.Steam64 ?? "").trim() || undefined,
    teamId: Number.isFinite(Number(raw?.team_id ?? raw?.teamId ?? raw?.team ?? raw?.TeamID))
      ? Number(raw?.team_id ?? raw?.teamId ?? raw?.team ?? raw?.TeamID)
      : undefined,
    squadId: Number.isFinite(Number(raw?.squad_id ?? raw?.squadId ?? raw?.squad ?? raw?.SquadID))
      ? Number(raw?.squad_id ?? raw?.squadId ?? raw?.squad ?? raw?.SquadID)
      : undefined,
    isOnline: Boolean(raw?.isOnline ?? raw?.online ?? true),
  };
}

export async function searchPlayers(keyword: string): Promise<SearchablePlayer[]> {
  const q = String(keyword ?? "").trim();
  const params = new URLSearchParams({
    q,
    sort: "updated_desc",
    limit: "100",
    offset: "0",
  });

  const response = await apiGet<{
    items?: any[];
    players?: any[];
    total?: number;
  }>(`/api/db/players?${params.toString()}`);

  const list = Array.isArray(response.items)
    ? response.items
    : Array.isArray(response.players)
      ? response.players
      : [];

  return list.map(normalizePlayer).filter((player) => Boolean(player.eosId || player.steamId));
}
