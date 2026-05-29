import { defineStore } from "pinia";

export interface RuntimeSquad {
  key: string;
  teamID: number | null;
  squadID: number | null;
  generation?: number | null;
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
  squadNature?: "infantry" | "vehicle" | "support" | "other";
  squadNatureLabel?: string;
  squadNatureReason?: string | null;
  squadNatureRule?: string | null;
  squadNatureConfidence?: "high" | "medium" | "low";
  squadNatureNormalizedName?: string;
  squadVehicleClass?: "ifv" | "light_vehicle" | "tank" | "spg" | "other";
  squadVehicleClassLabel?: string;
  squadVehicleClassReason?: string | null;
  squadVehicleClassRule?: string | null;
  squadVehicleClassConfidence?: "high" | "medium" | "low";
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
