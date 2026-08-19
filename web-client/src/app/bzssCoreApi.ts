import { apiGet, apiPost } from "./apiClient";
import { apiPatch } from "./apiClient";

export const BZSS_CORE_BOOL_KEYS = [
  "LocalVOIPEnable",
  "OutputBZSSObj",
  "CheckingNoob",
] as const;

export type BzssCoreBoolKey = typeof BZSS_CORE_BOOL_KEYS[number];
export type BzssCoreBoolValue = boolean | null;

export type BzssCoreVariableSyncStatus = "synced" | "drifted" | "unknown" | "error";

export interface BzssCoreVariableSnapshot {
  online: boolean;
  variables: Record<BzssCoreBoolKey, BzssCoreBoolValue>;
  /** Panel persisted target; it remains authoritative across restarts. */
  desired: Record<BzssCoreBoolKey, BzssCoreBoolValue>;
  status: Record<BzssCoreBoolKey, BzssCoreVariableSyncStatus>;
  error: string | null;
  updatedAt: number;
  desiredUpdatedAt: number | null;
}

export interface BzssCoreVariableState {
  actual: BzssCoreBoolValue;
  desired: boolean | null;
  pending: boolean;
  error: string | null;
  updatedAt: number | null;
}

export async function fetchBzssCoreVariables() {
  return apiGet<BzssCoreVariableSnapshot>("/api/bzss-core/variables");
}

export async function setBzssCoreVariable(key: BzssCoreBoolKey, value: boolean) {
  return apiPatch<BzssCoreVariableSnapshot>("/api/bzss-core/variables", { key, value });
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
  isLocked?: boolean | null;
  capturePercent?: number | null;
  teamId?: number | null;
  ownerTeamId?: number | null;
  captureDirection?: number | null;
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
  fobId?: string;
  constructionPoints?: number | null;
  size?: string;
  instigator?: string;
  /** Canonical FOB size before the legacy display field is decorated. */
  fobSize?: string;
  /** Canonical player name parsed from the final FOBI field. */
  instigatorName?: string;
}

export interface BzssCoreMainZoneInfo {
  teamId: number | null;
  position: BzssCoreTrackedVector | null;
  raw?: string;
}

export interface BzssCoreVehicleInfo {
  /** Stable synthetic identity for anonymous ID:-1 telemetry tracks. */
  trackId?: number;
  frameIndex: number;
  driverPlayerId: number | null;
  occupied: boolean;
  vehicleType: string;
  healthPercent: number | null;
  position: BzssCoreTrackedVector | null;
  speed: number | null;
  teamId: number | null;
  observedAt: string;
  raw?: string;
}

export interface BzssCoreVehiclesResponse {
  ok: boolean;
  status: string;
  updatedAt: string;
  count: number;
  vehicles: BzssCoreVehicleInfo[];
  diagnostics?: BzssCoreVehicleDiagnostics | null;
}

export interface BzssCoreVehicleDiagnostics {
  rawLogEventCount: number;
  lastRawLogEventAt: string;
  vriCandidateLines: number;
  vriFramesParsed: number;
  vehicleRecordsParsed: number;
  emptyVehicleFrames: number;
  lastVriReceivedAt: string;
  lastVriParsedAt: string;
  lastVriReason: string;
  lastVriPreview: string;
}

export interface BzssCoreRuntimePlayerInfo {
  playerId: number | null;
  playerIndex: number | null;
  position: BzssCoreTrackedVector | null;
  yaw: number | null;
  combatInfo: string;
  presenceHint?: string;
  observedAt: string;
  stale: boolean;
}

export interface BzssCoreScoreboardPlayerInfo {
  playerId: number | null;
  playerIndex: number | null;
  teamId: number | null;
  squadId: number | null;
  lives: number | null;
  kills: number | null;
  vehicleKills: number | null;
  deaths: number | null;
  woundeds: number | null;
  wounds: number | null;
  teamKills: number | null;
  healPoints: number | null;
  revivedPoints: number | null;
  teamworkScore: number | null;
  objectiveScore: number | null;
  combatScore: number | null;
  isAdmin: boolean | null;
  isCommander: boolean | null;
  fireTeamIndex: number | null;
  fireTeamPosition: number | null;
  ping?: number | null;
}

