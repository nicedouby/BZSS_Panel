import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { applyMatchSnapshotResponse, buildSquadsSnapshot } from "../app/matchSnapshot";
import { useMatchStore } from "./match.store";
import { useSquadStore } from "./squad.store";

describe("match team headers", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("preserves ListSquads team headers in the squad snapshot", () => {
    const snapshot = buildSquadsSnapshot({
      list: [],
      teams: [
        { teamID: 1, teamName: "118th Combined Arms Brigade" },
        { teamID: 2, teamName: "Manticore Security Task Force" },
      ],
      lastUpdatedAt: "2026-07-12T00:00:00.000Z",
    });

    expect(snapshot.teams).toEqual([
      { teamID: 1, teamName: "118th Combined Arms Brigade" },
      { teamID: 2, teamName: "Manticore Security Task Force" },
    ]);
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
          teams: [
            { teamID: 1, teamName: "118th Combined Arms Brigade" },
            { teamID: 2, teamName: "Manticore Security Task Force" },
          ],
          lastUpdatedAt: "2026-07-12T00:00:00.000Z",
        },
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

    expect(useSquadStore().teams).toHaveLength(2);

    const emptyTeam = useMatchStore().teams.find((team) => team.teamID === 2);
    expect(emptyTeam).toMatchObject({
      teamID: 2,
      teamName: "Manticore Security Task Force",
      playerCount: 0,
      squads: [],
      unassignedPlayers: [],
    });
  });
});
