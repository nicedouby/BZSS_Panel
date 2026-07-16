import {
  getStaticTacticalAssets as getStaticTacticalAssetsShared,
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

/**
 * The tactical map must always boot into a resource-free state. This sentinel
 * is intentionally excluded from the manual map list, but remains available
 * to the page's automatic resolver as the only default configuration.
 */
export const EMPTY_TACTICAL_MAP_KEY = "__empty_tactical_map__";

export const EMPTY_TACTICAL_MAP_CONFIG: TacticalMapConfig = {
  key: EMPTY_TACTICAL_MAP_KEY,
  name: "等待地图数据",
  image: "",
  tileBasePath: "",
  maxZoomLevel: 0,
  bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
  aliases: [],
};

export const TACTICAL_MAP_CONFIGS: Record<string, TacticalMapConfig> = {
  [EMPTY_TACTICAL_MAP_KEY]: EMPTY_TACTICAL_MAP_CONFIG,
  ...(TACTICAL_MAP_CONFIGS_SHARED as Record<string, TacticalMapConfig>),
};

// Keep the empty sentinel out of the user-selectable map list.
export const TACTICAL_MAP_LIST = TACTICAL_MAP_LIST_SHARED as TacticalMapConfig[];

export function resolveTacticalMapKey(mapName: string | null | undefined): string | null {
  return resolveTacticalMapKeyShared(mapName);
}

export function getDefaultTacticalMapKey(): string {
  return EMPTY_TACTICAL_MAP_KEY;
}

export function getStaticTacticalAssets(mapKey: string | null | undefined) {
  if (!mapKey || mapKey === EMPTY_TACTICAL_MAP_KEY) return null;
  return getStaticTacticalAssetsShared(mapKey);
}
