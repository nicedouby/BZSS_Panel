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
    label: "飞行员队长",
    tone: "leader",
  },
  {
    patterns: ["crewman squadleader", "crew squadleader", "squadleader crewman", "sl crewman", "crew sl"],
    icon: `${ICON_BASE}/T_role_crewman_squadleader.PNG`,
    label: "乘员队长",
    tone: "leader",
  },
  {
    patterns: ["dead", "downed", "incapacitated"],
    icon: `${ICON_BASE}/T_role_dead.PNG`,
    label: "倒地",
    tone: "default",
  },
  {
    patterns: ["squadleader", "sl", "leader"],
    icon: `${ICON_BASE}/T_role_squadleader.PNG`,
    label: "队长",
    tone: "leader",
  },
  {
    patterns: ["medic"],
    icon: `${ICON_BASE}/T_role_medic.PNG`,
    label: "医疗",
    tone: "medic",
  },
  {
    patterns: ["heavyantitank", "heavy anti tank", "heavy anti-tank", "hat"],
    icon: `${ICON_BASE}/T_role_heavyantitank.PNG`,
    label: "重筒",
    tone: "at",
  },
  {
    patterns: ["lightantitank", "light anti tank", "light anti-tank", "antitank", "anti tank", "lat"],
    icon: `${ICON_BASE}/T_role_lightantitank.PNG`,
    label: "轻筒",
    tone: "at",
  },
  {
    patterns: ["machinegunner", "machine gunner", "mg"],
    icon: `${ICON_BASE}/T_role_machinegunner.PNG`,
    label: "通机",
    tone: "mg",
  },
  {
    patterns: ["automaticrifleman", "automatic rifleman", "automatic rifle", "ar"],
    icon: `${ICON_BASE}/T_role_automaticrifleman.PNG`,
    label: "班机",
    tone: "mg",
  },
  {
    patterns: ["combatengineer", "combat engineer"],
    icon: `${ICON_BASE}/T_role_engineer.PNG`,
    label: "工兵",
    tone: "engineer",
  },
  {
    patterns: ["engineer"],
    icon: `${ICON_BASE}/T_role_engineer.PNG`,
    label: "工兵",
    tone: "engineer",
  },
  {
    patterns: ["sapper", "miner"],
    icon: `${ICON_BASE}/T_role_sapper.PNG`,
    label: "工兵",
    tone: "engineer",
  },
  {
    patterns: ["breacher"],
    icon: `${ICON_BASE}/T_role_breacher.PNG`,
    label: "突击",
    tone: "engineer",
  },
  {
    patterns: ["designatedmarksman", "designated marksman", "marksman"],
    icon: `${ICON_BASE}/T_role_designatedmarksman.PNG`,
    label: "精确射手",
    tone: "marksman",
  },
  {
    patterns: ["sniper"],
    icon: `${ICON_BASE}/T_role_sniper.PNG`,
    label: "狙击",
    tone: "marksman",
  },
  {
    patterns: ["scout"],
    icon: `${ICON_BASE}/T_role_scout.PNG`,
    label: "侦察",
    tone: "rifleman",
  },
  {
    patterns: ["recon"],
    icon: `${ICON_BASE}/T_role_recon.PNG`,
    label: "侦察",
    tone: "rifleman",
  },
  {
    patterns: ["raider"],
    icon: `${ICON_BASE}/T_role_raider.PNG`,
    label: "奇袭",
    tone: "rifleman",
  },
  {
    patterns: ["grenadier"],
    icon: `${ICON_BASE}/T_role_grenadier.PNG`,
    label: "榴弹",
    tone: "rifleman",
  },
  {
    patterns: ["crewman", "crew"],
    icon: `${ICON_BASE}/T_role_crewman.PNG`,
    label: "乘员",
    tone: "crewman",
  },
  {
    patterns: ["pilot"],
    icon: `${ICON_BASE}/T_role_pilot.PNG`,
    label: "飞行员",
    tone: "pilot",
  },
  {
    patterns: ["antiair", "anti air", "anti-air", "aa"],
    icon: `${ICON_BASE}/T_role_antiair.PNG`,
    label: "防空",
    tone: "at",
  },
  {
    patterns: ["rifleman scoped", "riflemanscoped"],
    icon: `${ICON_BASE}/T_role_rifleman_scoped.PNG`,
    label: "步枪",
    tone: "rifleman",
  },
  {
    patterns: ["rifleman", "plain", "rifleman1", "rifleman2"],
    icon: `${ICON_BASE}/T_role_rifleman.PNG`,
    label: "步枪",
    tone: "rifleman",
  },
  {
    patterns: ["recruit"],
    icon: `${ICON_BASE}/T_role_recruit.PNG`,
    label: "新兵",
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
