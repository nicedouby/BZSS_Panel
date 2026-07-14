import factionMapping from "./faction-mapping.json";

type FactionCode =
  | "ADF"
  | "AFU"
  | "BAF"
  | "CAF"
  | "CRF"
  | "GFI"
  | "IMF"
  | "MEA"
  | "MEI"
  | "PLA"
  | "PLAAGF"
  | "PLANMC"
  | "RGF"
  | "TLF"
  | "USA"
  | "USMC"
  | "VDV"
  | "WPMC";

interface BattlegroupVisual {
  name: string;
  faction: FactionCode;
  unitIconBasename: string;
  aliases?: string[];
}

const assetModules = import.meta.glob("./*.{PNG,png,JPG,jpg,JPEG,jpeg}", {
  eager: true,
  import: "default",
}) as Record<string, string>;

const assetUrlsByBasename = Object.fromEntries(
  Object.entries(assetModules).map(([assetPath, assetUrl]) => {
    const segments = assetPath.split("/");
    return [segments[segments.length - 1], assetUrl];
  }),
) as Record<string, string>;

const factionFlagBasenames: Partial<Record<FactionCode, string>> = {
  ADF: "ADF.PNG",
  AFU: "AFU.PNG",
  BAF: "BAF.PNG",
  CAF: "CAF.PNG",
  CRF: "CRF.PNG",
  GFI: "GFI.PNG",
  IMF: "IMF.PNG",
  MEI: "MEI.PNG",
  PLA: "PLA.PNG",
  PLAAGF: "PLAAGF.PNG",
  PLANMC: "PLANMC.png",
  RGF: "RGF.PNG",
  TLF: "TLF.PNG",
  USA: "USA.PNG",
  USMC: "USMC.PNG",
  VDV: "VDV.png",
  WPMC: "WPMC.PNG",
};

