import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("vue-router", () => ({
  useRoute: () => ({
    meta: {
      layoutMode: "workspace",
    },
  }),
}));

vi.mock("../app/apiClient", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

import { apiGet } from "../app/apiClient";
import PanelBanPage from "./PanelBanPage.vue";

describe("PanelBanPage", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    vi.mocked(apiGet).mockResolvedValue({
      ok: true,
      data: {
        enabled: true,
        subscribed: true,
        dataDir: "./data/plugins/panel-ban",
        filePath: "D:/bzss/data/plugins/panel-ban/bans.json",
        cacheMs: 5000,
        retryCooldownMs: 30000,
        matchNameFallback: true,
        lastLoadedAt: "2026-06-29T00:00:00.000Z",
        lastScanAt: "2026-06-29T00:01:00.000Z",
        lastKickAt: "2026-06-29T00:02:00.000Z",
        lastError: "",
        kickAttempts: 3,
        kickSuccess: 3,
        kickFailed: 0,
        totalEntries: 3,
        activeEntries: 1,
        disabledEntries: 1,
        expiredEntries: 1,
        lastMatch: null,
        entries: [
          {
            id: "ban-1",
            steamID: "76561198000000001",
            eosID: "",
            name: "Steam Hit",
            reason: "Steam ban",
            expiresAt: "2026-07-01T00:00:00.000Z",
            status: "active",
            createdAt: "2026-06-29T00:00:00.000Z",
            createdBy: "admin",
            updatedAt: "2026-06-29T00:00:00.000Z",
            hitCount: 1,
            lastHitAt: "2026-06-29T00:02:00.000Z",
            lastHitPlayerName: "Steam Hit",
            lastHitServerId: "BZSS_Main",
            lastHitMatchType: "steamID",
            lastHitMatchValue: "76561198000000001",
            identityText: "76561198000000001 / Steam Hit",
            isExpired: false,
            isDisabled: false,
            isActive: true,
            expiresInMs: 86_400_000,
            expiresInLabel: "1d",
          },
        ],
        recentHits: [
          {
            id: "hit-1",
            kind: "kick_success",
            at: "2026-06-29T00:02:00.000Z",
            playerName: "Steam Hit",
            serverId: "BZSS_Main",
            matchType: "steamID",
            matchValue: "76561198000000001",
          },
        ],
        recentEvents: [
          {
            id: "evt-1",
            kind: "loaded",
            at: "2026-06-29T00:00:00.000Z",
            entryId: "ban-1",
            serverId: "BZSS_Main",
          },
        ],
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders panel ban state from the plugin API", async () => {
    const pinia = createPinia();
    const wrapper = mount(PanelBanPage, {
      global: {
        plugins: [pinia],
        stubs: {
          PlayerSelect: true,
        },
      },
    });
    await vi.runOnlyPendingTimersAsync();
    await flushPromises();

    expect(apiGet).toHaveBeenCalledWith("/api/plugins/panel-ban/state");
    expect(wrapper.text()).toContain("面板封禁");
    expect(wrapper.text()).toContain("总条目");
    expect(wrapper.text()).toContain("Steam Hit");
    expect(wrapper.text()).toContain("Steam ban");
    expect(wrapper.text()).toContain("命中历史");
    wrapper.unmount();
  });
});
