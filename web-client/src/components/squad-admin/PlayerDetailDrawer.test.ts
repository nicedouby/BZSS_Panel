import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    resolve: vi.fn(),
  }),
}));

import PlayerDetailDrawer from "./PlayerDetailDrawer.vue";

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

function buildPlayer() {
  return {
    playerId: 1,
    name: "Alice",
    role: "Rifleman",
    isLeader: false,
    isOnline: true,
    teamId: 1,
    squadId: 2,
    steamId: "76561198000000001",
    eosId: "EOS-1",
    ip: null,
    playtimeHours: 12.5,
    combatStats: { kills: 3, downs: 1, deaths: 2, tk: 0, revives: 4 },
    statsLabel: "K 3 / D 2",
    source: "match",
    controller: "rcon",
    raw: {},
  };
}

describe("PlayerDetailDrawer", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    setViewport(1400, 900);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("anchors the floating panel near the click point on desktop", async () => {
    const wrapper = mount(PlayerDetailDrawer, {
      props: {
        open: true,
        player: buildPlayer(),
        mode: "floating",
        anchorX: 200,
        anchorY: 240,
      },
      global: {
        stubs: {
          PlayerCombatTimeline: true,
          StatusBadge: true,
          CopyableValue: true,
        },
      },
    });

    const panel = document.body.querySelector(".player-detail-floating") as HTMLElement | null;
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute("style") || "").toContain("left: 216px");
    expect(panel?.getAttribute("style") || "").toContain("top: 208px");

    wrapper.unmount();
  });

  it("falls back to a compact inset panel on small screens and closes on backdrop click", async () => {
    setViewport(640, 720);

    const wrapper = mount(PlayerDetailDrawer, {
      props: {
        open: true,
        player: buildPlayer(),
        mode: "floating",
        anchorX: 500,
        anchorY: 500,
      },
      global: {
        stubs: {
          PlayerCombatTimeline: true,
          StatusBadge: true,
          CopyableValue: true,
        },
      },
    });

    const panel = document.body.querySelector(".player-detail-floating") as HTMLElement | null;
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute("style") || "").toContain("width: calc(100vw - 24px)");
    expect(panel?.getAttribute("style") || "").toContain("max-height: calc(100vh - 24px)");

    const backdrop = document.body.querySelector(".floating-window-layer") as HTMLElement | null;
    expect(backdrop).toBeTruthy();
    await backdrop!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(wrapper.emitted("close")).toBeTruthy();
    wrapper.unmount();
  });
});
