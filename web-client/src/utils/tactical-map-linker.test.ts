import { describe, expect, it } from "vitest";
import type { BzssCoreTrackedPlayerInfo } from "../app/bzssCoreApi";
import { linkTacticalPlayers, buildTacticalPlayerKey } from "./tactical-map-linker";

function makeBzssPlayer(overrides: Partial<BzssCoreTrackedPlayerInfo> = {}): BzssCoreTrackedPlayerInfo {
  return {
    playerId: 11,
    playerIndex: 7,
    playerName: "Alice",
    playerGuid: "76561198000000001",
    teamId: 1,
    squadId: 2,
    playerBaseInfo: {
      raw: "",
      fields: [],
    },
    soldierInfo: {
      raw: "",
      fields: [],
      soldierClass: "Rifleman",
      health: 87,
      weaponClass: "BP_Rifle_C",
      ammoValues: [30, 90],
      position: { x: 100, y: 200, z: 0 },
      rotation: { x: 0, y: 90, z: 0 },
    },
    playerScoreboard: {
      raw: "",
      values: [],
      numericValues: [],
    },
    rawText: "",
    ...overrides,
  };
}

describe("tactical-map-linker", () => {
  it("links by Steam64 with exact confidence", () => {
    const bzss = makeBzssPlayer();
    const runtime = {
      playerID: 11,
      steamID: "76561198000000001",
      name: "Alice",
      teamID: 1,
      squadID: 2,
      isLeader: false,
      role: "Rifleman",
      online: true,
    };

    const [linked] = linkTacticalPlayers({
      bzssPlayers: [bzss],
      runtimePlayers: [runtime],
      bySteamID: { "76561198000000001": runtime },
    });

    expect(linked.runtime).toBe(runtime);
    expect(linked.linkConfidence).toBe("exact");
    expect(linked.linkReason).toContain("Steam64");
  });

  it("links by EOSID with exact confidence", () => {
    const bzss = makeBzssPlayer({ playerGuid: "0123456789abcdef0123456789abcdef" });
    const runtime = {
      playerID: 22,
      eosID: "0123456789abcdef0123456789abcdef",
      name: "Bravo",
      teamID: 2,
      squadID: 4,
      isLeader: false,
      role: "Medic",
      online: true,
    };

    const [linked] = linkTacticalPlayers({
      bzssPlayers: [bzss],
      runtimePlayers: [runtime],
      byEOSID: { "0123456789abcdef0123456789abcdef": runtime },
    });

    expect(linked.runtime).toBe(runtime);
    expect(linked.linkConfidence).toBe("exact");
    expect(linked.linkReason).toContain("EOSID");
  });

  it("links by PlayerID with strong confidence", () => {
    const bzss = makeBzssPlayer({ playerGuid: "no-id-here", playerId: 33, playerName: "Charlie" });
    const runtime = {
      playerID: 33,
      name: "Charlie",
      teamID: 1,
      squadID: 9,
      isLeader: true,
      role: "SL",
      online: true,
    };

    const [linked] = linkTacticalPlayers({
      bzssPlayers: [bzss],
      runtimePlayers: [runtime],
      byPlayerID: { "33": runtime },
    });

    expect(linked.runtime).toBe(runtime);
    expect(linked.linkConfidence).toBe("strong");
    expect(linked.linkReason).toContain("PlayerID");
  });

  it("falls back to fuzzy name matching with weak confidence", () => {
    const bzss = makeBzssPlayer({ playerGuid: "no-id-here", playerId: null, playerName: "Alice" });
    const runtime = {
      playerID: 44,
      name: "[TAG] Alice",
      teamID: 1,
      squadID: 2,
      isLeader: false,
      role: "Rifleman",
      online: true,
    };

    const [linked] = linkTacticalPlayers({
      bzssPlayers: [bzss],
      runtimePlayers: [runtime],
    });

    expect(linked.runtime).toBe(runtime);
    expect(linked.linkConfidence).toBe("weak");
    expect(linked.linkReason).toContain("弱匹配");
  });

  it("preserves BZSS data when no runtime match exists", () => {
    const bzss = makeBzssPlayer({ playerName: "Delta" });

    const [linked] = linkTacticalPlayers({
      bzssPlayers: [bzss],
      runtimePlayers: [],
    });

    expect(linked.runtime).toBeNull();
    expect(linked.linkConfidence).toBe("none");
    expect(linked.playerName).toBe("Delta");
    expect(linked.bzss).toBe(bzss);
    expect(buildTacticalPlayerKey(bzss)).toContain("idx:");
  });
});
