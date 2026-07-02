import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  fetchTacticalStateV2Snapshot,
  streamTacticalStateV2,
  type TacticalStateV2StreamMessage,
} from "../app/tacticalStateV2Api";

export const useTacticalStateV2Store = defineStore("tacticalStateV2", () => {
  // Non-reactive maps to prevent deep reactivity overhead on high-frequency coordinate updates
  const playersByKey = new Map<string, any>();
  const assetsByKey = new Map<string, any>();
  const explosionsById = new Map<string, any>();

  // Reactive state triggers
  const revision = ref(0);
  const server = ref<any>({});
  const match = ref<any>({});
  const teams = ref<any[]>([]);
  const squadFollow = ref<any>(null);
  const diagnostics = ref<any>({});
  const loading = ref(false);
  const error = ref("");
  const streamActive = ref(false);
  let closeStream: (() => void) | null = null;
  let resyncInFlight: Promise<void> | null = null;

  function clearStore() {
    playersByKey.clear();
    assetsByKey.clear();
    explosionsById.clear();
    revision.value = 0;
    server.value = {};
    match.value = {};
    teams.value = [];
    squadFollow.value = null;
    diagnostics.value = {};
  }

  function applySnapshot(snap: any) {
    playersByKey.clear();
    assetsByKey.clear();
    explosionsById.clear();

    if (snap?.players && Array.isArray(snap.players)) {
      for (const p of snap.players) {
        if (p?.identity?.key) {
          playersByKey.set(p.identity.key, p);
        }
      }
    }

    if (snap?.assets) {
      const assetsObj = snap.assets;
      if (Array.isArray(assetsObj.fobs)) {
        for (const f of assetsObj.fobs) {
          if (f?.name) assetsByKey.set(`fob:${f.name}`, { type: "fob", ...f });
        }
      }
      if (Array.isArray(assetsObj.captureZones)) {
        for (const z of assetsObj.captureZones) {
          if (z?.name) assetsByKey.set(`captureZone:${z.name}`, { type: "captureZone", ...z });
        }
      }
      if (Array.isArray(assetsObj.mainZones)) {
        for (const z of assetsObj.mainZones) {
          if (z?.name) assetsByKey.set(`mainZone:${z.name}`, { type: "mainZone", ...z });
        }
      }
    }

    if (snap?.assets?.explosions && Array.isArray(snap.assets.explosions)) {
      for (const e of snap.assets.explosions) {
        if (e?.id) {
          explosionsById.set(e.id, e);
        }
      }
    }

    server.value = snap?.server ?? {};
    match.value = snap?.match ?? {};
    teams.value = Array.isArray(snap?.teams) ? snap.teams : [];
    squadFollow.value = snap?.squadFollow ?? null;
    diagnostics.value = snap?.diagnostics ?? {};

    const nextRevision = Number(snap?.meta?.revision ?? 0);
    revision.value = Number.isFinite(nextRevision) && nextRevision > 0 ? nextRevision : revision.value + 1;
  }

  async function resyncSnapshot(reason: string) {
    if (resyncInFlight) return resyncInFlight;

    resyncInFlight = (async () => {
      try {
        const response = await fetchTacticalStateV2Snapshot();
        if (!response.ok) {
          error.value = "Failed to resync tactical V2 snapshot.";
          return;
        }
        applySnapshot(response.snapshot);
        error.value = "";
      } catch (err: any) {
        error.value = err?.message ?? `Failed to resync tactical V2 snapshot (${reason}).`;
      } finally {
        resyncInFlight = null;
      }
    })();

    return resyncInFlight;
  }

  function applyPatch(msg: Extract<TacticalStateV2StreamMessage, { type: "patch" }>) {
    const nextRevision = Number(msg?.revision ?? 0);
    const currentRevision = Number(revision.value ?? 0);

    if (!Number.isFinite(nextRevision) || nextRevision <= 0) {
      void resyncSnapshot("invalid-revision");
      return;
    }

    if (currentRevision > 0 && nextRevision !== currentRevision + 1) {
      void resyncSnapshot(`revision-gap-${currentRevision}-to-${nextRevision}`);
      return;
    }

    if (msg.patches && Array.isArray(msg.patches)) {
      for (const patch of msg.patches) {
        switch (patch.op) {
          case "player.upsert":
            if (patch.key && patch.player) {
              playersByKey.set(patch.key, patch.player);
            }
            break;
          case "player.remove":
            if (patch.key) {
              playersByKey.delete(patch.key);
            }
            break;
          case "asset.upsert":
            if (patch.key && patch.asset) {
              assetsByKey.set(patch.key, patch.asset);
            }
            break;
          case "asset.remove":
            if (patch.key) {
              assetsByKey.delete(patch.key);
            }
            break;
          case "explosion.add":
            if (patch.explosion?.id) {
              explosionsById.set(patch.explosion.id, patch.explosion);
            }
            break;
          case "explosion.remove":
            if (patch.id) {
              explosionsById.delete(patch.id);
            }
            break;
        }
      }
    }

    server.value = msg.server ?? {};
    match.value = msg.match ?? {};
    teams.value = Array.isArray(msg.teams) ? msg.teams : [];
    squadFollow.value = msg.squadFollow ?? null;
    diagnostics.value = msg.diagnostics ?? {};

    revision.value = nextRevision;
  }

  async function fetchSnapshot() {
    loading.value = true;
    error.value = "";
    try {
      const response = await fetchTacticalStateV2Snapshot();
      if (!response.ok) {
        error.value = "Failed to load tactical V2 snapshot.";
        return;
      }
      applySnapshot(response.snapshot);
    } catch (err: any) {
      error.value = err?.message ?? "Failed to load tactical V2 snapshot.";
    } finally {
      loading.value = false;
    }
  }

  function startStream() {
    if (closeStream) return;
    streamActive.value = true;
    loading.value = true;
    error.value = "";

    closeStream = streamTacticalStateV2(
      (message) => {
        if (message.type === "snapshot") {
          applySnapshot(message.snapshot);
        } else if (message.type === "patch") {
          applyPatch(message);
        }
        error.value = "";
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
    resyncInFlight = null;
    streamActive.value = false;
    clearStore();
  }

  // Helper computed lists that only track "revision" as their dependency to prevent deep reactivity loops
  const playersList = computed(() => {
    const _ = revision.value;
    return Array.from(playersByKey.values());
  });

  const assetsList = computed(() => {
    const _ = revision.value;
    return Array.from(assetsByKey.values());
  });

  const explosionsList = computed(() => {
    const _ = revision.value;
    return Array.from(explosionsById.values());
  });

  // Mock snapshot object for sidebar metadata to avoid deep reactivity penalty
  const snapshot = computed(() => {
    return {
      ok: true,
      status: "ok",
      state: {
        revision: revision.value,
        markerSeen: true,
        runtimePlayerCount: playersList.value.length,
        scoreboardPlayerCount: playersList.value.length,
        updatedAt: diagnostics.value?.generatedAt || "",
      },
    } as any;
  });

  return {
    playersByKey,
    assetsByKey,
    explosionsById,
    revision,
    server,
    match,
    teams,
    squadFollow,
    diagnostics,
    loading,
    error,
    streamActive: computed(() => streamActive.value),
    snapshot,
    playersList,
    assetsList,
    explosionsList,
    fetchSnapshot,
    startStream,
    stopStream,
  };
});
