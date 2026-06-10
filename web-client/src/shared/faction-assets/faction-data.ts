// Faction Flags
import flagADF from "./flag_adf.jpg";
import flagAFU from "./flag_afu.png";
import flagBAF from "./flag_baf.png";
import flagCAF from "./flag_caf.png";
import flagUSA from "./flag_usa.png";
import flagUSMC from "./flag_usmc.png";
import flagRGF from "./flag_rgf.png";
import flagVDV from "./flag_vdv.png";
import flagPLA from "./flag_pla.png";
import flagPLAAGF from "./flag_plaagf.png";
import flagPLANMC from "./flag_planmc.png";
import flagCRF from "./flag_crf.png";
import flagGFI from "./flag_gfi.png";
import flagIMF from "./flag_imf.png";
import flagMEI from "./flag_mei.png";
import flagTLF from "./flag_tlf.png";

// Formation Badges - ADF
import badgeADFAirAssault from "./badge_adf_air_assault.png";
import badgeADFCombinedArms from "./badge_adf_combined_arms.png";
import badgeADFMechanized from "./badge_adf_mechanized.png";

// AFU
import badgeAFUAirAssault from "./badge_afu_air_assault.png";
import badgeAFUArmored from "./badge_afu_armored.png";
import badgeAFUCombinedArms from "./badge_afu_combined_arms.png";
import badgeAFUMechanized from "./badge_afu_mechanized.png";
import badgeAFUSupport from "./badge_afu_support.png";

// BAF
import badgeBAFAirAssault from "./badge_baf_air_assault.png";
import badgeBAFArmored from "./badge_baf_armored.png";
import badgeBAFCombinedArms from "./badge_baf_combined_arms.png";
import badgeBAFMechanized from "./badge_baf_mechanized.png";
import badgeBAFSupport from "./badge_baf_support.png";

// CAF
import badgeCAFAirAssault from "./badge_caf_air_assault.png";
import badgeCAFArmored from "./badge_caf_armored.png";
import badgeCAFCombinedArms from "./badge_caf_combined_arms.png";
import badgeCAFMechanized from "./badge_caf_mechanized.png";
import badgeCAFMotorized from "./badge_caf_motorized.png";
import badgeCAFSupport from "./badge_caf_support.png";

// USA
import badgeUSAArmored from "./badge_usa_armored.png";
import badgeUSACombinedArms from "./badge_usa_combined_arms.png";
import badgeUSALightInfantry from "./badge_usa_light_infantry.png";
import badgeUSAMotorized from "./badge_usa_motorized.png";
import badgeUSASupport from "./badge_usa_support.png";

// USMC
import badgeUSMCArmored from "./badge_usmc_armored.png";
import badgeUSMCCombinedArms from "./badge_usmc_combined_arms.png";
import badgeUSMCLightInfantry from "./badge_usmc_light_infantry.png";
import badgeUSMCMotorized from "./badge_usmc_motorized.png";
import badgeUSMCSupport from "./badge_usmc_support.png";
import badgeUSMCAmphibious from "./badge_usmc_amphibious.png";

// RGF
import badgeRGFArmored from "./badge_rgf_armored.png";
import badgeRGFCombinedArms from "./badge_rgf_combined_arms.png";
import badgeRGFMechanized from "./badge_rgf_mechanized.png";
import badgeRGFSupport from "./badge_rgf_support.png";
import badgeRGFAmphibious from "./badge_rgf_amphibious.png";

// VDV
import badgeVDVAirAssault from "./badge_vdv_air_assault.png";
import badgeVDVArmored from "./badge_vdv_armored.png";
import badgeVDVCombinedArms from "./badge_vdv_combined_arms.png";
import badgeVDVSupport from "./badge_vdv_support.png";

// PLA
import badgePLAArmored from "./badge_pla_armored.png";
import badgePLACombinedArms from "./badge_pla_combined_arms.png";

