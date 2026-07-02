import { apiGet } from "./apiClient";

export interface TacticalStateV2SnapshotResponse {
  ok: boolean;
  snapshot: any;
}

export interface TacticalPatch {
  op: "player.upsert" | "player.remove" | "asset.upsert" | "asset.remove" | "explosion.add" | "explosion.remove";
  key?: string;
  id?: string;
  player?: any;
  asset?: any;
  explosion?: any;
}

export type TacticalStateV2StreamMessage =
  | { type: "snapshot"; revision: number; snapshot: any }
  | {
      type: "patch";
      revision: number;
      patches: TacticalPatch[];
      server: any;
      match: any;
      teams: any[];
      squadFollow: any;
      diagnostics: any;
    };

export async function fetchTacticalStateV2Snapshot() {
  return apiGet<TacticalStateV2SnapshotResponse>("/api/tactical-state-v2/snapshot");
}

export function streamTacticalStateV2(
  onMessage: (data: TacticalStateV2StreamMessage) => void,
  onError?: (error: any, source: EventSource) => void,
) {
  const eventSource = new EventSource("/api/tactical-state-v2/stream");
  eventSource.onmessage = (event) => {
    try {
      onMessage(JSON.parse(event.data));
    } catch (error) {
      onError?.(error, eventSource);
    }
  };
  eventSource.onerror = (error) => {
    onError?.(error, eventSource);
  };
  return () => eventSource.close();
}