export interface BzssCoreTrackedPlayerInfo {
  playerId?: number | null;
  playerIndex?: number | null;
  ping?: number | null;
  position?: BzssCoreTrackedVector | null;
  yaw?: number | null;
  combatInfo?: string;
  observedAt?: string;
  stale?: boolean;
  playerName: string;
  playerGuid: string;
  presenceHint?: string;
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
    ping?: number | null;
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
  status: string;
  revision: number;
  updatedAt: string;
  markerSeen: boolean;
  mainZoneCount?: number;
  runtimePlayerCount?: number;
  scoreboardPlayerCount?: number;
  rconOnlinePlayerCount?: number | null;
  runtimeCoverage?: {
    expectedCount?: number | null;
    actualCount?: number;
    missingCount?: number | null;
    complete?: boolean | null;
  };
  scoreboardCoverage?: {
    expectedCount?: number | null;
    actualCount?: number;
    missingCount?: number | null;
    complete?: boolean | null;
  };
  priFrame?: {
    frameId?: string | null;
    complete?: boolean | null;
    legacy?: boolean | null;
    chunks?: number | null;
    receivedChunks?: number[];
    missingChunks?: number[];
    playerCount?: number;
    expectedPlayerCount?: number | null;
    updatedAt?: string;
  };
  rawLineHash?: string;
  rawFields?: string[];
  lastError: string;
}

export interface BzssCoreExplosionInfo {
  id: string;
  x: number;
  y: number;
  z: number;
  damageCauser: string;
  damageInstigator: string;
  at: string;
}

export interface BzssCorePlayerInfoResponse {
  ok: boolean;
  status: string;
  state: BzssCorePlayerInfoState;
  runtimePlayers?: BzssCoreRuntimePlayerInfo[];
  scoreboardPlayers?: BzssCoreScoreboardPlayerInfo[];
  players?: any[];
  captureZones?: BzssCoreCaptureZoneInfo[];
  fobs?: BzssCoreFobInfo[];
  mainZones?: BzssCoreMainZoneInfo[];
  vehicles?: BzssCoreVehicleInfo[];
  explosions?: BzssCoreExplosionInfo[];
}

export interface BzssCoreRawDataResponse {
  ok: boolean;
  status: string;
  revision: number;
  updatedAt: string;
  markerSeen: boolean;
  runtimePlayerCount: number;
  scoreboardPlayerCount: number;
  mainZoneCount: number;
  priFrame?: BzssCorePlayerInfoState["priFrame"];
  rawLineHash: string;
  rawFields: string[];
  players?: any[];
  captureZones?: BzssCoreCaptureZoneInfo[];
  fobs?: BzssCoreFobInfo[];
  mainZones?: BzssCoreMainZoneInfo[];
  vehicles?: BzssCoreVehicleInfo[];
  explosions?: BzssCoreExplosionInfo[];
  lastError: string;
}

const PLAYER_INFO_LIST_CACHE_MS = 3000;
let playerInfoListCache: BzssCorePlayerInfoResponse | null = null;
let playerInfoListCacheAt = 0;
let playerInfoListInFlight: Promise<BzssCorePlayerInfoResponse> | null = null;

export function normalizeBzssCoreFobInfo(fob: BzssCoreFobInfo): BzssCoreFobInfo {
  const fobSize = String(fob?.fobSize ?? fob?.size ?? "").trim();
  const instigatorName = String(fob?.instigatorName ?? fob?.instigator ?? "").trim();
  const displayParts: string[] = [];

  if (fobSize) displayParts.push(fobSize);
  displayParts.push(`发起者：${instigatorName || "--"}`);

  return {
    ...fob,
    fobSize,
    instigatorName,
    instigator: instigatorName,
    // BzssCoreSnapshotsPage historically renders `size || instigator` in one cell.
    // Decorate that legacy display field while retaining canonical values above.
    size: displayParts.join(" · "),
  };
}

