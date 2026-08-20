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

    const tacticalReport = buildPageRoutes().find((route) => route.name === "tactical-report");
    expect(tacticalReport?.meta?.requiredPermission).toBe("plugin:tactical-report:view");
    expect(tacticalReport?.meta?.legacyRequiredPermissions).toEqual([]);

  });

  it("registers the combat records page with trace-safe permissions", () => {
    const definition = pageRegistry.find((page) => page.name === "combat-records");
    const route = buildPageRoutes().find((item) => item.name === "combat-records");

    expect(definition?.path).toBe("/combat-records");
    expect(definition?.aliases).toContain("/kill-records");
    expect(definition?.nav).toMatchObject({ section: "combat", label: "战斗记录" });
    expect(route?.meta?.requiredPermission).toBe("combat_manager.view");
    expect(route?.meta?.legacyRequiredPermissions).toEqual(["kill_manager.view"]);
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
