import { apiGet, apiPatch, apiPost } from "./apiClient";

export type TkTimeoutAction = "remove_from_squad" | "kill_player" | "kick_player";

export interface TeamKillApologyCase {
  id: string;
  eventId: string;
  serverId: string;
  attacker: { name: string; steamId: string; eosId: string };
  victim: { name: string; steamId: string; eosId: string };
  tkCount: number;
  createdAt: string;
  deadlineAt: string;
  remainingSeconds: number;
  reminderCount: number;
  status: string;
}

export interface TeamKillApologyState {
  enabled: boolean;
  subscribed: boolean;
  active: boolean;
  config: {
    enabled: boolean;
    deadlineSeconds: number;
    reminderSeconds: number;
    timeoutAction: TkTimeoutAction;
    apologyWords: string[];
  };
  summary: {
    pending: number;
    totalTeamKills: number;
    totalApologies: number;
    totalHandled: number;
    totalBroadcasts: number;
    totalWarnings: number;
  };
  pending: TeamKillApologyCase[];
  players: Array<{ key: string; count: number; attacker: { name: string; steamId: string }; updatedAt: string }>;
  history: Array<Record<string, unknown>>;
  chats: Array<{
    id: string;
    at: string;
    serverId: string;
    channel: string;
    playerName: string;
    steamId: string;
    eosId: string;
    playerId: string;
    message: string;
    apology: boolean;
    matched: boolean;
    caseId: string;
    tkVictim: string;
  }>;
  lastError: string;
  lastResetAt: string;
  lastResetReason: string;
}

interface StateResponse { ok: boolean; data: TeamKillApologyState }

export async function fetchTeamKillApologyState() {
  return (await apiGet<StateResponse>("/api/plugins/team-kill-apology/state")).data;
}

export async function setTeamKillApologyEnabled(enabled: boolean) {
  return (await apiPatch<StateResponse>("/api/plugins/team-kill-apology/enabled", { enabled })).data;
}

export async function updateTeamKillApologyConfig(config: Partial<TeamKillApologyState["config"]>) {
  return (await apiPatch<StateResponse>("/api/plugins/team-kill-apology/config", config)).data;
}

export async function resetTeamKillApologyMatch() {
  return (await apiPost<StateResponse>("/api/plugins/team-kill-apology/reset")).data;
}
