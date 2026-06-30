import { defineStore } from "pinia";
import { ref, computed } from "vue";
import {
  fetchBzssCorePlayerInfoList,
  fetchBzssCoreRawData,
  streamBzssCorePlayerInfoList,
  type BzssCorePlayerInfoResponse,
  type BzssCoreRawDataResponse,
} from "../app/bzssCoreApi";

export const useBzssCoreStore = defineStore("bzssCore", () => {
  const snapshot = ref<BzssCorePlayerInfoResponse | null>(null);
  const players = ref<any[]>([]);
  const loading = ref(false);
  const error = ref("");

  const rawData = ref<BzssCoreRawDataResponse | null>(null);
  const rawLoading = ref(false);
  const rawError = ref("");

  let closeStream: (() => void) | null = null;
  const activeSubscribers = ref(0);

  function updatePlayers(data: BzssCorePlayerInfoResponse) {
    const runtimePlayers = data.runtimePlayers ?? [];
    const scoreboardPlayers = data.scoreboardPlayers ?? [];
    const byIndex = new Map<number | string, any>();
    for (const player of runtimePlayers) {
      if (player.playerIndex == null && player.playerId == null) continue;
      const key = player.playerIndex ?? player.playerId ?? "";
      byIndex.set(key, { ...player });
    }
    for (const player of scoreboardPlayers) {
      if (player.playerIndex == null && player.playerId == null) continue;
      const key = player.playerIndex ?? player.playerId ?? "";
      const existing = byIndex.get(key);
      byIndex.set(key, existing ? { ...existing, ...player } : { ...player });
    }
    players.value = [...byIndex.values()];
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
    activeSubscribers.value++;
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
          stopStream(true);
        }
      }
    );
  }

  function stopStream(force = false) {
    if (!force) {
      activeSubscribers.value = Math.max(0, activeSubscribers.value - 1);
    }
    if (force || activeSubscribers.value === 0) {
      if (closeStream) {
        closeStream();
        closeStream = null;
      }
    }
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
