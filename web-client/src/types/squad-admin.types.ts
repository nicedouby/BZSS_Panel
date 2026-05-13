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
  squadId: number | null;
  steamId: string | null;
  steam64?: string | null;
  eosId: string | null;
  ip: string | null;
  playtimeHours: number | null;
  raw?: any;
}

export interface SquadLeaderRowViewModel extends PlayerRowViewModel {
  isLeader: true;
}

export interface SquadViewModel {
  squadId: number | null;
  squadName: string;
  teamId: number | null;
  creatorName: string;
  isLocked: boolean;
  memberCount: number;
  maxMembers: number;
  averagePlaytimeHours: number | null;
  publicPlaytimePlayers: number;
  privatePlaytimePlayers: number;
  knownPlaytimePlayers: number;
  leader: SquadLeaderRowViewModel | null;
  members: PlayerRowViewModel[];
  warnings: SquadWarning[];
  state: "normal" | "empty" | "no_leader";
}

export interface TeamViewModel {
  teamId: number;
  teamName: string;
  teamColorType: "team1" | "team2";
  playerCount: number;
  maxPlayers: number;
  averagePlaytimeHours: number | null;
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
  type: "no_leader" | "no_members" | "stale_data";
  message: string;
}

export interface PageState {
  searchQuery: string;
  densityMode: "comfortable" | "compact";
  selectedPlayerId: string | number | null;
  filterMode: "all" | "no_leader" | "locked" | "alerts";
}
