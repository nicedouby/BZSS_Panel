import { apiGet, apiPost } from "./apiClient";

export interface TacticalReplayPlayerSample {
  playerGuid: string;
  playerName: string;
  teamId: number | null;
  squadId: number | null;
  health: number | null;
  position: { x: number; y: number; z: number | null } | null;
  rotation: { x: number | null; y: number | null; z: number | null } | null;
  yaw: number | null;
  soldierClass: string;
  vehicleInfo: {
    vehicleType: string;
    health: number | null;
    maxHealth: number | null;
  } | null;
}

export interface TacticalReplayFrame {
  frameId: string;
  timestampMs: number;
  serverId: string;
  mapName: string;
  layer: string;
  mapKey: string;
  playerCount: number;
  players: TacticalReplayPlayerSample[];
}

export interface TacticalReplaySegment {
  id: string;
  serverId: string;
  mapKey: string;
  mapName: string;
  layer: string;
  startedAt: number;
  endedAt: number;
  frameCount: number;
  durationMs: number;
  playerNames: string[];
  rawFiles: string[];
  exportCount: number;
}

export interface TacticalReplayExportTask {
  id: string;
  segmentId: string;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  fromMs: number;
  toMs: number;
  playerNames: string[];
  speed: number;
  fps: number;
  resolution: number;
  outputFileName: string;
  outputFilePath: string;
  error: string;
  frameCount: number;
}

export async function fetchTacticalReplaySegments() {
  return apiGet<{ ok: boolean; items: TacticalReplaySegment[] }>("/api/tactical-map-replay/segments");
}

export async function fetchTacticalReplaySegment(input: {
  id: string;
  from?: number;
  to?: number;
  players?: string[];
  sampleEvery?: number;
}) {
  const params = new URLSearchParams();
  params.set("id", input.id);
  if (input.from != null) params.set("from", String(input.from));
  if (input.to != null) params.set("to", String(input.to));
  if (input.players?.length) params.set("players", input.players.join(","));
  if (input.sampleEvery != null) params.set("sampleEvery", String(input.sampleEvery));
  return apiGet<{
    ok: boolean;
    segment: TacticalReplaySegment;
    frames: TacticalReplayFrame[];
    frameCount: number;
    query: {
      fromMs: number;
      toMs: number;
      playerNames: string[];
      sampleEvery: number;
    };
  }>(`/api/tactical-map-replay/segment?${params.toString()}`);
}

export async function createTacticalReplayExport(input: {
  segmentId: string;
  fromMs?: number;
  toMs?: number;
  playerNames?: string[];
  speed?: number;
  fps?: number;
  resolution?: number;
}) {
  return apiPost<{ ok: boolean; task: TacticalReplayExportTask }>("/api/tactical-map-replay/export", input);
}

export async function fetchTacticalReplayExportTasks(input: { segmentId?: string; id?: string }) {
  const params = new URLSearchParams();
  if (input.segmentId) params.set("segmentId", input.segmentId);
  if (input.id) params.set("id", input.id);
  return apiGet<{ ok: boolean; items: TacticalReplayExportTask[] }>(`/api/tactical-map-replay/export-tasks?${params.toString()}`);
}

export function tacticalReplayExportFileUrl(taskId: string) {
  return `/api/tactical-map-replay/export-file?id=${encodeURIComponent(taskId)}`;
}
