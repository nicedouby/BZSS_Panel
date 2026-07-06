export type InfantryCombatEventType = "all" | "damage" | "wound" | "kill" | "revive";

export type InfantryCombatWarningFilter = "all" | "victim_sent" | "attacker_sent" | "skipped" | "failed";

export type InfantryCombatRelationFilter = "all" | "enemy" | "friendly" | "self" | "same_player";

export type InfantryCombatWeaponFilter = "all" | "light" | "non_light" | "explosive" | "vehicle" | "emplacement" | "unknown";

export interface InfantryCombatFilters {
  type: InfantryCombatEventType;
  warning: InfantryCombatWarningFilter;
  relation: InfantryCombatRelationFilter;
  weapon: InfantryCombatWeaponFilter;
  q: string;
  limit: number;
  offset: number;
  autoRefresh: boolean;
}

export interface InfantryCombatIdentity {
  name: string;
  steam64ID: string;
  eosID: string;
  controllerID: string;
  teamID: string;
}

export interface InfantryCombatWarningDecision {
  role?: "victim" | "attacker";
  targetName?: string;
  message?: string;
  reason?: string;
  success?: boolean;
  skipped?: boolean;
  skipReason?: string;
  errorMessage?: string;
  commandText?: string;
  relatedEventId?: string;
}

export interface InfantryCombatEventRecord {
  id: string;
  createdAt?: string;
  serverId?: string;
  sourceEventId?: string;
  combatEventId?: string;
  type?: string;
  time?: string;
  attacker?: InfantryCombatIdentity;
  victim?: InfantryCombatIdentity;
  attackerName?: string;
  victimName?: string;
  attackerSteam64ID?: string;
  attackerEOSID?: string;
  attackerControllerID?: string;
  attackerTeamID?: string;
  victimSteam64ID?: string;
  victimEOSID?: string;
  victimControllerID?: string;
  victimTeamID?: string;
  damage?: number;
  weapon?: string;
  samePlayer?: boolean;
  relation?: any;
  parse?: any;
  eventFlags?: Array<any>;
  eventFlagLabels?: Array<string>;
  tags?: Array<string>;
  victimWarning?: InfantryCombatWarningDecision | null;
  attackerWarning?: InfantryCombatWarningDecision | null;
  warnings?: Array<InfantryCombatWarningDecision>;
}

export interface InfantryCombatOverview {
  count?: number;
  lastUpdatedAt?: string;
  config?: Record<string, unknown>;
  stats?: Record<string, number> & {
    total?: number;
    damage?: number;
    wound?: number;
    kill?: number;
    revive?: number;
    victimWarned?: number;
    attackerWarned?: number;
    skipped?: number;
    failed?: number;
    victimSkipped?: number;
    attackerSkipped?: number;
    victimFailed?: number;
    attackerFailed?: number;
    friendlyFire?: number;
    selfDamage?: number;
    samePlayer?: number;
    lightWeapon?: number;
    nonLightWeapon?: number;
    skipReasons?: Record<string, number>;
  };
  dependencies?: {
    combatClean?: {
      loaded?: boolean;
      subscribed?: boolean;
      connected?: boolean;
    };
    adminWarn?: {
      loaded?: boolean;
      available?: boolean;
    };
  };
  latest?: Array<InfantryCombatEventRecord>;
}

export interface InfantryCombatConfig {
  enabled: boolean;
  forceAttackerDamageDisplay: boolean;
  minAttackerDamage: number;
  damageDebounceMs: number;
  showKillDisplay: boolean;
  showOnlyLightWeaponDamage: boolean;
  showVictimDamage: boolean;
  showVictimWound: boolean;
  showVictimKill: boolean;
  showAttackerDamage: boolean;
  storeRecentEventLimit: number;
  attackerDamageDisplayGate: InfantryCombatAttackerDamageDisplayGateConfig;
}

export interface InfantryCombatAttackerDamageDisplayGateConfig {
  enabled: boolean;
  mode: "inside_leader_radius";
  fallbackWhenUnknown: "allow" | "deny";
  applyToTypes: Array<"damage" | "wound" | "kill" | "revive">;
  onlyLightWeapon: boolean;
}

export const INFANTRY_COMBAT_DEFAULT_FILTERS: InfantryCombatFilters = {
  type: "all",
  warning: "all",
  relation: "all",
  weapon: "all",
  q: "",
  limit: 100,
  offset: 0,
  autoRefresh: true,
};

export const INFANTRY_COMBAT_DEFAULT_CONFIG: InfantryCombatConfig = {
  enabled: true,
  forceAttackerDamageDisplay: false,
  minAttackerDamage: 15,
  damageDebounceMs: 150,
  showKillDisplay: false,
  showOnlyLightWeaponDamage: true,
  showVictimDamage: true,
  showVictimWound: true,
  showVictimKill: true,
  showAttackerDamage: true,
  storeRecentEventLimit: 300,
  attackerDamageDisplayGate: {
    enabled: true,
    mode: "inside_leader_radius",
    fallbackWhenUnknown: "deny",
    applyToTypes: ["damage"],
    onlyLightWeapon: true,
  },
};
