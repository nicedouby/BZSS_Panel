import { describe, expect, it } from "vitest";

import {
  __factionAssetManifestForTests,
  getFactionFromTeamName,
  getFlagUrlByTeamName,
  getUnitIconUrlByTeamName,
} from "./faction-data";

describe("faction-data", () => {
  it("resolves representative battlegroups across factions", () => {
    expect(getFactionFromTeamName("95th Air Assault Brigade")).toBe("AFU");
    expect(getFactionFromTeamName("1st Infantry Division")).toBe("USA");
    expect(getFactionFromTeamName("Manticore Security Task Force")).toBe("WPMC");

    expect(getFlagUrlByTeamName("95th Air Assault Brigade")).toContain("AFU.PNG");
    expect(getFlagUrlByTeamName("1st Infantry Division")).toContain("USA.PNG");
    expect(getUnitIconUrlByTeamName("1st Infantry Division")).toContain("T_USA_1st_INFDIV_CombinedArms.PNG");
  });

  it("handles irregular filenames and lookup aliases", () => {
    expect(getUnitIconUrlByTeamName("217th Guards Airborne Regiment")).toContain("T_VDV_217th_Guards_AirAssaut.PNG");
    expect(getUnitIconUrlByTeamName("504th Parachute Infantry Regiment")).toContain("T_USA_504th_PIR_AirAssault.PNG");
    expect(getUnitIconUrlByTeamName("  95th Air Assault Brigade  ")).toContain("T_AFU_95thAAB_AirAssault.PNG");
  });

  it("returns null for unknown or partial names", () => {
    expect(getFactionFromTeamName("Unknown Battlegroup")).toBeNull();
    expect(getFlagUrlByTeamName("95th Air Assault")).toBeNull();
    expect(getUnitIconUrlByTeamName("95th Air Assault")).toBeNull();
  });

  it("keeps the manifest aligned with the checked-in asset files", () => {
    const iconAssets = import.meta.glob("./T_*", { eager: true, query: "?url", import: "default" });
    const flagAssets = import.meta.glob("./[A-Z]*", { eager: true, query: "?url", import: "default" });

    const mappedIcons = new Set(
      __factionAssetManifestForTests.battlegroupVisuals
        .map((entry) => entry.unitIconBasename)
        .filter(Boolean),
    );
    const checkedInIcons = new Set(
      Object.keys(iconAssets).map((assetPath) => assetPath.split("/").pop() as string),
    );
    const mappedFlags = new Set(
      Object.values(__factionAssetManifestForTests.factionFlagBasenames).filter(Boolean),
    );
    const checkedInFlags = new Set(
      Object.keys(flagAssets)
        .map((assetPath) => assetPath.split("/").pop() as string)
        .filter((name) => !name.startsWith("T_")),
    );

    expect(mappedIcons).toEqual(checkedInIcons);
    expect(mappedFlags).toEqual(checkedInFlags);
  });
});
