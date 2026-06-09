import { defineStore } from "pinia";
import { ref, shallowRef } from "vue";

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

export const useSquadStore = defineStore("squads", () => {
  const list = shallowRef<RuntimeSquad[]>([]);
  const byKey = shallowRef<Record<string, RuntimeSquad>>({});
  const byTeamID = shallowRef<Record<string, RuntimeSquad[]>>({});
  const updatedAt = ref(0);
  const stale = ref(false);

  function applySnapshot(snapshot: any) {
    list.value = snapshot?.list ?? [];
    byKey.value = snapshot?.byKey ?? {};
    byTeamID.value = snapshot?.byTeamID ?? {};
    updatedAt.value = Number(snapshot?.updatedAt ?? Date.now());
    stale.value = Boolean(snapshot?.stale);
  }

  function markStale() {
    stale.value = true;
  }

  return {
    list,
    byKey,
    byTeamID,
    updatedAt,
    stale,
    applySnapshot,
    markStale,
  };
});
