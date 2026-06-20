import { describe, expect, it } from "vitest";

import { buildPageRoutes, getStaticNavItems, pageRegistry } from "./pageRegistry";
import { staticNavItems } from "./sidebarNav";

describe("page registry", () => {
  it("keeps route names, paths, and aliases unique", () => {
    const names = new Set<string>();
    const paths = new Set<string>();
    const aliases = new Set<string>();

    for (const page of pageRegistry) {
      expect(names.has(page.name)).toBe(false);
      expect(paths.has(page.path)).toBe(false);
      names.add(page.name);
      paths.add(page.path);

      for (const alias of page.aliases ?? []) {
        expect(paths.has(alias)).toBe(false);
        expect(aliases.has(alias)).toBe(false);
        aliases.add(alias);
      }
    }
  });

  it("writes permission and layout metadata into router records", () => {
    const combatManager = buildPageRoutes().find((route) => route.name === "combat-manager");
    expect(combatManager?.meta?.requiredPermission).toBe("combat_manager.view");
    expect(combatManager?.meta?.legacyRequiredPermissions).toEqual(["kill_manager.view"]);
    expect(combatManager?.meta?.layoutMode).toBe("workspace");
    expect(combatManager?.meta?.contentPadding).toBe("none");

    const tacticalReport = buildPageRoutes().find((route) => route.name === "tactical-report");
    expect(tacticalReport?.meta?.requiredPermission).toBe("plugin:tactical-report:view");
    expect(tacticalReport?.meta?.legacyRequiredPermissions).toEqual([]);
  });

  it("shares the same static navigation source with the sidebar", () => {
    expect(staticNavItems).toEqual(getStaticNavItems());
  });

  it("keeps nav order values finite and positive", () => {
    for (const item of getStaticNavItems()) {
      expect(Number.isFinite(item.order)).toBe(true);
      expect(item.order).toBeGreaterThan(0);
    }
  });
});
