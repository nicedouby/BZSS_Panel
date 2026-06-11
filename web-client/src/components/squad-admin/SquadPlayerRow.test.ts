import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: mocks.routerPush,
    replace: vi.fn(),
    resolve: vi.fn(),
  }),
}));

import SquadPlayerRow from "./SquadPlayerRow.vue";

describe("SquadPlayerRow", () => {
  it("opens the player page from the avatar and emits playtime refresh from the chip", async () => {
    const wrapper = mount(SquadPlayerRow, {
      props: {
        player: {
          playerId: 1,
          name: "Test Player",
          role: "Rifleman",
          isLeader: false,
          isOnline: true,
          teamId: 1,
          squadId: 1,
          steamId: "76561198000000000",
          eosId: "eos_id_here",
          ip: null,
          playtimeHours: 120,
          ping: null,
          steamAvatar: "https://example.com/avatar.png",
          combatStats: { kills: 10, downs: 5, deaths: 2, tk: 0, revives: 3 },
          statsLabel: "10K 5D 2D 0TK 3R",
          raw: {},
        },
        playtimeHours: 12.5,
        combatStats: { kills: 1, downs: 0, deaths: 0, tk: 0, revives: 0 },
      },
    });

    await wrapper.get(".player-avatar-link").trigger("click");
    expect(mocks.routerPush).toHaveBeenCalledWith({
      path: "/player-database",
      query: { q: "76561198000000001" },
    });

    await wrapper.get(".playtime-chip-refreshable").trigger("click");
    expect(wrapper.emitted("refresh-playtime")).toBeTruthy();
  });
});