const battlegroupVisuals: BattlegroupVisual[] = [
  { name: "1st Regiment", faction: "ADF", unitIconBasename: "T_ADF_1st_Regiment_Armored.PNG" },
  {
    name: "1st Battalion, Royal Australian Regiment",
    faction: "ADF",
    unitIconBasename: "T_ADF_1RAR_Mechanized.PNG",
    aliases: ["1RAR"],
  },
  {
    name: "2nd Battalion, Royal Australian Regiment",
    faction: "ADF",
    unitIconBasename: "T_ADF_2RAR_LightInfantry.PNG",
    aliases: ["2RAR"],
  },
  {
    name: "3rd Battalion, Royal Australian Regiment",
    faction: "ADF",
    unitIconBasename: "T_ADF_3RAR_AirAssault.PNG",
    aliases: ["3RAR"],
  },
  { name: "3rd Brigade", faction: "ADF", unitIconBasename: "T_ADF_3rd_Brigade_CombinedArms.PNG" },
  {
    name: "3rd Combat Service Support Battalion",
    faction: "ADF",
    unitIconBasename: "T_ADF_3rd_Combat_Service_Support.PNG",
    aliases: ["3rd Combat Service Support"],
  },
  {
    name: "5th Battalion, Royal Australian Regiment",
    faction: "ADF",
    unitIconBasename: "T_ADF_5RAR_Motorized.PNG",
    aliases: ["5RAR"],
  },

  {
    name: "10th Mountain Assault Brigade",
    faction: "AFU",
    unitIconBasename: "T_AFU_10thMAB_LightInfantry.PNG",
    aliases: ["10th MAB"],
  },
  {
    name: "11th Army Corps",
    faction: "AFU",
    unitIconBasename: "T_AFU_11thAC_CombinedArms.PNG",
    aliases: ["11th AC"],
  },
  {
    name: "148th Artillery Brigade",
    faction: "AFU",
    unitIconBasename: "T_AFU_148thAB_Support.PNG",
    aliases: ["148th AB"],
  },
  {
    name: "1st Tank Brigade",
    faction: "AFU",
    unitIconBasename: "T_AFU_1stTB_Armored.PNG",
    aliases: ["1st TB"],
  },
  {
    name: "28th Mechanized Brigade",
    faction: "AFU",
    unitIconBasename: "T_AFU_28thMB_Mechanized.PNG",
    aliases: ["28th MB"],
  },
  {
    name: "35th Marine Brigade",
    faction: "AFU",
    unitIconBasename: "T_AFU_35thMB_AmphibiousAssault.PNG",
    aliases: ["35th MB"],
  },
  {
    name: "58th Motorized Brigade",
    faction: "AFU",
    unitIconBasename: "T_AFU_58thIMIB_Motorized.PNG",
    aliases: ["58th IMIB", "58th Motorized Infantry Brigade"],
  },
  {
    name: "95th Air Assault Brigade",
    faction: "AFU",
    unitIconBasename: "T_AFU_95thAAB_AirAssault.PNG",
    aliases: ["95th AAB"],
  },

  {
    name: "1 Yorks Battle Group",
    faction: "BAF",
    unitIconBasename: "T_BAF_1_YORKS_Mechanized.PNG",
    aliases: ["1 YORKS"],
  },
  {
    name: "2nd Battalion, Parachute Regiment",
    faction: "BAF",
    unitIconBasename: "T_BAF_2_BPR_AirAssault.PNG",
    aliases: ["2 BPR"],
  },
  {
    name: "3 Rifles Battle Group",
    faction: "BAF",
    unitIconBasename: "T_BAF_3_RIFLES_Motorized.PNG",
    aliases: ["3 RIFLES", "3rd Rifles Battle Group"],
  },
  {
    name: "3rd Division Battle Group",
    faction: "BAF",
    unitIconBasename: "T_BAF_3DIV_CombinedArms.PNG",
    aliases: ["3DIV"],
  },
  {
    name: "Queen's Royal Hussars Battle Group",
    faction: "BAF",
    unitIconBasename: "T_BAF_QRH_Armored.PNG",
    aliases: ["QRH"],
  },
  {
    name: "Royal Logistics Corps Battle Group",
    faction: "BAF",
    unitIconBasename: "T_BAF_ROYALLOGI_Support.PNG",
    aliases: ["ROYALLOGI", "Royal Logistics"],
  },

  {
    name: "The 12e Regiment Blinde du Canada",
    faction: "CAF",
    unitIconBasename: "T_CAF_12e_Regiment_Motorized.PNG",
    aliases: ["The 12e Régiment Blindé du Canada"],
  },
  {
    name: "1 Canadian Mechanized Brigade Group",
    faction: "CAF",
    unitIconBasename: "T_CAF_1_CMBG_CombinedArms.PNG",
    aliases: ["1 CMBG"],
  },
  {
    name: "3rd Princess Patricia's Canadian Light Infantry",
    faction: "CAF",
    unitIconBasename: "T_CAF_3_PPCLI_LightInfantry.PNG",
    aliases: ["3 PPCLI"],
  },
  {
    name: "3rd Battalion, Royal Canadian Regiment",
    faction: "CAF",
    unitIconBasename: "T_CAF_3_RCR_AirAssault.PNG",
    aliases: ["3 RCR"],
  },
  {
    name: "Canadian Combat Support Brigade",
    faction: "CAF",
    unitIconBasename: "T_CAF_CCSB_Support.PNG",
    aliases: ["6 Canadian Combat Support Brigade", "CCSB"],
  },
  {
    name: "Lord Strathcona's Horse Regiment",
    faction: "CAF",
    unitIconBasename: "T_CAF_LdSH_Armored.PNG",
    aliases: ["LdSH"],
  },
  {
    name: "Royal Newfoundland Regiment",
    faction: "CAF",
    unitIconBasename: "T_CAF_R_NFLD_Reserve.PNG",
    aliases: ["R NFLD"],
  },
  { name: "The Westies", faction: "CAF", unitIconBasename: "T_CAF_TheWesties_.PNG" },
  {
    name: "Van Doos",
    faction: "CAF",
    unitIconBasename: "T_CAF_VanDoos_Mechanized.PNG",
    aliases: ["1st Battalion, Royal 22e Régiment"],
  },

  { name: "51st Wolverine Battalion", faction: "CRF", unitIconBasename: "" },

  { name: "16th Armored Division", faction: "GFI", unitIconBasename: "T_GFI_16thAD_Armored.PNG", aliases: ["16th AD"] },
  { name: "21st Division", faction: "GFI", unitIconBasename: "T_GFI_21stD_CombinedArms.PNG", aliases: ["21st D"] },
  { name: "30th Infantry Division", faction: "GFI", unitIconBasename: "T_GFI_30thID_Motorized.PNG", aliases: ["30th ID"] },
  { name: "55th Airborne Brigade", faction: "GFI", unitIconBasename: "T_GFI_55thAB_AirAssault.PNG", aliases: ["55th AB"] },
  { name: "64th Infantry Division", faction: "GFI", unitIconBasename: "T_GFI_64thID_LightInfantry.PNG", aliases: ["64th ID"] },
  { name: "75th Logistics Brigade", faction: "GFI", unitIconBasename: "T_GFI_75thLB_Support.PNG", aliases: ["75th LB"] },
  { name: "77th Infantry Division", faction: "GFI", unitIconBasename: "T_GFI_77thID_Mechanized.PNG", aliases: ["77th ID"] },

  { name: "1st Separate Tank Brigade", faction: "IMF", unitIconBasename: "T_IMF_Armored.PNG" },
  { name: "1st Separate Guards Brigade", faction: "IMF", unitIconBasename: "T_IMF_BattleGroup_CombinedArms.PNG" },
  { name: "Hoplite Battalion", faction: "IMF", unitIconBasename: "T_IMF_LightInfantry.PNG" },
  { name: "1st Separate Cossack Brigade", faction: "IMF", unitIconBasename: "T_IMF_Mechanized.PNG" },
  { name: "3rd Separate Guards Motorized Brigade", faction: "IMF", unitIconBasename: "T_IMF_Motorized.PNG" },
  { name: "3rd Guards Artillery Brigade", faction: "IMF", unitIconBasename: "T_IMF_Support.PNG" },

  { name: "60th Prince Assur Armored Brigade", faction: "MEA", unitIconBasename: "T_MEA_60th_Prince_Assur_Armored.PNG", aliases: ["60th Prince Assur"] },
  { name: "1st Legion of Babylon", faction: "MEA", unitIconBasename: "T_MEA_1st_LegionofBabylon_CombinedArms.PNG" },
  { name: "4th Border Guard", faction: "MEA", unitIconBasename: "T_MEA_4th_Border_Guard_LightInfantry.PNG" },
  { name: "3rd King Qadesh Brigade", faction: "MEA", unitIconBasename: "T_MEA_3rd_King_Qadesh_Mechanized.PNG", aliases: ["3rd King Qadesh"] },
  { name: "83rd Prince Zaid Motorized Brigade", faction: "MEA", unitIconBasename: "T_MEA_83rd_Prince_Zaid_Motorized.PNG", aliases: ["83rd Prince Zaid"] },
  { name: "2nd Vizir Hussein Support Brigade", faction: "MEA", unitIconBasename: "T_MEA_2nd_Vizir_Hussein_Support.PNG", aliases: ["2nd Vizir Hussein"] },
  { name: "91st Battalion", faction: "MEA", unitIconBasename: "T_MEA_91st_Battalion_AirAssault.PNG" },

  { name: "Irregular Armored Squadron", faction: "MEI", unitIconBasename: "T_MEI_Armored.PNG" },
  { name: "Irregular Battle Group", faction: "MEI", unitIconBasename: "T_MEI_BattleGrp_CombinedArms.PNG", aliases: ["Irregular Battlegroup"] },
  { name: "Irregular Light Infantry", faction: "MEI", unitIconBasename: "T_MEI_LightInfantry.PNG" },
  { name: "Irregular Mechanized Platoon", faction: "MEI", unitIconBasename: "T_MEI_Mechanized.PNG" },
  { name: "Irregular Motorized Platoon", faction: "MEI", unitIconBasename: "T_MEI_Motorized.PNG" },
  { name: "Irregular Fire Support Group", faction: "MEI", unitIconBasename: "T_MEI_Support.PNG" },

  { name: "112th Medium Combined Arms Brigade", faction: "PLA", unitIconBasename: "T_PLA_112th_Brigade_Motorized.PNG", aliases: ["112th Brigade"] },
  { name: "118th Combined Arms Brigade", faction: "PLA", unitIconBasename: "T_PLA_118th_Brigade_CombinedArms.PNG" },
  { name: "149th Mountain Infantry Brigade", faction: "PLA", unitIconBasename: "T_PLA_149th_Brigade_LightInfantry.PNG", aliases: ["149th Brigade"] },
  { name: "161st Air Assault Brigade", faction: "PLA", unitIconBasename: "T_PLA_161st_Brigade_AirAssault.PNG", aliases: ["161st Brigade"] },
  { name: "195th Heavy Combined Arms Brigade", faction: "PLA", unitIconBasename: "T_PLA_195th_Brigade_Armored.PNG", aliases: ["195th Brigade"] },
  { name: "80th Support Brigade", faction: "PLA", unitIconBasename: "T_PLA_80th_Brigade_Support.PNG", aliases: ["80th Brigade"] },

  {
    name: "10th Light Combined Arms Battalion",
    faction: "PLAAGF",
    unitIconBasename: "T_PLAAGF_10th_Light_Battalion_LightInfantry.PNG",
    aliases: ["10th Light Battalion"],
  },
  {
    name: "14th Amphibious Combined Arms Brigade",
    faction: "PLAAGF",
    unitIconBasename: "T_PLAAGF_14th_Brigade_CombinedArms.PNG",
    aliases: ["14th Brigade"],
  },
  {
    name: "4th Medium Combined Arms Battalion",
    faction: "PLAAGF",
    unitIconBasename: "T_PLAAGF_4th_Medium_Battalion_Mechanized.PNG",
  },
  {
    name: "9th Heavy Combined Arms Battalion",
    faction: "PLAAGF",
    unitIconBasename: "T_PLAAGF_9th_Heavy_Battalion_Armored.PNG",
  },

  { name: "17th Marine Support Battalion", faction: "PLANMC", unitIconBasename: "T_PLANMC_17th_MarineBattalion_Support.PNG" },
  { name: "3rd Marine Heavy Battalion", faction: "PLANMC", unitIconBasename: "T_PLANMC_3rd_Heavy_Battalion_Armored.PNG" },
  { name: "4th Marine Special Combat Battalion", faction: "PLANMC", unitIconBasename: "T_PLANMC_4th_SpecialCombatBattalion_LightInfantry.PNG" },
  { name: "5th Marine Combined Arms Brigade", faction: "PLANMC", unitIconBasename: "T_PLANMC_5th_MarineBrigade_CombinedArms.PNG" },
  { name: "7th Marine Medium Battalion", faction: "PLANMC", unitIconBasename: "T_PLANMC_7th_Medium_Battalion_Motorized.PNG" },

  {
    name: "1398th Separate Reconnaissance Battalion",
    faction: "RGF",
    unitIconBasename: "T_RGF_1398th_Recon_LightInfantry.PNG",
    aliases: ["1398th Recon Battalion"],
  },
  {
    name: "205th Separate Motor Rifle Brigade",
    faction: "RGF",
    unitIconBasename: "T_RGF_205th_OMSBr_Mechanized.PNG",
    aliases: ["205th OMSBr"],
  },
  {
    name: "336th Guards Naval Infantry Brigade",
    faction: "RGF",
    unitIconBasename: "T_RGF_336th_GNIBr_AmphibiousAssault.PNG",
    aliases: ["336th GNIBr"],
  },
  {
    name: "3rd Motor Rifle Brigade",
    faction: "RGF",
    unitIconBasename: "T_RGF_3rd_Mtr_Div_Motorized.PNG",
    aliases: ["3rd Mtr Div"],
  },
  {
    name: "49th Combined Arms Army",
    faction: "RGF",
    unitIconBasename: "T_RGF_49th_OA_CombinedArms.PNG",
    aliases: ["49th OA"],
  },
  {
    name: "6th Separate Tank Brigade",
    faction: "RGF",
    unitIconBasename: "T_RGF_6th_OTBr_Armored.PNG",
    aliases: ["6th OTBr"],
  },
  {
    name: "78th Detached Logistics Brigade",
    faction: "RGF",
    unitIconBasename: "T_RGF_78th_OBrMTO_Support.PNG",
    aliases: ["78th OBrMTO"],
  },

  { name: "1st Army", faction: "TLF", unitIconBasename: "T_TLF_1st_Army_CombinedArms.PNG" },
  {
    name: "1st Commando Brigade",
    faction: "TLF",
    unitIconBasename: "T_TLF_1st_Cmdo_Brigade_AirAssault.PNG",
    aliases: ["1st Cmdo Brigade"],
  },
  {
    name: "2nd Border Brigade",
    faction: "TLF",
    unitIconBasename: "T_TLF_2nd_BorderBrigade_LightInfantry.PNG",
  },
  {
    name: "4th Armored Brigade",
    faction: "TLF",
    unitIconBasename: "T_TLF_4th_ArmoredBrigade_Armored.PNG",
  },
  {
    name: "51st Motorized Infantry Brigade",
    faction: "TLF",
    unitIconBasename: "T_TLF_51st_MotorInf_Brigade_Motorized.PNG",
    aliases: ["51st MotorInf Brigade"],
  },
  {
    name: "66th Mechanized Infantry Brigade",
    faction: "TLF",
    unitIconBasename: "T_TLF_66th_MechInfBrigade_Mechanized.PNG",
    aliases: ["66th MechInf Brigade"],
  },
  {
    name: "Land Forces Logistics Command",
    faction: "TLF",
    unitIconBasename: "T_TLF_LandForcesLogiCmd_Support.PNG",
    aliases: ["Land Forces Logi Cmd"],
  },

  {
    name: "10th Mountain Division",
    faction: "USA",
    unitIconBasename: "T_USA_10th_MTN_LightInfantry.PNG",
    aliases: ["10th MTN"],
  },
  {
    name: "1st Cavalry Regiment",
    faction: "USA",
    unitIconBasename: "T_USA_1st_Cav_Mechanized.PNG",
    aliases: ["1st Cav"],
  },
  {
    name: "1st Infantry Division",
    faction: "USA",
    unitIconBasename: "T_USA_1st_INFDIV_CombinedArms.PNG",
    aliases: ["1st INFDIV"],
  },
  {
    name: "2nd Cavalry Stryker Brigade",
    faction: "USA",
    unitIconBasename: "T_USA_2nd_CAV_Motorized.PNG",
    aliases: ["2nd CAV"],
  },
  {
    name: "37th Armored Regiment",
    faction: "USA",
    unitIconBasename: "T_USA_37th_ArmorRegiment_Armored.PNG",
    aliases: ["37th Armor Regiment"],
  },
  {
    name: "497th Combat Sustainment Support Battalion",
    faction: "USA",
    unitIconBasename: "T_USA_497th_CSSB_Support.PNG",
    aliases: ["497th CSSB"],
  },
  {
    name: "504th Paracute Infantry Regiment",
    faction: "USA",
    unitIconBasename: "T_USA_504th_PIR_AirAssault.PNG",
    aliases: ["504th Parachute Infantry Regiment", "504th PIR"],
  },

  { name: "1st Marines Regiment", faction: "USMC", unitIconBasename: "T_USMC_1-1stMarines_LightInfantry.PNG", aliases: ["1st Marines Regimental Combat Team", "1-1st Marines"] },
  { name: "1st Tank Battalion", faction: "USMC", unitIconBasename: "T_USMC_1st_TNK_BN_Armored.PNG", aliases: ["1st TNK BN"] },
  { name: "2nd Marine Logistics Group", faction: "USMC", unitIconBasename: "T_USMC_2nd_MLG_Support.PNG", aliases: ["2nd MLG"] },
  { name: "3rd Battalion, 2nd Marines", faction: "USMC", unitIconBasename: "T_USMC_3-2nd_Marines_AirAssault.PNG", aliases: ["3-2nd Marines"] },
  { name: "31st Marine Expeditionary Unit", faction: "USMC", unitIconBasename: "T_USMC_31st_MEU_CombinedArms.PNG", aliases: ["31st MEU"] },
  { name: "3rd Light Armored Recon Battalion", faction: "USMC", unitIconBasename: "T_USMC_3rd_LAR_BN_Motorized.PNG", aliases: ["3rd LAR BN"] },
  { name: "4th Marines Amphibious Ready Group", faction: "USMC", unitIconBasename: "T_USMC_4th_MARG_AmphibiousAssault.PNG", aliases: ["4th MARG"] },

  { name: "104th Tank Battalion", faction: "VDV", unitIconBasename: "T_VDV_104th_Tank_Battalion_Armored.PNG" },
  { name: "108th Guards Air Assault Regiment", faction: "VDV", unitIconBasename: "T_VDV_108th_Guards_AirAssault.PNG" },
  { name: "150th Support Battalion", faction: "VDV", unitIconBasename: "T_VDV_150th_Batallion_Support.PNG" },
  { name: "173rd Guards Regiment", faction: "VDV", unitIconBasename: "T_VDV_173rd_Guards_LightInfantry.PNG" },
  { name: "217th Guards Airborne Regiment", faction: "VDV", unitIconBasename: "T_VDV_217th_Guards_AirAssaut.PNG" },
  { name: "7th Guards Mountain Air Assault Division", faction: "VDV", unitIconBasename: "T_VDV_7th_Guards_CombinedArms.PNG", aliases: ["7th Guards"] },

  { name: "Manticore Security Task Force", faction: "WPMC", unitIconBasename: "T_WPMC_ManticoreSecurityTaskForce_CombinedArms.PNG" },
  { name: "Minotaur Solutions Patrol Group", faction: "WPMC", unitIconBasename: "T_WPMC_MinotaurSolutionsPatrolGroup_LightInfantry.PNG" },
  { name: "Murk Water Air Wing", faction: "WPMC", unitIconBasename: "T_WPMC_MurkWaterAirWing_AirAssault.PNG", aliases: ["MurkWater Air Wing"] },
  { name: "Overwatch 6 Patrol Group", faction: "WPMC", unitIconBasename: "T_WPMC_Overwatch6PatrolGroup_LightInfantry.PNG", aliases: ["Overwatch6 Patrol Group"] },
];