// PLAAGF
import badgePLAAGFArmored from "./badge_plaagf_armored.png";
import badgePLAAGFCombinedArms from "./badge_plaagf_combined_arms.png";
import badgePLAAGFAmphibious from "./badge_plaagf_amphibious.png";

// PLANMC
import badgePLANMCCombinedArms from "./badge_planmc_combined_arms.png";

// CRF
import badgeCRFCombinedArms from "./badge_crf_combined_arms.png";

// GFI
import badgeGFIArmored from "./badge_gfi_armored.png";
import badgeGFICombinedArms from "./badge_gfi_combined_arms.png";
import badgeGFILightInfantry from "./badge_gfi_light_infantry.png";
import badgeGFIMechanized from "./badge_gfi_mechanized.png";
import badgeGFIMotorized from "./badge_gfi_motorized.png";
import badgeGFISupport from "./badge_gfi_support.png";

// IMF
import badgeIMFArmored from "./badge_imf_armored.png";
import badgeIMFCombinedArms from "./badge_imf_combined_arms.png";
import badgeIMFLightInfantry from "./badge_imf_light_infantry.png";
import badgeIMFMechanized from "./badge_imf_mechanized.png";
import badgeIMFMotorized from "./badge_imf_motorized.png";
import badgeIMFSupport from "./badge_imf_support.png";

// MEI
import badgeMEIArmored from "./badge_mei_armored.png";
import badgeMEICombinedArms from "./badge_mei_combined_arms.png";
import badgeMEIMechanized from "./badge_mei_mechanized.png";
import badgeMEIMotorized from "./badge_mei_motorized.png";
import badgeMEISupport from "./badge_mei_support.png";

// TLF
import badgeTLFAirAssault from "./badge_tlf_air_assault.png";
import badgeTLFCombinedArms from "./badge_tlf_combined_arms.png";

const factionFlags: Record<string, string> = {
  ADF: flagADF,
  AFU: flagAFU,
  BAF: flagBAF,
  CAF: flagCAF,
  USA: flagUSA,
  USMC: flagUSMC,
  RGF: flagRGF,
  VDV: flagVDV,
  PLA: flagPLA,
  PLAAGF: flagPLAAGF,
  PLANMC: flagPLANMC,
  CRF: flagCRF,
  GFI: flagGFI,
  IMF: flagIMF,
  MEI: flagMEI,
  TLF: flagTLF,
};

