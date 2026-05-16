import { describe, expect, it } from "vitest";
import { buildServerSnapshot } from "./matchSnapshot";

describe("buildServerSnapshot", () => {
  it("keeps TPS undefined when the backend snapshot does not provide a positive value", () => {
    const snapshot = buildServerSnapshot(
      {
        serverStatus: {
          serverName: "BZSS Main Server",
          map: "Mutaha",
          layer: "Mutaha_RAAS_v1",
          nextLayer: "Fallujah_RAAS_v2",
          isWarmup: true,
          playtime: 1234,
        },
      },
      {
        status: {
          tps: 0,
          serverName: "",
          map: "Unknown Map",
          isWarmup: false,
        },
      },
    );

    expect(snapshot.tps).toBeUndefined();
    expect(snapshot.webStatus.tps).toBeNull();
    expect(snapshot.isWarmup).toBe(true);
    expect(snapshot.webStatus.isWarmup).toBe(false);
    expect(snapshot.serverName).toBe("BZSS Main Server");
    expect(snapshot.map).toBe("Mutaha");
    expect(snapshot.layer).toBe("Mutaha_RAAS_v1");
    expect(snapshot.webStatus.nextLayer).toBe("Fallujah_RAAS_v2");
  });
});
