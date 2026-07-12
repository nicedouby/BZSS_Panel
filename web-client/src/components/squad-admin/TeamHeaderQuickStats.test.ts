import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import TeamHeaderQuickStats from "./TeamHeaderQuickStats.vue";

describe("TeamHeaderQuickStats", () => {
  it("renders ticket and player count correctly", () => {
    const wrapper = mount(TeamHeaderQuickStats, {
      props: {
        teamId: 1,
        ticketCount: 252,
        playerCount: 39,
        maxPlayers: 50,
        canEditTickets: true,
      },
    });

    expect(wrapper.text()).toContain("票");
    expect(wrapper.text()).toContain("252");
    expect(wrapper.text()).toContain("在线");
    expect(wrapper.text()).toContain("39");
    expect(wrapper.text()).toContain("50");
  });

  it("handles null tickets gracefully", () => {
    const wrapper = mount(TeamHeaderQuickStats, {
      props: {
        teamId: 1,
        ticketCount: null,
        playerCount: 39,
        maxPlayers: 50,
        canEditTickets: true,
      },
    });

    expect(wrapper.text()).toContain("--");
  });

  it("prevents division by zero when maxPlayers is 0", () => {
    const wrapper = mount(TeamHeaderQuickStats, {
      props: {
        teamId: 1,
        ticketCount: 100,
        playerCount: 10,
        maxPlayers: 0,
        canEditTickets: true,
      },
    });

    const progressFill = wrapper.find(".player-capacity-fill");
    expect(progressFill.exists()).toBe(true);
    expect(progressFill.attributes("style")).toContain("width: 0%");
  });

  it("limits player occupancy width to 100% when playerCount exceeds maxPlayers", () => {
    const wrapper = mount(TeamHeaderQuickStats, {
      props: {
        teamId: 1,
        ticketCount: 100,
        playerCount: 55,
        maxPlayers: 50,
        canEditTickets: true,
      },
    });

    const progressFill = wrapper.find(".player-capacity-fill");
    expect(progressFill.attributes("style")).toContain("width: 100%");
  });

  it("emits edit-tickets event on clicking ticket button when canEditTickets is true", async () => {
    const wrapper = mount(TeamHeaderQuickStats, {
      props: {
        teamId: 1,
        ticketCount: 252,
        playerCount: 39,
        maxPlayers: 50,
        canEditTickets: true,
      },
    });

    const ticketBtn = wrapper.find(".team-ticket-stat");
    expect(ticketBtn.classes()).toContain("clickable");
    expect(ticketBtn.attributes("disabled")).toBeUndefined();

    await ticketBtn.trigger("click");
    expect(wrapper.emitted("edit-tickets")).toBeTruthy();
  });

  it("disables ticket button and does not emit edit-tickets event when canEditTickets is false", async () => {
    const wrapper = mount(TeamHeaderQuickStats, {
      props: {
        teamId: 1,
        ticketCount: 252,
        playerCount: 39,
        maxPlayers: 50,
        canEditTickets: false,
      },
    });

    const ticketBtn = wrapper.find(".team-ticket-stat");
    expect(ticketBtn.classes()).not.toContain("clickable");
    expect(ticketBtn.attributes("disabled")).toBeDefined();

    await ticketBtn.trigger("click");
    expect(wrapper.emitted("edit-tickets")).toBeFalsy();
  });

  it("does not trigger edit-tickets when player stat control is clicked", async () => {
    const wrapper = mount(TeamHeaderQuickStats, {
      props: {
        teamId: 1,
        ticketCount: 252,
        playerCount: 39,
        maxPlayers: 50,
        canEditTickets: true,
      },
    });

    const playerStat = wrapper.find(".team-player-stat");
    await playerStat.trigger("click");
    expect(wrapper.emitted("edit-tickets")).toBeFalsy();
  });

  it("applies correct occupancy tone classes based on capacity", () => {
    // Normal tone: < 80% (39/50 = 78%)
    let wrapper = mount(TeamHeaderQuickStats, {
      props: {
        teamId: 1,
        ticketCount: 252,
        playerCount: 39,
        maxPlayers: 50,
        canEditTickets: true,
      },
    });
    expect(wrapper.find(".team-player-stat").classes()).toContain("normal");

    // Busy tone: >= 80% (40/50 = 80%)
    wrapper = mount(TeamHeaderQuickStats, {
      props: {
        teamId: 1,
        ticketCount: 252,
        playerCount: 40,
        maxPlayers: 50,
        canEditTickets: true,
      },
    });
    expect(wrapper.find(".team-player-stat").classes()).toContain("busy");

    // Full tone: >= 96% (48/50 = 96%)
    wrapper = mount(TeamHeaderQuickStats, {
      props: {
        teamId: 1,
        ticketCount: 252,
        playerCount: 48,
        maxPlayers: 50,
        canEditTickets: true,
      },
    });
    expect(wrapper.find(".team-player-stat").classes()).toContain("full");
  });
});
