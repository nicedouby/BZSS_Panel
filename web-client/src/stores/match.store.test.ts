import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { applyMatchSnapshotResponse, buildSquadsSnapshot } from "../app/matchSnapshot";
import { useMatchStore } from "./match.store";
import { useSquadStore } from "./squad.store";

const TEAM_HEADERS = [
  { teamID: 1, teamName: "118th Combined Arms Brigade" },
  { teamID: 2, teamName: "Manticore Security Task Force" },
];

describe("match team headers", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("preserves ListSquads team headers from either squad or match state fields", () => {
    expect(buildSquadsSnapshot({
      list: [],
      teams: TEAM_HEADERS,
      lastUpdatedAt: "2026-07-12T00:00:00.000Z",
    }).teams).toEqual(TEAM_HEADERS);

    expect(buildSquadsSnapshot({
      list: [],
      lastUpdatedAt: "2026-07-12T00:00:00.000Z",
    }, TEAM_HEADERS).teams).toEqual(TEAM_HEADERS);
  });

  it("shows the battlegroup name for a team with no players or squads", () => {
    applyMatchSnapshotResponse({
      matchState: {
        serverStatus: {
          lastUpdatedAt: "2026-07-12T00:00:00.000Z",
        },
        players: {
          list: [
            {
              playerID: 1,
              name: "Braovo",
              teamID: 1,
              squadID: 1,
            },
          ],
          lastUpdatedAt: "2026-07-12T00:00:00.000Z",
        },
        squads: {
          list: [
            {
              key: "1:1",
              teamID: 1,
              teamName: "118th Combined Arms Brigade",
              squadID: 1,
              squadName: "Squad 1",
            },
          ],
          lastUpdatedAt: "2026-07-12T00:00:00.000Z",
        },
        teams: TEAM_HEADERS,
        rconStatus: {
          connected: true,
        },
      },
      overview: {
        status: {
          rcon: "connected",
        },
      },
    });

    expect(useSquadStore().teams).toEqual(TEAM_HEADERS);

    const emptyTeam = useMatchStore().teams.find((team) => team.teamID === 2);
    expect(emptyTeam).toMatchObject({
      teamID: 2,
      teamName: "Manticore Security Task Force",
      playerCount: 0,
      squads: [],
      unassignedPlayers: [],
    });
  });

  it("does not erase known battlegroup names when a later partial snapshot omits headers", () => {
    const store = useSquadStore();
    store.applySnapshot(buildSquadsSnapshot({
      list: [],
      teams: TEAM_HEADERS,
      lastUpdatedAt: "2026-07-12T00:00:00.000Z",
    }));

    store.applySnapshot(buildSquadsSnapshot({
      list: [],
      lastUpdatedAt: "2026-07-12T00:00:01.000Z",
    }));

    expect(store.teams).toEqual(TEAM_HEADERS);
    expect(useMatchStore().teams.find((team) => team.teamID === 2)?.teamName)
      .toBe("Manticore Security Task Force");
  });
});
