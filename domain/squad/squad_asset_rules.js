// -*- coding: utf-8 -*-

function makeAssetPattern(name) {
  const text = String(name ?? "").trim().toLowerCase().replace(/\.uasset$/i, "");
  if (!text) return null;

  const chunks = text.match(/[a-z0-9]+/g);
  if (!chunks || chunks.length === 0) return null;

  const body = chunks.map(escapeRegExp).join("[\\s._-]*");
  return `(?:^|[^a-z0-9])${body}(?=$|[^a-z0-9])`;
}

function buildBucket(names) {
  const regex = dedupeStrings(names.map(makeAssetPattern).filter(Boolean));
  return Object.freeze({
    label: "",
    exactWhitelist: Object.freeze([]),
    aliases: Object.freeze({
      exactWhitelist: Object.freeze([]),
    }),
    contains: Object.freeze([]),
    regex: Object.freeze(regex),
  });
}

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupeStrings(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

const TANK_ASSET_NAMES = Object.freeze([
  "AUS_M1A1",
  "FV4034",
  "Leopard2",
  "M1A1_USMC",
  "M1A2",
  "M60T",
  "M60T_WPMC",
  "Sprut-SDM1",
  "T62",
  "T64_BM2",
  "T72A",
  "T72AV",
  "T72B3",
  "T90A",
  "ZTZ99",
]);

const IFV_ASSET_NAMES = Object.freeze([
  "AAVP7A1",
  "ACV-15",
  "BFV",
  "BMD-1M",
  "BMD-4M",
  "BMP-1",
  "BMP-2",
  "BMP-2M",
  "BMP-3M",
  "BMP1TS_AFU",
  "BMP1_AFU",
  "BMP2_AFU",
  "BTR-D",
  "BTR-MDM",
  "BTR4",
  "BTR80",
  "FV510",
  "FV510_40mm",
  "LAV25",
  "LAV6",
  "M1126",
  "M1128_MGS",
  "ZBD04A",
  "ZBD05",
  "ZBL08",
  "ZSD89",
]);

const LIGHT_VEHICLE_ASSET_NAMES = Object.freeze([
  "ASLAV",
  "BRDM-2",
  "BRDM2-L1_AFU",
  "CSK131",
  "Cobra_II",
  "Coyote",
  "Coyote_CRF",
  "EmergencyRecovery_Motorbike",
  "Kozak_2M1_AFU",
  "LPPV",
  "LUVW",
  "LUVW_CRF",
  "Lynx_8x8",
  "M1117",
  "M1151",
  "M1151_CRF",
  "M1151_GFI",
  "M1151_MEI",
  "M1151_WPMC",
  "M18",
  "M-Gator",
  "MATV",
  "MATV_USMC",
  "MTLB",
  "MTLB_AFU",
  "PARS_III",
  "PMV",
  "QuadBike",
  "TAPV",
  "Technical",
  "Technical2Seater",
  "Technical2Seater_WPMC",
  "Technical4Seater",
  "Technical4Seater_WPMC",
  "Technical_Armoured",
  "Technical_CRF",
  "Tigr",
  "LAV_RWS",
  "M1064A2_TLF",
  "M1064A3",
  "M113A2T_TLF",
  "M113A3",
  "M113A3_WPMC",
  "M113_CRF",
  "M939Truck_WPMC",
  "M939_CRF",
  "AUS_Utility_Truck",
  "British_Util_Truck",
  "CAF_Utility_Truck",
  "BMC_185_Truck",
  "CTM131_Truck",
  "US_Util_Truck",
  "Ural375",
  "Ural4320",
  "Kamaz_5350",
  "Kraz-6322",
  "Kraz-6322_BM21Grad",
  "MI17",
  "MI8",
  "MI8_AFU",
  "MRH90",
  "SA330",
  "UH1H",
  "UH1H_GFI",
  "UH1Y",
  "UH60M",
  "AUS_UH60M",
  "Z8G",
  "Z8J",
  "Z9A",
  "RHIB",
  "Loach",
  "Loach_CAS_WPMC",
  "Loach_WPMC",
  "CH146",
  "CH146_Raven_WPMC",
]);

const SPG_ASSET_NAMES = Object.freeze([
  "Emplaced_SPG9",
  "Emplaced_ZiS3_Cannon",
  "Emplaced_AGS-17",
  "Emplaced_Mk19",
  "Emplaced_UB32_RocketArtillery",
]);

export const squadAssetRules = Object.freeze({
  version: 1,
  defaultSquadNamePatterns: Object.freeze([]),
  priority: Object.freeze([]),
  infantry: Object.freeze({
    exactWhitelist: Object.freeze([]),
    aliases: Object.freeze({
      exactWhitelist: Object.freeze([]),
    }),
    contains: Object.freeze([]),
    blacklist: Object.freeze([]),
    regex: Object.freeze([]),
    blacklistRegex: Object.freeze([]),
    classes: Object.freeze({
      priority: Object.freeze([]),
    }),
  }),
  vehicle: Object.freeze({
    exactWhitelist: Object.freeze([]),
    aliases: Object.freeze({
      exactWhitelist: Object.freeze([]),
    }),
    contains: Object.freeze([]),
    blacklist: Object.freeze([]),
    regex: Object.freeze([]),
    blacklistRegex: Object.freeze([]),
    classes: Object.freeze({
      priority: Object.freeze([]),
      ifv: buildBucket(IFV_ASSET_NAMES),
      light_vehicle: buildBucket(LIGHT_VEHICLE_ASSET_NAMES),
      tank: buildBucket(TANK_ASSET_NAMES),
      spg: buildBucket(SPG_ASSET_NAMES),
    }),
  }),
  support: Object.freeze({
    exactWhitelist: Object.freeze([]),
    aliases: Object.freeze({
      exactWhitelist: Object.freeze([]),
    }),
    contains: Object.freeze([]),
    blacklist: Object.freeze([]),
    regex: Object.freeze([]),
    blacklistRegex: Object.freeze([]),
    classes: Object.freeze({
      priority: Object.freeze([]),
    }),
  }),
});

export default squadAssetRules;
