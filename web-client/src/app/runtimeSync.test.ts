import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { getRuntimeSyncState, setRuntimeSyncRefreshPolicy, stopRuntimeSync, syncOnce } from "./runtimeSync";
import { resolveRefreshDelay } from "./refreshPolicy";
import { useAuthStore } from "../stores/auth.store";
import { useEventStore } from "../stores/event.store";
import { useJobStore } from "../stores/job.store";
import { usePlayerStore } from "../stores/player.store";
import { useServerStore } from "../stores/server.store";
import { useSquadStore } from "../stores/squad.store";

describe("runtimeSync", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal("document", {
      hidden: false,
      addEventListener() {},
      removeEventListener() {},
    });
    vi.stubGlobal("fetch", fetchMock);
    setActivePinia(createPinia());
    stopRuntimeSync();
    Object.assign(getRuntimeSyncState(), {
      started: true,
      inFlight: false,
      lastSuccessAt: 0,
      lastError: null,
      errorType: null,
      consecutiveFailures: 0,
      refreshPolicy: "polling",
    });
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stops and returns to login after a 401 snapshot response", async () => {
    const auth = useAuthStore();
    auth.checked = true;
    auth.authenticated = true;

    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn(),
    });

    await syncOnce();

    expect(auth.authenticated).toBe(false);
    expect(auth.error).toBeTruthy();
    expect(getRuntimeSyncState().started).toBe(false);
    expect(getRuntimeSyncState().errorType).toBe("unauthorized");
  });

  it("hydrates stores from the normalized runtime snapshot payload", async () => {
    const server = useServerStore();
    const players = usePlayerStore();
    const squads = useSquadStore();
    const events = useEventStore();
    const jobs = useJobStore();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        snapshot: {
          matchState: {
            serverStatus: {
              map: "AlBasrah",
              layer: "AlBasrah AAS v1",
              lastUpdatedAt: "2026-05-12T00:00:00.000Z",
              playerCount: 1,
            },
            players: {
              list: [
                {
                  playerID: 1,
                  name: "Alice",
                  teamID: 1,
                  squadID: 2,
                  steamID: "765611",
                  eosID: "EOS1",
                  role: "Rifleman",
                  isLeader: false,
                  online: true,
                },
              ],
              lastUpdatedAt: "2026-05-12T00:00:00.000Z",
            },
            squads: {
              list: [
                {
                  key: "1:2",
                  teamID: 1,
                  squadID: 2,
                  squadName: "Alpha",
                },
              ],
              lastUpdatedAt: "2026-05-12T00:00:00.000Z",
            },
            rconStatus: {
              connected: true,
            },
          },
          overview: {
            status: {
              rcon: "connected",
            },
          },
          events: { console: [], raw: [], rcon: [], combat: [], updatedAt: 1 },
          jobs: { byId: {}, activeJobs: [], updatedAt: 1 },
        },
      }),
    });

    await syncOnce();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/snapshot/all", {
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
      },
    });
    expect(server.snapshot.map).toBe("AlBasrah");
    expect(server.snapshot.webStatus.rcon).toBe("connected");
    expect(players.active).toHaveLength(1);
    expect(players.active[0].name).toBe("Alice");
    expect(squads.list).toHaveLength(1);
    expect(events.updatedAt).toBe(1);
    expect(jobs.updatedAt).toBe(1);
  });

  it("updates players even when the incoming revision is unchanged", async () => {
    const players = usePlayerStore();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        snapshot: {
          matchState: {
            players: {
              list: [
                {
                  playerID: 1,
                  name: "Alice",
                  teamID: 1,
                  squadID: 2,
                  steamID: "76561198000000001",
                  online: true,
                },
              ],
              lastUpdatedAt: "2026-05-12T00:00:00.000Z",
            },
            squads: {
              list: [],
              lastUpdatedAt: "2026-05-12T00:00:00.000Z",
            },
          },
          revisions: {
            players: 1,
            squads: 1,
          },
        },
      }),
    });

    await syncOnce();
    expect(players.active).toHaveLength(1);
    expect(players.active[0].name).toBe("Alice");

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        snapshot: {
          matchState: {
            players: {
              list: [
                {
                  playerID: 1,
                  name: "Alice",
                  teamID: 1,
                  squadID: 2,
                  steamID: "76561198000000001",
                  online: true,
                },
                {
                  playerID: 2,
                  name: "Bob",
                  teamID: 2,
                  squadID: 3,
                  steamID: "76561198000000002",
                  online: true,
                },
              ],
              lastUpdatedAt: "2026-05-12T00:01:00.000Z",
            },
            squads: {
              list: [],
              lastUpdatedAt: "2026-05-12T00:00:00.000Z",
            },
          },
          revisions: {
            players: 1,
            squads: 1,
          },
        },
      }),
    });

    await syncOnce();

    expect(players.active).toHaveLength(2);
    expect(players.active.map((player) => player.name)).toEqual(["Alice", "Bob"]);
  });

  it("resolves route-aware cadences and hidden tab backoff", () => {
    setRuntimeSyncRefreshPolicy("realtime");

    const realtimePrimary = resolveRefreshDelay({
      policy: "realtime",
      playerCount: 120,
      hidden: false,
      surface: "primary",
    });
    const pollingPrimary = resolveRefreshDelay({
      policy: "polling",
      playerCount: 120,
      hidden: false,
      surface: "primary",
    });
    const hiddenRealtimePrimary = resolveRefreshDelay({
      policy: "realtime",
      playerCount: 120,
      hidden: true,
      surface: "primary",
    });
    const realtimeAuxiliary = resolveRefreshDelay({
      policy: "realtime",
      playerCount: 120,
      hidden: false,
      surface: "auxiliary",
    });

    expect(getRuntimeSyncState().refreshPolicy).toBe("realtime");
    expect(realtimePrimary).toBeLessThan(pollingPrimary);
    expect(hiddenRealtimePrimary).toBeGreaterThan(realtimePrimary);
    expect(realtimeAuxiliary).toBeGreaterThan(realtimePrimary);
  });
});
