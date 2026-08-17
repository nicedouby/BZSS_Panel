import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import TeamDetailDrawer from "./TeamDetailDrawer.vue";
import type { TeamViewModel } from "../../types/squad-admin.types";

function buildTeam(): TeamViewModel {
  return {
    teamId: 1,
    teamName: "Russian Armed Forces",
    teamColorType: "team1",
    factionCode: "RU",
    playerCount: 48,
    maxPlayers: 50,
    ticketCount: 320,
    averagePlaytimeHours: 4.5,
    leaderAveragePlaytimeHours: 8.1,
    publicLeaderPlaytimePlayers: 1,
    privateLeaderPlaytimePlayers: 0,
    knownLeaderPlaytimePlayers: 1,
    publicPlaytimePlayers: 35,
    privatePlaytimePlayers: 13,
    knownPlaytimePlayers: 48,
    squads: [
      {
        squadId: 1,
        teamId: 1,
        squadName: "Alpha Squad",
        squadNature: "infantry",
        squadNatureLabel: "步兵 squad",
        isLocked: false,
        memberCount: 9,
        maxMembers: 9,
        averagePlaytimeHours: 5.2,
        leader: {
          playerId: 101,
          name: "Captain Price",
          role: "Squad Leader",
          isLeader: true,
          isOnline: true,
          teamId: 1,
          squadId: 1,
          steamId: "76561198000000001",
          eosId: "EOS-1",
          ip: null,
          playtimeHours: 10,
          combatStats: { kills: 5, downs: 2, deaths: 1, tk: 0, revives: 3 },
          statsLabel: "K 5 / D 1",
          raw: {},
        },
        members: [],
        creatorName: "Captain Price",
        restrictionViolation: false,
        restrictionReasons: [],
      },
    ],
  };
}

describe("TeamDetailDrawer", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders team name, ticket count, player occupancy and squads when open", () => {
    const wrapper = mount(TeamDetailDrawer, {
      props: {
        open: true,
        team: buildTeam(),
        canEditTickets: true,
      },
      global: {
        stubs: {
          StatusBadge: true,
        },
      },
    });

    const bodyText = document.body.textContent || "";
    expect(bodyText).toContain("Russian Armed Forces");
    expect(bodyText).toContain("TEAM 1");
    expect(bodyText).toContain("320");
    expect(bodyText).toContain("48 / 50");
    expect(bodyText).toContain("Alpha Squad");
    expect(bodyText).toContain("Captain Price");

    wrapper.unmount();
  });

  it("emits select-squad when clicking a squad item inside the drawer", async () => {
    const teamData = buildTeam();
    const wrapper = mount(TeamDetailDrawer, {
      props: {
        open: true,
        team: teamData,
        canEditTickets: true,
      },
      global: {
        stubs: {
          StatusBadge: true,
        },
      },
    });

    const squadCard = document.body.querySelector(".squad-mini-item") as HTMLElement | null;
    expect(squadCard).toBeTruthy();
    squadCard?.click();

    expect(wrapper.emitted("select-squad")).toBeTruthy();
    expect(wrapper.emitted("select-squad")?.[0]).toEqual([teamData.squads[0]]);

    wrapper.unmount();
  });
});
