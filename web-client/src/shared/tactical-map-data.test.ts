import { describe, expect, it } from "vitest";
import { TACTICAL_MAP_LIST, getDefaultTacticalMapKey, resolveTacticalMapKey } from "./tactical-map-data";

describe("tactical-map-data", () => {
  it("returns the first configured map as the default fallback", () => {
    expect(getDefaultTacticalMapKey()).toBe(TACTICAL_MAP_LIST[0]?.key ?? null);
  });

  it("still resolves explicit map names", () => {
    expect(resolveTacticalMapKey("Sumari")).toBe("Sumari_RAAS_v1");
  });

  it("does not force a fixed map for unknown names", () => {
    expect(resolveTacticalMapKey("NotARealMap")).toBeNull();
  });
});
