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

export interface BzssCoreTrackedPlayerInfo {
  playerName: string;
  playerGuid: string;
  teamId: number | null;
  squadId: number | null;
  playerBaseInfo: {
    raw: string;
    fields: string[];
  };
  soldierInfo: {
    raw: string;
    fields: string[];
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
  lastError: string;
}

export interface BzssCorePlayerInfoResponse {
  ok: boolean;
  status: string;
  state: BzssCorePlayerInfoState;
  player: BzssCoreTrackedPlayerInfo | null;
  players?: BzssCoreTrackedPlayerInfo[];
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

function normalizeConfig(config: Partial<BzssCoreConfig> | null | undefined): BzssCoreConfig {
  return {
    modifyScriptPath: String(config?.modifyScriptPath ?? "").trim(),
    remoteSaveGamePath: String(config?.remoteSaveGamePath ?? "").trim(),
    playerInfoSavePath: String(config?.playerInfoSavePath ?? "").trim(),
  };
}
