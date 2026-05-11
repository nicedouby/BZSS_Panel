import { beforeEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

import MatchStatusPage from "./MatchStatusPage.vue";
import { getRuntimeSyncState, stopRuntimeSync } from "../app/runtimeSync";
import { useAuthStore } from "../stores/auth.store";
import { usePlayerStore } from "../stores/player.store";
import { useServerStore } from "../stores/server.store";
import { useSquadStore } from "../stores/squad.store";

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
  });

  it("shows a disconnected hint instead of infinite loading", () => {
    const wrapper = mount(MatchStatusPage, {
      global: {
        plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]],
      },
    });

    expect(wrapper.text()).toContain("Not connected");
    expect(wrapper.text()).toContain("No online players");
    expect(wrapper.text()).not.toContain("Loading");
  });
});
