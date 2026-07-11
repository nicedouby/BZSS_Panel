import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  fetchTacticalStateSnapshot,
  streamTacticalStateSnapshot,
  type TacticalStateDelta,
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

  function applyFullSnapshot(nextSnapshot: any) {
    snapshot.value = nextSnapshot ?? null;
    players.value = Array.isArray(nextSnapshot?.players) ? nextSnapshot.players : [];
    server.value = nextSnapshot?.server ?? {};
    teams.value = Array.isArray(nextSnapshot?.teams) ? nextSnapshot.teams : [];
    assets.value = nextSnapshot?.assets ?? {};
    diagnostics.value = nextSnapshot?.diagnostics ?? {};
  }

  function applyDelta(delta: TacticalStateDelta | undefined, revision?: number | null, generatedAt?: string) {
    if (!delta) return;
    if (delta.replace) {
      applyFullSnapshot(delta.replace);
      return;
    }

    const removeKeys = new Set((delta.players?.remove ?? []).map(String));
    const nextByKey = new Map(
      players.value
        .filter((player) => !removeKeys.has(playerKey(player)))
        .map((player) => [playerKey(player), player]),
    );
    for (const player of delta.players?.upsert ?? []) {
      nextByKey.set(playerKey(player), player);
    }
    players.value = [...nextByKey.values()];

    if (Object.prototype.hasOwnProperty.call(delta, "server")) server.value = delta.server ?? {};
    if (Object.prototype.hasOwnProperty.call(delta, "teams")) teams.value = delta.teams ?? [];
    if (Object.prototype.hasOwnProperty.call(delta, "assets")) assets.value = delta.assets ?? {};
    if (Object.prototype.hasOwnProperty.call(delta, "diagnostics")) diagnostics.value = delta.diagnostics ?? {};

    const current = snapshot.value ?? {};
    snapshot.value = {
      ...current,
      ...(Object.prototype.hasOwnProperty.call(delta, "server") ? { server: server.value } : {}),
      ...(Object.prototype.hasOwnProperty.call(delta, "match") ? { match: delta.match } : {}),
      ...(Object.prototype.hasOwnProperty.call(delta, "teams") ? { teams: teams.value } : {}),
      ...(Object.prototype.hasOwnProperty.call(delta, "squadFollow") ? { squadFollow: delta.squadFollow } : {}),
      ...(Object.prototype.hasOwnProperty.call(delta, "assets") ? { assets: assets.value } : {}),
      ...(Object.prototype.hasOwnProperty.call(delta, "diagnostics") ? { diagnostics: diagnostics.value } : {}),
      meta: {
        ...(current.meta ?? {}),
        ...(delta.meta ?? {}),
        ...(revision != null ? { revision } : {}),
        ...(generatedAt ? { generatedAt } : {}),
      },
      players: players.value,
    };
  }

  function applySnapshotResponse(response: TacticalStateSnapshotResponse) {
    if (response?.type === "tactical-state.delta") {
      applyDelta(response.delta, response.revision, response.generatedAt);
      return;
    }
    applyFullSnapshot(response?.snapshot ?? null);
  }

  async function fetchSnapshot() {
    loading.value = true;
    error.value = "";
    try {
      const response = await fetchTacticalStateSnapshot();
      if (!response.ok) error.value = "Failed to load tactical snapshot.";
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
        if (source.readyState === EventSource.CLOSED) streamActive.value = false;
        if (err?.message) error.value = err.message;
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

  function playerKey(player: any) {
    const identity = player?.identity ?? {};
    return String(
      identity.key
        ?? identity.steamID
        ?? identity.eosID
        ?? identity.controllerID
        ?? identity.playerID
        ?? identity.playerId
        ?? identity.name
        ?? "",
    );
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