const formationBadges: Record<string, string> = {
  "3rd Battalion, Royal Australian Regiment": badgeADFAirAssault,
  "3rd Brigade": badgeADFCombinedArms,
  "1st Battalion, Royal Australian Regiment": badgeADFMechanized,
  "95th Air Assault Brigade": badgeAFUAirAssault,
  "1st Tank Brigade": badgeAFUArmored,
  "11th Army Corps": badgeAFUCombinedArms,
  "28th Mechanized Brigade": badgeAFUMechanized,
  "148th Artillery Brigade": badgeAFUSupport,
  "2nd Battalion, Parachute Regiment": badgeBAFAirAssault,
  "Queen's Royal Hussars Battle Group": badgeBAFArmored,
  "3rd Division Battle Group": badgeBAFCombinedArms,
  "1 Yorks Battle Group": badgeBAFMechanized,
  "Royal Logistics Corps Battle Group": badgeBAFSupport,
  "3rd Battalion, Royal Canadian Regiment": badgeCAFAirAssault,
  "Lord Strathcona's Horse Regiment": badgeCAFArmored,
  "1 Canadian Mechanized Brigade Group": badgeCAFCombinedArms,
  "1st Battalion, Royal 22e Régiment": badgeCAFMechanized,
  "The 12e Régiment Blindé du Canada": badgeCAFMotorized,
  "6 Canadian Combat Support Brigade": badgeCAFSupport,
  "37th Armored Regiment": badgeUSAArmored,
  "1st Infantry Division": badgeUSACombinedArms,
  "10th Mountain Division": badgeUSALightInfantry,
  "2nd Cavalry Stryker Brigade": badgeUSAMotorized,
  "497th Combat Sustainment Support Battalion": badgeUSASupport,
  "1st Tank Battalion": badgeUSMCArmored,
  "31st Marine Expeditionary Unit": badgeUSMCCombinedArms,
  "1st Marines Regimental Combat Team": badgeUSMCLightInfantry,
  "3rd Light Armored Recon Battalion": badgeUSMCMotorized,
  "2nd Marine Logistics Group": badgeUSMCSupport,
  "4th Marines Amphibious Ready Group": badgeUSMCAmphibious,
  "6th Separate Tank Brigade": badgeRGFArmored,
  "49th Combined Arms Army": badgeRGFCombinedArms,
  "205th Separate Motor Rifle Brigade": badgeRGFMechanized,
  "78th Detached Logistics Brigade": badgeRGFSupport,
  "336th Guards Naval Infantry Brigade": badgeRGFAmphibious,
  "217th Guards Airborne Regiment": badgeVDVAirAssault,
  "104th Tank Battalion": badgeVDVArmored,
  "150th Support Battalion": badgeVDVSupport,
  "195th Heavy Combined Arms Brigade": badgePLAArmored,
  "118th Combined Arms Brigade": badgePLACombinedArms,
  "9th Heavy Combined Arms Battalion": badgePLAAGFArmored,
  "14th Amphibious Combined Arms Brigade": badgePLAAGFAmphibious,
  "51st Wolverine Battalion": badgeCRFCombinedArms,
  "16th Armored Division": badgeGFIArmored,
  "21st Division": badgeGFICombinedArms,
  "64th Infantry Division": badgeGFILightInfantry,
  "77th Infantry Division": badgeGFIMechanized,
  "30th Infantry Division": badgeGFIMotorized,
  "75th Logistics Brigade": badgeGFISupport,
  "1st Separate Tank Brigade": badgeIMFArmored,
  "1st Separate Guards Brigade": badgeIMFCombinedArms,
  "Hoplite Battalion": badgeIMFLightInfantry,
  "1st Separate Cossack Brigade": badgeIMFMechanized,
  "3rd Separate Guards Motorized Brigade": badgeIMFMotorized,
  "3rd Guards Artillery Brigade": badgeIMFSupport,
  "Irregular Armored Squadron": badgeMEIArmored,
  "Irregular Battle Group": badgeMEICombinedArms,
  "Irregular Mechanized Platoon": badgeMEIMechanized,
  "Irregular Motorized Platoon": badgeMEIMotorized,
  "Irregular Fire Support Group": badgeMEISupport,
  "1st Commando Brigade": badgeTLFAirAssault,
  "1st Army": badgeTLFCombinedArms,
};

