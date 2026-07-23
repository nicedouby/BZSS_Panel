import type { AuthUser } from "../stores/auth.store";
import { canAccessPage } from "../shared/web-page-permissions.js";
import {
  getPageDefinitionByPath,
  pageRegistry,
  resolvePagePermissions,
  type PageDefinition,
} from "./pageRegistry";

const IDLE_PRELOAD_DELAY_MS = 900;
const IDLE_TIMEOUT_MS = 1500;

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

interface SupplementalPageDefinition {
  path: string;
  superAdminOnly?: boolean;
  load: () => Promise<unknown>;
}

const supplementalPages: SupplementalPageDefinition[] = [
  {
    path: "/system/logpost-diagnostics",
    superAdminOnly: true,
    load: () => import("../pages/LogPostDiagnosticsPage.vue"),
  },
  {
    path: "/system/logpost-consumption-performance",
    superAdminOnly: true,
    load: () => import("../pages/LogPostConsumptionPerformancePage.vue"),
  },
];

const loadedPaths = new Set<string>();
const pendingLoads = new Map<string, Promise<void>>();

let preloadGeneration = 0;
let idleHandle: number | null = null;
let idleTimer: number | null = null;

export function startPageFrameworkPreload(user: AuthUser | null, currentPath = "") {
  stopPageFrameworkPreload();
  if (!user || typeof window === "undefined" || shouldDisablePreload()) return;

  const generation = ++preloadGeneration;
  const current = normalizePath(currentPath);
  const currentPage = getPageDefinitionByPath(current);
  if (!currentPage?.nav?.section) return;

  idleTimer = window.setTimeout(() => {
    idleTimer = null;
    if (generation !== preloadGeneration || shouldDisablePreload()) return;

    const schedule = () => {
      idleHandle = null;
      if (generation !== preloadGeneration || shouldDisablePreload()) return;

      const candidate = pageRegistry
        .filter((page) => page.nav?.section === currentPage.nav?.section)
        .filter((page) => normalizePath(page.path) !== current)
        .filter((page) => canUserAccessPage(page, user))
        .filter((page) => !isHeavyPage(page.path))
        .sort(comparePreloadPriority)[0];

      if (candidate) void loadPageDefinition(candidate);
    };

    if (typeof window.requestIdleCallback === "function") {
      idleHandle = window.requestIdleCallback(schedule, { timeout: IDLE_TIMEOUT_MS });
    } else {
      idleHandle = window.setTimeout(schedule, 0);
    }
  }, IDLE_PRELOAD_DELAY_MS);
}

export function stopPageFrameworkPreload() {
  preloadGeneration += 1;
  if (typeof window === "undefined") return;

  if (idleHandle != null) {
    if (typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idleHandle);
    } else {
      window.clearTimeout(idleHandle);
    }
    idleHandle = null;
  }

  if (idleTimer != null) {
    window.clearTimeout(idleTimer);
    idleTimer = null;
  }
}

export function preloadPageFrameworkByPath(path: string, user: AuthUser | null) {
  // This function is called because the user explicitly intends to navigate.
  // Performance/data-saver gates belong to idle background warming only;
  // applying them here makes cold-route navigation look like a dead click.
  if (!user || typeof window === "undefined" || document.hidden) {
    return Promise.resolve();
  }

  const normalizedPath = normalizePath(path);
  const page = getPageDefinitionByPath(normalizedPath);
  if (page && canUserAccessPage(page, user)) {
    return loadPageDefinition(page);
  }

  const supplemental = supplementalPages.find(
    (item) => normalizePath(item.path) === normalizedPath,
  );
  if (!supplemental || (supplemental.superAdminOnly && !user.isSuperAdmin)) {
    return Promise.resolve();
  }

  return loadFramework(supplemental.path, supplemental.load);
}

// Kept for callers that already use this helper, but intent preloading is capped
// to one page so opening a navigation section cannot trigger a batch import.
export function preloadPageFrameworksByPaths(paths: string[], user: AuthUser | null) {
  const firstPath = paths.find((path) => !isHeavyPage(normalizePath(path)));
  return firstPath ? preloadPageFrameworkByPath(firstPath, user) : Promise.resolve();
}

function loadPageDefinition(page: PageDefinition) {
  if (typeof page.component !== "function") {
    loadedPaths.add(normalizePath(page.path));
    return Promise.resolve();
  }

  return loadFramework(
    page.path,
    page.component as unknown as () => Promise<unknown>,
  );
}

function loadFramework(path: string, loader: () => Promise<unknown>) {
  const key = normalizePath(path);
  if (loadedPaths.has(key)) return Promise.resolve();

  const pending = pendingLoads.get(key);
  if (pending) return pending;

  const promise = Promise.resolve()
    .then(loader)
    .then(() => {
      loadedPaths.add(key);
    })
    .catch((error) => {
      console.warn(`[page-preloader] Failed to preload ${key}`, error);
    })
    .finally(() => {
      pendingLoads.delete(key);
    });

  pendingLoads.set(key, promise);
  return promise;
}

function canUserAccessPage(page: PageDefinition, user: AuthUser) {
  const permissions = resolvePagePermissions(page);
  if (permissions.superAdminOnly && !user.isSuperAdmin) return false;
  if (!permissions.requiredPermission) return true;

  return canAccessPage(
    user,
    permissions.requiredPermission,
    permissions.legacyRequiredPermissions,
    { superAdminOnly: permissions.superAdminOnly },
  );
}

function comparePreloadPriority(left: PageDefinition, right: PageDefinition) {
  const leftHidden = left.nav?.hidden ? 1 : 0;
  const rightHidden = right.nav?.hidden ? 1 : 0;
  if (leftHidden !== rightHidden) return leftHidden - rightHidden;

  return Number(left.nav?.order ?? 10_000) - Number(right.nav?.order ?? 10_000);
}

function isHeavyPage(path: string) {
  const normalized = normalizePath(path).toLowerCase();
  return [
    "tactical-map",
    "player-database",
    "combat-log",
    "battle-log",
    "logpost",
    "statistics",
    "analytics",
    "echarts",
    "snapshot",
  ].some((token) => normalized.includes(token));
}

function shouldDisablePreload() {
  if (typeof navigator === "undefined" || typeof document === "undefined") return true;
  if (document.hidden) return true;

  const connection = (
    navigator as Navigator & {
      connection?: NetworkInformationLike;
    }
  ).connection;

  if (connection?.saveData) return true;
  if (["slow-2g", "2g", "3g"].includes(connection?.effectiveType ?? "")) return true;

  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof deviceMemory === "number" && deviceMemory <= 4) return true;
  if (typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4) {
    return true;
  }

  return false;
}

function normalizePath(path: string) {
  const text = String(path ?? "").trim();
  if (!text) return "/";
  return text.split("?")[0].split("#")[0] || "/";
}
