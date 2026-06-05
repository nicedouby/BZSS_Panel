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
import { apiGet } from "../app/apiClient";
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

describe("MatchStatusPage", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1400 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
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

      if (path.startsWith("/api/query/playtime-cache")) {
        return { items: {} };
      }

      if (path.startsWith("/api/combat-manager/cache")) {
        return { snapshot: { events: [] } };
      }

      throw new Error(`Unexpected path: ${path}`);
    });

    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket as any);
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
    expect(wrapper.text()).not.toContain("Loading");
    wrapper.unmount();
  });

  it("opens the floating player window from a player row", async () => {
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
            serverStatus: {},
            players: {
              list: [
                {
                  playerID: 1,
                  name: "Alice",
                  teamID: 1,
                  squadID: 2,
                  steamID: "76561198000000001",
                  eosID: "EOS-1",
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

      throw new Error(`Unexpected path: ${path}`);
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

    await wrapper.find(".player-row").trigger("click", { clientX: 120, clientY: 150 });
    await flushPromises();

    const panel = document.body.querySelector(".player-detail-floating");
    expect(panel).toBeTruthy();
    expect(panel?.textContent).toContain("Alice");
    expect(panel?.getAttribute("style") || "").toContain("left: 12px");
    expect(panel?.getAttribute("style") || "").toContain("top: 12px");

    wrapper.unmount();
  });
});
