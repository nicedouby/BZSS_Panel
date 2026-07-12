import { defineStore } from "pinia";
import { computed, shallowRef } from "vue";
import {
  fetchTacticalStateSnapshot,
  streamTacticalStateSnapshot,
  type TacticalStateDelta,
  type TacticalStateSnapshotResponse,
} from "../app/tacticalStateApi";

export const useTacticalStateStore = defineStore("tacticalState", () => {
  const snapshot = shallowRef<any | null>(null);
  const players = shallowRef<any[]>([]);
  const server = shallowRef<any>({});
  const teams = shallowRef<any[]>([]);
  const assets = shallowRef<any>({});
  const diagnostics = shallowRef<any>({});
  const loading = shallowRef(false);
  const error = shallowRef("");
  const streamActive = shallowRef(false);
  const playersByKey = new Map<string, any>();
  let playerOrder: string[] = [];
  let closeStream: (() => void) | null = null;
  let resyncPromise: Promise<void> | null = null;

  function playerKey(player: any) {
    const identity = player?.identity ?? {};
    return String(identity.key ?? identity.steamID ?? identity.eosID ?? identity.controllerID
      ?? identity.playerID ?? identity.playerId ?? identity.name ?? "");
  }

  function publishPlayers() {
    const next = playerOrder.map((key) => playersByKey.get(key)).filter(Boolean);
    players.value = next;
    return next;
  }

  function applyFullSnapshot(nextSnapshot: any) {
    playersByKey.clear();
    playerOrder = [];
    for (const player of Array.isArray(nextSnapshot?.players) ? nextSnapshot.players : []) {
      const key = playerKey(player);
      if (!key || playersByKey.has(key)) continue;
      playersByKey.set(key, player);
      playerOrder.push(key);
    }
    const nextPlayers = publishPlayers();
    server.value = nextSnapshot?.server ?? {};
    teams.value = Array.isArray(nextSnapshot?.teams) ? nextSnapshot.teams : [];
    assets.value = nextSnapshot?.assets ?? {};
    diagnostics.value = nextSnapshot?.diagnostics ?? {};
    snapshot.value = nextSnapshot ? { ...nextSnapshot, players: nextPlayers } : null;
  }

  function applyDelta(delta: TacticalStateDelta | undefined, revision?: number | null, generatedAt?: string) {
    if (!delta) return;
    if (delta.replace) return applyFullSnapshot(delta.replace);

    let playersChanged = false;
    for (const key of delta.players?.remove ?? []) {
      if (playersByKey.delete(String(key))) playersChanged = true;
    }
    if (playersChanged) playerOrder = playerOrder.filter((key) => playersByKey.has(key));

    for (const player of delta.players?.upsert ?? []) {
      const key = playerKey(player);
      if (!key) continue;
      if (!playersByKey.has(key)) playerOrder.push(key);
      if (playersByKey.get(key) !== player) {
        playersByKey.set(key, player);
        playersChanged = true;
      }
    }
    const nextPlayers = playersChanged ? publishPlayers() : players.value;

    if (Object.hasOwn(delta, "server")) server.value = delta.server ?? {};
    if (Object.hasOwn(delta, "teams")) teams.value = delta.teams ?? [];
    if (Object.hasOwn(delta, "assets")) assets.value = delta.assets ?? {};
    if (Object.hasOwn(delta, "diagnostics")) diagnostics.value = delta.diagnostics ?? {};

    const current = snapshot.value ?? {};
    snapshot.value = {
      ...current,
      ...(Object.hasOwn(delta, "server") ? { server: server.value } : {}),
      ...(Object.hasOwn(delta, "match") ? { match: delta.match } : {}),
      ...(Object.hasOwn(delta, "teams") ? { teams: teams.value } : {}),
      ...(Object.hasOwn(delta, "squadFollow") ? { squadFollow: delta.squadFollow } : {}),
      ...(Object.hasOwn(delta, "assets") ? { assets: assets.value } : {}),
      ...(Object.hasOwn(delta, "diagnostics") ? { diagnostics: diagnostics.value } : {}),
      meta: { ...(current.meta ?? {}), ...(delta.meta ?? {}),
        ...(revision != null ? { revision } : {}), ...(generatedAt ? { generatedAt } : {}) },
      players: nextPlayers,
    };
  }

  async function applySnapshotResponse(response: TacticalStateSnapshotResponse) {
    if (response?.type !== "tactical-state.delta") {
      applyFullSnapshot(response?.snapshot ?? null);
      return;
    }

    const incomingRevision = Number(response.revision ?? response.delta?.meta?.revision ?? 0);
    const currentRevision = Number(snapshot.value?.meta?.revision ?? 0);
    if (incomingRevision <= currentRevision) return;
    if (incomingRevision !== currentRevision + 1) {
      await requestResync();
      return;
    }
    applyDelta(response.delta, incomingRevision, response.generatedAt);
  }

  async function requestResync() {
    if (resyncPromise) return resyncPromise;
    resyncPromise = (async () => {
      await fetchSnapshot();
    })().finally(() => {
      resyncPromise = null;
    });
    return resyncPromise;
  }

  async function fetchSnapshot() {
    loading.value = true; error.value = "";
    try {
      const response = await fetchTacticalStateSnapshot();
      if (!response.ok) error.value = "Failed to load tactical snapshot.";
      await applySnapshotResponse(response);
    } catch (err: any) {
      error.value = err?.message ?? "Failed to load tactical snapshot.";
    } finally { loading.value = false; }
  }

  function startStream() {
    if (closeStream) return;
    streamActive.value = true;
    closeStream = streamTacticalStateSnapshot((response) => {
      void applySnapshotResponse(response);
      error.value = response?.ok === false ? "Failed to load tactical snapshot." : "";
      loading.value = false;
    }, (err, source) => {
      if (source.readyState === EventSource.CLOSED) streamActive.value = false;
      if (err?.message) error.value = err.message;
    });
  }

  function stopStream() {
    closeStream?.(); closeStream = null; streamActive.value = false;
  }

  return { snapshot, players, server, teams, assets, diagnostics, loading, error,
    streamActive: computed(() => streamActive.value), fetchSnapshot, startStream, stopStream };
});