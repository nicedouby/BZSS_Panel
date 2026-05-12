export interface RoleIconInfo {
  icon: string;
  label: string;
  tone:
    | "leader"
    | "medic"
    | "at"
    | "mg"
    | "engineer"
    | "marksman"
    | "rifleman"
    | "crewman"
    | "pilot"
    | "default";
}

type RoleIconMatch = {
  patterns: string[];
  icon: string;
  label: string;
  tone: RoleIconInfo["tone"];
};

const ICON_BASE = "/Icon";

const ROLE_ICON_MATCHES: RoleIconMatch[] = [
  {
    patterns: ["squadleader", "sl", "leader"],
    icon: `${ICON_BASE}/T_role_squadleader.PNG`,
    label: "Squad Leader",
    tone: "leader",
  },
  {
    patterns: ["medic"],
    icon: `${ICON_BASE}/T_role_medic.PNG`,
    label: "Medic",
    tone: "medic",
  },
  {
    patterns: ["heavyantitank", "heavy anti tank", "heavy anti-tank", "hat"],
    icon: `${ICON_BASE}/T_role_heavyantitank.PNG`,
    label: "Heavy AT",
    tone: "at",
  },
  {
    patterns: ["lightantitank", "light anti tank", "light anti-tank", "antitank", "anti tank", "lat"],
    icon: `${ICON_BASE}/T_role_lightantitank.PNG`,
    label: "Light AT",
    tone: "at",
  },
  {
    patterns: ["machinegunner", "machine gunner", "mg"],
    icon: `${ICON_BASE}/T_role_machinegunner.PNG`,
    label: "MG / AR",
    tone: "mg",
  },
  {
    patterns: ["automaticrifleman", "automatic rifleman", "ar"],
    icon: `${ICON_BASE}/T_role_automaticrifleman.PNG`,
    label: "MG / AR",
    tone: "mg",
  },
  {
    patterns: ["combatengineer", "combat engineer"],
    icon: `${ICON_BASE}/T_role_engineer.PNG`,
    label: "Engineer",
    tone: "engineer",
  },
  {
    patterns: ["engineer"],
    icon: `${ICON_BASE}/T_role_engineer.PNG`,
    label: "Engineer",
    tone: "engineer",
  },
  {
    patterns: ["designatedmarksman", "designated marksman", "marksman"],
    icon: `${ICON_BASE}/T_role_designatedmarksman.PNG`,
    label: "Marksman",
    tone: "marksman",
  },
  {
    patterns: ["sniper"],
    icon: `${ICON_BASE}/T_role_sniper.PNG`,
    label: "Marksman",
    tone: "marksman",
  },
  {
    patterns: ["scout"],
    icon: `${ICON_BASE}/T_role_scout.PNG`,
    label: "Scout",
    tone: "rifleman",
  },
  {
    patterns: ["grenadier"],
    icon: `${ICON_BASE}/T_role_grenadier.PNG`,
    label: "Grenadier",
    tone: "rifleman",
  },
  {
    patterns: ["crewman", "crew"],
    icon: `${ICON_BASE}/T_role_crewman.PNG`,
    label: "Crewman",
    tone: "crewman",
  },
  {
    patterns: ["pilot"],
    icon: `${ICON_BASE}/T_role_pilot.PNG`,
    label: "Pilot",
    tone: "pilot",
  },
  {
    patterns: ["rifleman scoped", "riflemanscoped"],
    icon: `${ICON_BASE}/T_role_rifleman_scoped.PNG`,
    label: "Rifleman",
    tone: "rifleman",
  },
  {
    patterns: ["rifleman"],
    icon: `${ICON_BASE}/T_role_rifleman.PNG`,
    label: "Rifleman",
    tone: "rifleman",
  },
];

function normalizeRole(role: unknown): string {
  return String(role ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ");
}

function getDefaultLabel(role: unknown): string {
  const value = String(role ?? "").trim();
  return value || "Unknown Role";
}

export function resolveRoleIcon(role: unknown): RoleIconInfo {
  const normalized = normalizeRole(role);
  const compact = normalized.replace(/\s+/g, "");

  for (const entry of ROLE_ICON_MATCHES) {
    if (
      entry.patterns.some(
        (pattern) => normalized.includes(pattern) || compact.includes(pattern.replace(/\s+/g, "")),
      )
    ) {
      return {
        icon: entry.icon,
        label: entry.label,
        tone: entry.tone,
      };
    }
  }

  return {
    icon: "\u2022",
    label: getDefaultLabel(role),
    tone: "default",
  };
}
