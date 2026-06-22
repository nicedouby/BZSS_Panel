import type { RoleIconInfo } from "./role-icons";

/**
 * Vehicle icon mapping table.
 * Each entry maps vehicleType keyword patterns to an icon image from /Icon/.
 * Patterns are matched against normalized vehicleType strings.
 * Order matters — first match wins, so more specific patterns must come first.
 */

type VehicleIconMatch = {
  patterns: string[];
  icon: string;
  label: string;
};

const ICO_BASE = "/Icon";

const VEHICLE_ICON_MATCHES: VehicleIconMatch[] = [
  // --- Jets ---
  {
    patterns: ["a10", "a-10", "warthog"],
    icon: `${ICO_BASE}/map_jet_a10.PNG`,
    label: "A-10",
  },
  {
    patterns: ["su25", "su-25", "frogfoot"],
    icon: `${ICO_BASE}/map_jet_su25.PNG`,
    label: "SU-25",
  },
  {
    patterns: ["tornado"],
    icon: `${ICO_BASE}/map_jet_tornado.PNG`,
    label: "Tornado",
  },

  // --- Attack Helicopters ---
  {
    patterns: ["attackhelo", "attackhelicopter", "attack_helo", "ah64", "ah-64", "mi24", "mi-24", "z10"],
    icon: `${ICO_BASE}/map_attackhelo.PNG`,
    label: "攻击直升机",
  },

  // --- Scout / Light CAS Helicopters ---
  {
    patterns: ["scouthelo", "scout_helo", "lightcas_helo", "lightcas", "scout_helicopter", "mh6", "littlebird"],
    icon: `${ICO_BASE}/T_map_helicopter_lightcas.PNG`,
    label: "侦察直升机",
  },
  {
    patterns: ["scouthelicopter"],
    icon: `${ICO_BASE}/T_map_helicopter_scout.PNG`,
    label: "侦察直升机",
  },

  // --- Transport Helicopters ---
  {
    patterns: ["transporthelo", "transport_helo", "transporthelicopter", "uh60", "mi8", "mi17", "blackhawk", "ch146"],
    icon: `${ICO_BASE}/map_transporthelo.PNG`,
    label: "运输直升机",
  },

  // --- UAV ---
  {
    patterns: ["uav", "drone_uav"],
    icon: `${ICO_BASE}/map_uav.PNG`,
    label: "无人机",
  },

  // --- Handheld Drone ---
  {
    patterns: ["handheld", "handhelddrone", "handheld_drone"],
    icon: `${ICO_BASE}/map_handhelddrone.PNG`,
    label: "手持无人机",
  },

  // --- Tanks (MBT) ---
  {
    patterns: ["tank", "mbt", "m1a2", "m1a1", "t72", "t-72", "t62", "t-62", "leopard", "challenger", "ztz99", "abrams"],
    icon: `${ICO_BASE}/map_tank.PNG`,
    label: "主战坦克",
  },

  // --- MGS (Mobile Gun System) ---
  {
    patterns: ["mgs", "mobile_gun", "mobilegunsystem"],
    icon: `${ICO_BASE}/T_map_mgs.PNG`,
    label: "MGS",
  },

  // --- Tracked IFV ---
  {
    patterns: ["trackedifv", "tracked_ifv", "ifvtracked", "ifv_tracked"],
    icon: `${ICO_BASE}/map_trackedifv.PNG`,
    label: "履带步兵战车",
  },

  // --- IFV (wheeled) ---
  {
    patterns: ["ifv", "bmp", "bradley", "warrior", "zbd04", "btr82a"],
    icon: `${ICO_BASE}/map_ifv.PNG`,
    label: "步兵战车",
  },

  // --- Anti-Air (truck-mounted) ---
  {
    patterns: ["truck_antiair", "truckaa", "truck_aa", "truckantiair"],
    icon: `${ICO_BASE}/map_truck_antiair.PNG`,
    label: "防空卡车",
  },

  // --- Anti-Air (general) ---
  {
    patterns: ["antiair", "anti_air", "anti-air", "aa_vehicle", "aavehicle", "zptml"],
    icon: `${ICO_BASE}/map_antiair.PNG`,
    label: "防空载具",
  },

  // --- Tracked APC Logistics ---
  {
    patterns: ["trackedapc_logi", "tracked_apc_logi", "trackedapc_logistics", "apctracked_logi", "apctrackedlogistics"],
    icon: `${ICO_BASE}/T_map_trackedapc_logistics.PNG`,
    label: "履带装甲后勤车",
  },

  // --- Tracked APC MSV ---
  {
    patterns: ["trackedapc_msv", "tracked_apc_msv", "apctracked_msv"],
    icon: `${ICO_BASE}/T_map_trackedapc_msv.PNG`,
    label: "履带装甲运兵车(MSV)",
  },

  // --- Tracked APC No Turret ---
  {
    patterns: ["trackedapc_noturret", "tracked_apc_noturret", "apctracked_noturret"],
    icon: `${ICO_BASE}/T_map_trackedapc_noturret.PNG`,
    label: "履带装甲运兵车",
  },

  // --- Tracked APC (general) ---
  {
    patterns: ["trackedapc", "tracked_apc", "apctracked", "apc_tracked"],
    icon: `${ICO_BASE}/map_trackedapc.PNG`,
    label: "履带装甲运兵车",
  },

  // --- APC (wheeled) ---
  {
    patterns: ["apc", "btr", "stryker", "lav", "laviii", "namer"],
    icon: `${ICO_BASE}/map_apc.PNG`,
    label: "装甲运兵车",
  },

  // --- Tracked Jeep ---
  {
    patterns: ["trackedjeep", "tracked_jeep", "jeeptracked", "jeep_tracked"],
    icon: `${ICO_BASE}/map_trackedjeep.PNG`,
    label: "履带吉普",
  },

  // --- Jeep Artillery ---
  {
    patterns: ["jeep_artillery", "jeepart", "artillery_jeep", "artillery_truck", "technical_artillery", "mortar_truck", "jeepartillery"],
    icon: `${ICO_BASE}/map_jeep_artillery.PNG`,
    label: "火炮车",
  },

  // --- Jeep Anti-Tank ---
  {
    patterns: ["jeep_antitank", "jeepat", "at_jeep", "antitank_jeep", "technical_atgm", "technical_at", "technical_bgm", "kornet", "jeepantitank"],
    icon: `${ICO_BASE}/map_jeep_antitank.PNG`,
    label: "反坦克吉普",
  },

  // --- Jeep Logistics ---
  {
    patterns: ["jeep_logi", "jeep_logistics", "jeeplogi", "jeeplogistics"],
    icon: `${ICO_BASE}/map_jeep_logistics.PNG`,
    label: "后勤吉普",
  },

  // --- Jeep Transport ---
  {
    patterns: ["jeep_transport", "jeeptransport"],
    icon: `${ICO_BASE}/map_jeep_transport.PNG`,
    label: "运输吉普",
  },

  // --- Jeep Turret (armed technical) ---
  {
    patterns: ["jeep_turret", "technical_dshk", "technical_spg", "technical_mg", "technical_ags", "technical_zu", "jeepturret"],
    icon: `${ICO_BASE}/map_jeep_turret.PNG`,
    label: "武装吉普",
  },

  // --- Jeep (generic) ---
  {
    patterns: ["jeep", "technical", "mrap", "tigr", "humvee", "hmmwv"],
    icon: `${ICO_BASE}/map_jeep.PNG`,
    label: "吉普",
  },

  // --- Motorcycle ---
  {
    patterns: ["motorcycle", "motorbike", "bike", "minsk"],
    icon: `${ICO_BASE}/map_motorcycle.PNG`,
    label: "摩托车",
  },

  // --- Truck Logistics ---
  {
    patterns: ["truck_logi", "truck_logistics", "logitruck", "logi_truck", "trucklogi", "trucklogistics"],
    icon: `${ICO_BASE}/map_truck_logistics.PNG`,
    label: "后勤卡车",
  },

  // --- Truck Transport Armed ---
  {
    patterns: ["truck_transport_armed", "armed_transport", "trucktransportarmed", "armedtransport"],
    icon: `${ICO_BASE}/map_truck_transport_armed.PNG`,
    label: "武装运输卡车",
  },

  // --- Truck Transport ---
  {
    patterns: ["truck_transport", "transporttruck", "trucktransport"],
    icon: `${ICO_BASE}/map_truck_transport.PNG`,
    label: "运输卡车",
  },

  // --- Truck (generic, last) ---
  {
    patterns: ["truck", "ural", "kamaz", "logistics"],
    icon: `${ICO_BASE}/map_truck_logistics.PNG`,
    label: "卡车",
  },

  // --- Boats ---
  {
    patterns: ["boat", "rhib", "zodiac", "pontoon"],
    icon: `${ICO_BASE}/map_boat.PNG`,
    label: "船",
  },
];

