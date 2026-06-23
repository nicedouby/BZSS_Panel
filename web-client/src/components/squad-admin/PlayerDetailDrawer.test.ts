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
    position: { x: 10, y: 20, z: 30 },
    rotation: { x: 1, y: 2, z: 3 },
    health: 88,
    maxHealth: 100,
    weaponClass: "BP_Rifle_Test",
    ammoValues: [30, 29, 28],
    ping: 42,
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

  it("renders the floating panel on desktop", async () => {
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
    expect(panel?.getAttribute("style") || "").toContain("width: 476px");

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

  it("shows resolved IP when runtime player IP is missing", async () => {
    const wrapper = mount(PlayerDetailDrawer, {
      props: {
        open: true,
        player: {
          ...buildPlayer(),
          resolvedIp: "203.0.113.10",
          lastIp: "203.0.113.10",
          ipSource: "last",
        },
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

    expect(document.body.textContent || "").toContain("IP: 203.0.113.10");
    wrapper.unmount();
  });

  it("renders BZSS battle state fields in the floating window", async () => {
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

    const text = document.body.textContent || "";
    expect(text).toContain("战场状态 / BATTLE STATE");
    expect(text).toContain("(10, 20, 30)");
    expect(text).toContain("88/100");
    expect(text).toContain("Rifle_Test");
    expect(text).toContain("30 / 29 / 28");
    expect(text).toContain("42 ms");

    wrapper.unmount();
  });
});
