import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("./apiClient", async () => {
  const actual = await vi.importActual<typeof import("./apiClient")>("./apiClient");
  return {
    ...actual,
    apiGet: vi.fn(),
  };
});

import { ApiError, apiGet } from "./apiClient";
import { getRuntimeSyncState, stopRuntimeSync, syncOnce } from "./runtimeSync";
import { resolveRefreshDelay } from "./refreshPolicy";
import { useAuthStore } from "../stores/auth.store";
import { useEventStore } from "../stores/event.store";
import { useJobStore } from "../stores/job.store";
import { usePlayerStore } from "../stores/player.store";
import { useServerStore } from "../stores/server.store";
import { useSquadStore } from "../stores/squad.store";

describe("runtimeSync", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal("document", {
      hidden: false,
      addEventListener() {},
      removeEventListener() {},
    });
    setActivePinia(createPinia());
    stopRuntimeSync();
    Object.assign(getRuntimeSyncState(), {
      started: true,
      inFlight: false,
      lastSuccessAt: 0,
      lastError: null,
      errorType: null,
      consecutiveFailures: 0,
      bootstrapRefreshAttempted: false,
      refreshPolicy: "polling",
      lastRuntimeSnapshotAttemptAt: 0,
      lastRuntimeSnapshotAt: 0,
    });
    vi.mocked(apiGet).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stops and returns to login after a 401 snapshot response", async () => {
    const auth = useAuthStore();
    auth.checked = true;
    auth.authenticated = true;

    vi.mocked(apiGet).mockRejectedValue(new ApiError({
      type: "http",
      path: "/api/match/snapshot",
      status: 401,
      message: "Unauthorized",
    }));

    await syncOnce();

    expect(auth.authenticated).toBe(false);
    expect(auth.error).toBeTruthy();
    expect(getRuntimeSyncState().started).toBe(false);
    expect(getRuntimeSyncState().errorType).toBe("unauthorized");
  });

  it("hydrates stores from the dedicated match snapshot first", async () => {
    const server = useServerStore();
    const players = usePlayerStore();
    const squads = useSquadStore();
    const events = useEventStore();
    const jobs = useJobStore();
    const calls: string[] = [];

    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      calls.push(path);
      if (path === "/api/match/snapshot") {
        return {
          ok: true,
          source: "module.matchState",
          type: "snapshot",
          matchState: {
            serverStatus: {
              map: "AlBasrah",
              layer: "AlBasrah AAS v1",
              lastUpdatedAt: "2026-05-12T00:00:00.000Z",
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
        };
      }

      if (path === "/api/snapshot/all") {
        return {
          events: { console: [], raw: [], rcon: [], combat: [], updatedAt: 1 },
          jobs: { byId: {}, activeJobs: [], updatedAt: 1 },
        };
      }

      throw new Error(`Unexpected path: ${path}`);
    });

    await syncOnce();
    await syncOnce();

    expect(resolveRefreshDelay({
      policy: "realtime",
      playerCount: 120,
      hidden: false,
      surface: "auxiliary",
    })).toBeGreaterThan(resolveRefreshDelay({
      policy: "realtime",
      playerCount: 120,
      hidden: false,
      surface: "primary",
    }));
    expect(resolveRefreshDelay({
      policy: "realtime",
      playerCount: 120,
      hidden: true,
      surface: "primary",
    })).toBeGreaterThan(resolveRefreshDelay({
      policy: "realtime",
      playerCount: 120,
      hidden: false,
      surface: "primary",
    }));
    expect(calls.filter((path) => path === "/api/match/snapshot")).toHaveLength(2);
    expect(calls.filter((path) => path === "/api/snapshot/all")).toHaveLength(1);

    expect(server.snapshot.map).toBe("AlBasrah");
    expect(server.snapshot.webStatus.rcon).toBe("connected");
    expect(players.active).toHaveLength(1);
    expect(players.active[0].name).toBe("Alice");
    expect(squads.list).toHaveLength(1);
    expect(events.updatedAt).toBe(1);
    expect(jobs.updatedAt).toBe(1);
  });

  it("resolves route-aware cadences and hidden tab backoff", () => {
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

    expect(realtimePrimary).toBeLessThan(pollingPrimary);
    expect(hiddenRealtimePrimary).toBeGreaterThan(realtimePrimary);
    expect(realtimeAuxiliary).toBeGreaterThan(realtimePrimary);
  });
});
