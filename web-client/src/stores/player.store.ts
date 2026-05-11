import { defineStore } from "pinia";

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
}

export const usePlayerStore = defineStore("players", {
  state: () => ({
    active: [] as RuntimePlayer[],
    recentlyDisconnected: [] as RuntimePlayer[],
    bySteamID: {} as Record<string, RuntimePlayer>,
    byEOSID: {} as Record<string, RuntimePlayer>,
    byPlayerID: {} as Record<string, RuntimePlayer>,
    byName: {} as Record<string, RuntimePlayer>,
    updatedAt: 0,
    stale: false,
  }),
  actions: {
    applySnapshot(snapshot: any) {
      this.active = snapshot?.active ?? [];
      this.recentlyDisconnected = snapshot?.recentlyDisconnected ?? [];
      this.bySteamID = snapshot?.bySteamID ?? {};
      this.byEOSID = snapshot?.byEOSID ?? {};
      this.byPlayerID = snapshot?.byPlayerID ?? {};
      this.byName = snapshot?.byName ?? {};
      this.updatedAt = Number(snapshot?.updatedAt ?? Date.now());
      this.stale = Boolean(snapshot?.stale);
    },
    markStale() {
      this.stale = true;
    },
  },
});
