import { describe, expect, it } from "vitest";

import { resolveRoleIcon } from "./role-icons";

describe("role-icons", () => {
  it("resolves common human-readable roles", () => {
    expect(resolveRoleIcon("Squad Leader").icon).toContain("T_role_squadleader.PNG");
    expect(resolveRoleIcon("Medic").icon).toContain("T_role_medic.PNG");
    expect(resolveRoleIcon("Heavy Anti Tank").icon).toContain("T_role_heavyantitank.PNG");
    expect(resolveRoleIcon("Light Anti-Tank").icon).toContain("T_role_lightantitank.PNG");
    expect(resolveRoleIcon("Machine Gunner").icon).toContain("T_role_machinegunner.PNG");
    expect(resolveRoleIcon("Automatic Rifleman").icon).toContain("T_role_automaticrifleman.PNG");
    expect(resolveRoleIcon("Marksman").icon).toContain("T_role_designatedmarksman.PNG");
    expect(resolveRoleIcon("Crewman").icon).toContain("T_role_crewman.PNG");
    expect(resolveRoleIcon("Pilot").icon).toContain("T_role_pilot.PNG");
  });

  it("resolves raw BZSS soldier class names used by the tactical map", () => {
    expect(resolveRoleIcon("BP_Soldier_USA_SquadLeader_Woodland_C").icon).toContain("T_role_squadleader.PNG");
    expect(resolveRoleIcon("BP_Soldier_USA_Medic_Woodland_C").icon).toContain("T_role_medic.PNG");
    expect(resolveRoleIcon("BP_Soldier_USA_Engineer_Woodland_C").icon).toContain("T_role_engineer.PNG");
    expect(resolveRoleIcon("BP_Soldier_USA_Grenadier_Woodland_C").icon).toContain("T_role_grenadier.PNG");
    expect(resolveRoleIcon("BP_Soldier_USA_Pilot_Woodland_C").icon).toContain("T_role_pilot.PNG");
    expect(resolveRoleIcon("BP_Soldier_USA_Crewman_Woodland_C").icon).toContain("T_role_crewman.PNG");
    expect(resolveRoleIcon("BP_Soldier_USA_AutomaticRifleman_Woodland_C").icon).toContain("T_role_automaticrifleman.PNG");
    expect(resolveRoleIcon("BP_Soldier_PLA_AR_Woodland_C").icon).toContain("T_role_automaticrifleman.PNG");
    expect(resolveRoleIcon("BP_Soldier_PLA_Rifleman1_Woodland_C").icon).toContain("T_role_rifleman.PNG");
  });

  it("covers special tactical map variants and avoids arid false positives", () => {
    expect(resolveRoleIcon("BP_Soldier_CAF_Arid_HeavyAntiTank_C").icon).toContain("T_role_heavyantitank.PNG");
    expect(resolveRoleIcon("BP_Soldier_CAF_Arid_LightAntiTank_C").icon).toContain("T_role_lightantitank.PNG");
    expect(resolveRoleIcon("BP_Soldier_CAF_Arid_SL_Crewman_C").icon).toContain("T_role_crewman_squadleader.PNG");
    expect(resolveRoleIcon("BP_Soldier_CAF_Arid_SquadLeader_2_C").icon).toContain("T_role_squadleader.PNG");
    expect(resolveRoleIcon("BP_Soldier_VDV_Engineer_Desert_C").icon).toContain("T_role_engineer.PNG");
    expect(resolveRoleIcon("BP_Soldier_GFI_Raider_C").icon).toContain("T_role_raider.PNG");
    expect(resolveRoleIcon("BP_Soldier_GFI_Recon_C").icon).toContain("T_role_recon.PNG");
    expect(resolveRoleIcon("BP_Soldier_GFI_Breacher_C").icon).toContain("T_role_breacher.PNG");
    expect(resolveRoleIcon("BP_Soldier_GFI_AntiAir_C").icon).toContain("T_role_antiair.PNG");
    expect(resolveRoleIcon("BP_Soldier_USA_Plain_Woodland_C").icon).toContain("T_role_rifleman.PNG");
  });

  it("falls back cleanly for unknown roles", () => {
    const icon = resolveRoleIcon("Something Completely Unrelated");
    expect(icon.icon).toBe("•");
    expect(icon.label).toBe("Something Completely Unrelated");
    expect(icon.tone).toBe("default");
  });
});
