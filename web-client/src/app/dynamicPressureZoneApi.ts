import { apiGet, apiPost, request } from "./apiClient";

export interface PressureZoneConfig {
  schemaVersion: number;
  referenceMapSizeMeters: number;
  mapScaleInfluence: number;
  minMapScale: number;
  maxMapScale: number;
  coordinateScaleMeters: number | null;
  hard: {
    baseRadiusMeters: number;
    minRadiusMeters: number;
    maxRadiusMeters: number;
    emergencyMinimumRadiusMeters: number;
    maxBaseToFirstObjectiveRatio: number;
  };
  soft: {
    objectiveSpacingRatio: number;
    minExtensionMeters: number;
    maxExtensionMeters: number;
    fallbackExtensionMeters: number;
    objectiveSafetyMarginMeters: number;
  };
  combat: {
    gapFactor: number;
    mapScaleInfluence: number;
    lateralFactor: number;
    minRadiusMeters: number;
    maxRadiusMeters: number;
    polygonArcSegments: number;
  };
}

export interface TacticalMapBoundsLike {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PressureZoneGeometry {
  type: "circle" | "capsule";
  center?: { x: number; y: number };
  radius?: number;
  radiusMeters?: number;
  a?: { x: number; y: number };
  b?: { x: number; y: number };
  longitudinalRadius?: number;
  lateralRadius?: number;
  longitudinalRadiusMeters?: number;
  lateralRadiusMeters?: number;
  polygon?: Array<{ x: number; y: number }>;
  excludeZoneIds?: string[];
}

export interface PressureZoneItem {
  id: string;
  type: "hard" | "soft" | "combat" | "free";
  teamId: number | null;
  priority: number;
  geometry: PressureZoneGeometry;
}

export interface PressureZoneMapState {
  bounds: TacticalMapBoundsLike;
  widthMeters: number;
  heightMeters: number;
  effectiveSizeMeters: number;
  diagonalMeters: number;
  referenceMapSizeMeters: number;
  rawScaleFactor: number;
  scaleFactor: number;
  sizeSource: "bounds" | "input-map-size" | string;
  coordinateScaleMeters: number;
  worldUnitsPerMeter: number;
}

export interface PressureZoneBaseState {
  teamId: number;
  main: { x: number; y: number };
  firstObjective?: { id: string; name: string; x: number; y: number } | null;
  secondObjective?: { id: string; name: string; x: number; y: number } | null;
  firstObjectiveId?: string | null;
  firstObjectiveDistance?: number | null;
  firstObjectiveSpacing?: number | null;
  nearestObjectiveId?: string | null;
  nearestObjectiveDistance?: number | null;
  currentFrontObjectiveId?: string | null;
  currentFrontDistance?: number | null;
  hardRadius: number;
  softRadius: number;
  hardRadiusWorld: number;
  softRadiusWorld: number;
  limitingFactor?: string;
  formula?: Record<string, unknown>;
}

export interface PressureZoneState {
  active: boolean;
  reason?: string;
  layer?: string;
  mapKey?: string;
  profileSource?: string;
  map?: PressureZoneMapState | null;
  combat?: any;
  bases?: { team1?: PressureZoneBaseState; team2?: PressureZoneBaseState };
  zones: PressureZoneItem[];
  diagnostics?: any;
}

export async function fetchDynamicPressureZoneState() {
  return apiGet<{ ok: boolean; state: PressureZoneState }>("/api/dynamic-pressure-zone/state");
}

export async function simulateDynamicPressureZone(input: unknown) {
  return apiPost<{ ok: boolean; state: PressureZoneState }>("/api/dynamic-pressure-zone/simulate", input);
}

export async function fetchDynamicPressureZoneBaseConfig() {
  return apiGet<{ ok: boolean; config: PressureZoneConfig; defaults: PressureZoneConfig }>("/api/dynamic-pressure-zone/base-config");
}

export async function saveDynamicPressureZoneBaseConfig(config: PressureZoneConfig) {
  return request<{ ok: boolean; config: PressureZoneConfig; filePath: string }>("/api/dynamic-pressure-zone/base-config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
}

export async function saveDynamicPressureZoneProfile(profile: unknown) {
  return request<{ ok: boolean; profile: unknown; filePath: string }>("/api/dynamic-pressure-zone/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
}
