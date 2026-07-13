import { defineStore } from "pinia";
import { ref, computed } from "vue";
import {
  fetchBzssCorePlayerInfoList,
  fetchBzssCoreRawData,
  streamBzssCorePlayerInfoList,
  type BzssCorePlayerInfoResponse,
  type BzssCoreRawDataResponse,
} from "../app/bzssCoreApi";

export function buildBzssCorePlayers(data: BzssCorePlayerInfoResponse) {
  if (Array.isArray(data.players)) {
    return data.players;
  }

  const runtimePlayers = data.runtimePlayers ?? [];
  const scoreboardPlayers = data.scoreboardPlayers ?? [];
  const byIndex = new Map<number | string, any>();

  for (const player of scoreboardPlayers) {
    if (player.playerIndex == null && player.playerId == null) continue;
    const key = player.playerIndex ?? player.playerId ?? "";
    byIndex.set(key, {
      ...player,
      position: null,
      yaw: null,
      stale: true,
      presence: {
        state: "scoreboardOnly",
      },
      telemetry: {
        position: null,
        yaw: null,
        combatInfo: "",
      },
    });
  }

  for (const player of runtimePlayers) {
    if (player.playerIndex == null && player.playerId == null) continue;
    const key = player.playerIndex ?? player.playerId ?? "";
    const existing = byIndex.get(key);
    byIndex.set(key, existing ? { ...existing, ...player } : { ...player });
  }

  return [...byIndex.values()];
}

export const useBzssCoreStore = defineStore("bzssCore", () => {
  const snapshot = ref<BzssCorePlayerInfoResponse | null>(null);
  const players = ref<any[]>([]);
  const loading = ref(false);
  const error = ref("");

  const rawData = ref<BzssCoreRawDataResponse | null>(null);
  const rawLoading = ref(false);
  const rawError = ref("");

  let closeStream: (() => void) | null = null;

  function updatePlayers(data: BzssCorePlayerInfoResponse) {
    players.value = buildBzssCorePlayers(data);
  }

  async function fetchSnapshot() {
    loading.value = true;
    error.value = "";
    try {
      const data = await fetchBzssCorePlayerInfoList();
      snapshot.value = data;
      updatePlayers(data);
      error.value = data.ok ? "" : data.status || "BZSS-Core returned an error.";
    } catch (err: any) {
      error.value = err?.message ?? "Failed to fetch BZSS-Core snapshot.";
    } finally {
      loading.value = false;
    }
  }

  async function fetchRaw() {
    rawLoading.value = true;
    rawError.value = "";
    try {
      rawData.value = await fetchBzssCoreRawData();
    } catch (err: any) {
      rawError.value = err?.message ?? "Failed to fetch raw BZSS-Core data.";
    } finally {
      rawLoading.value = false;
    }
  }

  function startStream() {
    if (closeStream) return;

    loading.value = true;
    closeStream = streamBzssCorePlayerInfoList(
      (data) => {
        snapshot.value = data;
        updatePlayers(data);
        error.value = data.ok ? "" : data.status || "BZSS-Core returned an error.";
        loading.value = false;
      },
      (err, source) => {
        loading.value = false;
        if (source.readyState === EventSource.CLOSED) {
          error.value = "SSE Stream connection error.";
          stopStream();
        }
      }
    );
  }

  function stopStream() {
    closeStream?.();
    closeStream = null;
  }

  return {
    snapshot,
    players,
    loading,
    error,
    rawData,
    rawLoading,
    rawError,
    streamActive: computed(() => closeStream !== null),
    fetchSnapshot,
    fetchRaw,
    startStream,
    stopStream,
  };
});
