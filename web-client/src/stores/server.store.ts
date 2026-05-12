import { defineStore } from "pinia";

export const useServerStore = defineStore("server", {
  state: () => ({
    snapshot: {} as Record<string, any>,
    stale: false,
    updatedAt: 0,
  }),
  actions: {
    applySnapshot(snapshot: any) {
      this.snapshot = snapshot ?? {};
      this.stale = Boolean(snapshot?.stale);
      this.updatedAt = Number(snapshot?.updatedAt ?? Date.now());
    },
    applyStableSnapshot(snapshot: any) {
      const existing = isRecord(this.snapshot) ? this.snapshot : {};
      const incoming = isRecord(snapshot) ? snapshot : {};

      this.snapshot = mergeStableSnapshot(existing, incoming);
      this.stale = Boolean(incoming?.stale);
      this.updatedAt = Number(incoming?.updatedAt ?? Date.now());
    },
    markStale() {
      this.stale = true;
    },
  },
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
  "matchState",
  "tps",
  "tpsStatus",
  "playtime",
  "maxPlayers",
  "playerCount",
  "queueCount",
]);

const WEB_STATUS_STABLE_KEYS = new Set([
  "tps",
  "tpsStatus",
  "currentLayer",
  "layer",
  "map",
  "mapName",
  "serverName",
  "playerCount",
  "maxPlayers",
  "queueCount",
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
