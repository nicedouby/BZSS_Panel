import { apiGet, apiPatch, apiPost } from "./apiClient";

export interface BzssCoreConfig {
  modifyScriptPath: string;
  remoteSaveGamePath: string;
  playerInfoSavePath: string;
}

export interface BzssCoreExecuteResult {
  ok: boolean;
  command?: string;
  directive?: string;
  message?: string;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
}

export interface BzssCoreTrackedVector {
  x: number | null;
  y: number | null;
  z: number | null;
}

export interface BzssCoreCaptureZoneInfo {
  name: string;
  position: BzssCoreTrackedVector | null;
  raw?: string;
}

export interface BzssCoreFobInfo {
  teamId: number | null;
  health: number | null;
  isBleeding: boolean;
  ammo: number | null;
  construction: number | null;
  name: string;
  position: BzssCoreTrackedVector | null;
  raw?: string;
}

export interface BzssCoreTrackedPlayerInfo {
  playerId?: number | null;
  playerName: string;
  playerGuid: string;
  teamId: number | null;
  squadId: number | null;
  isAdmin?: boolean | null;
  isCommander?: boolean | null;
  ftIndex?: number | null;
  ftPosition?: number | null;
  claimedInfo?: string;
  seatsPlayers?: string[];
  vehicleInfo?: {
    raw: string;
    vehicleType: string;
    healthText: string;
    health: number | null;
    maxHealth: number | null;
    position: BzssCoreTrackedVector | null;
    rotation: BzssCoreTrackedVector | null;
  };
  playerBaseInfo: {
    raw: string;
    fields: string[];
    values?: Record<string, string>;
  };
  soldierInfo: {
    raw: string;
    fields: string[];
    values?: Record<string, string>;
    soldierClass: string;
    health: number | null;
    weaponClass: string;
    ammoValues: number[];
    position: BzssCoreTrackedVector | null;
    rotation: BzssCoreTrackedVector | null;
  };
  playerScoreboard: {
    raw: string;
    values: string[];
    numericValues: Array<number | null>;
    stats?: {
      dataLives: number | null;
      numKills: number | null;
      numDeaths: number | null;
      numWoundeds: number | null;
      numWounds: number | null;
      numTeamKills: number | null;
      healPoints: number | null;
      revivedPoints: number | null;
      teamworkScore: number | null;
      objectiveScore: number | null;
      combatScore: number | null;
    };
    labeledValues?: Array<{
      key: string;
      label: string;
      value: number | null;
    }>;
    extraValues?: Array<number | null>;
  };
  rawText: string;
}

export interface BzssCorePlayerInfoState {
  configuredPath: string;
  resolvedPath: string;
  exists: boolean;
  status: string;
  revision: number;
  updatedAt: string;
  lastReadAt: string;
  lastCompletedAt: string;
  markerSeen: boolean;
  fileSize: number;
  fileMtimeMs: number;
  playerCount: number;
  captureZoneCount?: number;
  fobCount?: number;
  rawTextLength?: number;
  rawTextUpdatedAt?: string;
  lastError: string;
}

export interface BzssCorePlayerInfoResponse {
  ok: boolean;
  status: string;
  state: BzssCorePlayerInfoState;
  player: BzssCoreTrackedPlayerInfo | null;
  players?: BzssCoreTrackedPlayerInfo[];
  captureZones?: BzssCoreCaptureZoneInfo[];
  fobs?: BzssCoreFobInfo[];
}

export interface BzssCoreRawDataResponse {
  ok: boolean;
  configuredPath: string;
  resolvedPath: string;
  exists: boolean;
  status: string;
  revision: number;
  updatedAt: string;
  lastReadAt: string;
  lastCompletedAt: string;
  markerSeen: boolean;
  fileSize: number;
  fileMtimeMs: number;
  playerCount: number;
  captureZones?: BzssCoreCaptureZoneInfo[];
  fobs?: BzssCoreFobInfo[];
  lastError: string;
  rawText: string;
  rawTextLength: number;
  rawTextUpdatedAt: string;
}

export async function fetchBzssCoreConfig() {
  const payload = await apiGet<{ ok?: boolean; config: BzssCoreConfig }>("/api/bzss-core/config");
  return normalizeConfig(payload.config);
}

export async function saveBzssCoreConfig(config: BzssCoreConfig) {
  const payload = await apiPatch<{ ok?: boolean; config: BzssCoreConfig }>("/api/bzss-core/config", { config });
  return normalizeConfig(payload.config);
}

export async function executeBzssCoreCommand(input: {
  directive?: string;
  parameter?: string;
  command?: string;
  raw?: boolean;
}) {
  return apiPost<BzssCoreExecuteResult>("/api/bzss-core/execute", input, {}, { timeoutMs: 20_000 });
}

export async function fetchBzssCorePlayerInfo(input: { name?: string }) {
  const params = new URLSearchParams();
  if (input.name) params.set("name", input.name);
  const suffix = params.toString();
  return apiGet<BzssCorePlayerInfoResponse>(`/api/bzss-core/player-info${suffix ? `?${suffix}` : ""}`);
}

export async function fetchBzssCorePlayerInfoList() {
  return apiGet<BzssCorePlayerInfoResponse>("/api/bzss-core/player-info?all=1");
}

export async function fetchBzssCoreRawData() {
  return apiGet<BzssCoreRawDataResponse>("/api/bzss-core/player-info/raw");
}

export function streamBzssCorePlayerInfoList(
  onMessage: (data: BzssCorePlayerInfoResponse) => void,
  onError?: (error: any, source: EventSource) => void
) {
  const url = "/api/bzss-core/player-info/stream";
  const eventSource = new EventSource(url);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch (err) {
      if (onError) onError(err, eventSource);
    }
  };

  eventSource.onerror = (err) => {
    if (onError) onError(err, eventSource);
  };

  return () => {
    eventSource.close();
  };
}

function normalizeConfig(config: Partial<BzssCoreConfig> | null | undefined): BzssCoreConfig {
  return {
    modifyScriptPath: String(config?.modifyScriptPath ?? "").trim(),
    remoteSaveGamePath: String(config?.remoteSaveGamePath ?? "").trim(),
    playerInfoSavePath: String(config?.playerInfoSavePath ?? "").trim(),
  };
}