const formationToFaction: Record<string, string> = {
  "3rd Battalion, Royal Australian Regiment": "ADF",
  "3rd Brigade": "ADF",
  "1st Battalion, Royal Australian Regiment": "ADF",
  "95th Air Assault Brigade": "AFU",
  "1st Tank Brigade": "AFU",
  "11th Army Corps": "AFU",
  "10th Mountain Assault Brigade": "AFU",
  "28th Mechanized Brigade": "AFU",
  "58th Motorized Brigade": "AFU",
  "148th Artillery Brigade": "AFU",
  "35th Marine Brigade": "AFU",
  "2nd Battalion, Parachute Regiment": "BAF",
  "Queen's Royal Hussars Battle Group": "BAF",
  "3rd Division Battle Group": "BAF",
  "1 Yorks Battle Group": "BAF",
  "Royal Logistics Corps Battle Group": "BAF",
  "3rd Battalion, Royal Canadian Regiment": "CAF",
  "Lord Strathcona's Horse Regiment": "CAF",
  "1 Canadian Mechanized Brigade Group": "CAF",
  "1st Battalion, Royal 22e Régiment": "CAF",
  "The 12e Régiment Blindé du Canada": "CAF",
  "6 Canadian Combat Support Brigade": "CAF",
  "504th Paracute Infantry Regiment": "USA",
  "37th Armored Regiment": "USA",
  "1st Infantry Division": "USA",
  "10th Mountain Division": "USA",
  "1st Cavalry Regiment": "USA",
  "2nd Cavalry Stryker Brigade": "USA",
  "497th Combat Sustainment Support Battalion": "USA",
  "1st Tank Battalion": "USMC",
  "31st Marine Expeditionary Unit": "USMC",
  "1st Marines Regimental Combat Team": "USMC",
  "3rd Light Armored Recon Battalion": "USMC",
  "2nd Marine Logistics Group": "USMC",
  "4th Marines Amphibious Ready Group": "USMC",
  "6th Separate Tank Brigade": "RGF",
  "49th Combined Arms Army": "RGF",
  "1398th Separate Reconnaissance Battalion": "RGF",
  "205th Separate Motor Rifle Brigade": "RGF",
  "3rd Motor Rifle Brigade": "RGF",
  "78th Detached Logistics Brigade": "RGF",
  "336th Guards Naval Infantry Brigade": "RGF",
  "217th Guards Airborne Regiment": "VDV",
  "104th Tank Battalion": "VDV",
  "7th Guards Mountain Air Assault Division": "VDV",
  "108th Guards Air Assault Regiment": "VDV",
  "150th Support Battalion": "VDV",
  "161st Air Assault Brigade": "PLA",
  "195th Heavy Combined Arms Brigade": "PLA",
  "118th Combined Arms Brigade": "PLA",
  "149th Mountain Infantry Brigade": "PLA",
  "112th Medium Combined Arms Brigade": "PLA",
  "80th Support Brigade": "PLA",
  "9th Heavy Combined Arms Battalion": "PLAAGF",
  "14th Amphibious Combined Arms Brigade": "PLAAGF",
  "4th Medium Combined Arms Battalion": "PLAAGF",
  "4th Marine Special Combat Battalion": "PLANMC",
  "3rd Marine Heavy Battalion": "PLANMC",
  "5th Marine Combined Arms Brigade": "PLANMC",
  "7th Marine Medium Battalion": "PLANMC",
  "17th Marine Support Battalion": "PLANMC",
  "51st Wolverine Battalion": "CRF",
  "55th Airborne Brigade": "GFI",
  "16th Armored Division": "GFI",
  "21st Division": "GFI",
  "64th Infantry Division": "GFI",
  "77th Infantry Division": "GFI",
  "30th Infantry Division": "GFI",
  "75th Logistics Brigade": "GFI",
  "1st Separate Tank Brigade": "IMF",
  "1st Separate Guards Brigade": "IMF",
  "Hoplite Battalion": "IMF",
  "1st Separate Cossack Brigade": "IMF",
  "3rd Separate Guards Motorized Brigade": "IMF",
  "3rd Guards Artillery Brigade": "IMF",
  "Irregular Armored Squadron": "MEI",
  "Irregular Battle Group": "MEI",
  "Irregular Light Infantry": "MEI",
  "Irregular Mechanized Platoon": "MEI",
  "Irregular Motorized Platoon": "MEI",
  "Irregular Fire Support Group": "MEI",
  "1st Commando Brigade": "TLF",
  "4th Armored Brigade": "TLF",
  "1st Army": "TLF",
  "66th Mechanized Infantry Brigade": "TLF",
  "51st Motorized Infantry Brigade": "TLF",
  "Land Forces Logistics Command": "TLF",
};

export function getFactionFromTeamName(teamName: string): string | null {
  return formationToFaction[teamName] ?? null;
}

export function getFlagUrl(factionCode: string): string | null {
  return factionFlags[factionCode] ?? null;
}

export function getBadgeUrl(teamName: string): string | null {
  return formationBadges[teamName] ?? null;
}

export function getFlagUrlByTeamName(teamName: string): string | null {
  const faction = getFactionFromTeamName(teamName);
  console.log('[faction-data] getFlagUrlByTeamName:', { teamName, faction, flagUrl: faction ? factionFlags[faction] : null });
  if (!faction) return null;
  return getFlagUrl(faction);
}
