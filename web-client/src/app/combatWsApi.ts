import { apiGet } from "./apiClient";

export interface CombatWsPacketSummary {
  time: string;
  pid: string;
  mid: string;
  type: "cb" | "mf";
  events: number;
  bytes: number;
  ack: boolean;
  retryCount: number;
  deliveryState: string;
}

export interface CombatWsState {
  enabled: boolean;
  configured: boolean;
  path: string;
  serverId: string;
  matchId: string | null;
  clients: Array<{ client: string | null; authenticated: boolean; connected: boolean; lastPongAt: number }>;
  buffer: { batchEvents: number; batchMatchId: string | null; unassignedEvents: number };
  pending: { count: number; max: number };
  packets: { total: number; items: CombatWsPacketSummary[] };
  events: { total: number; items: Array<Record<string, unknown>> };
  packetDetail: (CombatWsPacketSummary & { wire: string }) | null;
  stats: { accepted: number; replayRejected: number; sent: number; retried: number; acked: number; failed: number; pendingOverflow: number; lastSentAt: string | null };
}

export function fetchCombatWsState(packetId?: string) {
  const query = packetId ? `?pid=${encodeURIComponent(packetId)}` : "";
  return apiGet<CombatWsState>(`/api/combat-ws/state${query}`);
}
