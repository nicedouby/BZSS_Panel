import { describe, expect, it } from "vitest";

import { normalizeBzssCoreFobInfo } from "./bzssCoreApi";

describe("normalizeBzssCoreFobInfo", () => {
  it("keeps the FOB size and exposes the final FOBI field as the instigator", () => {
    const normalized = normalizeBzssCoreFobInfo({
      teamId: 2,
      health: 300,
      isBleeding: false,
      ammo: 0,
      construction: 0,
      name: "",
      position: { x: 26355.048, y: 38469.101, z: -71.341 },
      size: "Very_Small",
      instigator: "Donald·DoubyBear",
    });

    expect(normalized.fobSize).toBe("Very_Small");
    expect(normalized.instigatorName).toBe("Donald·DoubyBear");
    expect(normalized.instigator).toBe("Donald·DoubyBear");
    expect(normalized.size).toBe("Very_Small · 发起者：Donald·DoubyBear");
  });

  it("shows an explicit placeholder when the FOBI instigator field is empty", () => {
    const normalized = normalizeBzssCoreFobInfo({
      teamId: 1,
      health: 300,
      isBleeding: false,
      ammo: 10498.400391,
      construction: 3500,
      name: "",
      position: { x: 42684.246, y: 14019.167, z: 310.761 },
      size: "Very_Small",
      instigator: "",
    });

    expect(normalized.size).toBe("Very_Small · 发起者：--");
  });
});
