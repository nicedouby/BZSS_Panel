export type LianbanEvent = {
  id: string;
  kind: string;
  at: string;
  playerName?: string;
  steamID?: string;
  eosID?: string;
  matchType?: string;
  playersScanned?: number;
  entries?: number;
  error?: string;
};

export type LianbanLastMatch = {
  playerName?: string;
  steamID?: string;
  eosID?: string;
  matchType?: string;
  matchValue?: string;
  at?: string;
};

export type LianbanState = {
  enabled: boolean;
  subscribed: boolean;
  directory: string;
  cacheMs: number;
  retryCooldownMs: number;
  lastLoadedAt: string;
  lastScanAt: string;
  lastKickAt: string;
  lastError: string;
  files: string[];
  entries: number;
  playersScanned: number;
  kickAttempts: number;
  kickSuccess: number;
  kickFailed: number;
  lastMatch: LianbanLastMatch | null;
  recentEvents: LianbanEvent[];
};
