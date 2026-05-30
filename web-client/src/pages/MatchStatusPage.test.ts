import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

import MatchStatusPage from "./MatchStatusPage.vue";
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

    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the match status page with the live chat panel", () => {
    const wrapper = mount(MatchStatusPage, {
      global: {
        plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]],
      },
    });

    expect(wrapper.findComponent({ name: "MatchChatPanel" }).exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Loading");
    wrapper.unmount();
  });
});
