import {
  resolveTacticalMapKey as resolveTacticalMapKeyShared,
  TACTICAL_MAP_CONFIGS as TACTICAL_MAP_CONFIGS_SHARED,
  TACTICAL_MAP_LIST as TACTICAL_MAP_LIST_SHARED,
} from "./tactical-map-data.shared.js";

export interface TacticalMapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TacticalMapConfig {
  key: string;
  name: string;
  image: string;
  tileBasePath: string;
  maxZoomLevel: number;
  bounds: TacticalMapBounds;
  aliases: string[];
}

export const TACTICAL_MAP_CONFIGS = TACTICAL_MAP_CONFIGS_SHARED as Record<string, TacticalMapConfig>;
export const TACTICAL_MAP_LIST = TACTICAL_MAP_LIST_SHARED as TacticalMapConfig[];

export function resolveTacticalMapKey(mapName: string | null | undefined): string | null {
  return resolveTacticalMapKeyShared(mapName);
}