export const __factionAssetManifestForTests = {
  battlegroupVisuals,
  factionFlagBasenames,
} as const;

const factionCodes = new Set<FactionCode>(Object.keys(factionFlagBasenames) as FactionCode[]);
factionCodes.add("MEA");

const battlegroupByNormalizedName = new Map<string, BattlegroupVisual>();

for (const visual of battlegroupVisuals) {
  registerLookupName(visual.name, visual);
  for (const alias of visual.aliases ?? []) {
    registerLookupName(alias, visual);
  }
}

for (const factionCode of factionCodes) {
  registerLookupName(factionCode, {
    name: factionCode,
    faction: factionCode,
    unitIconBasename: "",
  });
}

function registerLookupName(name: string, visual: BattlegroupVisual) {
  battlegroupByNormalizedName.set(normalizeLookupName(name), visual);
}

function normalizeLookupName(name: string): string {
  return String(name ?? "")
    .trim()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getAssetUrlByBasename(basename: string | null | undefined): string | null {
  if (!basename) return null;
  return assetUrlsByBasename[basename] ?? null;
}

function resolveBattlegroupVisual(teamName: string): BattlegroupVisual | null {
  const normalized = normalizeLookupName(teamName);
  if (!normalized) return null;
  return battlegroupByNormalizedName.get(normalized) ?? null;
}

export function getFactionFromTeamName(teamName: string): string | null {
  return resolveBattlegroupVisual(teamName)?.faction ?? null;
}

export function getFactionFromTeamId(teamId: string | null | undefined): string | null {
  const normalized = String(teamId ?? "").trim().toUpperCase();
  if (!normalized) return null;

  // ShowServerInfo returns values such as PLA_S_CombinedArms_Seed.
  // Only accept prefixes that have a matching flag asset.
  const prefix = normalized.split("_", 1)[0] ?? "";
  return factionFlagBasenames[prefix as FactionCode] ? prefix : null;
}

export function getFlagUrl(factionCode: string): string | null {
  const normalizedCode = String(factionCode ?? "").trim().toUpperCase() as FactionCode;
  return getAssetUrlByBasename(factionFlagBasenames[normalizedCode] ?? null);
}

/**
 * 根据 RCON / 对局状态中的战斗群（编制）名称，返回所属阵营的旗帜资源。
 * 支持完整名称、已登记别名及阵营代码；无法识别时返回 null。
 */
export function 获取战斗群旗帜(战斗群名称: string): string | null {
  const factionCode = getFactionFromTeamName(战斗群名称);
  if (!factionCode) return null;
  return getFlagUrl(factionCode);
}

/** @deprecated 请使用 获取战斗群旗帜。 */
export const getFlagUrlByTeamName = 获取战斗群旗帜;

export function getUnitIconUrlByTeamName(teamName: string): string | null {
  return getAssetUrlByBasename(resolveBattlegroupVisual(teamName)?.unitIconBasename ?? null);
}

export function getChineseNameFromTeamName(teamName: string): string {
  if (!teamName) return "";
  const normalized = normalizeLookupName(teamName);
  const bgMapping = factionMapping.battlegroups as Record<string, string>;
  
  for (const [bgName, chName] of Object.entries(bgMapping)) {
    if (normalizeLookupName(bgName) === normalized) {
      return chName;
    }
  }
  
  const visual = resolveBattlegroupVisual(teamName);
  if (visual) {
    const primaryNormalized = normalizeLookupName(visual.name);
    for (const [bgName, chName] of Object.entries(bgMapping)) {
      if (normalizeLookupName(bgName) === primaryNormalized) {
        return chName;
      }
    }
  }
  
  const factionCode = visual?.faction ?? getFactionFromTeamName(teamName);
  if (factionCode) {
    return getChineseNameByFaction(factionCode);
  }
  
  return teamName;
}

export function getChineseNameByFaction(factionCode: string): string {
  const code = String(factionCode ?? "").trim().toUpperCase();
  const factionMap = factionMapping.factions as Record<string, string>;
  return factionMap[code] ?? factionCode;
}