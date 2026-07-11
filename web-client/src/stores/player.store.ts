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
  const revision = ref(0);
  const stale = ref(false);

  function applySnapshot(snapshot: any) {
    const incomingRevision = Number(snapshot?.revision ?? 0);
    const incomingUpdatedAt = Number(snapshot?.updatedAt ?? 0);
    if (
      revision.value > 0
      && incomingRevision > 0
      && (
        incomingRevision < revision.value
        || (incomingRevision === revision.value && incomingUpdatedAt > 0 && incomingUpdatedAt < updatedAt.value)
      )
    ) {
      return false;
    }
    if (
      incomingRevision <= 0
      && incomingUpdatedAt > 0
      && updatedAt.value > 0
      && incomingUpdatedAt < updatedAt.value
    ) {
      return false;
    }

    active.value = snapshot?.active ?? [];
    recentlyDisconnected.value = snapshot?.recentlyDisconnected ?? [];
    bySteamID.value = snapshot?.bySteamID ?? {};
    byEOSID.value = snapshot?.byEOSID ?? {};
    byPlayerID.value = snapshot?.byPlayerID ?? {};
    byName.value = snapshot?.byName ?? {};
    updatedAt.value = incomingUpdatedAt || Date.now();
    revision.value = incomingRevision || revision.value;
    stale.value = Boolean(snapshot?.stale);
    return true;
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
    revision,
    stale,
    applySnapshot,
    markStale,
  };
});
