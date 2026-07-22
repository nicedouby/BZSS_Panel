import { apiGet } from "./apiClient";

export interface TacticalReplaySession {
  schemaVersion: number;
  id: string;
  status: "active" | "closed" | string;
  serverId: string;
  serverName: string;
  map: string;
  layer: string;
  mode: string;
  roundStartedAt: string;
  startedAt: string;
  endedAt: string;
  endReason: string;
  durationMs: number;
  lastFrameAt: string;
  frameCounts: {
    players: number;
    assets: number;
  };
  fileBytes: number;
  playerIntervalMs: number;
  assetIntervalMs: number;
}

export interface TacticalReplayPlayersFrame {
  schemaVersion: number;
  type: "players";
  seq: number;
  t: number;
  at: string;
  revision: number | null;
  players: any[];
}

export interface TacticalReplayAssetsFrame {
  schemaVersion: number;
  type: "assets";
  seq: number;
  t: number;
  at: string;
  revision: number | null;
  server: any;
  match: any;
  teams: any[];
  assets: {
    captureZones: any[];
    fobs: any[];
    mainZones: any[];
  };
}

export type TacticalReplayFrame = TacticalReplayPlayersFrame | TacticalReplayAssetsFrame;

export interface TacticalReplaySessionsResponse {
  ok: boolean;
  sessions: TacticalReplaySession[];
}

export interface TacticalReplaySessionResponse {
  ok: boolean;
  session: TacticalReplaySession;
}

export interface TacticalReplayFramesResponse {
  ok: boolean;
  session: TacticalReplaySession;
  fromMs: number;
  toMs: number | null;
  frames: TacticalReplayFrame[];
  hasMore: boolean;
  nextFromMs: number | null;
}

export async function fetchTacticalReplaySessions(limit = 100) {
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 100)));
  return apiGet<TacticalReplaySessionsResponse>(`/api/tactical-state/replays?limit=${safeLimit}`);
}

export async function fetchTacticalReplaySession(sessionId: string) {
  return apiGet<TacticalReplaySessionResponse>(
    `/api/tactical-state/replays/${encodeURIComponent(sessionId)}`,
  );
}

export async function fetchTacticalReplayFrames(
  sessionId: string,
  options: {
    fromMs?: number;
    toMs?: number;
    limit?: number;
    types?: Array<"players" | "assets">;
    includeContext?: boolean;
  } = {},
) {
  const params = new URLSearchParams();
  params.set("from", String(Math.max(0, Number(options.fromMs) || 0)));
  if (Number.isFinite(Number(options.toMs))) {
    params.set("to", String(Math.max(0, Number(options.toMs))));
  }
  params.set("limit", String(Math.max(1, Math.min(100_000, Math.floor(Number(options.limit) || 20_000)))));
  params.set("types", (options.types?.length ? options.types : ["players", "assets"]).join(","));
  params.set("context", options.includeContext === false ? "0" : "1");

  return apiGet<TacticalReplayFramesResponse>(
    `/api/tactical-state/replays/${encodeURIComponent(sessionId)}/frames?${params.toString()}`,
  );
}
