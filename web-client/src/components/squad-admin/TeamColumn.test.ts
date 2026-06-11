import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";

import TeamColumn from "./TeamColumn.vue";
import type { TeamViewModel } from "../../types/squad-admin.types";

function buildTeam(teamName: string): TeamViewModel {
  return {
    teamId: 1,
    teamName,
    teamColorType: "team1",
    factionCode: null,
    playerCount: 12,
    maxPlayers: 50,
    averagePlaytimeHours: 4.5,
    avgPing: null,
    leaderAveragePlaytimeHours: 8.1,
    publicLeaderPlaytimePlayers: 1,
    privateLeaderPlaytimePlayers: 0,
    knownLeaderPlaytimePlayers: 1,
    publicPlaytimePlayers: 8,
    privatePlaytimePlayers: 2,
    knownPlaytimePlayers: 10,
    squads: [],
  };
}

describe("TeamColumn", () => {
  it("renders faction flag background and current unit icon", () => {
    const wrapper = mount(TeamColumn, {
      props: {
        team: buildTeam("95th Air Assault Brigade"),
        playtimes: {},
        combatStatsLookup: {},
      },
      global: {
        stubs: {
          SquadCard: true,
        },
      },
    });

    const factionFlag = wrapper.get("img.team-faction-bg-img");
    const unitIcon = wrapper.get("img.unit-icon-inline");
    const titleLine = wrapper.get(".team-title-line").element;

    expect(factionFlag.attributes("src")).toContain("AFU.PNG");
    expect(unitIcon.attributes("src")).toContain("T_AFU_95thAAB_AirAssault.PNG");
    expect(titleLine.firstElementChild?.classList.contains("unit-icon-inline")).toBe(true);
    expect(titleLine.children[1].classList.contains("team-id-badge")).toBe(true);
    expect(wrapper.text()).toContain("TEAM 1");
    expect(wrapper.text()).toContain("95th Air Assault Brigade");
  });

  it("omits missing visuals without rendering broken image tags", () => {
    const wrapper = mount(TeamColumn, {
      props: {
        team: buildTeam("Unknown Battlegroup"),
        playtimes: {},
        combatStatsLookup: {},
      },
      global: {
        stubs: {
          SquadCard: true,
        },
      },
    });

    expect(wrapper.find("img.team-faction-bg-img").exists()).toBe(false);
    expect(wrapper.find("img.unit-icon").exists()).toBe(false);
    expect(wrapper.text()).toContain("Unknown Battlegroup");
  });
});
