import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

vi.mock("../app/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../app/apiClient")>("../app/apiClient");
  return {
    ...actual,
    apiGet: vi.fn(),
    apiPost: vi.fn(),
  };
});

vi.mock("vue-router", () => ({
  useRoute: () => ({
    path: "/match-status",
    meta: {
      refreshPolicy: "realtime",
    },
  }),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    resolve: vi.fn(),
  }),
}));

import MatchStatusPage from "./MatchStatusPage.vue";
import { apiGet, apiPost } from "../app/apiClient";
import { getRuntimeSyncState, stopRuntimeSync } from "../app/runtimeSync";
import { useAuthStore } from "../stores/auth.store";
import { usePlayerStore } from "../stores/player.store";
import { useServerStore } from "../stores/server.store";
import { useSquadStore } from "../stores/squad.store";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.onopen?.(new Event("open"));
    });
  }

  addEventListener(type: string, handler: EventListenerOrEventListenerObject) {
    if (type === "open") this.onopen = handler as (event: Event) => void;
    if (type === "message") this.onmessage = handler as (event: MessageEvent<string>) => void;
    if (type === "close") this.onclose = handler as (event: CloseEvent) => void;
    if (type === "error") this.onerror = handler as (event: Event) => void;
  }

  removeEventListener(type: string, handler: EventListenerOrEventListenerObject) {
    if (type === "open" && this.onopen === handler) this.onopen = null;
    if (type === "message" && this.onmessage === handler) this.onmessage = null;
    if (type === "close" && this.onclose === handler) this.onclose = null;
    if (type === "error" && this.onerror === handler) this.onerror = null;
  }

  close() {
    this.onclose?.(new CloseEvent("close"));
  }

  emit(payload: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  url: string;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 1;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.readyState = 2;
  }

  emit(payload: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(payload) }));
  }
}

function installMatchMedia() {
  vi.stubGlobal("matchMedia", (query: string) => {
    const maxWidth = /max-width:\s*(\d+)px/.exec(query);
    const maxHeight = /max-height:\s*(\d+)px/.exec(query);
    const orientationLandscape = query.includes("orientation: landscape");
    const matches = (!maxWidth || window.innerWidth <= Number(maxWidth[1]))
      && (!maxHeight || window.innerHeight <= Number(maxHeight[1]))
      && (!orientationLandscape || window.innerWidth >= window.innerHeight);

    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
  });
}

