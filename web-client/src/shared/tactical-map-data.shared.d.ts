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

export const TACTICAL_MAP_CONFIGS: Record<string, TacticalMapConfig>;
export const TACTICAL_MAP_LIST: TacticalMapConfig[];
export function getDefaultTacticalMapKey(): string | null;
export function resolveTacticalMapKey(mapName: string | null | undefined): string | null;
