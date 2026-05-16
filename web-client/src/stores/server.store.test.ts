import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useServerStore } from "./server.store";

describe("server store stable snapshot", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("preserves the last valid display values when an incoming snapshot is empty or invalid", () => {
    const server = useServerStore();

    server.applySnapshot({
      serverName: "BZSS Main Server",
      map: "Mutaha",
      layer: "Mutaha_RAAS_v1",
      mode: "RAAS",
      tps: 29.8,
      playerCount: 5,
      maxPlayers: 100,
      queueCount: 3,
      nextLayer: "Fallujah_RAAS_v2",
      isWarmup: true,
      warmupUpdatedAt: "2026-05-15T00:00:00.000Z",
      warmupUpdatedBy: "admin",
      webStatus: {
        serverName: "BZSS Main Server",
        currentLayer: "Mutaha_RAAS_v1",
        layer: "Mutaha_RAAS_v1",
        nextLayer: "Fallujah_RAAS_v2",
        map: "Mutaha",
        mapName: "Mutaha",
        tps: 29.8,
        playerCount: 5,
        maxPlayers: 100,
        isWarmup: true,
        warmupUpdatedAt: "2026-05-15T00:00:00.000Z",
        warmupUpdatedBy: "admin",
      },
    });

    server.applyStableSnapshot({
      serverName: "Unknown Server",
      map: "",
      layer: "Unknown Layer",
      mode: undefined,
      tps: 0,
      playerCount: 0,
      maxPlayers: 100,
      queueCount: 0,
      nextLayer: "Unknown Layer",
      webStatus: {
        serverName: "Unknown Server",
        currentLayer: "Unknown Layer",
        layer: "Unknown Layer",
        nextLayer: "Unknown Layer",
        map: "Unknown Map",
        mapName: "Unknown Map",
        tps: 0,
        playerCount: 0,
        maxPlayers: 100,
      },
    });

    expect(server.snapshot.serverName).toBe("BZSS Main Server");
    expect(server.snapshot.map).toBe("Mutaha");
    expect(server.snapshot.layer).toBe("Mutaha_RAAS_v1");
    expect(server.snapshot.nextLayer).toBe("Fallujah_RAAS_v2");
    expect(server.snapshot.tps).toBe(29.8);
    expect(server.snapshot.isWarmup).toBe(true);
    expect(server.snapshot.warmupUpdatedBy).toBe("admin");
    expect(server.snapshot.webStatus.serverName).toBe("BZSS Main Server");
    expect(server.snapshot.webStatus.currentLayer).toBe("Mutaha_RAAS_v1");
    expect(server.snapshot.webStatus.nextLayer).toBe("Fallujah_RAAS_v2");
    expect(server.snapshot.webStatus.tps).toBe(29.8);
    expect(server.snapshot.webStatus.isWarmup).toBe(true);
  });
});
