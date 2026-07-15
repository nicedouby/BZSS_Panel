/**
 * Squad Admin Console View Models & Types
 * 为 MatchStatusPage 提供类型化的数据结构
 */

export interface PlayerRowViewModel {
  playerId: number | string | null;
  name: string;
  role: string;
  isLeader: boolean;
  isOnline: boolean;
  teamId: number | null;
  teamName?: string | null;
  squadId: number | null;
  steamId: string | null;
  steam64?: string | null;
  eosId: string | null;
  ip: string | null;
  playtimeHours: number | null;
  ping?: number | null;
  packetLoss?: number | null;
  matchOnlineSeconds?: number | null;
  matchObservedOnlineSeconds?: number | null;
  matchEstimatedOnlineSeconds?: number | null;
  matchFirstSeenAt?: string | null;
  matchLastSeenAt?: string | null;
  matchJoinCount?: number | null;
  steamAvatar?: string | null;
  factionFlagUrl?: string | null;
  bzssCorePing?: number | null;
  bzssCoreFtIndex?: number | null;
  bzssCoreFtPosition?: number | null;
  combatStats: CombatStats;
  statsLabel: string;
  raw?: any;
}

export interface SquadLeaderRowViewModel extends PlayerRowViewModel {
  isLeader: true;
}

export interface SquadViewModel {
  squadId: number | null;
  generation?: number | null;
  squadName: string;
  teamId: number | null;
  creatorName: string;
  createdAt?: string | null;
  createdAtMs?: number | null;
  createdAtLabel?: string;
  createdDisplayText?: string;
  creationSource?: string;
  creationConfidence?: string;
  sourceLabel?: string;
  isLocked: boolean;
  memberCount: number;
  maxMembers: number;
  averagePlaytimeHours: number | null;
  publicPlaytimePlayers: number;
  privatePlaytimePlayers: number;
  knownPlaytimePlayers: number;
  squadNature: "infantry" | "vehicle" | "support" | "logistics" | "other";
  squadNatureLabel: string;
  squadNatureReason: string | null;
  squadNatureRule: string | null;
  squadNatureConfidence: "high" | "medium" | "low";
  squadNatureNormalizedName: string;
  squadVehicleClass: "ifv" | "light_vehicle" | "tank" | "spg" | "other";
  squadVehicleClassLabel: string;
  squadVehicleClassReason: string | null;
  squadVehicleClassRule: string | null;
  squadVehicleClassConfidence: "high" | "medium" | "low";
  squadTypeId: string;
  squadTypeLabel: string;
  squadRuleId: string;
  effectiveMaxPlayers: number | null;
  maxPlayersSource: string;
  assetPath: string;
  restrictionStatus: "disabled" | "not_applicable" | "compliant" | "violation";
  restrictionViolation: boolean;
  restrictionReasons: string[];
  squadRestriction: import("../stores/squad.store").SquadRestrictionEvaluation | null;
  leader: SquadLeaderRowViewModel | null;
  members: PlayerRowViewModel[];
  warnings: SquadWarning[];
  state: "normal" | "empty" | "no_leader";
}

export interface TeamViewModel {
  teamId: number;
  teamName: string;
  teamColorType: "team1" | "team2";
  factionCode: string | null;
  playerCount: number;
  maxPlayers: number;
  ticketCount: number | null;
  averagePlaytimeHours: number | null;
  leaderAveragePlaytimeHours: number | null;
  publicLeaderPlaytimePlayers: number;
  privateLeaderPlaytimePlayers: number;
  knownLeaderPlaytimePlayers: number;
  publicPlaytimePlayers: number;
  privatePlaytimePlayers: number;
  knownPlaytimePlayers: number;
  squads: SquadViewModel[];
}

