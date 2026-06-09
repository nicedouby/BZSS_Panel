import { defineStore } from "pinia";
import { ref, shallowRef } from "vue";

export interface RuntimePlayer {
  playerID: number | null;
  steamID?: string;
  eosID?: string;
  name: string;
  teamID: number | null;
  squadID: number | null;
  isLeader: boolean;
  role: string;
  online: boolean;
  raw?: string;
  [key: string]: unknown;
}

export const usePlayerStore = defineStore("players", () => {
  const active = shallowRef<RuntimePlayer[]>([]);
  const recentlyDisconnected = shallowRef<RuntimePlayer[]>([]);
  const bySteamID = shallowRef<Record<string, RuntimePlayer>>({});
  const byEOSID = shallowRef<Record<string, RuntimePlayer>>({});
  const byPlayerID = shallowRef<Record<string, RuntimePlayer>>({});
  const byName = shallowRef<Record<string, RuntimePlayer>>({});
  const updatedAt = ref(0);
  const stale = ref(false);

  function applySnapshot(snapshot: any) {
    active.value = snapshot?.active ?? [];
    recentlyDisconnected.value = snapshot?.recentlyDisconnected ?? [];
    bySteamID.value = snapshot?.bySteamID ?? {};
    byEOSID.value = snapshot?.byEOSID ?? {};
    byPlayerID.value = snapshot?.byPlayerID ?? {};
    byName.value = snapshot?.byName ?? {};
    updatedAt.value = Number(snapshot?.updatedAt ?? Date.now());
    stale.value = Boolean(snapshot?.stale);
  }

  function markStale() {
    stale.value = true;
  }

  return {
    active,
    recentlyDisconnected,
    bySteamID,
    byEOSID,
    byPlayerID,
    byName,
    updatedAt,
    stale,
    applySnapshot,
    markStale,
  };
});
