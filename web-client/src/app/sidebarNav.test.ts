import { describe, expect, it } from "vitest";
import { buildNavSections, findSectionForRoute } from "./sidebarNav";

const superAdmin = {
  isSuperAdmin: true,
  permissions: ["*"],
};

describe("sidebar navigation sections", () => {
  it("builds workflow sections instead of implementation buckets", () => {
    const sections = buildNavSections({ user: superAdmin });

    expect(sections.map((section) => section.key)).toContain("players");
    expect(sections.find((section) => section.key === "players")?.defaultPath).toBe("/player-database");
    expect(sections.find((section) => section.key === "players")?.items.map((item) => item.path)).toContain("/squad-rule-chain");
    expect(sections.find((section) => section.key === "players")?.items.map((item) => item.path)).toContain("/black-edge-privilege");
    expect(sections.find((section) => section.key === "balance")?.items.map((item) => item.path)).toEqual([
      "/tb",
      "/team-shuffle",
      "/plugins/fair-team-balance",
      "/debug/fair-team-balance-lab",
    ]);
    expect(sections.find((section) => section.key === "broadcast")?.items.map((item) => item.path)).toContain("/plugins/tactical-report");
    expect(sections.find((section) => section.key === "analytics")?.items.map((item) => item.path)).toContain("/plugins/server-info-statistics");
  });

  it("filters static and api pages by permissions", () => {
    const sections = buildNavSections({
      user: { permissions: ["match_state.view", "player_database.view"] },
      apiPages: [
        {
          enabled: true,
          route: "/plugins/private-tool",
          title: "Private Tool",
          requiredPermission: "plugins.private",
          source: "plugin.private",
        },
      ],
    });

    const paths = sections.flatMap((section) => section.items.map((item) => item.path));
    expect(paths).toContain("/match-status");
    expect(paths).toContain("/player-database");
    expect(paths).not.toContain("/console");
    expect(paths).not.toContain("/plugins/private-tool");
  });

  it("does not surface hidden api pages or duplicate static routes", () => {
    const sections = buildNavSections({
      user: superAdmin,
      apiPages: [
        {
          enabled: true,
          route: "/plugins/new-tool",
          title: "New Tool",
          requiredPermission: "",
          source: "plugin.new-tool",
          order: 5,
        },
        {
          enabled: true,
          hiddenFromSidebar: true,
          route: "/plugins/hidden-tool",
          title: "Hidden Tool",
          requiredPermission: "",
          source: "plugin.hidden-tool",
        },
        {
          enabled: true,
          route: "/match-status",
          title: "Duplicate Match",
          requiredPermission: "",
          source: "module.matchState",
        },
      ],
    });

    const paths = sections.flatMap((section) => section.items.map((item) => item.path));
    expect(paths).toContain("/plugins/new-tool");
    expect(paths).not.toContain("/plugins/hidden-tool");
    expect(paths.filter((path) => path === "/match-status")).toHaveLength(1);
    expect(sections.find((section) => section.key === "other")?.items[0]?.path).toBe("/plugins/new-tool");
  });

  it("resolves active sections for aliases and child routes", () => {
    const sections = buildNavSections({ user: superAdmin });

    expect(findSectionForRoute(sections, "/combat-clean")?.key).toBe("combat");
    expect(findSectionForRoute(sections, "/plugins/fair-squad-guard/detail")?.key).toBe("players");
    expect(findSectionForRoute(sections, "/debug/squad-name-policy/rules")?.key).toBe("players");
    expect(findSectionForRoute(sections, "/system/audit-records")?.key).toBe("system");
  });
});
