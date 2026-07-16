import { defineStore } from "pinia";
import { ref, shallowRef } from "vue";

export const useServerStore = defineStore("server", () => {
  const snapshot = shallowRef<Record<string, any>>({});
  const stale = ref(false);
  const updatedAt = ref(0);

  function applySnapshot(newSnapshot: any) {
    snapshot.value = newSnapshot ?? {};
    stale.value = Boolean(newSnapshot?.stale);
    updatedAt.value = Number(newSnapshot?.updatedAt ?? Date.now());
  }

  function applyStableSnapshot(newSnapshot: any) {
    const existing = isRecord(snapshot.value) ? snapshot.value : {};
    const incoming = isRecord(newSnapshot) ? newSnapshot : {};

    snapshot.value = mergeStableSnapshot(existing, incoming);
    stale.value = Boolean(incoming?.stale);
    updatedAt.value = Number(incoming?.updatedAt ?? Date.now());
  }

  /**
   * Tactical state is the live source for round/layer changes. Unlike the
   * stable snapshot merger, this method intentionally allows an empty or
   * unknown map identity to replace the previous value so the UI can return to
   * its blank-map state instead of displaying the previous round indefinitely.
   */
  function applyLiveMapIdentity(value: unknown) {
    const mapIdentity = String(value ?? "").trim();
    const existing = isRecord(snapshot.value) ? snapshot.value : {};
    snapshot.value = {
      ...existing,
      mapName: mapIdentity,
      layer: mapIdentity,
      currentLayer: mapIdentity,
    };
    updatedAt.value = Date.now();
  }

  function markStale() {
    stale.value = true;
  }

  return {
    snapshot,
    stale,
    updatedAt,
    applySnapshot,
    applyStableSnapshot,
    applyLiveMapIdentity,
    markStale,
  };
});

const TOP_LEVEL_STABLE_KEYS = new Set([
  "serverName",
  "name",
  "map",
  "mapName",
  "layer",
  "layerName",
  "mode",
  "gameMode",
  "currentLayer",
  "nextLayer",
  "matchState",
  "tps",
  "tpsStatus",
  "playtime",
  "maxPlayers",
  "playerCount",
  "queueCount",
  "logTime",
  "logClockSeconds",
  "logClockHasAnchor",
  "logClockManual",
  "logClockAnchorLogTime",
  "logClockLastResetAt",
  "logClockLastResetReason",
  "isWarmup",
  "warmupUpdatedAt",
  "warmupUpdatedBy",
]);

const WEB_STATUS_STABLE_KEYS = new Set([
  "tps",
  "tpsStatus",
  "currentLayer",
  "nextLayer",
  "layer",
  "map",
  "mapName",
  "serverName",
  "playerCount",
  "maxPlayers",
  "queueCount",
  "logTime",
  "logClockSeconds",
  "logClockHasAnchor",
  "logClockManual",
  "logClockAnchorLogTime",
  "logClockLastResetAt",
  "logClockLastResetReason",
  "isWarmup",
  "warmupUpdatedAt",
  "warmupUpdatedBy",
]);

function mergeStableSnapshot(existing: Record<string, any>, incoming: Record<string, any>) {
  const merged: Record<string, any> = {
    ...existing,
    ...incoming,
  };

  for (const key of TOP_LEVEL_STABLE_KEYS) {
    if (!isValidDisplayValue(incoming[key], key)) {
      if (existing[key] !== undefined) {
        merged[key] = existing[key];
      } else {
        delete merged[key];
      }
    }
  }

  merged.webStatus = mergeStableWebStatus(existing.webStatus, incoming.webStatus);
  return merged;
}

function mergeStableWebStatus(existingWebStatus: any, incomingWebStatus: any) {
  const existing = isRecord(existingWebStatus) ? existingWebStatus : {};
  const incoming = isRecord(incomingWebStatus) ? incomingWebStatus : {};
  const merged: Record<string, any> = {
    ...existing,
    ...incoming,
  };

  for (const key of WEB_STATUS_STABLE_KEYS) {
    if (!isValidDisplayValue(incoming[key], key)) {
      if (existing[key] !== undefined) {
        merged[key] = existing[key];
      } else {
        delete merged[key];
      }
    }
  }

  return merged;
}

function isValidDisplayValue(value: any, key = "") {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return false;
    if (text === "Unknown" || text === "Unknown Server" || text === "Unknown Map" || text === "Unknown Layer") return false;
    return true;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return false;
    if (key.toLowerCase().includes("tps") && value <= 0) return false;
    return true;
  }
  return true;
}

function isRecord(value: any): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
