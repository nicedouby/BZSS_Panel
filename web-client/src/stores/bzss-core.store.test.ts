import { describe, expect, it } from "vitest";

import { buildBzssCorePlayers } from "./bzss-core.store";

describe("bzss-core store player resolution", () => {
  it("uses players directly when the backend already provides a merged list", () => {
    const players = buildBzssCorePlayers({
      ok: true,
      status: "ready",
      state: {} as any,
      runtimePlayers: [{ playerIndex: 1, position: { x: 1, y: 2, z: 3 } } as any],
      scoreboardPlayers: [{ playerIndex: 2, squadId: 7 } as any],
      players: [
        { playerIndex: 1 },
        { playerIndex: 2 },
        { playerIndex: 3 },
      ],
    });

    expect(players.map((player) => player.playerIndex)).toEqual([1, 2, 3]);
  });

  it("falls back to merging scoreboard-first runtime data when players is absent", () => {
    const players = buildBzssCorePlayers({
      ok: true,
      status: "ready",
      state: {} as any,
      runtimePlayers: [{ playerIndex: 1, position: { x: 1, y: 2, z: 3 }, yaw: 90 } as any],
      scoreboardPlayers: [
        { playerIndex: 1, squadId: 7, teamId: 2 } as any,
        { playerIndex: 2, squadId: 8, teamId: 1 } as any,
      ],
    });

    expect(players).toHaveLength(2);
    expect(players[0]).toMatchObject({
      playerIndex: 1,
      squadId: 7,
      teamId: 2,
      position: { x: 1, y: 2, z: 3 },
      yaw: 90,
    });
    expect(players[1]).toMatchObject({
      playerIndex: 2,
      stale: true,
      presence: { state: "scoreboardOnly" },
    });
  });
});
