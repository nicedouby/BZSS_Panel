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

const ICON_BASE = "/assets/icons";

const ROLE_ICON_MATCHES: RoleIconMatch[] = [
  {
    patterns: ["pilot squadleader", "pilot sl", "squadleader pilot", "sl pilot"],
    icon: `${ICON_BASE}/T_role_pilot_squadleader.PNG`,
    label: "Pilot SL",
    tone: "leader",
  },
  {
    patterns: ["crewman squadleader", "crew squadleader", "squadleader crewman", "sl crewman", "crew sl"],
    icon: `${ICON_BASE}/T_role_crewman_squadleader.PNG`,
    label: "Crewman SL",
    tone: "leader",
  },
  {
    patterns: ["dead", "downed", "incapacitated"],
    icon: `${ICON_BASE}/T_role_dead.PNG`,
    label: "Downed",
    tone: "default",
  },
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
    patterns: ["sapper", "miner"],
    icon: `${ICON_BASE}/T_role_sapper.PNG`,
    label: "Sapper",
    tone: "engineer",
  },
  {
    patterns: ["breacher"],
    icon: `${ICON_BASE}/T_role_breacher.PNG`,
    label: "Breacher",
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
    patterns: ["recon"],
    icon: `${ICON_BASE}/T_role_recon.PNG`,
    label: "Recon",
    tone: "rifleman",
  },
  {
    patterns: ["raider"],
    icon: `${ICON_BASE}/T_role_raider.PNG`,
    label: "Raider",
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
    patterns: ["antiair", "anti air", "anti-air", "aa"],
    icon: `${ICON_BASE}/T_role_antiair.PNG`,
    label: "Anti-Air",
    tone: "at",
  },
  {
    patterns: ["rifleman scoped", "riflemanscoped"],
    icon: `${ICON_BASE}/T_role_rifleman_scoped.PNG`,
    label: "Rifleman",
    tone: "rifleman",
  },
  {
    patterns: ["rifleman", "plain", "rifleman1", "rifleman2"],
    icon: `${ICON_BASE}/T_role_rifleman.PNG`,
    label: "Rifleman",
    tone: "rifleman",
  },
  {
    patterns: ["recruit"],
    icon: `${ICON_BASE}/T_role_recruit.PNG`,
    label: "Recruit",
    tone: "default",
  },
];

function normalizeRole(role: unknown): string {
  return String(role ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ");
}

function normalizePattern(pattern: string): string {
  return String(pattern ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .trim();
}

function createRoleSearch(role: unknown) {
  const normalized = normalizeRole(role);
  return {
    normalized,
    compact: normalized.replace(/\s+/g, ""),
    tokens: new Set(normalized.split(/[^a-z0-9]+/g).filter(Boolean)),
  };
}

function matchesRolePattern(
  search: ReturnType<typeof createRoleSearch>,
  pattern: string,
): boolean {
  const normalizedPattern = normalizePattern(pattern);
  if (!normalizedPattern) return false;

  const compactPattern = normalizedPattern.replace(/\s+/g, "");
  const patternTokens = normalizedPattern.split(/\s+/).filter(Boolean);

  if (patternTokens.length === 1) {
    const token = patternTokens[0];
    if (search.tokens.has(token)) return true;
    if (token.length > 4 && search.compact.includes(token)) return true;
    return false;
  }

  if (search.normalized.includes(normalizedPattern)) return true;
  return search.compact.includes(compactPattern);
}

function getDefaultLabel(role: unknown): string {
  const value = String(role ?? "").trim();
  return value || "Unknown Role";
}

export function resolveRoleIcon(role: unknown): RoleIconInfo {
  const search = createRoleSearch(role);

  for (const entry of ROLE_ICON_MATCHES) {
    if (entry.patterns.some((pattern) => matchesRolePattern(search, pattern))) {
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
