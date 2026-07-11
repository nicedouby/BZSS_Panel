import { apiGet } from "./apiClient";

export interface TacticalStateSnapshotResponse {
  ok: boolean;
  type?: "tactical-state.snapshot" | "tactical-state.delta";
  snapshot?: any;
  revision?: number | null;
  generatedAt?: string;
  delta?: TacticalStateDelta;
}

export interface TacticalStateDelta {
  replace?: any;
  meta?: any;
  server?: any;
  match?: any;
  teams?: any[];
  squadFollow?: any;
  assets?: any;
  diagnostics?: any;
  players?: {
    upsert?: any[];
    remove?: string[];
  };
}

export interface TacticalStatePlayersResponse {
  ok: boolean;
  players: any[];
}

export interface TacticalStatePlayerResponse {
  ok: boolean;
  player: any | null;
}

export async function fetchTacticalStateSnapshot() {
  return apiGet<TacticalStateSnapshotResponse>("/api/tactical-state/snapshot?compact=1");
}

export async function fetchTacticalStatePlayers() {
  return apiGet<TacticalStatePlayersResponse>("/api/tactical-state/players");
}

export async function fetchTacticalStatePlayer(params: {
  steamID?: string;
  eosID?: string;
  playerID?: string | number;
  name?: string;
}) {
  const searchParams = new URLSearchParams();
  if (params.steamID) searchParams.set("steamID", params.steamID);
  if (params.eosID) searchParams.set("eosID", params.eosID);
  if (params.playerID != null && `${params.playerID}`.trim()) searchParams.set("playerID", `${params.playerID}`);
  if (params.name) searchParams.set("name", params.name);
  return apiGet<TacticalStatePlayerResponse>(`/api/tactical-state/player?${searchParams.toString()}`);
}

export function streamTacticalStateSnapshot(
  onMessage: (data: TacticalStateSnapshotResponse) => void,
  onError?: (error: any, source: EventSource) => void,
) {
  const eventSource = new EventSource("/api/tactical-state/stream");
  eventSource.onmessage = (event) => {
    try {
      onMessage(JSON.parse(event.data));
    } catch (error) {
      onError?.(error, eventSource);
    }
  };
  eventSource.onerror = (error) => {
    onError?.(error, eventSource);
  };
  return () => eventSource.close();
}
