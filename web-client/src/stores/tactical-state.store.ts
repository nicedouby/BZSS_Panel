import { defineStore } from "pinia";
import { computed, markRaw, shallowRef } from "vue";
import {
  fetchTacticalStateSnapshot,
  streamTacticalStateSnapshot,
  type TacticalStateDelta,
  type TacticalStateSnapshotResponse,
} from "../app/tacticalStateApi";
import { useServerStore } from "./server.store";

const STREAM_BOOTSTRAP_FALLBACK_MS = 1_500;

export const useTacticalStateStore = defineStore("tacticalState", () => {
  const serverStore = useServerStore();
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
  let streamBootstrapping = false;
  let streamFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let snapshotFetchPromise: Promise<void> | null = null;
  let resyncPromise: Promise<void> | null = null;

  function playerKey(player: any) {
    const identity = player?.identity ?? {};
    return String(identity.key ?? identity.steamID ?? identity.eosID ?? identity.controllerID
      ?? identity.playerID ?? identity.playerId ?? identity.name ?? "");
  }

  function retainRawPlayer(player: any) {
    return player && typeof player === "object" ? markRaw(player) : player;
  }

  function publishPlayers() {
    const next = playerOrder.map((key) => playersByKey.get(key)).filter(Boolean);
    players.value = next;
    return next;
  }

  function resolveLiveMapIdentity(source: any) {
    const candidates = [
      source?.server?.layer,
      source?.match?.layer,
      source?.server?.currentLayer,
      source?.server?.mapName,
      source?.server?.map,
      source?.match?.mapName,
      source?.match?.map,
    ];
    for (const candidate of candidates) {
      const value = String(candidate ?? "").trim();
      if (value) return value;
    }
    return "";
  }

  function syncLiveMapIdentity(source: any) {
    serverStore.applyLiveMapIdentity(resolveLiveMapIdentity(source));
  }

  function snapshotMeta(source: any) {
    const revision = Number(source?.meta?.revision ?? 0);
    const generatedAtText = String(source?.meta?.generatedAt ?? "").trim();
    const generatedAtMs = generatedAtText ? Date.parse(generatedAtText) : Number.NaN;
    return {
      serverId: String(source?.meta?.serverId ?? source?.server?.serverId ?? "").trim(),
      revision: Number.isFinite(revision) && revision > 0 ? revision : 0,
      generatedAtText,
      generatedAtMs,
    };
  }

  function shouldIgnoreFullSnapshot(nextSnapshot: any) {
    if (!snapshot.value || !nextSnapshot) return false;

    const incoming = snapshotMeta(nextSnapshot);
    const current = snapshotMeta(snapshot.value);
    if (incoming.serverId && current.serverId && incoming.serverId !== current.serverId) return false;

    // The REST bootstrap and the SSE connection can return the exact same full
    // tactical snapshot. Applying both causes every map computed/marker layer to
    // rebuild twice during navigation. Drop exact duplicates before touching any
    // reactive state.
    if (
      incoming.revision > 0
      && incoming.revision === current.revision
      && incoming.generatedAtText
      && incoming.generatedAtText === current.generatedAtText
    ) {
      return true;
    }

    // Network scheduling can also let an older REST response arrive after a
    // newer SSE snapshot. Prefer generatedAt over revision because the backend
    // revision counter can reset when the panel process restarts.
    if (Number.isFinite(incoming.generatedAtMs) && Number.isFinite(current.generatedAtMs)) {
      if (incoming.generatedAtMs < current.generatedAtMs) return true;
      if (incoming.generatedAtMs === current.generatedAtMs && incoming.revision > 0 && current.revision > 0) {
        return incoming.revision <= current.revision;
      }
    }

    return false;
  }

  function applyFullSnapshot(nextSnapshot: any) {
    if (shouldIgnoreFullSnapshot(nextSnapshot)) return false;

    playersByKey.clear();
    playerOrder = [];
    for (const candidate of Array.isArray(nextSnapshot?.players) ? nextSnapshot.players : []) {
      const player = retainRawPlayer(candidate);
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
    syncLiveMapIdentity(snapshot.value);
    return true;
  }

  function applyDelta(delta: TacticalStateDelta | undefined, revision?: number | null, generatedAt?: string) {
    if (!delta) return;
    if (delta.replace) return applyFullSnapshot(delta.replace);

    let playersChanged = false;
    for (const key of delta.players?.remove ?? []) {
      if (playersByKey.delete(String(key))) playersChanged = true;
    }
    if (playersChanged) playerOrder = playerOrder.filter((key) => playersByKey.has(key));

    for (const candidate of delta.players?.upsert ?? []) {
      const player = retainRawPlayer(candidate);
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
      ...(Object.hasOwn(delta, "assets") ? { assets: assets.value } : {}),
      ...(Object.hasOwn(delta, "diagnostics") ? { diagnostics: diagnostics.value } : {}),
      meta: { ...(current.meta ?? {}), ...(delta.meta ?? {}),
        ...(revision != null ? { revision } : {}), ...(generatedAt ? { generatedAt } : {}) },
      players: nextPlayers,
    };

    if (Object.hasOwn(delta, "server") || Object.hasOwn(delta, "match")) {
      syncLiveMapIdentity(snapshot.value);
    }
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
      await fetchSnapshot({ force: true });
    })().finally(() => {
      resyncPromise = null;
    });
    return resyncPromise;
  }

  async function fetchSnapshot(options: { force?: boolean } = {}) {
    if (snapshotFetchPromise) return snapshotFetchPromise;

    const force = options.force === true;
    snapshotFetchPromise = (async () => {
      loading.value = true;
      error.value = "";

      // TacticalMapPage currently calls fetchSnapshot() immediately before
      // startStream(). Yield one microtask so startStream can claim bootstrap.
      // The SSE endpoint sends an initial full snapshot itself, so issuing the
      // REST request as well only doubles JSON parsing and reactive full renders.
      await Promise.resolve();
      if (!force && streamBootstrapping) return;

      try {
        const response = await fetchTacticalStateSnapshot();
        if (!response.ok) error.value = "Failed to load tactical snapshot.";
        await applySnapshotResponse(response);
      } catch (err: any) {
        error.value = err?.message ?? "Failed to load tactical snapshot.";
      } finally {
        loading.value = false;
      }
    })().finally(() => {
      loading.value = false;
      snapshotFetchPromise = null;
    });

    return snapshotFetchPromise;
  }

  function clearStreamFallbackTimer() {
    if (streamFallbackTimer !== null) {
      clearTimeout(streamFallbackTimer);
      streamFallbackTimer = null;
    }
  }

  function startStream() {
    if (closeStream) return;
    streamActive.value = true;
    streamBootstrapping = true;
    clearStreamFallbackTimer();

    closeStream = streamTacticalStateSnapshot((response) => {
      streamBootstrapping = false;
      clearStreamFallbackTimer();
      void applySnapshotResponse(response);
      error.value = response?.ok === false ? "Failed to load tactical snapshot." : "";
      loading.value = false;
    }, (err, source) => {
      if (source.readyState === EventSource.CLOSED) streamActive.value = false;
      if (err?.message) error.value = err.message;

      // If EventSource cannot deliver its initial full snapshot, fall back to
      // the compact REST endpoint. The forced fetch is deduplicated and any
      // later SSE full snapshot is protected against stale/duplicate apply.
      if (streamBootstrapping) void fetchSnapshot({ force: true });
    });

    streamFallbackTimer = setTimeout(() => {
      streamFallbackTimer = null;
      if (!closeStream || !streamBootstrapping) return;
      void fetchSnapshot({ force: true });
    }, STREAM_BOOTSTRAP_FALLBACK_MS);
  }

  function stopStream() {
    streamBootstrapping = false;
    clearStreamFallbackTimer();
    closeStream?.();
    closeStream = null;
    streamActive.value = false;
  }

  return { snapshot, players, server, teams, assets, diagnostics, loading, error,
    streamActive: computed(() => streamActive.value), fetchSnapshot, startStream, stopStream };
});
