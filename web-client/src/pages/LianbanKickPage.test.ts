import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vue-router", () => ({
  useRoute: () => ({
    meta: {
      layoutMode: "workspace",
    },
  }),
}));

vi.mock("../app/apiClient", () => ({
  apiGet: vi.fn(),
}));

import { apiGet } from "../app/apiClient";
import LianbanKickPage from "./LianbanKickPage.vue";

describe("LianbanKickPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(apiGet).mockResolvedValue({
      ok: true,
      data: {
        enabled: true,
        subscribed: true,
        directory: "D:/联办",
        cacheMs: 5000,
        retryCooldownMs: 10000,
        lastLoadedAt: "2026-05-12T00:00:00.000Z",
        lastScanAt: "2026-05-12T00:01:00.000Z",
        lastKickAt: "2026-05-12T00:02:00.000Z",
        lastError: "",
        files: ["ban-list.txt"],
        entries: 12,
        playersScanned: 80,
        kickAttempts: 2,
        kickSuccess: 2,
        kickFailed: 0,
        lastMatch: {
          playerName: "Alice",
          steamID: "76561198000000001",
          eosID: "EOS-1",
          matchType: "steam",
          matchValue: "76561198000000001",
          at: "2026-05-12T00:02:00.000Z",
        },
        recentEvents: [
          {
            id: "evt-1",
            kind: "kick",
            at: "2026-05-12T00:02:00.000Z",
            playerName: "Alice",
            steamID: "76561198000000001",
          },
        ],
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders lianban state from the plugin API", async () => {
    const wrapper = mount(LianbanKickPage);
    await vi.runOnlyPendingTimersAsync();
    await flushPromises();

    expect(apiGet).toHaveBeenCalledWith("/api/plugins/lianban-kick/state");
    expect(wrapper.text()).toContain("联办踢出");
    expect(wrapper.text()).toContain("运行中");
    expect(wrapper.text()).toContain("联办条目");
    expect(wrapper.text()).toContain("12");
    expect(wrapper.text()).toContain("ban-list.txt");
    expect(wrapper.text()).toContain("Alice");
    expect(wrapper.text()).toContain("kick");
    wrapper.unmount();
  });
});
