import mapCornersData from "./map-corners.json";

export interface TacticalMapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TacticalMapConfig {
  key: string;
  name: string;
  /** Original full-resolution image URL (fallback) */
  image: string;
  /** Base path for tile pyramid, e.g. "/map-tiles/Sumari_RAAS_v1" */
  tileBasePath: string;
  /** Maximum tile zoom level available (0 = thumbnail only, 4 = full 4096px detail) */
  maxZoomLevel: number;
  bounds: TacticalMapBounds;
  aliases: string[];
}

interface TacticalMapCornerEntry {
  corners?: {
    min?: { x?: number; y?: number };
    max?: { x?: number; y?: number };
    bIsValid?: boolean;
  };
}

const MAP_IMAGE_BY_KEY: Record<string, string> = {
  Anvil_RAAS_v1: "Anvil_Minimap.PNG",
  Belaya_RAAS_v1: "Belaya_Minimap.PNG",
  Chora_RAAS_v1: "Chora_Minimap.PNG",
  Fallujah_RAAS_v1: "T_Fallujah_Minimap.PNG",
  FoolsRoad_RAAS_v1: "Fools_Road_Minimap.PNG",
  GooseBay_RAAS_v1: "GooseBay_Minimap.PNG",
  Gorodok_RAAS_v1: "gorodok_minimap.PNG",
  Kamdesh_RAAS_v1: "Kamdesh_Minimap.PNG",
  Kohat_RAAS_v1: "kohat_minimap.PNG",
  Kokan_RAAS_v1: "T_Kokan_Minimap.PNG",
  Lashkar_RAAS_v1: "T_Lashkar_Minimap.PNG",
  Logar_RAAS_v1: "Logar_Valley_Minimap.PNG",
  Manicouagan_RAAS_v1: "T_Manicouagan_Minimap.PNG",
  Mestia_RAAS_v1: "T_Mestia_Minimap.PNG",
  Mutaha_RAAS_v1: "Mutaha_Minimap.PNG",
  Narva_RAAS_v1: "Narva_Minimap.PNG",
  Skorpo_RAAS_v1: "Skorpo_Minimap.PNG",
  Sumari_RAAS_v1: "Sumari_Minimap.PNG",
  Tallil_RAAS_v1: "Tallil_Outskirts_Minimap.PNG",
  Yehorivka_RAAS_v1: "Yehorivka_Minimap.PNG",
};

const MAP_NAME_BY_KEY: Record<string, string> = {
  Anvil_RAAS_v1: "Anvil",
  Belaya_RAAS_v1: "Belaya",
  Chora_RAAS_v1: "Chora",
  Fallujah_RAAS_v1: "Fallujah",
  FoolsRoad_RAAS_v1: "Fools Road",
  GooseBay_RAAS_v1: "Goose Bay",
  Gorodok_RAAS_v1: "Gorodok",
  Kamdesh_RAAS_v1: "Kamdesh",
  Kohat_RAAS_v1: "Kohat",
  Kokan_RAAS_v1: "Kokan",
  Lashkar_RAAS_v1: "Lashkar",
  Logar_RAAS_v1: "Logar Valley",
  Manicouagan_RAAS_v1: "Manicouagan",
  Mestia_RAAS_v1: "Mestia",
  Mutaha_RAAS_v1: "Mutaha",
  Narva_RAAS_v1: "Narva",
  Skorpo_RAAS_v1: "Skorpo",
  Sumari_RAAS_v1: "Sumari",
  Tallil_RAAS_v1: "Tallil Outskirts",
  Yehorivka_RAAS_v1: "Yehorivka",
};

function normalizeMapToken(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function buildAliases(key: string, name: string) {
  const rawBase = key.replace(/_RAAS_v1$/i, "");
  const compactBase = normalizeMapToken(rawBase);
  const compactName = normalizeMapToken(name);
  return Array.from(
    new Set(
      [
        key,
        rawBase,
        name,
        rawBase.replace(/([a-z])([A-Z])/g, "$1 $2"),
        rawBase.replace(/_/g, " "),
        rawBase.replace(/([A-Z])/g, " $1"),
        compactBase,
        compactName,
      ].filter(Boolean),
    ),
  );
}

function buildConfig(key: string, entry: TacticalMapCornerEntry): TacticalMapConfig | null {
  const imageName = MAP_IMAGE_BY_KEY[key];
  const corners = entry.corners;
  if (!imageName || !corners?.bIsValid) return null;

  const minX = Number(corners.min?.x);
  const minY = Number(corners.min?.y);
  const maxX = Number(corners.max?.x);
  const maxY = Number(corners.max?.y);

  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;

  const name = MAP_NAME_BY_KEY[key] ?? key.replace(/_RAAS_v1$/i, "");
  return {
    key,
    name,
    image: `/${imageName}`,
    tileBasePath: `/map-tiles/${key}`,
    maxZoomLevel: 4,
    bounds: { minX, minY, maxX, maxY },
    aliases: buildAliases(key, name),
  };
}

const rawMapCorners = mapCornersData as Record<string, TacticalMapCornerEntry>;

export const TACTICAL_MAP_CONFIGS: Record<string, TacticalMapConfig> = Object.fromEntries(
  Object.entries(rawMapCorners)
    .map(([key, entry]) => buildConfig(key, entry))
    .filter((config): config is TacticalMapConfig => config != null)
    .map((config) => [config.key, config]),
);

export const TACTICAL_MAP_LIST = Object.values(TACTICAL_MAP_CONFIGS).sort((a, b) =>
  a.name.localeCompare(b.name, "en"),
);

export function resolveTacticalMapKey(mapName: string | null | undefined): string | null {
  const normalizedName = normalizeMapToken(String(mapName ?? ""));
  if (!normalizedName) return null;

  for (const mapConfig of TACTICAL_MAP_LIST) {
    if (mapConfig.aliases.some((alias) => normalizedName.includes(normalizeMapToken(alias)))) {
      return mapConfig.key;
    }
  }

  return null;
}