describe("MatchStatusPage", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1400 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    installMatchMedia();
    setActivePinia(createPinia());
    stopRuntimeSync();
    Object.assign(getRuntimeSyncState(), {
      started: false,
      inFlight: false,
      lastSuccessAt: 0,
      lastError: null,
      errorType: null,
      consecutiveFailures: 0,
    });

    const auth = useAuthStore();
    auth.checked = true;
    auth.authenticated = true;

    useServerStore().applySnapshot({
      updatedAt: Date.now(),
      webStatus: {
        serverId: "server-1",
        rcon: "disconnected",
      },
    });
    usePlayerStore().applySnapshot({
      active: [],
      recentlyDisconnected: [],
      updatedAt: Date.now(),
    });
    useSquadStore().applySnapshot({
      list: [],
      updatedAt: Date.now(),
    });

    vi.mocked(apiGet).mockReset();
    vi.mocked(apiPost).mockReset();
    vi.mocked(apiPost).mockResolvedValue({
      ok: true,
      snapshot: {
        id: "snapshot-temp",
      },
    } as any);
    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === "/api/match/snapshot") {
        return {
          ok: true,
          source: "module.matchState",
          type: "snapshot",
          matchState: {
            serverStatus: {},
            players: { list: [], lastUpdatedAt: "2026-05-12T00:00:00.000Z" },
            squads: { list: [], lastUpdatedAt: "2026-05-12T00:00:00.000Z" },
            rconStatus: { connected: true },
          },
          overview: {
            status: {
              rcon: "connected",
            },
          },
        };
      }

      if (path === "/api/squad-lifecycle/current") {
        return { current: {} };
      }

      if (path.startsWith("/api/battle-log/overview")) {
        return {
          ok: true,
          enabled: true,
          source: "log",
          count: 3,
          stats: {
            total: 3,
            down: 1,
            kill: 1,
            death: 1,
            revive: 0,
            tk: 0,
          },
          lastUpdatedAt: "2026-05-12T00:00:00.000Z",
          latest: [
            {
              displayText: "Alice downed by Bob",
              sourceEventName: "module.combatClean.woundResolved",
            },
          ],
          sourceStatus: {
            log: { enabled: true, subscribed: true },
            mod: { enabled: false, subscribed: false, supported: false },
          },
          serverId: "server-1",
        };
      }

      if (path.startsWith("/api/query/playtime-cache")) {
        return {
          items: {
            "76561198000000001": { gameSeconds: 7200 },
          },
        };
      }

      if (path.startsWith("/api/query/player-database")) {
        return {
          items: [
            {
              id: 1,
              current_name: "Alice",
              steam_id: "76561198000000001",
              eos_id: "EOS-1",
              game_seconds: 7200,
              steam_game_seconds: 7200,
              game_seconds_override: null,
              updated_at: Date.now(),
            },
          ],
        };
      }

      if (path.startsWith("/api/player-database/detail")) {
        return {
          player: {
            id: 1,
            current_name: "Alice",
            steam_id: "76561198000000001",
            eos_id: "EOS-1",
            steam_game_seconds: 7200,
            game_seconds: 7200,
            game_seconds_override: null,
            updated_at: Date.now(),
          },
          summary: {
            gameSeconds: 7200,
            steamGameSeconds: 7200,
            gameSecondsOverride: null,
            serverSeconds: 0,
          },
          aliases: [],
          ips: [],
        };
      }

      if (path.startsWith("/api/combat-manager/cache")) {
        return { snapshot: { events: [] } };
      }

      if (path.startsWith("/api/battle-log/player")) {
        return {
          ok: true,
          enabled: true,
          source: "log",
          serverId: "server-1",
          query: "Alice",
          player: {
            name: "Alice",
            displayName: "Alice",
            steam64ID: "76561198000000001",
          },
          stats: {
            total: 7,
            down: 2,
            kill: 4,
            death: 3,
            revive: 1,
            tk: 1,
          },
          lastUpdatedAt: "2026-05-12T00:00:00.000Z",
          latest: [],
        };
      }

      throw new Error(`Unexpected path: ${path}`);
    });

    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket as any);
    vi.stubGlobal("EventSource", FakeEventSource as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("renders the match status page with the live chat panel", () => {
    const wrapper = mount(MatchStatusPage, {
      global: {
        plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]],
        stubs: {
          PlayerCombatTimeline: true,
          StatusBadge: true,
          CopyableValue: true,
        },
      },
    });

    expect(wrapper.findComponent({ name: "MatchChatPanel" }).exists()).toBe(true);
    expect(wrapper.text()).toContain("Live feed");
    expect(wrapper.text()).not.toContain("Loading");
    wrapper.unmount();
  });
  it('opens the floating player window from a player row', async () => {
    const auth = useAuthStore();
    auth.user = {
      id: "1",
      username: "admin",
      role: "admin",
      isSuperAdmin: true,
      permissions: [],
    };

    vi.mocked(apiGet).mockImplementation(async (path: string) => {
      if (path === "/api/match/snapshot") {
        return {
          ok: true,
          source: "module.matchState",
          type: "snapshot",
          matchState: {
            serverStatus: {
              serverId: "server-1",
            },
            players: {
              list: [
                {
                  playerID: 1,
                  name: "Alice",
                  teamID: 1,
                  squadID: null,
                  steamID: "76561198000000001",
                  eosID: "EOS-1",
                  role: "Rifleman",
                  isLeader: false,
                  online: true,
                  squadlessSeconds: 95,
                  matchOnlineSeconds: 3661,
                  matchObservedOnlineSeconds: 3600,
                  matchEstimatedOnlineSeconds: 61,
                  matchFirstSeenAt: "2026-05-12T00:00:00.000Z",
                  matchLastSeenAt: "2026-05-12T00:10:00.000Z",
                  matchJoinCount: 2,
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

      if (path === "/api/squad-lifecycle/current") {
        return { current: {} };
      }

      if (path.startsWith("/api/query/playtime-cache")) {
        return {
          items: {
            "76561198000000001": { gameSeconds: 7200 },
          },
        };
      }

      if (path.startsWith("/api/battle-log/overview")) {
        return {
          ok: true,
          enabled: true,
          source: "log",
          count: 1,
          stats: {
            total: 1,
            down: 0,
            kill: 0,
            death: 1,
            revive: 0,
            tk: 0,
          },
          lastUpdatedAt: "2026-05-12T00:00:00.000Z",
          latest: [],
          sourceStatus: {
            log: { enabled: true, subscribed: true },
            mod: { enabled: false, subscribed: false, supported: false },
          },
          serverId: "server-1",
        };
      }

      if (path.startsWith("/api/battle-log/player")) {
        return {
          ok: true,
          enabled: true,
          source: "log",
          serverId: "server-1",
          query: "Alice",
          player: {
            name: "Alice",
            displayName: "Alice",
            steam64ID: "76561198000000001",
          },
          stats: {
            total: 7,
            down: 2,
            kill: 4,
            death: 3,
            revive: 1,
            tk: 1,
          },
          lastUpdatedAt: "2026-05-12T00:00:00.000Z",
          latest: [],
        };
      }

      throw new Error(`Unexpected path: ${path}`);
    });

    usePlayerStore().applySnapshot({
      active: [
        {
          playerID: 1,
          name: "Alice",
          teamID: 1,
          squadID: null,
          steamID: "76561198000000001",
          eosID: "EOS-1",
          role: "Rifleman",
          isLeader: false,
          online: true,
          squadlessSeconds: 95,
          matchOnlineSeconds: 3661,
          matchObservedOnlineSeconds: 3600,
          matchEstimatedOnlineSeconds: 61,
          matchFirstSeenAt: "2026-05-12T00:00:00.000Z",
          matchLastSeenAt: "2026-05-12T00:10:00.000Z",
          matchJoinCount: 2,
        },
      ],
      updatedAt: Date.now(),
    });

    const wrapper = mount(MatchStatusPage, {
      global: {
        plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]],
        stubs: {
          PlayerCombatTimeline: true,
          StatusBadge: true,
          CopyableValue: true,
        },
      },
    });

    await flushPromises();

    expect(wrapper.text()).toContain("Alice");
    expect(wrapper.text()).toContain("游离");

    await wrapper.find(".player-row").trigger("click", { clientX: 120, clientY: 150 });
    await flushPromises();
    await flushPromises();

    const panel = document.body.querySelector(".player-detail-floating");
    expect(panel).toBeTruthy();
    expect(panel?.textContent).toContain("Alice");
    expect(panel?.textContent).toContain("本服务器游玩时长");
    expect(panel?.textContent).toContain("暖服时长");
    expect(panel?.textContent).toContain("k0");
    expect(panel?.textContent).toContain("d0");
    expect(panel?.getAttribute("style") || "").toContain("width: 476px");

    expect((wrapper.vm as any).activePlayerWindow?.detail?.raw?.squadlessSeconds).toBe(95);

    expect(FakeEventSource.instances).toHaveLength(0);

    expect(document.body.querySelectorAll(".player-detail-floating")).toHaveLength(1);
    expect(document.body.querySelector(".player-detail-floating")?.textContent).toContain("Alice");

    const closeButton = document.body.querySelector(".hud-close-button") as HTMLButtonElement | null;
    expect(closeButton).toBeTruthy();
    closeButton?.click();
    await flushPromises();
    expect(document.body.querySelector(".player-detail-floating")).toBeNull();

    await wrapper.find(".player-row").trigger("click", { clientX: 160, clientY: 180 });
    await flushPromises();
    expect(document.body.querySelectorAll(".player-detail-floating")).toHaveLength(1);

    wrapper.unmount();
  });

  it("does not refetch playtime for already cached steamIDs", async () => {
    const playersStore = usePlayerStore();
    playersStore.applySnapshot({
      active: [
        {
          playerID: 1,
          name: "Alice",
          teamID: 1,
          squadID: 2,
          steamID: "76561198000000001",
          online: true,
        },
      ],
      updatedAt: Date.now(),
    });

    const wrapper = mount(MatchStatusPage, {
      global: {
        plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]],
        stubs: {
          PlayerCombatTimeline: true,
          StatusBadge: true,
          CopyableValue: true,
        },
      },
    });

    await flushPromises();
    await vi.waitFor(() => {
      const initialPlaytimeCacheCalls = vi.mocked(apiGet).mock.calls.filter(call => call[0].includes("playtime-cache"));
      expect(initialPlaytimeCacheCalls.length).toBeGreaterThan(0);
    });
    await flushPromises();

    // Clear call history on apiGet mock
    vi.mocked(apiGet).mockClear();

    // Add another player with the same steamID (which is already cached in stablePlaytimes)
    playersStore.applySnapshot({
      active: [
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
          teamID: 1,
          squadID: 2,
          steamID: "76561198000000001",
          online: true,
        }
      ],
      updatedAt: Date.now(),
    });

    await flushPromises();

    // Verify that no new network call is made for playtime-cache
    const playtimeCacheCalls = vi.mocked(apiGet).mock.calls.filter(call => call[0].includes("playtime-cache"));
    expect(playtimeCacheCalls.length).toBe(0);

    wrapper.unmount();
  });
});

