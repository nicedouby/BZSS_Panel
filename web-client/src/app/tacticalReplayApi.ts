import { apiGet } from "./apiClient";

export interface TacticalReplaySession {
  schemaVersion: number;
  id: string;
  status: "active" | "closed" | string;
  roundKey?: string;
  roundToken?: string;
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
  storage?: {
    format?: string;
    timelineFile?: string;
    chunksDirectory?: string;
    chunkDurationMs?: number;
    chunkCount?: number;
  };
}

export interface TacticalReplaySceneFields {
  meta?: Record<string, any>;
  server?: Record<string, any>;
  match?: Record<string, any>;
  teams?: any[];
  diagnostics?: Record<string, any>;
}

export interface TacticalReplayPlayersFrame {
  schemaVersion: number;
  type: "players";
  seq: number;
  t: number;
  at: string;
  revision: number | null;
  scene: TacticalReplaySceneFields;
  players: any[];
}

export interface TacticalReplayAssetsFrame {
  schemaVersion: number;
  type: "assets";
  seq: number;
  t: number;
  at: string;
  revision: number | null;
  scene: TacticalReplaySceneFields;
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
  hiddenLegacySessions?: number;
}

export interface TacticalReplaySessionResponse {
  ok: boolean;
  session: TacticalReplaySession;
}

export interface TacticalReplayWindowResponse {
  ok: boolean;
  session: TacticalReplaySession;
  fromMs: number;
  toMs: number;
  durationMs: number;
  frames: TacticalReplayFrame[];
  hasMore: boolean;
  nextFromMs: number | null;
  storage?: {
    schemaVersion?: number;
    chunkDurationMs?: number;
    scannedChunks?: number;
  };
}

export async function fetchTacticalReplaySessions(limit = 100, signal?: AbortSignal) {
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 100)));
  return apiGet<TacticalReplaySessionsResponse>(
    `/api/tactical-state/replays?limit=${safeLimit}`,
    { signal },
    { timeoutMs: 12_000 },
  );
}

export async function fetchTacticalReplaySession(sessionId: string, signal?: AbortSignal) {
  return apiGet<TacticalReplaySessionResponse>(
    `/api/tactical-state/replays/${encodeURIComponent(sessionId)}`,
    { signal },
    { timeoutMs: 12_000 },
  );
}

export async function fetchTacticalReplayWindow(
  sessionId: string,
  options: {
    fromMs?: number;
    durationMs?: number;
    limit?: number;
    includeContext?: boolean;
    contextMs?: number;
    signal?: AbortSignal;
  } = {},
) {
  const params = new URLSearchParams();
  params.set("from", String(Math.max(0, Number(options.fromMs) || 0)));
  params.set("duration", String(Math.max(500, Math.min(15_000, Number(options.durationMs) || 6_000))));
  params.set("limit", String(Math.max(1, Math.min(10_000, Math.floor(Number(options.limit) || 3_000)))));
  params.set("context", options.includeContext === false ? "0" : "1");
  params.set("contextMs", String(Math.max(0, Math.min(10_000, Number(options.contextMs) || 1_000))));

  return apiGet<TacticalReplayWindowResponse>(
    `/api/tactical-state/replays/${encodeURIComponent(sessionId)}/window?${params.toString()}`,
    { signal: options.signal },
    { timeoutMs: 15_000 },
  );
}

// Compatibility adapter for callers that still use the original frames API.
export async function fetchTacticalReplayFrames(
  sessionId: string,
  options: {
    fromMs?: number;
    toMs?: number;
    limit?: number;
    includeContext?: boolean;
    signal?: AbortSignal;
  } = {},
) {
  const fromMs = Math.max(0, Number(options.fromMs) || 0);
  const toMs = Number(options.toMs);
  return fetchTacticalReplayWindow(sessionId, {
    fromMs,
    durationMs: Number.isFinite(toMs) ? Math.max(500, Math.min(15_000, toMs - fromMs)) : 6_000,
    limit: options.limit,
    includeContext: options.includeContext,
    signal: options.signal,
  });
}
