import { describe, expect, it } from "vitest";
import {
  TACTICAL_MAP_LIST,
  getDefaultTacticalMapKey,
  getStaticTacticalAssets,
  resolveTacticalMapKey,
} from "./tactical-map-data";

describe("tactical-map-data", () => {
  it("returns the first configured map as the default fallback", () => {
    expect(getDefaultTacticalMapKey()).toBe(TACTICAL_MAP_LIST[0]?.key ?? null);
  });

  it("still resolves explicit map names", () => {
    expect(resolveTacticalMapKey("Sumari")).toBe("Sumari_RAAS_v1");
  });

  it("resolves Al Basrah to the tactical map config", () => {
    expect(resolveTacticalMapKey("Al Basrah")).toBe("AlBasrah_AAS_v1");
    expect(getStaticTacticalAssets("AlBasrah_AAS_v1")?.captureZones?.length).toBeGreaterThan(0);
  });

  it("does not force a fixed map for unknown names", () => {
    expect(resolveTacticalMapKey("NotARealMap")).toBeNull();
  });
});
