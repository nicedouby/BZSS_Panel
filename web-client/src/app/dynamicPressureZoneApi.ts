import { apiGet, apiPost, request } from "./apiClient";

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

export interface PressureZoneState {
  active: boolean;
  reason?: string;
  layer?: string;
  mapKey?: string;
  profileSource?: string;
  map?: {
    bounds: TacticalMapBoundsLike;
    widthMeters: number;
    heightMeters: number;
    diagonalMeters: number;
    scaleFactor: number;
    coordinateScaleMeters: number;
    worldUnitsPerMeter: number;
  } | null;
  combat?: any;
  bases?: { team1?: any; team2?: any };
  zones: PressureZoneItem[];
  diagnostics?: any;
}

export async function fetchDynamicPressureZoneState() {
  return apiGet<{ ok: boolean; state: PressureZoneState }>("/api/dynamic-pressure-zone/state");
}

export async function simulateDynamicPressureZone(input: unknown) {
  return apiPost<{ ok: boolean; state: PressureZoneState }>("/api/dynamic-pressure-zone/simulate", input);
}

export async function saveDynamicPressureZoneProfile(profile: unknown) {
  return request<{ ok: boolean; profile: unknown; filePath: string }>("/api/dynamic-pressure-zone/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
}