function normalizeBzssCoreFobPayload<T extends { fobs?: BzssCoreFobInfo[] }>(payload: T): T {
  if (!Array.isArray(payload?.fobs)) return payload;
  return {
    ...payload,
    fobs: payload.fobs.map(normalizeBzssCoreFobInfo),
  };
}

function rememberPlayerInfoList(response: BzssCorePlayerInfoResponse) {
  playerInfoListCache = response;
  playerInfoListCacheAt = Date.now();
  return response;
}

export async function executeBzssCoreCommand(input: {
  directive?: string;
  parameter?: string;
  command?: string;
  batch?: string[];
  raw?: boolean;
}) {
  let payload = input;
  const directive = String(input?.directive ?? "").trim();
  const parameter = String(input?.parameter ?? "").trim();
  const command = String(input?.command ?? "").trim();

  // Historical player-detail builds used Cheer:#<ListPlayersID> as a kill
  // command. Rewrite that signature before it ever reaches the HTTP API.
  if (directive === "Cheer" && /^#\d+$/.test(parameter)) {
    payload = {
      ...input,
      directive: "Kill",
      parameter: parameter.slice(1),
    };
  } else {
    const legacyCommand = command.match(/^Cheer:#(\d+)$/);
    if (legacyCommand) {
      payload = {
        ...input,
        command: `Kill:${legacyCommand[1]}`,
      };
    }
  }

  return apiPost<BzssCoreExecuteResult>("/api/bzss-core/execute", payload, {}, { timeoutMs: 20_000 });
}

export async function fetchBzssCorePlayerInfo(input: { name?: string }) {
  const params = new URLSearchParams();
  if (input.name) params.set("name", input.name);
  const suffix = params.toString();
  const response = await apiGet<BzssCorePlayerInfoResponse>(`/api/bzss-core/player-info${suffix ? `?${suffix}` : ""}`);
  return normalizeBzssCoreFobPayload(response);
}

export async function fetchBzssCorePlayerInfoList(input: { force?: boolean } = {}) {
  const now = Date.now();
  if (!input.force && playerInfoListCache && now - playerInfoListCacheAt < PLAYER_INFO_LIST_CACHE_MS) {
    return playerInfoListCache;
  }

  // Coalesce concurrent callers so multiple mounted pages cannot serialize and
  // transfer the same ~500 KB snapshot at the same instant.
  if (playerInfoListInFlight) return playerInfoListInFlight;

  playerInfoListInFlight = apiGet<BzssCorePlayerInfoResponse>("/api/bzss-core/player-info?all=1")
    .then((response) => rememberPlayerInfoList(normalizeBzssCoreFobPayload(response)))
    .finally(() => {
      playerInfoListInFlight = null;
    });

  return playerInfoListInFlight;
}

export async function fetchBzssCoreRawData() {
  const response = await apiGet<BzssCoreRawDataResponse>("/api/bzss-core/player-info/raw");
  return normalizeBzssCoreFobPayload(response);
}

export async function fetchBzssCoreVehicles() {
  return apiGet<BzssCoreVehiclesResponse>("/api/bzss-core/vehicles");
}

export function streamBzssCorePlayerInfoList(
  onMessage: (data: BzssCorePlayerInfoResponse) => void,
  onError?: (error: any, source: EventSource) => void
) {
  const url = "/api/bzss-core/player-info/stream";
  const eventSource = new EventSource(url);

  eventSource.onmessage = (event) => {
    try {
      const data = rememberPlayerInfoList(
        normalizeBzssCoreFobPayload(JSON.parse(event.data) as BzssCorePlayerInfoResponse),
      );
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
