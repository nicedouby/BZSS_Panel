import { defineStore } from "pinia";

export interface RuntimeSquad {
  key: string;
  teamID: number | null;
  squadID: number | null;
  teamName?: string;
  squadName?: string;
  name?: string;
  size?: number;
  locked?: boolean;
  creatorName?: string;
  createdAt?: string | null;
  createdAtMs?: number | null;
  createdAtLabel?: string;
  createdDisplayText?: string;
  creationSource?: string;
  creationConfidence?: string;
  sourceLabel?: string;
}

export const useSquadStore = defineStore("squads", {
  state: () => ({
    list: [] as RuntimeSquad[],
    byKey: {} as Record<string, RuntimeSquad>,
    byTeamID: {} as Record<string, RuntimeSquad[]>,
    updatedAt: 0,
    stale: false,
  }),
  actions: {
    applySnapshot(snapshot: any) {
      this.list = snapshot?.list ?? [];
      this.byKey = snapshot?.byKey ?? {};
      this.byTeamID = snapshot?.byTeamID ?? {};
      this.updatedAt = Number(snapshot?.updatedAt ?? Date.now());
      this.stale = Boolean(snapshot?.stale);
    },
    markStale() {
      this.stale = true;
    },
  },
});
