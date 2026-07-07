import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  fetchTacticalStateSnapshot,
  streamTacticalStateSnapshot,
  type TacticalStateSnapshotResponse,
} from "../app/tacticalStateApi";

export const useTacticalStateStore = defineStore("tacticalState", () => {
  const STREAM_SNAPSHOT_FALLBACK_MS = 3000;
  const STREAM_SNAPSHOT_FALLBACK_POLL_MS = 2000;
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
  let fallbackTimer: number | null = null;
  let lastStreamMessageAt = 0;

  function cleanupStreamRuntime() {
    if (closeStream) {
      closeStream();
      closeStream = null;
    }
    stopFallbackPolling();
    lastStreamMessageAt = 0;
    streamActive.value = false;
  }

  function applySnapshotResponse(response: TacticalStateSnapshotResponse) {
    snapshot.value = response?.snapshot ?? null;
    players.value = Array.isArray(response?.snapshot?.players) ? response.snapshot.players : [];
    server.value = response?.snapshot?.server ?? {};
    teams.value = Array.isArray(response?.snapshot?.teams) ? response.snapshot.teams : [];
    assets.value = response?.snapshot?.assets ?? {};
    diagnostics.value = response?.snapshot?.diagnostics ?? {};
  }

  function markStreamMessage() {
    lastStreamMessageAt = Date.now();
  }

  function startFallbackPolling() {
    if (fallbackTimer != null) return;

    fallbackTimer = window.setInterval(() => {
      if (!streamActive.value) return;
      if (!lastStreamMessageAt) return;

      const silentMs = Date.now() - lastStreamMessageAt;
      if (silentMs >= STREAM_SNAPSHOT_FALLBACK_MS) {
        void fetchSnapshot();
        markStreamMessage();
      }
    }, STREAM_SNAPSHOT_FALLBACK_POLL_MS);
  }

  function stopFallbackPolling() {
    if (fallbackTimer == null) return;
    window.clearInterval(fallbackTimer);
    fallbackTimer = null;
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
    if (closeStream) {
      if (streamActive.value) return;
      cleanupStreamRuntime();
    }
    streamActive.value = true;
    markStreamMessage();
    startFallbackPolling();
    closeStream = streamTacticalStateSnapshot(
      (response) => {
        markStreamMessage();
        applySnapshotResponse(response);
        error.value = response?.ok === false ? "Failed to load tactical snapshot." : "";
        loading.value = false;
      },
      (err, source) => {
        if (source.readyState === EventSource.CLOSED) {
          cleanupStreamRuntime();
        }
        if (err?.message) {
          error.value = err.message;
        }
      },
    );
  }

  function stopStream() {
    cleanupStreamRuntime();
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
