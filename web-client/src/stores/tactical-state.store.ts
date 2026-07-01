import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  fetchTacticalStateSnapshot,
  streamTacticalStateSnapshot,
  type TacticalStateSnapshotResponse,
} from "../app/tacticalStateApi";

export const useTacticalStateStore = defineStore("tacticalState", () => {
  const snapshot = ref<any | null>(null);
  const players = ref<any[]>([]);
  const server = ref<any>({});
  const teams = ref<any[]>([]);
  const assets = ref<any>({});
  const diagnostics = ref<any>({});
  const loading = ref(false);
  const error = ref("");
  const streamActive = ref(false);
  let closeStream: (() => void) | null = null;

  function applySnapshotResponse(response: TacticalStateSnapshotResponse) {
    snapshot.value = response?.snapshot ?? null;
    players.value = Array.isArray(response?.snapshot?.players) ? response.snapshot.players : [];
    server.value = response?.snapshot?.server ?? {};
    teams.value = Array.isArray(response?.snapshot?.teams) ? response.snapshot.teams : [];
    assets.value = response?.snapshot?.assets ?? {};
    diagnostics.value = response?.snapshot?.diagnostics ?? {};
  }

  async function fetchSnapshot() {
    loading.value = true;
    error.value = "";
    try {
      const response = await fetchTacticalStateSnapshot();
      if (!response.ok) {
        error.value = "Failed to load tactical snapshot.";
      }
      applySnapshotResponse(response);
    } catch (err: any) {
      error.value = err?.message ?? "Failed to load tactical snapshot.";
    } finally {
      loading.value = false;
    }
  }

  function startStream() {
    if (closeStream) return;
    streamActive.value = true;
    closeStream = streamTacticalStateSnapshot(
      (response) => {
        applySnapshotResponse(response);
        error.value = response?.ok === false ? "Failed to load tactical snapshot." : "";
        loading.value = false;
      },
      (err, source) => {
        if (source.readyState === EventSource.CLOSED) {
          streamActive.value = false;
        }
        if (err?.message) {
          error.value = err.message;
        }
      },
    );
  }

  function stopStream() {
    if (closeStream) {
      closeStream();
      closeStream = null;
    }
    streamActive.value = false;
  }

  return {
    snapshot,
    players,
    server,
    teams,
    assets,
    diagnostics,
    loading,
    error,
    streamActive: computed(() => streamActive.value),
    fetchSnapshot,
    startStream,
    stopStream,
  };
});
