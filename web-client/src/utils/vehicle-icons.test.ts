import { describe, expect, it } from "vitest";

import { isVehicleIconImage, resolveVehicleIcon } from "./vehicle-icons";

describe("vehicle-icons", () => {
  it("resolves common vehicle classes to map icon assets", () => {
    expect(resolveVehicleIcon("BP_Soldier_USA_TruckTransport_C_123").icon).toContain("/Icon/map_truck_transport.PNG");
    expect(resolveVehicleIcon("BP_Soldier_PLA_Tank_C_456").icon).toContain("/Icon/map_tank.PNG");
    expect(resolveVehicleIcon("BP_Soldier_USA_TrackedAPC_Logi_C_789").icon).toContain("/Icon/T_map_trackedapc_logistics.PNG");
  });

  it("falls back cleanly for unknown or empty vehicle types", () => {
    expect(resolveVehicleIcon("")).toEqual({ icon: "🚙", label: "载具", tone: "crewman" });
    expect(resolveVehicleIcon("None")).toEqual({ icon: "🚙", label: "载具", tone: "crewman" });
  });

  it("detects vehicle icon image paths", () => {
    expect(isVehicleIconImage("/Icon/map_tank.PNG")).toBe(true);
    expect(isVehicleIconImage("🚙")).toBe(false);
  });
});