export interface PlayerDetailViewModel {
  playerId: number | string | null;
  name: string;
  role: string;
  isLeader: boolean;
  isOnline: boolean;
  teamId: number | null;
  teamName?: string | null;
  squadId: number | null;
  steamId: string | null;
  steam64?: string | null;
  eosId: string | null;
  ip: string | null;
  lastIp?: string | null;
  resolvedIp?: string | null;
  ipSource?: "current" | "last" | "none";
  ipLookupLoading?: boolean;
  playtimeHours: number | null;
  ping?: number | null;
  packetLoss?: number | null;
  matchOnlineSeconds?: number | null;
  matchObservedOnlineSeconds?: number | null;
  matchEstimatedOnlineSeconds?: number | null;
  matchFirstSeenAt?: string | null;
  matchLastSeenAt?: string | null;
  matchJoinCount?: number | null;
  steamAvatar?: string | null;
  factionFlagUrl?: string | null;
  bzssCorePing?: number | null;
  bzssCoreFtIndex?: number | null;
  bzssCoreFtPosition?: number | null;
  combatStats: CombatStats;
  statsLabel: string;
  battleStats?: CombatStats;
  battleStatsLabel?: string;
  battleStatsSource?: string;
  battleStatsLastUpdatedAt?: string | null;
  bzssCoreStatus?: string;
  bzssCoreLastCompletedAt?: string | null;
  bzssCorePlayerInfo?: BzssCoreTrackedPlayerInfo | null;
  tacticalLink?: {
    confidence: "exact" | "strong" | "weak" | "none";
    reason: string;
  };
  source: string;
  controller: string;
  raw?: any;
}

export interface MatchHeaderData {
  serverName: string;
  mapName: string;
  currentLayer: string;
  nextLayer: string;
  queueCount: number;
  currentMode: string;
  gameMode: string;
  totalPlayers: number;
  maxPlayers: number;
  team1Count: number;
  team2Count: number;
  matchTimeSeconds: number;
  tps: number | null;
  rconStatus: "connected" | "disconnected" | "error" | "disabled";
  logsStatus: "live" | "stale" | "error";
  lastUpdateTime: number;
  serverStatusUpdatedAt: number;
  playersUpdatedAt: number;
  squadsUpdatedAt: number;
}

export interface SquadWarning {
  type: "no_leader" | "no_members" | "stale_data" | "restriction_violation";
  message: string;
}

export interface CombatStats {
  kills: number;
  downs: number;
  deaths: number;
  tk: number;
  revives: number;
  wounds?: number;
  dataLives?: number | null;
  healPoints?: number;
  revivedPoints?: number;
  teamworkScore?: number;
  objectiveScore?: number;
  combatScore?: number;
  source?: "bzss-core" | "legacy" | "empty";
}

export interface BzssCoreTrackedVector {
  x: number | null;
  y: number | null;
  z: number | null;
}

export interface BzssCoreTrackedPlayerInfo {
  playerId?: number | null;
  playerName: string;
  playerGuid: string;
  teamId: number | null;
  squadId: number | null;
  isAdmin?: boolean | null;
  isCommander?: boolean | null;
  ftIndex?: number | null;
  ftPosition?: number | null;
  claimedInfo?: string;
  seatsPlayers?: string[];
  vehicleInfo?: {
    raw: string;
    vehicleType: string;
    healthText: string;
    health: number | null;
    maxHealth: number | null;
  };
  playerBaseInfo: {
    raw: string;
    fields: string[];
    values?: Record<string, string>;
  };
  soldierInfo: {
    raw: string;
    fields: string[];
    values?: Record<string, string>;
    soldierClass: string;
    health: number | null;
    weaponClass: string;
    ammoValues: number[];
    position: BzssCoreTrackedVector | null;
    rotation: BzssCoreTrackedVector | null;
  };
  playerScoreboard: {
    raw: string;
    values: string[];
    numericValues: Array<number | null>;
    ping?: number | null;
    stats?: {
      dataLives: number | null;
      numKills: number | null;
      numDeaths: number | null;
      numWoundeds: number | null;
      numWounds: number | null;
      numTeamKills: number | null;
      healPoints: number | null;
      revivedPoints: number | null;
      teamworkScore: number | null;
      objectiveScore: number | null;
      combatScore: number | null;
    };
    labeledValues?: Array<{
      key: string;
      label: string;
      value: number | null;
    }>;
    extraValues?: Array<number | null>;
  };
  rawText: string;
}

export interface PageState {
  searchQuery: string;
  densityMode: "comfortable" | "compact";
  selectedPlayerId: string | number | null;
  filterMode: "all" | "no_leader" | "locked" | "alerts";
  multiSelectMode?: boolean;
  selectedPlayerIds?: (string | number)[];
}
