import mapCornersData from "./map-corners.json" with { type: "json" };

const STATIC_ASSET_BY_MAP = {
  AlBasrah_AAS_v1: {
    captureZones: [
      { name: "01-AlKhora", x: -122747.449, y: -126662.33, z: 904.58 },
      { name: "02-WestOutskirts", x: -85742.813, y: -108347.721, z: 804.115 },
      { name: "03-Courtyard", x: -53290.842, y: -57268.061, z: 1290.001 },
      { name: "04-SouthSuburbs", x: -48420.736, y: 13822.024, z: 592.639 },
      { name: "05-Mosque", x: -12344.512, y: 21119.884, z: 588.047 },
      { name: "06-Refinery", x: 34850.213, y: 28142.688, z: 590.547 },
      { name: "07-IslandSuburbs", x: 63855.96, y: 64688.161, z: 642.812 },
    ],
  },
  AlBasrah_RAAS_v1: {
    captureZones: [
      { name: "B1-Airfield", x: -57095.684, y: -126662.33, z: 904.58 },
      { name: "B2-ShantyMarina", x: -122747.449, y: -49634.712, z: 592.186 },
      { name: "B3-OldHospital", x: -53290.842, y: -57268.061, z: 1290.001 },
      { name: "B4-GenevaApartments", x: -48420.736, y: 13822.024, z: 592.639 },
      { name: "B5-BridgeviewApartments", x: 34850.213, y: 28142.688, z: 590.547 },
      { name: "B6-CastleviewApartments", x: -472.482, y: 50957.83, z: 1689.992 },
      { name: "B7-Kiriku", x: 63855.96, y: 64688.161, z: 642.812 },
    ],
  },
  Chora_RAAS_v1: {
    captureZones: [
      { name: "01-TriCommons", x: 33.0, y: 29.0, z: 0 },
      { name: "02-AbdelsFarm", x: 39.5, y: 36.5, z: 0 },
      { name: "03-WalledCourts", x: 48.0, y: 45.0, z: 0 },
      { name: "04-OldTown", x: 55.0, y: 52.5, z: 0 },
      { name: "05-TownCenter", x: 61.5, y: 59.0, z: 0 },
    ],
  },
  Sumari_Seed_v1: {
    captureZones: [
      { name: "01-TriCommons", x: 40.0, y: 37.5, z: 0 },
      { name: "02-AbdelsFarm", x: 45.5, y: 44.0, z: 0 },
      { name: "03-WalledCourts", x: 51.0, y: 50.5, z: 0 },
      { name: "04-Market", x: 56.0, y: 55.5, z: 0 },
      { name: "05-GasStation", x: 62.0, y: 61.0, z: 0 },
    ],
  },
  Mestia_RAAS_v1: {
    captureZones: [
      { name: "01-Quarry", x: 69538.671, y: -29071.391, z: -1946.936 },
      { name: "02-TunnelEntrance", x: 28854.453, y: 560.512, z: -1280.719 },
      { name: "04-CrucibleAlpha", x: 10836.241, y: -2103.843, z: -1627.717 },
      { name: "04-Warehouse", x: -38960.562, y: 66551.055, z: -9710.021 },
      { name: "05-Armory", x: -58508.312, y: 23924.438, z: -6764.733 },
    ],
  },
};

const MAP_IMAGE_BY_KEY = {
  AlBasrah_AAS_v1: "T_AlBasrah_Minimap.PNG",
  BlackCoast_RAAS_v1: "Black_Coast_Minimap.PNG",
  Anvil_RAAS_v1: "Anvil_Minimap.PNG",
  Belaya_RAAS_v1: "Belaya_Minimap.PNG",
  Chora_RAAS_v1: "Chora_Minimap.PNG",
  Fallujah_RAAS_v1: "T_Fallujah_Minimap.PNG",
  FoolsRoad_RAAS_v1: "Fools_Road_Minimap.PNG",
  Harju_RAAS_v1: "Harju_Minimap.PNG",
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
  Sumari_Seed_v1: "Sumari_Minimap.PNG",
  Sanxian_RAAS_v1: "T_Sanxian_Minimap_Large.PNG",
  Tallil_RAAS_v1: "Tallil_Outskirts_Minimap.PNG",
  Yehorivka_RAAS_v1: "Yehorivka_Minimap.PNG",
};

const MAP_NAME_BY_KEY = {
  AlBasrah_AAS_v1: "Al Basrah",
  BlackCoast_RAAS_v1: "Black Coast",
  Anvil_RAAS_v1: "Anvil",
  Belaya_RAAS_v1: "Belaya",
  Chora_RAAS_v1: "Chora",
  Fallujah_RAAS_v1: "Fallujah",
  FoolsRoad_RAAS_v1: "Fools Road",
  Harju_RAAS_v1: "Harju",
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
  Sumari_Seed_v1: "Sumari",
  Sanxian_RAAS_v1: "Sanxian",
  Tallil_RAAS_v1: "Tallil Outskirts",
  Yehorivka_RAAS_v1: "Yehorivka",
};

function normalizeMapToken(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function buildAliases(key, name) {
  const rawBase = key.replace(/_RAAS_v1$/i, "");
  const compactBase = normalizeMapToken(rawBase);
  const compactName = normalizeMapToken(name);
  const extraAliasesByKey = {
    BlackCoast_RAAS_v1: ["balck coast", "black coast"],
    Sanxian_RAAS_v1: ["sanxian"],
    Harju_RAAS_v1: ["harju"],
    AlBasrah_AAS_v1: ["albasrah"],
  };
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
        ...(extraAliasesByKey[key] ?? []),
      ].filter(Boolean),
    ),
  );
}

function buildConfig(key, entry) {
  const imageName = MAP_IMAGE_BY_KEY[key];
  const corners = entry?.corners;
  if (!imageName) return null;

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
    tileBasePath: `/assets/map-tiles/${key}`,
    maxZoomLevel: 4,
    bounds: { minX, minY, maxX, maxY },
    aliases: buildAliases(key, name),
  };
}

export const TACTICAL_MAP_CONFIGS = Object.fromEntries(
  Object.entries(mapCornersData)
    .map(([key, entry]) => buildConfig(key, entry))
    .filter(Boolean)
    .map((config) => [config.key, config]),
);

export const TACTICAL_MAP_LIST = Object.values(TACTICAL_MAP_CONFIGS).sort((a, b) =>
  a.name.localeCompare(b.name, "en"),
);

export function getDefaultTacticalMapKey() {
  return TACTICAL_MAP_LIST[0]?.key ?? null;
}

export function resolveTacticalMapKey(mapName) {
  const normalizedName = normalizeMapToken(String(mapName ?? ""));
  if (!normalizedName) return null;

  for (const mapConfig of TACTICAL_MAP_LIST) {
    if (mapConfig.aliases.some((alias) => normalizedName.includes(normalizeMapToken(alias)))) {
      return mapConfig.key;
    }
  }
  return null;
}

export function getStaticTacticalAssets(mapKey) {
  return STATIC_ASSET_BY_MAP[String(mapKey ?? "")] ?? null;
}