function normalizeVehicleType(vehicleType: unknown): string {
  return String(vehicleType ?? "")
    .toLowerCase()
    .replace(/^bp_/i, "")
    .replace(/_c_\d+$/i, "")
    .replace(/_c$/i, "")
    .replace(/[_\-]+/g, "_")
    .trim();
}

function compactVehicleType(value: string): string {
  return value.replace(/_/g, "");
}

/**
 * Resolve vehicle icon from a vehicleType string.
 * Returns a RoleIconInfo-compatible object with the icon path, label, and tone.
 */
export function resolveVehicleIcon(vehicleType: unknown): RoleIconInfo {
  const normalized = normalizeVehicleType(vehicleType);
  if (!normalized || normalized === "none") {
    return { icon: "🚙", label: "载具", tone: "crewman" };
  }

  const compactNormalized = compactVehicleType(normalized);
  for (const entry of VEHICLE_ICON_MATCHES) {
    for (const pattern of entry.patterns) {
      const normalizedPattern = normalizeVehicleType(pattern);
      const compactPattern = compactVehicleType(normalizedPattern);
      if (normalized.includes(normalizedPattern) || compactNormalized.includes(compactPattern)) {
        return {
          icon: entry.icon,
          label: entry.label,
          tone: "crewman",
        };
      }
    }
  }

  // Fallback: unrecognized vehicle type
  return { icon: "🚙", label: "载具", tone: "crewman" };
}
