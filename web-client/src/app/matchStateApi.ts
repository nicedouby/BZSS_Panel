import { apiGet, apiPost } from "./apiClient";

export type MatchRefreshScope = "players" | "squads" | "all";

export interface MatchStatusInitialData {
  server: any;
  players: any;
  squads: any;
}

export async function fetchMatchStatusInitialData(): Promise<MatchStatusInitialData> {
  const [server, players, squads] = await Promise.all([
    apiGet<any>("/api/snapshot/server", {}, { timeoutMs: 4000 }),
    apiGet<any>("/api/snapshot/players", {}, { timeoutMs: 4000 }),
    apiGet<any>("/api/snapshot/squads", {}, { timeoutMs: 4000 }),
  ]);
  return { server, players, squads };
}

export function fetchPlayersSnapshot() {
  return apiGet<any>("/api/snapshot/players", {}, { timeoutMs: 4000 });
}

export function fetchSquadsSnapshot() {
  return apiGet<any>("/api/snapshot/squads", {}, { timeoutMs: 4000 });
}

export function requestMatchStateRefresh(scope: MatchRefreshScope) {
  return apiPost<any>(`/api/match/refresh/${scope}`, {}, {}, { timeoutMs: 8000 });
}
